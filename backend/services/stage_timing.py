"""When things show in a video and on the stage: which lines follow an instrumental gap, when
each line appears and takes the reading place, and when the title cards, the count-in and the
break marker show. The numbers are shared with the stage (the ``timing`` block of
backend/assets/shared/stage_looks.json), whose copy of plan_timeline is
frontend/src/utils/stageTimeline.ts; both suites run stage_timeline_cases.json. The YouTube
kit's chapters follow the gap rule too."""

from dataclasses import dataclass, field
from typing import Any

from backend.services.ass_document import safe_time
from backend.services.stage_looks import TIMING
from backend.shared_assets import load

# The countdown's rule, which the YouTube kit's chapters (youtube_uploader) follow too: a
# silence of INSTRUMENTAL_GAP_THRESHOLD_SECONDS or more before a line is an instrumental gap
# (the stage's frontend/src/utils/gapDetection.ts uses the same threshold), and the countdown
# starts COUNTDOWN_LEAD_IN_SECONDS before that line.
INSTRUMENTAL_GAP_THRESHOLD_SECONDS: float = TIMING["gap_threshold"]
COUNTDOWN_LEAD_IN_SECONDS: float = TIMING["count_in"]
# During a gap the video says so (GapLabel) from GAP_LABEL_DELAY_SECONDS into it until the next
# line shows; after the last line a title card shows from OUTRO_DELAY_SECONDS on, to the
# song's end, when that leaves OUTRO_MIN_SECONDS for it
GAP_LABEL_DELAY_SECONDS: float = TIMING["break_delay"]
OUTRO_DELAY_SECONDS: float = TIMING["end_delay"]
OUTRO_MIN_SECONDS: float = TIMING["end_min"]


def line_span(line: dict) -> tuple[float, float]:
    """A line's (start, end) in seconds: a missing or bad start is 0, a missing or bad end is
    4 s after the start, and the end is never before the start."""
    start = safe_time(line.get("start_time"), 0.0)
    end = max(start, safe_time(line.get("end_time"), start + 4.0))
    return start, end


def instrumental_gaps(lines: Any) -> list[int]:
    """The indexes of the lines that come after an instrumental gap: a silence of at least
    INSTRUMENTAL_GAP_THRESHOLD_SECONDS since the song's start, or since the latest end of
    any line before it. Entries that are not dicts are skipped but keep their index."""
    if not isinstance(lines, list):
        return []
    gaps: list[int] = []
    previous_end = 0.0
    for i, line in enumerate(lines):
        if not isinstance(line, dict):
            continue
        start, end = line_span(line)
        if start - previous_end >= INSTRUMENTAL_GAP_THRESHOLD_SECONDS:
            gaps.append(i)
        previous_end = max(previous_end, end)
    return gaps


def singer_part(line: dict[str, Any]) -> str:
    """Which part sings a line: "singer2", "both" or "singer1" (the default), by the singer
    labels the stage shares (backend/assets/shared/singer_aliases.json)."""
    raw = str(line.get("singer") or "singer1").strip().lower()
    return load("singer_aliases").get(raw, "singer1")


def _cs(seconds: float) -> float:
    """A time rounded to the centisecond, which is as fine as a subtitle file can say."""
    return round(max(0.0, seconds) * 100) / 100


@dataclass(frozen=True)
class LineTiming:
    """When one lyric line is on screen.

    ``show`` and ``hide`` are for looks that keep each line in a row of its own (it appears
    before it is sung and stays a moment after). ``advance`` and ``leave`` are for looks
    with one reading place: the line takes it at ``advance`` and gives it up at ``leave``."""

    index: int
    start: float
    end: float
    part: str
    gap: bool
    show: float
    hide: float
    advance: float
    leave: float
    label: bool


