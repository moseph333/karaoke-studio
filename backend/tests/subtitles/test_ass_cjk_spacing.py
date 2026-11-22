"""Exported subtitles write Japanese without spaces between its characters, and keep the
spaces the lyric line has."""

from backend.services.ass_generator import generate_ass_content
from backend.services.lyric_tokenize import tokenize_lyric_text
from backend.tests.helpers.ass_script import AssEvent, ass_events

LINE = "幸せなサメ サメ (Shiawase na same, same)"


def timed(text: str, start: float = 1.0) -> dict:
    tokens = tokenize_lyric_text(text)
    return {
        "id": 0,
        "text": text,
        "start_time": start,
        "end_time": start + 0.3 * len(tokens),
        "words": [
            {"word": t, "start_time": start + 0.3 * i, "end_time": start + 0.3 * (i + 1)}
            for i, t in enumerate(tokens)
        ],
    }


def sung_row(lines: list[dict], **given) -> AssEvent:
    """The event of a line short enough for one row, in the two-row look, which writes a
    line as it is written (the default look writes it in capitals)."""
    ass = generate_ass_content(lines, theme_id="ktv", **given)
    (row,) = [e for e in ass_events(ass) if e.role == "lyric:0"]
    return row


def test_a_japanese_line_reads_as_written_in_word_sweep_mode():
    assert sung_row([timed(LINE)]).plain == LINE


def test_each_character_still_gets_its_own_sweep():
    assert sung_row([timed("我々は空間に")]).text.count("\\kf") == 6


def test_line_sync_mode_writes_it_the_same_way():
    row = sung_row([timed(LINE)], style_config={"sync_mode": "line"})
    assert row.plain == LINE and "\\kf" not in row.text


def test_latin_lines_keep_one_space_between_words():
    assert sung_row([timed("Lasers from the dark")]).plain == "Lasers from the dark"
