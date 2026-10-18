import hmac
import json
import logging
import math
import os
import re
import shutil
import subprocess
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote

import soundfile as sf
from fastapi import (
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
)
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.responses import JSONResponse

from backend import config
from backend.config import BACKGROUNDS_DIR, DATA_DIR, DOWNLOADS_DIR, OUTPUT_DIR, STEMS_DIR
from backend.services.aligner import AudioAligner
from backend.services.audio_mixer import AudioMixer
from backend.services.downloader import TrackDownloader
from backend.services.lyrics import LyricsService
from backend.services.separator import AudioSeparator
from backend.services.video_renderer import VISUAL_THEMES, VideoRenderer
from backend.services.youtube_uploader import YouTubeMetadataService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("karaoke_backend")

active_cancellations: dict[str, threading.Event] = {}

app = FastAPI(title="YouTube Karaoke Studio API", version="1.0.0")


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
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def is_authenticated(request: Request, app_pwd: str) -> bool:
    if not app_pwd:
        return True
    token = request.headers.get("X-App-Password")
    if token is not None:
        token = token.strip()
    if not token:
        auth_header = request.headers.get("Authorization") or ""
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
    if not token:
        token = request.cookies.get("karaoke_token")
        if token is not None:
            token = token.strip()
    if not token:
        return False
    try:
        return hmac.compare_digest(token.encode("utf-8"), app_pwd.encode("utf-8"))
    except Exception:
        return False


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

# Persistent store for project states
PROJECTS_STORE_FILE = DATA_DIR / "projects.json"
PROJECTS_BACKUP_FILE = DATA_DIR / "projects.json.bak"
PROJECTS_LOCK = threading.RLock()


def load_projects() -> dict[str, dict[str, Any]]:
    with PROJECTS_LOCK:
        # 1. Attempt primary load
        if PROJECTS_STORE_FILE.exists():
            try:
                content = PROJECTS_STORE_FILE.read_text(encoding="utf-8").strip()
                if content:
                    return json.loads(content)
            except Exception as e:
                logger.error(
                    f"Corrupted projects.json detected: {e}. Attempting backup recovery..."
                )

        # 2. Attempt fallback to backup if primary failed or does not exist
        if PROJECTS_BACKUP_FILE.exists():
            try:
                content = PROJECTS_BACKUP_FILE.read_text(encoding="utf-8").strip()
                if content:
                    logger.info("Successfully recovered projects state from projects.json.bak")
                    return json.loads(content)
            except Exception as e:
                logger.error(f"Could not load backup projects.json.bak: {e}")

        return {}


def save_projects():
    with PROJECTS_LOCK:
        try:
            # Deduplicate aliased keys
            unique_projects: dict[str, Any] = {}
            for k, v in projects.items():
                pid = v.get("id", k)
                if pid not in unique_projects:
                    unique_projects[pid] = v
            serialized = json.dumps(unique_projects, indent=2)

            DATA_DIR.mkdir(parents=True, exist_ok=True)
            # Write to a temporary file in the same directory (guarantees same filesystem for atomic rename)
            temp_file = DATA_DIR / f".projects.json.tmp.{uuid.uuid4().hex}"
            with open(temp_file, "w", encoding="utf-8") as f:
                f.write(serialized)
                f.flush()
                os.fsync(f.fileno())

            # If current store file exists and has size, back it up before replacement
            if PROJECTS_STORE_FILE.exists() and PROJECTS_STORE_FILE.stat().st_size > 0:
                try:
                    PROJECTS_BACKUP_FILE.write_bytes(PROJECTS_STORE_FILE.read_bytes())
                except Exception as bak_err:
                    logger.warning(f"Could not update projects backup: {bak_err}")

            # Atomic swap
            os.replace(temp_file, PROJECTS_STORE_FILE)
        except Exception as e:
            logger.error(f"Failed to persist projects.json atomically: {e}")
            if "temp_file" in locals() and temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception:
                    pass


projects: dict[str, dict[str, Any]] = load_projects()


def find_project(project_id: str) -> dict[str, Any] | None:
    with PROJECTS_LOCK:
        if project_id in projects:
            return projects[project_id]
        disk_projects = load_projects()
        projects.update(disk_projects)
        if project_id in projects:
            return projects[project_id]
        for p in projects.values():
            if p.get("id") == project_id or p.get("track_id") == project_id:
                return p
        return None


def get_project_or_404(project_id: str) -> dict[str, Any]:
    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj


