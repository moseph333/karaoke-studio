"""Lines too long to sing as one are split at their natural breaks, keeping word timing."""

from itertools import pairwise

from backend.services.lyric_cleanup import (
    MAX_LINE_CHARS,
    MAX_LINE_WORDS,
    clean_fetched_lines,
    split_long_line,
)
from backend.services.lyrics import LyricsService
from backend.tests.helpers.lrclib_listings import LASER_SHARKS_ALL_CAPS, METAPHYSICAL


def timed(text: str, start: float = 0.0, step: float = 0.3) -> dict:
    words = text.split()
    return {
        "id": 0,
        "text": text,
        "start_time": start,
        "end_time": start + step * len(words),
        "words": [
            {"word": w, "start_time": start + i * step, "end_time": start + (i + 1) * step}
            for i, w in enumerate(words)
        ],
    }


def test_the_narrator_intro_becomes_lines_that_fit():
    lines = clean_fetched_lines(LyricsService.parse_lrc(LASER_SHARKS_ALL_CAPS["syncedLyrics"]))
    intro = [entry for entry in lines if entry["start_time"] < 20]
    assert len(intro) >= 4
    for entry in intro:
        assert len(entry["text"]) <= MAX_LINE_CHARS
        assert len(entry["words"]) <= MAX_LINE_WORDS
    assert " ".join(entry["text"] for entry in intro).startswith("On a strange planet")
    assert intro[0]["start_time"] == 3.24
    for a, b in pairwise(intro):
        assert a["end_time"] <= b["start_time"] + 1e-9


def test_dense_rap_lines_that_fit_are_left_whole():
    parsed = [e for e in LyricsService.parse_lrc(METAPHYSICAL["syncedLyrics"]) if e["text"]]
    cleaned = clean_fetched_lines(parsed)
    assert [e["text"] for e in cleaned] == [e["text"] for e in parsed]


def test_a_split_prefers_punctuation_near_the_middle():
    line = timed("We set up a laser beam today, and then we fought back against the evil ones")
    first, second = split_long_line(line)
    assert first["text"] == "We set up a laser beam today,"
    assert second["text"] == "and then we fought back against the evil ones"
    assert first["start_time"] == line["start_time"]
    assert second["end_time"] == line["end_time"]
    assert first["end_time"] == first["words"][-1]["end_time"]
    assert second["start_time"] == second["words"][0]["start_time"]


def test_a_split_without_punctuation_cuts_before_a_conjunction():
    pieces = split_long_line(
        timed("Mutants from outer space came down to save the day because nobody else would")
    )
    assert [p["text"] for p in pieces] == [
        "Mutants from outer space came down to save the day",
        "because nobody else would",
    ]


def test_short_lines_and_untimed_lines_split_safely():
    assert split_long_line(timed("Lasers from the dark")) == [timed("Lasers from the dark")]
    untimed = timed("la " * 30, step=0.0)
    pieces = split_long_line(untimed)
    assert len(pieces) > 1
    assert all(p["start_time"] == 0.0 and p["end_time"] == 0.0 for p in pieces)


def test_a_split_never_cuts_inside_parentheses():
    line = timed(
        "Computating thoughts through a terabyte of RAM stored in a floppy (Uh, battery-operated style)"
    )
    pieces = split_long_line(line)
    assert [p["text"] for p in pieces] == [
        "Computating thoughts through a terabyte of RAM stored in a floppy",
        "(Uh, battery-operated style)",
    ]


def test_a_line_that_is_all_one_parenthesis_still_splits():
    pieces = split_long_line(timed("(" + "la " * 30 + "la)"))
    assert len(pieces) > 1
