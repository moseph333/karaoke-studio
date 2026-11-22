"""The stage fonts and the width table both renderers size lyric lines from."""

import pytest

from backend.services import font_metrics
from backend.shared_assets import load
from backend.tools import font_metrics as tool

LICENSES = tool.FONTS_DIR.parent / "licenses"


def test_the_shared_table_is_what_the_bundled_fonts_say():
    """A font file replaced without running the tool would leave the stage and the video
    measuring text that is no longer what is drawn."""
    assert load("stage_font_metrics") == tool.build_metrics()


def test_the_written_file_is_the_tools_output():
    written = tool.METRICS_PATH.read_text(encoding="utf-8")
    assert written == tool.metrics_json(tool.build_metrics())


@pytest.mark.parametrize("face_id", list(tool.FACES))
def test_each_face_has_its_font_file_and_its_licence(face_id):
    file = tool.FACES[face_id][0]
    assert (tool.FONTS_DIR / file).is_file()
    family = file.split("-")[0]
    licence = LICENSES / f"{family}-OFL.txt"
    assert licence.is_file(), f"{file} needs {licence.name}"
    assert "SIL Open Font License" in licence.read_text(encoding="utf-8")


@pytest.mark.parametrize("face_id", list(tool.FACES))
def test_each_face_is_named_the_way_libass_finds_a_static_cut(face_id):
    """libass matches a font by its legacy family name: a weight that is not Bold has the
    weight in that name, and asking for bold or italic on top would fake them."""
    face = font_metrics.face(face_id)
    read = tool.read_face(tool.FONTS_DIR / face["file"])
    assert face["ass_family"] == read["family"]
    assert face["ass_bold"] is read["bold"]
    assert face["ass_italic"] is read["italic"]
    if read["weight"] not in (400, 700):
        assert not read["bold"]
        assert face["ass_family"] != face["css_family"]


def test_the_two_newsreader_cuts_share_a_family_so_italics_are_real():
    upright = font_metrics.face("newsreader_medium")
    italic = font_metrics.face("newsreader_medium_italic")
    assert upright["ass_family"] == italic["ass_family"]
    assert italic["ass_italic"] and not upright["ass_italic"]


def test_a_cell_is_taller_than_an_em_in_every_face():
    for face_id in tool.FACES:
        face = font_metrics.face(face_id)
        assert face["ass_size"] == pytest.approx(face["ascent"] + face["descent"], abs=1e-3)
        assert 1.1 < face["ass_size"] < 1.6
        assert 0.6 < face["cap_height"] < 0.8


def test_text_width_adds_up_advances_and_tracking():
    face = font_metrics.face("jost_medium")
    advances = face["advances"]
    expected = (advances["H"] + advances["i"]) / 1000
    assert font_metrics.text_width("jost_medium", "Hi") == pytest.approx(expected)
    assert font_metrics.text_width("jost_medium", "Hi", 0.1) == pytest.approx(expected + 0.2)
    assert font_metrics.text_width("jost_medium", "") == 0


def test_characters_a_face_lacks_follow_the_tables_rules():
    table = load("stage_font_metrics")
    assert font_metrics.char_advance("jost_medium", "夜") == table["wide_advance"]
    assert font_metrics.char_advance("jost_medium", "한") == table["wide_advance"]
    assert font_metrics.char_advance("jost_medium", "́") == 0
    assert font_metrics.char_advance("jost_medium", "⁠") == 0
    assert font_metrics.char_advance("atkinson_bold", "я") == table["fallback_advance"]


def test_the_ktv_face_draws_japanese_itself():
    """M PLUS Rounded 1c has kana and kanji, so KTV's Japanese lyrics are in the look's face."""
    read = tool.read_face(tool.FONTS_DIR / font_metrics.face("mplus_rounded_extrabold")["file"])
    assert read["advances"]["A"] > 0
    data = (tool.FONTS_DIR / "MPLUSRounded1c-ExtraBold.ttf").read_bytes()
    cmap = tool._cmap(tool._tables(data)["cmap"])
    assert all(ord(char) in cmap for char in "夜のバスに乗って")
