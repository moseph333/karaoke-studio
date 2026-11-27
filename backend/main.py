"""FastAPI application entry point, mounting API routers, middleware, static media directories, and providing backward-compatible re-exports."""

import json
import logging
import math
import mimetypes
import subprocess
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from backend import config, update_drain
from backend.auth import (
    LOGIN_RATE_LIMIT_LOCK,
    _last_rate_limit_cleanup,
    _login_failures,
    _prune_stale_rate_limits_locked,
    authenticated_within_limit,
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
from backend.http_delivery import CompressTextResponses
from backend.logging_setup import configure_logging
from backend.master_audio import remove_unfinished_mixes, start_pruning_mixes_of_every_song
from backend.middleware import (
    AllowedHosts,
    BodyLimit,
    PassphraseAuth,
    RequestContext,
    SecurityHeaders,
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
    update_project_chords,
)
from backend.render_worker import remove_render_leftovers, run_video_render
from backend.reseparation import remove_staged_stems
from backend.routers.admin import router as admin_router
from backend.routers.albums import router as albums_router
from backend.routers.api_docs import OPENAPI_URL, install_openapi
from backend.routers.api_docs import router as api_docs_router
from backend.routers.auth import router as auth_router
from backend.routers.exports import router as exports_router
from backend.routers.projects import (
    cancel_project,
    cancel_render,
    delete_project,
    settle_all_stale_jobs,
)
from backend.routers.projects import (
    router as projects_router,
)
from backend.routers.quality import router as quality_router
from backend.routers.search import router as search_router
from backend.routers.system import router as system_router
from backend.routers.uploads import (
    router as uploads_router,
)
from backend.schemas import (
    ChordSegmentSchema,
    ChordsUpdateRequest,
    KaraokeProject,
    KeyRecommendationRequest,
    KeyRecommendationResponse,
    LoginRequest,
    LyricLineSchema,
    LyricsUpdateRequest,
    MixRequest,
    ProcessRequest,
    ProjectChordsResponse,
    ProjectMetadataUpdate,
    RenderRequest,
    SearchRequest,
    VocalRangeData,
    WordTimingSchema,
)
from backend.services.aligner import AudioAligner
from backend.services.audio_mixer import AudioMixer
from backend.services.chord_detector import (
    ChordDetector,
    transpose_chord,
    transpose_chord_progression,
)
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

configure_logging()
logger = logging.getLogger("karaoke_backend")

# The AAC master preview (PREVIEW_AUDIO_FORMAT=aac): slim images have no system MIME table,
# and served as text/plain behind nosniff, browsers refuse to play it
mimetypes.add_type("audio/mp4", ".m4a")

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
chord_detector = ChordDetector()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """Before the server takes its first request: marks the intakes, renders and background
    jobs that the previous server process left running as interrupted, since nothing will
    finish them, and deletes what the jobs it cut off left half-made: videos and scratch mixes
    of renders, staged stems of re-separations, and the mixer's unfinished files. Then trims
    every song's cached mixes in a background thread."""
    try:
        settled = await run_in_threadpool(settle_all_stale_jobs)
        if settled:
            logger.warning(f"Marked jobs on {settled} song(s) as interrupted by a server restart")
    except Exception:
        # A store that cannot be settled must not keep the server from starting
        logger.exception("Could not settle the jobs left by the previous server process")
    # No job runs yet, so every *.part.mp4, *_final_audio[.tmp_*].wav, stems/.staging folder
    # and *.tmp_*.wav / *.tmp_*.m4a belongs to a job that will never finish. Looked up at call
    # time, so tests can replace each step
    sweeps = (
        (remove_render_leftovers, "file(s) of renders", "the unfinished videos"),
        (remove_staged_stems, "staged stem folder(s) of re-separations", "the staged stems"),
        (remove_unfinished_mixes, "unfinished mix file(s)", "the unfinished mixes"),
    )
    for sweep, removed_what, failed_what in sweeps:
        try:
            removed = await run_in_threadpool(sweep)
            if removed:
                logger.info(f"Removed {removed} {removed_what} the previous process cut off")
        except Exception:
            logger.exception(f"Could not remove {failed_what} left by the previous process")
    try:
        # Mixes past the per-song limit on songs no one has remixed since; on its own thread
        start_pruning_mixes_of_every_song()
    except Exception:
        logger.exception("Could not start pruning the cached mixes")
    try:
        # This process is the update a drain waited for: new jobs may start again
        if update_drain.clear_drain_file():
            logger.info("Removed the update drain marker; new jobs are accepted again")
        update_drain.start_jobs_heartbeat()
    except Exception:
        logger.exception("Could not start reporting the active job count")
    yield


# The API reference lives at /api/docs (routers/api_docs.py), behind the passphrase gate like
# the schema; FastAPI's default /docs and /redoc would sit outside it
app = FastAPI(
    title="Karaoke Studio API",
    version=config.APP_VERSION.lstrip("v"),
    lifespan=lifespan,
    openapi_url=OPENAPI_URL,
    docs_url=None,
    redoc_url=None,
)
install_openapi(app)


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


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """An error no route handled: logged with its traceback, the route and the request id,
    and answered with JSON the studio can show instead of Starlette's plain-text page. It
    runs outside every middleware, so it sets the request id and nosniff headers itself."""
    request_id = getattr(request.state, "request_id", None)
    logger.error(
        f"Unhandled error in {request.method} {request.url.path}"
        + (f" [req={request_id}]" if request_id else ""),
        exc_info=exc,
    )
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"}
    if request_id:
        headers["X-Request-ID"] = request_id
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error", "request_id": request_id},
        headers=headers,
    )


