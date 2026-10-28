"""Download model weights ahead of time, e.g. while building an image or for an offline server.

    python -m backend.tools.fetch_models                 # Demucs + the configured preset
    python -m backend.tools.fetch_models --separation all
    python -m backend.tools.fetch_models --separation none --no-demucs

RoFormer weights go to AUDIO_SEPARATOR_MODEL_DIR (default <data dir>/models/audio-separator)
and need the optional extras in backend/requirements-ml.txt; Demucs weights go to the
PyTorch hub cache (TORCH_HOME). Afterwards SEPARATION_ALLOW_DOWNLOAD=0 can keep the server
from ever downloading at run time.
"""

import argparse
import subprocess
import sys

from backend.services.separation_presets import (
    DEFAULT_DEMUCS_MODEL,
    configured_preset,
    model_dir,
    preset_plan,
)

_DEMUCS_FETCH = "import demucs.pretrained as p; p.get_model({name!r})"


def roformer_models(choice: str) -> list[str]:
    """Model files for --separation: a preset id, "all", "none" or "default"."""
    if choice == "none":
        return []
    if choice == "default":
        choice = configured_preset()
    presets = ("balanced", "best") if choice == "all" else (choice,)
    models: list[str] = []
    for preset in presets:
        plan = preset_plan(preset)
        if plan.engine == "roformer":
            models.extend(m for m in plan.models if m not in models)
    return models


def commands(choice: str, demucs: bool) -> list[tuple[str, list[str]]]:
    jobs = []
    if demucs:
        jobs.append(
            (
                f"Demucs ({DEFAULT_DEMUCS_MODEL})",
                [sys.executable, "-c", _DEMUCS_FETCH.format(name=DEFAULT_DEMUCS_MODEL)],
            )
        )
    models = roformer_models(choice)
    if models:
        jobs.append(
            (
                "RoFormer (" + ", ".join(models) + ")",
                [
                    sys.executable,
                    "-u",
                    "-m",
                    "backend.workers.roformer_worker",
                    "--download-only",
                    "--models",
                    *models,
                    "--model-dir",
                    str(model_dir()),
                    "--allow-download",
                    "1",
                ],
            )
        )
    return jobs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prefetch stem separation model weights.")
    parser.add_argument(
        "--separation",
        choices=("default", "fast", "balanced", "best", "all", "none"),
        default="default",
        help="RoFormer weights to fetch (default: those of SEPARATION_QUALITY)",
    )
    parser.add_argument(
        "--no-demucs", action="store_true", help="Skip the Demucs weights used by Fast"
    )
    args = parser.parse_args(argv)

    failures = 0
    for label, cmd in commands(args.separation, demucs=not args.no_demucs):
        print(f"→ Fetching {label}…", flush=True)
        result = subprocess.run(cmd)
        if result.returncode == 0:
            print(f"✓ {label} ready", flush=True)
        else:
            failures += 1
            print(f"✗ {label} failed (exit {result.returncode})", file=sys.stderr, flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