@dataclass(frozen=True)
class Timeline:
    """Everything a video shows and when: the lines, the opening title card, the end card,
    each count-in as (line index, from, to) and each break as (from, to, vocals at).
    ``first_show`` is when lyrics may first appear (after the title card)."""

    lines: tuple[LineTiming, ...] = ()
    title: tuple[float, float] | None = None
    end_card: tuple[float, float] | None = None
    count_ins: tuple[tuple[int, float, float], ...] = ()
    breaks: tuple[tuple[float, float, float], ...] = ()
    first_show: float = 0.0
    duration: float | None = None
    parts: frozenset[str] = field(default_factory=frozenset)


def plan_timeline(lines: Any, duration: float | None = None, cues: bool = True) -> Timeline:
    """Plans a song's lines. ``duration`` is the song's length when known (without it there
    is no end card). ``cues`` off leaves out the count-ins and break markers. Entries of
    ``lines`` that are not dicts are skipped but keep their index."""
    rules = TIMING
    entries = [(i, line) for i, line in enumerate(lines if isinstance(lines, list) else [])]
    entries = [(i, line) for i, line in entries if isinstance(line, dict)]
    spans = [line_span(line) for _, line in entries]
    parts = [singer_part(line) for _, line in entries]
    several_parts = any(part != "singer1" for part in parts)

    title = None
    if spans and spans[0][0] >= rules["title_min_intro"]:
        title_end = min(
            spans[0][0] - rules["count_in"] - rules["title_gap"],
            rules["title_start"] + rules["title_max"],
        )
        title = (_cs(rules["title_start"]), _cs(title_end))
    first_show = _cs(title[1] + rules["title_gap"]) if title else 0.0

    timed: list[LineTiming] = []
    count_ins: list[tuple[int, float, float]] = []
    breaks: list[tuple[float, float, float]] = []
    previous_end = 0.0
    previous_advance = -1.0
    for n, ((index, _line), (start, end), part) in enumerate(
        zip(entries, spans, parts, strict=True)
    ):
        gap = start - previous_end >= rules["gap_threshold"]
        if n == 0:
            show = max(0.0, start - rules["first_early_show"])
            advance = show
        else:
            if start > previous_end:
                show = max(previous_end, start - rules["early_show"])
            else:
                show = max(0.0, start - rules["early_show"])
            advance = max(start - rules["early_show"], min(previous_end, start))
        show = max(0.0, min(start, show))
        advance = _cs(max(advance, previous_advance + 0.01, 0.0))
        hide = max(show + rules["min_show"], end + rules["lead_out"])
        if cues and gap:
            count_ins.append((index, _cs(max(0.0, start - rules["count_in"])), _cs(start)))
            break_from = first_show if n == 0 else previous_end + rules["break_delay"]
            break_to = start - rules["count_in"]
            if break_to - break_from >= rules["break_min"]:
                breaks.append((_cs(break_from), _cs(break_to), _cs(start)))
        timed.append(
            LineTiming(
                index=index,
                start=start,
                end=end,
                part=part,
                gap=gap,
                show=_cs(show),
                hide=_cs(hide),
                advance=advance,
                leave=0.0,
                label=several_parts and (n == 0 or part != parts[n - 1]),
            )
        )
        previous_end = max(previous_end, end)
        previous_advance = advance

    planned: list[LineTiming] = []
    for n, line in enumerate(timed):
        leave = line.end + rules["lead_out"]
        if n + 1 < len(timed):
            leave = min(leave, timed[n + 1].advance)
        leave = _cs(max(leave, line.advance + 0.01))
        planned.append(LineTiming(**{**line.__dict__, "leave": leave}))

    end_card = None
    length = safe_time(duration, 0.0)
    if planned and previous_end > 0:
        card_from = previous_end + rules["end_delay"]
        if length - card_from >= rules["end_min"]:
            end_card = (_cs(card_from), _cs(length))

    return Timeline(
        lines=tuple(planned),
        title=title,
        end_card=end_card,
        count_ins=tuple(count_ins),
        breaks=tuple(breaks),
        first_show=first_show,
        duration=length or None,
        parts=frozenset(parts),
    )