def cleanup_project_disk_artifacts(
    project_id: str,
    track_id: str | None = None,
    proj: dict[str, Any] | None = None,
) -> None:
    """Safely removes all media files associated with project_id (and unshared track_id)

    from DOWNLOADS_DIR, STEMS_DIR, and OUTPUT_DIR without affecting other projects.
    """
    pid = project_id
    tid = track_id
    if proj:
        pid = proj.get("id", project_id)
        if not tid:
            tid = proj.get("track_id")

    with PROJECTS_LOCK:
        other_projects = [
            p for p in projects.values() if isinstance(p, dict) and p.get("id") != pid
        ]

    other_referenced_paths: set[Path] = set()
    other_ids: set[str] = set()

    for op in other_projects:
        for key in (
            "audio_path",
            "thumbnail_path",
            "vocals_path",
            "instrumental_path",
            "master_audio_path",
            "video_path",
        ):
            val = op.get(key)
            if val:
                try:
                    other_referenced_paths.add(Path(val).resolve())
                except Exception:
                    pass
        if op.get("id"):
            other_ids.add(str(op["id"]))
        if op.get("track_id"):
            other_ids.add(str(op["track_id"]))

    # 1. Cleanup STEMS_DIR: STEMS_DIR / pid (and STEMS_DIR / tid if not referenced by others)
    stem_targets = [pid]
    if tid and tid not in other_ids and tid not in stem_targets:
        stem_targets.append(tid)

    if STEMS_DIR.exists():
        for ident in stem_targets:
            stem_subdir = STEMS_DIR / ident
            if stem_subdir.exists() and stem_subdir.is_dir():
                has_external_ref = False
                for f in stem_subdir.rglob("*"):
                    if f.is_file():
                        try:
                            if f.resolve() in other_referenced_paths:
                                has_external_ref = True
                                break
                        except Exception:
                            pass
                if not has_external_ref:
                    shutil.rmtree(stem_subdir, ignore_errors=True)

    # 2. Cleanup flat directories: DOWNLOADS_DIR and OUTPUT_DIR
    target_prefixes = [f"{pid}.", f"{pid}_"]
    exact_names = {pid}
    if tid and tid not in other_ids:
        target_prefixes.extend([f"{tid}.", f"{tid}_"])
        exact_names.add(tid)

    for directory in (DOWNLOADS_DIR, OUTPUT_DIR):
        if not directory.exists():
            continue
        for item in directory.iterdir():
            try:
                name = item.name
                matches = (name in exact_names) or any(
                    name.startswith(pfx) for pfx in target_prefixes
                )
                if matches:
                    resolved = item.resolve()
                    if resolved not in other_referenced_paths:
                        if item.is_file() or item.is_symlink():
                            item.unlink(missing_ok=True)
                        elif item.is_dir():
                            shutil.rmtree(item, ignore_errors=True)
            except Exception as e:
                logger.warning(f"Error checking/removing disk item {item}: {e}")

    # 3. Explicitly clean files recorded directly in proj metadata if passed
    if proj:
        for key in (
            "audio_path",
            "thumbnail_path",
            "vocals_path",
            "instrumental_path",
            "master_audio_path",
            "video_path",
        ):
            val = proj.get(key)
            if val:
                try:
                    p = Path(val).resolve()
                    if p.exists() and p not in other_referenced_paths:
                        if p.is_file() or p.is_symlink():
                            p.unlink(missing_ok=True)
                        elif p.is_dir():
                            shutil.rmtree(p, ignore_errors=True)
                except Exception as e:
                    logger.warning(f"Error removing metadata-referenced file {val}: {e}")


# Services
downloader = TrackDownloader()
separator = AudioSeparator()
lyrics_service = LyricsService()
aligner = AudioAligner()
audio_mixer = AudioMixer()
video_renderer = VideoRenderer()
youtube_service = YouTubeMetadataService()


# --- Request / Response Models ---
class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    password: str = Field(..., description="Studio password")
    username: str | None = Field(default="Friend", max_length=64)


class SearchRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    query: str = Field(..., max_length=300, description="Search query")
    limit: int | None = Field(default=5, ge=1, le=50, description="Max results to return")


class ProcessRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    url_or_id: str = Field(
        ...,
        description="YouTube video URL or 11-character video ID",
    )
    custom_lyrics: str | None = Field(
        default=None,
        max_length=50000,
        description="Optional custom plain or LRC lyrics text",
    )
    created_by: str | None = Field(
        default=None,
        max_length=64,
        description="Optional creator username or nickname",
    )

    @field_validator("url_or_id")
    @classmethod
    def validate_youtube_url_or_id(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("URL or video ID cannot be empty or whitespace")
        clean = v.strip()

        # Check for URL with non-YouTube domain
        if clean.startswith(("http://", "https://")) or "/" in clean or "." in clean:
            vid = TrackDownloader.extract_video_id(clean)
            if not vid:
                raise ValueError(
                    "Invalid YouTube URL or unsupported media domain. "
                    "Only valid YouTube URLs (e.g. youtube.com/watch?v=..., youtu.be/...) are supported."
                )
            return clean

        # Bare ID: check for valid YouTube video ID (Option B: 11-32 chars to accommodate synthetic test IDs like pair_lyr_pitch1)
        if not re.fullmatch(r"^[0-9A-Za-z_-]{11,32}$", clean):
            raise ValueError(
                f"Invalid YouTube video ID '{clean}'. Must be a valid identifier (11-32 characters)."
            )
        return clean


class WordTimingSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")
    word: str = Field(..., description="Word text")
    start_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Word start time in seconds (non-negative)",
    )
    end_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Word end time in seconds (non-negative)",
    )

    @model_validator(mode="after")
    def validate_word_timestamps(self) -> "WordTimingSchema":
        if not math.isfinite(self.start_time) or not math.isfinite(self.end_time):
            raise ValueError(f"Word '{self.word}' timestamps must be finite numbers")
        if self.end_time < self.start_time:
            raise ValueError(
                f"Word '{self.word}' end_time ({self.end_time}s) cannot be earlier than start_time ({self.start_time}s)"
            )
        return self


class LyricLineSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: int | None = Field(default=None, description="Optional line ID")
    text: str = Field(default="", description="Line text")
    start_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Line start time in seconds (non-negative)",
    )
    end_time: float = Field(
        ...,
        ge=0.0,
        le=86400.0,
        allow_inf_nan=False,
        description="Line end time in seconds (non-negative)",
    )
    words: list[WordTimingSchema] = Field(
        default_factory=list,
        description="Word-level timing tokens",
    )

    @model_validator(mode="after")
    def validate_line_and_words(self) -> "LyricLineSchema":
        if not math.isfinite(self.start_time) or not math.isfinite(self.end_time):
            raise ValueError("Line timestamps must be finite numbers")
        if self.end_time < self.start_time:
            raise ValueError(
                f"Line end_time ({self.end_time}s) cannot be earlier than start_time ({self.start_time}s)"
            )
        # Enforce non-decreasing monotonic word timestamps
        for i in range(1, len(self.words)):
            if self.words[i].start_time < self.words[i - 1].start_time:
                raise ValueError(
                    f"Non-monotonic word timing: word '{self.words[i].word}' start_time ({self.words[i].start_time}s) "
                    f"is earlier than preceding word '{self.words[i - 1].word}' start_time ({self.words[i - 1].start_time}s)"
                )
        return self


class LyricsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    lines: list[LyricLineSchema] = Field(..., description="List of lyric line timing models")


class MixRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    semitones: int = Field(
        default=0,
        ge=-12,
        le=12,
        description="Pitch shift in semitones (-12 to +12)",
    )
    guide_volume: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        allow_inf_nan=False,
        description="Guide vocal blend level (0.0 to 1.0)",
    )


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")
    semitones: int = Field(
        default=0,
        ge=-12,
        le=12,
        description="Pitch shift in semitones (-12 to +12)",
    )
    guide_volume: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        allow_inf_nan=False,
        description="Guide vocal blend level (0.0 to 1.0)",
    )
    aspect_ratio: Literal["16:9", "9:16"] = Field(
        default="16:9",
        description="Canvas aspect ratio: strictly '16:9' or '9:16'",
    )
    style_config: dict[str, Any] | None = Field(
        default=None,
        description="Visual theme styling options",
    )
    custom_bg_id: str | None = Field(
        default=None,
        description="Optional custom background image ID",
    )


class ProjectMetadataUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str | None = Field(
        default=None,
        max_length=300,
        description="Optional updated track title (max 300 chars)",
    )
    artist: str | None = Field(
        default=None,
        max_length=300,
        description="Optional updated artist name (max 300 chars)",
    )


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "YouTube Karaoke Studio"}


@app.get("/api/auth/status")
def auth_status(request: Request):
    app_pwd = config.APP_PASSWORD
    if not app_pwd:
        return {"auth_required": False, "authenticated": True}
    return {"auth_required": True, "authenticated": is_authenticated(request, app_pwd)}


@app.post("/api/auth/login")
def auth_login(req: LoginRequest, request: Request):
    if config.APP_PASSWORD:
        pwd = (req.password or "").strip()
        if not pwd:
            raise HTTPException(status_code=401, detail="Incorrect studio passphrase")
        try:
            is_valid = hmac.compare_digest(pwd.encode("utf-8"), config.APP_PASSWORD.encode("utf-8"))
        except Exception:
            is_valid = False
        if not is_valid:
            logger.warning(f"Failed login attempt for user: {req.username}")
            raise HTTPException(status_code=401, detail="Incorrect studio passphrase")

    token = req.password if config.APP_PASSWORD else "ok"
    response = JSONResponse(
        content={
            "status": "ok",
            "token": token,
            "username": req.username or "Friend",
        }
    )
    if config.APP_PASSWORD:
        is_https = (
            request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        )
        try:
            response.set_cookie(
                key="karaoke_token",
                value=token,
                httponly=True,
                samesite="lax",
                secure=is_https,
                max_age=60 * 60 * 24 * 30,  # 30 days
            )
        except Exception:
            pass
    return response


@app.post("/api/auth/logout")
def auth_logout():
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie(key="karaoke_token")
    return response


@app.post("/api/search")
def search_tracks(req: SearchRequest):
    try:
        results = downloader.search_tracks(req.query, limit=req.limit or 5)
        return {"results": results}
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e)) from e


def run_pipeline(project_id: str, url_or_id: str, custom_lyrics: str | None = None):
    cancel_event = threading.Event()
    active_cancellations[project_id] = cancel_event
    pipeline_start = time.time()
    track_id: str | None = None

    def update_pipe(status: str, progress: int, detail: str, eta_s: int | None = None):
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")
        proj = find_project(project_id)
        if not proj:
            return
        proj["status"] = status
        proj["progress"] = progress
        proj["status_detail"] = detail
        proj["heartbeat"] = int(time.time() * 1000)
        proj["elapsed_seconds"] = int(time.time() - pipeline_start)
        if eta_s is not None:
            proj["eta_seconds"] = eta_s
        save_projects()

    try:
        # Step 1: Download Audio and Metadata
        update_pipe("downloading", 10, "Fetching audio track and metadata...", 15)

        last_dl_tick = 0.0

        def dl_hook(d):
            nonlocal last_dl_tick
            if cancel_event.is_set():
                raise RuntimeError("Processing cancelled by user")
            now = time.time()
            if d.get("status") == "downloading" and now - last_dl_tick >= 0.25:
                last_dl_tick = now
                total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
                downloaded = d.get("downloaded_bytes", 0)
                pct = (downloaded / total * 100.0) if total > 0 else 0.0
                speed = d.get("speed")
                speed_str = f" • {speed / (1024 * 1024):.1f} MB/s" if speed else ""
                eta = d.get("eta")
                pipe_progress = int(10 + (pct * 0.25))
                update_pipe(
                    "downloading",
                    pipe_progress,
                    f"Downloading audio ({pct:.0f}%{speed_str})",
                    eta_s=eta,
                )

        meta = downloader.extract_info_and_download(url_or_id, progress_hook=dl_hook)
        track_id = meta.get("id")
        proj = get_project_or_404(project_id)
        proj.update(meta)
        proj["id"] = project_id  # Guarantee project ID remains consistent
        if track_id:
            proj["track_id"] = track_id
            projects[track_id] = proj  # Alias so lookups by track_id also resolve

        # Relative static URLs
        audio_id = track_id or project_id
        proj["audio_url"] = f"/static/downloads/{audio_id}.wav"
        if meta.get("thumbnail_path"):
            thumb_name = Path(meta["thumbnail_path"]).name
            proj["thumbnail_url"] = f"/static/downloads/{thumb_name}"
        save_projects()

        # Step 2: Separate Stems (Vocals & Instrumental)
        duration = float(meta.get("duration") or 180)
        initial_sep_eta = max(15, int(duration * 0.25))
        update_pipe("separating", 35, "Initializing Demucs AI stem separation...", initial_sep_eta)

        def sep_cb(pct, detail, eta_s):
            pipe_progress = int(35 + ((pct or 0.0) * 0.35))
            update_pipe("separating", pipe_progress, detail, eta_s=eta_s)

        stems = separator.separate_stems(
            audio_path=meta["audio_path"],
            track_id=audio_id,
            duration=duration,
            progress_callback=sep_cb,
            cancel_event=cancel_event,
        )
        proj = get_project_or_404(project_id)
        proj["vocals_path"] = stems["vocals_path"]
        proj["instrumental_path"] = stems["instrumental_path"]
        proj["vocals_url"] = f"/static/stems/{audio_id}/vocals.wav"
        proj["instrumental_url"] = f"/static/stems/{audio_id}/instrumental.wav"
        save_projects()

        # Step 3: Fetch Lyrics
        update_pipe("fetching_lyrics", 72, "Retrieving lyrics from LRCLIB...", 5)
        if custom_lyrics and custom_lyrics.strip():
            lyric_data = lyrics_service.process_custom_lyrics(custom_lyrics)
        else:
            lyric_data = lyrics_service.fetch_lyrics(
                meta["title"], meta["artist"], meta.get("duration")
            )

        proj = get_project_or_404(project_id)
        proj["lyric_source"] = lyric_data["source"]
        proj["is_synced"] = lyric_data["synced"]
        save_projects()

        # Step 4: Forced Word-Level Alignment
        update_pipe("aligning", 82, "Aligning lyrics to vocal acoustic energy envelopes...", 5)
        aligned_lines = aligner.align_lyrics(stems["vocals_path"], lyric_data["lines"])
        proj = get_project_or_404(project_id)
        proj["lines"] = aligned_lines
        save_projects()

        # Step 5: Mix Initial Master
        update_pipe("mixing", 92, "Mixing initial master playback...", 3)
        master_path = audio_mixer.mix_and_shift(
            instrumental_path=stems["instrumental_path"],
            vocals_path=stems["vocals_path"],
            semitones=0,
            guide_volume=0.0,
            output_filename=f"{audio_id}_master.wav",
        )
        proj = get_project_or_404(project_id)
        proj["master_audio_path"] = master_path
        proj["master_audio_url"] = f"/static/output/{audio_id}_master.wav"

        # Step 6: Ready!
        update_pipe("ready", 100, "Studio is ready! Sing and customize your track.", 0)

    except Exception as e:
        logger.error(f"Pipeline error for {project_id}: {e}", exc_info=True)
        proj = find_project(project_id)
        if proj is not None:
            if cancel_event.is_set():
                proj["status"] = "cancelled"
                proj["status_detail"] = "Processing was cancelled by user"
                proj["progress"] = 0
            else:
                proj["status"] = "error"
                proj["error"] = str(e)
                proj["status_detail"] = f"Error: {e}"
            save_projects()
        else:
            logger.info(
                f"Project {project_id} was deleted during processing; skipping status update."
            )
    finally:
        active_cancellations.pop(project_id, None)
        if track_id:
            active_cancellations.pop(track_id, None)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id, track_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )


def run_local_pipeline(
    project_id: str,
    raw_audio_path: str,
    title: str,
    artist: str,
    custom_lyrics: str | None = None,
):
    cancel_event = threading.Event()
    active_cancellations[project_id] = cancel_event
    pipeline_start = time.time()

    def update_pipe(status: str, progress: int, detail: str, eta_s: int | None = None):
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")
        proj = find_project(project_id)
        if not proj:
            return
        proj["status"] = status
        proj["progress"] = progress
        proj["status_detail"] = detail
        proj["heartbeat"] = int(time.time() * 1000)
        proj["elapsed_seconds"] = int(time.time() - pipeline_start)
        if eta_s is not None:
            proj["eta_seconds"] = eta_s
        save_projects()

    try:
        # Step 1: Transcode / Normalize raw uploaded audio to standard WAV (pcm_s16le, 44100Hz, 2ch)
        update_pipe("queued", 5, "Preparing audio track...")
        raw_path = Path(raw_audio_path)
        wav_target = DOWNLOADS_DIR / f"{project_id}.wav"

        needs_transcode = True
        if raw_path.resolve() == wav_target.resolve() and wav_target.exists():
            try:
                info = sf.info(str(wav_target))
                if info.format == "WAV":
                    needs_transcode = False
                    duration = float(info.duration)
            except Exception:
                needs_transcode = True

        if needs_transcode:
            temp_wav = DOWNLOADS_DIR / f"{project_id}_norm.wav"
            cmd = [
                "ffmpeg",
                "-y",
                "-i",
                str(raw_path),
                "-vn",
                "-acodec",
                "pcm_s16le",
                "-ar",
                "44100",
                "-ac",
                "2",
                str(temp_wav),
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if res.returncode != 0:
                raise RuntimeError(f"FFmpeg audio transcoding failed: {res.stderr}")
            temp_wav.replace(wav_target)
            if raw_path.resolve() != wav_target.resolve() and raw_path.exists():
                raw_path.unlink(missing_ok=True)
            try:
                info = sf.info(str(wav_target))
                duration = float(info.duration)
            except Exception:
                duration = 180.0
        else:
            try:
                info = sf.info(str(wav_target))
                duration = float(info.duration)
            except Exception:
                duration = 180.0

        proj = get_project_or_404(project_id)
        proj["duration"] = duration
        proj["audio_path"] = str(wav_target)
        proj["audio_url"] = f"/static/downloads/{project_id}.wav"
        save_projects()

        # Step 2: Separate Stems (Vocals & Instrumental)
        initial_sep_eta = max(15, int(duration * 0.25))
        update_pipe("separating", 35, "Initializing Demucs AI stem separation...", initial_sep_eta)

        def sep_cb(pct, detail, eta_s):
            pipe_progress = int(35 + ((pct or 0.0) * 0.35))
            update_pipe("separating", pipe_progress, detail, eta_s=eta_s)

        stems = separator.separate_stems(
            audio_path=str(wav_target),
            track_id=project_id,
            duration=duration,
            progress_callback=sep_cb,
            cancel_event=cancel_event,
        )
        proj = get_project_or_404(project_id)
        proj["vocals_path"] = stems["vocals_path"]
        proj["instrumental_path"] = stems["instrumental_path"]
        proj["vocals_url"] = f"/static/stems/{project_id}/vocals.wav"
        proj["instrumental_url"] = f"/static/stems/{project_id}/instrumental.wav"
        save_projects()

        # Step 3: Fetch / Process Lyrics
        update_pipe("fetching_lyrics", 72, "Processing song lyrics...", 5)
        if custom_lyrics and custom_lyrics.strip():
            lyric_data = lyrics_service.process_custom_lyrics(custom_lyrics)
        else:
            lyric_data = lyrics_service.fetch_lyrics(title, artist, duration)

        proj = get_project_or_404(project_id)
        proj["lyric_source"] = lyric_data["source"]
        proj["is_synced"] = lyric_data["synced"]
        save_projects()

        # Step 4: Forced Word-Level Alignment
        update_pipe("aligning", 82, "Aligning lyrics to vocal acoustic energy envelopes...", 5)
        aligned_lines = aligner.align_lyrics(stems["vocals_path"], lyric_data["lines"])
        proj = get_project_or_404(project_id)
        proj["lines"] = aligned_lines
        save_projects()

        # Step 5: Mix Initial Master
        update_pipe("mixing", 92, "Mixing initial master playback...", 3)
        master_path = audio_mixer.mix_and_shift(
            instrumental_path=stems["instrumental_path"],
            vocals_path=stems["vocals_path"],
            semitones=0,
            guide_volume=0.0,
            output_filename=f"{project_id}_master.wav",
        )
        proj = get_project_or_404(project_id)
        proj["master_audio_path"] = master_path
        proj["master_audio_url"] = f"/static/output/{project_id}_master.wav"

        # Step 6: Ready!
        update_pipe("ready", 100, "Studio is ready! Sing and customize your track.", 0)

    except Exception as e:
        logger.error(f"Pipeline error for local track {project_id}: {e}", exc_info=True)
        proj = find_project(project_id)
        if proj is not None:
            if cancel_event.is_set():
                proj["status"] = "cancelled"
                proj["status_detail"] = "Processing was cancelled by user"
                proj["progress"] = 0
            else:
                proj["status"] = "error"
                proj["error"] = str(e)
                proj["status_detail"] = f"Error: {e}"
            save_projects()
        else:
            logger.info(
                f"Project {project_id} was deleted during processing; skipping status update."
            )
    finally:
        active_cancellations.pop(project_id, None)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )


