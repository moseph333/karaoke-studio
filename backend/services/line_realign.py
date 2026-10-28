"""Re-time one lyric line where it is sung, near its current place.

realign_line() searches a window around the line's current timing (never past its
neighbours) for the vocal phrase that best matches it: a phrase start close to the current
start, singing for most of the line's length, ending at a vocal release. The DSP word aligner
then times the words inside that span. When the neural aligner can run and has a free slot,
the CTC model also searches the whole window and its timing wins if it is confident.

Nothing is saved: the studio applies the returned line as an undoable edit.
"""

import math
import time
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import soundfile as sf

from backend.services import alignment_config
from backend.services.aligner import align_words_spectral
from backend.services.lyric_sync import (
    NeuralAlignmentFailed,
    merge_line,
    neural_slot,
    run_neural_pass,
)
from backend.services.lyric_tokenize import normalize_for_mms, tokenize_lyric_text
from backend.services.sync_confidence import (
    HOP_SEC,
    VocalEvidence,
    evidence_score,
    line_confidence,
    load_evidence,
)

DEFAULT_SEARCH_WINDOW = 1.5
MAX_SEARCH_WINDOW = 3.0
MIN_LINE = 0.3
SECONDS_PER_WORD = 0.3  # assumed sung length of a word when the line has no real timing yet
PHRASE_GAP = 0.12  # quiet before a phrase start
RELEASE_GAP = 0.25  # quiet after a phrase end
HANGOVER = 0.1  # a sung phrase decays a little past its last loud frame
LEAD_IN = 0.15
MIN_COVERAGE = 0.15
LEAD_SILENCE_WEIGHT = 0.3
DISTANCE_WEIGHT = 0.4
AUDIO_PAD = 0.1


class LineRealignError(ValueError):
    """The line or the vocal stem cannot be re-aligned (shown to the user)."""


@dataclass
class LineRealignResult:
    status: str  # "ok", or "not_found" when no singing fits the window
    line: dict[str, Any]
    engine: str  # "ctc" or "dsp": the aligner that timed the returned line
    elapsed: float
    fallback_reason: str | None = None
    detail: str | None = None
    window: tuple[float, float] = field(default=(0.0, 0.0))


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def line_words(line: dict) -> list[str]:
    """The words to time: the line's current words, or its text split like the studio does."""
    words = [
        str(w.get("word") or "").strip() for w in line.get("words") or [] if isinstance(w, dict)
    ]
    words = [w for w in words if w]
    return words or tokenize_lyric_text(str(line.get("text") or ""))


def search_bounds(
    start: float,
    end: float,
    duration: float,
    window: float,
    prev_end: float | None = None,
    next_start: float | None = None,
) -> tuple[float, float]:
    """The stretch of the song to search: the line plus ``window`` seconds on each side,
    inside the song and between the neighbouring lines."""
    lo = max(0.0, start - window, prev_end if prev_end is not None else 0.0)
    hi = min(duration, end + window)
    if next_start is not None:
        hi = min(hi, next_start)
    return round(lo, 3), round(hi, 3)


def _fraction_active(evidence: VocalEvidence, start: float, end: float) -> float:
    if end <= start:
        return 0.0
    active, frames = evidence.activity(start, end)
    return active / frames if frames else 0.0


def _phrase_starts(evidence: VocalEvidence, lo: float, hi: float) -> list[float]:
    """Times in [lo, hi] where singing starts after at least PHRASE_GAP of quiet."""
    first, last = int(lo / HOP_SEC), min(len(evidence.active), math.ceil(hi / HOP_SEC))
    if last - first < 2:
        return []
    window = evidence.active[first:last]
    gap = round(PHRASE_GAP / HOP_SEC)
    starts = []
    for i in np.flatnonzero(window[1:] & ~window[:-1]) + 1:
        index = first + int(i)
        if not evidence.active[max(0, index - gap) : index].any():
            starts.append(index * HOP_SEC)
    if window[0] and (first == 0 or not evidence.active[first - 1]):
        starts.insert(0, first * HOP_SEC)
    return starts


def _release_near(evidence: VocalEvidence, start: float, target: float, hi: float) -> float:
    """End of singing closest to ``target``: the last loud frame before RELEASE_GAP of quiet,
    looked for up to a second past the target, plus a short decay."""
    first = int((start + MIN_LINE) / HOP_SEC)
    limit = min(hi, target + 1.0)
    last = min(len(evidence.active), math.ceil(limit / HOP_SEC))
    if last <= first:
        return min(hi, target)
    gap = round(RELEASE_GAP / HOP_SEC)
    active = evidence.active
    candidates = [
        (index + 1) * HOP_SEC
        for index in range(first, last)
        if active[index] and not active[index + 1 : index + 1 + gap].any()
    ]
    if not candidates:
        return min(hi, target)
    best = min(candidates, key=lambda t: abs(t - target))
    return min(hi, best + HANGOVER)


def locate_phrase(
    evidence: VocalEvidence,
    start: float,
    end: float,
    lo: float,
    hi: float,
    n_words: int,
    window: float = DEFAULT_SEARCH_WINDOW,
) -> tuple[float, float] | None:
    """Where in [lo, hi] the line is most likely sung, or None without singing there."""
    span = hi - lo
    if span < MIN_LINE:
        return None
    length = end - start
    if length < MIN_LINE:
        length = SECONDS_PER_WORD * max(1, n_words)
    length = min(max(length, MIN_LINE), span)
    reach = max(window, 0.5)

    candidates = {round(min(max(start, lo), hi - length), 3)}
    candidates.update(t for t in _phrase_starts(evidence, lo, hi - MIN_LINE))
    best, best_score = None, -math.inf
    for candidate in sorted(candidates):
        stop = min(hi, candidate + length)
        coverage = _fraction_active(evidence, candidate, stop)
        if candidate - lo >= LEAD_IN / 2:
            lead_silence = 1.0 - _fraction_active(evidence, max(lo, candidate - LEAD_IN), candidate)
        else:
            lead_silence = 0.5  # at the window edge (often the previous line's end): unknown
        score = (
            coverage
            + LEAD_SILENCE_WEIGHT * lead_silence
            - DISTANCE_WEIGHT * abs(candidate - start) / reach
        )
        if score > best_score:
            best, best_score = candidate, score
    if best is None or _fraction_active(evidence, best, min(hi, best + length)) < MIN_COVERAGE:
        return None
    stop = _release_near(evidence, best, best + length, hi)
    return round(best, 3), round(max(stop, best + MIN_LINE), 3)


def _dsp_words(
    vocals_path: str, sample_rate: int, words: list[str], start: float, end: float
) -> list[dict]:
    """Word timing inside [start, end] from the DSP word aligner, reading only that audio."""
    first = max(0, int((start - AUDIO_PAD) * sample_rate))
    stop = int((end + AUDIO_PAD) * sample_rate)
    try:
        audio, _ = sf.read(vocals_path, start=first, stop=stop, dtype="float32", always_2d=True)
    except Exception as exc:
        raise LineRealignError("The vocal stem could not be read") from exc
    mono = audio.mean(axis=1) if audio.shape[1] > 1 else audio[:, 0]
    offset = first / sample_rate
    timed = align_words_spectral(
        np.ascontiguousarray(mono, dtype=np.float32),
        sample_rate,
        words,
        start - offset,
        end - offset,
    )
    return [
        {
            "word": w["word"],
            "start_time": round(float(w["start_time"]) + offset, 3),
            "end_time": round(float(w["end_time"]) + offset, 3),
        }
        for w in timed
    ]


def requested_line_engine(engine: str | None) -> str:
    """The engine to try for a single line: the server setting unless the request asks for a
    lighter one. A server pinned to the DSP aligner never runs the neural one."""
    configured = alignment_config.requested_engine()
    if configured == "dsp":
        return "dsp"
    return alignment_config.normalize_engine(engine) or configured


