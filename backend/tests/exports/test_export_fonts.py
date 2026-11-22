"""Exported videos draw each look's lyrics in the look's own typeface: every font a look
names is bundled with its licence, and libass picks that file when FFmpeg burns the subtitles
in (a name it cannot match is answered by a system font, and nothing says so)."""

import re
import shutil
import subprocess

import pytest

from backend.services import font_metrics
from backend.services.ass_draw import LookStyle
from backend.services.ass_generator import export_fonts, generate_ass_content
from backend.services.ass_look import look_faces
from backend.services.stage_looks import ASPECTS, LEGACY_IDS, LOOKS
from backend.services.video_renderer import FONTS_DIR, _escape_filter_path

LINE = [
    {
        "text": "Hello (there)",
        "start_time": 0.0,
        "end_time": 0.4,
        "singer": "singer2",
        # Plain letters: a letter a face lacks (Atkinson Hyperlegible has no "ō") is drawn by a
        # system font, glyph by glyph, which is not what this file checks
        "romaji": "haro",
    }
]


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_every_font_a_look_names_is_bundled_with_its_licence(look_id):
    for aspect in ASPECTS:
        for face in look_faces(LookStyle.of(look_id, aspect)):
            file = font_metrics.face(face)["file"]
            assert (FONTS_DIR / file).is_file(), file
            family = file.split("-")[0]
            assert (FONTS_DIR.parent / "licenses" / f"{family}-OFL.txt").is_file(), family


def test_a_request_names_the_font_files_its_look_needs():
    assert export_fonts({"theme_id": "cinema"}) == ["Jost-Medium.ttf"]
    assert export_fonts(theme_id="prompter") == ["AtkinsonHyperlegible-Bold.ttf"]
    assert export_fonts({"theme_id": "ktv"}, "9:16") == ["MPLUSRounded1c-ExtraBold.ttf"]
    assert set(export_fonts({})) == {"SofiaSansExtraCondensed-Black.ttf", "SofiaSans-Bold.ttf"}
    # A replaced preset's id names its look's fonts
    assert export_fonts({"theme_id": "clean_paper"}) == export_fonts({"theme_id": "songbook"})


def test_the_subtitle_file_names_its_fonts_for_whoever_plays_it_elsewhere():
    text = generate_ass_content(LINE, theme_id="songbook")
    assert "; Fonts: Newsreader Medium" in text
    assert "Style: newsreader_medium,Newsreader Medium," in text


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
@pytest.mark.parametrize("theme_id", [*LOOKS, *LEGACY_IDS])
def test_libass_draws_each_look_with_its_bundled_files(tmp_path, theme_id):
    subtitles = tmp_path / "look.ass"
    text = generate_ass_content(
        LINE, theme_id=theme_id, title="Song", song_duration=30.0, part_names={"singer2": "Theo"}
    )
    subtitles.write_text(text, encoding="utf-8")
    vf = f"subtitles='{_escape_filter_path(subtitles)}':fontsdir='{_escape_filter_path(FONTS_DIR)}'"
    black = "color=c=black:s=320x180:d=0.5"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "verbose", "-f", "lavfi", "-i", black]
    result = subprocess.run(
        [*command, "-vf", vf, "-f", "null", "-"], capture_output=True, text=True, timeout=60
    )
    picks = re.findall(r"fontselect: \(([^,]+), \d+, \d+\) -> ([^,]+),", result.stderr)
    if not picks:
        pytest.skip("this FFmpeg has no subtitles filter, or its libass logs no font selection")
    bundled = {
        font_metrics.face(face)["ass_family"]: {
            font_metrics.face(other)["postscript"]
            for other in font_metrics._table()["faces"]
            if font_metrics.face(other)["ass_family"] == font_metrics.face(face)["ass_family"]
        }
        for face in font_metrics._table()["faces"]
    }
    asked = {family for family, _chosen in picks if family in bundled}
    look = LOOKS.get(theme_id) or LOOKS[LEGACY_IDS[theme_id]["look"]]
    lyric_face = look["frames"]["16:9"]["lyric"]["face"]
    assert font_metrics.face(lyric_face)["ass_family"] in asked
    for family, chosen in picks:
        if family in bundled:
            assert chosen in bundled[family], f"{family} was answered by {chosen}"
