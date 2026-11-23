"""Quality API: re-making a finished song's stems at another preset, splitting its vocals
into parts, making its loop (the background video drawn from its lyrics), re-timing one lyric
line, and cancelling a background lyric re-alignment (queued by POST .../realign-lyrics)."""

import logging
import os
import threading

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import ValidationError

from backend import realignment, song_loop, vocal_split
from backend.background_jobs import run_job
from backend.project_store import (
    PROJECTS_LOCK,
    ensure_free_space,
    find_project,
    restore_on_failed_save,
    save_projects,
)
from backend.reseparation import (
    cancel_key,
    conflict_reason,
    create_job,
    job_is_active,
    run_reseparation,
    settle_stale_job,
)
from backend.schemas import (
    LyricLineSchema,
    RealignLineRequest,
    ReseparateRequest,
    SongLoopRequest,
    VocalSplitRequest,
)
from backend.services import remote_song_loop, song_loops, vocal_parts
from backend.services.line_realign import LineRealignError, realign_line
from backend.update_drain import ensure_not_draining

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
        vocal_split.settle_stale_job(proj, main_mod.active_cancellations)
        reason = conflict_reason(proj)
        if reason:
            raise HTTPException(status_code=409, detail=reason)
        audio_path = proj.get("audio_path")
        if not audio_path or not os.path.isfile(audio_path):
            raise HTTPException(
                status_code=400,
                detail="The original song audio is missing, so the stems cannot be re-made",
            )
        # After the 404, 409 and 400 checks, which still answer first on a low disk
        ensure_free_space()
        ensure_not_draining()
        job = create_job(
            proj,
            req.quality,
            req.realign_lyrics,
            req.redetect_chords,
            keep_manual=req.keep_manual,
        )
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


@router.post("/api/project/{project_id}/vocal-split", status_code=202)
def split_vocals(project_id: str, req: VocalSplitRequest, bg_tasks: BackgroundTasks):
    """Queues a split of the song's vocal stem into parts; the song is unchanged until both
    parts are ready."""
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        pid = proj.get("id", project_id)
        settle_stale_job(proj, main_mod.active_cancellations)
        realignment.settle_stale_job(proj, main_mod.active_cancellations)
        vocal_split.settle_stale_job(proj, main_mod.active_cancellations)
        reason = vocal_split.conflict_reason(proj)
        if reason:
            raise HTTPException(status_code=409, detail=reason)
        vocals_path = proj.get("vocals_path")
        if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
            raise HTTPException(
                status_code=400, detail="The vocal stem is missing, so it cannot be split"
            )
        ready, why = vocal_parts.split_status(req.kind)
        if not ready:
            raise HTTPException(
                status_code=400,
                detail=f"This server cannot split the vocals: {why or 'RoFormer is unavailable'}",
            )
        # After the 404, 409 and 400 checks, which still answer first on a low disk
        ensure_free_space()
        ensure_not_draining()
        job = vocal_split.create_job(proj, req.kind)
        main_mod.active_cancellations[vocal_split.cancel_key(pid)] = threading.Event()
        save_projects()

    bg_tasks.add_task(run_job, vocal_split.run_vocal_split, pid, job["id"])
    return {"status": "queued", "job": job}


@router.post("/api/project/{project_id}/vocal-split/cancel")
def cancel_vocal_split(project_id: str):
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        if vocal_split.settle_stale_job(proj, main_mod.active_cancellations):
            save_projects()
        if not vocal_split.job_is_active(proj):
            return {"status": "idle", "job": proj.get("vocal_split_job")}
        main_mod.active_cancellations.setdefault(
            vocal_split.cancel_key(proj.get("id", project_id)), threading.Event()
        ).set()
        return {"status": "cancelling", "job": proj["vocal_split_job"]}


@router.post("/api/project/{project_id}/song-loop", status_code=202)
def make_song_loop(project_id: str, req: SongLoopRequest, bg_tasks: BackgroundTasks):
    """Queues the song's loop: a looping background video of the scene in ``prompt``, or of
    one written from the lyrics. The loop the song has stays until the new one is ready."""
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        pid = proj.get("id", project_id)
        song_loop.settle_stale_job(proj, main_mod.active_cancellations)
        reason = song_loop.conflict_reason(proj)
        if reason:
            raise HTTPException(status_code=409, detail=reason)
        ready, why = remote_song_loop.status()
        if not ready:
            raise HTTPException(
                status_code=400,
                detail=f"This server cannot make song loops: {why or 'no cloud GPU'}",
            )
        if req.model and req.model not in song_loops.offered_models():
            raise HTTPException(
                status_code=400,
                detail=f"This server does not make song loops with {req.model!r}",
            )
        if not (req.prompt or song_loops.lyrics_text(proj) or str(proj.get("title") or "").strip()):
            raise HTTPException(
                status_code=400,
                detail="This song has no lyrics or title to go by: describe the loop yourself",
            )
        # After the 404, 409 and 400 checks, which still answer first on a low disk
        ensure_free_space()
        ensure_not_draining()
        job = song_loop.create_job(proj, req.prompt, req.model)
        main_mod.active_cancellations[song_loop.cancel_key(pid)] = threading.Event()
        save_projects()

    bg_tasks.add_task(run_job, song_loop.run_song_loop, pid, job["id"])
    return {"status": "queued", "job": job}


@router.post("/api/project/{project_id}/song-loop/cancel")
def cancel_song_loop(project_id: str):
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        if song_loop.settle_stale_job(proj, main_mod.active_cancellations):
            save_projects()
        if not song_loop.job_is_active(proj):
            return {"status": "idle", "job": proj.get("song_loop_job")}
        main_mod.active_cancellations.setdefault(
            song_loop.cancel_key(proj.get("id", project_id)), threading.Event()
        ).set()
        return {"status": "cancelling", "job": proj["song_loop_job"]}


@router.delete("/api/project/{project_id}/song-loop")
def remove_song_loop(project_id: str):
    """Removes the song's loop; a stage or an export set to it shows the cover art again."""
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = _project_or_404(project_id)
        pid = proj.get("id", project_id)
        if song_loop.settle_stale_job(proj, main_mod.active_cancellations):
            save_projects()
        if song_loop.job_is_active(proj):
            raise HTTPException(
                status_code=409, detail="A loop is being made for this song: cancel it first"
            )
        had_loop = proj.get(song_loops.SONG_LOOP) is not None
        with restore_on_failed_save(proj, (song_loops.SONG_LOOP,)):
            proj.pop(song_loops.SONG_LOOP, None)
            if had_loop:
                save_projects(strict=True)
        # Only once the song no longer names it
        song_loops.remove_file(pid)
    return {"status": "removed" if had_loop else "none"}


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
