"""Daily copies of the library, so a damaged or emptied projects.json can be put back.

``projects.json.bak`` follows the store within a minute. It recovers a file that was cut off
mid-write, but whatever empties or damages the library itself (a bug in a new version, a store
that loaded empty and was then saved, songs deleted by mistake) is in the backup a minute
later. A snapshot is the store as it stood on one day, gzipped, in
``<data dir>/snapshots/projects-YYYY-MM-DD.json.gz``. One is made when the server starts and
then once a day, only if the library changed since the last one, and the newest
LIBRARY_SNAPSHOT_DAYS are kept (14 by default; 0 makes none and removes none).

Nothing reads a snapshot back by itself: restoring one is the owner's decision, made with the
server stopped (the README says how). The store is replaced in one step on every save, so the
copy is read without ``PROJECTS_LOCK`` and is always one whole save.
"""

import gzip
import json
import logging
import os
import re
import threading
import time
import uuid
from datetime import date
from pathlib import Path

from backend import config

logger = logging.getLogger("karaoke_backend")

SNAPSHOTS_DIR_NAME = "snapshots"
DEFAULT_SNAPSHOT_DAYS = 14
# How often the thread looks whether today has its copy yet
CHECK_INTERVAL_SEC = 3600.0
_SNAPSHOT_NAME = re.compile(r"projects-\d{4}-\d{2}-\d{2}\.json\.gz")

_thread_lock = threading.Lock()
_thread: threading.Thread | None = None


def snapshot_days() -> int:
    """LIBRARY_SNAPSHOT_DAYS: how many daily copies are kept, at least 0; unset or
    unreadable is 14. Read on each call."""
    try:
        return max(0, int(os.getenv("LIBRARY_SNAPSHOT_DAYS", str(DEFAULT_SNAPSHOT_DAYS)).strip()))
    except (TypeError, ValueError):
        return DEFAULT_SNAPSHOT_DAYS


def snapshots_dir() -> Path:
    return Path(config.DATA_DIR) / SNAPSHOTS_DIR_NAME


def _store_file() -> Path:
    import backend.main as main_mod
    from backend.project_store import PROJECTS_STORE_FILE

    return getattr(main_mod, "PROJECTS_STORE_FILE", PROJECTS_STORE_FILE)


def list_snapshots() -> list[Path]:
    """The snapshots there are, oldest first (their names sort by day)."""
    try:
        names = [p for p in snapshots_dir().iterdir() if _SNAPSHOT_NAME.fullmatch(p.name)]
    except OSError:
        return []
    return sorted(names, key=lambda p: p.name)


def take_snapshot(today: date | None = None) -> Path | None:
    """Copies the store to today's snapshot and removes the copies past the limit. Returns
    the new file, or None when there is nothing to do: snapshots are off, today has its copy,
    the library has not changed since the newest copy, or the store is missing, empty of
    songs or not a library (a damaged store must not push a good copy out).

    Raises OSError when the copy cannot be written, leaving no partial file."""
    keep = snapshot_days()
    if keep <= 0:
        return None
    store = _store_file()
    folder = snapshots_dir()
    target = folder / f"projects-{(today or date.today()).isoformat()}.json.gz"
    if target.exists():
        return None
    try:
        changed_at = store.stat().st_mtime
    except OSError:
        return None  # no library yet
    existing = list_snapshots()
    if existing:
        try:
            if changed_at <= existing[-1].stat().st_mtime:
                return None
        except OSError:
            pass  # removed meanwhile: make a new one

    raw = store.read_bytes()
    try:
        library = json.loads(raw)
    except ValueError:
        logger.warning(f"{store.name} cannot be read as a library; no snapshot made of it")
        return None
    if not isinstance(library, dict) or not library:
        return None

    folder.mkdir(parents=True, exist_ok=True)
    temp = folder / f".{target.name}.tmp.{uuid.uuid4().hex}"
    try:
        temp.write_bytes(gzip.compress(raw, compresslevel=6))
        os.replace(temp, target)
    except BaseException:
        temp.unlink(missing_ok=True)
        raise

    for old in list_snapshots()[:-keep]:
        try:
            old.unlink()
        except OSError as exc:
            logger.warning(f"Could not remove the old library snapshot {old.name}: {exc}")
    return target


def _keep_taking() -> None:
    while True:
        try:
            made = take_snapshot()
            if made is not None:
                logger.info(f"Library snapshot written: {SNAPSHOTS_DIR_NAME}/{made.name}")
        except Exception as exc:
            # Usually a full disk; the next look tries again
            logger.warning(f"Could not write a library snapshot: {exc}")
        time.sleep(CHECK_INTERVAL_SEC)


def start() -> None:
    """Starts the thread that makes the day's snapshot, now and then hourly (once per
    process)."""
    global _thread
    with _thread_lock:
        if _thread is not None and _thread.is_alive():
            return
        _thread = threading.Thread(target=_keep_taking, name="library-snapshots", daemon=True)
        _thread.start()
