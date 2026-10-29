"""Export backgrounds: genuine 60 fps for every kind, still images processed once, the preset."""

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.services import video_renderer as vr
from backend.services.video_renderer import VideoRenderer

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
