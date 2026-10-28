"""How far to trust each line's word timing, judged against the vocal stem.

The evidence for a line combines two measures on a 10 ms grid:

* coverage: the share of its words' time during which the vocal stem is active, so words
  placed in silence count against it;
* onset agreement: how close the words that should start with an onset (the first word and
  any word after a pause) sit to one, scored with a Gaussian of 60 ms.

DSP-timed lines get that evidence score. Lyrics that came with their own word timing keep
at least 0.9, neural (CTC) lines blend the model's word probability with the evidence
(0.6 / 0.4), and lines timed by the no-audio fallback get a low fixed score. The vocal
analysis is cached per file path, size and modification time.
"""

import logging
import math
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from backend.services.aligner import frame_mean_square

logger = logging.getLogger(__name__)

HOP_SEC = 0.01
FRAME_SEC = 0.02
ONSET_SIGMA = 0.06
ONSET_GAP = 0.08  # a word after a pause this long should start with an onset
ACTIVE_RANGE_DB = 30.0
ONSET_RISE_DB = 6.0
LRC_FLOOR = 0.9
CTC_WEIGHT = 0.6
FALLBACK_CONFIDENCE = 0.2
_CACHE_SIZE = 8

_cache: "OrderedDict[tuple, VocalEvidence | None]" = OrderedDict()
_cache_lock = threading.Lock()


@dataclass(frozen=True)
class VocalEvidence:
    active: np.ndarray  # bool per HOP_SEC frame
    onsets: np.ndarray  # onset times in seconds, ascending

    def activity(self, start: float, end: float) -> tuple[int, int]:
        """(active frames, frames) between two times."""
        first = max(0, int(start / HOP_SEC))
        last = max(first + 1, math.ceil(end / HOP_SEC))
        window = self.active[first:last]
        return int(window.sum()), last - first


def load_evidence(path: str | Path | None) -> "VocalEvidence | None":
    """Vocal activity and onsets of a stem, or None when it cannot be read."""
    if not path:
        return None
    file_path = Path(path)
    try:
        stat = file_path.stat()
    except OSError:
        return None
    key = (str(file_path.resolve()), stat.st_size, stat.st_mtime_ns)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]
    try:
        evidence = _analyze(file_path)
    except Exception as exc:  # unreadable or degenerate audio: no evidence
        logger.debug(f"No vocal evidence for {file_path.name}: {exc}")
        evidence = None
    with _cache_lock:
        _cache[key] = evidence
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return evidence


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def _analyze(path: Path) -> VocalEvidence | None:
    data, rate = sf.read(str(path), dtype="float32", always_2d=True)
    mono = np.ascontiguousarray(data.mean(axis=1)) if data.shape[1] > 1 else data[:, 0]
    if not np.isfinite(mono).all():
        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0)
    hop = max(1, int(HOP_SEC * rate))
    frame = max(hop, int(FRAME_SEC * rate))
    frames = (len(mono) - frame) // hop
    if rate <= 0 or frames <= 0:
        return None
    energy = frame_mean_square(mono, frame, hop, frames).astype(np.float64)
    db = 10.0 * np.log10(energy + 1e-12)
    reference = float(np.percentile(db, 95))
    if reference < -70.0:  # silence
        return VocalEvidence(np.zeros(frames, dtype=bool), np.zeros(0))
    active = (db > reference - ACTIVE_RANGE_DB) & (energy > 1e-7)

    # Onset: energy rising by ONSET_RISE_DB within 30 ms into an active frame, taking the
    # steepest frame of each rise
    lookback = np.full(frames, np.inf)
    for lag in (1, 2, 3):
        lookback[lag:] = np.minimum(lookback[lag:], db[:-lag])
    rise = np.where(active, db - lookback, 0.0)
    candidate = rise >= ONSET_RISE_DB
    onsets = []
    last = -10
    for i in np.flatnonzero(candidate):
        if i - last <= 3:
            if rise[i] > rise[last]:
                onsets[-1] = i
                last = i
            continue
        onsets.append(i)
        last = i
    return VocalEvidence(active, np.asarray(onsets, dtype=np.float64) * HOP_SEC)


def _timed_words(words) -> list[tuple[float, float]]:
    spans = []
    for word in words or []:
        if not isinstance(word, dict):
            continue
        try:
            start, end = float(word.get("start_time")), float(word.get("end_time"))
        except (TypeError, ValueError):
            continue
        if math.isfinite(start) and math.isfinite(end) and end > start:
            spans.append((start, end))
    return spans


def evidence_score(words, evidence: VocalEvidence | None) -> float | None:
    """0-1 support for a line's word timing in the vocal stem, or None without evidence."""
    spans = _timed_words(words)
    if evidence is None or not spans:
        return None
    covered = total = 0
    for start, end in spans:
        active, frames = evidence.activity(start, end)
        covered += active
        total += frames
    coverage = covered / total if total else 0.0

    expected = [spans[0][0]] + [
        start
        for (start, _), (_, prev_end) in zip(spans[1:], spans, strict=False)
        if start - prev_end >= ONSET_GAP
    ]
    onsets = evidence.onsets
    if len(onsets) == 0:
        agreement = 0.0
    else:
        starts = np.asarray(expected)
        idx = np.searchsorted(onsets, starts)
        before = np.where(idx > 0, starts - onsets[np.maximum(idx - 1, 0)], np.inf)
        after = np.where(
            idx < len(onsets), onsets[np.minimum(idx, len(onsets) - 1)] - starts, np.inf
        )
        distance = np.minimum(np.abs(before), np.abs(after))
        agreement = float(np.mean(np.exp(-(distance**2) / (2 * ONSET_SIGMA**2))))
    return round(0.5 * coverage + 0.5 * agreement, 3)


def line_confidence(
    method: str, evidence: float | None, ctc_score: float | None = None
) -> float | None:
    """Confidence for a line timed by ``method`` (ctc, dsp, lrc, fallback or manual)."""
    if method == "manual":
        return None
    if method == "fallback":
        return FALLBACK_CONFIDENCE
    if method == "lrc":
        value = max(LRC_FLOOR, evidence or 0.0)
    elif method == "ctc" and ctc_score is not None:
        support = evidence if evidence is not None else ctc_score
        value = CTC_WEIGHT * ctc_score + (1 - CTC_WEIGHT) * support
    else:
        if evidence is None:
            return None
        value = evidence
    return round(min(1.0, max(0.0, value)), 3)
