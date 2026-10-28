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
as "* word ... word *", the star token absorbing whatever else is in the window.

Response (written atomically to --response):
    {"version": 1, "model": "MMS_FA", "lines": [{"index": 0, "status": "ok", "error": null,
     "line_score": 0.83, "star_ratio": 0.12,
     "words": [{"start": 12.41, "end": 12.8, "score": 0.91}, null, {...}]}]}

status is "ok", "empty" (nothing alignable) or "failed" (with "error"). Progress goes to
stderr as JSON lines ({"event": "stage" | "download" | "error", ...}).
Exit codes: 0 ok, 2 bad arguments, 3 weights missing while downloads are disabled,
4 PyTorch or torchaudio cannot be imported, 5 alignment failed.
"""

import argparse
import itertools
import json
import os
import sys
import tempfile
import traceback
from pathlib import Path

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_WEIGHTS_MISSING = 3
EXIT_IMPORT = 4
EXIT_FAILED = 5

PROTOCOL_VERSION = 1
SAMPLE_RATE = 16000
WEIGHTS_FILE = "mms_fa.pt"
_MIN_WINDOW_SEC = 0.1


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


def align_line(model, waveform, line: dict, dictionary: dict, star: int, torch, functional):
    words = list(line.get("words") or [])
    result = {
        "index": line.get("index"),
        "status": "ok",
        "error": None,
        "words": [None] * len(words),
    }
    alignable = [(i, w) for i, w in enumerate(words) if w]
    if not alignable:
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
    tokens = [[star]] + [[dictionary[ch] for ch in word] for _, word in alignable] + [[star]]
    flat = [token for word in tokens for token in word]
    if emission.shape[0] < len(flat) + count_repeats(flat):
        result.update(status="failed", error="too little audio for the words")
        return result

    targets = torch.tensor([flat], dtype=torch.int32)
    aligned, scores = functional.forced_align(emission.unsqueeze(0), targets, blank=0)
    spans = functional.merge_tokens(aligned[0], scores[0].exp())
    grouped = _unflatten(spans, [len(t) for t in tokens])
    seconds_per_frame = segment.shape[1] / emission.shape[0] / SAMPLE_RATE
    timed = spans_to_words(grouped[1:-1], seconds_per_frame, start / SAMPLE_RATE)
    star_frames = sum(span.end - span.start for span in grouped[0] + grouped[-1])
    line_score, star_ratio = line_summary(timed, star_frames, int(emission.shape[0]))
    for (index, _), word in zip(alignable, timed, strict=True):
        word.pop("frames", None)
        result["words"][index] = word
    result.update(line_score=line_score, star_ratio=star_ratio)
    return result


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
    results = []
    for done, line in enumerate(lines, 1):
        try:
            results.append(align_line(model, waveform, line, dictionary, star, torch, functional))
        except Exception as exc:  # one bad line must not sink the song
            results.append(
                {
                    "index": line.get("index"),
                    "status": "failed",
                    "error": f"{type(exc).__name__}: {exc}",
                    "words": [None] * len(line.get("words") or []),
                }
            )
        emit(
            "stage",
            done=done,
            total=len(lines),
            detail=f"Aligning words (neural) {done}/{len(lines)}",
        )
    return {"version": PROTOCOL_VERSION, "model": "MMS_FA", "lines": results}


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        request = json.loads(args.request.read_text(encoding="utf-8"))
        if request.get("version") != PROTOCOL_VERSION:
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
