"""Balanced and Best on a cloud GPU (SEPARATION_REMOTE=modal).

The Modal function `separate` in gpu/modal_app.py runs backend.workers.roformer_worker
unchanged on a GPU. Its stderr comes back line by line through modal_jobs, so
separation_progress.ProgressTracker reads the same text as for a local run, and the two stems
come back as the call's return value, with the neural aligner's emission for the new vocals
when the GPU could compute it (kept by emission_cache, so lyric alignment skips its slowest
step here). When the service cannot be reached, or no GPU starts
the job within SEPARATION_REMOTE_QUEUE_SEC, RemoteUnavailable tells the separator to skip the
other cloud presets and fall back to Fast here.

warm_up() starts a GPU container when a song's intake begins, so that Modal finds a GPU and
boots the image while the audio downloads; the container then waits
SEPARATION_REMOTE_SCALEDOWN_SEC for the separation. The pipeline repeats it while a download
runs (at most every WARMUP_INTERVAL_SECONDS, under that window) so the container stays up.
"""

import logging
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.services import emission_cache
from backend.services.modal_jobs import STARTED, RemoteOutcome, RemoteUnavailable, run_modal_job
from backend.services.separation_presets import (
    REMOTE_REALTIME_FACTORS,
    SeparationPlan,
    remote_app_name,
    remote_backend,
    remote_status,
)

logger = logging.getLogger(__name__)

FUNCTION_NAME = "separate"
# Shorter than the GPU container's default 30 s scale-down window, so repeated warm-ups during
# a long download keep one container up
WARMUP_INTERVAL_SECONDS = 20.0

_warmup_lock = threading.Lock()
_last_warmup: float | None = None

__all__ = [
    "FUNCTION_NAME",
    "STARTED",
    "RemoteOutcome",
    "RemoteUnavailable",
    "run_remote",
    "warm_up",
]


def prewarm_enabled() -> bool:
    """SEPARATION_REMOTE_PREWARM (default on): start a cloud GPU when a song's intake begins."""
    value = (os.getenv("SEPARATION_REMOTE_PREWARM") or "1").strip().lower()
    return value not in ("0", "false", "no", "off")


def _spawn_warmup() -> None:
    global _last_warmup
    try:
        import modal

        modal.Function.from_name(remote_app_name(), FUNCTION_NAME).spawn(warmup=True)
    except Exception as exc:
        with _warmup_lock:
            _last_warmup = None  # let the next call try again
        logger.warning(f"Could not start a cloud GPU ahead of the separation: {exc}")
        return
    logger.info("Started a cloud GPU ahead of a separation")


def warm_up(preset: str | None, background: bool = False) -> str:
    """Start a cloud GPU for a separation at `preset` that is about to run, without waiting.

    Returns "warming", "off" (the preset runs locally, or cloud separation or warm-ups are
    off), "recent" (one was started less than WARMUP_INTERVAL_SECONDS ago) or, when not in
    the background, "failed". With background=True the request to Modal is made on a thread
    of its own, so a slow connection never holds the caller up. Never raises.
    """
    global _last_warmup
    if preset not in REMOTE_REALTIME_FACTORS or not prewarm_enabled() or not remote_backend():
        return "off"
    if not remote_status()[0]:
        return "off"
    with _warmup_lock:
        now = time.monotonic()
        if _last_warmup is not None and now - _last_warmup < WARMUP_INTERVAL_SECONDS:
            return "recent"
        _last_warmup = now
    if background:
        threading.Thread(target=_spawn_warmup, name="gpu-warmup", daemon=True).start()
        return "warming"
    _spawn_warmup()
    with _warmup_lock:
        return "failed" if _last_warmup is None else "warming"


def _save_stems(result: dict, out_dir: Path, keep_emission: bool = True) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for key, name in (("vocals", "vocals.wav"), ("no_vocals", "no_vocals.wav")):
        data = result.get(key)
        if data:
            (out_dir / name).write_bytes(data)
    vocals, emission = result.get("vocals"), result.get("emission")
    if keep_emission and isinstance(vocals, bytes) and isinstance(emission, bytes):
        kept = emission_cache.store(vocals, emission)
        if kept is not None:
            logger.info(f"Kept the cloud GPU's neural listening pass as {kept.name}")


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
    keep_emission: bool = True,
) -> RemoteOutcome:
    """Separate audio_file with plan on the cloud GPU into out_dir/vocals.wav and
    out_dir/no_vocals.wav, as the local worker would.

    on_line receives every line the worker writes to stderr and on_started fires once a GPU
    picks the job up. keep_emission=False drops the aligner emission the GPU sends back with
    the stems: a vocal split's "vocals" are one part of the song's, which lyrics are never
    timed on. Raises RemoteUnavailable when the service cannot be reached or no GPU starts
    the job within queue_s.
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
            _save_stems(result, out_dir, keep_emission)
    return outcome
