"""Long-running track intake background workers for YouTube downloads and local audio uploads, coordinating stem separation, lyrics sync, alignment, and initial master mixing."""

import logging
import os
import subprocess
import threading
import time
from pathlib import Path

import soundfile as sf

from backend.config import DOWNLOADS_DIR
from backend.project_store import (
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    save_projects,
)
from backend.services.lyric_sync import sync_lyrics
from backend.services.separation_presets import (
    PRESET_LABELS,
    configured_preset,
    estimate_seconds,
    normalize_preset,
)

logger = logging.getLogger("karaoke_backend")


def _shared_stem_provenance(main_mod, project_id: str, audio_id: str) -> dict | None:
    """How cached stems were made, as recorded by another project that shares them."""
    for other in list(main_mod.projects.values()):
        if not isinstance(other, dict) or other.get("id") == project_id:
            continue
        if audio_id in (other.get("track_id"), other.get("id")) and isinstance(
            other.get("separation"), dict
        ):
            return dict(other["separation"])
    return None


def separate_project_stems(
    main_mod,
    project_id: str,
    audio_path: str,
    audio_id: str,
    duration: float,
    update_pipe,
    cancel_event,
) -> dict:
    """Separates a pipeline's song at the project's chosen quality (or the server default),
    records the stems and how they were made on the project, and returns the stem paths."""
    proj = get_project_or_404(project_id)
    quality = normalize_preset(proj.get("separation_quality")) or configured_preset()
    update_pipe(
        "separating",
        35,
        f"Preparing {PRESET_LABELS[quality]} stem separation...",
        max(15, estimate_seconds(quality, duration)),
    )

    def sep_cb(pct, detail, eta_s):
        pipe_progress = int(35 + ((pct or 0.0) * 0.35))
        update_pipe("separating", pipe_progress, detail, eta_s=eta_s)

    stems = main_mod.separator.separate_stems(
        audio_path=audio_path,
        track_id=audio_id,
        model_name=quality,
        duration=duration,
        progress_callback=sep_cb,
        cancel_event=cancel_event,
    )
    proj = get_project_or_404(project_id)
    proj["vocals_path"] = stems["vocals_path"]
    proj["instrumental_path"] = stems["instrumental_path"]
    proj["vocals_url"] = f"/static/stems/{audio_id}/vocals.wav"
    proj["instrumental_url"] = f"/static/stems/{audio_id}/instrumental.wav"
    provenance = stems.get("separation") or _shared_stem_provenance(main_mod, project_id, audio_id)
    if provenance:
        proj["separation"] = provenance
    save_projects()
    return stems


def sync_project_lyrics(
    project_id: str, vocals_path: str, lyric_data: dict, update_pipe, cancel_event
) -> None:
    """Times a pipeline's lyrics (progress 82-91) and stores lines, report and timing kind."""
    update_pipe("aligning", 82, "Aligning lyrics to vocal acoustic energy envelopes...", 5)
    last = [82]

    def on_progress(pct, detail):
        if pct is not None:
            last[0] = max(last[0], 82 + round(pct * 0.09))
        update_pipe("aligning", last[0], detail)

    result = sync_lyrics(
        vocals_path,
        lyric_data["lines"],
        lyric_data=lyric_data,
        progress=on_progress,
        cancel_event=cancel_event,
    )
    proj = get_project_or_404(project_id)
    proj["lines"] = result.lines
    proj["sync_report"] = result.report
    proj["lyric_timing"] = result.lyric_timing
    save_projects()


