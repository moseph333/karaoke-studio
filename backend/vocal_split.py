"""Split a finished song's vocals into parts (lead and backing) without disturbing it.

The split is made under STEMS_DIR/.staging/<audio_id>/<job id> and its two stems are moved
beside the song's vocals only once both are complete (vocal_parts.install), so a cancelled
or failed run leaves the song exactly as it was; the folders of a run that a server restart
cut off are deleted at startup with the staged stems of re-separations. Parts that are
already there and current (a stems folder can be shared by two songs) are taken as they
are, without running the model again.

The job's state lives on the project as ``vocal_split_job`` so the studio can poll it, and
the parts the song has afterwards as ``vocal_splits``. The song can be deleted, or replaced
by a new intake of the same link, while the job runs, so every write looks the project up
again instead of holding on to one dict.
"""

import logging
import os
import shutil
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from backend.background_jobs import VOCAL_SPLIT_JOB, job_active, release_cancel_event
from backend.background_jobs import conflict_reason as job_conflict
from backend.config import STEMS_DIR
from backend.errors import public_error
from backend.project_store import (
    PROJECTS_LOCK,
    find_project,
    save_projects,
    save_projects_throttled,
)
from backend.reseparation import STAGING_DIRNAME, staging_dir
from backend.services import vocal_parts

logger = logging.getLogger("karaoke_backend")

_MODEL_SHARE = 85  # the model itself fills the first 85% of the job's progress


class VocalSplitCancelled(Exception):
    """The user cancelled the job, or the song was deleted under it."""


def cancel_key(project_id: str) -> str:
    return f"{project_id}_vocal_split"


def job_is_active(proj: dict) -> bool:
    return job_active(proj, VOCAL_SPLIT_JOB)


def conflict_reason(proj: dict) -> str | None:
    """Why another job prevents a vocal split from starting now, or None."""
    return job_conflict(proj, VOCAL_SPLIT_JOB)


def settle_stale_job(proj: dict, active_cancellations: dict) -> bool:
    """Ends a job that a previous server process left queued or running. True if changed."""
    if not job_is_active(proj) or cancel_key(proj.get("id", "")) in active_cancellations:
        return False
    proj[VOCAL_SPLIT_JOB].update(
        status="error",
        detail="Interrupted by a server restart; the song is unchanged",
        error="Interrupted by a server restart",
        eta_seconds=None,
        finished_at=int(time.time()),
    )
    return True


def stem_dir_of(proj: dict) -> Path | None:
    """The folder holding the song's vocal stem, where its parts are kept."""
    vocals = proj.get("vocals_path")
    return Path(vocals).parent if isinstance(vocals, str) and vocals else None


def create_job(proj: dict, kind: str) -> dict:
    """A queued vocal split job, put on the project."""
    job = {
        "id": uuid.uuid4().hex[:12],
        "status": "queued",
        "kind": kind,
        "label": vocal_parts.split_label(kind),
        "progress": 0,
        "detail": "Waiting for other jobs to finish…",
        "eta_seconds": None,
        "error": None,
        "created_at": int(time.time()),
        "finished_at": None,
    }
    proj[VOCAL_SPLIT_JOB] = job
    return job


def _live(project_id: str, job_id: str) -> tuple[dict, dict]:
    """The project and this job as currently stored, or VocalSplitCancelled if gone."""
    proj = find_project(project_id)
    job = proj.get(VOCAL_SPLIT_JOB) if proj else None
    if not isinstance(job, dict) or job.get("id") != job_id:
        raise VocalSplitCancelled()
    return proj, job


def _release_unclaimed_event(active_cancellations: dict, project_id: str) -> None:
    """Drops the cancel event a route registered for a job that will never run, unless the
    song (if it still exists) has another such job running that owns it."""
    proj = find_project(project_id)
    if proj is None or not job_is_active(proj):
        active_cancellations.pop(cancel_key(project_id), None)


