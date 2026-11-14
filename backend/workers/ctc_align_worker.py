"""Neural forced alignment of lyric words with torchaudio's MMS_FA model.

backend.services.lyric_sync runs this in its own process (one per song), so PyTorch never
loads into the API server and a crash or out-of-memory kill only costs the neural pass:

    python -u -m backend.workers.ctc_align_worker --request REQ.json --response RESP.json

Request (version 1):
    {"version": 1, "audio": "/path/vocals.wav", "model_dir": "/models/mms_fa",
     "allow_download": true,
     "lines": [{"index": 0, "window_start": 11.8, "window_end": 16.3,
                "words": ["hello", "", "world"]}]}

"words" holds each lyric word normalized to MMS letters (lyric_tokenize.normalize_for_mms);
an empty string marks a word the model cannot align. Each line is aligned inside its window
as "* word ... word *", the star token absorbing whatever else is in the window. Version 1
runs the model on each window separately.

Version 2 adds an optional song pass:
    {"version": 2, ..., "lines": [...as above...],
     "song": {"lines": [{"index": 0, "words": ["hello", "", "world"]}, ...]}}

The model then runs once over the whole track (in overlapping chunks, see chunk_plan), the
line windows are aligned on slices of that emission, and the song's lines are force-aligned
together, in order, as "* line * line * ... *": the stars absorb the intro, instrumental
breaks, the outro and anything sung that the lyrics leave out, so each line lands where it
fits best in the whole song rather than only near a first estimate.

Response (written atomically to --response):
    {"version": 1, "model": "MMS_FA", "lines": [{"index": 0, "status": "ok", "error": null,
     "line_score": 0.83, "star_ratio": 0.12,
     "words": [{"start": 12.41, "end": 12.8, "score": 0.91}, null, {...}]}]}

status is "ok", "empty" (nothing alignable) or "failed" (with "error"). A version 2 response
also has
    "emission": {"frames": 13450, "seconds_per_frame": 0.02, "chunks": 14, "seconds": 61.2},
    "song": {"status": "ok" | "skipped" | "failed", "error": null, "null_score": 0.05,
             "lines": [{"index": 0, "status": "ok", "line_score": 0.8, "start": 12.4,
                        "end": 14.1, "words": [{...}, null, {...}]}]}
where null_score is the median line score of the same lines with scrambled letters (a
baseline for this recording, see null_score()), "skipped" means the song pass could not run (too little audio for the text, or too
large) and "failed" that it raised; the line results are there either way.
Progress goes to stderr as JSON lines ({"event": "stage" | "download" | "error", ...}); a
version 2 run tags its stage events with "phase": "emission", "lines" or "song".
Exit codes: 0 ok, 2 bad arguments, 3 weights missing while downloads are disabled,
4 PyTorch or torchaudio cannot be imported, 5 alignment failed.
"""

import argparse
import itertools
import json
import os
import statistics
import sys
import tempfile
import time
import traceback
from pathlib import Path

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_WEIGHTS_MISSING = 3
EXIT_IMPORT = 4
EXIT_FAILED = 5

PROTOCOL_VERSION = 1  # the oldest request version still accepted
PROTOCOL_VERSIONS = (1, 2)
SAMPLE_RATE = 16000
WEIGHTS_FILE = "mms_fa.pt"
_MIN_WINDOW_SEC = 0.1
# The wav2vec2 feature extractor: one emission frame per 320 samples (20 ms), each seeing
# 400 samples. Chunks start on a frame boundary, so their frames line up with the song's.
FRAME_SAMPLES = 320
RECEPTIVE_SAMPLES = 400
CHUNK_CORE_FRAMES = 1000  # 20 s kept from each chunk (attention cost grows with its square)
CHUNK_CONTEXT_FRAMES = 100  # 2 s of audio on each side for context, then dropped
MAX_DP_CELLS = 250_000_000  # frames x tokens above which the song pass is skipped
# The letters scrambled() rotates for the song pass's baseline (the apostrophe stays)
NULL_LETTERS = "aienoutsrmkldghybpwcvjzfqx"
NULL_SHIFT = 7


class WeightsMissing(Exception):
    """The model weights are not on disk and downloading is disabled."""


