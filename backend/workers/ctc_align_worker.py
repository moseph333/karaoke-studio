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
Either version may name an "emission_cache" file (a .npy written by save_emission, see
backend.services.emission_cache, which keys it by the vocals' content). When it holds a usable
emission the model is not loaded at all: the line windows (version 1 too) and the song pass
are aligned on it, and "emission" says "cached": true. A version 2 run that has to listen to
the song itself writes the emission there for the next run.

Emission-only mode, used on the cloud GPU right after separation (gpu/modal_app.py):

    python -u -m backend.workers.ctc_align_worker --emission vocals.wav --out emission.npy \
        --model-dir /models/mms_fa [--allow-download 1] [--device auto|cpu|cuda]

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
    parser.add_argument("--request", type=Path)
    parser.add_argument("--response", type=Path)
    parser.add_argument("--emission", type=Path, help="emission-only mode: the vocals to read")
    parser.add_argument("--out", type=Path, help="emission-only mode: the .npy to write")
    parser.add_argument("--model-dir", type=Path)
    parser.add_argument("--allow-download", type=int, choices=(0, 1), default=1)
    parser.add_argument("--device", choices=("auto", "cpu", "cuda"), default="auto")
    args = parser.parse_args(argv)
    if args.emission is not None:
        if args.out is None or args.model_dir is None:
            parser.error("--emission needs --out and --model-dir")
    elif args.request is None or args.response is None:
        parser.error("--request and --response are required")
    return args


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


def song_emission(model, waveform, torch, progress=None, device=None):
    """The model's emission (frames x labels) for the whole track, run chunk by chunk
    (chunk_plan) and stitched by frame index. With ``device`` each chunk runs there and its
    frames come back to the CPU."""
    n_samples = int(waveform.shape[1])
    plan = chunk_plan(n_samples)
    parts = []
    for done, (first, end, core_start, core_end) in enumerate(plan, 1):
        segment = waveform[:, first:end]
        if device is not None:
            segment = segment.to(device)
        with torch.inference_mode():
            emission, _ = model(segment)
        emission = emission[0]
        if device is not None:
            emission = emission.cpu()
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


def import_torch():
    """torch, torchaudio, torchaudio.functional and the MMS_FA bundle."""
    try:
        import torch
        import torchaudio
        from torchaudio import functional
        from torchaudio.pipelines import MMS_FA
    except Exception as exc:  # ImportError, or a broken install raising OSError
        raise ImportError(f"PyTorch/torchaudio could not be loaded: {exc}") from exc
    return torch, torchaudio, functional, MMS_FA


def load_model(model_dir: Path, allow_download: bool, torch, bundle, device=None):
    """The MMS_FA model with its star class, downloading the weights when allowed."""
    model_dir.mkdir(parents=True, exist_ok=True)
    if not (model_dir / WEIGHTS_FILE).is_file():
        if not allow_download:
            raise WeightsMissing(
                "The MMS alignment model is not downloaded and automatic download is disabled "
                "(ALIGNMENT_ALLOW_DOWNLOAD=0)"
            )
        emit("download", detail="Downloading the MMS alignment model (first run only, ~1.2 GB)…")

    emit("stage", detail="Loading the neural aligner…")
    torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
    model = bundle.get_model(
        with_star=True, dl_kwargs={"model_dir": str(model_dir), "file_name": WEIGHTS_FILE}
    )
    if device is not None:
        model = model.to(device)
    model.eval()
    return model


def load_cached_emission(path: str | Path | None, labels: int, torch):
    """The emission saved in ``path`` (frames x ``labels`` log-probabilities), or None when
    there is none or it does not look like one. Never raises."""
    if not path:
        return None
    try:
        import numpy as np

        array = np.load(Path(path), allow_pickle=False)
        if array.ndim != 2 or array.shape[0] < 1 or array.shape[1] != labels:
            return None
        if array.dtype != np.float32 or not np.isfinite(array).all():
            return None
        emission = torch.from_numpy(np.ascontiguousarray(array))
    except Exception:  # missing, half-written or not an array: listen to the song again
        return None
    try:
        os.utime(path)  # recently used, so pruning keeps it
    except OSError:
        pass
    return emission


def save_emission(path: str | Path, emission) -> bool:
    """Writes the emission to ``path`` as a float32 .npy, atomically. Never raises."""
    try:
        import numpy as np

        target = Path(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        array = emission.detach().cpu().float().numpy()
        fd, tmp = tempfile.mkstemp(prefix=".emission-", suffix=".npy", dir=str(target.parent))
        try:
            with os.fdopen(fd, "wb") as handle:
                np.save(handle, np.ascontiguousarray(array, dtype=np.float32))
            os.replace(tmp, target)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise
        return True
    except Exception as exc:
        emit("stage", detail=f"Could not save the neural listening pass: {exc}")
        return False


def labels_and_star(bundle) -> tuple[dict, int, int]:
    """The model's letter dictionary, the star token and the number of emission columns
    (with_star appends the star class after the regular labels)."""
    dictionary = bundle.get_dict(star=None)
    star = len(dictionary)
    return dictionary, star, star + 1


def run(request: dict) -> dict:
    torch, torchaudio, functional, MMS_FA = import_torch()
    lines = request.get("lines") or []
    song = request.get("song")
    cache_path = request.get("emission_cache") or None
    song_mode = request.get("version") == 2 and isinstance(song, dict)

    emission = None
    if cache_path and Path(cache_path).is_file():
        dictionary, star, labels = labels_and_star(MMS_FA)
        emission = load_cached_emission(cache_path, labels, torch)
    if emission is not None:
        emit(
            "stage",
            phase="emission",
            done=1,
            total=1,
            detail="Reusing the saved neural listening pass…",
        )
        info = {
            "frames": int(emission.shape[0]),
            "seconds_per_frame": FRAME_SAMPLES / SAMPLE_RATE,
            "chunks": 0,
            "seconds": 0.0,
            "cached": True,
        }
        if song_mode:
            return run_song_on_emission(
                emission, info, lines, song, dictionary, star, torch, functional
            )
        results = align_windows_on_emission(emission, lines, dictionary, star, torch, functional)
        return {
            "version": request.get("version", 1),
            "model": "MMS_FA",
            "lines": results,
            "emission": info,
        }

    model = load_model(
        Path(request["model_dir"]), bool(request.get("allow_download")), torch, MMS_FA
    )
    dictionary, star, _ = labels_and_star(MMS_FA)
    waveform = load_waveform(request["audio"], torch, torchaudio)
    if song_mode:
        return run_song(
            model, waveform, lines, song, dictionary, star, torch, functional, cache_path
        )
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


def run_song(
    model, waveform, lines, song, dictionary, star, torch, functional, cache_path=None
) -> dict:
    """Version 2 with a song pass: one emission for the whole track (saved to ``cache_path``
    when given), then the line windows and the song pass on it."""
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
        "cached": False,
    }
    if cache_path:
        save_emission(cache_path, emission)
    return run_song_on_emission(
        emission, emission_info, lines, song, dictionary, star, torch, functional
    )


def run_song_on_emission(
    emission, emission_info, lines, song, dictionary, star, torch, functional
) -> dict:
    """The line windows and the song pass on the song's emission."""
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


def compute_emission_file(
    audio: Path, out: Path, model_dir: Path, allow_download: bool, device: str = "auto"
) -> dict:
    """Emission-only mode: listens to ``audio`` and saves its emission to ``out``."""
    torch, torchaudio, _, MMS_FA = import_torch()
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    started = time.monotonic()
    model = load_model(model_dir, allow_download, torch, MMS_FA, device=device)
    waveform = load_waveform(str(audio), torch, torchaudio)

    def on_chunk(done, total):
        emit(
            "stage",
            phase="emission",
            done=done,
            total=total,
            detail=f"Listening to the vocals (neural) {done}/{total}",
        )

    emission, chunks = song_emission(model, waveform, torch, on_chunk, device=device)
    if not save_emission(out, emission):
        raise OSError(f"could not write {out}")
    return {
        "frames": int(emission.shape[0]),
        "chunks": chunks,
        "device": device,
        "seconds": round(time.monotonic() - started, 2),
    }


def main_emission(args: argparse.Namespace) -> int:
    try:
        info = compute_emission_file(
            args.emission, args.out, args.model_dir, bool(args.allow_download), args.device
        )
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
    emit("done", **info)
    return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if args.emission is not None:
        return main_emission(args)
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
