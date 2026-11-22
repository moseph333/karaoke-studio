"""What the looks rely on libass to do, checked on real frames, so a libass that behaves
differently fails here by name instead of as a video that looks wrong."""

import re

import pytest

from backend.services import font_metrics
from backend.services.ass_draw import LookStyle
from backend.services.ass_look import EVENT_FORMAT, STYLE_FORMAT, _face_style
from backend.shared_assets import load
from backend.tests.helpers.libass_frames import draw_frame, ink_box, needs_libass

pytestmark = needs_libass

FACES = list(load("stage_font_metrics")["faces"])
STYLE = LookStyle.of("marquee")
WHITE = (255, 255, 255)
RED = (255, 0, 0)
BLUE = (0, 0, 255)


def script(tmp_path, events: list[str], header: str = "WrapStyle: 2\nKerning: yes"):
    """A subtitle file with a style per stage face and the given event texts, each shown
    from 0 to 10 seconds in its ``face|text`` face."""
    lines = ["[Script Info]", "ScriptType: v4.00+", header, "ScaledBorderAndShadow: yes"]
    lines += ["PlayResX: 1920", "PlayResY: 1080", "", "[V4+ Styles]", STYLE_FORMAT]
    lines += [_face_style(STYLE, face) for face in FACES]
    lines += ["", "[Events]", EVENT_FORMAT]
    for entry in events:
        face, text = entry.split("|", 1)
        lines.append(f"Dialogue: 0,0:00:00.00,0:00:10.00,{face},test,0,0,0,,{text}")
    path = tmp_path / "probe.ass"
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


def cell(face: str, em: float) -> str:
    return f"{em * font_metrics.face(face)['ass_size']:.2f}"


@pytest.mark.parametrize("face", FACES)
def test_a_fontsize_is_the_cell_height_and_a_row_hangs_from_its_ascent(tmp_path, face):
    """With the cell height as Fontsize the em is the size asked for, and with \\an7 the
    baseline is the row's top plus the face's ascent."""
    em, top = 200, 100
    path = script(tmp_path, [f"{face}|{{\\an7\\pos(100,{top})\\fs{cell(face, em)}}}H"])
    frame, _log = draw_frame(path, 1.0)
    box = ink_box(frame, WHITE)
    assert box is not None
    metrics = font_metrics.face(face)
    assert box[3] == pytest.approx(top + metrics["ascent"] * em, abs=3)
    assert box[3] - box[1] == pytest.approx(metrics["cap_height"] * em, abs=6)


def test_each_face_is_found_in_the_bundled_fonts_by_its_family_name(tmp_path):
    """A name libass cannot match is answered by a system font instead: the log then shows a
    file path, not the bundled font's own name."""
    events = [f"{face}|{{\\an7\\pos(40,{40 + 60 * i})}}Hxg" for i, face in enumerate(FACES)]
    _frame, log = draw_frame(script(tmp_path, events), 1.0, verbose=True)
    chosen = dict(re.findall(r"fontselect: \(([^,]+), \d+, \d+\) -> ([^,]+),", log))
    for face in FACES:
        metrics = font_metrics.face(face)
        assert chosen.get(metrics["ass_family"]) in {
            font_metrics.face(other)["postscript"]
            for other in FACES
            if font_metrics.face(other)["ass_family"] == metrics["ass_family"]
        }, f"{metrics['ass_family']} was not matched: {chosen}"


def test_italic_picks_the_real_italic_of_the_same_family(tmp_path):
    path = script(tmp_path, ["newsreader_medium|{\\an7\\pos(40,40)}upright {\\i1}italic"])
    _frame, log = draw_frame(path, 1.0, verbose=True)
    picked = re.findall(r"fontselect: \(Newsreader Medium, \d+, (\d+)\) -> ([^,]+),", log)
    assert ("100", "Newsreader-MediumItalic") in picked
    assert ("0", "Newsreader-Medium") in picked


def test_nothing_wraps_so_the_row_breaks_are_the_generators(tmp_path):
    long_line = "word " * 60
    path = script(
        tmp_path, [f"jost_medium|{{\\an7\\pos(40,400)\\fs{cell('jost_medium', 60)}}}{long_line}"]
    )
    frame, _log = draw_frame(path, 1.0)
    box = ink_box(frame, WHITE)
    assert box is not None and box[3] - box[1] < 60 * 1.2
    assert box[2] >= 1900


