"""Thread-safe atomic project persistence, state management, lookup helpers, and filesystem media artifact cleanup."""

import json
import logging
import os
import shutil
import threading
import uuid
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from backend.config import DATA_DIR, DOWNLOADS_DIR, OUTPUT_DIR, STEMS_DIR

logger = logging.getLogger("karaoke_backend")

# Persistent store for project states
PROJECTS_STORE_FILE = DATA_DIR / "projects.json"
PROJECTS_BACKUP_FILE = DATA_DIR / "projects.json.bak"
PROJECTS_LOCK = threading.RLock()


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


def save_projects():
    import backend.main as main_mod

    store_file = getattr(main_mod, "PROJECTS_STORE_FILE", PROJECTS_STORE_FILE)
    backup_file = getattr(main_mod, "PROJECTS_BACKUP_FILE", PROJECTS_BACKUP_FILE)
    data_dir = getattr(main_mod, "DATA_DIR", getattr(store_file, "parent", DATA_DIR))
    projs = getattr(main_mod, "projects", projects)

    with PROJECTS_LOCK:
        try:
            # Deduplicate aliased keys
            unique_projects: dict[str, Any] = {}
            for k, v in projs.items():
                pid = v.get("id", k)
                if pid not in unique_projects:
                    unique_projects[pid] = v
            serialized = json.dumps(unique_projects, indent=2)

            data_dir.mkdir(parents=True, exist_ok=True)
            # Write to a temporary file in the same directory (guarantees same filesystem for atomic rename)
            temp_file = data_dir / f".projects.json.tmp.{uuid.uuid4().hex}"
            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(serialized)
                f.flush()
                os.fsync(f.fileno())

            # If current store file exists and has size, back it up before replacement
            if store_file.exists() and store_file.stat().st_size > 0:
                try:
                    backup_file.write_bytes(store_file.read_bytes())
                except Exception as bak_err:
                    logger.warning(f"Could not update projects backup: {bak_err}")

            # Atomic swap
            os.replace(temp_file, store_file)
        except Exception as e:
            logger.error(f"Failed to persist projects.json atomically: {e}")
            if "temp_file" in locals() and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass


projects: dict[str, dict[str, Any]] = load_projects()


def find_project(project_id: str) -> dict[str, Any] | None:
    import backend.main as main_mod

    projs = getattr(main_mod, "projects", projects)
    with PROJECTS_LOCK:
        if project_id in projs:
            return projs[project_id]
        disk_projects = load_projects()
        projs.update(disk_projects)
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
