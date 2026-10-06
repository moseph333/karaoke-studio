import os
import uuid
import json
import time
import threading
import logging
from pathlib import Path
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.config import DATA_DIR, DOWNLOADS_DIR, STEMS_DIR, OUTPUT_DIR, BACKGROUNDS_DIR
from backend.services.downloader import TrackDownloader
from backend.services.separator import AudioSeparator
from backend.services.lyrics import LyricsService
from backend.services.aligner import AudioAligner
from backend.services.audio_mixer import AudioMixer
from backend.services.video_renderer import VideoRenderer
from backend.services.youtube_uploader import YouTubeMetadataService

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("karaoke_backend")

active_cancellations: Dict[str, threading.Event] = {}

app = FastAPI(title="YouTube Karaoke Studio API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount static directories so frontend can stream audio and video
app.mount("/static/downloads", StaticFiles(directory=str(DOWNLOADS_DIR)), name="downloads")
app.mount("/static/stems", StaticFiles(directory=str(STEMS_DIR)), name="stems")
app.mount("/static/output", StaticFiles(directory=str(OUTPUT_DIR)), name="output")
app.mount("/static/backgrounds", StaticFiles(directory=str(BACKGROUNDS_DIR)), name="backgrounds")

# Persistent store for project states
PROJECTS_STORE_FILE = DATA_DIR / "projects.json"

def load_projects() -> Dict[str, Dict[str, Any]]:
    if PROJECTS_STORE_FILE.exists():
        try:
            return json.loads(PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        except Exception as e:
            logger.warning(f"Could not load projects.json: {e}")
    return {}

def save_projects():
    try:
        # Deduplicate aliased keys
        unique_projects: Dict[str, Any] = {}
        for k, v in projects.items():
            pid = v.get("id", k)
            if pid not in unique_projects:
                unique_projects[pid] = v
        PROJECTS_STORE_FILE.write_text(json.dumps(unique_projects, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to persist projects.json: {e}")

projects: Dict[str, Dict[str, Any]] = load_projects()

def find_project(project_id: str) -> Optional[Dict[str, Any]]:
    if project_id in projects:
        return projects[project_id]
    disk_projects = load_projects()
    projects.update(disk_projects)
    if project_id in projects:
        return projects[project_id]
    for p_id, p in projects.items():
        if p.get("id") == project_id or p.get("track_id") == project_id:
            return p
    return None

def get_project_or_404(project_id: str) -> Dict[str, Any]:
    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    return proj

# Services
downloader = TrackDownloader()
separator = AudioSeparator()
lyrics_service = LyricsService()
aligner = AudioAligner()
audio_mixer = AudioMixer()
video_renderer = VideoRenderer()
youtube_service = YouTubeMetadataService()


# --- Request / Response Models ---
class SearchRequest(BaseModel):
    query: str
    limit: Optional[int] = 5

class ProcessRequest(BaseModel):
    url_or_id: str
    custom_lyrics: Optional[str] = None

class LyricsUpdateRequest(BaseModel):
    lines: List[Dict[str, Any]]

class MixRequest(BaseModel):
    semitones: int = 0
    guide_volume: float = 0.0

class RenderRequest(BaseModel):
    semitones: int = 0
    guide_volume: float = 0.0
    aspect_ratio: str = "16:9"
    style_config: Optional[Dict[str, Any]] = None
    custom_bg_id: Optional[str] = None


@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "YouTube Karaoke Studio"}


@app.post("/api/search")
def search_tracks(req: SearchRequest):
    try:
        results = downloader.search_tracks(req.query, limit=req.limit or 5)
        return {"results": results}
    except Exception as e:
        logger.error(f"Search failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def run_pipeline(project_id: str, url_or_id: str, custom_lyrics: Optional[str] = None):
    cancel_event = threading.Event()
    active_cancellations[project_id] = cancel_event
    pipeline_start = time.time()

    def update_pipe(status: str, progress: int, detail: str, eta_s: Optional[int] = None):
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
                speed_str = f" • {speed / (1024*1024):.1f} MB/s" if speed else ""
                eta = d.get("eta")
                pipe_progress = int(10 + (pct * 0.25))
                update_pipe("downloading", pipe_progress, f"Downloading audio ({pct:.0f}%{speed_str})", eta_s=eta)

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
            cancel_event=cancel_event
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
            lyric_data = {
                "source": "custom",
                "synced": False,
                "lines": lyrics_service.parse_plain_text(custom_lyrics),
                "plain_lyrics": custom_lyrics
            }
        else:
            lyric_data = lyrics_service.fetch_lyrics(meta["title"], meta["artist"], meta.get("duration"))
        
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
            output_filename=f"{audio_id}_master.wav"
        )
        proj = get_project_or_404(project_id)
        proj["master_audio_path"] = master_path
        proj["master_audio_url"] = f"/static/output/{audio_id}_master.wav"
        
        # Step 6: Ready!
        update_pipe("ready", 100, "Studio is ready! Sing and customize your track.", 0)

    except Exception as e:
        logger.error(f"Pipeline error for {project_id}: {e}", exc_info=True)
        proj = find_project(project_id) or {}
        if cancel_event.is_set():
            proj["status"] = "cancelled"
            proj["status_detail"] = "Processing was cancelled by user"
            proj["progress"] = 0
        else:
            proj["status"] = "error"
            proj["error"] = str(e)
            proj["status_detail"] = f"Error: {e}"
        save_projects()
    finally:
        active_cancellations.pop(project_id, None)


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
                elif p.get("status") in ["queued", "downloading", "separating", "fetching_lyrics", "aligning", "mixing"]:
                    # Verify task is genuinely running in memory, not a stale session artifact
                    is_active = (p_id in active_cancellations) or (video_id in active_cancellations)
                    if is_active:
                        logger.info(f"Project {p_id} for {video_id} already in progress ({p.get('status')})")
                        return {"project_id": p.get("id", p_id), "status": p.get("status")}
                    logger.warning(f"Project {p_id} was left in state '{p.get('status')}' from a previous server session. Resuming pipeline.")

    project_id = video_id if video_id else str(uuid.uuid4())[:8]
    proj_data = {
        "id": project_id,
        "status": "queued",
        "progress": 0,
        "lines": [],
        "semitones": 0,
        "guide_volume": 0.0
    }
    if video_id:
        proj_data["track_id"] = video_id
    projects[project_id] = proj_data
    save_projects()
    bg_tasks.add_task(run_pipeline, project_id, req.url_or_id, req.custom_lyrics)
    return {"project_id": project_id, "status": "queued"}


@app.get("/api/projects")
def list_projects():
    disk_projects = load_projects()
    projects.update(disk_projects)
    return projects


@app.get("/api/project/{project_id}")
def get_project(project_id: str):
    return get_project_or_404(project_id)


@app.post("/api/project/{project_id}/lyrics")
def update_lyrics(project_id: str, req: LyricsUpdateRequest):
    proj = get_project_or_404(project_id)
    proj["lines"] = req.lines
    save_projects()
    return {"status": "ok", "lines_count": len(req.lines)}


@app.post("/api/project/{project_id}/mix")
def mix_audio(project_id: str, req: MixRequest):
    proj = get_project_or_404(project_id)
    if "instrumental_path" not in proj:
        raise HTTPException(status_code=400, detail="Instrumental stem not ready yet")

    track_id = proj.get("track_id") or proj.get("id") or "track"
    output_filename = f"{track_id}_mix_{req.semitones}_{int(req.guide_volume*100)}.wav"
    
    master_path = audio_mixer.mix_and_shift(
        instrumental_path=proj["instrumental_path"],
        vocals_path=proj.get("vocals_path"),
        semitones=req.semitones,
        guide_volume=req.guide_volume,
        output_filename=output_filename
    )

    proj["master_audio_path"] = master_path
    proj["master_audio_url"] = f"/static/output/{output_filename}"
    proj["semitones"] = req.semitones
    proj["guide_volume"] = req.guide_volume
    save_projects()

    return {
        "status": "ok",
        "master_audio_url": proj["master_audio_url"]
    }


def run_video_render(project_id: str, req: RenderRequest):
    cancel_event = threading.Event()
    render_key = f"{project_id}_render"
    active_cancellations[render_key] = cancel_event
    render_start = time.time()

    def update_render(progress: int, detail: str, eta_s: Optional[int] = None):
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
            style_config=req.style_config
        )

        update_render(15, "Mixing master audio with pitch adjustment...", 40)

        # 2. Mix audio with current pitch & guide vocal settings
        mixed_audio = audio_mixer.mix_and_shift(
            instrumental_path=proj["instrumental_path"],
            vocals_path=proj.get("vocals_path"),
            semitones=req.semitones,
            guide_volume=req.guide_volume,
            output_filename=f"{track_id}_final_audio.wav"
        )

        update_render(22, "Initializing FFmpeg 1080p60 encoding engine...", 35)

        # 3. Custom background if specified
        custom_bg_file = None
        if req.custom_bg_id:
            bg_candidate = BACKGROUNDS_DIR / req.custom_bg_id
            if bg_candidate.exists():
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
            cancel_event=cancel_event
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
            has_guide_vocal=req.guide_volume > 0.05
        )
        proj["youtube_package"] = yt_package
        save_projects()

    except Exception as e:
        logger.error(f"Render failed for {project_id}: {e}", exc_info=True)
        proj = find_project(project_id) or {}
        if cancel_event.is_set():
            proj["render_status"] = "idle"
            proj["render_detail"] = "Rendering cancelled"
            proj["render_progress"] = 0
        else:
            proj["render_status"] = "error"
            proj["render_error"] = str(e)
            proj["render_detail"] = f"Render error: {e}"
        save_projects()
    finally:
        active_cancellations.pop(render_key, None)


@app.post("/api/project/{project_id}/render")
def render_video(project_id: str, req: RenderRequest, bg_tasks: BackgroundTasks):
    proj = get_project_or_404(project_id)
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


@app.get("/api/project/{project_id}/youtube-package")
def get_youtube_package(project_id: str):
    proj = get_project_or_404(project_id)
    return youtube_service.generate_youtube_package(
        title=proj.get("title", "Karaoke Track"),
        artist=proj.get("artist", "Artist"),
        lines=proj.get("lines", []),
        semitones=proj.get("semitones", 0),
        has_guide_vocal=proj.get("guide_volume", 0.0) > 0.05
    )


@app.post("/api/upload-instrumental")
async def upload_instrumental(project_id: str = Form(...), file: UploadFile = File(...)):
    proj = get_project_or_404(project_id)

    file_ext = Path(file.filename or "custom.wav").suffix or ".wav"
    target_path = STEMS_DIR / project_id / f"custom_inst{file_ext}"
    target_path.parent.mkdir(parents=True, exist_ok=True)
    
    content = await file.read()
    target_path.write_bytes(content)

    proj["instrumental_path"] = str(target_path)
    proj["instrumental_url"] = f"/static/stems/{project_id}/custom_inst{file_ext}"
    save_projects()

    return {"status": "ok", "instrumental_url": proj["instrumental_url"]}


@app.post("/api/upload-background")
async def upload_background(file: UploadFile = File(...)):
    bg_id = f"{uuid.uuid4().hex[:8]}_{file.filename}"
    target_path = BACKGROUNDS_DIR / bg_id
    content = await file.read()
    target_path.write_bytes(content)
    return {"status": "ok", "bg_id": bg_id, "bg_url": f"/static/backgrounds/{bg_id}"}


# Mount built frontend if available
FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")

