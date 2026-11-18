"""Several words sung in one burst of voice share the burst, also when it is too short to
give each of them the 20 ms the boundary search asks for."""

import itertools

import pytest

from backend.services.aligner import enforce_monotonic_words, split_burst_between_words


def test_a_burst_too_short_for_its_words_is_shared_out_by_weight():
    splits = split_burst_between_words(1.0, 1.05, [1.0, 1.0, 1.0], [])
    assert splits == pytest.approx([1.0, 1.0 + 0.05 / 3, 1.0 + 0.1 / 3, 1.05])
    # heavier words get more of it
    splits = split_burst_between_words(2.0, 2.04, [3.0, 1.0], [])
    assert splits == pytest.approx([2.0, 2.03, 2.04])


def test_the_words_of_a_short_burst_are_not_piled_up_at_its_end():
    words = ["one", "two", "three", "four"]
    splits = split_burst_between_words(1.0, 1.06, [1.0] * 4, [])
    spans = list(itertools.pairwise(splits))
    timed = enforce_monotonic_words(words, spans, 0.5, 3.0)
    assert timed[0]["start_time"] == pytest.approx(1.0, abs=0.002)
    lengths = [w["end_time"] - w["start_time"] for w in timed]
    assert max(lengths) - min(lengths) < 0.005


def test_a_burst_with_room_still_puts_a_boundary_on_an_onset():
    splits = split_burst_between_words(1.0, 2.0, [1.0, 1.0], [(1.4, 9.0)])
    assert splits == pytest.approx([1.0, 1.4, 2.0])
    assert split_burst_between_words(1.0, 2.0, [1.0, 1.0], []) == pytest.approx([1.0, 1.5, 2.0])
