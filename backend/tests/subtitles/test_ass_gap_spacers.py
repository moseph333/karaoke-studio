"""ASS word sweeps stay on the singer's timeline: absolute boundaries plus silent gap spacers."""

import itertools
import re

import pytest

from backend.services.ass_generator import generate_ass_content
from backend.tests.helpers.ass_script import ass_events

TAG = re.compile(r"\{\\(kf|k)(\d+)\}([^{]*)")


def _rows(lines, **kwargs) -> tuple[int, list[str]]:
    """The first line in the two-row look, which writes the words as given: when its events
    start (cs) and each row's text after the block that places and colours it. A long line
    is several rows, every one an event with the same start."""
    ass = generate_ass_content(lines, theme_id="ktv", include_countdown=False, **kwargs)
    events = [e for e in ass_events(ass) if e.role == "lyric:0"]
    assert len({e.start for e in events}) == 1
    return round(events[0].start * 100), [e.text.removeprefix(f"{{{e.tags}}}") for e in events]


def _dialogue(lines, **kwargs) -> tuple[int, str]:
    """The same for a line that fits one row."""
    start_cs, (text,) = _rows(lines, **kwargs)
    return start_cs, text


def _sweeps(start_cs: int, text: str) -> list[tuple[str, int, int]]:
    """(word, sweep start cs, sweep end cs) on the absolute timeline."""
    cursor, out = start_cs, []
    for kind, value, body in TAG.findall(text):
        duration = int(value)
        if kind == "kf":
            out.append((body.strip(), cursor, cursor + duration))
        cursor += duration
    return out


def _line(words, start=None, end=None):
    return {
        "id": 0,
        "text": " ".join(w for w, _, _ in words),
        "start_time": words[0][1] if start is None else start,
        "end_time": words[-1][2] if end is None else end,
        "words": [{"word": w, "start_time": s, "end_time": e} for w, s, e in words],
    }


def test_pauses_between_words_do_not_pull_the_highlight_ahead():
    words = [("Hold", 10.0, 10.4), ("on", 11.5, 11.9), ("tight", 13.0, 13.8)]
    base, text = _dialogue([_line(words)])
    assert _sweeps(base, text) == [("Hold", 1000, 1040), ("on", 1150, 1190), ("tight", 1300, 1380)]
    assert "{\\k110}{\\kf40}on" in text
    assert text.startswith("{\\k250}{\\kf40}Hold")  # lead-in from the 2.5 s early display


def test_long_lines_do_not_drift_from_rounding():
    words = [(f"w{i}", round(20 + i * 0.333, 3), round(20 + (i + 1) * 0.333, 3)) for i in range(40)]
    base, rows = _rows([_line(words)])
    sweeps = [sweep for text in rows for sweep in _sweeps(base, text)]
    for (word, start, end), (_, w_start, w_end) in zip(sweeps, words, strict=True):
        assert start == round(w_start * 100), word
        assert end == round(w_end * 100), word


def test_a_late_first_word_waits_after_the_line_starts():
    words = [("late", 6.6, 7.0), ("entry", 7.0, 7.5)]
    base, text = _dialogue([_line(words, start=6.0, end=7.5)])
    assert _sweeps(base, text)[0] == ("late", 660, 700)


def test_overlapping_or_inverted_words_stay_monotonic_and_visible():
    words = [("a", 5.0, 5.6), ("b", 5.4, 5.3), ("c", 5.2, 6.0)]
    base, text = _dialogue([_line(words, start=5.0, end=6.0)])
    sweeps = _sweeps(base, text)
    assert [w for w, _, _ in sweeps] == ["a", "b", "c"]
    for (_, _, end), (_, next_start, _) in itertools.pairwise(sweeps):
        assert end <= next_start
    assert all(end - start >= 1 for _, start, end in sweeps)
    assert "\\k-" not in text


def test_lines_without_words_change_colour_whole_when_they_start():
    line = {"id": 0, "text": "Whole line", "start_time": 1.0, "end_time": 3.0, "words": []}
    base, text = _dialogue([line])
    assert base == 0
    assert text == "{\\k100}{\\k0}Whole line"


@pytest.mark.parametrize("sync_mode", ["line"])
def test_line_mode_keeps_its_lead_in_format(sync_mode):
    words = [("Hold", 10.0, 10.4), ("on", 11.5, 11.9)]
    _, text = _dialogue([_line(words)], sync_mode=sync_mode)
    assert text == "{\\k250}{\\k0}Hold on"