def emit(event: str, **fields) -> None:
    sys.stderr.write(json.dumps({"event": event, **fields}) + "\n")
    sys.stderr.flush()


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="ctc_align_worker", description=__doc__.split("\n")[0])
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--response", type=Path, required=True)
    return parser.parse_args(argv)


def write_atomic(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".ctc-", suffix=".json", dir=str(path.parent))
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    os.replace(tmp, path)


def count_repeats(tokens: list[int]) -> int:
    """Adjacent equal tokens, each of which needs an extra (blank) frame in a CTC path."""
    return sum(1 for a, b in itertools.pairwise(tokens) if a == b)


def spans_to_words(word_spans: list[list], seconds_per_frame: float, offset: float) -> list[dict]:
    """Start, end and duration-weighted mean probability of each word from its token spans
    (objects with .start, .end (exclusive) and .score, in emission frames)."""
    words = []
    for spans in word_spans:
        frames = sum(span.end - span.start for span in spans)
        score = sum(span.score * (span.end - span.start) for span in spans) / max(frames, 1)
        words.append(
            {
                "start": round(offset + spans[0].start * seconds_per_frame, 3),
                "end": round(offset + spans[-1].end * seconds_per_frame, 3),
                "score": round(float(score), 4),
                "frames": frames,
            }
        )
    return words


def line_summary(words: list[dict], star_frames: int, total_frames: int) -> tuple[float, float]:
    """(line_score, star_ratio): frame-weighted word probability, share of star frames."""
    frames = sum(w["frames"] for w in words)
    score = sum(w["score"] * w["frames"] for w in words) / frames if frames else 0.0
    return round(score, 4), round(star_frames / total_frames, 4) if total_frames else 1.0


def _unflatten(items: list, lengths: list[int]) -> list[list]:
    out, start = [], 0
    for length in lengths:
        out.append(items[start : start + length])
        start += length
    return out


def word_tokens(word: str, dictionary: dict) -> list[int]:
    """The model's tokens for one normalized word (letters it does not know are dropped)."""
    return [dictionary[ch] for ch in word if ch in dictionary]


def _empty_result(line: dict) -> tuple[dict, list[str]]:
    words = list(line.get("words") or [])
    result = {"index": line.get("index"), "status": "ok", "error": None}
    result["words"] = [None] * len(words)
    return result, words


def force_align(emission, groups: list[list[int]], torch, functional) -> list[list]:
    """Token spans of each group of target tokens, aligned on ``emission`` (frames x labels
    log-probabilities). Raises ValueError when there are too few frames for the tokens."""
    flat = [token for group in groups for token in group]
    if int(emission.shape[0]) < len(flat) + count_repeats(flat):
        raise ValueError("too little audio for the words")
    targets = torch.tensor([flat], dtype=torch.int32)
    aligned, scores = functional.forced_align(emission.unsqueeze(0), targets, blank=0)
    spans = functional.merge_tokens(aligned[0], scores[0].exp())
    return _unflatten(spans, [len(group) for group in groups])


def align_on_emission(
    emission,
    offset: float,
    seconds_per_frame: float,
    line: dict,
    dictionary,
    star,
    torch,
    functional,
) -> dict:
    """One line aligned as "* words *" on an emission covering its window (``offset`` is the
    time of the emission's first frame)."""
    result, words = _empty_result(line)
    alignable = [(i, word_tokens(w, dictionary)) for i, w in enumerate(words) if w]
    alignable = [(i, tokens) for i, tokens in alignable if tokens]
    if not alignable:
        result.update(status="empty", line_score=0.0, star_ratio=1.0)
        return result
    groups = [[star]] + [tokens for _, tokens in alignable] + [[star]]
    try:
        grouped = force_align(emission, groups, torch, functional)
    except ValueError as exc:
        result.update(status="failed", error=str(exc))
        return result
    timed = spans_to_words(grouped[1:-1], seconds_per_frame, offset)
    star_frames = sum(span.end - span.start for span in grouped[0] + grouped[-1])
    line_score, star_ratio = line_summary(timed, star_frames, int(emission.shape[0]))
    for (index, _), word in zip(alignable, timed, strict=True):
        word.pop("frames", None)
        result["words"][index] = word
    result.update(line_score=line_score, star_ratio=star_ratio)
    return result


