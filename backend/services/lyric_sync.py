"""Lyric synchronisation: line and word timing for a song's lyrics against its vocal stem.

sync_lyrics() always runs the DSP aligner (backend.services.aligner) first. When the neural
CTC aligner can run (see alignment_config), it then aligns every line's words inside a
window around the DSP line in a separate process (backend.workers.ctc_align_worker) and keeps
the neural timing for lines the model is sure about. Every line gets a confidence score and
an ``align_method`` (ctc, dsp, lrc, fallback or manual), and a report says how the song was
timed.

Lyrics that arrive with their own word timing (enhanced LRC) keep it. When a song's current
lines are re-timed with ``keep_manual`` (see prepare_existing_lines), lines whose words were
timed by hand come back exactly as they went in and stay "manual", with no confidence; neither
pass moves them. Manual lines of two or more words that the studio editor only spread evenly
(see words_spread_evenly) are timed again like any other.
The model's emission for the stem is kept (emission_cache), so later passes over the same
vocals only align. If the neural pass is unavailable or fails, the whole song keeps the DSP timing and the report
records why. At most MAX_CONCURRENT_ALIGN_JOBS neural passes run at once (ALIGN_SEMAPHORE):
each loads a large model, so further songs wait for a free slot.
"""

import itertools
import json
import logging
import math
import re
import statistics
import subprocess
import sys
import tempfile
import threading
import time
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.services import alignment_config, emission_cache, lyric_anchors
from backend.services.aligner import enforce_monotonic_words
from backend.services.lyric_tokenize import normalize_for_mms
from backend.services.process_watchdog import ProcessWatchdog, duration_text, quietly, worker_env
from backend.services.sync_confidence import evidence_score, line_confidence, load_evidence
from backend.shared_assets import load

logger = logging.getLogger(__name__)

REPORT_VERSION = 1
LINE_GUARD = 0.75  # seconds of context on each side of a line for the neural pass
MIN_WORD = 0.08
JOIN_GAP = 0.35
LAST_WORD_MIN = 0.25
MIN_ALIGNED_SHARE = 0.7
EXPECTED_REACH = 1.5  # how far a neural line may start from where the anchors expect it
MOVE_TOLERANCE = 1.0  # a DSP line this close to where the anchors expect it stays put
AGREES_WITH_DSP = 0.5  # an anchor this close to a timed line's DSP start confirms it
TIMED_AFTER = 2.0  # neural window after a timed line's end (LRC ends are estimates)
# Below this a line counts as low confidence, as the studio's "Needs review" filter does
LOW_CONFIDENCE = load("confidence_thresholds")["low"]
# The studio editor's even word spread (wordSpreadWeight and recalculateWordTimings in
# frontend/src/utils/lyrics.ts); backend/assets/shared/word_spread_cases.json pins both sides
_SPREAD_PUNCTUATION = re.compile(r"[\s.,/#!$%^&*;:{}=\-_`~()\"<>\[\]?]")
SPREAD_TOLERANCE = 0.002  # moving a line rounds each word boundary again, to the millisecond

ProgressCallback = Callable[[float | None, str], None]

ALIGN_SEMAPHORE = threading.BoundedSemaphore(alignment_config.max_concurrent_jobs())


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