@app.post("/api/process")
def process_track(req: ProcessRequest, bg_tasks: BackgroundTasks):
    disk_projects = load_projects()
    projects.update(disk_projects)

    video_id = downloader.extract_video_id(req.url_or_id)
    if video_id:
        for p_id, p in list(projects.items()):
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
                    is_active = (p_id in active_cancellations) or (video_id in active_cancellations)
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
    projects[project_id] = proj_data
    save_projects()
    bg_tasks.add_task(run_pipeline, project_id, req.url_or_id, req.custom_lyrics)
    return {"project_id": project_id, "status": "queued"}


@app.get("/api/projects")
def list_projects(scope: str | None = "all", user: str | None = None):
    disk_projects = load_projects()
    projects.update(disk_projects)

    if scope == "my" and user:
        return {pid: p for pid, p in projects.items() if p.get("created_by") == user}
    return projects


@app.get("/api/project/{project_id}")
def get_project(project_id: str):
    return get_project_or_404(project_id)


@app.patch("/api/project/{project_id}")
@app.post("/api/project/{project_id}/metadata")
def update_project_metadata(project_id: str, req: ProjectMetadataUpdate):
    """Updates a project's title and/or artist metadata.

    Persists changes atomically to projects.json under PROJECTS_LOCK and
    refreshes the embedded YouTube metadata package if present.
    """
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
            proj["youtube_package"] = youtube_service.generate_youtube_package(
                title=proj.get("title", "Karaoke Track"),
                artist=proj.get("artist", "Artist"),
                lines=proj.get("lines", []),
                semitones=proj.get("semitones", 0),
                has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
            )

        save_projects()

    return proj


@app.post("/api/project/{project_id}/lyrics")
def update_lyrics(project_id: str, req: LyricsUpdateRequest):
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
            proj["youtube_package"] = youtube_service.generate_youtube_package(
                title=proj.get("title", "Karaoke Track"),
                artist=proj.get("artist", "Artist"),
                lines=proj.get("lines", []),
                semitones=proj.get("semitones", 0),
                has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
            )

        save_projects()
    return {"status": "ok", "lines_count": len(req.lines)}