def run_vocal_split(project_id: str, job_id: str) -> None:
    """Background worker for one vocal split job."""
    import backend.main as main_mod

    try:
        proj, job = _live(project_id, job_id)
    except VocalSplitCancelled:
        _release_unclaimed_event(main_mod.active_cancellations, project_id)
        return
    cancel_event = main_mod.active_cancellations.setdefault(
        cancel_key(project_id), threading.Event()
    )
    stems_dir = getattr(main_mod, "STEMS_DIR", STEMS_DIR)
    audio_id = proj.get("track_id") or proj.get("id") or project_id
    staging_root = staging_dir(stems_dir, audio_id)
    kind, label = job["kind"], job["label"]
    started = time.time()
    installed = False

    def update(*, throttle: bool = False, **fields: Any) -> None:
        # Once the parts are in place the remaining steps are short; finish them
        if cancel_event.is_set() and not installed:
            raise VocalSplitCancelled()
        with PROJECTS_LOCK:
            _, current = _live(project_id, job_id)
            current.update(fields, heartbeat=int(time.time() * 1000))
            if throttle:
                save_projects_throttled()
            else:
                save_projects()

    acquired = False
    try:
        while not main_mod.WORKER_SEMAPHORE.acquire(timeout=0.25):
            if cancel_event.is_set():
                raise VocalSplitCancelled()
        acquired = True

        stem_dir = stem_dir_of(_live(project_id, job_id)[0])
        source = vocal_parts.source_path(stem_dir, kind) if stem_dir else None
        if source is None or not os.path.isfile(source):
            raise RuntimeError("The vocal stem is missing, so it cannot be split")
        update(status="running", progress=1, detail=f"Starting the {label.lower()} split…")

        wanted = set(vocal_parts.SPLITS[kind]["parts"])
        if wanted <= set(vocal_parts.current_parts(stem_dir)):
            # Made for another song that shares these stems, or before an intake retry
            logger.info(f"The {kind} parts of {project_id} are already split")
        else:
            progress_floor = 1

            def on_progress(pct: float | None, detail: str, eta: int | None) -> None:
                nonlocal progress_floor
                share = min(_MODEL_SHARE, int((pct or 0.0) * _MODEL_SHARE / 100))
                progress_floor = max(progress_floor, share)
                update(progress=progress_floor, detail=detail, eta_seconds=eta, throttle=True)

            plan = vocal_parts.split_plan(kind)
            split_started = time.monotonic()
            first, second = main_mod.separator.split_vocals(
                str(source),
                f"{STAGING_DIRNAME}/{audio_id}/{job_id}",
                plan,
                progress_callback=on_progress,
                cancel_event=cancel_event,
            )
            update(progress=90, detail="Saving the vocal parts…", eta_seconds=None)
            record = vocal_parts.split_record(kind, plan, time.monotonic() - split_started)
            vocal_parts.install(stem_dir, kind, first, second, record)
        installed = True

        with PROJECTS_LOCK:
            proj, job = _live(project_id, job_id)
            # A new dict, never an edit in place: restore_on_failed_save keeps shallow copies
            proj["vocal_splits"] = vocal_parts.splits_summary(stem_dir)
            job.update(
                status="done",
                progress=100,
                detail=f"{label} are split",
                eta_seconds=0,
                finished_at=int(time.time()),
                elapsed_seconds=int(time.time() - started),
            )
            save_projects()
        logger.info(f"Split the vocals of {project_id} ({kind})")
    except Exception as exc:
        cancelled = isinstance(exc, VocalSplitCancelled) or (
            cancel_event.is_set() and not installed
        )
        if not cancelled:
            logger.error(f"Vocal split failed for {project_id}: {exc}", exc_info=True)
        _record_failure(project_id, job_id, exc, cancelled, installed)
    finally:
        if acquired:
            main_mod.WORKER_SEMAPHORE.release()
        release_cancel_event(main_mod.active_cancellations, cancel_key(project_id), cancel_event)
        shutil.rmtree(staging_root / job_id, ignore_errors=True)
        for empty in (staging_root, staging_root.parent):
            try:
                empty.rmdir()
            except OSError:
                break


def _record_failure(
    project_id: str, job_id: str, exc: Exception, cancelled: bool, installed: bool
) -> None:
    if installed:
        status, detail = "error", "The vocal parts are in place, but updating the song failed"
    elif cancelled:
        status, detail = "cancelled", "Cancelled; the song is unchanged"
    else:
        status, detail = "error", "Could not split the vocals; the song is unchanged"
    with PROJECTS_LOCK:
        try:
            _, job = _live(project_id, job_id)
        except VocalSplitCancelled:
            return  # the song was deleted
        job.update(
            status=status,
            detail=detail,
            error=None if status == "cancelled" else public_error(exc),
            eta_seconds=None,
            finished_at=int(time.time()),
        )
        save_projects()