def _spread_weight(word: str) -> float:
    """wordSpreadWeight: 2 plus the word's length without punctuation, counting at most 10
    characters, measured as JavaScript does (UTF-16 code units)."""
    letters = _SPREAD_PUNCTUATION.sub("", word) or word
    return 2.0 + min(10, len(letters.encode("utf-16-le")) // 2)


def words_spread_evenly(line: dict) -> bool:
    """Whether a line's words are only the even spread the studio editor gives them when it
    has no better timing (line-by-line tap-to-sync, new lines, retyped text): back to back
    from the line's start to its end, each lasting in proportion to its _spread_weight, also
    after the whole line was moved. Only the line's start and end were set by hand then. A
    one-word line never counts: every edit to it sets the line to its word, so its word timing
    is the timing set by hand (an ad-lib like "Hey!"). The studio applies the same rule
    (wordsSpreadEvenly in frontend/src/utils/manualEdits.ts)."""
    words = [w for w in line.get("words") or [] if isinstance(w, dict)]
    start, end = _num(line.get("start_time")), _num(line.get("end_time"))
    if len(words) < 2 or end <= start:
        return False
    weights = [_spread_weight(str(w.get("word") or "")) for w in words]
    total = sum(weights)
    tolerance = SPREAD_TOLERANCE + 1e-9
    cumulative, previous_end = 0.0, start
    for word, weight in zip(words, weights, strict=True):
        cumulative += weight
        word_start, word_end = _num(word.get("start_time")), _num(word.get("end_time"))
        if abs(word_start - previous_end) > tolerance:
            return False
        if abs(word_end - (start + (end - start) * cumulative / total)) > tolerance:
            return False
        previous_end = word_end
    return True


def prepare_existing_lines(lines: list[dict], *, keep_manual: bool = False) -> list[dict]:
    """Copies of a song's current lines for re-timing. Word timing that came with the lyrics
    (``align_method`` "lrc") is kept, and so is the timing of lines timed by hand ("manual")
    when ``keep_manual`` is set, unless their words are only the editor's even spread
    (words_spread_evenly); every other line is timed again. A line is kept only when it has
    words, and kept lines are marked with ``has_word_sync``."""
    prepared = []
    for line in lines:
        if not isinstance(line, dict):
            continue
        copy = dict(line)
        method = copy.get("align_method")
        from_lyrics = method == "lrc" or (method is None and copy.get("has_word_sync"))
        by_hand = keep_manual and method == "manual" and not words_spread_evenly(copy)
        if (from_lyrics or by_hand) and copy.get("words"):
            copy["has_word_sync"] = True
        else:
            copy.pop("has_word_sync", None)
        prepared.append(copy)
    return prepared


def _timed_by_hand(line: Any) -> bool:
    """A line timed by hand that prepare_existing_lines kept (``keep_manual``)."""
    return bool(
        isinstance(line, dict)
        and line.get("align_method") == "manual"
        and line.get("has_word_sync")
        and line.get("words")
    )


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


def _windows(lines: list[dict], after: float = LINE_GUARD) -> list[tuple[float, float]]:
    """Non-overlapping neural search windows: each line plus LINE_GUARD before it and
    ``after`` seconds after it, split halfway into the gap with its neighbours."""
    spans = [(_num(x.get("start_time")), _num(x.get("end_time"))) for x in lines]
    out = []
    for i, (start, end) in enumerate(spans):
        lo, hi = max(0.0, start - LINE_GUARD), end + after
        if i > 0:
            lo = max(lo, (spans[i - 1][1] + start) / 2)
        if i + 1 < len(spans):
            hi = min(hi, (end + spans[i + 1][0]) / 2)
        out.append((round(lo, 3), round(max(hi, lo + 0.2), 3)))
    return out


def _report_progress(progress: ProgressCallback | None, pct: float | None, detail: str) -> None:
    if progress:
        progress(pct, detail)


@contextmanager
def neural_slot(
    progress: ProgressCallback | None = None,
    cancel_event: Any | None = None,
    wait: bool = True,
) -> Iterator[None]:
    """Holds an ALIGN_SEMAPHORE slot for one neural pass. Waits for a free slot (checking for
    cancellation), or with ``wait=False`` raises NeuralAlignmentFailed when none is free."""
    semaphore = ALIGN_SEMAPHORE
    if not semaphore.acquire(blocking=False):
        if not wait:
            raise NeuralAlignmentFailed("the neural aligner is busy with another song")
        _report_progress(progress, None, "Waiting for the neural aligner to finish another song...")
        while not semaphore.acquire(timeout=0.25):
            if cancel_event is not None and cancel_event.is_set():
                raise AlignmentCancelled("Lyric alignment cancelled by user")
    try:
        yield
    finally:
        semaphore.release()


def run_neural_pass(
    vocals_path: str,
    request_lines: list[dict],
    progress: ProgressCallback | None = None,
    cancel_event: Any | None = None,
    song_lines: list[dict] | None = None,
) -> dict:
    """Runs the CTC worker on the given line windows and returns its response. With
    ``song_lines`` it also runs the song pass (protocol version 2); a malformed "song" part
    of the response is dropped."""
    request = {
        "version": 2 if song_lines else 1,
        "audio": str(Path(vocals_path).resolve()),
        "model_dir": str(alignment_config.model_dir().resolve()),
        "allow_download": alignment_config.downloads_allowed(),
        "lines": request_lines,
    }
    if song_lines:
        request["song"] = {"lines": song_lines}
    cache = emission_cache.path_for(vocals_path)
    if cache is not None:
        request["emission_cache"] = str(cache)
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
                        _report_progress(
                            progress, _stage_percent(event), str(event.get("detail") or "")
                        )
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
    if cache is not None:
        emission_cache.prune()
    song = response.get("song")
    if song is not None and not (isinstance(song, dict) and isinstance(song.get("lines"), list)):
        response.pop("song", None)
    return response


# Progress of a neural pass, by the phase of the worker's stage events: version 2 listens to
# the whole song first, then aligns the line windows and the song pass
_STAGE_SPANS = {None: (30, 65), "emission": (30, 50), "lines": (80, 13), "song": (93, 0)}


def _stage_percent(event: dict) -> float | None:
    base, span = _STAGE_SPANS.get(event.get("phase"), _STAGE_SPANS[None])
    done, total = event.get("done"), event.get("total")
    if not span:
        return float(base)
    return base + span * done / total if done and total else None


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


def merge_line(
    dsp_line: dict,
    neural: dict | None,
    window: tuple[float, float],
    alignable: int,
    *,
    widen_to_dsp: bool = True,
    min_score: float | None = None,
):
    """The line to keep, and its method: neural timing when the model is confident enough
    (``min_score``, by default ALIGNMENT_MIN_CONFIDENCE) and placed most words, otherwise the
    DSP timing. The neural line keeps at least the DSP line's span unless ``widen_to_dsp``
    is False (when the model searched a wider window than the DSP estimate and may have
    found the line elsewhere)."""
    words = [w for w in dsp_line.get("words") or [] if isinstance(w, dict)]
    if not neural or neural.get("status") != "ok" or not words:
        return dsp_line, "dsp", None
    raw = neural.get("words") or []
    score = _num(neural.get("line_score"))
    placed = sum(1 for w in raw if w)
    if min_score is None:
        min_score = alignment_config.min_confidence()
    if (
        len(raw) != len(words)
        or score < min_score
        or placed < MIN_ALIGNED_SHARE * max(1, alignable)
    ):
        return dsp_line, "dsp", score

    spans = finish_neural_words(raw, window[1])
    known = [s for s in spans if s]
    line_start, line_end = known[0][0], known[-1][1]
    if widen_to_dsp:
        line_start = min(_num(dsp_line.get("start_time")), line_start)
        line_end = max(_num(dsp_line.get("end_time")), line_end)
    line_start, line_end = max(window[0], line_start), min(window[1], line_end)
    if line_end <= line_start:
        line_end = line_start + 0.5
    texts = [str(w.get("word") or "") for w in words]
    timed = enforce_monotonic_words(
        texts, fill_missing(texts, spans, line_start, line_end), line_start, line_end
    )
    merged = dict(dsp_line)
    merged.update(start_time=round(line_start, 3), end_time=round(line_end, 3), words=timed)
    return merged, "ctc", score


def _moved(line: dict, start: float, end: float) -> dict:
    """A copy of ``line`` moved and stretched to [start, end], its words mapped along."""
    old_start, old_end = _num(line.get("start_time")), _num(line.get("end_time"))
    end = max(end, start + 0.05)
    scale = (end - start) / (old_end - old_start) if old_end > old_start else 0.0

    def at(t: float) -> float:
        return round(start + (t - old_start) * scale if scale else start, 3)

    moved = dict(line, start_time=round(start, 3), end_time=round(end, 3))
    words = []
    for word in line.get("words") or []:
        if isinstance(word, dict):
            word = dict(word, start_time=at(_num(word.get("start_time"))))
            word["end_time"] = max(word["start_time"], at(_num(word.get("end_time"))))
        words.append(word)
    moved["words"] = words
    return moved


def _fit(line: dict, lo: float, hi: float) -> dict:
    """``line`` moved inside [lo, hi]: shifted when it fits, else squeezed."""
    start, end = _num(line.get("start_time")), _num(line.get("end_time"))
    if lo - 0.001 <= start and end <= hi + 0.001:
        return line
    span = max(0.05, end - start)
    if hi - lo >= span:
        start = min(max(start, lo), hi - span)
        return _moved(line, start, start + span)
    return _moved(line, lo, max(hi, lo + 0.05))


def _inside(line: dict, lo: float, hi: float, expected: float | None) -> bool:
    start, end = _num(line.get("start_time")), _num(line.get("end_time"))
    if start < lo - 0.05 or end > hi + 0.05:
        return False
    return expected is None or abs(start - expected) <= EXPECTED_REACH


def _spread(lines: list[dict], lo: float, hi: float) -> list[dict]:
    """Lines laid out one after another over [lo, hi] in proportion to their text, each
    keeping at most its own length (the gap may be an instrumental break)."""
    weights = [max(1, len(str(x.get("text") or ""))) for x in lines]
    total = sum(weights)
    out, cursor = [], lo
    for line, weight in zip(lines, weights, strict=True):
        share = (hi - lo) * weight / total
        length = _num(line.get("end_time")) - _num(line.get("start_time"))
        length = min(share, length) if length > 0 else share
        out.append(_moved(line, cursor, cursor + max(0.05, length)))
        cursor += share
    return out


def place_with_anchors(
    dsp_lines: list[dict],
    fixed_spans: dict[int, tuple[float, float]],
    anchor_plan: lyric_anchors.AnchorPlan,
    neural_by_index: dict[int, dict],
    windows: list[tuple[float, float]],
    alignable_counts: dict[int, int],
    source_starts: dict[int, float] | None,
    duration: float,
) -> dict[int, tuple[dict, str, float | None]]:
    """Each line's timing once the song pass gave reliable anchors (``anchor_plan``), as
    (line, method, neural score) by index. ``fixed_spans`` are the lines whose timing is
    kept (from the lyrics file or set by hand); they and the anchors bound the others.

    * An anchored line takes its song-pass timing, never widened back to the DSP span.
    * Any other line takes a confident neural result (its own window's or the song pass's)
      that fits between its fixed neighbours and, for timed lyrics, starts near where the
      anchors say the lyrics file's timing has moved to; failing that, the song pass's
      placement there even when the model was unsure (with its low score).
    * Otherwise it keeps the DSP timing, moved to that place for timed lyrics; plain lines
      that fall outside their gap are spread over it.
    """
    fixed = dict(fixed_spans)
    for index, result in anchor_plan.anchors.items():
        fixed[index] = (_num(result.get("start")), _num(result.get("end")))

    def gap(index: int) -> tuple[float, float]:
        lo = max((span[1] for j, span in fixed.items() if j < index), default=0.0)
        hi = min((span[0] for j, span in fixed.items() if j > index), default=duration)
        return lo, max(lo, hi)

    timed = source_starts is not None
    placed: dict[int, tuple[dict, str, float | None]] = {}
    for index, result in anchor_plan.anchors.items():
        alignable = alignable_counts.get(index, 0)
        dsp_start = _num(dsp_lines[index].get("start_time"))
        if timed and abs(dsp_start - _num(result.get("start"))) <= AGREES_WITH_DSP:
            # The lyrics file was right here: the DSP snap to the sung phrase and the line's
            # own neural window time it a little more precisely than the song pass
            merged, method, score = merge_line(
                dsp_lines[index], neural_by_index.get(index), windows[index], alignable
            )
            placed[index] = (dict(merged), method, score)
            fixed[index] = (_num(merged.get("start_time")), _num(merged.get("end_time")))
            continue
        lo, hi = gap(index)
        lo = min(lo, _num(result.get("start")))
        hi = max(hi, _num(result.get("end")))
        merged, method, score = merge_line(
            dsp_lines[index],
            result,
            (lo, hi),
            alignable_counts.get(index, 0),
            widen_to_dsp=False,
            min_score=0.0,
        )
        if method == "ctc":
            score = anchor_plan.confidence_score(_num(score))
        placed[index] = (dict(merged), method, score)
        fixed[index] = (_num(merged.get("start_time")), _num(merged.get("end_time")))

    others = [i for i in range(len(dsp_lines)) if i not in fixed]
    for index in others:
        lo, hi = gap(index)
        expected = None
        if source_starts is not None and index in source_starts:
            expected = source_starts[index] + anchor_plan.offsets.get(index, 0.0)
        alignable = alignable_counts.get(index, 0)
        options = [
            merge_line(dsp_lines[index], neural_by_index.get(index), windows[index], alignable),
            merge_line(
                dsp_lines[index],
                anchor_plan.results.get(index),
                (lo, hi),
                alignable,
                widen_to_dsp=False,
            ),
        ]
        good = [o for o in options if o[1] == "ctc" and _inside(o[0], lo, hi, expected)]
        near = expected is not None and (
            abs(_num(dsp_lines[index].get("start_time")) - expected) <= MOVE_TOLERANCE
        )
        if not good and near and _inside(dsp_lines[index], lo, hi, None):
            placed[index] = (dict(dsp_lines[index]), "dsp", None)
            continue
        if not good:
            # Between two anchors even an unsure song-pass placement beats the DSP guess:
            # the model had to put the line in that gap, in order. Its low score keeps it
            # flagged for review.
            unsure = merge_line(
                dsp_lines[index],
                anchor_plan.results.get(index),
                (lo, hi),
                alignable,
                widen_to_dsp=False,
                min_score=0.0,
            )
            if unsure[1] == "ctc" and _inside(unsure[0], lo, hi, expected):
                good = [unsure]
        if good:
            merged, method, score = max(good, key=lambda o: _num(o[2]))
            placed[index] = (dict(merged), method, score)
            continue
        line = dict(dsp_lines[index])
        if expected is not None and abs(_num(line.get("start_time")) - expected) > MOVE_TOLERANCE:
            shift = expected - _num(line.get("start_time"))
            line = _moved(
                line, _num(line.get("start_time")) + shift, _num(line.get("end_time")) + shift
            )
        placed[index] = (line, "dsp", None)

    # Plain lyrics: a run of DSP lines between two fixed lines that does not fit there is
    # spread over the gap; timed lyrics are only squeezed in
    run: list[int] = []
    for index in [*range(len(dsp_lines)), None]:
        if index is not None and index in placed and placed[index][1] == "dsp":
            run.append(index)
            continue
        if run:
            lo, hi = gap(run[0])
            lines = [placed[i][0] for i in run]
            if any(not _inside(x, lo, hi, None) for x in lines):
                fitted = _spread(lines, lo, hi) if source_starts is None else lines
                for i, line in zip(run, fitted, strict=True):
                    placed[i] = (_fit(line, *gap(i)), "dsp", None)
            run = []

    # Lines never overlap: a later line that starts inside the one before it moves after it
    previous_end = 0.0
    for index in range(len(dsp_lines)):
        if index in fixed_spans:
            previous_end = max(previous_end, fixed_spans[index][1])
            continue
        line, method, score = placed[index]
        if _num(line.get("start_time")) < previous_end - 0.05:
            _, hi = gap(index)
            line = _fit(line, previous_end, max(hi, previous_end + 0.3))
            placed[index] = (line, method, score)
        previous_end = max(previous_end, _num(line.get("end_time")))
    return placed


def _line_span(line: dict) -> tuple[float, float]:
    return _num(line.get("start_time")), _num(line.get("end_time"))


def _source_starts(sources: list[dict], dsp_lines: list[dict], timing: str):
    """The lyrics' own line starts for timed lyrics (None for plain lyrics). When the DSP
    pass returned another number of lines, its starts stand in for them."""
    if timing == "none":
        return None
    lines = sources if len(sources) == len(dsp_lines) else dsp_lines
    return {i: _num(line.get("start_time")) for i, line in enumerate(lines)}


def _audio_duration(vocals_path: str, lines: list[dict]) -> float:
    try:
        import soundfile as sf

        return float(sf.info(vocals_path).duration)
    except Exception:
        return max((_num(x.get("end_time")) for x in lines), default=0.0) + 5.0


def _plan_anchors(song, words_by_index, sources, dsp_lines, timing):
    """(anchor plan or None, song_pass status, reason) from the worker's song pass."""
    if not isinstance(song, dict):
        return None, "failed", "the neural aligner returned no song pass"
    if song.get("status") != "ok":
        return None, str(song.get("status") or "failed"), song.get("error")
    try:
        plan = lyric_anchors.plan(
            song.get("lines") or [],
            words_by_index,
            _source_starts(sources, dsp_lines, timing),
            song.get("null_score"),
        )
    except Exception as exc:  # a bad song pass must not cost the line results
        logger.warning(f"Could not use the neural song pass: {exc}", exc_info=True)
        return None, "failed", str(exc)
    return plan, plan.status, plan.reason


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
    sources = list(lines or [])
    timing = source_timing(sources)
    _report_progress(progress, 5, "Aligning lyrics to vocal acoustic energy envelopes...")
    dsp_lines = _dsp_pass(aligner, vocals_path, list(sources), timing)
    if cancel_event is not None and cancel_event.is_set():
        raise AlignmentCancelled("Lyric alignment cancelled by user")

    effective, fallback_reason = alignment_config.effective_engine(requested)
    # Lines timed by hand and kept by prepare_existing_lines are copied back from the input:
    # the DSP pass rebuilds every line (dropping align_method), may shift word-synced lines by
    # a global offset, and drops the word timing on its fallback path. When it returns a
    # different number of lines, nothing can be matched up and they count as lyrics timing.
    same = len(dsp_lines) == len(sources)
    by_hand = [same and _timed_by_hand(sources[i]) for i in range(len(dsp_lines))]
    keep_source = [
        bool(x.get("has_word_sync") and x.get("words")) or by_hand[i]
        for i, x in enumerate(dsp_lines)
    ]
    neural_by_index: dict[int, dict] = {}
    alignable_counts: dict[int, int] = {}
    words_by_index: dict[int, list[str]] = {}
    windows = _windows(dsp_lines, after=TIMED_AFTER if timing == "line" else LINE_GUARD)
    song_pass, song_reason = None, None
    anchor_plan: lyric_anchors.AnchorPlan | None = None
    placed: dict[int, tuple[dict, str, float | None]] = {}

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
            words_by_index[i] = normalized
            request_lines.append(
                {
                    "index": i,
                    "window_start": windows[i][0],
                    "window_end": windows[i][1],
                    "words": normalized,
                }
            )
        song_lines = None
        if not alignment_config.song_pass_enabled():
            song_pass, song_reason = "off", "ALIGNMENT_SONG_PASS is off"
        elif len(request_lines) < lyric_anchors.MIN_ANCHORS:
            song_pass, song_reason = "skipped", "too few lines to place in the song"
        else:
            song_lines = [{"index": x["index"], "words": x["words"]} for x in request_lines]
        if request_lines:
            _report_progress(progress, 25, "Aligning words (neural)...")
            try:
                with neural_slot(progress, cancel_event):
                    response = run_neural_pass(
                        vocals_path, request_lines, progress, cancel_event, song_lines=song_lines
                    )
                neural_by_index = {
                    x.get("index"): x for x in response["lines"] if isinstance(x, dict)
                }
                if song_lines:
                    anchor_plan, song_pass, song_reason = _plan_anchors(
                        response.get("song"), words_by_index, sources, dsp_lines, timing
                    )
            except NeuralAlignmentFailed as exc:
                logger.warning(f"Neural lyric alignment failed; keeping DSP timing: {exc}")
                effective, fallback_reason = "dsp", str(exc)
                song_pass, song_reason = None, None

    if anchor_plan is not None and anchor_plan.status == "ok":
        fixed_spans = {
            i: _line_span(sources[i] if by_hand[i] else line)
            for i, line in enumerate(dsp_lines)
            if keep_source[i]
        }
        placed = place_with_anchors(
            dsp_lines,
            fixed_spans,
            anchor_plan,
            neural_by_index,
            windows,
            alignable_counts,
            _source_starts(sources, dsp_lines, timing),
            _audio_duration(vocals_path, dsp_lines),
        )

    evidence = load_evidence(vocals_path)
    result_lines, methods, confidences = [], [], []
    relocated = 0
    for i, line in enumerate(dsp_lines):
        if by_hand[i]:
            src = sources[i]
            merged, method, score = dict(src), "manual", None
            merged["words"] = [dict(w) for w in src.get("words") or [] if isinstance(w, dict)]
        elif keep_source[i]:
            merged, method, score = dict(line), "lrc", None
        else:
            if i in placed:
                merged, method, score = placed[i]
            else:
                merged, method, score = merge_line(
                    line, neural_by_index.get(i), windows[i], alignable_counts.get(i, 0)
                )
            merged = dict(merged)
            if abs(_num(merged.get("start_time")) - _num(line.get("start_time"))) > 1.0:
                relocated += 1
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
        "lines_manual": methods.count("manual"),
        "song_pass": song_pass,
        "song_pass_reason": song_reason,
        "lines_anchored": len(anchor_plan.anchors) if song_pass == "ok" and anchor_plan else 0,
        "lines_relocated": relocated,
        "offset_segments": (anchor_plan.segments[:8] if song_pass == "ok" and anchor_plan else []),
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