# Inside the security headers, so a 401 carries them too (Starlette runs the middleware
# added last first)
app.add_middleware(PassphraseAuth)
# Outside auth: a browser sends a CORS preflight (OPTIONS) without credentials, so behind
# auth every preflight got a 401 and no request from an allowed origin could follow; a 401
# also needs the CORS headers, or the page at that origin cannot read it to show the login
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# Outside auth, so a request for another host is refused before its credentials count
app.add_middleware(AllowedHosts)
# Outside auth, so an oversized body is refused before anything else looks at the request,
# and inside the security headers, so the 413 carries them
app.add_middleware(BodyLimit)
app.add_middleware(SecurityHeaders)


# Added after the others, so it wraps them and compresses their final responses
app.add_middleware(CompressTextResponses, minimum_size=1024)
# Outermost, so the auth middleware's log lines carry the request id too
app.add_middleware(RequestContext)


# Mount static directories so frontend can stream audio and video
app.mount("/static/downloads", StaticFiles(directory=str(DOWNLOADS_DIR)), name="downloads")
app.mount("/static/stems", StaticFiles(directory=str(STEMS_DIR)), name="stems")
app.mount("/static/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/static/backgrounds", StaticFiles(directory=str(BACKGROUNDS_DIR)), name="backgrounds")


@app.get("/api/health", tags=["system"], summary="Version, update and drain status")
async def health_check(request: Request, check_remote: bool = False):
    # A remote check runs git ls-remote against GitHub, so only a session can force one. The
    # rate-limited check runs on the event loop (checking and counting a guess is one step),
    # the git calls in a worker thread.
    force_remote = check_remote and authenticated_within_limit(request, config.APP_PASSWORD)
    info = await run_in_threadpool(config.check_for_updates, force_remote=force_remote)
    return {**info, **_drain_status()}


def _json_content_type(request: Request) -> bool:
    media_type = request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
    return media_type == "application/json" or media_type.endswith("+json")


def _sent_auth_header(request: Request) -> bool:
    """Whether the request carries a credential header, which a cross-site page cannot set
    without a CORS preflight (unlike a cookie)."""
    headers = request.headers
    return bool(
        headers.get("x-app-password")
        or headers.get("x-session-token")
        or headers.get("authorization")
    )


def _drain_status() -> dict:
    """Whether an update waits for running jobs, and how many there are, for the studio's
    banner."""
    return {
        "draining": update_drain.is_draining(),
        "active_jobs": update_drain.active_jobs()["count"],
    }


@app.post(
    "/api/health",
    tags=["system"],
    summary="Check for or start an update (legacy path)",
    operation_id="system_update_action_health",
)
@app.post(
    "/api/system/update",
    tags=["system"],
    summary="Check for or start an update",
    operation_id="system_update_action",
)
async def system_update_action(request: Request):
    action = "check"
    raw = await request.body()
    if raw:
        if not _json_content_type(request) and not _sent_auth_header(request):
            # A cross-site form or text/plain POST needs no CORS preflight, so without this a
            # web page could start an update with a visitor's cookie (or on an install with
            # no passphrase). Scripts that send X-App-Password may post any content type:
            # browsers cannot add that header across sites without a preflight.
            raise HTTPException(
                status_code=415, detail="Send the update request as application/json"
            )
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="The body is not valid JSON") from exc
        if isinstance(body, dict) and body.get("action"):
            action = str(body["action"]).strip().lower()
    # Both run git (ls-remote can take seconds): off the event loop
    if action == "update":
        client_ip = get_client_ip(request)
        logger.info(f"Update requested from {client_ip}")
        info = await run_in_threadpool(config.trigger_system_update)
        logger.info(
            f"Update trigger written for {client_ip}: "
            f"{info.get('version') or '?'} -> {info.get('latest_version') or '?'}"
        )
    else:
        info = await run_in_threadpool(config.check_for_updates, force_remote=True)
    return {**info, **_drain_status()}


# Mount domain routers
app.include_router(auth_router)
app.include_router(projects_router)
app.include_router(albums_router)
app.include_router(search_router)
app.include_router(exports_router)
app.include_router(uploads_router)
app.include_router(quality_router)
app.include_router(system_router)
app.include_router(admin_router)
app.include_router(api_docs_router)

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
    "ChordDetector",
    "ChordSegmentSchema",
    "ChordsUpdateRequest",
    "KaraokeProject",
    "KeyRecommendationRequest",
    "KeyRecommendationResponse",
    "LoginRequest",
    "LyricLineSchema",
    "LyricsUpdateRequest",
    "MixRequest",
    "ProcessRequest",
    "ProjectChordsResponse",
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
    "chord_detector",
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
    "transpose_chord",
    "transpose_chord_progression",
    "update_project_chords",
    "validate_audio_header",
    "validate_background_header",
    "validate_image_header",
    "verify_session_token",
    "video_renderer",
    "vocal_analyzer",
    "youtube_service",
]
