"""Balanced and Best on a cloud GPU (SEPARATION_REMOTE=modal).

The Modal function `separate` in gpu/modal_app.py runs backend.workers.roformer_worker
unchanged on a GPU. Its stderr comes back line by line through modal_jobs, so
separation_progress.ProgressTracker reads the same text as for a local run, and the two stems
come back as the call's return value. When the service cannot be reached, or no GPU starts
the job within SEPARATION_REMOTE_QUEUE_SEC, RemoteUnavailable tells the separator to skip the
other cloud presets and fall back to Fast here.
"""

import logging
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.services.modal_jobs import STARTED, RemoteOutcome, RemoteUnavailable, run_modal_job
from backend.services.separation_presets import SeparationPlan

logger = logging.getLogger(__name__)

FUNCTION_NAME = "separate"

__all__ = ["FUNCTION_NAME", "STARTED", "RemoteOutcome", "RemoteUnavailable", "run_remote"]


def _save_stems(result: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for key, name in (("vocals", "vocals.wav"), ("no_vocals", "no_vocals.wav")):
        data = result.get(key)
        if data:
            (out_dir / name).write_bytes(data)


def run_remote(
    plan: SeparationPlan,
    audio_file: Path,
    out_dir: Path,
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    *,
    timeout_s: float,
    stall_s: float,
    queue_s: float,
    on_started: Callable[[], None] | None = None,
) -> RemoteOutcome:
    """Separate audio_file with plan on the cloud GPU into out_dir/vocals.wav and
    out_dir/no_vocals.wav, as the local worker would.

    on_line receives every line the worker writes to stderr and on_started fires once a GPU
    picks the job up. Raises RemoteUnavailable when the service cannot be reached or no GPU
    starts the job within queue_s.
    """
    audio = audio_file.read_bytes()
    started_at = time.monotonic()
    outcome, result = run_modal_job(
        FUNCTION_NAME,
        {
            "audio": audio,
            "filename": audio_file.name,
            "models": list(plan.models),
            "overlap": int(plan.params.get("overlap", 2)),
            "ensemble": str(plan.params.get("ensemble", "avg_wave")),
        },
        on_line,
        cancel_event,
        timeout_s=timeout_s,
        stall_s=stall_s,
        queue_s=queue_s,
        on_started=on_started,
        resource="GPU",
        queue_setting="SEPARATION_REMOTE_QUEUE_SEC",
    )
    if result is not None:
        gpu = result.get("gpu") or "an unknown GPU"
        logger.info(
            f"Cloud GPU job on {gpu} finished with exit {outcome.returncode} "
            f"after {time.monotonic() - started_at:.0f}s"
        )
        if outcome.returncode == 0:
            _save_stems(result, out_dir)
    return outcome
