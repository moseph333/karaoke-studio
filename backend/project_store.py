"""Thread-safe atomic project persistence, state management, lookup helpers, and filesystem media artifact cleanup.

A full disk fails loudly where someone is waiting on the answer: request handlers that report an
edit as saved use a strict save (HTTP 507 when the disk refuses the write) and roll the edit back
in memory, and ensure_free_space refuses new songs, uploads, renders and re-separations once the
data folder's disk drops below DISK_MIN_FREE_MB. Background and progress saves stay soft: they
log the failure and keep the newest state in memory for the next write."""

import json
import logging
import os
import shutil
import threading
import time
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend import config
from backend.config import DATA_DIR, DOWNLOADS_DIR, OUTPUT_DIR, STEMS_DIR

logger = logging.getLogger("karaoke_backend")

# Persistent store for project states
PROJECTS_STORE_FILE = DATA_DIR / "projects.json"
PROJECTS_BACKUP_FILE = DATA_DIR / "projects.json.bak"
PROJECTS_LOCK = threading.RLock()

# Jobs report progress several times a second. The studio reads it from memory, so the file
# only needs to catch up about once a second; status changes are always written at once.
PROGRESS_SAVE_INTERVAL_SEC = 1.0
# The backup is a recovery copy for a corrupted store, renewed at most this often
BACKUP_REFRESH_SEC = 60.0

# time.monotonic() of the last write attempt, successful or not
_last_save_at = 0.0

# What a strict save answers when the disk refuses the write (HTTP 507)
SAVE_FAILED_DETAIL = (
    "The server could not write this change to its disk, which may be full, so it was not "
    "saved. Free up space (delete songs you no longer need), then try again."
)
# What a strict save answers when the write failed for any other reason (HTTP 500)
SAVE_ERROR_DETAIL = "The server could not save this change."

_MISSING = object()


def load_projects() -> dict[str, dict[str, Any]]:
    import backend.main as main_mod

    store_file = getattr(main_mod, "PROJECTS_STORE_FILE", PROJECTS_STORE_FILE)
    backup_file = getattr(main_mod, "PROJECTS_BACKUP_FILE", PROJECTS_BACKUP_FILE)

    with PROJECTS_LOCK:
        # 1. Attempt primary load
        if store_file.exists():
            try:
                content = store_file.read_text(encoding="utf-8").strip()
                if content:
                    return json.loads(content)
            except Exception as e:
                logger.error(
                    f"Corrupted projects.json detected: {e}. Attempting backup recovery..."
                )

        # 2. Attempt fallback to backup if primary failed or does not exist
        if backup_file.exists():
            try:
                content = backup_file.read_text(encoding="utf-8").strip()
                if content:
                    logger.info("Successfully recovered projects state from projects.json.bak")
                    return json.loads(content)
            except Exception as e:
                logger.error(f"Could not load backup projects.json.bak: {e}")

        return {}


def _backup_is_stale(backup_file: Path) -> bool:
    try:
        return time.time() - backup_file.stat().st_mtime >= BACKUP_REFRESH_SEC
    except OSError:
        return True  # no backup yet


