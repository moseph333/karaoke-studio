"""Which lines the neural song pass placed reliably, and where that puts the others.

The CTC worker's song pass (backend.workers.ctc_align_worker, protocol version 2) aligns all
of a song's lines in order against the whole vocal stem, so it can find a line far from the
DSP aligner's first estimate. It can also be wrong: lyrics for another song or version,
lines that are never sung, a chorus written once and sung three times. plan() therefore
only trusts a line's song-pass timing ("anchor") when

* the model is sure of it and placed most of its words. Model scores depend on the stem
  (bleed, reverb, a soft voice), so a line's score is judged against the song's baseline:
  the median score of the same lines with scrambled letters (``null_score``), which the
  right lyrics beat several times over and the wrong lyrics only about twice,
* the line is long enough to be distinctive, and neither squeezed nor stretched,
* and it agrees with its neighbours: for lyrics with line timing (LRC), anchors nearby must
  shift the file's timing by about the same amount; for plain lyrics the model must be sure.

When too few lines anchor, the plan is "rejected" and the song keeps today's timing. For
lyrics with line timing the anchors also give the shift at every line ("offset"): within a
run of agreeing anchors it is interpolated, so a lyrics file made for a version with a
longer intro or a cut verse is corrected piece by piece instead of by one constant.
"""

import statistics
from dataclasses import dataclass, field
from typing import Any

PLACED_SHARE = 0.7  # of a line's alignable words
MIN_LETTERS = 6  # "oh" or "yeah" never anchors
MAX_LETTERS_PER_SEC = 30.0
MAX_SEC_BASE = 4.0
MAX_SEC_PER_WORD = 1.2
# Line scores against the baseline n (null_score): strong from max(0.15, 3.5 n), weak from
# max(0.08, 2 n), and the song's median line score must reach max(0.1, 3 n)
STRONG_FLOOR, STRONG_TIMES_NULL = 0.15, 3.5
WEAK_FLOOR, WEAK_TIMES_NULL = 0.08, 2.0
SONG_FLOOR, SONG_TIMES_NULL = 0.1, 3.0
DEFAULT_NULL_SCORE = 0.05  # when the worker sent none
NEIGHBOURS = 2
STRONG_AGREEMENT = 0.4  # seconds between neighbouring anchors' shifts
WEAK_AGREEMENT = 0.5
WEAK_RUN = 3
MAX_SHIFT = 60.0
MIN_ANCHORS = 3
MIN_ANCHOR_SHARE = 0.25


@dataclass
class AnchorPlan:
    status: str  # "ok" or "rejected"
    reason: str | None = None
    anchors: dict[int, dict] = field(default_factory=dict)  # line index -> song-pass result
    results: dict[int, dict] = field(default_factory=dict)  # every song-pass result
    offsets: dict[int, float] = field(default_factory=dict)  # line index -> shift (LRC only)
    segments: list[dict] = field(default_factory=list)
    strong: float = STRONG_FLOOR  # this song's strong line score

    def confidence_score(self, score: float) -> float:
        """An anchor's model score on the 0-1 scale of line confidence: an anchor passed the
        checks above, so its score counts from 0.6 up, reaching 1 at the strong score."""
        return round(min(1.0, 0.6 + 0.4 * max(0.0, score) / max(self.strong, 1e-6)), 4)


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if number == number and abs(number) != float("inf") else default


def candidate(result: dict | None, words: list[str], strong: float, weak: float) -> str | None:
    """ "strong", "weak" or None for one line's song-pass result. ``words`` are the line's
    normalized words ("" for a word the model cannot align)."""
    if not isinstance(result, dict) or result.get("status") != "ok":
        return None
    raw = result.get("words") or []
    alignable = [w for w in words if w]
    if len(raw) != len(words) or not alignable:
        return None
    placed = sum(1 for w in raw if w)
    if placed < PLACED_SHARE * len(alignable):
        return None
    letters = sum(len(w) for w in alignable)
    if letters < MIN_LETTERS:
        return None
    start, end = _num(result.get("start")), _num(result.get("end"))
    span = end - start
    if span <= 0 or letters / span > MAX_LETTERS_PER_SEC:
        return None
    if span > MAX_SEC_BASE + MAX_SEC_PER_WORD * len(alignable):
        return None
    score = _num(result.get("line_score"))
    if score >= strong:
        return "strong"
    return "weak" if score >= weak else None


def _agreeing_runs(indices: list[int], shifts: dict[int, float], tolerance: float):
    """Maximal runs of consecutive candidates whose shifts stay within ``tolerance`` of the
    run's median."""
    runs: list[list[int]] = []
    for index in indices:
        if runs:
            run = runs[-1]
            median = statistics.median(shifts[i] for i in run)
            if abs(shifts[index] - median) <= tolerance:
                run.append(index)
                continue
        runs.append([index])
    return runs


