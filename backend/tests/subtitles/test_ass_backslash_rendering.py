"""A backslash in a lyric is drawn once and never acts as an ASS escape: "\\N" in a title does
not break the line and a word ending in a backslash does not swallow the next word's sweep
tag. The drawing is measured with FFmpeg's libass, which is what the export uses."""

import shutil
import subprocess

import numpy as np
import pytest

from backend.services.ass_generator import BACKSLASH_GUARD, escape_ass_text, generate_ass_content

HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 640
PlayResY: 240

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,40,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,"""


def _has_libass() -> bool:
    if shutil.which("ffmpeg") is None:
        return False
    filters = subprocess.run(
        ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, timeout=30
    )
    return " subtitles " in filters.stdout


needs_libass = pytest.mark.skipif(not _has_libass(), reason="needs FFmpeg with libass")


def _drawn_size(tmp_path, event_text: str) -> tuple[int, int]:
    """Width and height in pixels of what libass draws for one Dialogue text."""
    ass = tmp_path / "line.ass"
    ass.write_text(HEADER + event_text + "\n", encoding="utf-8")
    black = ["-f", "lavfi", "-i", "color=c=black:s=640x240:d=0.1"]
    one_gray_frame = ["-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    frame = subprocess.run(
        ["ffmpeg", "-v", "error", *black, "-vf", f"subtitles={ass}", *one_gray_frame],
        capture_output=True,
        timeout=60,
        check=True,
    )
    image = np.frombuffer(frame.stdout, dtype=np.uint8).reshape(240, 640)
    rows, columns = np.nonzero(image > 64)
    assert len(columns), f"nothing was drawn for {event_text!r}"
    return int(columns.max() - columns.min() + 1), int(rows.max() - rows.min() + 1)


def test_a_backslash_is_written_once_with_the_guard_after_it():
    assert escape_ass_text("AC\\DC") == f"AC\\{BACKSLASH_GUARD}DC"
    assert escape_ass_text("a\\\\b") == f"a\\{BACKSLASH_GUARD}\\{BACKSLASH_GUARD}b"
    assert escape_ass_text("\\{x}") == f"\\{BACKSLASH_GUARD}\\{{x\\}}"


def test_a_word_ending_in_a_backslash_leaves_the_next_sweep_tag_alone():
    line = {
        "text": "one\\ two",
        "start_time": 0.0,
        "end_time": 2.0,
        "words": [
            {"word": "one\\", "start_time": 0.0, "end_time": 1.0},
            {"word": "two", "start_time": 1.0, "end_time": 2.0},
        ],
    }

    content = generate_ass_content([line], include_countdown=False)

    assert "\\{\\k" not in content  # "\{" is libass's escape for a drawn brace


@needs_libass
def test_libass_draws_one_backslash_for_one_backslash(tmp_path):
    drawn_as_is, _ = _drawn_size(tmp_path, "AC\\DC")  # no escape: libass draws it literally
    doubled, _ = _drawn_size(tmp_path, "AC\\\\DC")

    escaped, _ = _drawn_size(tmp_path, escape_ass_text("AC\\DC"))

    assert doubled > drawn_as_is  # what doubling the backslash used to export
    assert escaped == drawn_as_is


@needs_libass
@pytest.mark.parametrize("sequence", ["\\N", "\\n", "\\h"])
def test_libass_draws_an_escape_sequence_in_a_lyric_as_its_two_characters(tmp_path, sequence):
    letter = sequence[1]
    # The same characters with a slash, which nothing treats as an escape
    expected_width, expected_height = _drawn_size(tmp_path, f"AB/{letter}CD")

    width, height = _drawn_size(tmp_path, escape_ass_text(f"AB{sequence}CD"))

    assert height < expected_height * 1.5  # still one line
    assert abs(width - expected_width) <= 4


@needs_libass
def test_libass_still_draws_escaped_braces(tmp_path):
    hidden, _ = _drawn_size(tmp_path, "AB{CD}")  # an override block: only "AB" is drawn

    shown, _ = _drawn_size(tmp_path, escape_ass_text("AB{CD}"))

    assert shown > hidden * 2
