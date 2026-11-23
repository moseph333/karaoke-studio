"""Background worker executing 1080p60 MP4 karaoke video rendering, pitch-shifted master mixing, subtitle generation, and YouTube metadata creation under concurrency limits."""

import logging
import threading
import time
from pathlib import Path

from backend.background_jobs import release_cancel_event, superseded
from backend.config import BACKGROUNDS_DIR, OUTPUT_DIR
from backend.errors import public_error
from backend.master_audio import make_master_mix
from backend.project_analysis import chords_for_export, estimated_key, youtube_package
from backend.project_store import (
    PROJECTS_LOCK,
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    save_projects,
    save_projects_throttled,
)
from backend.schemas import RenderRequest
from backend.services import song_loops
from backend.services.ass_generator import (
    card_names,
    export_fonts,
    export_title,
    resolve_look_style,
    resolve_sync_mode,
)
from backend.services.audio_mixer import mix_quality

logger = logging.getLogger("karaoke_backend")

# What video_renderer writes while a render runs, next to the video it will replace
PART_FILE_GLOB = "*.part.mp4"
# The render's own mix at final quality, deleted when the render ends
FINAL_AUDIO_GLOB = "*_final_audio.wav"
# What the mixer writes while it makes that mix, renamed to the name above when FFmpeg ends
FINAL_AUDIO_TEMP_GLOB = "*_final_audio.tmp_*.wav"


def final_audio_name(track_id: str) -> str:
    """The scratch mix a render makes at final quality and FFmpeg reads."""
    return f"{track_id}_final_audio.wav"


def video_file_name(track_id: str, aspect_ratio: str) -> str:
    """The rendered video's file name: one file per aspect ratio, so a 9:16 render never
    replaces the song's 16:9 video (and the other way round)."""
    if aspect_ratio == "9:16":
        return f"{track_id}_karaoke_vertical.mp4"
    return f"{track_id}_karaoke.mp4"


def remove_render_leftovers() -> int:
    """Deletes the half-written videos (*.part.mp4) and scratch mixes (*_final_audio.wav, and
    the mixer's *_final_audio.tmp_*.wav while it was still making one) of renders that a
    server restart cut off.

    Runs at startup, before any render can start, so none of them belongs to a running render.
    Returns how many were removed.
    """
    import backend.main as main_mod

    output_dir = Path(getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR))
    removed = 0
    for pattern in (PART_FILE_GLOB, FINAL_AUDIO_GLOB, FINAL_AUDIO_TEMP_GLOB):
        for leftover in output_dir.glob(pattern):
            try:
                leftover.unlink()
                removed += 1
            except FileNotFoundError:
                pass
            except OSError as exc:
                logger.warning(f"Could not remove the unfinished render {leftover.name}: {exc}")
    return removed


# One render at a time per song: a render requested while a cancelled one is still stopping
# waits here for it, since both write the same scratch mix, subtitles and video files
_SONG_RENDER_LOCKS: dict[str, threading.Lock] = {}
_SONG_RENDER_LOCKS_GUARD = threading.Lock()


def _song_render_lock(render_key: str) -> threading.Lock:
    with _SONG_RENDER_LOCKS_GUARD:
        return _SONG_RENDER_LOCKS.setdefault(render_key, threading.Lock())


def _acquire_unless_cancelled(lock, cancel_event: threading.Event) -> bool:
    """Waits for a lock or a job slot, giving up (False) once the render is cancelled, so a
    cancelled render never sits in the queue holding its song's event."""
    while not lock.acquire(timeout=0.25):
        if cancel_event.is_set():
            return False
    return True


