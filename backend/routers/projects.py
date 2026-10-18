"""Project management API router handling search, intake processing, project queries, metadata updates, lyric editing, audio mixing, cancellation, deletion, and YouTube metadata generation."""

import logging
import os
import threading
import time
import uuid

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend.project_store import (
    PROJECTS_LOCK,
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    load_projects,
    save_projects,
)
from backend.schemas import (
    LyricsUpdateRequest,
    MixRequest,
    ProcessRequest,
    ProjectMetadataUpdate,
    RealignLyricsRequest,
    RenderRequest,
    SearchRequest,
)

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["projects"])


@router.post("/api/search")
def search_tracks(req: SearchRequest):
    import backend.main as main_mod

    try:
        results = main_mod.downloader.search_tracks(req.query, limit=req.limit or 5)
        return {"results": results}
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.post("/api/process")
def process_track(req: ProcessRequest, bg_tasks: BackgroundTasks):
    import backend.main as main_mod

    disk_projects = load_projects()
    main_mod.projects.update(disk_projects)

    video_id = main_mod.downloader.extract_video_id(req.url_or_id)
    if video_id:
        for p_id, p in list(main_mod.projects.items()):
            if p.get("id") == video_id or p.get("track_id") == video_id or p_id == video_id:
                if p.get("status") == "ready":
                    logger.info(f"Returning cached ready project {p_id} for {video_id}")
                    return {"project_id": p.get("id", p_id), "status": "ready"}
                elif p.get("status") in [
                    "queued",
                    "downloading",
                    "separating",
                    "fetching_lyrics",
                    "aligning",
                    "mixing",
                ]:
                    # Verify task is genuinely running in memory, not a stale session artifact
                    is_active = (p_id in main_mod.active_cancellations) or (
                        video_id in main_mod.active_cancellations
                    )
                    if is_active:
                        logger.info(
                            f"Project {p_id} for {video_id} already in progress ({p.get('status')})"
                        )
                        return {"project_id": p.get("id", p_id), "status": p.get("status")}
                    logger.warning(
                        f"Project {p_id} was left in state '{p.get('status')}' from a previous server session. Resuming pipeline."
                    )

    project_id = video_id if video_id else str(uuid.uuid4())[:8]
    proj_data = {
        "id": project_id,
        "status": "queued",
        "progress": 0,
        "lines": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "created_by": req.created_by or "Friend",
        "created_at": int(time.time()),
    }
    if video_id:
        proj_data["track_id"] = video_id
    main_mod.projects[project_id] = proj_data
    save_projects()
    cancel_event = main_mod.active_cancellations.setdefault(project_id, threading.Event())
    if video_id and video_id != project_id:
        main_mod.active_cancellations.setdefault(video_id, cancel_event)
    bg_tasks.add_task(main_mod.run_pipeline, project_id, req.url_or_id, req.custom_lyrics)
    return {"project_id": project_id, "status": "queued"}


@router.get("/api/projects")
def list_projects(scope: str | None = "all", user: str | None = None):
    import backend.main as main_mod

    disk_projects = load_projects()
    main_mod.projects.update(disk_projects)

    if scope == "my" and user:
        return {pid: p for pid, p in main_mod.projects.items() if p.get("created_by") == user}
    return main_mod.projects


@router.get("/api/project/{project_id}")
def get_project(project_id: str):
    return get_project_or_404(project_id)


@router.patch("/api/project/{project_id}")
@router.post("/api/project/{project_id}/metadata")
def update_project_metadata(project_id: str, req: ProjectMetadataUpdate):
    """Updates a project's title and/or artist metadata.

    Persists changes atomically to projects.json under PROJECTS_LOCK and
    refreshes the embedded YouTube metadata package if present.
    """
    import backend.main as main_mod

    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    if req.title is None and req.artist is None:
        raise HTTPException(
            status_code=400,
            detail="At least one of 'title' or 'artist' must be provided",
        )

    new_title = req.title.strip() if req.title is not None else None
    new_artist = req.artist.strip() if req.artist is not None else None

    if req.title is not None and not new_title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    if req.artist is not None and not new_artist:
        raise HTTPException(status_code=400, detail="Artist cannot be empty")

    with PROJECTS_LOCK:
        if new_title is not None:
            proj["title"] = new_title
        if new_artist is not None:
            proj["artist"] = new_artist

        if "youtube_package" in proj:
            proj["youtube_package"] = main_mod.youtube_service.generate_youtube_package(
                title=proj.get("title", "Karaoke Track"),
                artist=proj.get("artist", "Artist"),
                lines=proj.get("lines", []),
                semitones=proj.get("semitones", 0),
                has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
            )

        save_projects()

    return proj


