"""Re-time a song's lyrics in the background with the best available aligner.

POST /api/project/{id}/realign-lyrics with ``background: true`` works out the lyrics at once
(new text, an LRCLIB fetch, or the studio's current lines) and queues this job. It runs the
server's configured aligner, the neural one when available, while the song stays usable, and
keeps its state on the project as ``sync_job`` so the studio can poll it. The result replaces
the song's lines only if nobody saved other lines in the meantime.

Project dicts can be replaced by fresh copies from disk at any time (see find_project), so
every write looks the project up again instead of holding on to one dict.
"""

import hashlib
import json
import logging
import os
import threading
import time
import uuid
from typing import Any

from backend.background_jobs import SYNC_JOB, job_active
from backend.background_jobs import conflict_reason as job_conflict
from backend.project_store import PROJECTS_LOCK, find_project, save_projects
from backend.services.lyric_sync import AlignmentCancelled, sync_lyrics

logger = logging.getLogger("karaoke_backend")


class RealignmentCancelled(Exception):
    """The user cancelled the job, or the song was deleted under it."""


def cancel_key(project_id: str) -> str:
    return f"{project_id}_sync"


def job_is_active(proj: dict) -> bool:
    return job_active(proj, SYNC_JOB)


def conflict_reason(proj: dict) -> str | None:
    """Why another job prevents a background re-alignment from starting now, or None."""
    return job_conflict(proj, SYNC_JOB)


def lines_fingerprint(lines: Any) -> str:
    """A short digest of a song's lines, to notice edits saved while a job ran."""
    payload = json.dumps(lines or [], sort_keys=True, default=str).encode("utf-8")
    return hashlib.blake2b(payload, digest_size=8).hexdigest()


def settle_stale_job(proj: dict, active_cancellations: dict) -> bool:
    """Ends a job that a previous server process left queued or running. True if changed."""
    if not job_is_active(proj) or cancel_key(proj.get("id", "")) in active_cancellations:
        return False
    proj[SYNC_JOB].update(
        status="error",
        detail="Interrupted by a server restart; the lyrics keep their previous timing",
        error="Interrupted by a server restart",
        finished_at=int(time.time()),
    )
    return True


def create_job(proj: dict, mode: str) -> dict:
    job = {
        "id": uuid.uuid4().hex[:12],
        "status": "queued",
        "mode": mode,
        "progress": 0,
        "detail": "Waiting for other jobs to finish…",
        "error": None,
        "created_at": int(time.time()),
        "finished_at": None,
        "lines_fingerprint": lines_fingerprint(proj.get("lines")),
    }
    proj[SYNC_JOB] = job
    return job


def store_aligned_lines(main_mod, proj: dict, lines: list[dict]) -> None:
    """Puts newly timed lines on a song, stretching its duration to fit them and refreshing
    its YouTube chapters. Call with PROJECTS_LOCK held."""
    proj["lines"] = lines
    if lines:
        max_end = max((float(line.get("end_time", 0.0)) for line in lines), default=0.0)
        if max_end > proj.get("duration", 0.0):
            proj["duration"] = max_end
    if "youtube_package" in proj:
        proj["youtube_package"] = main_mod.youtube_service.generate_youtube_package(
            title=proj.get("title", "Karaoke Track"),
            artist=proj.get("artist", "Artist"),
            lines=proj.get("lines", []),
            semitones=proj.get("semitones", 0),
            has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
        )


def _live(project_id: str, job_id: str) -> tuple[dict, dict]:
    """The project and this job as currently stored, or RealignmentCancelled if gone."""
    proj = find_project(project_id)
    job = proj.get(SYNC_JOB) if proj else None
    if not isinstance(job, dict) or job.get("id") != job_id:
        raise RealignmentCancelled()
    return proj, job