def test_words_before_the_first_karaoke_tag_are_drawn_sung(tmp_path):
    """A row's words that were sung before its event began are written ahead of the first
    \\k; words after a \\k not reached yet are drawn unsung."""
    tags = f"\\an7\\pos(40,400)\\fs{cell('jost_medium', 100)}\\1c&H0000FF&\\2c&HFF0000&"
    path = script(tmp_path, [f"jost_medium|{{{tags}}}HHH {{\\k500}}{{\\kf100}}EEE"])
    frame, _log = draw_frame(path, 1.0)
    sung, unsung = ink_box(frame, RED), ink_box(frame, BLUE)
    assert sung is not None and unsung is not None
    assert sung[2] <= unsung[0] + 2


def test_a_karaoke_fill_runs_left_to_right_over_its_time(tmp_path):
    tags = f"\\an7\\pos(40,400)\\fs{cell('jost_medium', 100)}\\1c&H0000FF&\\2c&HFF0000&"
    path = script(tmp_path, [f"jost_medium|{{{tags}}}{{\\k100}}{{\\kf200}}HHHHHHHH"])
    before, _ = draw_frame(path, 0.5)
    half, _ = draw_frame(path, 2.0)
    after, _ = draw_frame(path, 3.5)
    assert ink_box(before, RED) is None
    assert ink_box(after, BLUE) is None
    sung, unsung = ink_box(half, RED), ink_box(half, BLUE)
    assert sung is not None and unsung is not None
    whole = ink_box(after, RED)
    middle = (whole[0] + whole[2]) / 2
    assert sung[2] == pytest.approx(middle, abs=25)
    assert unsung[0] == pytest.approx(middle, abs=25)


def test_a_move_and_a_fade_take_their_times_from_the_events_start(tmp_path):
    """One event moves and fades in over its first second, then holds: this is how a column's
    line steps up and how a line arrives at the reading place while it is already being sung."""
    tags = (
        f"\\an7\\move(40,600,40,200,0,1000)\\fade(255,0,0,0,1000,10000,10000)"
        f"\\fs{cell('jost_medium', 100)}"
    )
    path = script(tmp_path, [f"jost_medium|{{{tags}}}H"])
    halfway, _ = draw_frame(path, 0.5)
    arrived, _ = draw_frame(path, 3.0)
    there = ink_box(arrived, WHITE)
    assert there is not None
    moving = ink_box(halfway, (128, 128, 128), tolerance=30)
    assert moving is not None
    assert moving[1] == pytest.approx(there[1] + 200, abs=12)


def test_a_drawing_under_an_animated_clip_grows_evenly(tmp_path):
    """The song progress line: a full-width bar revealed by a clip that opens over the song."""
    tags = "\\an7\\pos(0,1070)\\1c&HFFFFFF&\\bord0\\shad0\\clip(0,1070,0,1080)\\t(0,10000,\\clip(0,1070,1920,1080))\\p1"
    path = script(tmp_path, [f"jost_medium|{{{tags}}}m 0 0 l 1920 0 1920 10 0 10{{\\p0}}"])
    quarter, _ = draw_frame(path, 2.5)
    most, _ = draw_frame(path, 7.5)
    assert ink_box(quarter, WHITE)[2] == pytest.approx(480, abs=4)
    assert ink_box(most, WHITE)[2] == pytest.approx(1440, abs=4)
    assert ink_box(most, WHITE)[1] >= 1069


def test_inline_ad_lib_alpha_and_an_event_fade_both_apply(tmp_path):
    tags = f"\\an7\\pos(40,400)\\fade(128,128,128,0,0,10000,10000)\\fs{cell('jost_medium', 100)}"
    path = script(tmp_path, [f"jost_medium|{{{tags}}}HH {{\\1a&H80&}}HH"])
    frame, _log = draw_frame(path, 1.0)
    half = ink_box(frame, (127, 127, 127), tolerance=14)
    quarter = ink_box(frame, (63, 63, 63), tolerance=14)
    assert half is not None and quarter is not None
    assert half[0] < quarter[0]
