"""Background worker executing 1080p60 MP4 karaoke video rendering, pitch-shifted master mixing, subtitle generation, and YouTube metadata creation under concurrency limits."""

import logging
import threading
import time
from pathlib import Path

from backend.config import BACKGROUNDS_DIR, OUTPUT_DIR
from backend.project_store import (
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    save_projects,
    save_projects_throttled,
)
from backend.schemas import RenderRequest
from backend.services.ass_generator import css_to_ass_color
from backend.services.audio_mixer import mix_quality

logger = logging.getLogger("karaoke_backend")


def run_video_render(project_id: str, req: RenderRequest):
    import backend.main as main_mod

    render_key = f"{project_id}_render"
    cancel_event = main_mod.active_cancellations.setdefault(render_key, threading.Event())
    render_start = time.time()

    def update_render(progress: int, detail: str, eta_s: int | None = None):
        if cancel_event.is_set():
            raise RuntimeError("Video rendering was cancelled by user")
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
        proj = find_project(project_id)
        if proj:
            proj["render_status"] = "idle"
            proj["render_detail"] = "Rendering cancelled"
            proj["render_progress"] = 0
            save_projects()
        main_mod.active_cancellations.pop(render_key, None)
        return

    if find_project(project_id) is None:
        main_mod.active_cancellations.pop(render_key, None)
        return

    semaphore_acquired = False
    try:
        main_mod.WORKER_SEMAPHORE.acquire()
        semaphore_acquired = True

        if cancel_event.is_set():
            logger.info(f"Render for {project_id} was cancelled while queued")
            proj = find_project(project_id)
            if proj:
                proj["render_status"] = "idle"
                proj["render_detail"] = "Rendering cancelled"
                proj["render_progress"] = 0
                save_projects()
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
        mp4_path = output_dir / f"{track_id}_karaoke.mp4"

        # 1. Generate ASS Subtitles
        style_cfg = dict(req.style_config or {})
        sync_mode = getattr(req, "sync_mode", None)
        if (sync_mode is None or sync_mode == "word") and style_cfg.get("sync_mode"):
            sync_mode = style_cfg["sync_mode"]
        sync_mode = sync_mode or "word"
        if style_cfg.get("primary_color"):
            style_cfg["primary_color"] = css_to_ass_color(style_cfg["primary_color"])
        if style_cfg.get("secondary_color"):
            style_cfg["secondary_color"] = css_to_ass_color(
                style_cfg["secondary_color"], default="&H00FFFFFF"
            )

        # Resolve chords for subtitle burning with on-demand backfill if necessary
        chords = proj.get("chords")
        if chords is None and req.include_chords:
            inst_path = proj.get("instrumental_path") or proj.get("audio_path")
            if inst_path and Path(inst_path).is_file() and Path(inst_path).stat().st_size > 0:
                try:
                    detector = getattr(main_mod, "chord_detector", None)
                    if detector is None:
                        from backend.services.chord_detector import ChordDetector

                        detector = ChordDetector()
                    detected = detector.detect_chords(inst_path)
                    chords = [c.to_dict() if hasattr(c, "to_dict") else dict(c) for c in detected]
                    proj["chords"] = chords
                    save_projects()
                except Exception as exc:
                    logger.warning(f"Failed to auto-detect chords for render: {exc}")
                    chords = []
            else:
                chords = []
        elif chords is None:
            chords = []

        eff_key = proj.get("estimated_key") or (
            proj.get("vocal_range", {}).get("estimated_key")
            if isinstance(proj.get("vocal_range"), dict)
            else None
        )

        main_mod.video_renderer.generate_ass_subtitles(
            lines=proj.get("lines", []),
            output_ass_path=ass_path,
            style_config=style_cfg,
            aspect_ratio=req.aspect_ratio,
            include_countdown=req.include_countdown,
            chords=chords,
            include_chords=req.include_chords,
            semitones=req.semitones,
            key=eff_key,
            sync_mode=sync_mode,
        )

        update_render(15, "Mixing master audio with pitch adjustment...", 40)

        # 2. Mix audio with current pitch & guide vocal settings (export-grade pitch shifting)
        with mix_quality("final"):
            mixed_audio = main_mod.audio_mixer.mix_and_shift(
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
            bg_candidate = (bg_dir / safe_bg_id).resolve()
            if bg_candidate.is_relative_to(bg_dir.resolve()) and bg_candidate.is_file():
                custom_bg_file = str(bg_candidate)

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
            background_color=style_cfg.get("background_color"),
            background_style=style_cfg.get("background_style"),
            background_palette=style_cfg.get("background_palette"),
            background_tone=style_cfg.get("background_tone"),
        )

        proj = get_project_or_404(project_id)
        proj["render_status"] = "completed"
        proj["render_progress"] = 100
        proj["render_detail"] = "Video export complete!"
        proj["render_eta_seconds"] = 0
        # Rendering again overwrites the same file; the version makes browsers fetch the new video
        # rather than show or download their cached copy of the previous one
        proj["video_url"] = f"/static/output/{track_id}_karaoke.mp4?v={int(time.time())}"

        # Generate YouTube package
        yt_package = main_mod.youtube_service.generate_youtube_package(
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
        if semaphore_acquired:
            main_mod.WORKER_SEMAPHORE.release()
        main_mod.active_cancellations.pop(render_key, None)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )
