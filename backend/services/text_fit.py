"""Sizes a line of words to a measure and decides where its rows break.

The video and the stage both run this rule on the same widths (font_metrics), so neither
renderer wraps text by itself and both break a line at the same word; the stage's copy is
frontend/src/utils/stageFit.ts and both suites run stage_fit_cases.json.

A box says how wide the text may be (``measure``), the sizes it may take (``min``, ``prefer``,
``max``) and how many rows. The fewest rows that reach the preferred size win; when none does,
the row count that allows the largest type; text still too wide at the smallest size is
condensed, and past the tightest squeeze takes more rows than the box asks for. Rows are
balanced: the break that makes the widest row narrowest."""

import math
from dataclasses import dataclass

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


def _row_widths(widths: list[float], spaces: list[bool], space: float) -> list[list[float]]:
    """table[a][b]: the width of tokens [a, b) on one row (row_width, for every range)."""
    count = len(widths)
    table = [[0.0] * (count + 1) for _ in range(count + 1)]
    for first in range(count):
        total = 0.0
        for end in range(first + 1, count + 1):
            if end - first > 1 and spaces[end - 2]:
                total += space
            total += widths[end - 1]
            table[first][end] = total
    return table


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
    table = _row_widths(widths, spaces, space)
    unreachable = float("inf")
    # tail[k][i]: the narrowest widest row when tokens [i, count) take k rows
    tail = [[unreachable] * (count + 1) for _ in range(rows + 1)]
    for start in range(count):
        tail[1][start] = table[start][count]
    for k in range(2, rows + 1):
        for start in range(count):
            best = unreachable
            for cut in places:
                if cut <= start or tail[k - 1][cut] == unreachable:
                    continue
                widest = max(table[start][cut], tail[k - 1][cut])
                if widest < best:
                    best = widest
            tail[k][start] = best
    target = tail[rows][0]
    if target == unreachable:
        return None
    # The earliest breaks that reach it
    ranges: list[tuple[int, int]] = []
    start = 0
    for k in range(rows, 1, -1):
        for cut in places:
            if cut <= start or tail[k - 1][cut] == unreachable:
                continue
            if max(table[start][cut], tail[k - 1][cut]) <= target + 1e-9:
                ranges.append((start, cut))
                start = cut
                break
    ranges.append((start, count))
    return tuple(ranges), target


def fit_block(
    widths: list[float], spaces: list[bool], breaks: list[bool], space: float, box: FitBox
) -> Fit:
    """Fits tokens of the given widths (ems) into ``box``. ``spaces[i]`` says a space follows
    token i, ``breaks[i]`` that a row may end after it, ``space`` is a space's width in ems.
    A line still too wide at the smallest size and the tightest squeeze takes more rows than
    the box asks for (up to the rules' ``most_rows``) rather than run off the frame."""
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
        rows = len(ranges)
        while squeeze < rules["min_condense"] and rows < rules["most_rows"]:
            rows += 1
            split = balanced_rows(widths, spaces, breaks, space, rows)
            if split is None:
                break
            ranges, widest = split
            squeeze = usable / (widest * size) if widest > 0 else 1.0
        condense = max(rules["min_condense"], math.floor(squeeze * 100 + 1e-9) / 100)
    return Fit(size=round(size, 4), condense=min(1.0, condense), rows=ranges)
