"""Export backgrounds: genuine 60 fps for every kind, still images processed once, the preset,
and the generated styles (drifting art, aurora, spectrum)."""

import json
import re
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.services import stage_backgrounds as sb
from backend.services import video_renderer as vr
from backend.services.video_renderer import VideoRenderer
from backend.shared_assets import SHARED_DIR

SIMPLE_ASS = r"""[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,84,&H0000FFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,5,3,2,80,80,120,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\kf40}Sweep {\kf60}test
"""


def _inputs(tmp_path: Path) -> tuple[Path, Path]:
    audio = tmp_path / "song.wav"
    sf.write(str(audio), np.zeros((44100, 2), dtype="float32"), 44100)
    ass = tmp_path / "song.ass"
    ass.write_text(SIMPLE_ASS, encoding="utf-8")
    return audio, ass


class _QuietProcess:
    """Stands in for FFmpeg: no progress output, exit code 0."""

    def __init__(self, cmd):
        self.cmd = list(cmd)
        self.stdout: list[str] = []
        self.stderr: list[str] = []
        self.returncode = 0

    def poll(self):
        return 0

    def terminate(self):
        pass

    def kill(self):
        pass

    def wait(self, timeout=None):
        return 0


def _main_command(tmp_path, monkeypatch, **render_kwargs) -> list[str]:
    """The FFmpeg command render_video launches, without running FFmpeg."""
    commands: list[list[str]] = []

    def popen(cmd, *args, **kwargs):
        process = _QuietProcess(cmd)
        commands.append(process.cmd)
        return process

    monkeypatch.setattr(subprocess, "Popen", popen)
    audio, ass = _inputs(tmp_path)
    VideoRenderer(output_dir=tmp_path).render_video(
        str(audio), str(ass), tmp_path / "out.mp4", duration=1.0, **render_kwargs
    )
    return commands[-1]


def _graph(cmd: list[str]) -> str:
    return cmd[cmd.index("-filter_complex") + 1]


def _fake_run(succeed: bool):
    """A subprocess.run for the one-off background step that writes (or fails to write) the PNG."""
    calls: list[list[str]] = []

    def run(cmd, *args, **kwargs):
        calls.append(list(cmd))
        if succeed:
            Path(cmd[-1]).write_bytes(b"\x89PNG prepared background")
        return subprocess.CompletedProcess(cmd, 0 if succeed else 1, "", "" if succeed else "boom")

    return run, calls


def test_a_colour_background_is_generated_at_60_fps_with_the_veryfast_preset(tmp_path, monkeypatch):
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    cmd = _main_command(tmp_path, monkeypatch)

    assert "color=c=0x0f111a:s=1920x1080:r=60" in cmd
    assert cmd[cmd.index("-preset") + 1] == "veryfast"
    assert cmd[cmd.index("-r") + 1] == "60"

    monkeypatch.setenv("FFMPEG_PRESET", "medium")
    cmd = _main_command(tmp_path, monkeypatch, aspect_ratio="9:16")
    assert cmd[cmd.index("-preset") + 1] == "medium"
    assert "color=c=0x0f111a:s=1080x1920:r=60" in cmd


def test_a_video_background_loops_and_is_resampled_to_60_fps(tmp_path, monkeypatch):
    video = tmp_path / "loop.mp4"
    video.write_bytes(b"not decoded here")
    cmd = _main_command(tmp_path, monkeypatch, custom_bg_path=str(video))

    i = cmd.index("-stream_loop")
    assert cmd[i : i + 4] == ["-stream_loop", "-1", "-i", str(video)]
    graph = _graph(cmd)
    assert graph.startswith(
        "[0:v]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=60[bg];"
    )


def test_a_custom_image_is_scaled_once_and_looped_at_60_fps(tmp_path, monkeypatch):
    run, calls = _fake_run(succeed=True)
    monkeypatch.setattr(vr.subprocess, "run", run)
    image = tmp_path / "poster.webp"
    image.write_bytes(b"image")

    cmd = _main_command(tmp_path, monkeypatch, custom_bg_path=str(image))

    assert len(calls) == 1
    assert calls[0][calls[0].index("-vf") + 1] == (
        "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080"
    )
    prepared = calls[0][-1]
    i = cmd.index("-loop")
    assert cmd[i : i + 6] == ["-loop", "1", "-framerate", "60", "-i", prepared]
    assert _graph(cmd).startswith("[0:v]null[bg];[bg]subtitles=")
    assert not Path(prepared).parent.exists()  # the scratch folder is cleaned up