def align_line(model, waveform, line: dict, dictionary: dict, star: int, torch, functional):
    """Version 1: runs the model on the line's window and aligns the line there."""
    result, words = _empty_result(line)
    if not any(words):
        result.update(status="empty", line_score=0.0, star_ratio=1.0)
        return result

    start = max(0, round(float(line["window_start"]) * SAMPLE_RATE))
    end = min(int(waveform.shape[1]), round(float(line["window_end"]) * SAMPLE_RATE))
    if end - start < _MIN_WINDOW_SEC * SAMPLE_RATE:
        result.update(status="failed", error="window too short")
        return result

    segment = waveform[:, start:end]
    with torch.inference_mode():
        emission, _ = model(segment)
    emission = emission[0]
    seconds_per_frame = segment.shape[1] / emission.shape[0] / SAMPLE_RATE
    return align_on_emission(
        emission, start / SAMPLE_RATE, seconds_per_frame, line, dictionary, star, torch, functional
    )


def emission_frames(n_samples: int) -> int:
    """Frames the model emits for this many samples."""
    if n_samples < RECEPTIVE_SAMPLES:
        return 0
    return (n_samples - RECEPTIVE_SAMPLES) // FRAME_SAMPLES + 1


def chunk_plan(n_samples: int) -> list[tuple[int, int, int, int]]:
    """How to cover a track with model runs: (first sample, end sample, first kept frame, end
    kept frame) per chunk. Each chunk keeps CHUNK_CORE_FRAMES frames of the song and reads
    CHUNK_CONTEXT_FRAMES frames of audio on each side; chunks start on a frame boundary, so
    chunk frame j is song frame first_sample // FRAME_SAMPLES + j."""
    total = emission_frames(n_samples)
    plan = []
    for core_start in range(0, total, CHUNK_CORE_FRAMES):
        core_end = min(total, core_start + CHUNK_CORE_FRAMES)
        first = max(0, core_start - CHUNK_CONTEXT_FRAMES) * FRAME_SAMPLES
        last_frame = min(total, core_end + CHUNK_CONTEXT_FRAMES) - 1
        end = min(n_samples, last_frame * FRAME_SAMPLES + RECEPTIVE_SAMPLES)
        plan.append((first, end, core_start, core_end))
    return plan


def song_emission(model, waveform, torch, progress=None):
    """The model's emission (frames x labels) for the whole track, run chunk by chunk
    (chunk_plan) and stitched by frame index."""
    n_samples = int(waveform.shape[1])
    plan = chunk_plan(n_samples)
    parts = []
    for done, (first, end, core_start, core_end) in enumerate(plan, 1):
        with torch.inference_mode():
            emission, _ = model(waveform[:, first:end])
        emission = emission[0]
        offset = first // FRAME_SAMPLES
        keep = emission[core_start - offset : core_end - offset]
        if keep.shape[0] < core_end - core_start:  # a frame short at the very end
            pad = keep[-1:].expand(core_end - core_start - keep.shape[0], -1)
            keep = torch.cat([keep, pad])
        parts.append(keep)
        if progress:
            progress(done, len(plan))
    if not parts:
        raise ValueError("the audio is too short to align")
    return torch.cat(parts), len(plan)


def song_groups(song_lines: list[dict], dictionary: dict, star: int):
    """The song pass's target: star, then each line's words, then a star, for every line
    with something alignable. Returns the token groups and, per aligned line, (its request
    entry, the positions of its alignable words, the index of its first word group)."""
    groups: list[list[int]] = [[star]]
    placed = []
    for line in song_lines:
        words = list(line.get("words") or [])
        alignable = [(i, word_tokens(w, dictionary)) for i, w in enumerate(words) if w]
        alignable = [(i, tokens) for i, tokens in alignable if tokens]
        if not alignable:
            continue
        placed.append((line, [i for i, _ in alignable], len(groups)))
        groups.extend(tokens for _, tokens in alignable)
        groups.append([star])
    return groups, placed


