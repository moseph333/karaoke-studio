"""The gain curve that keeps or removes the lead vocal during each singer's lines."""

import numpy as np
import pytest

from backend.services.vocal_mix import LEAD_SECONDS, RAMP_SECONDS, TAIL_SECONDS, gate_curve


def _line(start, end, singer="singer1"):
    return {"start_time": start, "end_time": end, "singer": singer, "text": "la"}


def _gain(curve, at):
    times, gains = zip(*curve, strict=True)
    return float(np.interp(at, times, gains))


KEEP_TWO = {"singer1": 0.0, "singer2": 1.0, "both": 0.5}


def test_each_singers_lines_take_that_singers_level():
    lines = [_line(10, 12), _line(20, 22, "singer2"), _line(30, 32, "both")]

    curve = gate_curve(lines, KEEP_TWO)

    assert _gain(curve, 11) == 0.0
    assert _gain(curve, 21) == 1.0
    assert _gain(curve, 31) == 0.5
    # Before the first line, between lines and after the last: the lowest level in use
    for quiet in (0, 5, 15, 26, 40):
        assert _gain(curve, quiet) == 0.0


def test_a_level_starts_a_little_early_and_holds_past_the_last_word():
    curve = gate_curve([_line(10, 12), _line(20, 22, "singer2")], KEEP_TWO)

    half = RAMP_SECONDS / 2
    assert _gain(curve, 20 - LEAD_SECONDS + half) == pytest.approx(1.0, abs=1e-6)
    assert _gain(curve, 20 - LEAD_SECONDS - half) == pytest.approx(0.0, abs=1e-6)
    assert _gain(curve, 22 + TAIL_SECONDS - half) == pytest.approx(1.0, abs=1e-6)
    assert _gain(curve, 22 + TAIL_SECONDS + half) == pytest.approx(0.0, abs=1e-6)
    # Half way through the fade
    assert _gain(curve, 22 + TAIL_SECONDS) == pytest.approx(0.5, abs=0.02)


def test_a_held_note_never_runs_into_the_next_singers_line():
    """Singer 2 starts 0.4 s after Singer 1's last word: Singer 1's level holds only until
    Singer 2's begins."""
    keep_one = {"singer1": 1.0, "singer2": 0.0, "both": 0.0}
    curve = gate_curve([_line(10, 12), _line(12.4, 14, "singer2")], keep_one)

    assert _gain(curve, 12.1) == 1.0
    assert _gain(curve, 12.4) == 0.0
    assert _gain(curve, 13) == 0.0


def test_overlapping_lines_of_two_singers_are_sung_together():
    curve = gate_curve([_line(10, 14), _line(12, 16, "singer2")], KEEP_TWO)

    assert _gain(curve, 11) == 0.0
    assert _gain(curve, 13) == 0.5
    assert _gain(curve, 15) == 1.0


def test_two_overlapping_lines_of_one_singer_are_still_that_singer():
    curve = gate_curve(
        [_line(10, 14, "singer2"), _line(12, 16, "singer2"), _line(30, 31)], KEEP_TWO
    )

    assert _gain(curve, 13) == 1.0


def test_one_level_throughout_needs_no_curve():
    assert gate_curve([], KEEP_TWO) is None
    assert gate_curve([_line(10, 12), _line(20, 22)], KEEP_TWO) is None
    same = {"singer1": 0.4, "singer2": 0.4, "both": 0.9}
    assert gate_curve([_line(10, 12), _line(20, 22, "singer2")], same) is None


def test_the_floor_is_the_lowest_level_of_the_singers_who_sing():
    """A "both" level of zero does not silence the gaps of a song with no line sung together."""
    levels = {"singer1": 0.6, "singer2": 1.0, "both": 0.0}
    curve = gate_curve([_line(10, 12), _line(20, 22, "singer2")], levels)

    assert _gain(curve, 16) == 0.6


def test_lines_without_usable_times_or_singers_are_skipped_or_read_as_singer_1():
    lines = [
        _line(10, 12, "choir"),  # an unknown singer sings as Singer 1
        {"start_time": "soon", "end_time": 3, "singer": "singer2"},
        _line(8, 8, "singer2"),  # no length
        "not a line",
        _line(20, 22, "singer2"),
    ]
    curve = gate_curve(lines, KEEP_TWO)

    assert _gain(curve, 11) == 0.0
    assert _gain(curve, 21) == 1.0
    assert _gain(curve, 8) == 0.0


def test_the_curve_is_the_same_for_the_same_timing_and_ignores_the_words():
    lines = [_line(10, 12), _line(20.0004, 22, "singer2")]
    reworded = [dict(line, text="other words", words=[{"text": "x"}]) for line in lines]

    assert gate_curve(lines, KEEP_TWO) == gate_curve(reworded, KEEP_TWO)
    moved = [_line(10, 12), _line(20.5, 22, "singer2")]
    assert gate_curve(moved, KEEP_TWO) != gate_curve(lines, KEEP_TWO)
    # A removed singer's line that moves within silence changes nothing there is to hear
    unheard = [_line(10.5, 12), _line(20.0004, 22, "singer2")]
    assert gate_curve(unheard, KEEP_TWO) == gate_curve(lines, KEEP_TWO)
    times = [at for at, _ in gate_curve(lines, KEEP_TWO)]
    assert times == sorted(set(times)) and times[0] == 0.0
    assert all(round(at, 3) == at for at in times)


def test_a_line_at_the_very_start_of_the_song_keeps_increasing_times():
    curve = gate_curve([_line(0.0, 2, "singer2"), _line(5, 6)], KEEP_TWO)

    times = [at for at, _ in curve]
    assert times == sorted(set(times))
    assert _gain(curve, 1) == 1.0
