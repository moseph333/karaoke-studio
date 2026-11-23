"""Make a finished song's loop, the looping background video drawn from its lyrics, without
disturbing the song.

The job hands the lyrics (or the scene the user typed) to the cloud GPU
(backend.services.remote_song_loop), writes what comes back beside the song's renders as
<id>_loop.part.mp4, checks that it is a video a render can take, and only then moves it over
the song's loop and records it as ``song_loop`` (backend.services.song_loops). A cancelled or
failed run leaves the loop the song had; a part file that a server restart cut off is swept
at startup with the unfinished videos of renders.

Unlike the other jobs on a finished song it changes nothing they read, so it neither waits
for them nor makes them wait, and it takes none of the MAX_CONCURRENT_JOBS slots: the server
only waits for the cloud. Loops are made one at a time instead (SONG_LOOP_SEMAPHORE), which
bounds what a busy evening can spend on GPUs.

The job's state lives on the project as ``song_loop_job`` so the studio can poll it. The
song can be deleted, or replaced by a new intake of the same link, while the job runs, so
every write looks the project up again instead of holding on to one dict.
"""

import logging
import threading
import time
import uuid
from typing import Any

from backend.background_jobs import (
    BUSY_PIPELINE_STATES,
    SONG_LOOP_JOB,
    job_active,
    release_cancel_event,
)
from backend.errors import public_error
from backend.project_store import (
    PROJECTS_LOCK,
    find_project,
    save_projects,
    save_projects_throttled,
)
from backend.services import remote_song_loop, song_loops

logger = logging.getLogger("karaoke_backend")

# One loop at a time across the server; the others wait as "queued"
SONG_LOOP_SEMAPHORE = threading.Semaphore(1)
_MODEL_SHARE = 94  # the cloud's work fills the first 94% of the job's progress


class SongLoopCancelled(Exception):
    """The user cancelled the job, or the song was deleted under it."""


def cancel_key(project_id: str) -> str:
    return f"{project_id}_song_loop"


def job_is_active(proj: dict) -> bool:
    return job_active(proj, SONG_LOOP_JOB)


def conflict_reason(proj: dict) -> str | None:
    """Why a loop cannot be made for this song now, or None."""
    if job_is_active(proj):
        return "A loop is already being made for this song"
    if proj.get("status") in BUSY_PIPELINE_STATES:
        return "This song is still being processed"
    if proj.get("status") != "ready":
        return "Only a finished song can have a loop"
    return None


def settle_stale_job(proj: dict, active_cancellations: dict) -> bool:
    """Ends a job that a previous server process left queued or running. True if changed."""
    if not job_is_active(proj) or cancel_key(proj.get("id", "")) in active_cancellations:
        return False
    proj[SONG_LOOP_JOB].update(
        status="error",
        detail="Interrupted by a server restart; the song is unchanged",
        error="Interrupted by a server restart",
        eta_seconds=None,
        finished_at=int(time.time()),
    )
    return True


def create_job(proj: dict, prompt: str | None, model: str | None = None) -> dict:
    """A queued song loop job, put on the project. ``prompt`` is the scene as typed, or None
    to have one written from the lyrics; ``model`` the video model chosen, or None for the
    server's default."""
    job = {
        "id": uuid.uuid4().hex[:12],
        "status": "queued",
        "prompt": prompt or None,
        "model": model or song_loops.configured_model(),
        "progress": 0,
        "detail": "Waiting for another song's loop to finish…",
        "eta_seconds": None,
        "error": None,
        "created_at": int(time.time()),
        "finished_at": None,
    }
    proj[SONG_LOOP_JOB] = job
    return job


def _live(project_id: str, job_id: str) -> tuple[dict, dict]:
    """The project and this job as currently stored, or SongLoopCancelled if gone."""
    proj = find_project(project_id)
    job = proj.get(SONG_LOOP_JOB) if proj else None
    if not isinstance(job, dict) or job.get("id") != job_id:
        raise SongLoopCancelled()
    return proj, job


def _release_unclaimed_event(active_cancellations: dict, project_id: str) -> None:
    """Drops the cancel event a route registered for a job that will never run, unless the
    song (if it still exists) has another such job running that owns it."""
    proj = find_project(project_id)
    if proj is None or not job_is_active(proj):
        active_cancellations.pop(cancel_key(project_id), None)


