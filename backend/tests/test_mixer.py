import os
import subprocess
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf

from backend.services.audio_mixer import AudioMixer
from backend.services.video_renderer import VideoRenderer


def test_audio_mixer_and_video_render(tmp_path):
    """Verifies baseline mixer and video renderer integration."""
    sr = 44100
    duration = 3.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    sine_inst = 0.5 * np.sin(2 * np.pi * 440 * t)
    sine_voc = 0.3 * np.sin(2 * np.pi * 880 * t)

    inst_wav = tmp_path / "inst.wav"
    voc_wav = tmp_path / "voc.wav"
    sf.write(str(inst_wav), sine_inst, sr)
    sf.write(str(voc_wav), sine_voc, sr)

    mixer = AudioMixer(output_dir=tmp_path)
    mixed_path = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        vocals_path=str(voc_wav),
        semitones=2,
        guide_volume=0.2,
        output_filename="test_mixed.wav",
    )
    assert os.path.exists(mixed_path)
    mixed_data, mixed_sr = sf.read(mixed_path)
    assert mixed_sr == 44100
    assert len(mixed_data) > 0

    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "test.ass"
    renderer.generate_ass_subtitles(
        lines=[
            {
                "id": 0,
                "text": "Hello Karaoke",
                "start_time": 0.5,
                "end_time": 2.5,
                "words": [
                    {"word": "Hello", "start_time": 0.5, "end_time": 1.5},
                    {"word": "Karaoke", "start_time": 1.5, "end_time": 2.5},
                ],
            }
        ],
        output_ass_path=ass_path,
    )

    mp4_out = tmp_path / "test_karaoke.mp4"
    rendered_file = renderer.render_video(
        audio_path=mixed_path,
        ass_subtitles_path=str(ass_path),
        output_mp4_path=mp4_out,
        title="Test Track",
        artist="Test Artist",
    )

    assert os.path.exists(rendered_file)
    assert os.path.getsize(rendered_file) > 1000

    probe_cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,r_frame_rate",
        "-of",
        "csv=s=x:p=0",
        str(rendered_file),
    ]
    probe_res = subprocess.run(probe_cmd, stdout=subprocess.PIPE, text=True)
    assert "1920x1080" in probe_res.stdout


def test_mix_and_shift_instrumental_passthrough(tmp_path):
    """Verifies passthrough mix without pitch shift or guide vocals."""
    sr = 44100
    duration = 1.5
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.4 * np.sin(2 * np.pi * 440 * t)

    inst_wav = tmp_path / "inst_passthrough.wav"
    sf.write(str(inst_wav), sine, sr)

    mixer = AudioMixer(output_dir=tmp_path)
    out_path = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        semitones=0,
        guide_volume=0.0,
        output_filename="out_passthrough.wav",
    )
    assert os.path.exists(out_path)
    data, out_sr = sf.read(out_path)
    assert out_sr == 44100
    assert len(data) > 0


def test_mix_and_shift_positive_and_negative_pitch(tmp_path):
    """Verifies pitch shift transformations in positive and negative semitone ranges."""
    sr = 44100
    duration = 1.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * 500 * t)

    inst_wav = tmp_path / "inst_pitch.wav"
    sf.write(str(inst_wav), sine, sr)

    mixer = AudioMixer(output_dir=tmp_path)

    # Shift up 3 semitones
    up_path = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        semitones=3,
        output_filename="up_3.wav",
    )
    assert os.path.exists(up_path)

    # Shift down 4 semitones
    down_path = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        semitones=-4,
        output_filename="down_4.wav",
    )
    assert os.path.exists(down_path)


def test_mix_and_shift_semitones_clamping(tmp_path):
    """Verifies out-of-range semitones are clamped to [-12, 12] avoiding atempo crash."""
    sr = 44100
    duration = 1.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * 440 * t)

    inst_wav = tmp_path / "inst_clamp.wav"
    sf.write(str(inst_wav), sine, sr)

    mixer = AudioMixer(output_dir=tmp_path)

    # Over upper boundary (24 -> clamped to 12)
    clamped_pos = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        semitones=24,
        output_filename="clamped_pos.wav",
    )
    assert os.path.exists(clamped_pos)

    # Below lower boundary (-36 -> clamped to -12)
    clamped_neg = mixer.mix_and_shift(
        instrumental_path=str(inst_wav),
        semitones=-36,
        output_filename="clamped_neg.wav",
    )
    assert os.path.exists(clamped_neg)


def test_mix_and_shift_guide_vocal_blend(tmp_path):
    """Verifies multi-stream amix filtergraph blending guide vocals with instrumental."""
    sr = 44100
    t = np.linspace(0, 1.5, int(sr * 1.5), endpoint=False)
    inst = 0.5 * np.sin(2 * np.pi * 330 * t)
    voc = 0.3 * np.sin(2 * np.pi * 660 * t)

    inst_path = tmp_path / "inst_blend.wav"
    voc_path = tmp_path / "voc_blend.wav"
    sf.write(str(inst_path), inst, sr)
    sf.write(str(voc_path), voc, sr)

    mixer = AudioMixer(output_dir=tmp_path)
    blended = mixer.mix_and_shift(
        instrumental_path=str(inst_path),
        vocals_path=str(voc_path),
        semitones=-2,
        guide_volume=0.35,
        output_filename="blended.wav",
    )
    assert os.path.exists(blended)
    data, out_sr = sf.read(blended)
    assert out_sr == 44100
    assert len(data) > 0