def run_pipeline(project_id: str, url_or_id: str, custom_lyrics: str | None = None):
    import backend.main as main_mod

    cancel_event = main_mod.active_cancellations.setdefault(project_id, threading.Event())
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

    # Fast pre-acquire check
    proj = find_project(project_id)
    if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
        if proj:
            proj["status"] = "cancelled"
            proj["status_detail"] = "Processing was cancelled by user"
            proj["progress"] = 0
            save_projects()
        main_mod.active_cancellations.pop(project_id, None)
        return

    if proj is None:
        main_mod.active_cancellations.pop(project_id, None)
        return

    semaphore_acquired = False
    try:
        main_mod.WORKER_SEMAPHORE.acquire()
        semaphore_acquired = True

        # Check if cancelled or deleted while waiting in queue
        proj = find_project(project_id)
        if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
            logger.info(f"Project {project_id} was cancelled while queued")
            if proj:
                proj["status"] = "cancelled"
                proj["status_detail"] = "Processing was cancelled by user"
                proj["progress"] = 0
                save_projects()
            return

        if proj is None:
            logger.info(f"Project {project_id} was deleted while queued; skipping pipeline")
            return

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

        meta = main_mod.downloader.extract_info_and_download(url_or_id, progress_hook=dl_hook)
        track_id = meta.get("id")
        proj = get_project_or_404(project_id)
        proj.update(meta)
        proj["id"] = project_id  # Guarantee project ID remains consistent
        if track_id:
            proj["track_id"] = track_id
            main_mod.projects[track_id] = proj  # Alias so lookups by track_id also resolve

        # Relative static URLs
        audio_id = track_id or project_id
        proj["audio_url"] = f"/static/downloads/{audio_id}.wav"
        if meta.get("thumbnail_path"):
            thumb_name = Path(meta["thumbnail_path"]).name
            proj["thumbnail_url"] = f"/static/downloads/{thumb_name}"
        save_projects()

        # Step 2: Separate Stems (Vocals & Instrumental)
        duration = float(meta.get("duration") or 180)
        stems = separate_project_stems(
            main_mod, project_id, meta["audio_path"], audio_id, duration, update_pipe, cancel_event
        )

        # Step 2b: Analyze Vocal Range & Pitch Bounds
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")

        try:
            if hasattr(main_mod, "vocal_analyzer") and stems.get("vocals_path"):
                v_path = stems["vocals_path"]
                if os.path.isfile(v_path) and os.path.getsize(v_path) > 0:
                    update_pipe("separating", 70, "Analyzing vocal range and musical key...", 3)
                    vocal_range = main_mod.vocal_analyzer.analyze_vocals(v_path)
                    proj = get_project_or_404(project_id)
                    proj["vocal_range"] = vocal_range
                    save_projects()
        except Exception as va_err:
            logger.warning(
                f"Vocal range analysis failed during pipeline for {project_id} ({va_err}); continuing pipeline.",
                exc_info=True,
            )

        # Step 2c: Detect Harmonic Chords from Instrumental Accompaniment
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")

        try:
            inst_path = stems.get("instrumental_path")
            if (
                hasattr(main_mod, "chord_detector")
                and inst_path
                and os.path.isfile(inst_path)
                and os.path.getsize(inst_path) > 0
            ):
                update_pipe("separating", 71, "Detecting musical chord progression...", 3)
                detected_chords = main_mod.chord_detector.detect_chords(inst_path)
                proj = get_project_or_404(project_id)
                proj["chords"] = detected_chords
                save_projects()
        except Exception as cd_err:
            logger.warning(
                f"Chord detection failed during pipeline for {project_id} ({cd_err}); continuing pipeline.",
                exc_info=True,
            )

        # Step 3: Fetch Lyrics
        update_pipe("fetching_lyrics", 72, "Retrieving lyrics from LRCLIB...", 5)
        if custom_lyrics and custom_lyrics.strip():
            lyric_data = main_mod.lyrics_service.process_custom_lyrics(custom_lyrics)
        else:
            lyric_data = main_mod.lyrics_service.fetch_lyrics(
                meta["title"], meta["artist"], meta.get("duration")
            )

        proj = get_project_or_404(project_id)
        proj["lyric_source"] = lyric_data["source"]
        proj["is_synced"] = lyric_data["synced"]
        save_projects()

        # Step 4: Line and word timing (DSP, plus the neural aligner when available)
        sync_project_lyrics(project_id, stems["vocals_path"], lyric_data, update_pipe, cancel_event)

        # Step 5: Mix Initial Master
        update_pipe("mixing", 92, "Mixing initial master playback...", 3)
        master_path = main_mod.audio_mixer.mix_and_shift(
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
        if semaphore_acquired:
            main_mod.WORKER_SEMAPHORE.release()
        main_mod.active_cancellations.pop(project_id, None)
        if track_id:
            main_mod.active_cancellations.pop(track_id, None)
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
    import backend.main as main_mod

    proc_mod = getattr(main_mod, "subprocess", subprocess)
    sf_mod = getattr(main_mod, "sf", sf)
    downloads_dir = getattr(main_mod, "DOWNLOADS_DIR", DOWNLOADS_DIR)

    cancel_event = main_mod.active_cancellations.setdefault(project_id, threading.Event())
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

    # Fast pre-acquire check
    proj = find_project(project_id)
    if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
        if proj:
            proj["status"] = "cancelled"
            proj["status_detail"] = "Processing was cancelled by user"
            proj["progress"] = 0
            save_projects()
        main_mod.active_cancellations.pop(project_id, None)
        return

    if proj is None:
        main_mod.active_cancellations.pop(project_id, None)
        return

    semaphore_acquired = False
    try:
        main_mod.WORKER_SEMAPHORE.acquire()
        semaphore_acquired = True

        proj = find_project(project_id)
        if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
            logger.info(f"Local project {project_id} was cancelled while queued")
            if proj:
                proj["status"] = "cancelled"
                proj["status_detail"] = "Processing was cancelled by user"
                proj["progress"] = 0
                save_projects()
            return

        if proj is None:
            logger.info(f"Local project {project_id} was deleted while queued; skipping pipeline")
            return

        # Step 1: Transcode / Normalize raw uploaded audio to standard WAV (pcm_s16le, 44100Hz, 2ch)
        update_pipe("processing", 5, "Preparing audio track...")

        raw_path = Path(raw_audio_path)
        wav_target = downloads_dir / f"{project_id}.wav"

        needs_transcode = True
        if raw_path.resolve() == wav_target.resolve() and wav_target.exists():
            try:
                info = sf_mod.info(str(wav_target))
                if info.format == "WAV":
                    needs_transcode = False
                    duration = float(info.duration)
            except Exception:
                needs_transcode = True

        if needs_transcode:
            temp_wav = downloads_dir / f"{project_id}_norm.wav"
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
            res = proc_mod.run(cmd, capture_output=True, text=True, timeout=60)
            if res.returncode != 0:
                raise RuntimeError(f"FFmpeg audio transcoding failed: {res.stderr}")
            temp_wav.replace(wav_target)
            if raw_path.resolve() != wav_target.resolve() and raw_path.exists():
                raw_path.unlink(missing_ok=True)
            try:
                info = sf_mod.info(str(wav_target))
                duration = float(info.duration)
            except Exception:
                duration = 180.0
        else:
            try:
                info = sf_mod.info(str(wav_target))
                duration = float(info.duration)
            except Exception:
                duration = 180.0

        proj = get_project_or_404(project_id)
        proj["duration"] = duration
        proj["audio_path"] = str(wav_target)
        proj["audio_url"] = f"/static/downloads/{project_id}.wav"
        save_projects()

        # Step 2: Separate Stems (Vocals & Instrumental)
        stems = separate_project_stems(
            main_mod, project_id, str(wav_target), project_id, duration, update_pipe, cancel_event
        )

        # Step 2b: Analyze Vocal Range & Pitch Bounds
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")

        try:
            if hasattr(main_mod, "vocal_analyzer") and stems.get("vocals_path"):
                v_path = stems["vocals_path"]
                if os.path.isfile(v_path) and os.path.getsize(v_path) > 0:
                    update_pipe("separating", 70, "Analyzing vocal range and musical key...", 3)
                    vocal_range = main_mod.vocal_analyzer.analyze_vocals(v_path)
                    proj = get_project_or_404(project_id)
                    proj["vocal_range"] = vocal_range
                    save_projects()
        except Exception as va_err:
            logger.warning(
                f"Vocal range analysis failed during local pipeline for {project_id} ({va_err}); continuing pipeline.",
                exc_info=True,
            )

        # Step 2c: Detect Harmonic Chords from Instrumental Accompaniment
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")

        try:
            inst_path = stems.get("instrumental_path")
            if (
                hasattr(main_mod, "chord_detector")
                and inst_path
                and os.path.isfile(inst_path)
                and os.path.getsize(inst_path) > 0
            ):
                update_pipe("separating", 71, "Detecting musical chord progression...", 3)
                detected_chords = main_mod.chord_detector.detect_chords(inst_path)
                proj = get_project_or_404(project_id)
                proj["chords"] = detected_chords
                save_projects()
        except Exception as cd_err:
            logger.warning(
                f"Chord detection failed during local pipeline for {project_id} ({cd_err}); continuing pipeline.",
                exc_info=True,
            )

        # Step 3: Fetch / Process Lyrics
        update_pipe("fetching_lyrics", 72, "Processing song lyrics...", 5)
        if custom_lyrics and custom_lyrics.strip():
            lyric_data = main_mod.lyrics_service.process_custom_lyrics(custom_lyrics)
        else:
            lyric_data = main_mod.lyrics_service.fetch_lyrics(title, artist, duration)

        proj = get_project_or_404(project_id)
        proj["lyric_source"] = lyric_data["source"]
        proj["is_synced"] = lyric_data["synced"]
        save_projects()

        # Step 4: Line and word timing (DSP, plus the neural aligner when available)
        sync_project_lyrics(project_id, stems["vocals_path"], lyric_data, update_pipe, cancel_event)

        # Step 5: Mix Initial Master
        update_pipe("mixing", 92, "Mixing initial master playback...", 3)
        master_path = main_mod.audio_mixer.mix_and_shift(
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
        if semaphore_acquired:
            main_mod.WORKER_SEMAPHORE.release()
        main_mod.active_cancellations.pop(project_id, None)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )
