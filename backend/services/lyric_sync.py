"""Lyric synchronisation: line and word timing for a song's lyrics against its vocal stem.

sync_lyrics() always runs the DSP aligner (backend.services.aligner) first. When the neural
CTC aligner can run (see alignment_config), it then aligns every line's words inside a
window around the DSP line in a separate process (backend.workers.ctc_align_worker) and keeps
the neural timing for lines the model is sure about. Every line gets a confidence score and
an ``align_method`` (ctc, dsp, lrc or fallback), and a report says how the song was timed.

Lyrics that arrive with their own word timing (enhanced LRC) keep it. If the neural pass is
unavailable or fails, the whole song keeps the DSP timing and the report records why.
"""

import itertools
import json
import logging
import math
import statistics
import subprocess
import sys
import tempfile
import time
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.services import alignment_config
from backend.services.aligner import enforce_monotonic_words
from backend.services.lyric_tokenize import normalize_for_mms
from backend.services.process_watchdog import ProcessWatchdog, duration_text, quietly, worker_env
from backend.services.sync_confidence import evidence_score, line_confidence, load_evidence

logger = logging.getLogger(__name__)

REPORT_VERSION = 1
LINE_GUARD = 0.75  # seconds of context on each side of a line for the neural pass
MIN_WORD = 0.08
JOIN_GAP = 0.35
LAST_WORD_MIN = 0.25
MIN_ALIGNED_SHARE = 0.7
LOW_CONFIDENCE = 0.6  # matches the studio's "Needs review" threshold (timelineReview.ts)

ProgressCallback = Callable[[float | None, str], None]


class AlignmentCancelled(RuntimeError):
    """The user cancelled while lyrics were being aligned."""


class NeuralAlignmentFailed(RuntimeError):
    """The neural aligner could not run or produced nothing usable."""


@dataclass
class SyncResult:
    lines: list[dict[str, Any]]
    report: dict[str, Any]
    lyric_timing: str = "none"
    methods: list[str] = field(default_factory=list)


