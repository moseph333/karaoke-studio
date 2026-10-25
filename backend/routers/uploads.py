"""Media upload API router handling custom audio track intake, custom instrumental replacement, and image/video background uploads."""

import logging
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from backend.config import BACKGROUNDS_DIR, DOWNLOADS_DIR, STEMS_DIR
from backend.project_store import get_project_or_404, save_projects
from backend.upload_utils import (
    ALLOWED_AUDIO_EXTS,
    ALLOWED_BACKGROUND_EXTS,
    MAX_BACKGROUND_UPLOAD_BYTES,
    MAX_IMAGE_BACKGROUND_UPLOAD_BYTES,
    MAX_INSTRUMENTAL_UPLOAD_BYTES,
    MAX_TRACK_UPLOAD_BYTES,
    sanitize_upload_filename,
    save_upload_file_bounded,
    validate_audio_header,
    validate_background_header,
)

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["uploads"])


@router.post("/api/upload-instrumental")
async def upload_instrumental(project_id: str = Form(...), file: UploadFile = File(...)):
    import backend.main as main_mod

    safe_proj_id = sanitize_upload_filename(project_id, default_stem="project")
    proj = get_project_or_404(safe_proj_id)

    raw_ext = Path(file.filename or "custom.wav").suffix.lower()
    if raw_ext not in ALLOWED_AUDIO_EXTS:
        logger.warning(f"Rejected instrumental upload with unsupported extension: {raw_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{raw_ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_AUDIO_EXTS))}",
        )

    stems_dir = getattr(main_mod, "STEMS_DIR", STEMS_DIR)
    max_bytes = getattr(main_mod, "MAX_INSTRUMENTAL_UPLOAD_BYTES", MAX_INSTRUMENTAL_UPLOAD_BYTES)
    target_path = stems_dir / safe_proj_id / f"custom_inst{raw_ext}"
    bytes_written = await save_upload_file_bounded(file, target_path, max_bytes, min_bytes=1)
    logger.info(f"Saved instrumental audio for project {safe_proj_id} ({bytes_written} bytes)")

    proj["instrumental_path"] = str(target_path)
    proj["instrumental_url"] = f"/static/stems/{safe_proj_id}/custom_inst{raw_ext}"
    save_projects()

    return {"status": "ok", "instrumental_url": proj["instrumental_url"]}


@router.post("/api/upload-background")
async def upload_background(file: UploadFile = File(...)):
    import backend.main as main_mod

    raw_ext = Path(file.filename or "bg.jpg").suffix.lower()
    if raw_ext not in ALLOWED_BACKGROUND_EXTS:
        logger.warning(f"Rejected background upload with unsupported extension: {raw_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image format '{raw_ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_BACKGROUND_EXTS))}",
        )

    safe_name = sanitize_upload_filename(file.filename, default_stem="bg.jpg")
    bg_id = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    bg_dir = getattr(main_mod, "BACKGROUNDS_DIR", BACKGROUNDS_DIR)
    target_path = bg_dir / bg_id

    max_bg_bytes = getattr(main_mod, "MAX_BACKGROUND_UPLOAD_BYTES", MAX_BACKGROUND_UPLOAD_BYTES)
    max_img_bytes = getattr(
        main_mod, "MAX_IMAGE_BACKGROUND_UPLOAD_BYTES", MAX_IMAGE_BACKGROUND_UPLOAD_BYTES
    )

    upload_limit = (
        max_bg_bytes if raw_ext in {".mp4", ".webm"} else min(max_bg_bytes, max_img_bytes)
    )

    # 1. Stream write to disk with byte ceiling (returns 413 for oversized, 400 for empty)
    bytes_written = await save_upload_file_bounded(file, target_path, upload_limit, min_bytes=1)

    # 2. Inspect header of written file for magic bytes
    with open(target_path, "rb") as f:
        header = f.read(64)

    if not validate_background_header(header, raw_ext):
        target_path.unlink(missing_ok=True)
        logger.warning(
            f"Rejected background upload with invalid magic bytes for extension {raw_ext}"
        )
        raise HTTPException(
            status_code=400,
            detail=f"File content does not match image format '{raw_ext}' (invalid magic bytes)",
        )

    logger.info(f"Saved background media {bg_id} ({bytes_written} bytes)")
    return {"status": "ok", "bg_id": bg_id, "bg_url": f"/static/backgrounds/{bg_id}"}


@router.post("/api/upload-track")
@router.post("/api/upload-audio")
async def upload_audio_track(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    artist: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    custom_lyrics: str | None = Form(default=None),
    bg_tasks: BackgroundTasks = BackgroundTasks(),
):
    import backend.main as main_mod

    raw_ext = Path(file.filename or "").suffix.lower()
    if raw_ext not in ALLOWED_AUDIO_EXTS:
        logger.warning(f"Rejected track upload with unsupported extension: {raw_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{raw_ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_AUDIO_EXTS))}",
        )

    project_id = f"local_{uuid.uuid4().hex[:8]}"
    clean_stem = Path(
        sanitize_upload_filename(file.filename, default_stem=f"Track {project_id}")
    ).stem
    track_title = (title or "").strip() or clean_stem
    track_artist = (artist or "").strip() or "Unknown Artist"
    creator = (created_by or "").strip() or "Friend"

    downloads_dir = getattr(main_mod, "DOWNLOADS_DIR", DOWNLOADS_DIR)
    max_track_bytes = getattr(main_mod, "MAX_TRACK_UPLOAD_BYTES", MAX_TRACK_UPLOAD_BYTES)
    target_upload_path = downloads_dir / f"{project_id}{raw_ext}"
    bytes_written = await save_upload_file_bounded(
        file, target_upload_path, max_track_bytes, min_bytes=1
    )

    with open(target_upload_path, "rb") as f:
        header_sample = f.read(64)

    if not validate_audio_header(header_sample, raw_ext):
        target_upload_path.unlink(missing_ok=True)
        logger.warning(f"Rejected track upload with invalid magic bytes for extension {raw_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"File content does not match audio format '{raw_ext}' (invalid magic bytes)",
        )

    logger.info(f"Accepted local audio track upload {project_id} ({bytes_written} bytes)")

    proj_data = {
        "id": project_id,
        "track_id": project_id,
        "title": track_title,
        "artist": track_artist,
        "status": "queued",
        "progress": 0,
        "lines": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "created_by": creator,
        "created_at": int(time.time()),
        "audio_url": f"/static/downloads/{project_id}.wav",
    }

    main_mod.active_cancellations.setdefault(project_id, threading.Event())
    main_mod.projects[project_id] = proj_data
    save_projects()

    bg_tasks.add_task(
        main_mod.run_local_pipeline,
        project_id,
        str(target_upload_path),
        track_title,
        track_artist,
        custom_lyrics,
    )
    return {"project_id": project_id, "status": "queued"}