def _request(proj: dict, job: dict) -> dict[str, Any]:
    """What the cloud function is asked for: the typed scene, or the song to write one from."""
    request: dict[str, Any] = {
        "title": str(proj.get("title") or ""),
        "artist": str(proj.get("artist") or ""),
        "model": job.get("model") or song_loops.configured_model(),
    }
    if job.get("prompt"):
        request["prompt"] = job["prompt"]
    else:
        request["lyrics"] = song_loops.lyrics_text(proj)
    return request


def run_song_loop(project_id: str, job_id: str) -> None:
    """Background worker for one song loop job."""
    import backend.main as main_mod

    try:
        _live(project_id, job_id)
    except SongLoopCancelled:
        _release_unclaimed_event(main_mod.active_cancellations, project_id)
        return
    cancel_event = main_mod.active_cancellations.setdefault(
        cancel_key(project_id), threading.Event()
    )
    staged = song_loops.part_path(project_id)
    started = time.time()
    installed = False

    def update(*, throttle: bool = False, **fields: Any) -> None:
        if cancel_event.is_set() and not installed:
            raise SongLoopCancelled()
        with PROJECTS_LOCK:
            _, current = _live(project_id, job_id)
            current.update(fields, heartbeat=int(time.time() * 1000))
            if throttle:
                save_projects_throttled()
            else:
                save_projects()

    acquired = False
    try:
        while not SONG_LOOP_SEMAPHORE.acquire(timeout=0.25):
            if cancel_event.is_set():
                raise SongLoopCancelled()
        acquired = True

        update(status="running", progress=1, detail="Waiting for a cloud GPU…")
        with PROJECTS_LOCK:
            request = _request(*_live(project_id, job_id))
        progress_floor = 1

        def on_progress(pct: float | None, detail: str, eta: int | None) -> None:
            nonlocal progress_floor
            share = min(_MODEL_SHARE, int((pct or 0.0) * _MODEL_SHARE / 100))
            progress_floor = max(progress_floor, share)
            update(progress=progress_floor, detail=detail, eta_seconds=eta, throttle=True)

        try:
            made = remote_song_loop.make(request, staged, on_progress, cancel_event)
        except remote_song_loop.SongLoopCancelled as exc:
            raise SongLoopCancelled() from exc
        update(progress=96, detail="Saving the loop…", eta_seconds=None)
        info = song_loops.check_video(staged)

        with PROJECTS_LOCK:
            proj, job = _live(project_id, job_id)
            song_loops.install(proj, staged, info, made)
            installed = True
            job.update(
                status="done",
                progress=100,
                detail="The song loop is ready",
                eta_seconds=0,
                finished_at=int(time.time()),
                elapsed_seconds=int(time.time() - started),
            )
            save_projects()
        took = made.get("seconds") or {}
        logger.info(
            f"Made the song loop of {project_id} with {made.get('model')} on "
            f"{made.get('gpu') or 'a cloud GPU'} in {time.time() - started:.0f}s "
            f"(text {took.get('text', '?')}s, video {took.get('video', '?')}s)"
        )
    except Exception as exc:
        cancelled = isinstance(exc, SongLoopCancelled) or (cancel_event.is_set() and not installed)
        if not cancelled:
            logger.error(f"Song loop failed for {project_id}: {exc}", exc_info=True)
        _record_failure(project_id, job_id, exc, cancelled)
    finally:
        if acquired:
            SONG_LOOP_SEMAPHORE.release()
        release_cancel_event(main_mod.active_cancellations, cancel_key(project_id), cancel_event)
        try:
            staged.unlink(missing_ok=True)
        except OSError:
            pass


def _record_failure(project_id: str, job_id: str, exc: Exception, cancelled: bool) -> None:
    if cancelled:
        status, detail = "cancelled", "Cancelled; the song is unchanged"
    else:
        status, detail = "error", "Could not make the song loop; the song is unchanged"
    with PROJECTS_LOCK:
        try:
            _, job = _live(project_id, job_id)
        except SongLoopCancelled:
            return  # the song was deleted
        job.update(
            status=status,
            detail=detail,
            error=None if cancelled else public_error(exc),
            eta_seconds=None,
            finished_at=int(time.time()),
        )
        save_projects()
