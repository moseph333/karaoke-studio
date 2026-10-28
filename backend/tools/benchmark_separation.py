"""Measure stem separation quality against reference stems (SI-SDR).

    python -m backend.tools.benchmark_separation --mix song.wav --vocals vocals.wav
    python -m backend.tools.benchmark_separation --mix song.wav --vocals vocals.wav \\
        --instrumental accompaniment.wav --presets fast balanced best --json results.json

Separates the mixture with each preset, through the same engines and fallbacks the studio
uses, and scores the stems against the references with the scale-invariant signal-to-
distortion ratio (SI-SDR, in dB on mono downmixes; higher is better, and 3 dB is a clearly
audible step). Without --instrumental the reference backing track is the mixture minus the
reference vocals. Songs with official stems (MUSDB18-HQ, for example) give meaningful
numbers. The RoFormer presets need the extras in backend/requirements-ml.txt and download
their weights on first use unless SEPARATION_ALLOW_DOWNLOAD=0; --keep saves the stems for
listening.
"""

import argparse
import json
import math
import shutil
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from backend.services.separation_presets import PRESET_IDS


def load_mono(path: Path, rate: int | None = None) -> tuple[np.ndarray, int]:
    """A file as mono float64, resampled to ``rate`` when given."""
    data, sample_rate = sf.read(str(path), dtype="float64", always_2d=True)
    mono = data.mean(axis=1)
    if rate and sample_rate != rate:
        from scipy.signal import resample_poly

        divisor = math.gcd(rate, sample_rate)
        mono = resample_poly(mono, rate // divisor, sample_rate // divisor)
        sample_rate = rate
    return mono, sample_rate


def si_sdr(estimate: np.ndarray, reference: np.ndarray) -> float | None:
    """Scale-invariant SDR in dB over the common length, or None for a silent reference."""
    length = min(len(estimate), len(reference))
    est = estimate[:length] - estimate[:length].mean()
    ref = reference[:length] - reference[:length].mean()
    energy = float(np.dot(ref, ref))
    if length == 0 or energy <= 1e-12:
        return None
    target = (float(np.dot(est, ref)) / energy) * ref
    noise = est - target
    ratio = float(np.dot(target, target)) / max(float(np.dot(noise, noise)), 1e-12)
    return round(10.0 * math.log10(max(ratio, 1e-12)), 2)


def references(mix: Path, vocals: Path, instrumental: Path | None) -> tuple[dict, int]:
    vocals_ref, rate = load_mono(vocals)
    if instrumental is not None:
        instrumental_ref, _ = load_mono(instrumental, rate)
    else:
        mixture, _ = load_mono(mix, rate)
        length = min(len(mixture), len(vocals_ref))
        instrumental_ref = mixture[:length] - vocals_ref[:length]
    return {"vocals": vocals_ref, "instrumental": instrumental_ref}, rate


def run_preset(mix: Path, preset: str, work_dir: Path) -> tuple[dict, float]:
    from backend.services.separator import AudioSeparator

    separator = AudioSeparator(output_base_dir=work_dir)
    started = time.monotonic()
    result = separator.separate_stems(str(mix), preset, model_name=preset)
    return result, time.monotonic() - started


def score_preset(mix: Path, preset: str, work_dir: Path, refs: dict, rate: int) -> dict:
    try:
        result, elapsed = run_preset(mix, preset, work_dir)
    except Exception as exc:  # an unavailable or failing engine: report it, keep going
        return {"error": str(exc)}
    separation = result.get("separation") or {}
    vocals, _ = load_mono(Path(result["vocals_path"]), rate)
    instrumental, _ = load_mono(Path(result["instrumental_path"]), rate)
    return {
        "engine_used": separation.get("label") or separation.get("engine"),
        "fallback_reason": separation.get("fallback_reason"),
        "vocals_si_sdr_db": si_sdr(vocals, refs["vocals"]),
        "instrumental_si_sdr_db": si_sdr(instrumental, refs["instrumental"]),
        "runtime_seconds": round(elapsed, 1),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark stem separation against references.")
    parser.add_argument("--mix", required=True, type=Path, help="The full song")
    parser.add_argument("--vocals", required=True, type=Path, help="Reference vocal stem")
    parser.add_argument("--instrumental", type=Path, help="Reference backing track")
    parser.add_argument("--presets", nargs="+", choices=PRESET_IDS, default=list(PRESET_IDS))
    parser.add_argument("--keep", type=Path, help="Keep each preset's stems in this folder")
    parser.add_argument("--json", type=Path, help="Also write the results here")
    args = parser.parse_args(argv)

    refs, rate = references(args.mix, args.vocals, args.instrumental)
    work_root = args.keep or Path(tempfile.mkdtemp(prefix="karaoke-sep-bench-"))
    results: dict[str, dict] = {}
    try:
        for preset in dict.fromkeys(args.presets):
            print(f"→ Separating with {preset}…", file=sys.stderr, flush=True)
            results[preset] = score_preset(args.mix, preset, work_root, refs, rate)
    finally:
        if args.keep is None:
            shutil.rmtree(work_root, ignore_errors=True)

    columns = ["engine_used", "vocals_si_sdr_db", "instrumental_si_sdr_db", "runtime_seconds"]
    width = max(len(c) for c in columns)
    print(f"{'':{width}}  " + "  ".join(f"{p:>28}" for p in results))
    for column in columns:
        cells = [results[p].get(column) for p in results]
        row = "  ".join(f"{'-' if c is None else str(c)[:28]:>28}" for c in cells)
        print(f"{column:{width}}  {row}")
    for preset, result in results.items():
        if result.get("error"):
            print(f"note: {preset} failed: {result['error']}", file=sys.stderr)
        elif result.get("fallback_reason"):
            print(
                f"note: {preset} ran as {result['engine_used']}: {result['fallback_reason']}",
                file=sys.stderr,
            )
    if args.json:
        args.json.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return 0 if any("error" not in r for r in results.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