@app.post("/api/project/{project_id}/mix")
def mix_audio(project_id: str, req: MixRequest):
    proj = get_project_or_404(project_id)
    inst_path = proj.get("instrumental_path")
    if not inst_path or not os.path.isfile(inst_path) or os.path.getsize(inst_path) == 0:
        logger.warning(
            f"Pre-flight mix rejected for project {project_id}: instrumental stem missing or empty ({inst_path})"
        )
        raise HTTPException(status_code=400, detail="Instrumental stem not ready yet")

    track_id = proj.get("track_id") or proj.get("id") or "track"
    output_filename = f"{track_id}_mix_{req.semitones}_{int(req.guide_volume * 100)}.wav"

    master_path = audio_mixer.mix_and_shift(
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


def run_video_render(project_id: str, req: RenderRequest):
    cancel_event = threading.Event()
    render_key = f"{project_id}_render"
    active_cancellations[render_key] = cancel_event
    render_start = time.time()

    def update_render(progress: int, detail: str, eta_s: int | None = None):
        if cancel_event.is_set():
            raise RuntimeError("Video rendering was cancelled by user")
        proj = find_project(project_id)
        if not proj:
            return
        proj["render_status"] = "rendering"
        proj["render_progress"] = progress
        proj["render_detail"] = detail
        proj["render_heartbeat"] = int(time.time() * 1000)
        proj["render_elapsed_seconds"] = int(time.time() - render_start)
        if eta_s is not None:
            proj["render_eta_seconds"] = eta_s
        save_projects()

    try:
        update_render(5, "Generating progressive karaoke subtitles...", 45)
        proj = get_project_or_404(project_id)

        track_id = proj.get("track_id") or proj.get("id") or "track"
        ass_path = OUTPUT_DIR / f"{track_id}.ass"
        mp4_path = OUTPUT_DIR / f"{track_id}_karaoke.mp4"

        # 1. Generate ASS Subtitles
        video_renderer.generate_ass_subtitles(
            lines=proj.get("lines", []),
            output_ass_path=ass_path,
            style_config=req.style_config,
            aspect_ratio=req.aspect_ratio,
        )

        update_render(15, "Mixing master audio with pitch adjustment...", 40)

        # 2. Mix audio with current pitch & guide vocal settings
        mixed_audio = audio_mixer.mix_and_shift(
            instrumental_path=proj["instrumental_path"],
            vocals_path=proj.get("vocals_path"),
            semitones=req.semitones,
            guide_volume=req.guide_volume,
            output_filename=f"{track_id}_final_audio.wav",
        )

        update_render(22, "Initializing FFmpeg 1080p60 encoding engine...", 35)

        # 3. Custom background if specified (harden against path traversal)
        custom_bg_file = None
        if req.custom_bg_id:
            safe_bg_id = Path(req.custom_bg_id).name
            bg_candidate = (BACKGROUNDS_DIR / safe_bg_id).resolve()
            if bg_candidate.is_relative_to(BACKGROUNDS_DIR.resolve()) and bg_candidate.is_file():
                custom_bg_file = str(bg_candidate)

        def ffmpeg_cb(pct, detail, eta_s):
            render_pct = int(22 + ((pct or 0.0) * 0.75))
            update_render(render_pct, detail, eta_s=eta_s)

        # 4. Render Video
        video_renderer.render_video(
            audio_path=mixed_audio,
            ass_subtitles_path=str(ass_path),
            output_mp4_path=mp4_path,
            thumbnail_path=proj.get("thumbnail_path"),
            custom_bg_path=custom_bg_file,
            title=proj.get("title", "Karaoke Track"),
            artist=proj.get("artist", "Artist"),
            aspect_ratio=req.aspect_ratio,
            duration=proj.get("duration"),
            progress_callback=ffmpeg_cb,
            cancel_event=cancel_event,
        )

        proj = get_project_or_404(project_id)
        proj["render_status"] = "completed"
        proj["render_progress"] = 100
        proj["render_detail"] = "Video export complete!"
        proj["render_eta_seconds"] = 0
        proj["video_url"] = f"/static/output/{track_id}_karaoke.mp4"

        # Generate YouTube package
        yt_package = youtube_service.generate_youtube_package(
            title=proj.get("title", "Karaoke Track"),
            artist=proj.get("artist", "Artist"),
            lines=proj.get("lines", []),
            semitones=req.semitones,
            has_guide_vocal=req.guide_volume > 0.05,
        )
        proj["youtube_package"] = yt_package
        save_projects()

    except Exception as e:
        logger.error(f"Render failed for {project_id}: {e}", exc_info=True)
        proj = find_project(project_id)
        if proj is not None:
            if cancel_event.is_set():
                proj["render_status"] = "idle"
                proj["render_detail"] = "Rendering cancelled"
                proj["render_progress"] = 0
            else:
                proj["render_status"] = "error"
                proj["render_error"] = str(e)
                proj["render_detail"] = f"Render error: {e}"
            save_projects()
        else:
            logger.info(
                f"Project {project_id} was deleted during rendering; skipping status update."
            )
    finally:
        active_cancellations.pop(render_key, None)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )


@app.post("/api/project/{project_id}/render")
def render_video(project_id: str, req: RenderRequest, bg_tasks: BackgroundTasks):
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
    bg_tasks.add_task(run_video_render, project_id, req)
    return {"status": "queued"}


@app.post("/api/project/{project_id}/cancel")
def cancel_project(project_id: str):
    if project_id in active_cancellations:
        active_cancellations[project_id].set()
    proj = find_project(project_id)
    if proj:
        proj["status"] = "cancelled"
        proj["status_detail"] = "Processing cancelled by user"
        proj["progress"] = 0
        save_projects()
    return {"status": "ok"}


@app.post("/api/project/{project_id}/cancel-render")
def cancel_render(project_id: str):
    render_key = f"{project_id}_render"
    if render_key in active_cancellations:
        active_cancellations[render_key].set()
    proj = find_project(project_id)
    if proj:
        proj["render_status"] = "idle"
        proj["render_detail"] = "Rendering cancelled by user"
        proj["render_progress"] = 0
        save_projects()
    return {"status": "ok"}


@app.delete("/api/project/{project_id}")
def delete_project(project_id: str):
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
        event = active_cancellations.get(key)
        if event is not None:
            event.set()

    # 2. Atomic state removal from projects and disk store under PROJECTS_LOCK
    with PROJECTS_LOCK:
        keys_to_remove = {
            k
            for k, v in projects.items()
            if k == pid
            or (isinstance(v, dict) and v.get("id") == pid)
            or (tid and k == tid and isinstance(v, dict) and v.get("id") == pid)
        }
        for k in keys_to_remove:
            projects.pop(k, None)

        save_projects()

    # 3. Clean up on-disk media artifacts
    cleanup_project_disk_artifacts(pid, tid, proj)

    return {
        "status": "deleted",
        "project_id": pid,
        "message": f"Project {project_id} deleted successfully",
    }


@app.get("/api/project/{project_id}/youtube-package")
def get_youtube_package(project_id: str):
    proj = get_project_or_404(project_id)
    return youtube_service.generate_youtube_package(
        title=proj.get("title", "Karaoke Track"),
        artist=proj.get("artist", "Artist"),
        lines=proj.get("lines", []),
        semitones=proj.get("semitones", 0),
        has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05,
    )


