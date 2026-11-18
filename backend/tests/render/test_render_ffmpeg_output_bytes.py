"""The local render reads FFmpeg's output as text. Bytes that are not UTF-8 (a file name or
tag FFmpeg echoes back) must not stop the render, whatever the server's locale."""

import subprocess
import sys

import pytest

from backend.services.video_renderer import VideoRenderer

_NOISY = (
    "import sys;"
    "sys.stdout.buffer.write(b'out_time_ms=500000\\n\\xff\\xfe progress\\n');"
    "sys.stderr.buffer.write(b'title: \\xe9\\xff\\n');"
    "sys.exit({code})"
)


def _render_with_fake_ffmpeg(tmp_path, monkeypatch, exit_code):
    ass = tmp_path / "song.ass"
    ass.write_text("[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n", encoding="utf-8")
    audio = tmp_path / "song.wav"
    audio.write_bytes(b"RIFF")
    real_popen = subprocess.Popen
    seen = {}

    def fake_ffmpeg(cmd, *args, **kwargs):
        seen.update(kwargs)
        if exit_code == 0:
            open(cmd[-1], "wb").close()  # the video FFmpeg would have written
        return real_popen([sys.executable, "-c", _NOISY.format(code=exit_code)], *args, **kwargs)

    monkeypatch.setattr("subprocess.Popen", fake_ffmpeg)
    VideoRenderer(output_dir=tmp_path).render_video(
        audio_path=str(audio),
        ass_subtitles_path=str(ass),
        output_mp4_path=tmp_path / "song.mp4",
        duration=1.0,
    )
    return seen


def test_bytes_that_are_not_utf8_do_not_stop_the_render(tmp_path, monkeypatch):
    seen = _render_with_fake_ffmpeg(tmp_path, monkeypatch, exit_code=0)
    assert seen["encoding"] == "utf-8"
    assert seen["errors"] == "replace"


def test_a_failed_render_reports_ffmpegs_message_with_the_odd_bytes_replaced(tmp_path, monkeypatch):
    with pytest.raises(RuntimeError, match="FFmpeg video render error: title: ") as raised:
        _render_with_fake_ffmpeg(tmp_path, monkeypatch, exit_code=1)
    assert "�" in str(raised.value)
