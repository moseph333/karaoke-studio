"""Exported subtitles write Japanese without spaces between its characters, and keep the
spaces the lyric line has."""

import re

from backend.services.ass_generator import generate_ass_content
from backend.services.lyric_tokenize import tokenize_lyric_text

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


def shown_text(ass: str) -> str:
    dialogue = next(line for line in ass.splitlines() if line.startswith("Dialogue: 0,"))
    return re.sub(r"\{[^}]*\}", "", dialogue.split(",", 9)[9])


def test_a_japanese_line_reads_as_written_in_word_sweep_mode():
    assert shown_text(generate_ass_content([timed(LINE)])) == LINE


def test_each_character_still_gets_its_own_sweep():
    ass = generate_ass_content([timed("我々は空間に")])
    dialogue = next(line for line in ass.splitlines() if line.startswith("Dialogue: 0,"))
    assert dialogue.count("\\kf") == 6


def test_line_sync_mode_writes_it_the_same_way():
    ass = generate_ass_content([timed(LINE)], style_config={"sync_mode": "line"})
    assert shown_text(ass) == LINE


def test_latin_lines_keep_one_space_between_words():
    assert (
        shown_text(generate_ass_content([timed("Lasers from the dark")])) == "Lasers from the dark"
    )
