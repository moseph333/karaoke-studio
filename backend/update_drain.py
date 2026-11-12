"""Lets a host update wait for running jobs instead of cutting them off.

The handshake goes through two files in the data folder, which the host and the container
share (the same way ``.update_requested`` works):

- ``.update_draining`` is written by the host (``scripts/update_when_idle.sh``) once the new
  image is built. While it is fresh, routes that start a long job (a new song, an upload, a
  render, a re-separation, a background re-alignment) answer 503 so the server can become idle;
  editing, mixing, playback and downloads keep working. A file older than
  UPDATE_DRAIN_MAX_SEC plus a margin is ignored, so a host that dies mid-update cannot pause
  jobs for good, and the server removes it at startup since the update then has happened.
- ``.jobs_active`` is written by the server: how many jobs hold a cancel event in
  ``active_cancellations`` (every long job registers one before its song shows it as busy and
  removes it when it ends), rewritten when a job starts or ends and by a heartbeat thread.
  The host restarts the container once the count is 0, the file goes stale (the server is not
  answering) or its deadline passes.
"""

import json
import logging
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend import config

logger = logging.getLogger("karaoke_backend")

DRAIN_FILE_NAME = ".update_draining"
JOBS_FILE_NAME = ".jobs_active"
DEFAULT_DRAIN_MAX_SEC = 2700
# A drain file this much older than UPDATE_DRAIN_MAX_SEC is left over from a host that gave up
DRAIN_STALE_MARGIN_SEC = 300
JOBS_HEARTBEAT_SEC = 15.0
DRAINING_DETAIL = (
    "The studio is about to update, so new songs, renders and re-made stems are paused for a "
    "few minutes. Your edits still save. Try again shortly."
)
RETRY_AFTER_SEC = 300

_heartbeat_lock = threading.Lock()
_heartbeat_thread: threading.Thread | None = None
_write_lock = threading.Lock()


def drain_max_sec() -> int:
    """UPDATE_DRAIN_MAX_SEC (default 45 minutes): how long an update waits for running jobs
    before it restarts anyway. Read on each call."""
    try:
        return max(0, int(os.getenv("UPDATE_DRAIN_MAX_SEC", str(DEFAULT_DRAIN_MAX_SEC)).strip()))
    except (TypeError, ValueError):
        return DEFAULT_DRAIN_MAX_SEC


def _data_dir() -> Path:
    return Path(config.DATA_DIR)


def drain_file() -> Path:
    return _data_dir() / DRAIN_FILE_NAME


def jobs_file() -> Path:
    return _data_dir() / JOBS_FILE_NAME


def is_draining() -> bool:
    """Whether a host update is waiting for running jobs (a fresh ``.update_draining``)."""
    try:
        age = time.time() - drain_file().stat().st_mtime
    except OSError:
        return False
    return age < drain_max_sec() + DRAIN_STALE_MARGIN_SEC


def ensure_not_draining() -> None:
    """Refuses new long jobs with HTTP 503 while an update waits for the running ones."""
    if is_draining():
        raise HTTPException(
            status_code=503,
            detail=DRAINING_DETAIL,
            headers={"Retry-After": str(RETRY_AFTER_SEC)},
        )


def clear_drain_file() -> bool:
    """Removes a leftover ``.update_draining``. True if one was there."""
    try:
        drain_file().unlink()
        return True
    except FileNotFoundError:
        return False


def _job_kind(key: str) -> str:
    for suffix, kind in (("_render", "render"), ("_reseparate", "stems"), ("_sync", "lyrics")):
        if key.endswith(suffix):
            return kind
    return "intake"


def active_jobs() -> dict[str, Any]:
    """How many long jobs this process runs or has queued, by kind."""
    import backend.main as main_mod

    keys = [str(key) for key in list(main_mod.active_cancellations)]
    kinds: dict[str, int] = {}
    for key in keys:
        kind = _job_kind(key)
        kinds[kind] = kinds.get(kind, 0) + 1
    return {"count": len(keys), "kinds": kinds}


def write_jobs_active() -> None:
    """Rewrites ``.jobs_active`` for the host. Never raises: a failed write only means the host
    sees a stale file and stops waiting."""
    try:
        payload = {**active_jobs(), "updated_at": time.time(), "pid": os.getpid()}
        target = jobs_file()
        with _write_lock:
            tmp = target.with_name(f"{target.name}.tmp")
            tmp.write_text(json.dumps(payload), encoding="utf-8")
            os.replace(tmp, target)
    except Exception:
        logger.debug("Could not write the active job count", exc_info=True)


def _heartbeat() -> None:
    while True:
        write_jobs_active()
        time.sleep(JOBS_HEARTBEAT_SEC)


def start_jobs_heartbeat() -> None:
    """Starts the thread that keeps ``.jobs_active`` fresh (once per process)."""
    global _heartbeat_thread
    with _heartbeat_lock:
        if _heartbeat_thread is not None and _heartbeat_thread.is_alive():
            return
        _heartbeat_thread = threading.Thread(target=_heartbeat, name="jobs-heartbeat", daemon=True)
        _heartbeat_thread.start()
