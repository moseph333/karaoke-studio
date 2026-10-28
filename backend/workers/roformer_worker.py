"""RoFormer vocal separation worker for the optional audio-separator package.

backend.services.separator runs this in its own process so an import failure, an
out-of-memory kill or a hang never takes the API down:

    python -u -m backend.workers.roformer_worker --audio IN.wav --out DIR
        --models vocals_mel_band_roformer.ckpt [more.ckpt ...] --overlap 2
        --model-dir MODELS --allow-download 1 [--ensemble avg_wave] [--download-only]

It writes DIR/vocals.wav and DIR/no_vocals.wav. With several models each one separates the
song in turn and the results are averaged sample by sample ("avg_wave"). Progress goes to
stderr as one JSON object per line ({"event": "stage" | "download" | "error", ...}) next to
audio-separator's own progress bars; stdout is unused.

Exit codes: 0 ok, 2 bad arguments, 3 weights missing while downloads are disabled,
4 audio-separator or PyTorch cannot be imported, 5 separation failed.
"""

import argparse
import json
import logging
import os
import re
import shutil
import sys
import traceback
from pathlib import Path

from backend.services.separation_presets import model_label

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_WEIGHTS_MISSING = 3
EXIT_IMPORT = 4
EXIT_FAILED = 5

# audio-separator names outputs "<input>_(<Stem>)_<model>.wav"
_STEM_TAG = re.compile(r"_\(([^)]+)\)")
_INSTRUMENTAL_TAGS = {"instrumental", "other", "no_vocals", "accompaniment", "karaoke", "inst"}


class WeightsMissing(RuntimeError):
    """Model weights are not on disk and downloading is disabled."""


def emit(event: str, **fields) -> None:
    sys.stderr.write(json.dumps({"event": event, **fields}) + "\n")
    sys.stderr.flush()


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="roformer_worker", description="Separate vocals with RoFormer models."
    )
    parser.add_argument("--audio", type=Path, help="Input audio file")
    parser.add_argument("--out", type=Path, help="Directory for vocals.wav and no_vocals.wav")
    parser.add_argument("--models", nargs="+", required=True, help="Model checkpoint names")
    parser.add_argument("--overlap", type=int, default=2, help="Overlapping windows (2-50)")
    parser.add_argument("--model-dir", type=Path, required=True, help="Model weights directory")
    parser.add_argument("--allow-download", type=int, choices=(0, 1), default=1)
    parser.add_argument("--ensemble", choices=("avg_wave",), default="avg_wave")
    parser.add_argument("--download-only", action="store_true", help="Fetch the weights and exit")
    args = parser.parse_args(argv)
    if not args.download_only and (args.audio is None or args.out is None):
        parser.error("--audio and --out are required unless --download-only is given")
    if not 1 <= args.overlap <= 50:
        parser.error("--overlap must be between 1 and 50")
    return args


def classify_stem(path: Path) -> str | None:
    """'vocals' or 'instrumental' for an audio-separator output file, else None."""
    tags = _STEM_TAG.findall(path.name)
    if not tags:
        return None
    # The input file name may contain "_(...)" too; the stem tag is the last one
    tag = tags[-1].strip().lower()
    if tag in _INSTRUMENTAL_TAGS:
        return "instrumental"
    if tag.startswith("vocal"):
        return "vocals"
    return None


def block_downloads(separator) -> None:
    """Make audio-separator fail instead of fetching files that are not on disk."""

    def no_download(url: str, output_path: str) -> None:
        if os.path.isfile(output_path):
            return
        raise WeightsMissing(
            f"{os.path.basename(output_path)} is not downloaded and automatic download is "
            "disabled (SEPARATION_ALLOW_DOWNLOAD=0)"
        )

    separator.download_file_if_not_exists = no_download


def make_separator(separator_cls, args: argparse.Namespace, output_dir: Path, info_only=False):
    separator = separator_cls(
        log_level=logging.WARNING,
        model_file_dir=str(args.model_dir),
        output_dir=str(output_dir),
        output_format="WAV",
        use_soundfile=True,
        info_only=info_only,
        mdxc_params={
            "segment_size": 256,
            "override_model_segment_size": False,
            "batch_size": None,
            "overlap": args.overlap,
            "pitch_shift": 0,
        },
    )
    if not args.allow_download:
        block_downloads(separator)
    return separator


