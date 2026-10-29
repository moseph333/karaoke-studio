"""Video export on a cloud CPU (RENDER_REMOTE=modal).

The Modal function `render` in gpu/modal_app.py runs FFmpeg with the arguments VideoRenderer
builds, on many cores and with the app's bundled fonts in FONTS_DIR. Its `-progress` lines
come back through modal_jobs for the same progress parsing as a local render, and the MP4 comes
back as the call's return value. VideoRenderer renders locally instead when this is off, when
the service is unavailable, or when the cloud render fails.

warm_up() starts a container when the Export dialog opens, so that Modal finds a CPU while
the options are chosen; the container then waits RENDER_REMOTE_SCALEDOWN_SEC for the render.
"""

import logging
import os
import threading
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.services.modal_jobs import RemoteUnavailable, run_modal_job
from backend.services.separation_presets import remote_app_name, remote_status

logger = logging.getLogger(__name__)

FUNCTION_NAME = "render"
REMOTE_BACKENDS = ("modal",)
# Where gpu/modal_app.py puts backend/assets/fonts in the render image
FONTS_DIR = "/fonts"
OUTPUT_NAME = "out.mp4"
# FFmpeg reports progress twice a second; this much silence means the render is stuck
STALL_SECONDS = 300.0
# At most one warm-up a minute, however often the Export dialog opens
WARMUP_INTERVAL_SECONDS = 60.0

_warmup_lock = threading.Lock()
_last_warmup: float | None = None

__all__ = [
    "FONTS_DIR",
    "OUTPUT_NAME",
    "RemoteUnavailable",
    "RenderCancelled",
    "enabled",
    "render",
    "warm_up",
]


class RenderCancelled(RuntimeError):
    """The user cancelled while the cloud render ran."""


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def backend() -> str | None:
    """RENDER_REMOTE: "modal" renders exports on a cloud CPU; unset renders them here."""
    value = (os.getenv("RENDER_REMOTE") or "").strip().lower()
    return value if value in REMOTE_BACKENDS else None


def enabled() -> bool:
    """Cloud export is configured and the Modal client and credentials are present."""
    if backend() is None:
        return False
    ready, why = remote_status()
    if not ready:
        logger.warning(f"RENDER_REMOTE is set but cannot be used: {why}")
    return ready


def queue_seconds() -> float:
    """How long an export may wait for a cloud CPU before it renders here instead."""
    return _env_float("RENDER_REMOTE_QUEUE_SEC", 120.0)


def timeout_seconds() -> float:
    return _env_float("RENDER_REMOTE_TIMEOUT_SEC", 3600.0)


def prewarm_enabled() -> bool:
    """RENDER_REMOTE_PREWARM (default on): start a cloud CPU when the Export dialog opens."""
    value = (os.getenv("RENDER_REMOTE_PREWARM") or "1").strip().lower()
    return value not in ("0", "false", "no", "off")


def warm_up() -> str:
    """Start a cloud CPU for an export that is about to be requested, without waiting for it.

    Returns "warming", "off" (cloud export or warm-ups are off), "recent" (one was started
    less than a minute ago) or "failed". Never raises: the export itself still works.
    """
    global _last_warmup
    if not prewarm_enabled() or not enabled():
        return "off"
    with _warmup_lock:
        now = time.monotonic()
        if _last_warmup is not None and now - _last_warmup < WARMUP_INTERVAL_SECONDS:
            return "recent"
        _last_warmup = now
    try:
        import modal

        modal.Function.from_name(remote_app_name(), FUNCTION_NAME).spawn(warmup=True)
    except Exception as exc:
        with _warmup_lock:
            _last_warmup = None  # let the next open try again
        logger.warning(f"Could not start a cloud CPU ahead of the export: {exc}")
        return "failed"
    logger.info("Started a cloud CPU ahead of an export")
    return "warming"


def render(
    files: dict[str, Path],
    args: list[str],
    output_path: Path,
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    on_started: Callable[[], None] | None = None,
    on_waiting: Callable[[float], None] | None = None,
) -> None:
    """Run `ffmpeg *args` on the cloud CPU with files uploaded under their names, writing the
    result (OUTPUT_NAME there) to output_path. on_waiting gets the seconds waited for a CPU.

    Raises RenderCancelled on cancel, RemoteUnavailable when the service cannot take the job,
    and RuntimeError when the render fails or stops.
    """
    payload = {name: path.read_bytes() for name, path in files.items()}
    outcome, result = run_modal_job(
        FUNCTION_NAME,
        {"files": payload, "args": args, "output": OUTPUT_NAME},
        on_line,
        cancel_event,
        timeout_s=timeout_seconds(),
        stall_s=STALL_SECONDS,
        queue_s=queue_seconds(),
        on_started=on_started,
        on_waiting=on_waiting,
        resource="CPU",
        queue_setting="RENDER_REMOTE_QUEUE_SEC",
    )
    if outcome.reason == "cancelled":
        raise RenderCancelled("Video rendering was cancelled by user")
    if outcome.reason:
        raise RuntimeError(f"The cloud render {outcome.reason}")
    video = (result or {}).get("video")
    if outcome.returncode != 0 or not video:
        detail = ((result or {}).get("stderr") or "").strip()
        raise RuntimeError(
            f"FFmpeg video render error on the cloud CPU (exit {outcome.returncode}): {detail}"
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(video)
    logger.info(
        f"Cloud render on {(result or {}).get('cpus') or '?'} CPUs returned "
        f"{len(video) / 1e6:.0f} MB"
    )