def _num(value: Any, default: float = 0.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return number if math.isfinite(number) else default


def source_timing(lines: list[dict]) -> str:
    """ "word" when the lyrics carry word timing, "line" for line timing, else "none"."""
    if any(line.get("has_word_sync") and line.get("words") for line in lines):
        return "word"
    if any(_num(line.get("start_time")) > 0 or _num(line.get("end_time")) > 0 for line in lines):
        return "line"
    return "none"


def _plain_line(line: dict) -> dict:
    keep = {k: line[k] for k in ("id", "text", "singer") if k in line}
    keep["start_time"], keep["end_time"] = line.get("start_time"), line.get("end_time")
    return keep


def _dsp_pass(aligner, vocals_path: str, lines: list[dict], timing: str) -> list[dict]:
    aligned = aligner.align_lyrics(vocals_path, lines)
    if not isinstance(aligned, list):
        return []
    if timing == "none" and aligned and alignment_config.refine_plain_lyrics():
        # Plain lyrics were placed on vocal phrases; a second, timed pass snaps each line to
        # the phrase onsets and releases before timing the words again
        refined = aligner.align_lyrics(vocals_path, [_plain_line(x) for x in aligned])
        if isinstance(refined, list) and len(refined) == len(aligned):
            return refined
    return aligned


def _windows(lines: list[dict]) -> list[tuple[float, float]]:
    """Non-overlapping neural search windows: each line plus LINE_GUARD, split halfway into
    the gap with its neighbours."""
    spans = [(_num(x.get("start_time")), _num(x.get("end_time"))) for x in lines]
    out = []
    for i, (start, end) in enumerate(spans):
        lo, hi = max(0.0, start - LINE_GUARD), end + LINE_GUARD
        if i > 0:
            lo = max(lo, (spans[i - 1][1] + start) / 2)
        if i + 1 < len(spans):
            hi = min(hi, (end + spans[i + 1][0]) / 2)
        out.append((round(lo, 3), round(max(hi, lo + 0.2), 3)))
    return out


def _report_progress(progress: ProgressCallback | None, pct: float | None, detail: str) -> None:
    if progress:
        progress(pct, detail)


def run_neural_pass(
    vocals_path: str,
    request_lines: list[dict],
    progress: ProgressCallback | None = None,
    cancel_event: Any | None = None,
) -> dict:
    """Runs the CTC worker on the given line windows and returns its response."""
    request = {
        "version": 1,
        "audio": str(Path(vocals_path).resolve()),
        "model_dir": str(alignment_config.model_dir().resolve()),
        "allow_download": alignment_config.downloads_allowed(),
        "lines": request_lines,
    }
    with tempfile.TemporaryDirectory(prefix="karaoke-align-") as tmp:
        request_path, response_path = Path(tmp) / "request.json", Path(tmp) / "response.json"
        request_path.write_text(json.dumps(request), encoding="utf-8")
        cmd = [
            sys.executable,
            "-u",
            "-m",
            "backend.workers.ctc_align_worker",
            "--request",
            str(request_path),
            "--response",
            str(response_path),
        ]
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=worker_env(),
        )
        watchdog = ProcessWatchdog(
            process,
            cancel_event,
            alignment_config.timeout_seconds(),
            alignment_config.stall_seconds(),
            label="lyric alignment",
        )
        watchdog.start()
        tail: deque[str] = deque(maxlen=15)
        error_detail = None
        try:
            if process.stderr:
                for raw in process.stderr:
                    watchdog.touch()
                    if cancel_event is not None and cancel_event.is_set():
                        raise AlignmentCancelled("Lyric alignment cancelled by user")
                    text = raw.strip()
                    event = _parse_event(text)
                    if event is None:
                        if text:
                            tail.append(text[:400])
                        continue
                    kind = event.get("event")
                    if kind == "error":
                        error_detail = str(event.get("detail") or "") or None
                    elif kind == "download":
                        _report_progress(progress, None, str(event.get("detail") or ""))
                    elif kind == "stage":
                        done, total = event.get("done"), event.get("total")
                        pct = 30 + 65 * done / total if done and total else None
                        _report_progress(progress, pct, str(event.get("detail") or ""))
            process.wait()
        finally:
            watchdog.halt()
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        pass
            if process.stderr:
                quietly(process.stderr.close)
            watchdog.join(timeout=1)

        if (cancel_event is not None and cancel_event.is_set()) or watchdog.reason == "cancelled":
            raise AlignmentCancelled("Lyric alignment cancelled by user")
        if watchdog.reason == "timeout":
            limit = duration_text(alignment_config.timeout_seconds())
            raise NeuralAlignmentFailed(f"neural alignment stopped after {limit}")
        if watchdog.reason == "stalled":
            limit = duration_text(alignment_config.stall_seconds())
            raise NeuralAlignmentFailed(f"neural alignment printed nothing for {limit}")
        if process.returncode != 0:
            detail = error_detail or (tail[-1] if tail else "no details")
            raise NeuralAlignmentFailed(
                f"neural aligner exited with {process.returncode}: {detail}"
            )
        try:
            response = json.loads(response_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise NeuralAlignmentFailed(f"neural aligner wrote no usable result: {exc}") from exc
    if not isinstance(response, dict) or not isinstance(response.get("lines"), list):
        raise NeuralAlignmentFailed("neural aligner returned an unexpected result")
    return response


def _parse_event(text: str) -> dict | None:
    if not text.startswith("{"):
        return None
    try:
        event = json.loads(text)
    except ValueError:
        return None
    return event if isinstance(event, dict) and "event" in event else None


def finish_neural_words(
    raw: list[dict | None], window_end: float
) -> list[tuple[float, float] | None]:
    """Word spans from the model with sung lengths: a minimum length, short gaps closed (a
    word lasts until just before the next one) and a held last word."""
    spans: list[tuple[float, float] | None] = []
    for word in raw:
        if not word:
            spans.append(None)
            continue
        start = _num(word.get("start"))
        end = max(_num(word.get("end")), start + MIN_WORD)
        spans.append((start, end))
    known = [i for i, span in enumerate(spans) if span]
    for here, nxt in itertools.pairwise(known):
        start, end = spans[here]
        next_start = spans[nxt][0]
        if next_start - end < JOIN_GAP:
            end = max(start + 0.01, next_start - 0.01)
        spans[here] = (start, end)
    if known:
        start, end = spans[known[-1]]
        spans[known[-1]] = (
            start,
            min(max(end, start + LAST_WORD_MIN), max(window_end, start + 0.05)),
        )
    return spans


def fill_missing(
    words: list[str], spans: list[tuple[float, float] | None], line_start: float, line_end: float
) -> list[tuple[float, float]]:
    """Spans for words the model could not place, shared out between their neighbours by
    word length."""
    filled = list(spans)
    i = 0
    while i < len(filled):
        if filled[i] is not None:
            i += 1
            continue
        j = i
        while j < len(filled) and filled[j] is None:
            j += 1
        left = filled[i - 1][1] if i > 0 else line_start
        right = filled[j][0] if j < len(filled) else line_end
        if right <= left:
            right = left + 0.1 * (j - i)
        weights = [max(1, len(words[k])) for k in range(i, j)]
        total = sum(weights)
        cursor = left
        for k, weight in zip(range(i, j), weights, strict=True):
            length = (right - left) * weight / total
            filled[k] = (cursor, cursor + length)
            cursor += length
        i = j
    return [span for span in filled if span is not None]


def merge_line(dsp_line: dict, neural: dict | None, window: tuple[float, float], alignable: int):
    """The line to keep, and its method: neural timing when the model is confident enough
    and placed most words, otherwise the DSP timing."""
    words = [w for w in dsp_line.get("words") or [] if isinstance(w, dict)]
    if not neural or neural.get("status") != "ok" or not words:
        return dsp_line, "dsp", None
    raw = neural.get("words") or []
    score = _num(neural.get("line_score"))
    placed = sum(1 for w in raw if w)
    if (
        len(raw) != len(words)
        or score < alignment_config.min_confidence()
        or placed < MIN_ALIGNED_SHARE * max(1, alignable)
    ):
        return dsp_line, "dsp", score

    spans = finish_neural_words(raw, window[1])
    known = [s for s in spans if s]
    line_start = max(window[0], min(_num(dsp_line.get("start_time")), known[0][0]))
    line_end = min(window[1], max(_num(dsp_line.get("end_time")), known[-1][1]))
    if line_end <= line_start:
        line_end = line_start + 0.5
    texts = [str(w.get("word") or "") for w in words]
    timed = enforce_monotonic_words(
        texts, fill_missing(texts, spans, line_start, line_end), line_start, line_end
    )
    merged = dict(dsp_line)
    merged.update(start_time=round(line_start, 3), end_time=round(line_end, 3), words=timed)
    return merged, "ctc", score


def sync_lyrics(
    vocals_path: str,
    lines: list[dict],
    *,
    lyric_data: dict | None = None,
    engine: str | None = None,
    progress: ProgressCallback | None = None,
    cancel_event: Any | None = None,
    aligner: Any | None = None,
) -> SyncResult:
    """Times ``lines`` against the vocal stem. See the module docstring. ``aligner`` defaults
    to the server's DSP aligner (backend.main.aligner)."""
    if aligner is None:
        import backend.main as main_mod

        aligner = main_mod.aligner
    started = time.monotonic()
    requested = alignment_config.normalize_engine(engine) or alignment_config.requested_engine()
    timing = source_timing(lines or [])
    _report_progress(progress, 5, "Aligning lyrics to vocal acoustic energy envelopes...")
    dsp_lines = _dsp_pass(aligner, vocals_path, list(lines or []), timing)
    if cancel_event is not None and cancel_event.is_set():
        raise AlignmentCancelled("Lyric alignment cancelled by user")

    effective, fallback_reason = alignment_config.effective_engine(requested)
    keep_source = [bool(x.get("has_word_sync") and x.get("words")) for x in dsp_lines]
    neural_by_index: dict[int, dict] = {}
    alignable_counts: dict[int, int] = {}
    windows = _windows(dsp_lines)

    if effective == "ctc" and dsp_lines:
        request_lines = []
        for i, line in enumerate(dsp_lines):
            if keep_source[i]:
                continue
            normalized = [
                normalize_for_mms(str(w.get("word") or ""))
                for w in line.get("words") or []
                if isinstance(w, dict)
            ]
            if not any(normalized):
                continue
            alignable_counts[i] = sum(1 for w in normalized if w)
            request_lines.append(
                {
                    "index": i,
                    "window_start": windows[i][0],
                    "window_end": windows[i][1],
                    "words": normalized,
                }
            )
        if request_lines:
            _report_progress(progress, 25, "Aligning words (neural)...")
            try:
                response = run_neural_pass(vocals_path, request_lines, progress, cancel_event)
                neural_by_index = {
                    x.get("index"): x for x in response["lines"] if isinstance(x, dict)
                }
            except NeuralAlignmentFailed as exc:
                logger.warning(f"Neural lyric alignment failed; keeping DSP timing: {exc}")
                effective, fallback_reason = "dsp", str(exc)

    evidence = load_evidence(vocals_path)
    result_lines, methods, confidences = [], [], []
    for i, line in enumerate(dsp_lines):
        if keep_source[i]:
            merged, method, score = dict(line), "lrc", None
        else:
            merged, method, score = merge_line(
                line, neural_by_index.get(i), windows[i], alignable_counts.get(i, 0)
            )
            merged = dict(merged)
            if method == "dsp" and evidence is None:
                method = "fallback"
        confidence = line_confidence(method, evidence_score(merged.get("words"), evidence), score)
        merged["align_method"] = method
        if confidence is not None:
            merged["confidence"] = confidence
        else:
            merged.pop("confidence", None)
        result_lines.append(merged)
        methods.append(method)
        if confidence is not None:
            confidences.append(confidence)

    report = {
        "version": REPORT_VERSION,
        "engine": effective,
        "requested_engine": requested,
        "fallback_reason": fallback_reason,
        "lyric_source": (lyric_data or {}).get("source"),
        "source_timing": timing,
        "global_offset": _offset_summary(lines or [], result_lines, timing),
        "lines_total": len(result_lines),
        "lines_ctc": methods.count("ctc"),
        "lines_dsp": methods.count("dsp"),
        "lines_lrc": methods.count("lrc"),
        "lines_fallback": methods.count("fallback"),
        "low_confidence_lines": sum(1 for c in confidences if c < LOW_CONFIDENCE),
        "mean_confidence": round(statistics.fmean(confidences), 3) if confidences else None,
        "elapsed_seconds": round(time.monotonic() - started, 2),
        "aligned_at": int(time.time()),
    }
    lyric_timing = (
        "none"
        if not result_lines
        else {"word": "source_word", "line": "source_line"}.get(timing, "aligned")
    )
    _report_progress(progress, 100, "Lyrics aligned")
    return SyncResult(result_lines, report, lyric_timing, methods)


def _offset_summary(source: list[dict], aligned: list[dict], timing: str) -> dict | None:
    """How far the timing moved timed lyrics overall (the median line shift)."""
    if timing == "none" or not source or len(source) != len(aligned):
        return None
    shifts = [
        _num(after.get("start_time")) - _num(before.get("start_time"))
        for before, after in zip(source, aligned, strict=True)
    ]
    median = statistics.median(shifts) if shifts else 0.0
    return {"applied": round(median, 3) if abs(median) >= 0.1 else 0.0}
