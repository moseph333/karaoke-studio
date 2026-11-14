"""Which song-pass placements count as anchors (backend/services/lyric_anchors.py)."""

import pytest

from backend.services import lyric_anchors as anchors

WORDS = ["hold", "me", "closer", "now"]


def _result(index, start, score=0.6, words=WORDS, step=0.4, placed=None):
    raw = []
    for i, _ in enumerate(words):
        if placed is not None and i not in placed:
            raw.append(None)
            continue
        raw.append({"start": start + i * step, "end": start + i * step + 0.3, "score": score})
    timed = [w for w in raw if w]
    return {
        "index": index,
        "status": "ok",
        "line_score": score,
        "start": timed[0]["start"],
        "end": timed[-1]["end"],
        "words": raw,
    }


def test_a_candidate_needs_a_sure_full_and_plausible_placement():
    assert anchors.candidate(_result(0, 1.0, 0.6), WORDS, 0.5, 0.3) == "strong"
    assert anchors.candidate(_result(0, 1.0, 0.4), WORDS, 0.5, 0.3) == "weak"
    assert anchors.candidate(_result(0, 1.0, 0.2), WORDS, 0.5, 0.3) is None
    # most words must be placed
    assert anchors.candidate(_result(0, 1.0, placed={0, 1}), WORDS, 0.5, 0.3) is None
    # short lines ("oh yeah") never anchor
    assert anchors.candidate(_result(0, 1.0, words=["oh"]), ["oh"], 0.5, 0.3) is None
    # squeezed into a moment, or stretched over a break
    assert anchors.candidate(_result(0, 1.0, step=0.01), WORDS, 0.5, 0.3) is None
    assert anchors.candidate(_result(0, 1.0, step=3.0), WORDS, 0.5, 0.3) is None
    assert anchors.candidate({"status": "failed"}, WORDS, 0.5, 0.3) is None
    assert anchors.candidate(None, WORDS, 0.5, 0.3) is None


def test_timed_anchors_must_agree_with_their_neighbours():
    tiers = {0: "strong", 1: "strong", 2: "strong", 3: "strong"}
    shifts = {0: 0.1, 1: 0.15, 2: 8.0, 3: 0.12}
    accepted, segments = anchors.accept_timed(tiers, shifts)
    assert accepted == {0, 1, 3}
    assert segments == [{"first_line": 0, "last_line": 3, "offset": 0.12, "anchors": 3}]


def test_weak_anchors_count_in_a_run_that_agrees():
    tiers = {0: "weak", 1: "weak", 2: "weak", 5: "weak", 6: "weak"}
    shifts = {0: 20.0, 1: 20.2, 2: 19.9, 5: 3.0, 6: 3.1}
    accepted, _ = anchors.accept_timed(tiers, shifts)
    assert accepted == {0, 1, 2}


def test_a_short_segment_far_from_its_neighbours_is_dropped():
    tiers = dict.fromkeys(range(8), "strong")
    shifts = {0: 0.0, 1: 0.1, 2: 0.0, 3: 30.0, 4: 30.1, 5: 0.1, 6: 0.0, 7: 0.1}
    accepted, segments = anchors.accept_timed(tiers, shifts)
    assert accepted == {0, 1, 2, 5, 6, 7}
    assert [s["offset"] for s in segments] == [0.05]  # one segment again


def test_offsets_are_interpolated_within_a_segment_and_held_across_a_jump():
    shifts = {0: 1.0, 4: 3.0, 6: 20.0, 9: 20.0}
    segments = [
        {"first_line": 0, "last_line": 4, "offset": 2.0, "anchors": 2},
        {"first_line": 6, "last_line": 9, "offset": 20.0, "anchors": 2},
    ]
    order = sorted(shifts)
    assert anchors.offset_at(2, order, shifts, segments) == pytest.approx(2.0)
    assert anchors.offset_at(5, order, shifts, segments) == 3.0  # nearer the first segment
    assert anchors.offset_at(11, order, shifts, segments) == 20.0
    assert anchors.offset_at(3, [], {}, []) == 0.0


def test_plain_lyrics_anchor_only_sure_lines():
    results = [_result(i, 2.0 + 5 * i, score) for i, score in enumerate([0.6, 0.6, 0.12, 0.6])]
    words = dict.fromkeys(range(4), WORDS)
    plan = anchors.plan(results, words, None, null_score=0.05)
    assert plan.status == "ok"
    assert set(plan.anchors) == {0, 1, 3}
    assert plan.offsets == {}
    assert set(plan.results) == {0, 1, 2, 3}


def test_scores_are_judged_against_the_songs_baseline():
    results = [_result(i, 2.0 + 5 * i, 0.3) for i in range(4)]
    words = dict.fromkeys(range(4), WORDS)
    # A bleed-heavy stem: everything scores low, scrambled text even lower
    assert anchors.plan(results, words, None, null_score=0.05).status == "ok"
    # The same scores on a recording where scrambled text fits nearly as well: wrong lyrics
    rejected = anchors.plan(results, words, None, null_score=0.15)
    assert rejected.status == "rejected"
    assert "barely fit" in rejected.reason


def test_too_few_reliable_lines_reject_the_plan():
    results = [_result(i, 2.0 + 5 * i, 0.6 if i < 2 else 0.16) for i in range(12)]
    words = dict.fromkeys(range(12), WORDS)
    plan = anchors.plan(results, words, None, null_score=0.05)
    assert plan.status == "rejected"
    assert plan.reason == "only 2 of 12 lines were placed reliably"


def test_timed_lyrics_get_an_offset_for_every_line():
    results = [_result(i, 22.0 + 5 * i) for i in range(4)]
    words = dict.fromkeys(range(4), WORDS)
    starts = {i: 2.0 + 5 * i for i in range(5)}
    plan = anchors.plan(results, words, starts, null_score=0.05)
    assert plan.status == "ok"
    assert plan.offsets == dict.fromkeys(range(5), 20.0)
    assert plan.segments[0]["offset"] == 20.0


def test_anchor_confidence_starts_high_and_reaches_one_at_the_strong_score():
    plan = anchors.AnchorPlan("ok", strong=0.2)
    assert plan.confidence_score(0.2) == 1.0
    assert plan.confidence_score(0.1) == 0.8
    assert plan.confidence_score(0.9) == 1.0
    assert plan.confidence_score(-1) == 0.6
