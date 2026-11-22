"""Each look drawn for real: the line being sung is where the look puts it, in its colours."""

import pytest

from backend.services import font_metrics
from backend.services.ass_draw import LookStyle
from backend.services.ass_look import generate_look_ass
from backend.services.stage_layout import (
    line_text,
    place_column,
    place_rows_line,
    place_stack_line,
)
from backend.services.stage_looks import ASPECTS, LOOKS
from backend.tests.helpers.libass_frames import draw_frame, ink_box, needs_libass

pytestmark = needs_libass

# One line, half sung at 5 s: "Paper lanterns" by then, "on the water" still to sing
LINE = {
    "text": "Paper lanterns on the water",
    "start_time": 3.0,
    "end_time": 7.0,
    "words": [
        {"word": "Paper", "start_time": 3.0, "end_time": 3.9},
        {"word": "lanterns", "start_time": 4.0, "end_time": 4.9},
        {"word": "on", "start_time": 5.2, "end_time": 5.6},
        {"word": "the", "start_time": 5.7, "end_time": 6.1},
        {"word": "water", "start_time": 6.2, "end_time": 7.0},
    ],
}


def rgb(css: str) -> tuple[int, int, int]:
    return int(css[1:3], 16), int(css[3:5], 16), int(css[5:7], 16)


@pytest.mark.parametrize("look_id", list(LOOKS))
@pytest.mark.parametrize("aspect", ASPECTS)
def test_the_line_is_half_sung_in_the_looks_colours_at_the_looks_place(tmp_path, look_id, aspect):
    look = LOOKS[look_id]
    style = LookStyle.of(look_id, aspect, furniture=False)
    script = tmp_path / "line.ass"
    script.write_text(generate_look_ass([LINE], style), encoding="utf-8")
    frame, _log = draw_frame(
        script, 5.05, (style.frame.width_px, style.frame.height_px), look["palette"]["ground"]
    )
    sung = ink_box(frame, rgb(look["palette"]["sung"]), tolerance=24)
    unsung = ink_box(frame, rgb(look["palette"]["unsung"]), tolerance=24)
    assert sung is not None and unsung is not None

    spec = style.spec
    text = line_text(LINE, bool(look["caps"].get("lyric")))
    if look["layout"] == "rows":
        block = place_rows_line(look, spec, text, 0).block
        baselines = [row.baseline for row in block.rows]
    elif look["layout"] == "stack":
        block = place_stack_line(look, spec, text).block
        baselines = [row.baseline for row in block.rows]
    else:
        block = place_column(look, spec, [text], [""])[0].block
        baselines = [spec["lyric"]["baseline"] + row.baseline for row in block.rows]
    u = style.u
    # The sung words sit on the first row's baseline (no descenders in "Paper lanterns"
    # but the p, so allow a descender's depth)
    face = font_metrics.face(spec["lyric"]["face"])
    size = block.size
    # Prompter's sung colour is a grey, which the soft edges of its white words also are:
    # with a second row of white words under the sung ones only the top can be told
    edges_match = look["emphasis"] == "unsung" and len(baselines) > 1
    if not edges_match:
        assert sung[3] == pytest.approx(baselines[0] * u, abs=face["descent"] * size * u + 3)
    assert sung[1] == pytest.approx(
        baselines[0] * u - face["cap_height"] * size * u, abs=0.12 * size * u + 3
    )
    if len(baselines) == 1 and look["emphasis"] == "sung":
        assert sung[0] < unsung[2]
        if spec["lyric"]["align"] == "left":
            assert sung[0] == pytest.approx(spec["lyric"]["x"] * u, abs=0.1 * size * u + 3)
    if spec["lyric"]["align"] == "center" and len(baselines) == 1:
        middle = (min(sung[0], unsung[0]) + max(sung[2], unsung[2])) / 2
        assert middle == pytest.approx(spec["lyric"]["x"] * u, abs=0.12 * size * u + 3)


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_the_progress_line_is_half_way_at_half_time(tmp_path, look_id):
    look = LOOKS[look_id]
    style = LookStyle.of(look_id)
    script = tmp_path / "song.ass"
    script.write_text(generate_look_ass([], style, duration=40.0), encoding="utf-8")
    frame, _log = draw_frame(script, 20.0, ground=look["palette"]["ground"])
    bar = ink_box(frame, rgb(look["palette"]["cue"]), tolerance=24)
    assert bar is not None
    assert bar[0] == 0 and bar[2] == pytest.approx(960, abs=4)
    height = style.spec["progress"]["height"] * style.u
    assert bar[3] == 1080 and bar[1] == pytest.approx(1080 - height, abs=1.5)