def test_a_failed_background_step_falls_back_to_processing_every_frame(tmp_path, monkeypatch):
    run, calls = _fake_run(succeed=False)
    monkeypatch.setattr(vr.subprocess, "run", run)
    thumbnail = tmp_path / "thumb.jpg"
    thumbnail.write_bytes(b"jpeg")

    cmd = _main_command(tmp_path, monkeypatch, thumbnail_path=str(thumbnail))

    assert len(calls) == 1
    i = cmd.index("-loop")
    assert cmd[i : i + 6] == ["-loop", "1", "-framerate", "60", "-i", str(thumbnail)]
    assert f",{vr.THUMBNAIL_LOOK}[bg];" in _graph(cmd)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed")
def test_a_thumbnail_is_blurred_once_and_the_lyrics_render_at_60_fps(tmp_path, monkeypatch):
    thumbnail = tmp_path / "thumb.jpg"
    ffmpeg = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi"]
    subprocess.run(
        [*ffmpeg, "-i", "testsrc2=s=640x360", "-frames:v", "1", str(thumbnail)], check=True
    )
    audio, ass = _inputs(tmp_path)
    commands: list[list[str]] = []
    real_popen = subprocess.Popen

    def recording_popen(cmd, *args, **kwargs):
        commands.append(list(cmd))
        return real_popen(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", recording_popen)
    out = VideoRenderer(output_dir=tmp_path).render_video(
        str(audio), str(ass), tmp_path / "out.mp4", thumbnail_path=str(thumbnail), duration=1.0
    )

    prepare, main = commands[0], commands[-1]
    assert "-frames:v" in prepare and vr.THUMBNAIL_LOOK in " ".join(prepare)
    assert "boxblur" not in _graph(main)
    i = main.index("-loop")
    assert main[i : i + 4] == ["-loop", "1", "-framerate", "60"]
    ffprobe = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries"]
    probe = subprocess.run(
        [*ffprobe, "stream=avg_frame_rate,width,height", "-of", "json", out],
        capture_output=True,
        text=True,
        check=True,
    )
    stream = json.loads(probe.stdout)["streams"][0]
    assert (stream["width"], stream["height"], stream["avg_frame_rate"]) == (1920, 1080, "60/1")
    assert not Path(prepare[-1]).parent.exists()


# --- Generated styles -------------------------------------------------------------------------

PALETTE = ["#fbbf24", "#f472b6", "#5eead4"]


def _thumbnail(tmp_path: Path) -> Path:
    thumbnail = tmp_path / "thumb.jpg"
    thumbnail.write_bytes(b"jpeg")
    return thumbnail


def test_the_motion_numbers_are_the_ones_the_stage_imports():
    """The stage preview imports the same file (as @shared/background_motion.json)."""
    shared = json.loads((SHARED_DIR / "background_motion.json").read_text(encoding="utf-8"))
    assert shared == sb.BACKGROUND_MOTION
    assert {"drift", "aurora", "scrim", "spectrum"} <= set(shared)


@pytest.mark.parametrize(
    ("aspect", "size", "small"),
    [("16:9", "1920:1080", "480x270"), ("9:16", "1080:1920", "270x480")],
)
def test_aurora_is_drawn_small_from_inline_sources_and_upscaled(
    tmp_path, monkeypatch, aspect, size, small
):
    cmd = _main_command(
        tmp_path,
        monkeypatch,
        aspect_ratio=aspect,
        background_style="aurora",
        background_palette=PALETTE,
        background_color="#0b0b12",
    )

    assert f"color=c=0x0b0b12:s={small}:r=60" in cmd
    assert "-loop" not in cmd and "-stream_loop" not in cmd
    graph = _graph(cmd)
    assert graph.count("overlay=x=") == 3
    assert "eval=frame:format=rgb" in graph
    assert "geq=r=251:g=191:b=36:" in graph  # the first orb takes the sung colour
    assert "geq=r=244:g=114:b=182:" in graph
    assert f"scale={size}:flags=bicubic[bg];[bg]subtitles=" in graph
    assert cmd[cmd.index("-r") + 1] == "60"


def test_the_spectrum_listens_to_the_song_and_stays_low(tmp_path, monkeypatch):
    cmd = _main_command(
        tmp_path,
        monkeypatch,
        background_style="spectrum",
        background_palette=PALETTE,
        background_color="#0b0b12",
        include_visualizer=True,
    )

    graph = _graph(cmd)
    assert graph.startswith("[1:a]showcqt=s=480x162:r=60:")
    assert "pad=480:270:0:108[bars]" in graph  # the glow never rises above 60% of the frame
    assert "[0:v]trim=end_frame=1,format=gbrp,geq=r='clip((251+(-7)*X/W)-11,0,255)'" in graph
    assert "lutrgb=r='11+val':g='11+val':b='18+val'" in graph
    assert "[1:a]showfreqs=" in graph  # the optional visualizer still has the audio too
    maps = [cmd[i + 1] for i, part in enumerate(cmd) if part == "-map"]
    assert maps == ["[v]", "1:a"]


def test_light_presets_get_a_white_scrim_and_darkening_bars(tmp_path, monkeypatch):
    light = _graph(
        _main_command(
            tmp_path,
            monkeypatch,
            background_style="spectrum",
            background_palette=["#dc2626", "#f59e0b", "#1f2937"],
            background_color="#f4f4f0",
            background_tone="light",
        )
    )
    assert "lutrgb=r='244-val':g='244-val':b='240-val'" in light
    assert "geq=r=255:g=255:b=255:a=" in light

    for tone in (None, "dark", "LIGHT", ["light"]):
        graph = _graph(
            _main_command(tmp_path, monkeypatch, background_style="aurora", background_tone=tone)
        )
        assert "geq=r=0:g=0:b=0:a=" in graph


def test_drifting_art_is_prepared_once_at_the_overscan_size_and_panned(tmp_path, monkeypatch):
    run, calls = _fake_run(succeed=True)
    monkeypatch.setattr(vr.subprocess, "run", run)

    cmd = _main_command(
        tmp_path, monkeypatch, thumbnail_path=str(_thumbnail(tmp_path)), background_style="drift"
    )

    assert len(calls) == 1
    assert calls[0][calls[0].index("-vf") + 1] == (
        f"scale=2150:1210:force_original_aspect_ratio=increase,crop=2150:1210,{vr.THUMBNAIL_LOOK}"
    )
    prepared = calls[0][-1]
    i = cmd.index("-framerate")
    assert cmd[i - 1] != "1" and "-loop" not in cmd  # decoded once, repeated by the loop filter
    assert cmd[i : i + 4] == ["-framerate", "60", "-i", prepared]
    assert _graph(cmd).startswith(
        "[0:v]loop=loop=-1:size=1,fps=60,crop=1920:1080:"
        "x='(iw-ow)/2*(1+sin(2*PI*t/37))':y='(ih-oh)/2*(1+sin(2*PI*t/23+1.3))'[bg];"
    )


def test_a_failed_drift_step_pans_the_per_frame_chain(tmp_path, monkeypatch):
    run, calls = _fake_run(succeed=False)
    monkeypatch.setattr(vr.subprocess, "run", run)
    thumbnail = _thumbnail(tmp_path)

    cmd = _main_command(
        tmp_path,
        monkeypatch,
        thumbnail_path=str(thumbnail),
        background_style="drift",
        aspect_ratio="9:16",
    )

    assert len(calls) == 1
    i = cmd.index("-loop")
    assert cmd[i : i + 6] == ["-loop", "1", "-framerate", "60", "-i", str(thumbnail)]
    assert f"crop=1210:2150,{vr.THUMBNAIL_LOOK},crop=1080:1920:x=" in _graph(cmd)


@pytest.mark.parametrize("style", ["artwork", "drift", "color"])
def test_without_cover_art_the_art_styles_show_the_stage_colour(tmp_path, monkeypatch, style):
    cmd = _main_command(tmp_path, monkeypatch, background_style=style, background_color="#0b0b12")

    assert "color=c=0x0b0b12:s=1920x1080:r=60" in cmd
    assert _graph(cmd).startswith("[0:v]null[bg];[bg]subtitles=")


def test_the_plain_style_ignores_the_cover_art(tmp_path, monkeypatch):
    run, calls = _fake_run(succeed=True)
    monkeypatch.setattr(vr.subprocess, "run", run)

    cmd = _main_command(
        tmp_path,
        monkeypatch,
        thumbnail_path=str(_thumbnail(tmp_path)),
        background_style="color",
        background_color="#0b0b12",
    )

    assert calls == []
    assert "color=c=0x0b0b12:s=1920x1080:r=60" in cmd


@pytest.mark.parametrize("style", ["aurora", "spectrum", "drift", "color"])
def test_an_uploaded_background_still_wins_over_any_style(tmp_path, monkeypatch, style):
    video = tmp_path / "loop.mp4"
    video.write_bytes(b"not decoded here")

    cmd = _main_command(tmp_path, monkeypatch, custom_bg_path=str(video), background_style=style)

    i = cmd.index("-stream_loop")
    assert cmd[i : i + 4] == ["-stream_loop", "-1", "-i", str(video)]


def test_the_default_style_renders_exactly_as_before(tmp_path, monkeypatch):
    run, _ = _fake_run(succeed=True)
    monkeypatch.setattr(vr.subprocess, "run", run)
    thumbnail = _thumbnail(tmp_path)

    def command(**style) -> list[str]:
        cmd = _main_command(tmp_path, monkeypatch, thumbnail_path=str(thumbnail), **style)
        return [re.sub(r"karaoke-render-[^/]+", "SCRATCH", part) for part in cmd]

    baseline = command()
    assert baseline[baseline.index("-loop") : baseline.index("-loop") + 4] == [
        "-loop",
        "1",
        "-framerate",
        "60",
    ]
    for style in ("artwork", "unknown", None, ["aurora"], {"style": "aurora"}):
        assert command(background_style=style) == baseline


@pytest.mark.parametrize(
    "palette",
    [None, "#fbbf24", ["#000000[x];movie=/etc/passwd", "red", 7], {"0": "#ffffff"}, []],
)
def test_palette_input_never_reaches_the_filter_graph(tmp_path, monkeypatch, palette):
    graph = _graph(
        _main_command(tmp_path, monkeypatch, background_style="aurora", background_palette=palette)
    )

    assert "movie" not in graph and "passwd" not in graph
    assert "geq=r=251:g=191:b=36:" in graph  # the default palette fills every gap


def test_palette_entries_fall_back_one_by_one():
    assert sb.normalize_palette(["#ABCDEF", "123456", "nope"]) == (
        (171, 205, 239),
        (18, 52, 86),
        (94, 234, 212),
    )
    assert sb.normalize_style("aurora") == "aurora"
    assert sb.normalize_style("Aurora") == sb.DEFAULT_BACKGROUND_STYLE


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed")
@pytest.mark.parametrize(
    ("style", "aspect", "size"),
    [
        ("drift", "16:9", (1920, 1080)),
        ("aurora", "16:9", (1920, 1080)),
        ("spectrum", "16:9", (1920, 1080)),
        ("drift", "9:16", (1080, 1920)),
        ("aurora", "9:16", (1080, 1920)),
        ("spectrum", "9:16", (1080, 1920)),
    ],
)
def test_each_generated_style_renders_at_60_fps(tmp_path, style, aspect, size):
    thumbnail = tmp_path / "thumb.jpg"
    ffmpeg = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi"]
    subprocess.run(
        [*ffmpeg, "-i", "testsrc2=s=640x360", "-frames:v", "1", str(thumbnail)], check=True
    )
    audio, ass = _inputs(tmp_path)

    out = VideoRenderer(output_dir=tmp_path).render_video(
        str(audio),
        str(ass),
        tmp_path / "out.mp4",
        thumbnail_path=str(thumbnail),
        aspect_ratio=aspect,
        duration=1.0,
        background_style=style,
        background_palette=PALETTE,
        background_color="#0b0b12",
    )

    ffprobe = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries"]
    probe = subprocess.run(
        [*ffprobe, "stream=avg_frame_rate,width,height:format=duration", "-of", "json", out],
        capture_output=True,
        text=True,
        check=True,
    )
    info = json.loads(probe.stdout)
    stream = info["streams"][0]
    assert (stream["width"], stream["height"], stream["avg_frame_rate"]) == (*size, "60/1")
    assert float(info["format"]["duration"]) == pytest.approx(1.0, abs=0.1)