def accept_timed(tiers: dict[int, str], shifts: dict[int, float]) -> tuple[set[int], list[dict]]:
    """Anchors for lyrics with line timing, and the runs of agreeing anchors (segments)."""
    order = sorted(tiers)
    accepted: set[int] = set()
    for pos, index in enumerate(order):
        if tiers[index] != "strong" or abs(shifts[index]) > MAX_SHIFT:
            continue
        near = order[max(0, pos - NEIGHBOURS) : pos] + order[pos + 1 : pos + 1 + NEIGHBOURS]
        if any(abs(shifts[j] - shifts[index]) <= STRONG_AGREEMENT for j in near):
            accepted.add(index)
    for run in _agreeing_runs(order, shifts, WEAK_AGREEMENT):
        if len(run) >= WEAK_RUN and all(abs(shifts[i]) <= MAX_SHIFT for i in run):
            accepted.update(run)
    # A short segment far from both neighbours is more likely a wrong instance (a repeated
    # chorus matched in the wrong place) than a real jump in the lyrics file's timing
    while True:
        segments = _segments(accepted, shifts)
        isolated = []
        for k, seg in enumerate(segments):
            others = [segments[j]["offset"] for j in (k - 1, k + 1) if 0 <= j < len(segments)]
            far = others and all(abs(seg["offset"] - o) > 5.0 for o in others)
            if far and seg["anchors"] < WEAK_RUN:
                isolated.append(seg)
        if not isolated:
            return accepted, segments
        for seg in isolated:
            accepted.difference_update(range(seg["first_line"], seg["last_line"] + 1))


def _segments(accepted: set[int], shifts: dict[int, float]) -> list[dict]:
    return [
        {
            "first_line": run[0],
            "last_line": run[-1],
            "offset": round(statistics.median(shifts[i] for i in run), 3),
            "anchors": len(run),
        }
        for run in _agreeing_runs(sorted(accepted), shifts, STRONG_AGREEMENT)
    ]


def offset_at(index: int, accepted: list[int], shifts: dict[int, float], segments) -> float:
    """The lyrics file's shift at a line: interpolated between the anchors around it inside
    a segment, else the nearer segment's shift."""
    before = [i for i in accepted if i <= index]
    after = [i for i in accepted if i >= index]
    if before and after:
        lo, hi = before[-1], after[0]
        same = any(s["first_line"] <= lo and hi <= s["last_line"] for s in segments)
        if lo == hi:
            return shifts[lo]
        if same:
            return shifts[lo] + (shifts[hi] - shifts[lo]) * (index - lo) / (hi - lo)
        return shifts[lo] if index - lo <= hi - index else shifts[hi]
    if before:
        return shifts[before[-1]]
    if after:
        return shifts[after[0]]
    return 0.0


def plan(
    song_lines: list[dict],
    words_by_index: dict[int, list[str]],
    source_starts: dict[int, float] | None,
    null_score: float | None = None,
) -> AnchorPlan:
    """The anchors for a song. ``song_lines`` are the worker's song-pass results,
    ``words_by_index`` the normalized words of every line that was sent, ``source_starts``
    the lyrics' own line starts when they are timed (None for plain lyrics) and
    ``null_score`` the song pass's baseline."""
    results = {
        r.get("index"): r for r in song_lines if isinstance(r, dict) and r.get("index") is not None
    }
    null = _num(null_score, DEFAULT_NULL_SCORE) if null_score is not None else DEFAULT_NULL_SCORE
    null = max(0.0, null)
    strong = max(STRONG_FLOOR, STRONG_TIMES_NULL * null)
    weak = max(WEAK_FLOOR, WEAK_TIMES_NULL * null)
    tiers = {}
    for index, words in words_by_index.items():
        tier = candidate(results.get(index), words, strong, weak)
        if tier:
            tiers[index] = tier
    scores = [_num(r.get("line_score")) for r in results.values() if r.get("status") == "ok"]
    alignable = len(words_by_index)
    needed = max(MIN_ANCHORS, MIN_ANCHOR_SHARE * alignable)

    if source_starts is not None:
        shifts = {
            i: _num(results[i].get("start")) - source_starts[i] for i in tiers if i in source_starts
        }
        tiers = {i: t for i, t in tiers.items() if i in shifts}
        accepted, segments = accept_timed(tiers, shifts)
    else:
        shifts = {}
        accepted = {i for i, tier in tiers.items() if tier == "strong"}
        segments = []

    if not scores or statistics.median(scores) < max(SONG_FLOOR, SONG_TIMES_NULL * null):
        return AnchorPlan("rejected", "the lyrics barely fit the vocals")
    if len(accepted) < needed:
        return AnchorPlan(
            "rejected", f"only {len(accepted)} of {alignable} lines were placed reliably"
        )

    anchors = {i: results[i] for i in sorted(accepted)}
    offsets = {}
    if source_starts is not None:
        ordered = sorted(accepted)
        offsets = {
            i: round(offset_at(i, ordered, shifts, segments), 3) for i in sorted(source_starts)
        }
    return AnchorPlan("ok", None, anchors, results, offsets, segments, strong)
