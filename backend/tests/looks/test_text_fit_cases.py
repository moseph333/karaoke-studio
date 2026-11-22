"""The line-fitting rule against the cases the stage's copy runs too."""

import pytest

from backend.services.text_fit import FitBox, balanced_rows, fit_block, row_width
from backend.shared_assets import load

CASES = load("stage_fit_cases")["cases"]


@pytest.mark.parametrize("case", CASES, ids=[case["name"] for case in CASES])
def test_fit_matches_the_shared_case(case):
    fit = fit_block(
        case["widths"], case["spaces"], case["breaks"], case["space"], FitBox(**case["box"])
    )
    expect = case["expect"]
    assert fit.size == pytest.approx(expect["size"], abs=1e-6)
    assert fit.condense == pytest.approx(expect["condense"], abs=1e-6)
    assert [list(row) for row in fit.rows] == expect["rows"]


def test_a_fitted_line_never_runs_past_its_measure_unless_condensing_ran_out():
    for case in CASES:
        box = FitBox(**case["box"])
        fit = fit_block(case["widths"], case["spaces"], case["breaks"], case["space"], box)
        widest = max(
            (row_width(case["widths"], case["spaces"], case["space"], a, b) for a, b in fit.rows),
            default=0.0,
        )
        drawn = widest * fit.size * fit.condense
        if fit.condense > load("stage_looks")["fit"]["min_condense"]:
            assert drawn <= box.measure + 1e-6, case["name"]


def test_rows_cover_every_token_once_and_in_order():
    for case in CASES:
        fit = fit_block(
            case["widths"], case["spaces"], case["breaks"], case["space"], FitBox(**case["box"])
        )
        covered = [i for a, b in fit.rows for i in range(a, b)]
        assert covered == list(range(len(case["widths"]))), case["name"]


def test_a_row_only_ends_where_a_break_is_allowed():
    widths = [1.0, 1.0, 1.0, 1.0]
    spaces = [True, False, True, False]
    split = balanced_rows(widths, spaces, spaces, 0.25, 2)
    assert split is not None
    ranges, _widest = split
    assert ranges in (((0, 1), (1, 4)), ((0, 3), (3, 4)))
    assert balanced_rows(widths, spaces, [False] * 4, 0.25, 2) is None