def announce_download(args: argparse.Namespace, model: str) -> None:
    if (args.model_dir / model).is_file():
        return
    if not args.allow_download:
        raise WeightsMissing(
            f"{model} is not downloaded and automatic download is disabled "
            "(SEPARATION_ALLOW_DOWNLOAD=0)"
        )
    emit("download", detail=f"Downloading {model_label(model)} weights (first run only)…")


def run_pass(separator_cls, args, model: str, index: int, total: int) -> dict[str, Path]:
    label = model_label(model)
    suffix = f" (model {index} of {total})" if total > 1 else ""
    pass_dir = args.out / f"pass{index}"
    pass_dir.mkdir(parents=True, exist_ok=True)

    emit("stage", **{"pass": index, "detail": f"Loading {label}{suffix}…"})
    announce_download(args, model)
    separator = make_separator(separator_cls, args, pass_dir)
    separator.load_model(model_filename=model)

    emit("stage", **{"pass": index, "pct": 0, "detail": f"{label} separating stems{suffix}"})
    outputs = separator.separate(str(args.audio))

    stems: dict[str, Path] = {}
    for name in outputs or []:
        path = Path(name)
        if not path.is_absolute():
            path = pass_dir / path
        kind = classify_stem(path)
        if kind and kind not in stems and path.is_file():
            stems[kind] = path
    missing = {"vocals", "instrumental"} - set(stems)
    if missing:
        found = ", ".join(Path(o).name for o in outputs or []) or "nothing"
        raise RuntimeError(
            f"{label} did not produce a {' or '.join(sorted(missing))} stem ({found})"
        )
    return stems


def average_stems(paths: list[Path], target: Path) -> None:
    """avg_wave ensemble: the sample-wise mean of several renderings of one stem."""
    import numpy as np
    import soundfile as sf

    waves = []
    rate = None
    for path in paths:
        data, sr = sf.read(str(path), dtype="float32", always_2d=True)
        if rate is not None and sr != rate:
            raise RuntimeError(f"Ensemble outputs disagree on sample rate ({rate} vs {sr})")
        rate = sr
        waves.append(data)
    frames = min(w.shape[0] for w in waves)
    channels = max(w.shape[1] for w in waves)
    aligned = []
    for wave in waves:
        wave = wave[:frames]
        if wave.shape[1] != channels:  # a mono rendering next to stereo ones
            wave = np.repeat(wave[:, :1], channels, axis=1)
        aligned.append(wave)
    mean = np.clip(np.mean(aligned, axis=0), -1.0, 1.0)
    sf.write(str(target), mean, rate, subtype="PCM_16")


def separate(separator_cls, args: argparse.Namespace) -> None:
    args.out.mkdir(parents=True, exist_ok=True)
    total = len(args.models)
    results = [
        run_pass(separator_cls, args, model, i, total) for i, model in enumerate(args.models, 1)
    ]

    vocals, no_vocals = args.out / "vocals.wav", args.out / "no_vocals.wav"
    if total == 1:
        shutil.move(str(results[0]["vocals"]), vocals)
        shutil.move(str(results[0]["instrumental"]), no_vocals)
    else:
        emit("stage", detail=f"Blending {total} model outputs…")
        average_stems([r["vocals"] for r in results], vocals)
        average_stems([r["instrumental"] for r in results], no_vocals)

    for index in range(1, total + 1):
        shutil.rmtree(args.out / f"pass{index}", ignore_errors=True)
    emit("stage", pct=100, detail="Stems ready")


def download_only(separator_cls, args: argparse.Namespace) -> None:
    separator = make_separator(separator_cls, args, args.model_dir, info_only=True)
    for model in args.models:
        announce_download(args, model)
        separator.download_model_files(model)
        emit("stage", detail=f"{model_label(model)} weights ready")


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.model_dir.mkdir(parents=True, exist_ok=True)
    # audio-separator prefers this variable over its model_file_dir argument
    os.environ["AUDIO_SEPARATOR_MODEL_DIR"] = str(args.model_dir)

    try:
        from audio_separator.separator import Separator
    except Exception as exc:  # ImportError, or a broken torch install raising OSError
        emit("error", code="import", detail=f"audio-separator could not be loaded: {exc}")
        return EXIT_IMPORT

    try:
        if args.download_only:
            download_only(Separator, args)
        else:
            separate(Separator, args)
    except WeightsMissing as exc:
        emit("error", code="weights_missing", detail=str(exc))
        return EXIT_WEIGHTS_MISSING
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit("error", code="failed", detail=f"{type(exc).__name__}: {exc}")
        return EXIT_FAILED
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