def realign_line(
    vocals_path: str,
    line: dict,
    *,
    prev_end: float | None = None,
    next_start: float | None = None,
    engine: str | None = None,
    search_window: float = DEFAULT_SEARCH_WINDOW,
) -> LineRealignResult:
    """Finds and times ``line`` near its current place. See the module docstring."""
    started = time.monotonic()
    words = line_words(line)
    if not words:
        raise LineRealignError("This line has no words to align")
    try:
        info = sf.info(vocals_path)
    except Exception as exc:
        raise LineRealignError("The vocal stem could not be read") from exc
    evidence = load_evidence(vocals_path)
    if evidence is None or info.samplerate <= 0:
        raise LineRealignError("The vocal stem could not be read")

    window = min(max(_num(search_window, DEFAULT_SEARCH_WINDOW), 0.1), MAX_SEARCH_WINDOW)
    start = max(0.0, _num(line.get("start_time")))
    end = max(start, _num(line.get("end_time"), start))
    # An untimed line (start == end) is searched for as long as its words take to sing
    reach_end = end if end - start >= MIN_LINE else start + SECONDS_PER_WORD * len(words)
    lo, hi = search_bounds(start, reach_end, float(info.duration), window, prev_end, next_start)

    def finish(status, result_line, used, reason=None, detail=None):
        return LineRealignResult(
            status=status,
            line=result_line,
            engine=used,
            elapsed=round(time.monotonic() - started, 3),
            fallback_reason=reason,
            detail=detail,
            window=(lo, hi),
        )

    if hi - lo < MIN_LINE:
        return finish("not_found", dict(line), "dsp", detail="There is no room to move this line")

    requested = requested_line_engine(engine)
    effective, reason = alignment_config.effective_engine(requested)
    located = locate_phrase(evidence, start, end, lo, hi, len(words), window)
    if located is None and effective != "ctc":
        return finish(
            "not_found",
            dict(line),
            "dsp",
            reason,
            detail=f"No singing found within {window:g} s of this line",
        )

    if located is None:  # let the neural aligner search; start from the current timing
        span_start = min(max(lo, start), hi - MIN_LINE)
        span_end = min(hi, max(end, span_start + MIN_LINE))
    else:
        span_start, span_end = located
    dsp_line = {k: v for k, v in line.items() if k not in ("has_word_sync", "confidence")}
    dsp_line.update(
        start_time=span_start,
        end_time=span_end,
        words=_dsp_words(vocals_path, info.samplerate, words, span_start, span_end),
    )

    merged, method, score = dsp_line, "dsp", None
    if effective == "ctc":
        normalized = [normalize_for_mms(w) for w in words]
        if any(normalized):
            request = [{"index": 0, "window_start": lo, "window_end": hi, "words": normalized}]
            try:
                with neural_slot(wait=False):
                    response = run_neural_pass(vocals_path, request)
                neural = next(
                    (x for x in response["lines"] if isinstance(x, dict) and x.get("index") == 0),
                    None,
                )
                alignable = sum(1 for w in normalized if w)
                merged, method, score = merge_line(
                    dsp_line, neural, (lo, hi), alignable, widen_to_dsp=False
                )
            except NeuralAlignmentFailed as exc:
                reason = str(exc)
        else:
            reason = "the words cannot be spelled for the neural aligner"
    if method == "dsp" and located is None:
        return finish(
            "not_found",
            dict(line),
            "dsp",
            reason,
            detail=f"No singing found within {window:g} s of this line",
        )

    result = dict(merged)
    result["align_method"] = method
    confidence = line_confidence(method, evidence_score(result.get("words"), evidence), score)
    if confidence is None:
        result.pop("confidence", None)
    else:
        result["confidence"] = confidence
    return finish("ok", result, "ctc" if method == "ctc" else "dsp", reason)