def test_mix_and_shift_dynamic_sample_rate(tmp_path):
    """Verifies input sample rates other than 44100Hz (e.g. 48000Hz) are inspected and pitch shifted accurately."""
    sr_48k = 48000
    t = np.linspace(0, 1.0, sr_48k, endpoint=False)
    sine = 0.4 * np.sin(2 * np.pi * 440 * t)

    inst_48k = tmp_path / "inst_48k.wav"
    sf.write(str(inst_48k), sine, sr_48k)

    mixer = AudioMixer(output_dir=tmp_path)
    detected_rate = mixer._get_sample_rate(str(inst_48k))
    assert detected_rate == 48000

    out_path = mixer.mix_and_shift(
        instrumental_path=str(inst_48k),
        semitones=2,
        output_filename="shifted_48k.wav",
    )
    assert os.path.exists(out_path)
    data, out_sr = sf.read(out_path)
    assert out_sr == 44100
    assert len(data) > 0


def test_mix_and_shift_missing_instrumental_raises(tmp_path):
    """Verifies FileNotFoundError when instrumental file does not exist."""
    mixer = AudioMixer(output_dir=tmp_path)
    with pytest.raises(FileNotFoundError, match="Instrumental audio file not found"):
        mixer.mix_and_shift(
            instrumental_path=str(tmp_path / "does_not_exist.wav"),
            output_filename="wont_exist.wav",
        )


def test_mix_and_shift_missing_vocals_ignored(tmp_path):
    """Verifies that non-existent vocals_path safely falls back to instrumental only."""
    sr = 44100
    sine = 0.5 * np.sin(2 * np.pi * 440 * np.linspace(0, 1.0, sr, endpoint=False))
    inst_path = tmp_path / "inst_safe.wav"
    sf.write(str(inst_path), sine, sr)

    mixer = AudioMixer(output_dir=tmp_path)
    out_path = mixer.mix_and_shift(
        instrumental_path=str(inst_path),
        vocals_path=str(tmp_path / "missing_vocals.wav"),
        guide_volume=0.5,
        output_filename="safe_master.wav",
    )
    assert os.path.exists(out_path)


def test_mix_and_shift_ffmpeg_failure_and_cleanup(tmp_path):
    """Verifies that FFmpeg failures remove temporary files and raise RuntimeError with actionable error."""
    inst_path = tmp_path / "corrupt_inst.wav"
    # Write corrupt non-audio data
    with open(inst_path, "wb") as f:
        f.write(b"NOT_A_VALID_WAV_FILE_HEADER")

    mixer = AudioMixer(output_dir=tmp_path)
    with pytest.raises(RuntimeError, match="FFmpeg audio mixing failed"):
        mixer.mix_and_shift(
            instrumental_path=str(inst_path),
            semitones=1,
            output_filename="should_fail.wav",
        )

    # Verify no leaked temporary files in output directory
    leftover_tmps = list(tmp_path.glob("*.tmp*.wav"))
    assert len(leftover_tmps) == 0


def test_mix_and_shift_timeout_cleanup(tmp_path):
    """Verifies subprocess timeout triggers process cleanup and raises RuntimeError."""
    sr = 44100
    inst_path = tmp_path / "inst_timeout.wav"
    sf.write(str(inst_path), np.zeros(sr), sr)

    mixer = AudioMixer(output_dir=tmp_path)

    # Mock subprocess.run to raise TimeoutExpired
    with (
        patch(
            "subprocess.run",
            side_effect=subprocess.TimeoutExpired(cmd=["ffmpeg"], timeout=0.1),
        ),
        pytest.raises(RuntimeError, match="timed out"),
    ):
        mixer.mix_and_shift(
            instrumental_path=str(inst_path),
            timeout=1,
            output_filename="timeout.wav",
        )


def test_audio_mixer_create_mix(tmp_path):
    """Verifies high-level create_mix interface dictionary contract matching PROJECT.md."""
    sr = 44100
    inst_path = tmp_path / "proj_inst.wav"
    voc_path = tmp_path / "proj_voc.wav"
    sf.write(str(inst_path), np.zeros(sr), sr)
    sf.write(str(voc_path), np.zeros(sr), sr)

    project = {
        "id": "proj_123",
        "track_id": "proj_123",
        "instrumental_path": str(inst_path),
        "vocals_path": str(voc_path),
    }

    mixer = AudioMixer(output_dir=tmp_path)
    master_path = mixer.create_mix(project, semitones=1, guide_volume=0.2)
    assert os.path.exists(master_path)
    assert "proj_123_master.wav" in master_path
