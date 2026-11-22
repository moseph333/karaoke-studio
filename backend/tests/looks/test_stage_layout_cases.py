"""Where each look puts a line, against the cases the stage's copy runs too."""

import pytest

from backend.services import stage_layout as layout
from backend.services.stage_looks import LOOKS
from backend.shared_assets import load

CASES = load("stage_layout_cases")["cases"]


def _block(block) -> dict:
    return {
        "face": block.face,
        "size": block.size,
        "condense": block.condense,
        "x": block.x,
        "align": block.align,
        "rows": [[row.first, row.end, row.baseline] for row in block.rows],
        "top": block.top,
        "bottom": block.bottom,
    }


def _item(item) -> dict | None:
    if item is None:
        return None
    return {
        "face": item.face,
        "text": item.text,
        "size": item.size,
        "condense": item.condense,
        "x": item.x,
        "align": item.align,
        "baseline": item.baseline,
    }


def _rounded(value):
    """A nested value with its numbers rounded, so the two sides compare exactly."""
    if isinstance(value, float):
        return round(value, 6)
    if isinstance(value, dict):
        return {key: _rounded(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_rounded(item) for item in value]
    return value


def _text(look_id: str, line: dict, role: str = "lyric"):
    return layout.line_text(line, bool(LOOKS[look_id]["caps"].get(role)))


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_placement_matches_the_shared_case(case):
    look = LOOKS[case["look"]]
    frame = look["frames"][case["aspect"]]
    expect = case["expect"]
    scale = case["scale"]
    if case["layout"] == "column":
        texts = [_text(case["look"], line) for line in case["lines"]]
        placed = layout.place_column(look, frame, texts, case["part_names"], scale)
        got = [
            {
                "block": _block(line.block),
                "label": _item(line.label),
                "romaji": _item(line.romaji),
                "offset": line.offset,
                "height": line.height,
            }
            for line in placed
        ]
        assert _rounded(got) == _rounded(expect["lines"])
        for current, states in expect["states"].items():
            now = layout.column_state(frame, placed, int(current), scale)
            assert _rounded(now) == _rounded(states)
        return
    text = _text(case["look"], case["line"])
    assert list(text.tokens) == expect["tokens"]
    if case["layout"] == "rows":
        placed_line = layout.place_rows_line(
            look, frame, text, case["slot"], case["part_name"], scale
        )
    else:
        placed_line = layout.place_stack_line(look, frame, text, case["part_name"], scale)
    assert _rounded(_block(placed_line.block)) == _rounded(expect["block"])
    assert _rounded(_item(placed_line.label)) == _rounded(expect["label"])
    assert _rounded(_item(placed_line.romaji)) == _rounded(expect["romaji"])
    if "next_line" in case:
        waiting = layout.place_stack_next(
            look,
            frame,
            _text(case["look"], case["next_line"], "next"),
            scale,
            bool(text.romaji),
            case["frame_height"],
        )
        got_next = _block(waiting) if waiting else None
        assert _rounded(got_next) == _rounded(expect["next"])


def test_marquee_draws_capitals_and_the_other_looks_draw_the_line_as_written():
    line = {"text": "Straße (oh yeah)"}
    assert _text("marquee", line).tokens == ("STRASSE", "(OH", "YEAH)")
    assert _text("ktv", line).tokens == ("Straße", "(oh", "yeah)")
    assert _text("marquee", line).adlib == (False, True, True)


def test_a_lines_timed_words_are_its_tokens():
    line = {
        "text": "Hold on",
        "words": [{"word": "Hold"}, {"word": "on"}, "not a word"],
    }
    text = layout.line_text(line)
    assert text.tokens == ("Hold", "on") and text.spaces == (True, False)


def test_a_part_shows_its_own_name_or_the_default():
    assert layout.part_name("singer2", {"singer2": " Theo "}) == "Theo"
    assert layout.part_name("singer2", {"singer2": "  "}) == "Singer 2"
    assert layout.part_name("both", None) == "Both"
    assert layout.part_name("singer1", {}) == "Singer 1"


def test_the_column_keeps_the_line_being_sung_at_one_height():
    look = LOOKS["songbook"]
    frame = look["frames"]["16:9"]
    lines = [{"text": f"Line number {i} of the song"} for i in range(6)]
    texts = [layout.line_text(line) for line in lines]
    placed = layout.place_column(look, frame, texts, [""] * 6)
    for current in range(6):
        baseline, opacity = layout.column_state(frame, placed, current)[current]
        assert baseline == pytest.approx(frame["lyric"]["baseline"])
        assert opacity == 1.0


def test_the_column_shows_only_the_lines_near_the_reading_place():
    look = LOOKS["prompter"]
    frame = look["frames"]["16:9"]
    column = frame["column"]
    texts = [layout.line_text({"text": f"Line {i}"}) for i in range(10)]
    placed = layout.place_column(look, frame, texts, [""] * 10)
    states = layout.column_state(frame, placed, 4)
    visible = [i for i, (_baseline, opacity) in enumerate(states) if opacity > 0]
    assert visible == list(range(4 - column["before"], 4 + column["after"] + 1))
    assert [states[i][1] for i in (5, 6, 7)] == column["after_alpha"]
    baselines = [states[i][0] for i in visible]
    assert baselines == sorted(baselines)
