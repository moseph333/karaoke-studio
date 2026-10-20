"""FastAPI application entry point, mounting API routers, middleware, static media directories, and providing backward-compatible re-exports."""

import logging
import math
import subprocess
import threading
from pathlib import Path
from typing import Any

import soundfile as sf
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.responses import JSONResponse

from backend import config
from backend.auth import (
    LOGIN_RATE_LIMIT_LOCK,
    _last_rate_limit_cleanup,
    _login_failures,
    _prune_stale_rate_limits_locked,
    check_login_rate_limit,
    clear_all_login_failures,
    create_session_token,
    get_client_ip,
    is_authenticated,
    record_login_failure,
    reset_login_failures,
    verify_session_token,
)
from backend.config import (
    BACKGROUNDS_DIR,
    DATA_DIR,
    DOWNLOADS_DIR,
    OUTPUT_DIR,
    STEMS_DIR,
)
from backend.export_utils import (
    build_content_disposition,
    sanitize_export_filename,
)
from backend.pipeline import (
    run_local_pipeline,
    run_pipeline,
)
from backend.project_store import (
    PROJECTS_BACKUP_FILE,
    PROJECTS_LOCK,
    PROJECTS_STORE_FILE,
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    load_projects,
    projects,
    save_projects,
)
from backend.render_worker import run_video_render
from backend.routers.auth import router as auth_router
from backend.routers.exports import router as exports_router
from backend.routers.projects import (
    cancel_project,
    cancel_render,
    delete_project,
)
from backend.routers.projects import (
    router as projects_router,
)
from backend.routers.uploads import (
    router as uploads_router,
)
from backend.schemas import (
    KaraokeProject,
    KeyRecommendationRequest,
    KeyRecommendationResponse,
    LoginRequest,
    LyricLineSchema,
    LyricsUpdateRequest,
    MixRequest,
    ProcessRequest,
    ProjectMetadataUpdate,
    RenderRequest,
    SearchRequest,
    VocalRangeData,
    WordTimingSchema,
)
from backend.services.aligner import AudioAligner
from backend.services.audio_mixer import AudioMixer
from backend.services.downloader import TrackDownloader
from backend.services.lyrics import LyricsService
from backend.services.separator import AudioSeparator
from backend.services.video_renderer import VideoRenderer
from backend.services.vocal_analyzer import VocalRangeAnalyzer
from backend.services.youtube_uploader import YouTubeMetadataService
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
    validate_image_header,
)

logger = logging.getLogger("karaoke_backend")

active_cancellations: dict[str, threading.Event] = {}

# Bounded worker concurrency semaphore
WORKER_SEMAPHORE = threading.Semaphore(config.MAX_CONCURRENT_JOBS)

# Service singletons
downloader = TrackDownloader()
separator = AudioSeparator()
lyrics_service = LyricsService()
aligner = AudioAligner()
audio_mixer = AudioMixer()
video_renderer = VideoRenderer()
youtube_service = YouTubeMetadataService()
vocal_analyzer = VocalRangeAnalyzer()

app = FastAPI(title="Karaoke Studio API", version=config.APP_VERSION.lstrip("v"))


def sanitize_validation_errors(obj: Any) -> Any:
    if isinstance(obj, float):
        if not math.isfinite(obj):
            return str(obj)
        return obj
    elif isinstance(obj, dict):
        return {k: sanitize_validation_errors(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple, set)):
        return [sanitize_validation_errors(item) for item in obj]
    elif isinstance(obj, Exception):
        return str(obj)
    elif isinstance(obj, (str, int, bool)) or obj is None:
        return obj
    try:
        return jsonable_encoder(obj)
    except Exception:
        return str(obj)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    sanitized = sanitize_validation_errors(exc.errors())
    return JSONResponse(status_code=422, content={"detail": sanitized})


app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def check_auth_middleware(request: Request, call_next):
    path = request.url.path
    app_pwd = config.APP_PASSWORD
    if app_pwd:
        is_api_protected = (
            path.startswith("/api/")
            and not path.startswith("/api/health")
            and not path.startswith("/api/auth")
        )
        is_static_protected = path.startswith("/static/")
        if (is_api_protected or is_static_protected) and not is_authenticated(request, app_pwd):
            return JSONResponse(
                status_code=401, content={"detail": "Invalid or missing studio passphrase"}
            )
    return await call_next(request)


@app.middleware("http")
async def add_security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Mount static directories so frontend can stream audio and video
app.mount("/static/downloads", StaticFiles(directory=str(DOWNLOADS_DIR)), name="downloads")
app.mount("/static/stems", StaticFiles(directory=str(STEMS_DIR)), name="stems")
app.mount("/static/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/static/backgrounds", StaticFiles(directory=str(BACKGROUNDS_DIR)), name="backgrounds")


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "service": "Karaoke Studio",
        "version": config.get_app_version(),
    }


# Mount domain routers
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(exports_router)
app.include_router(uploads_router)

# Mount built frontend if available
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

__all__ = [
    "ALLOWED_AUDIO_EXTS",
    "ALLOWED_BACKGROUND_EXTS",
    "BACKGROUNDS_DIR",
    "DATA_DIR",
    "DOWNLOADS_DIR",
    "LOGIN_RATE_LIMIT_LOCK",
    "MAX_BACKGROUND_UPLOAD_BYTES",
    "MAX_IMAGE_BACKGROUND_UPLOAD_BYTES",
    "MAX_INSTRUMENTAL_UPLOAD_BYTES",
    "MAX_TRACK_UPLOAD_BYTES",
    "OUTPUT_DIR",
    "PROJECTS_BACKUP_FILE",
    "PROJECTS_LOCK",
    "PROJECTS_STORE_FILE",
    "STEMS_DIR",
    "WORKER_SEMAPHORE",
    "KaraokeProject",
    "KeyRecommendationRequest",
    "KeyRecommendationResponse",
    "LoginRequest",
    "LyricLineSchema",
    "LyricsUpdateRequest",
    "MixRequest",
    "ProcessRequest",
    "ProjectMetadataUpdate",
    "RenderRequest",
    "SearchRequest",
    "VocalRangeData",
    "WordTimingSchema",
    "_last_rate_limit_cleanup",
    "_login_failures",
    "_prune_stale_rate_limits_locked",
    "active_cancellations",
    "aligner",
    "app",
    "audio_mixer",
    "build_content_disposition",
    "cancel_project",
    "cancel_render",
    "check_login_rate_limit",
    "cleanup_project_disk_artifacts",
    "clear_all_login_failures",
    "create_session_token",
    "delete_project",
    "downloader",
    "find_project",
    "get_client_ip",
    "get_project_or_404",
    "is_authenticated",
    "load_projects",
    "lyrics_service",
    "projects",
    "record_login_failure",
    "reset_login_failures",
    "run_local_pipeline",
    "run_pipeline",
    "run_video_render",
    "sanitize_export_filename",
    "sanitize_upload_filename",
    "sanitize_validation_errors",
    "save_projects",
    "save_upload_file_bounded",
    "separator",
    "sf",
    "subprocess",
    "validate_audio_header",
    "validate_background_header",
    "validate_image_header",
    "verify_session_token",
    "video_renderer",
    "vocal_analyzer",
    "youtube_service",
]
