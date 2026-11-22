"""When things show in an exported video: which lines follow an instrumental gap, how early
the count-in starts, and which part sings a line. The YouTube kit's chapters follow the same rule."""

from typing import Any

from backend.services.ass_document import safe_time
from backend.shared_assets import load

# The countdown's rule, which the YouTube kit's chapters (youtube_uploader) follow too: a
# silence of INSTRUMENTAL_GAP_THRESHOLD_SECONDS or more before a line is an instrumental gap
# (the stage's frontend/src/utils/gapDetection.ts uses the same threshold), and the countdown
# starts COUNTDOWN_LEAD_IN_SECONDS before that line.
INSTRUMENTAL_GAP_THRESHOLD_SECONDS = 4.0
COUNTDOWN_LEAD_IN_SECONDS = 3.0
# During a gap the video says so (GapLabel) from GAP_LABEL_DELAY_SECONDS into it until the next
# line shows; after the last line a title card shows from OUTRO_DELAY_SECONDS on, to the
# song's end, when that leaves OUTRO_MIN_SECONDS for it
GAP_LABEL_DELAY_SECONDS = 1.5
OUTRO_DELAY_SECONDS = 1.5
OUTRO_MIN_SECONDS = 3.0


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
