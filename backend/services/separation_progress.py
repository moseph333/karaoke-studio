"""Turns separation engine stderr into (percent, detail, eta) progress updates.

Understands tqdm bars from Demucs and audio-separator, model-weight download bars, and the
JSON events emitted by backend.workers.roformer_worker. With several passes (the "best"
ensemble runs one model after another) the restarting bars become one monotonic overall
percentage; a single pass reports the engine's own percentage unchanged.

Lines that carry no progress are kept (the last few) so failures can quote them.
Detail text deliberately avoids words the UI uses to recognise later pipeline stages.
"""

import json
import re
from collections import deque

_PCT = re.compile(r"(\d{1,3}(?:\.\d+)?)%")
_ETA = re.compile(r"<\s*(?:(\d+):)?(\d+):(\d{2})")
_COUNT = re.compile(r"\|\s*([\d.]+)\s*([kKMGT]?i?B)?\s*/\s*([\d.]+)\s*([kKMGT]?i?B)?")
_DOWNLOAD_HINT = re.compile(r"download|[kMG]i?B/s|\b[kMG]i?B\b", re.IGNORECASE)

TAIL_LINES = 15
_MAX_LINE_CHARS = 400


def parse_eta_seconds(line: str) -> int | None:
    """ETA from a tqdm "[elapsed<remaining" block, in mm:ss or h:mm:ss form."""
    match = _ETA.search(line)
    if not match:
        return None
    hours = int(match.group(1) or 0)
    return hours * 3600 + int(match.group(2)) * 60 + int(match.group(3))


class ProgressTracker:
    def __init__(
        self, passes: int = 1, engine_label: str = "Demucs AI", count_unit: str = "seconds"
    ):
        self.passes = max(1, passes)
        self.engine_label = engine_label
        # Demucs counts seconds of audio; audio-separator counts chunks
        self.count_unit = count_unit
        self.pass_index = 0
        self._last_pass_pct: float | None = None
        self.last_overall: float | None = None
        self.downloading = False
        self.tail: deque[str] = deque(maxlen=TAIL_LINES)
        self.error_detail: str | None = None

    def _overall(self, pct: float) -> float:
        if self.passes == 1:
            return pct
        overall = (self.pass_index * 100.0 + pct) / self.passes
        if self.last_overall is not None:
            overall = max(overall, self.last_overall)
        return round(min(100.0, overall), 1)

    def _advance_pass_if_restarted(self, pct: float) -> None:
        if self.passes > 1 and self._last_pass_pct is not None and pct + 40 < self._last_pass_pct:
            self.pass_index = min(self.passes - 1, self.pass_index + 1)
        self._last_pass_pct = pct

    def _pass_suffix(self) -> str:
        return f" (model {self.pass_index + 1} of {self.passes})" if self.passes > 1 else ""

    def _remember(self, text: str) -> None:
        self.tail.append(text if len(text) <= _MAX_LINE_CHARS else text[:_MAX_LINE_CHARS] + "…")

    def feed(self, line: str) -> tuple[float | None, str, int | None] | None:
        """Progress for one stderr line, or None when the line carries no progress."""
        text = line.strip()
        if not text:
            return None
        if text.startswith("{"):
            event = _parse_event(text)
            if event is not None:
                return self._feed_event(event)

        pct_match = _PCT.search(text)
        if not pct_match:
            self._remember(text)
            return None
        pct = min(100.0, float(pct_match.group(1)))
        eta = parse_eta_seconds(text)

        if _DOWNLOAD_HINT.search(text):
            self.downloading = True
            return None, f"Downloading model weights… ({pct:.0f}%)", eta

        if self.downloading:
            # First separation bar after a download: forget the download bar's position
            self.downloading = False
            self._last_pass_pct = None

        self._advance_pass_if_restarted(pct)
        overall = self._overall(pct)
        self.last_overall = overall

        count = _COUNT.search(text)
        if count and self.count_unit == "seconds":
            done, total = float(count.group(1)), float(count.group(3))
            detail = (
                f"{self.engine_label}: {done:.0f}s of {total:.0f}s of audio processed"
                f"{self._pass_suffix()} ({pct:.0f}%)"
            )
        elif count:
            detail = (
                f"{self.engine_label}: chunk {count.group(1)}/{count.group(3)}"
                f"{self._pass_suffix()} ({pct:.0f}%)"
            )
        else:
            detail = f"{self.engine_label} separating stems{self._pass_suffix()} ({pct:.0f}%)"
        return overall, detail, eta

    def _feed_event(self, event: dict) -> tuple[float | None, str, int | None] | None:
        kind = event.get("event")
        if kind == "download":
            self.downloading = True
            return None, str(event.get("detail") or "Downloading model weights…"), None
        if kind == "stage":
            if isinstance(event.get("pass"), int):
                self.pass_index = max(0, min(self.passes - 1, event["pass"] - 1))
                self._last_pass_pct = None
            self.downloading = False
            detail = str(event.get("detail") or f"{self.engine_label} working")
            pct = event.get("pct")
            if isinstance(pct, (int, float)):
                overall = self._overall(float(pct))
                self.last_overall = overall
                return overall, detail, None
            return self.last_overall, detail, None
        if kind == "error":
            self.error_detail = str(event.get("detail") or "") or None
        return None


def _parse_event(text: str) -> dict | None:
    try:
        event = json.loads(text)
    except ValueError:
        return None
    return event if isinstance(event, dict) and "event" in event else None
