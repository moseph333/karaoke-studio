"""Mixer levels and quality: unnormalised guide mix with a limiter, Rubber Band for exports."""

import subprocess
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf

from backend.services import audio_mixer
from backend.services.audio_mixer import AudioMixer, ffmpeg_has_filter, mix_quality

RATE = 44100


def _tone(path, freq: float, amp: float, seconds: float = 1.0):
    t = np.arange(int(RATE * seconds)) / RATE
    sf.write(str(path), (amp * np.sin(2 * np.pi * freq * t)).astype(np.float32), RATE)
    return str(path)


def _band_rms(path, freq: float) -> float:
    """RMS amplitude of the component near freq (FFT magnitude of a Hann-windowed middle slice)."""
    data, rate = sf.read(path, always_2d=True)
    mono = data.mean(axis=1)
    middle = mono[len(mono) // 4 : 3 * len(mono) // 4]
    window = np.hanning(len(middle))
    spectrum = np.abs(np.fft.rfft(middle * window)) / (window.sum() / 2)
    freqs = np.fft.rfftfreq(len(middle), 1 / rate)
    band = (freqs > freq * 0.97) & (freqs < freq * 1.03)
    return float(spectrum[band].max())


def _dominant_freq(path) -> float:
    data, rate = sf.read(path, always_2d=True)
    mono = data.mean(axis=1)
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    return float(np.fft.rfftfreq(len(mono), 1 / rate)[spectrum.argmax()])


@pytest.fixture(autouse=True)
def _fresh_probe():
    audio_mixer.reset_ffmpeg_probe()
    yield
    audio_mixer.reset_ffmpeg_probe()


def test_switching_the_guide_on_keeps_the_backing_track_level(tmp_path):
    mixer = AudioMixer(output_dir=tmp_path)
    inst = _tone(tmp_path / "inst.wav", 330, 0.4)
    voc = _tone(tmp_path / "voc.wav", 660, 0.4)

    alone = mixer.mix_and_shift(instrumental_path=inst, output_filename="alone.wav")
    with_guide = mixer.mix_and_shift(
        instrumental_path=inst, vocals_path=voc, guide_volume=0.5, output_filename="guide.wav"
    )

    assert _band_rms(with_guide, 330) == pytest.approx(_band_rms(alone, 330), rel=0.05)
    assert _band_rms(with_guide, 660) == pytest.approx(0.2, rel=0.1)


def test_loud_guide_mixes_are_limited_instead_of_clipping(tmp_path):
    mixer = AudioMixer(output_dir=tmp_path)
    inst = _tone(tmp_path / "inst.wav", 220, 0.9)
    voc = _tone(tmp_path / "voc.wav", 220, 0.9)
    out = mixer.mix_and_shift(
        instrumental_path=inst, vocals_path=voc, guide_volume=1.0, output_filename="loud.wav"
    )
    data, _ = sf.read(out)
    steady = np.abs(data[RATE // 4 :])
    assert steady.max() <= 0.96
    assert steady.max() > 0.85  # limited, not re-normalised down


@pytest.mark.skipif(not ffmpeg_has_filter("rubberband"), reason="FFmpeg without librubberband")
def test_final_quality_uses_rubber_band_and_keeps_the_duration(tmp_path, monkeypatch):
    mixer = AudioMixer(output_dir=tmp_path)
    inst = _tone(tmp_path / "inst.wav", 440, 0.5, seconds=2.0)
    voc = _tone(tmp_path / "voc.wav", 220, 0.5, seconds=2.0)
    commands = []
    real_run = subprocess.run

    def spy(cmd, *args, **kwargs):
        commands.append(cmd)
        return real_run(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "run", spy)
    with mix_quality("final"):
        out = mixer.mix_and_shift(
            instrumental_path=inst,
            vocals_path=voc,
            semitones=12,
            guide_volume=0.3,
            output_filename="final.wav",
        )

    graph = commands[-1][commands[-1].index("-filter_complex") + 1]
    assert "[0:a]rubberband=pitch=2.000000:transients=mixed:pitchq=quality" in graph
    assert "[1:a]volume=0.30,rubberband=pitch=2.000000" in graph
    assert graph.count("formant=preserved") == 1  # the guide vocal only
    assert "asetrate" not in graph
    assert sf.info(out).duration == pytest.approx(2.0, abs=0.05)
    assert _dominant_freq(out) == pytest.approx(880, rel=0.02)

    # Studio previews keep the fast resampling shift
    mixer.mix_and_shift(instrumental_path=inst, semitones=12, output_filename="preview.wav")
    preview_graph = commands[-1][commands[-1].index("-filter_complex") + 1]
    assert preview_graph.startswith("[0:a]asetrate=44100*2.000000,atempo=0.500000,alimiter")


def test_final_quality_falls_back_without_rubber_band(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_mixer, "ffmpeg_has_filter", lambda name: False)
    mixer = AudioMixer(output_dir=tmp_path)
    inst = _tone(tmp_path / "inst.wav", 440, 0.5)
    with mix_quality("final"):
        out = mixer.mix_and_shift(instrumental_path=inst, semitones=-12, output_filename="f.wav")
    assert _dominant_freq(out) == pytest.approx(220, rel=0.03)
    assert audio_mixer.MIX_QUALITY.get() == "preview"


def test_old_ffmpeg_gets_the_legacy_mix_graph(tmp_path, monkeypatch):
    mixer = AudioMixer(output_dir=tmp_path)
    inst = _tone(tmp_path / "inst.wav", 330, 0.4)
    voc = _tone(tmp_path / "voc.wav", 660, 0.4)
    graphs = []

    def old_ffmpeg(cmd, *args, **kwargs):
        if cmd[0] != "ffmpeg":
            return subprocess.CompletedProcess(cmd, 1, "", "")
        graph = cmd[cmd.index("-filter_complex") + 1]
        graphs.append(graph)
        if "normalize=0" in graph:
            return subprocess.CompletedProcess(cmd, 1, "", "Option not found\n")
        with open(cmd[-1], "wb") as f:
            f.write(b"RIFF" + b"\x00" * 100)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(subprocess, "run", old_ffmpeg)
    mixer.mix_and_shift(
        instrumental_path=inst, vocals_path=voc, guide_volume=0.5, output_filename="old.wav"
    )
    assert len(graphs) == 2
    assert graphs[1].endswith("amix=inputs=2:duration=longest:dropout_transition=2[outa]")
    assert "alimiter" not in graphs[1]


def test_old_rubber_band_builds_fall_back_to_the_resampling_shift(tmp_path, monkeypatch):
    monkeypatch.setattr(audio_mixer, "ffmpeg_has_filter", lambda name: True)
    mixer = AudioMixer(output_dir=tmp_path)
    inst = _tone(tmp_path / "inst.wav", 330, 0.4)
    graphs = []

    def old_rubberband(cmd, *args, **kwargs):
        if cmd[0] != "ffmpeg":
            return subprocess.CompletedProcess(cmd, 1, "", "")
        graph = cmd[cmd.index("-filter_complex") + 1]
        graphs.append(graph)
        if "pitchq" in graph:
            return subprocess.CompletedProcess(cmd, 1, "", "Error applying option 'pitchq'\n")
        with open(cmd[-1], "wb") as f:
            f.write(b"RIFF" + b"\x00" * 100)
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(subprocess, "run", old_rubberband)
    with mix_quality("final"):
        mixer.mix_and_shift(instrumental_path=inst, semitones=5, output_filename="o.wav")
    assert graphs[0].startswith("[0:a]rubberband=")
    assert graphs[1].startswith("[0:a]asetrate=44100*")


def test_filter_probe_parses_the_list_and_retries_after_failures(monkeypatch):
    listing = (
        "Filters:\n  T.. = Timeline support\n  ------\n"
        " T.C alimiter          A->A       Audio lookahead limiter.\n"
        " ..C rubberband        A->A       Apply time-stretching and pitch-shifting.\n"
    )
    calls = []

    def run(cmd, *args, **kwargs):
        calls.append(cmd)
        if len(calls) == 1:
            raise OSError("ffmpeg missing")
        return MagicMock(returncode=0, stdout=listing)

    monkeypatch.setattr(subprocess, "run", run)
    assert ffmpeg_has_filter("rubberband") is False  # probe failed: not remembered
    assert ffmpeg_has_filter("rubberband") is True
    assert ffmpeg_has_filter("alimiter") is True
    assert ffmpeg_has_filter("Timeline") is False
    assert len(calls) == 2


def test_video_renders_mix_their_audio_at_final_quality(tmp_path, monkeypatch):
    import backend.main as main_mod
    from backend.main import projects
    from backend.render_worker import run_video_render
    from backend.schemas import RenderRequest

    wav = _tone(tmp_path / "inst.wav", 440, 0.3)
    projects["fq"] = {
        "id": "fq",
        "status": "ready",
        "title": "Final",
        "lines": [{"id": 1, "text": "la", "start_time": 0.1, "end_time": 0.5}],
        "instrumental_path": wav,
    }
    seen = []

    def fake_mix(**kwargs):
        seen.append(audio_mixer.MIX_QUALITY.get())
        return wav

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    monkeypatch.setattr(main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: None)
    monkeypatch.setattr(
        main_mod.video_renderer, "render_video", lambda **kw: tmp_path / "fq_karaoke.mp4"
    )
    run_video_render("fq", RenderRequest(semitones=3))
    assert seen == ["final"]
    assert audio_mixer.MIX_QUALITY.get() == "preview"


def test_renders_load_the_bundled_theme_fonts(tmp_path, monkeypatch):
    from backend.services import video_renderer as renderer_mod

    assert (renderer_mod.FONTS_DIR / "Sora-Bold.ttf").is_file()
    commands = []

    class FakeProcess:
        def __init__(self, cmd, **kwargs):
            commands.append(cmd)
            self.stdout = iter(["progress=end\n"])
            self.stderr = iter([])
            self.returncode = 0

        def wait(self, timeout=None):
            return 0

        def poll(self):
            return 0

    monkeypatch.setattr(subprocess, "Popen", FakeProcess)
    out = tmp_path / "out.mp4"
    renderer = renderer_mod.VideoRenderer(output_dir=tmp_path)
    try:
        renderer.render_video(
            audio_path=_tone(tmp_path / "a.wav", 440, 0.2),
            ass_subtitles_path=str(tmp_path / "subs.ass"),
            output_mp4_path=out,
            duration=1.0,
        )
    except Exception:
        pass  # the fake encoder writes no file; only the command matters here
    graph = commands[0][commands[0].index("-filter_complex") + 1]
    assert f":fontsdir='{renderer_mod.FONTS_DIR}'" in graph