def save_projects(*, strict: bool = False) -> bool:
    """Writes every project to projects.json atomically and returns whether it was written.

    A soft save (the default, for background jobs and progress) logs a failed write and returns
    False: memory keeps the newest state and the next save writes it out. A request handler
    that reports an edit as saved passes strict=True, so a failed write becomes an error
    response instead: 507 when the disk refused it (OSError, usually a full disk), 500
    otherwise. Make the edit inside restore_on_failed_save so memory still matches the disk."""
    global _last_save_at
    import backend.main as main_mod

    store_file = getattr(main_mod, "PROJECTS_STORE_FILE", PROJECTS_STORE_FILE)
    backup_file = getattr(main_mod, "PROJECTS_BACKUP_FILE", PROJECTS_BACKUP_FILE)
    data_dir = getattr(main_mod, "DATA_DIR", getattr(store_file, "parent", DATA_DIR))
    projs = getattr(main_mod, "projects", projects)

    with PROJECTS_LOCK:
        try:
            # Deduplicate aliased keys
            unique_projects: dict[str, Any] = {}
            # A snapshot: a project added meanwhile must not end the loop with a RuntimeError
            for k, v in list(projs.items()):
                pid = v.get("id", k)
                if pid not in unique_projects:
                    unique_projects[pid] = v
            # Compact: indenting makes json fall back to its much slower pure-Python encoder
            serialized = json.dumps(unique_projects, separators=(",", ":"))

            data_dir.mkdir(parents=True, exist_ok=True)
            # Write to a temporary file in the same directory (guarantees same filesystem for atomic rename)
            temp_file = data_dir / f".projects.json.tmp.{uuid.uuid4().hex}"
            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(serialized)
                f.flush()
                os.fsync(f.fileno())

            # Keep a copy of the previous store for recovery. Copying it on every save would
            # double the disk traffic of progress updates, so it is renewed once a minute.
            if (
                store_file.exists()
                and store_file.stat().st_size > 0
                and _backup_is_stale(backup_file)
            ):
                try:
                    backup_file.write_bytes(store_file.read_bytes())
                except Exception as bak_err:
                    logger.warning(f"Could not update projects backup: {bak_err}")

            # Atomic swap
            os.replace(temp_file, store_file)
            _last_save_at = time.monotonic()
            return True
        except Exception as e:
            logger.error(f"Failed to persist projects.json atomically: {e}")
            if "temp_file" in locals() and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass
            # Counted as a write: on a full disk, throttled progress saves then retry about
            # once a second instead of on every progress tick of every running job
            _last_save_at = time.monotonic()
            if strict:
                if isinstance(e, OSError):
                    raise HTTPException(status_code=507, detail=SAVE_FAILED_DETAIL) from e
                raise HTTPException(status_code=500, detail=SAVE_ERROR_DETAIL) from e
            return False


@contextmanager
def restore_on_failed_save(proj: dict[str, Any], keys: tuple[str, ...]) -> Iterator[None]:
    """Puts these fields of proj back as they were when the block raises, typically because a
    strict save failed. Memory then still matches projects.json, so a reload or another device
    does not show an edit that was never written and that the next restart would lose.

    Only a shallow copy is kept, so the block must assign these keys, not change their values
    in place. Use it with PROJECTS_LOCK held."""
    before = {key: proj.get(key, _MISSING) for key in keys}
    try:
        yield
    except BaseException:
        for key, value in before.items():
            if value is _MISSING:
                proj.pop(key, None)
            else:
                proj[key] = value
        raise


def ensure_free_space() -> None:
    """Refuses new work with HTTP 507 when the data folder's disk has less than
    DISK_MIN_FREE_MB free (0 turns the check off).

    Called before a new song, an upload, a render or a re-separation starts writing media;
    edits to existing songs are never blocked. When the free space cannot be read, the
    request goes through."""
    min_free_mb = config.DISK_MIN_FREE_MB
    if min_free_mb <= 0:
        return
    import backend.main as main_mod

    data_dir = getattr(main_mod, "DATA_DIR", DATA_DIR)
    try:
        free_mb = shutil.disk_usage(data_dir).free // (1024 * 1024)
    except OSError as e:
        logger.warning(f"Could not read the free disk space of {data_dir}: {e}")
        return
    if free_mb < min_free_mb:
        logger.warning(
            f"Refusing new work: {free_mb} MB free on the data disk, {min_free_mb} MB required"
        )
        raise HTTPException(
            status_code=507,
            detail=(
                f"The server is almost out of disk space ({free_mb} MB free, {min_free_mb} MB "
                "required). Delete songs you no longer need, then try again."
            ),
        )


def save_projects_throttled():
    """Save, unless the store was written less than PROGRESS_SAVE_INTERVAL_SEC ago.

    For progress-only updates: memory always holds the newest state, and the next status
    change or a later progress update writes it out."""
    if time.monotonic() - _last_save_at < PROGRESS_SAVE_INTERVAL_SEC:
        return
    save_projects()


projects: dict[str, dict[str, Any]] = load_projects()


def merge_disk_projects(projs: dict[str, dict[str, Any]]) -> None:
    """Add projects that exist on disk but not in memory.

    Projects already in memory are kept as they are: memory holds their newest state
    (progress reaches the disk at most once a second), and request handlers and jobs may
    still hold those dicts, so replacing them would lose their writes."""
    with PROJECTS_LOCK:
        for pid, proj in load_projects().items():
            projs.setdefault(pid, proj)


def find_project(project_id: str) -> dict[str, Any] | None:
    import backend.main as main_mod

    projs = getattr(main_mod, "projects", projects)
    with PROJECTS_LOCK:
        if project_id in projs:
            return projs[project_id]
        merge_disk_projects(projs)
        if project_id in projs:
            return projs[project_id]
        for p in projs.values():
            if p.get("id") == project_id or p.get("track_id") == project_id:
                return p
        return None


