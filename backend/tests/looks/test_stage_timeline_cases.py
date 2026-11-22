"""When each line, card and cue shows, against the cases the stage's copy runs too."""

from dataclasses import asdict

import pytest

from backend.services import stage_timing
from backend.services.stage_looks import TIMING
from backend.services.stage_timing import plan_timeline
from backend.shared_assets import load

CASES = load("stage_timeline_cases")["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_the_plan_matches_the_shared_case(case):
    plan = plan_timeline(case["lines"], case["duration"], case["cues"])
    expect = case["expect"]
    assert [asdict(line) for line in plan.lines] == expect["lines"]
    assert (list(plan.title) if plan.title else None) == expect["title"]
    assert (list(plan.end_card) if plan.end_card else None) == expect["end_card"]
    assert [list(cue) for cue in plan.count_ins] == expect["count_ins"]
    assert [list(span) for span in plan.breaks] == expect["breaks"]
    assert plan.first_show == expect["first_show"]


def test_a_line_takes_the_reading_place_no_later_than_it_starts():
    """A line's fill is drawn by one event that begins when it takes the reading place, so it
    must be there before its first word."""
    for case in CASES:
        plan = plan_timeline(case["lines"], case["duration"], case["cues"])
        advances = [line.advance for line in plan.lines]
        assert advances == sorted(advances), case["name"]
        for n, line in enumerate(plan.lines):
            if n == 0 or line.start >= plan.lines[n - 1].advance + 0.01:
                assert line.advance <= line.start + 1e-9, case["name"]
            assert line.leave > line.advance
            assert line.hide > line.show


def test_the_title_card_is_gone_before_lyrics_and_cues_show():
    for case in CASES:
        plan = plan_timeline(case["lines"], case["duration"], case["cues"])
        if not plan.title:
            assert plan.first_show == 0.0
            continue
        assert plan.first_show >= plan.title[1]
        assert all(start >= plan.title[1] for _i, start, _end in plan.count_ins)
        assert all(start >= plan.title[1] for start, _end, _at in plan.breaks)
        assert all(line.show >= plan.title[1] for line in plan.lines)


def test_the_youtube_kit_reads_the_same_gap_rule():
    assert stage_timing.INSTRUMENTAL_GAP_THRESHOLD_SECONDS == TIMING["gap_threshold"] == 4.0
    assert stage_timing.COUNTDOWN_LEAD_IN_SECONDS == TIMING["count_in"] == 3.0
