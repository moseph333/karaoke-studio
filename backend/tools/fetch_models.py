"""Download model weights ahead of time, e.g. while building an image or for an offline server.

    python -m backend.tools.fetch_models                 # Demucs + the configured preset
    python -m backend.tools.fetch_models --separation all
    python -m backend.tools.fetch_models --separation none --no-demucs --alignment

RoFormer weights go to AUDIO_SEPARATOR_MODEL_DIR (default <data dir>/models/audio-separator)
and need the optional extras in backend/requirements-ml.txt; Demucs weights go to the
PyTorch hub cache (TORCH_HOME); --alignment fetches the MMS lyric alignment model (about
1.2 GB, CC-BY-NC 4.0) into ALIGNMENT_MODEL_DIR. Afterwards SEPARATION_ALLOW_DOWNLOAD=0 and
ALIGNMENT_ALLOW_DOWNLOAD=0 keep the server from ever downloading at run time.
"""

import argparse
import subprocess
import sys

from backend.services import alignment_config
from backend.services.separation_presets import (
    DEFAULT_DEMUCS_MODEL,
    configured_preset,
    model_dir,
    preset_plan,
)

_DEMUCS_FETCH = "import demucs.pretrained as p; p.get_model({name!r})"
_MMS_FETCH = (
    "from torchaudio.pipelines import MMS_FA; "
    "MMS_FA.get_model(with_star=True, dl_kwargs={{'model_dir': {dir!r}, 'file_name': {file!r}}})"
)


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


def commands(choice: str, demucs: bool, alignment: bool = False) -> list[tuple[str, list[str]]]:
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
    if alignment:
        target = alignment_config.model_dir()
        target.mkdir(parents=True, exist_ok=True)
        code = _MMS_FETCH.format(dir=str(target), file=alignment_config.WEIGHTS_FILE)
        jobs.append(("MMS lyric alignment model", [sys.executable, "-c", code]))
    return jobs


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prefetch separation and alignment model weights.")
    parser.add_argument(
        "--separation",
        choices=("default", "fast", "balanced", "best", "all", "none"),
        default="default",
        help="RoFormer weights to fetch (default: those of SEPARATION_QUALITY)",
    )
    parser.add_argument(
        "--no-demucs", action="store_true", help="Skip the Demucs weights used by Fast"
    )
    parser.add_argument(
        "--alignment", action="store_true", help="Also fetch the MMS lyric alignment model"
    )
    args = parser.parse_args(argv)

    failures = 0
    for label, cmd in commands(
        args.separation, demucs=not args.no_demucs, alignment=args.alignment
    ):
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