def get_project_or_404(project_id: str) -> dict[str, Any]:
    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


def update_project_chords(project_id: str, chords: list[dict[str, Any]]) -> dict[str, Any]:
    """Atomically updates and persists chord progression segments for a project.

    Acquires PROJECTS_LOCK, updates the project state, and persists to disk
    using an atomic temporary file swap.
    """
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        proj["chords"] = chords
        save_projects()
        return proj


def cleanup_project_disk_artifacts(
    project_id: str,
    track_id: str | None = None,
    proj: dict[str, Any] | None = None,
) -> None:
    """Safely removes all media files associated with project_id (and unshared track_id)

    from DOWNLOADS_DIR, STEMS_DIR, and OUTPUT_DIR without affecting other projects.
    """
    import backend.main as main_mod

    projs = getattr(main_mod, "projects", projects)
    downloads_dir = getattr(main_mod, "DOWNLOADS_DIR", DOWNLOADS_DIR)
    stems_dir = getattr(main_mod, "STEMS_DIR", STEMS_DIR)
    output_dir = getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR)

    pid = project_id
    tid = track_id
    if proj:
        pid = proj.get("id", project_id)
        if not tid:
            tid = proj.get("track_id")

    with PROJECTS_LOCK:
        other_projects = [p for p in projs.values() if isinstance(p, dict) and p.get("id") != pid]

    other_referenced_paths: set[Path] = set()
    other_ids: set[str] = set()

    for op in other_projects:
        for key in (
            "audio_path",
            "thumbnail_path",
            "vocals_path",
            "instrumental_path",
            "master_audio_path",
            "video_path",
        ):
            val = op.get(key)
            if val:
                try:
                    other_referenced_paths.add(Path(val).resolve())
                except Exception:
                    pass
        if op.get("id"):
            other_ids.add(str(op["id"]))
        if op.get("track_id"):
            other_ids.add(str(op["track_id"]))

    # 1. Cleanup STEMS_DIR: STEMS_DIR / pid (and STEMS_DIR / tid if not referenced by others)
    stem_targets = [pid]
    if tid and tid not in other_ids and tid not in stem_targets:
        stem_targets.append(tid)

    if stems_dir.exists():
        for ident in stem_targets:
            stem_subdir = stems_dir / ident
            if stem_subdir.exists() and stem_subdir.is_dir():
                has_external_ref = False
                for f in stem_subdir.rglob("*"):
                    if f.is_file():
                        try:
                            if f.resolve() in other_referenced_paths:
                                has_external_ref = True
                                break
                        except Exception:
                            pass
                if not has_external_ref:
                    shutil.rmtree(stem_subdir, ignore_errors=True)
            # Half-made stems from an unfinished re-separation
            shutil.rmtree(stems_dir / ".staging" / ident, ignore_errors=True)

    # 2. Cleanup flat directories: DOWNLOADS_DIR and OUTPUT_DIR
    target_prefixes = [f"{pid}.", f"{pid}_"]
    exact_names = {pid}
    if tid and tid not in other_ids:
        target_prefixes.extend([f"{tid}.", f"{tid}_"])
        exact_names.add(tid)

    for directory in (downloads_dir, output_dir):
        if not directory.exists():
            continue
        for item in directory.iterdir():
            try:
                name = item.name
                matches = (name in exact_names) or any(
                    name.startswith(pfx) for pfx in target_prefixes
                )
                if matches:
                    resolved = item.resolve()
                    if resolved not in other_referenced_paths:
                        if item.is_file() or item.is_symlink():
                            item.unlink(missing_ok=True)
                        elif item.is_dir():
                            shutil.rmtree(item, ignore_errors=True)
            except Exception as e:
                logger.warning(f"Error checking/removing disk item {item}: {e}")

    # 3. Explicitly clean files recorded directly in proj metadata if passed
    if proj:
        for key in (
            "audio_path",
            "thumbnail_path",
            "vocals_path",
            "instrumental_path",
            "master_audio_path",
            "video_path",
        ):
            val = proj.get(key)
            if val:
                try:
                    p = Path(val).resolve()
                    if p.exists() and p not in other_referenced_paths:
                        if p.is_file() or p.is_symlink():
                            p.unlink(missing_ok=True)
                        elif p.is_dir():
                            shutil.rmtree(p, ignore_errors=True)
                except Exception as e:
                    logger.warning(f"Error removing metadata-referenced file {val}: {e}")