def run_realignment(
    project_id: str, job_id: str, lines: list[dict], lyric_data: dict, mode: str
) -> None:
    """Background worker for one re-alignment job."""
    import backend.main as main_mod

    try:
        _live(project_id, job_id)
    except RealignmentCancelled:
        return
    cancel_event = main_mod.active_cancellations.setdefault(
        cancel_key(project_id), threading.Event()
    )
    started = time.time()
    progress_floor = 1

    def update(**fields: Any) -> None:
        if cancel_event.is_set():
            raise RealignmentCancelled()
        with PROJECTS_LOCK:
            _, current = _live(project_id, job_id)
            current.update(fields, heartbeat=int(time.time() * 1000))
            save_projects()

    acquired = False
    try:
        while not main_mod.WORKER_SEMAPHORE.acquire(timeout=0.25):
            if cancel_event.is_set():
                raise RealignmentCancelled()
        acquired = True

        vocals_path = _live(project_id, job_id)[0].get("vocals_path")
        if not vocals_path or not os.path.isfile(vocals_path):
            raise RuntimeError(
                "The isolated vocal stem is missing, so the lyrics cannot be re-aligned"
            )
        update(status="running", progress=progress_floor, detail="Aligning lyrics…")

        def on_progress(pct: float | None, detail: str) -> None:
            nonlocal progress_floor
            if pct is not None:
                progress_floor = max(progress_floor, min(99, int(pct)))
            update(progress=progress_floor, detail=detail)

        result = sync_lyrics(
            vocals_path,
            lines,
            lyric_data=lyric_data,
            progress=on_progress,
            cancel_event=cancel_event,
        )

        with PROJECTS_LOCK:
            proj, job = _live(project_id, job_id)
            if cancel_event.is_set():
                raise RealignmentCancelled()
            finished = {
                "finished_at": int(time.time()),
                "elapsed_seconds": int(time.time() - started),
            }
            if lines_fingerprint(proj.get("lines")) != job.get("lines_fingerprint"):
                job.update(
                    status="error",
                    progress=100,
                    detail="The lyrics were edited while re-aligning, so your edits were kept",
                    error="The lyrics changed while they were being re-aligned",
                    **finished,
                )
                save_projects()
                return
            store_aligned_lines(main_mod, proj, result.lines)
            if mode == "lines":
                # Same lyrics, new timing: where they came from has not changed
                if proj.get("lyric_timing") in (None, "none"):
                    proj["lyric_timing"] = result.lyric_timing
            else:
                proj["lyric_source"] = lyric_data.get("source", "custom")
                proj["is_synced"] = lyric_data.get("synced", True)
                proj["lyric_timing"] = result.lyric_timing
            proj["sync_report"] = result.report
            engine = result.report.get("engine")
            label = "the neural aligner" if engine == "ctc" else "the fast aligner"
            job.update(
                status="done",
                progress=100,
                detail=f"Lyrics re-aligned with {label}",
                engine=engine,
                fallback_reason=result.report.get("fallback_reason"),
                **finished,
            )
            save_projects()
        logger.info(f"Re-aligned the lyrics of {project_id} ({engine})")
    except Exception as exc:
        cancelled = isinstance(exc, (RealignmentCancelled, AlignmentCancelled))
        cancelled = cancelled or cancel_event.is_set()
        if not cancelled:
            logger.error(f"Lyric re-alignment failed for {project_id}: {exc}", exc_info=True)
        _record_failure(project_id, job_id, exc, cancelled)
    finally:
        if acquired:
            main_mod.WORKER_SEMAPHORE.release()
        main_mod.active_cancellations.pop(cancel_key(project_id), None)


def _record_failure(project_id: str, job_id: str, exc: Exception, cancelled: bool) -> None:
    if cancelled:
        status, detail = "cancelled", "Cancelled; the lyrics keep their previous timing"
    else:
        status, detail = "error", "Could not re-align the lyrics; they keep their previous timing"
    with PROJECTS_LOCK:
        try:
            _, job = _live(project_id, job_id)
        except RealignmentCancelled:
            return  # the song was deleted
        job.update(
            status=status,
            detail=detail,
            error=None if cancelled else str(exc),
            finished_at=int(time.time()),
        )
        save_projects()