def sanitize_export_filename(
    title: str = "",
    artist: str = "",
    fallback: str = "karaoke",
    ascii_only: bool = False,
) -> str:
    """Sanitize track title and artist into a safe filename stem for downloads.

    If ascii_only is True, transliterates Latin diacritics to ASCII base characters
    and strips non-ASCII code points (falling back to an ASCII-sanitized fallback
    or 'karaoke' if no ASCII characters remain).
    If ascii_only is False, preserves UTF-8 Unicode characters while stripping
    filesystem-unsafe and header-control characters.
    """
    if artist and title:
        raw = f"{artist} - {title}".strip()
    elif title:
        raw = title.strip()
    elif artist:
        raw = artist.strip()
    else:
        raw = fallback.strip()

    if ascii_only:
        normalized = unicodedata.normalize("NFKD", raw)
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        cleaned = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "_", ascii_text)
        cleaned = re.sub(r"[^\x20-\x7E]", "_", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
        if not cleaned:
            fb_norm = (
                unicodedata.normalize("NFKD", fallback).encode("ascii", "ignore").decode("ascii")
            )
            fb_cleaned = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "_", fb_norm)
            fb_cleaned = re.sub(r"[^\x20-\x7E]", "_", fb_cleaned)
            fb_cleaned = re.sub(r"\s+", " ", fb_cleaned).strip(" ._-")
            cleaned = fb_cleaned or "karaoke"
        return cleaned
    else:
        cleaned = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "_", raw)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
        return cleaned or fallback


def build_content_disposition(
    title: str = "",
    artist: str = "",
    ext: str = "lrc",
    fallback: str = "karaoke",
    disposition_type: str = "attachment",
) -> str:
    """Build an RFC 6266 / RFC 5987 compliant Content-Disposition header value.

    Provides a 7-bit US-ASCII filename parameter for legacy/Starlette header compliance
    and a filename*=UTF-8'' percent-encoded parameter for RFC 5987 aware clients.
    """
    clean_ext = ext.lstrip(".")
    ascii_stem = sanitize_export_filename(
        title=title, artist=artist, fallback=fallback, ascii_only=True
    )
    utf8_stem = sanitize_export_filename(
        title=title, artist=artist, fallback=fallback, ascii_only=False
    )
    ascii_filename = f"{ascii_stem}.{clean_ext}"
    utf8_filename = f"{utf8_stem}.{clean_ext}"
    encoded_utf8 = quote(utf8_filename, safe="")
    return f"{disposition_type}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_utf8}"


@app.get("/api/project/{project_id}/export/lrc")
def export_project_lrc(project_id: str):
    """Export project lyric lines as standard UTF-8 .lrc subtitle file."""
    proj = get_project_or_404(project_id)

    lines = proj.get("lines")
    if not lines or not isinstance(lines, list):
        raise HTTPException(status_code=400, detail="Project has no lyric lines to export")

    title = proj.get("title", "")
    artist = proj.get("artist", "")
    lrc_content = lyrics_service.generate_lrc(lines, title=title, artist=artist)

    if not lyrics_service.is_lrc(lrc_content):
        raise HTTPException(status_code=400, detail="Project has no lyric lines to export")

    headers = {
        "Content-Disposition": build_content_disposition(
            title=title,
            artist=artist,
            ext="lrc",
            fallback=proj.get("track_id") or proj.get("id") or "karaoke",
        )
    }

    return Response(
        content=lrc_content,
        media_type="text/plain; charset=utf-8",
        headers=headers,
    )


@app.get("/api/project/{project_id}/export/ass")
def export_project_ass(
    project_id: str,
    aspect_ratio: str = Query("16:9", description="Canvas aspect ratio: strictly '16:9' or '9:16'"),
    theme_id: str | None = Query(None, description="Visual theme preset ID"),
    primary_color: str | None = Query(
        None, description="Optional primary (sung) ASS color override"
    ),
    secondary_color: str | None = Query(
        None, description="Optional secondary (unsung) ASS color override"
    ),
):
    """
    Export synchronized Advanced SubStation Alpha (.ass) subtitles for a project.
    Supports aspect ratios ('16:9' or '9:16'), visual theme presets, progressive \\kf tags,
    and direct color overrides. Does NOT require prior video rendering.
    """
    proj = get_project_or_404(project_id)

    # 1. Validate aspect_ratio
    if aspect_ratio not in ("16:9", "9:16"):
        raise HTTPException(
            status_code=400,
            detail="Invalid aspect ratio. Must be '16:9' or '9:16'",
        )

    # 2. Validate theme_id if provided
    if theme_id is not None and theme_id not in VISUAL_THEMES:
        allowed_themes = list(VISUAL_THEMES.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Invalid theme_id '{theme_id}'. Must be one of: {allowed_themes}",
        )

    # 3. Pre-flight check: Active processing without lyrics cannot export
    if proj.get("status") in ("queued", "downloading", "separating", "aligning") and not proj.get(
        "lines"
    ):
        raise HTTPException(
            status_code=400,
            detail="Project lyrics are not ready for export",
        )

    lines = proj.get("lines")
    if not lines or not isinstance(lines, list):
        raise HTTPException(status_code=400, detail="Project has no lyric lines to export")

    title = proj.get("title", "").strip()
    artist = proj.get("artist", "").strip()
    track_title = (
        f"{artist} - {title}" if (artist and title) else (title or artist or "Karaoke Track")
    )

    ass_content = video_renderer.generate_ass_content(
        lines=lines,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        title=track_title,
    )

    headers = {
        "Content-Disposition": build_content_disposition(
            title=title,
            artist=artist,
            ext="ass",
            fallback=proj.get("track_id") or proj.get("id") or "karaoke",
        )
    }

    return Response(
        content=ass_content,
        media_type="text/x-ssa; charset=utf-8",
        headers=headers,
    )


# Upload security limits and allowed MIME extensions
MAX_BACKGROUND_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_IMAGE_BACKGROUND_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
MAX_INSTRUMENTAL_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB
MAX_TRACK_UPLOAD_BYTES = 100 * 1024 * 1024  # 100 MB
ALLOWED_BACKGROUND_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".mp4", ".webm"}
ALLOWED_AUDIO_EXTS = {".wav", ".mp3", ".flac", ".m4a", ".ogg", ".aac"}


