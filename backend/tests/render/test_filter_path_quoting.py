"""Paths handed to FFmpeg's subtitles filter are quoted so that a data or install folder with
an apostrophe or a colon in its name still renders."""

import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.services.video_renderer import VideoRenderer, _escape_filter_path

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

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed")


def test_a_plain_path_is_left_alone():
    assert _escape_filter_path("/data/output/song.ass") == "/data/output/song.ass"


def test_an_apostrophe_closes_and_reopens_the_quotes_around_the_value():
    # Inside '...' FFmpeg takes a backslash literally, so the quote itself has to sit outside
    assert _escape_filter_path("/home/o'neil/song.ass") == "/home/o\\'\\''neil/song.ass"


@needs_ffmpeg
@pytest.mark.parametrize("folder", ["o'neil's karaoke", "take: two", "it's 10:30"])
def test_ffmpeg_reads_subtitles_and_fonts_from_a_folder_with_such_a_name(tmp_path, folder):
    home = tmp_path / folder
    home.mkdir()
    ass = home / "song.ass"
    ass.write_text(SIMPLE_ASS, encoding="utf-8")
    quoted = f"subtitles='{_escape_filter_path(ass)}':fontsdir='{_escape_filter_path(home)}'"

    black = ["-f", "lavfi", "-i", "color=c=black:s=320x180:d=0.2"]
    graph = f"[0:v]null[bg];[bg]{quoted}[v]"
    output = ["-filter_complex", graph, "-map", "[v]", "-f", "null", "-"]
    result = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", *black, *output],
        capture_output=True,
        text=True,
        timeout=60,
    )

    assert result.returncode == 0, result.stderr


@needs_ffmpeg
def test_a_song_renders_from_a_data_folder_with_an_apostrophe(tmp_path):
    data = tmp_path / "joe's karaoke"
    data.mkdir()
    audio = data / "song.wav"
    sf.write(str(audio), np.zeros((22050, 2), dtype="float32"), 44100)
    ass = data / "song.ass"
    ass.write_text(SIMPLE_ASS, encoding="utf-8")

    out = VideoRenderer(output_dir=data).render_video(
        str(audio), str(ass), data / "out.mp4", duration=0.5
    )

    assert Path(out).stat().st_size > 0
