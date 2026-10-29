"""Video export on a cloud CPU (RENDER_REMOTE=modal).

The Modal function `render` in gpu/modal_app.py runs FFmpeg with the arguments VideoRenderer
builds, on many cores and with the app's bundled fonts in FONTS_DIR. Its `-progress` lines
come back through modal_jobs for the same progress parsing as a local render, and the MP4 comes
back as the call's return value. VideoRenderer renders locally instead when this is off, when
the service is unavailable, or when the cloud render fails.
"""

import logging
import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend.services.modal_jobs import RemoteUnavailable, run_modal_job
from backend.services.separation_presets import remote_status

logger = logging.getLogger(__name__)

FUNCTION_NAME = "render"
REMOTE_BACKENDS = ("modal",)
# Where gpu/modal_app.py puts backend/assets/fonts in the render image
FONTS_DIR = "/fonts"
OUTPUT_NAME = "out.mp4"
# FFmpeg reports progress twice a second; this much silence means the render is stuck
STALL_SECONDS = 300.0

__all__ = ["FONTS_DIR", "OUTPUT_NAME", "RemoteUnavailable", "RenderCancelled", "enabled", "render"]


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


def render(
    files: dict[str, Path],
    args: list[str],
    output_path: Path,
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    on_started: Callable[[], None] | None = None,
) -> None:
    """Run `ffmpeg *args` on the cloud CPU with files uploaded under their names, writing the
    result (OUTPUT_NAME there) to output_path.

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
