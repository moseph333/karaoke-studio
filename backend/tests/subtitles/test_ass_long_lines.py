"""A lyric line too long for two rows is drawn smaller in the export, so it does not climb
over the other lyric row; ordinary lines are untouched."""

from backend.services.ass_generator import (
    MIN_LINE_SCALE,
    AssStyle,
    estimated_width,
    generate_ass_content,
    line_scale,
)

INTRO = (
    "On a strange planet in a far away galaxy there were three teenage sharks that were "
    "visited by humans and given advanced laser technology from the future, and the sharks "
    "joined man in a battle against evil across the universe"
)


def timed(text: str, start: float = 1.0) -> dict:
    words = text.split()
    return {
        "text": text,
        "start_time": start,
        "end_time": start + 0.3 * len(words),
        "words": [
            {"word": w, "start_time": start + 0.3 * i, "end_time": start + 0.3 * (i + 1)}
            for i, w in enumerate(words)
        ],
    }


def dialogue(ass: str) -> str:
    return next(row for row in ass.splitlines() if row.startswith("Dialogue: 0,")).split(",", 9)[9]


def style(aspect: str = "16:9") -> AssStyle:
    return AssStyle.resolve(style_config=None, aspect_ratio=aspect)


def test_ordinary_lines_keep_their_size():
    assert line_scale("Mutants from outer space, American all the way", style()) == 100
    assert "\\fscx" not in dialogue(generate_ass_content([timed("Lasers from the dark")]))


def test_a_run_on_line_is_drawn_small_enough_for_two_rows():
    scale = line_scale(INTRO, style())
    assert MIN_LINE_SCALE <= scale < 100
    text = dialogue(generate_ass_content([timed(INTRO)]))
    assert text.startswith(f"{{\\fscx{scale}\\fscy{scale}}}")


def test_a_portrait_video_shrinks_sooner():
    line = "Mutants from outer space, American all the way, they came to save the day"
    assert line_scale(line, style("9:16")) < line_scale(line, style("16:9"))


def test_shrinking_stops_at_the_minimum():
    assert line_scale("la " * 400, style()) == MIN_LINE_SCALE


def test_ad_libs_in_a_shrunk_line_stay_relative_and_return_to_the_line_size():
    scale = line_scale(INTRO + " (yeah)", style())
    text = dialogue(generate_ass_content([timed(INTRO + " (yeah) now")]))
    small = round(0.8 * scale)
    assert f"\\fscx{small}" in text
    assert text.endswith("now") and f"{{\\r}}{{\\fscx{scale}\\fscy{scale}}}" in text


def test_japanese_characters_count_as_wide():
    assert estimated_width("東京へ", 50) == 150
    assert estimated_width("abc", 50) < 150


def test_line_sync_mode_shrinks_the_same_way():
    ass = generate_ass_content([timed(INTRO)], style_config={"sync_mode": "line"})
    assert "\\fscx" in dialogue(ass)