def song_line_results(grouped: list[list], placed, seconds_per_frame: float) -> list[dict]:
    """Per-line results of the song pass from its token spans (see song_groups)."""
    results = []
    for line, positions, first_group in placed:
        word_spans = grouped[first_group : first_group + len(positions)]
        timed = spans_to_words(word_spans, seconds_per_frame, 0.0)
        line_score, _ = line_summary(timed, 0, 0)
        words: list[dict | None] = [None] * len(line.get("words") or [])
        for position, word in zip(positions, timed, strict=True):
            word.pop("frames", None)
            words[position] = word
        results.append(
            {
                "index": line.get("index"),
                "status": "ok",
                "line_score": line_score,
                "start": timed[0]["start"],
                "end": timed[-1]["end"],
                "words": words,
            }
        )
    return results


def scrambled(word: str, shift: int = NULL_SHIFT) -> str:
    """A word with every letter moved ``shift`` places along NULL_LETTERS: the same length
    and repeats, but no longer the lyrics."""
    size = len(NULL_LETTERS)
    return "".join(
        NULL_LETTERS[(NULL_LETTERS.index(ch) + shift) % size] if ch in NULL_LETTERS else ch
        for ch in word
    )


def null_score(emission, song_lines: list[dict], dictionary, star, torch, functional):
    """The median line score of the song's lines with scrambled letters: how well text that
    is not sung "fits" this recording. Model scores depend on the stem (bleed, reverb, a
    soft voice), so the anchors are judged against this instead of a fixed number."""
    lines = [
        {"index": line.get("index"), "words": [scrambled(w) for w in line.get("words") or []]}
        for line in song_lines
    ]
    groups, placed = song_groups(lines, dictionary, star)
    grouped = force_align(emission, groups, torch, functional)
    scores = [r["line_score"] for r in song_line_results(grouped, placed, 0.02)]
    return round(statistics.median(scores), 4) if scores else None


def align_song(emission, song_lines: list[dict], dictionary, star, torch, functional) -> dict:
    """The song pass (see the module docstring)."""
    groups, placed = song_groups(song_lines, dictionary, star)
    if not placed:
        return {"status": "skipped", "error": "nothing alignable", "lines": []}
    tokens = sum(len(group) for group in groups)
    frames = int(emission.shape[0])
    if frames * (2 * tokens + 1) > MAX_DP_CELLS:
        return {"status": "skipped", "error": "too long to align in one pass", "lines": []}
    try:
        grouped = force_align(emission, groups, torch, functional)
    except ValueError as exc:
        return {"status": "skipped", "error": str(exc), "lines": []}
    seconds_per_frame = FRAME_SAMPLES / SAMPLE_RATE
    result = {
        "status": "ok",
        "error": None,
        "null_score": None,
        "lines": song_line_results(grouped, placed, seconds_per_frame),
    }
    try:
        result["null_score"] = null_score(emission, song_lines, dictionary, star, torch, functional)
    except ValueError:
        pass
    return result


def _failed_line(line: dict, exc: Exception) -> dict:
    return {
        "index": line.get("index"),
        "status": "failed",
        "error": f"{type(exc).__name__}: {exc}",
        "words": [None] * len(line.get("words") or []),
    }


def align_windows_on_emission(emission, lines, dictionary, star, torch, functional) -> list:
    """Version 2's line pass: each line's window cut from the song's emission."""
    seconds_per_frame = FRAME_SAMPLES / SAMPLE_RATE
    total = int(emission.shape[0])
    results = []
    for done, line in enumerate(lines, 1):
        try:
            first = max(0, min(total, round(float(line["window_start"]) / seconds_per_frame)))
            end = max(first, min(total, round(float(line["window_end"]) / seconds_per_frame)))
            if not any(line.get("words") or []):
                result, _ = _empty_result(line)
                result.update(status="empty", line_score=0.0, star_ratio=1.0)
            elif (end - first) * seconds_per_frame < _MIN_WINDOW_SEC:
                result, _ = _empty_result(line)
                result.update(status="failed", error="window too short")
            else:
                result = align_on_emission(
                    emission[first:end],
                    first * seconds_per_frame,
                    seconds_per_frame,
                    line,
                    dictionary,
                    star,
                    torch,
                    functional,
                )
        except Exception as exc:  # one bad line must not sink the song
            result = _failed_line(line, exc)
        results.append(result)
        emit(
            "stage",
            phase="lines",
            done=done,
            total=len(lines),
            detail=f"Aligning words (neural) {done}/{len(lines)}",
        )
    return results