@router.post("/api/project/{project_id}/lyrics")
def update_lyrics(project_id: str, req: LyricsUpdateRequest):
    import backend.main as main_mod

    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        proj["lines"] = [line.model_dump() for line in req.lines]

        # Recalculate duration if lines expand beyond existing duration
        if req.lines:
            max_end = max(line.end_time for line in req.lines)
            if max_end > proj.get("duration", 0.0):
                proj["duration"] = max_end

        # Synchronize YouTube metadata package chapters if present
        if "youtube_package" in proj:
            proj["youtube_package"] = main_mod.youtube_service.generate_youtube_package(
                title=proj.get("title", "Karaoke Track"),
                artist=proj.get("artist", "Artist"),
                lines=proj.get("lines", []),
                semitones=proj.get("semitones", 0),
                has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
            )

        save_projects()
    return {"status": "ok", "lines_count": len(req.lines)}


@router.post("/api/project/{project_id}/realign-lyrics")
def realign_lyrics(project_id: str, req: RealignLyricsRequest):
    """Realigns project lyrics acoustically using existing vocal stem.

    Accepts either custom lyrics (LRC or plain text) or triggers an LRCLIB re-fetch,
    then aligns words against the existing isolated vocal stem without re-running Demucs.
    """
    import backend.main as main_mod

    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    vocals_path = proj.get("vocals_path")
    if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
        logger.warning(
            f"Lyric realignment rejected for {project_id}: vocals stem missing or empty ({vocals_path})"
        )
        raise HTTPException(
            status_code=400,
            detail="Cannot realign lyrics: isolated vocal stem missing or not ready",
        )

    if not req.fetch_lrclib and (not req.custom_lyrics or not req.custom_lyrics.strip()):
        raise HTTPException(
            status_code=400,
            detail="Must provide either custom_lyrics or fetch_lrclib=True",
        )

    try:
        if req.fetch_lrclib:
            lyric_data = main_mod.lyrics_service.fetch_lyrics(
                proj.get("title", "Karaoke Track"),
                proj.get("artist", "Artist"),
                proj.get("duration"),
            )
        else:
            lyric_data = main_mod.lyrics_service.process_custom_lyrics(req.custom_lyrics or "")

        lines_to_align = lyric_data.get("lines") or []
        if not lines_to_align:
            raise HTTPException(
                status_code=400,
                detail="No lyric lines found in provided input or LRCLIB response",
            )

        aligned_lines = main_mod.aligner.align_lyrics(vocals_path, lines_to_align)

        with PROJECTS_LOCK:
            proj["lines"] = aligned_lines
            proj["lyric_source"] = lyric_data.get("source", "custom")
            proj["is_synced"] = lyric_data.get("synced", True)

            if aligned_lines:
                max_end = max(
                    (float(line.get("end_time", 0.0)) for line in aligned_lines), default=0.0
                )
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

            save_projects()

        return {
            "status": "ok",
            "lines": aligned_lines,
            "source": proj["lyric_source"],
            "is_synced": proj["is_synced"],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Lyric realignment failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to realign lyrics: {e}") from e


@router.post("/api/project/{project_id}/mix")
def mix_audio(project_id: str, req: MixRequest):
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    inst_path = proj.get("instrumental_path")
    if not inst_path or not os.path.isfile(inst_path) or os.path.getsize(inst_path) == 0:
        logger.warning(
            f"Pre-flight mix rejected for project {project_id}: instrumental stem missing or empty ({inst_path})"
        )
        raise HTTPException(status_code=400, detail="Instrumental stem not ready yet")

    track_id = proj.get("track_id") or proj.get("id") or "track"
    output_filename = f"{track_id}_mix_{req.semitones}_{int(req.guide_volume * 100)}.wav"

    master_path = main_mod.audio_mixer.mix_and_shift(
        instrumental_path=proj["instrumental_path"],
        vocals_path=proj.get("vocals_path"),
        semitones=req.semitones,
        guide_volume=req.guide_volume,
        output_filename=output_filename,
    )

    proj["master_audio_path"] = master_path
    proj["master_audio_url"] = f"/static/output/{output_filename}"
    proj["semitones"] = req.semitones
    proj["guide_volume"] = req.guide_volume
    save_projects()

    return {"status": "ok", "master_audio_url": proj["master_audio_url"]}


@router.post("/api/project/{project_id}/render")
def render_video(project_id: str, req: RenderRequest, bg_tasks: BackgroundTasks):
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    inst_path = proj.get("instrumental_path")
    if not inst_path or not os.path.isfile(inst_path) or os.path.getsize(inst_path) == 0:
        logger.warning(
            f"Pre-flight render rejected for project {project_id}: instrumental stem missing or empty ({inst_path})"
        )
        raise HTTPException(
            status_code=400,
            detail="Cannot render video: instrumental stem not ready",
        )
    logger.info(
        f"Queuing video render for project {project_id} (aspect_ratio={req.aspect_ratio}, semitones={req.semitones})"
    )
    proj["render_status"] = "queued"
    proj["render_progress"] = 5
    proj["render_detail"] = "Queueing render job..."
    proj["render_eta_seconds"] = 45
    proj["render_heartbeat"] = int(time.time() * 1000)
    save_projects()
    render_key = f"{project_id}_render"
    main_mod.active_cancellations.setdefault(render_key, threading.Event())
    bg_tasks.add_task(main_mod.run_video_render, project_id, req)

    return {"status": "queued"}


@router.post("/api/project/{project_id}/cancel")
def cancel_project(project_id: str):
    import backend.main as main_mod

    if project_id in main_mod.active_cancellations:
        main_mod.active_cancellations[project_id].set()
    proj = find_project(project_id)
    if proj:
        proj["status"] = "cancelled"
        proj["status_detail"] = "Processing cancelled by user"
        proj["progress"] = 0
        save_projects()
    return {"status": "ok"}


@router.post("/api/project/{project_id}/cancel-render")
def cancel_render(project_id: str):
    import backend.main as main_mod

    render_key = f"{project_id}_render"
    if render_key in main_mod.active_cancellations:
        main_mod.active_cancellations[render_key].set()
    proj = find_project(project_id)
    if proj:
        proj["render_status"] = "idle"
        proj["render_detail"] = "Rendering cancelled by user"
        proj["render_progress"] = 0
        save_projects()
    return {"status": "ok"}


@router.delete("/api/project/{project_id}")
def delete_project(project_id: str):
    import backend.main as main_mod

    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    pid = proj.get("id", project_id)
    tid = proj.get("track_id")

    # 1. Signal cancellation for any active background jobs
    cancel_keys = {pid, f"{pid}_render"}
    if tid:
        cancel_keys.add(tid)
        cancel_keys.add(f"{tid}_render")

    for key in cancel_keys:
        event = main_mod.active_cancellations.get(key)
        if event is not None:
            event.set()

    # 2. Atomic state removal from projects and disk store under PROJECTS_LOCK
    with PROJECTS_LOCK:
        keys_to_remove = {
            k
            for k, v in main_mod.projects.items()
            if k == pid
            or (isinstance(v, dict) and v.get("id") == pid)
            or (tid and k == tid and isinstance(v, dict) and v.get("id") == pid)
        }
        for k in keys_to_remove:
            main_mod.projects.pop(k, None)

        save_projects()

    # 3. Clean up on-disk media artifacts
    cleanup_project_disk_artifacts(pid, tid, proj)

    return {
        "status": "deleted",
        "project_id": pid,
        "message": f"Project {project_id} deleted successfully",
    }


@router.get("/api/project/{project_id}/youtube-package")
def get_youtube_package(project_id: str):
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    return main_mod.youtube_service.generate_youtube_package(
        title=proj.get("title", "Karaoke Track"),
        artist=proj.get("artist", "Artist"),
        lines=proj.get("lines", []),
        semitones=proj.get("semitones", 0),
        has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
    )