def sanitize_upload_filename(filename: str | None, default_stem: str = "upload") -> str:
    if not filename:
        return default_stem
    raw_name = Path(filename.replace("\x00", "")).name
    # Strip dangerous characters and allow only alphanumeric, underscore, dot, and dash
    cleaned = re.sub(r"[^a-zA-Z0-9_.-]", "_", raw_name).strip("._-")
    return cleaned or default_stem


def validate_background_header(data: bytes, ext: str) -> bool:
    if len(data) < 2:
        return False
    ext = ext.lower()
    if ext in [".jpg", ".jpeg"]:
        return data.startswith(b"\xff\xd8")
    elif ext == ".png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    elif ext == ".webp":
        return data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WEBP"
    elif ext == ".mp4":
        return len(data) >= 8 and data[4:8] == b"ftyp"
    elif ext == ".webm":
        return len(data) >= 4 and data.startswith(b"\x1a\x45\xdf\xa3")
    return False


validate_image_header = validate_background_header


def validate_audio_header(data: bytes, ext: str) -> bool:
    if len(data) < 2:
        return False
    ext = ext.lower()
    if ext == ".wav":
        return data.startswith(b"RIFF") and len(data) >= 12 and data[8:12] == b"WAVE"
    elif ext == ".mp3":
        return data.startswith(b"ID3") or (
            len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xE0) == 0xE0
        )
    elif ext == ".flac":
        return data.startswith(b"fLaC")
    elif ext == ".ogg":
        return data.startswith(b"OggS")
    elif ext == ".m4a":
        return len(data) >= 8 and data[4:8] == b"ftyp"
    elif ext == ".aac":
        return (len(data) >= 2 and data[0] == 0xFF and (data[1] & 0xF6) == 0xF0) or (
            len(data) >= 8 and data[4:8] == b"ftyp"
        )
    return False


async def save_upload_file_bounded(
    file: UploadFile,
    target_path: Path,
    max_bytes: int,
    min_bytes: int = 1,
) -> int:
    """
    Streams and writes UploadFile content to disk with a strict byte ceiling.
    Avoids unbounded memory consumption and prevents DoS through large file payloads.
    """
    total_bytes = 0
    target_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = target_path.with_suffix(f".tmp.{uuid.uuid4().hex}")
    try:
        with open(temp_path, "wb") as f:
            while chunk := await file.read(1024 * 64):
                total_bytes += len(chunk)
                if total_bytes > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Uploaded file exceeds maximum permitted size of {max_bytes // (1024 * 1024)}MB",
                    )
                f.write(chunk)
        if total_bytes < min_bytes:
            raise HTTPException(
                status_code=400,
                detail="Uploaded file is empty (0 bytes)",
            )
        temp_path.replace(target_path)
        return total_bytes
    finally:
        if temp_path.exists():
            try:
                temp_path.unlink()
            except OSError:
                pass


@app.post("/api/upload-instrumental")
async def upload_instrumental(project_id: str = Form(...), file: UploadFile = File(...)):
    safe_proj_id = sanitize_upload_filename(project_id, default_stem="project")
    proj = get_project_or_404(safe_proj_id)

    raw_ext = Path(file.filename or "custom.wav").suffix.lower()
    if raw_ext not in ALLOWED_AUDIO_EXTS:
        logger.warning(f"Rejected instrumental upload with unsupported extension: {raw_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported audio format '{raw_ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_AUDIO_EXTS))}",
        )

    target_path = STEMS_DIR / safe_proj_id / f"custom_inst{raw_ext}"
    bytes_written = await save_upload_file_bounded(
        file, target_path, MAX_INSTRUMENTAL_UPLOAD_BYTES, min_bytes=1
    )
    logger.info(f"Saved instrumental audio for project {safe_proj_id} ({bytes_written} bytes)")

    proj["instrumental_path"] = str(target_path)
    proj["instrumental_url"] = f"/static/stems/{safe_proj_id}/custom_inst{raw_ext}"
    save_projects()

    return {"status": "ok", "instrumental_url": proj["instrumental_url"]}


@app.post("/api/upload-background")
async def upload_background(file: UploadFile = File(...)):
    raw_ext = Path(file.filename or "bg.jpg").suffix.lower()
    if raw_ext not in ALLOWED_BACKGROUND_EXTS:
        logger.warning(f"Rejected background upload with unsupported extension: {raw_ext}")
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image format '{raw_ext}'. Allowed extensions: {', '.join(sorted(ALLOWED_BACKGROUND_EXTS))}",
        )

    safe_name = sanitize_upload_filename(file.filename, default_stem="bg.jpg")
    bg_id = f"{uuid.uuid4().hex[:8]}_{safe_name}"
    target_path = BACKGROUNDS_DIR / bg_id

    upload_limit = (
        MAX_BACKGROUND_UPLOAD_BYTES
        if raw_ext in {".mp4", ".webm"}
        else min(MAX_BACKGROUND_UPLOAD_BYTES, MAX_IMAGE_BACKGROUND_UPLOAD_BYTES)
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


@app.post("/api/upload-track")
@app.post("/api/upload-audio")
async def upload_audio_track(
    file: UploadFile = File(...),
    title: str | None = Form(default=None),
    artist: str | None = Form(default=None),
    created_by: str | None = Form(default=None),
    custom_lyrics: str | None = Form(default=None),
    bg_tasks: BackgroundTasks = BackgroundTasks(),
):
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

    target_upload_path = DOWNLOADS_DIR / f"{project_id}{raw_ext}"
    bytes_written = await save_upload_file_bounded(
        file, target_upload_path, MAX_TRACK_UPLOAD_BYTES, min_bytes=1
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

    projects[project_id] = proj_data
    save_projects()

    bg_tasks.add_task(
        run_local_pipeline,
        project_id,
        str(target_upload_path),
        track_title,
        track_artist,
        custom_lyrics,
    )
    return {"project_id": project_id, "status": "queued"}


# Mount built frontend if available
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
