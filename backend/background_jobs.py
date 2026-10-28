"""Rules shared by the background jobs that work on a finished song.

Two jobs can run while a song stays open in the studio: re-making its stems
(``separation_job``, see backend.reseparation) and re-timing its lyrics (``sync_job``, see
backend.realignment). Each keeps its state on the project so the studio can poll it, and
neither may start while the other runs or while the song is still being processed.
"""

SEPARATION_JOB = "separation_job"
SYNC_JOB = "sync_job"
ACTIVE_JOB_STATES = ("queued", "running")
BUSY_PIPELINE_STATES = frozenset(
    {"queued", "processing", "downloading", "separating", "fetching_lyrics", "aligning", "mixing"}
)


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
    if starting == SEPARATION_JOB and proj.get("render_status") in ("queued", "rendering"):
        return "Wait for the video render to finish first"
    return None