def run_video_render(project_id: str, req: RenderRequest):
    import backend.main as main_mod

    render_key = f"{project_id}_render"
    cancel_event = main_mod.active_cancellations.setdefault(render_key, threading.Event())
    render_start = time.time()

    def replaced() -> bool:
        """Whether a newer render of the song was requested after this one was cancelled:
        the song's render fields are that render's from then on."""
        return superseded(main_mod.active_cancellations, render_key, cancel_event)

    def mark_cancelled() -> None:
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if proj and not replaced():
                proj["render_status"] = "idle"
                proj["render_detail"] = "Rendering cancelled"
                proj["render_progress"] = 0
                save_projects()

    def update_render(progress: int, detail: str, eta_s: int | None = None):
        if cancel_event.is_set():
            raise RuntimeError("Video rendering was cancelled by user")
        # Under the lock, so a status poll never copies the project halfway through an update
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if not proj:
                return
            started_rendering = proj.get("render_status") != "rendering"
            proj["render_status"] = "rendering"
            proj["render_progress"] = progress
            proj["render_detail"] = detail
            proj["render_heartbeat"] = int(time.time() * 1000)
            proj["render_elapsed_seconds"] = int(time.time() - render_start)
            if eta_s is not None:
                proj["render_eta_seconds"] = eta_s
        # Progress arrives up to 4 times a second and the studio reads it from memory
        if started_rendering:
            save_projects()
        else:
            save_projects_throttled()

    # Fast pre-acquire check
    if cancel_event.is_set():
        mark_cancelled()
        release_cancel_event(main_mod.active_cancellations, render_key, cancel_event)
        return

    if find_project(project_id) is None:
        release_cancel_event(main_mod.active_cancellations, render_key, cancel_event)
        return

    song_lock = _song_render_lock(render_key)
    song_lock_acquired = False
    semaphore_acquired = False
    final_audio: Path | None = None
    try:
        song_lock_acquired = _acquire_unless_cancelled(song_lock, cancel_event)
        if song_lock_acquired:
            semaphore_acquired = _acquire_unless_cancelled(main_mod.WORKER_SEMAPHORE, cancel_event)

        if cancel_event.is_set():
            logger.info(f"Render for {project_id} was cancelled while queued")
            mark_cancelled()
            return

        if find_project(project_id) is None:
            logger.info(f"Project {project_id} was deleted while queued for render")
            return

        update_render(5, "Generating progressive karaoke subtitles...", 45)

        proj = get_project_or_404(project_id)

        output_dir = getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR)
        bg_dir = getattr(main_mod, "BACKGROUNDS_DIR", BACKGROUNDS_DIR)

        track_id = proj.get("track_id") or proj.get("id") or "track"
        ass_path = output_dir / f"{track_id}.ass"
        video_name = video_file_name(track_id, req.aspect_ratio)
        mp4_path = output_dir / video_name
        # Deleted by this name when the render ends: a mixer may return another path
        final_audio = output_dir / final_audio_name(track_id)

        # 1. Generate ASS Subtitles, in the look the request names (a replaced preset's id
        # gives the look nearest it)
        style_cfg = dict(req.style_config or {})
        look_style = resolve_look_style(style_cfg, req.aspect_ratio)
        look = look_style.look
        card_title, card_artist = card_names(proj)

        main_mod.video_renderer.generate_ass_subtitles(
            lines=proj.get("lines", []),
            output_ass_path=ass_path,
            style_config=style_cfg,
            aspect_ratio=req.aspect_ratio,
            include_countdown=req.include_countdown,
            # The stored chords, else detected now (stored too) if the video shows them
            chords=chords_for_export(project_id, req.include_chords),
            include_chords=req.include_chords,
            semitones=req.semitones,
            key=estimated_key(proj),
            sync_mode=resolve_sync_mode(req.sync_mode, style_cfg),
            title=export_title(proj),
            song_duration=proj.get("duration"),
            card_title=card_title,
            card_artist=card_artist,
            part_names=proj.get("part_names"),
        )

        update_render(15, "Mixing master audio with pitch adjustment...", 40)

        # 2. Mix audio with current pitch & guide vocal settings (export-grade pitch shifting)
        vocal_levels = req.vocal_levels.stored() if req.vocal_levels else {}
        with mix_quality("final"):
            mixed_audio = make_master_mix(
                proj,
                req.semitones,
                req.guide_volume,
                vocal_levels,
                output_filename=final_audio.name,
                reuse=False,
            )

        update_render(22, "Initializing FFmpeg 1080p60 encoding engine...", 35)

        # 3. Custom background if specified (harden against path traversal)
        custom_bg_file = None
        if req.custom_bg_id:
            safe_bg_id = Path(req.custom_bg_id).name
            bg_candidate = (bg_dir / safe_bg_id).resolve()
            if bg_candidate.is_relative_to(bg_dir.resolve()) and bg_candidate.is_file():
                custom_bg_file = str(bg_candidate)
        if custom_bg_file is None and style_cfg.get("background_style") == song_loops.STYLE:
            # The song's own loop, drawn the way an uploaded video is. Without one the
            # style is unknown to the renderer, which then draws the cover art
            loop_file = song_loops.current_file(proj)
            custom_bg_file = str(loop_file) if loop_file else None

        def ffmpeg_cb(pct, detail, eta_s):
            render_pct = int(22 + ((pct or 0.0) * 0.75))
            update_render(render_pct, detail, eta_s=eta_s)

        # 4. Render Video
        main_mod.video_renderer.render_video(
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
            include_visualizer=req.include_visualizer,
            include_chords=req.include_chords,
            semitones=req.semitones,
            # The ground and its tone are the look's; the style and its colours the request's
            background_color=look["palette"]["ground"],
            background_style=style_cfg.get("background_style"),
            background_palette=style_cfg.get("background_palette"),
            background_tone=look["tone"],
            look_id=look["id"],
            # The visualizer's bars take the colour that marks the look's words
            visualizer_color=look_style.part_color("singer1"),
            fonts=export_fonts(style_cfg, req.aspect_ratio),
        )

        # The results first and the status last, together: the studio fetches the finished
        # project once, as soon as a status poll reads "completed"
        with PROJECTS_LOCK:
            proj = get_project_or_404(project_id)
            if replaced():
                # Cancelled too late to stop, with a newer render already queued: that
                # render makes the video again and reports on it
                return
            # What the video was made with, which its YouTube kit describes from now on
            proj["render_settings"] = {
                "semitones": req.semitones,
                "guide_volume": req.guide_volume,
                **({"vocal_levels": vocal_levels} if vocal_levels else {}),
            }
            proj["youtube_package"] = youtube_package(proj)
            # A new render in the same format replaces that format's file; the version makes
            # browsers fetch the new video rather than show or download their cached copy of
            # the previous one. video_url is the latest render, videos_by_aspect the latest
            # file of each format (the other format's video stays downloadable)
            proj["video_url"] = f"/static/output/{video_name}?v={int(time.time())}"
            earlier = proj.get("videos_by_aspect")
            proj["videos_by_aspect"] = {
                **(earlier if isinstance(earlier, dict) else {}),
                req.aspect_ratio: proj["video_url"],
            }
            proj["render_status"] = "completed"
            proj["render_progress"] = 100
            proj["render_detail"] = "Video export complete!"
            proj["render_eta_seconds"] = 0
        save_projects()

    except Exception as e:
        if cancel_event.is_set():
            # A cancel stops the render by raising inside it: no error, no traceback
            logger.info(f"Render for {project_id} stopped after a cancel")
        else:
            logger.error(f"Render failed for {project_id}: {e}", exc_info=True)
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if proj is not None and not replaced():
                if cancel_event.is_set():
                    proj["render_status"] = "idle"
                    proj["render_detail"] = "Rendering cancelled"
                    proj["render_progress"] = 0
                else:
                    proj["render_status"] = "error"
                    proj["render_error"] = public_error(e)
                    proj["render_detail"] = f"Render error: {public_error(e)}"
                save_projects()
        if proj is None:
            logger.info(
                f"Project {project_id} was deleted during rendering; skipping status update."
            )
    finally:
        # First, before the slot and the cancel event are released: a render queued after
        # those writes its own scratch mix under the same name
        if final_audio is not None:
            try:
                final_audio.unlink(missing_ok=True)
            except OSError as exc:
                logger.warning(
                    f"Could not remove the render's scratch mix {final_audio.name}: {exc}"
                )
        if semaphore_acquired:
            main_mod.WORKER_SEMAPHORE.release()
        release_cancel_event(main_mod.active_cancellations, render_key, cancel_event)
        if song_lock_acquired:
            song_lock.release()
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )
