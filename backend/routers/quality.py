"""Quality API: re-making a finished song's stems at another preset, re-timing one lyric
line, and cancelling a background lyric re-alignment (queued by POST .../realign-lyrics)."""

import logging
import os
import threading

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import ValidationError

from backend import realignment
from backend.background_jobs import run_job
from backend.project_store import PROJECTS_LOCK, find_project, save_projects
from backend.reseparation import (
    cancel_key,
    conflict_reason,
    create_job,
    job_is_active,
    run_reseparation,
    settle_stale_job,
)
from backend.schemas import LyricLineSchema, RealignLineRequest, ReseparateRequest
from backend.services.line_realign import LineRealignError, realign_line

logger = logging.getLogger("karaoke_backend")

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
        realignment.settle_stale_job(proj, main_mod.active_cancellations)
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

    bg_tasks.add_task(run_job, run_reseparation, pid, job["id"])
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


@router.post("/api/project/{project_id}/realign-lyrics/cancel")
def cancel_realignment(project_id: str):
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        if realignment.settle_stale_job(proj, main_mod.active_cancellations):
            save_projects()
        if not realignment.job_is_active(proj):
            return {"status": "idle", "job": proj.get("sync_job")}
        main_mod.active_cancellations.setdefault(
            realignment.cancel_key(proj.get("id", project_id)), threading.Event()
        ).set()
        return {"status": "cancelling", "job": proj["sync_job"]}


@router.post("/api/project/{project_id}/realign-line")
def realign_one_line(project_id: str, req: RealignLineRequest):
    """Finds where one line is sung near its current timing and times its words. Nothing is
    saved: the studio applies the returned line as an undoable edit."""
    proj = _project_or_404(project_id)
    vocals_path = proj.get("vocals_path")
    if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot realign lyrics: isolated vocal stem missing or not ready",
        )
    original = req.line.model_dump()
    try:
        result = realign_line(
            vocals_path,
            original,
            prev_end=req.prev_end,
            next_start=req.next_start,
            engine=req.engine,
            search_window=req.search_window,
        )
    except LineRealignError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    status, detail = result.status, result.detail
    try:
        line = LyricLineSchema.model_validate(result.line).model_dump()
    except ValidationError as exc:
        logger.error(f"Re-timed line for {project_id} failed validation: {exc}")
        status, detail, line = "not_found", "This line could not be timed", original
    return {
        "status": status,
        "line": line,
        "engine": result.engine,
        "elapsed": result.elapsed,
        "fallback_reason": result.fallback_reason,
        "detail": detail,
        "window": list(result.window),
    }