def load_waveform(path: str, torch, torchaudio):
    import numpy as np
    import soundfile as sf

    data, rate = sf.read(path, dtype="float32", always_2d=True)
    mono = np.ascontiguousarray(data.mean(axis=1))
    waveform = torch.from_numpy(mono).unsqueeze(0)
    if rate != SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, rate, SAMPLE_RATE)
    return waveform


def run(request: dict) -> dict:
    try:
        import torch
        import torchaudio
        from torchaudio import functional
        from torchaudio.pipelines import MMS_FA
    except Exception as exc:  # ImportError, or a broken install raising OSError
        raise ImportError(f"PyTorch/torchaudio could not be loaded: {exc}") from exc

    model_dir = Path(request["model_dir"])
    model_dir.mkdir(parents=True, exist_ok=True)
    if not (model_dir / WEIGHTS_FILE).is_file():
        if not request.get("allow_download"):
            raise WeightsMissing(
                "The MMS alignment model is not downloaded and automatic download is disabled "
                "(ALIGNMENT_ALLOW_DOWNLOAD=0)"
            )
        emit("download", detail="Downloading the MMS alignment model (first run only, ~1.2 GB)…")

    emit("stage", detail="Loading the neural aligner…")
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    model = MMS_FA.get_model(
        with_star=True, dl_kwargs={"model_dir": str(model_dir), "file_name": WEIGHTS_FILE}
    )
    model.eval()
    dictionary = MMS_FA.get_dict(star=None)
    star = len(dictionary)  # with_star appends the star class after the regular labels

    waveform = load_waveform(request["audio"], torch, torchaudio)
    lines = request.get("lines") or []
    song = request.get("song")
    if request.get("version") == 2 and isinstance(song, dict):
        return run_song(model, waveform, lines, song, dictionary, star, torch, functional)
    results = []
    for done, line in enumerate(lines, 1):
        try:
            results.append(align_line(model, waveform, line, dictionary, star, torch, functional))
        except Exception as exc:  # one bad line must not sink the song
            results.append(_failed_line(line, exc))
        emit(
            "stage",
            done=done,
            total=len(lines),
            detail=f"Aligning words (neural) {done}/{len(lines)}",
        )
    return {"version": request.get("version", 1), "model": "MMS_FA", "lines": results}


def run_song(model, waveform, lines, song, dictionary, star, torch, functional) -> dict:
    """Version 2 with a song pass: one emission for the whole track, then the line windows
    and the song pass on it."""
    started = time.monotonic()

    def on_chunk(done, total):
        emit(
            "stage",
            phase="emission",
            done=done,
            total=total,
            detail=f"Listening to the vocals (neural) {done}/{total}",
        )

    emission, chunks = song_emission(model, waveform, torch, on_chunk)
    emission_info = {
        "frames": int(emission.shape[0]),
        "seconds_per_frame": FRAME_SAMPLES / SAMPLE_RATE,
        "chunks": chunks,
        "seconds": round(time.monotonic() - started, 2),
    }
    results = align_windows_on_emission(emission, lines, dictionary, star, torch, functional)
    emit("stage", phase="song", detail="Placing every line in the song (neural)…")
    try:
        song_result = align_song(
            emission, list(song.get("lines") or []), dictionary, star, torch, functional
        )
    except Exception as exc:  # the line results still count
        song_result = {"status": "failed", "error": f"{type(exc).__name__}: {exc}", "lines": []}
    return {
        "version": 2,
        "model": "MMS_FA",
        "lines": results,
        "song": song_result,
        "emission": emission_info,
    }


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        request = json.loads(args.request.read_text(encoding="utf-8"))
        if request.get("version") not in PROTOCOL_VERSIONS:
            raise ValueError(f"unsupported request version {request.get('version')!r}")
    except Exception as exc:
        emit("error", code="usage", detail=f"Bad request: {exc}")
        return EXIT_USAGE

    try:
        response = run(request)
    except ImportError as exc:
        emit("error", code="import", detail=str(exc))
        return EXIT_IMPORT
    except WeightsMissing as exc:
        emit("error", code="weights_missing", detail=str(exc))
        return EXIT_WEIGHTS_MISSING
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit("error", code="failed", detail=f"{type(exc).__name__}: {exc}")
        return EXIT_FAILED

    write_atomic(args.response, response)
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
