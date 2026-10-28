"""Stem quality API: re-separating a finished song at another preset."""

import os
import threading

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.project_store import PROJECTS_LOCK, find_project, save_projects
from backend.reseparation import (
    cancel_key,
    conflict_reason,
    create_job,
    job_is_active,
    run_reseparation,
    settle_stale_job,
)
from backend.schemas import ReseparateRequest

router = APIRouter(tags=["quality"])


def _project_or_404(project_id: str) -> dict:
    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


@router.post("/api/project/{project_id}/reseparate", status_code=202)
def reseparate(project_id: str, req: ReseparateRequest, bg_tasks: BackgroundTasks):
    """Queues a re-separation; the song keeps its current stems until the new ones are ready."""
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        pid = proj.get("id", project_id)
        settle_stale_job(proj, main_mod.active_cancellations)
        reason = conflict_reason(proj)
        if reason:
            raise HTTPException(status_code=409, detail=reason)
        audio_path = proj.get("audio_path")
        if not audio_path or not os.path.isfile(audio_path):
            raise HTTPException(
                status_code=400,
                detail="The original song audio is missing, so the stems cannot be re-made",
            )
        job = create_job(proj, req.quality, req.realign_lyrics, req.redetect_chords)
        main_mod.active_cancellations[cancel_key(pid)] = threading.Event()
        save_projects()

    bg_tasks.add_task(run_reseparation, pid, job["id"])
    return {"status": "queued", "job": job}


@router.post("/api/project/{project_id}/reseparate/cancel")
def cancel_reseparation(project_id: str):
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        if settle_stale_job(proj, main_mod.active_cancellations):
            save_projects()
        if not job_is_active(proj):
            return {"status": "idle", "job": proj.get("separation_job")}
        main_mod.active_cancellations.setdefault(
            cancel_key(proj.get("id", project_id)), threading.Event()
        ).set()
        return {"status": "cancelling", "job": proj["separation_job"]}
