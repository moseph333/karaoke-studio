"""Sizes a line of words to a measure and decides where its rows break.

The video and the stage both run this rule on the same widths (font_metrics), so neither
renderer wraps text by itself and both break a line at the same word; the stage's copy is
frontend/src/utils/stageFit.ts and both suites run stage_fit_cases.json.

A box says how wide the text may be (``measure``), the sizes it may take (``min``, ``prefer``,
``max``) and how many rows. The fewest rows that reach the preferred size win; when none does,
the row count that allows the largest type; and text still too wide at the smallest size is
condensed. Rows are balanced: the break that makes the widest row narrowest."""

import math
from dataclasses import dataclass
from itertools import combinations

from backend.shared_assets import load


@dataclass(frozen=True)
class FitBox:
    """Where a block of text may go, in u (1% of the frame's short side)."""

    measure: float
    min: float
    prefer: float
    max: float
    rows: int = 1


@dataclass(frozen=True)
class Fit:
    """A fitted block: its em size in u, the horizontal squeeze (1 for none) and each row as
    the [first, after-last) range of its tokens."""

    size: float
    condense: float
    rows: tuple[tuple[int, int], ...]


def fit_rules() -> dict[str, float]:
    return load("stage_looks")["fit"]


def _floor_to(value: float, step: float) -> float:
    return math.floor(value / step + 1e-9) * step


def row_width(widths: list[float], spaces: list[bool], space: float, first: int, end: int) -> float:
    """The width in ems of tokens [first, end) on one row, with a space after each token that
    has one except the row's last."""
    total = 0.0
    for i in range(first, end):
        total += widths[i]
        if i < end - 1 and spaces[i]:
            total += space
    return total


def balanced_rows(
    widths: list[float], spaces: list[bool], breaks: list[bool], space: float, rows: int
) -> tuple[tuple[tuple[int, int], ...], float] | None:
    """The split of the tokens into exactly ``rows`` rows whose widest row is narrowest (the
    earliest such breaks on a tie), with that width; None when there are not enough places
    to break."""
    count = len(widths)
    places = [i + 1 for i in range(count - 1) if breaks[i]]
    if rows - 1 > len(places):
        return None
    best: tuple[tuple[tuple[int, int], ...], float] | None = None
    for cuts in combinations(places, rows - 1):
        edges = (0, *cuts, count)
        ranges = tuple((edges[k], edges[k + 1]) for k in range(rows))
        widest = max(row_width(widths, spaces, space, a, b) for a, b in ranges)
        if best is None or widest < best[1] - 1e-9:
            best = (ranges, widest)
    return best


def fit_block(
    widths: list[float], spaces: list[bool], breaks: list[bool], space: float, box: FitBox
) -> Fit:
    """Fits tokens of the given widths (ems) into ``box``. ``spaces[i]`` says a space follows
    token i, ``breaks[i]`` that a row may end after it, ``space`` is a space's width in ems."""
    rules = fit_rules()
    if not widths:
        return Fit(size=_floor_to(box.prefer, rules["size_step"]), condense=1.0, rows=())
    usable = box.measure * rules["fill"]
    options: list[tuple[float, tuple[tuple[int, int], ...], float]] = []
    for rows in range(1, max(1, box.rows) + 1):
        split = balanced_rows(widths, spaces, breaks, space, rows)
        if split is None:
            break
        ranges, widest = split
        size = box.max if widest <= 0 else min(box.max, usable / widest)
        options.append((_floor_to(size, rules["size_step"]), ranges, widest))
    prefer = _floor_to(box.prefer, rules["size_step"])
    chosen = next((option for option in options if option[0] >= prefer - 1e-9), None)
    if chosen is None:
        chosen = options[0]
        for option in options[1:]:
            if option[0] > chosen[0] + 1e-9:
                chosen = option
    size, ranges, widest = chosen
    condense = 1.0
    smallest = _floor_to(box.min, rules["size_step"])
    if size < smallest:
        size = smallest
        squeeze = usable / (widest * size) if widest > 0 else 1.0
        condense = max(rules["min_condense"], math.floor(squeeze * 100 + 1e-9) / 100)
    return Fit(size=round(size, 4), condense=min(1.0, condense), rows=ranges)
