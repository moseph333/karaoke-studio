"""Rules shared by the background jobs that work on a finished song.

Two jobs can run while a song stays open in the studio: re-making its stems
(``separation_job``, see backend.reseparation) and re-timing its lyrics (``sync_job``, see
backend.realignment). Each keeps its state on the project so the studio can poll it, and
neither may start while the other runs or while the song is still being processed.

Every long job (intake pipelines, renders, re-separations, background re-alignments) is
started with ``BackgroundTasks.add_task(run_job, func, *args)``, on worker threads of its own.
A job registers a cancel event in ``active_cancellations`` before its song shows it as busy and
removes only its own event when it ends (release_cancel_event), so a busy song with no event was
cut off by a server restart: the settle_orphaned_* helpers mark such intakes and renders as
interrupted, at startup and whenever a song is read. The one exception: a render requested while
a cancelled one is still stopping reuses that render's event, already set, instead of getting
its own.
"""

import functools
import math
import threading
import time
from collections.abc import Callable
from typing import Any

import anyio
from anyio import to_thread

SEPARATION_JOB = "separation_job"
SYNC_JOB = "sync_job"
ACTIVE_JOB_STATES = ("queued", "running")
BUSY_PIPELINE_STATES = frozenset(
    {"queued", "processing", "downloading", "separating", "fetching_lyrics", "aligning", "mixing"}
)
RENDER_ACTIVE_STATES = ("queued", "rendering")
INTERRUPTED_BY_RESTART = "Interrupted by a server restart"

# When this server process started, in milliseconds since the epoch like the heartbeat a
# pipeline writes. An intake whose last heartbeat is older ran in an earlier process.
PROCESS_STARTED_AT_MS = int(time.time() * 1000)


# A job holds its thread while it waits for one of the MAX_CONCURRENT_JOBS slots
# (WORKER_SEMAPHORE), then for minutes while it runs. On the threadpool that sync request
# handlers share (40 threads), a queue of jobs could leave none for requests.
JOB_THREADS = anyio.CapacityLimiter(32)


async def run_job(func: Callable[..., Any], *args: Any) -> None:
    """Runs a long background job on the job threads (see JOB_THREADS), telling the host
    how many jobs run when it starts and ends (backend.update_drain)."""
    from backend.update_drain import write_jobs_active

    # The route registered the job's cancel event before this; it is released when the job ends
    write_jobs_active()
    try:
        await to_thread.run_sync(functools.partial(func, *args), limiter=JOB_THREADS)
    finally:
        write_jobs_active()


def job_active(proj: dict, field: str) -> bool:
    job = proj.get(field)
    return isinstance(job, dict) and job.get("status") in ACTIVE_JOB_STATES


def conflict_reason(proj: dict, starting: str) -> str | None:
    """Why a job of kind ``starting`` (SEPARATION_JOB or SYNC_JOB) cannot start now, or None."""
    if job_active(proj, SEPARATION_JOB):
        if starting == SEPARATION_JOB:
            return "The stems for this song are already being re-made"
        return "Wait for the stems to finish re-making first"
    if job_active(proj, SYNC_JOB):
        if starting == SYNC_JOB:
            return "The lyrics of this song are already being re-aligned"
        return "Wait for the lyric re-alignment to finish first"
    if proj.get("status") in BUSY_PIPELINE_STATES:
        return "This song is still being processed"
    if starting == SEPARATION_JOB and proj.get("render_status") in RENDER_ACTIVE_STATES:
        return "Wait for the video render to finish first"
    return None


def _has_cancel_event(proj: dict, active_cancellations: dict, suffix: str = "") -> bool:
    """Whether a job of this process holds a cancel event for the song, under its id or its
    track_id (a route may be called with either) followed by ``suffix``."""
    return any(
        isinstance(key, str) and key and f"{key}{suffix}" in active_cancellations
        for key in (proj.get("id"), proj.get("track_id"))
    )


def _heartbeat_before_process_start(value: Any) -> bool:
    """Whether an intake heartbeat (ms since the epoch) is missing, unreadable or older than
    this server process."""
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return True
    try:
        beat = float(value)
    except (ValueError, OverflowError):  # OverflowError: an int too large for a float
        return True
    return not math.isfinite(beat) or beat < PROCESS_STARTED_AT_MS


def settle_orphaned_intake(proj: dict, active_cancellations: dict) -> bool:
    """Marks an intake that a previous server process left busy as failed. True if changed.

    Settled only with no cancel event under the song's id or track_id and a heartbeat from
    before this process started (or none), so an intake this process runs, or one whose
    heartbeat is still fresh, is left alone."""
    status = proj.get("status")
    if not (isinstance(status, str) and status in BUSY_PIPELINE_STATES):
        return False
    if _has_cancel_event(proj, active_cancellations):
        return False
    if not _heartbeat_before_process_start(proj.get("heartbeat")):
        return False
    proj["status"] = "error"
    proj["error"] = INTERRUPTED_BY_RESTART
    proj["status_detail"] = f"Error: {INTERRUPTED_BY_RESTART}"
    proj["eta_seconds"] = None
    return True


def settle_orphaned_render(proj: dict, active_cancellations: dict) -> bool:
    """Marks a render that a previous server process left queued or rendering as failed, when
    no render event is registered under the song's id or track_id. True if changed."""
    render_status = proj.get("render_status")
    if not (isinstance(render_status, str) and render_status in RENDER_ACTIVE_STATES):
        return False
    if _has_cancel_event(proj, active_cancellations, "_render"):
        return False
    proj["render_status"] = "error"
    proj["render_error"] = INTERRUPTED_BY_RESTART
    proj["render_detail"] = f"Render error: {INTERRUPTED_BY_RESTART}"
    proj["render_eta_seconds"] = None
    return True


def release_cancel_event(active_cancellations: dict, key: str, event: threading.Event) -> None:
    """Removes a job's cancel event when the job ends, unless a newer job has registered its
    own under the same key meanwhile (a cancel followed at once by a new request): removing
    that one would make the new job look cut off by a restart."""
    # Imported here: importing project_store loads the store through backend.main, which
    # imports this module
    from backend.project_store import PROJECTS_LOCK

    # Routes register their events under the lock, so none can be swapped in between
    with PROJECTS_LOCK:
        if active_cancellations.get(key) is event:
            active_cancellations.pop(key, None)
