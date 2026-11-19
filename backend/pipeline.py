"""Long-running track intake background workers for YouTube downloads and local audio uploads, coordinating stem separation, lyrics sync, alignment, and initial master mixing."""

import copy
import logging
import subprocess
import threading
import time
from pathlib import Path

import soundfile as sf

from backend import album_pipeline
from backend.background_jobs import release_cancel_event, superseded
from backend.config import DOWNLOADS_DIR
from backend.errors import public_error
from backend.master_audio import master_fields
from backend.project_analysis import ensure_chords, ensure_vocal_range, usable_file
from backend.project_store import (
    PROJECTS_LOCK,
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    save_projects,
    save_projects_throttled,
)
from backend.services import remote_separation
from backend.services.album_audio import file_chapters
from backend.services.album_tracks import ALBUM_MIN_SECONDS
from backend.services.downloader import AlbumDetected, DownloadCancelled
from backend.services.lyric_sync import UNCOVERED, sync_lyrics
from backend.services.repeat_fill import fill_repeats
from backend.services.separation_presets import (
    PRESET_LABELS,
    configured_preset,
    estimate_seconds,
    normalize_preset,
)
from backend.services.sync_confidence import uncovered_vocals
from backend.services.voice_parts import assign_voice_parts

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
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        proj["vocals_path"] = stems["vocals_path"]
        proj["instrumental_path"] = stems["instrumental_path"]
        proj["vocals_url"] = f"/static/stems/{audio_id}/vocals.wav"
        proj["instrumental_url"] = f"/static/stems/{audio_id}/instrumental.wav"
        provenance = stems.get("separation") or _shared_stem_provenance(
            main_mod, project_id, audio_id
        )
        if provenance:
            proj["separation"] = provenance
        save_projects()
    return stems


def warm_separation_gpu(main_mod, project_id: str) -> None:
    """Asks for a cloud GPU ahead of this project's separation, when its preset runs on one
    and its stems are not cached already. Returns at once and never raises: a warm-up only
    saves waiting, and remote_separation.warm_up limits how often it reaches Modal."""
    try:
        proj = find_project(project_id)
        if proj is None:
            return
        quality = normalize_preset(proj.get("separation_quality")) or configured_preset()
        has_cached = getattr(main_mod.separator, "has_cached_stems", None)
        if callable(has_cached) and has_cached(project_id, quality):
            return
        remote_separation.warm_up(quality, background=True)
    except Exception as exc:
        logger.debug(f"GPU warm-up skipped for {project_id}: {exc}")


class LyricsPrefetch:
    """Fetches a song's lyrics on a thread of its own while the stems are separated.

    The lookup (LRCLIB, then syncedlyrics) only needs the title, artist and length, so it
    runs alongside separation instead of after it; result() waits for it and returns the
    lyric data, or raises what the lookup raised, as a call in line would have."""

    def __init__(self, fetch, *args):
        self._result = None
        self._error: BaseException | None = None
        self._thread = threading.Thread(
            target=self._run, args=(fetch, *args), name="lyrics-prefetch", daemon=True
        )
        self._thread.start()

    def _run(self, fetch, *args) -> None:
        try:
            self._result = fetch(*args)
        except BaseException as exc:  # handed to the pipeline in result()
            self._error = exc

    def result(self, cancel_event: threading.Event | None = None) -> dict:
        while self._thread.is_alive():
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("Processing cancelled by user")
            self._thread.join(timeout=0.25)
        if self._error is not None:
            raise self._error
        return self._result


def start_lyrics(main_mod, custom_lyrics: str | None, title, artist, duration):
    """Starts the lyric lookup for a pipeline: None when lyrics were pasted (they are parsed
    in line later), else a LyricsPrefetch already running."""
    if custom_lyrics and custom_lyrics.strip():
        return None
    return LyricsPrefetch(main_mod.lyrics_service.fetch_lyrics, title, artist, duration)


def finish_lyrics(main_mod, prefetch, custom_lyrics: str | None, cancel_event) -> dict:
    """The lyric data for a pipeline: the pasted lyrics parsed, or the prefetch's result."""
    if prefetch is None:
        return main_mod.lyrics_service.process_custom_lyrics(custom_lyrics)
    return prefetch.result(cancel_event)


def analyze_project_stems(
    main_mod, project_id: str, stems: dict, cancel_event, label: str
) -> list[threading.Thread]:
    """Starts the analyses of a pipeline's new stems, each on a thread of its own: the vocal
    range and key from the vocals, the chord progression from the instrumental. The song
    does not wait for them; it opens while they run, and a backfill the studio asks for
    meanwhile waits for the run (project_analysis._analysis_lock). Either may fail without
    stopping the song; `label` names the pipeline in the log. Returns the threads."""
    if cancel_event.is_set():
        raise RuntimeError("Processing cancelled by user")

    def run(kind: str, analyse) -> None:
        if cancel_event.is_set():
            return
        try:
            analyse()
        except Exception as exc:
            if find_project(project_id) is None:
                return  # the song was deleted meanwhile
            logger.warning(
                f"{kind} analysis failed during {label} for {project_id} ({exc}); "
                "the studio backfills it on demand.",
                exc_info=True,
            )

    jobs = []
    vocals_path = stems.get("vocals_path")
    if hasattr(main_mod, "vocal_analyzer") and usable_file(vocals_path):
        jobs.append(
            (
                "Vocal range",
                lambda: ensure_vocal_range(project_id, force=True, source=vocals_path),
            )
        )
    inst_path = stems.get("instrumental_path")
    if hasattr(main_mod, "chord_detector") and usable_file(inst_path):
        # Chords stored now (a retried song's) are replaced only if no one edits them first
        before = copy.deepcopy((find_project(project_id) or {}).get("chords"))
        jobs.append(
            (
                "Chord",
                lambda: ensure_chords(project_id, force=True, source=inst_path, replacing=before),
            )
        )

    threads = []
    for kind, analyse in jobs:
        thread = threading.Thread(
            target=run, args=(kind, analyse), name=f"stem-analysis-{kind}", daemon=True
        )
        thread.start()
        threads.append(thread)
    return threads


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
    lines, report = result.lines, result.report
    # Repeats the lyric file left out, where the neural aligner hears them sung
    if report.get("engine") == "ctc" and report.get("uncovered_vocals"):
        lines, added = fill_repeats(vocals_path, lines, report["uncovered_vocals"])
        if added:
            regions = report.get("vocal_regions") or []
            still = uncovered_vocals(
                regions, lines, UNCOVERED["min_seconds"], UNCOVERED["line_margin_seconds"]
            )
            report = {**report, "lines_added_repeats": added, "uncovered_vocals": still}
    # A second voice (a hook singer beside a rapper, a narrator beside a lead) becomes Singer 2
    lines, voices = assign_voice_parts(vocals_path, lines)
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        proj["lines"] = lines
        proj["sync_report"] = report
        proj["lyric_timing"] = result.lyric_timing
        proj["voice_parts"] = voices.report()
        save_projects()


def _progress_updater(project_id: str, cancel_event: threading.Event, started: float):
    """The pipeline's progress callback: puts status, progress and timing on the project.

    A new status is saved at once; progress within a status is saved at most once a second,
    since the studio polls it from memory."""

    def update_pipe(status: str, progress: int, detail: str, eta_s: int | None = None):
        if cancel_event.is_set():
            raise RuntimeError("Processing cancelled by user")
        # Under the lock, so a status poll never copies the project halfway through an update
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if not proj:
                return
            status_changed = proj.get("status") != status
            proj["status"] = status
            proj["progress"] = progress
            proj["status_detail"] = detail
            proj["heartbeat"] = int(time.time() * 1000)
            proj["elapsed_seconds"] = int(time.time() - started)
            if eta_s is not None:
                proj["eta_seconds"] = eta_s
        if status_changed:
            save_projects()
        else:
            save_projects_throttled()

    return update_pipe


def _restarted(main_mod, project_id: str, cancel_event: threading.Event) -> bool:
    """Whether the song was started again after this run was cancelled (Try again while the
    old run was still queued or stopping). The song's status is the new run's from then on:
    this run must not write "cancelled" or an error over it. Call with PROJECTS_LOCK held."""
    return superseded(main_mod.active_cancellations, project_id, cancel_event)


def run_pipeline(project_id: str, url_or_id: str, custom_lyrics: str | None = None):
    import backend.main as main_mod

    cancel_event = main_mod.active_cancellations.setdefault(project_id, threading.Event())
    track_id: str | None = None
    update_pipe = _progress_updater(project_id, cancel_event, time.time())

    # Fast pre-acquire check
    proj = find_project(project_id)
    if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if proj and not _restarted(main_mod, project_id, cancel_event):
                proj["status"] = "cancelled"
                proj["status_detail"] = "Processing was cancelled by user"
                proj["progress"] = 0
                save_projects()
        release_cancel_event(main_mod.active_cancellations, project_id, cancel_event)
        return

    if proj is None:
        release_cancel_event(main_mod.active_cancellations, project_id, cancel_event)
        return

    semaphore_acquired = False
    try:
        main_mod.WORKER_SEMAPHORE.acquire()
        semaphore_acquired = True

        # Check if cancelled or deleted while waiting in queue
        proj = find_project(project_id)
        if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
            logger.info(f"Project {project_id} was cancelled while queued")
            with PROJECTS_LOCK:
                proj = find_project(project_id)
                if proj and not _restarted(main_mod, project_id, cancel_event):
                    proj["status"] = "cancelled"
                    proj["status_detail"] = "Processing was cancelled by user"
                    proj["progress"] = 0
                    save_projects()
            return

        if proj is None:
            logger.info(f"Project {project_id} was deleted while queued; skipping pipeline")
            return

        # Step 1: Download Audio and Metadata. A cloud GPU is asked for meanwhile, so it is
        # up by the time the stems are separated.
        update_pipe("downloading", 10, "Fetching audio track and metadata...", 15)
        warm_separation_gpu(main_mod, project_id)

        last_dl_tick = 0.0

        def dl_hook(d):
            nonlocal last_dl_tick
            if cancel_event.is_set():
                raise DownloadCancelled("Processing cancelled by user")
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
                warm_separation_gpu(main_mod, project_id)  # keeps the GPU up while it lasts
                update_pipe(
                    "downloading",
                    pipe_progress,
                    f"Downloading audio ({pct:.0f}%{speed_str})",
                    eta_s=eta,
                )

        proj = get_project_or_404(project_id)
        if proj.get("album_track"):
            # A song picked from an album: cut out of the album's audio
            meta = album_pipeline.song_audio(main_mod, project_id, dl_hook, update_pipe)
        else:
            # A whole album is noticed before it downloads; made as one song only on request
            whole = {"detect_album": False} if proj.get("album_whole") else {}
            try:
                meta = main_mod.downloader.extract_info_and_download(
                    url_or_id, progress_hook=dl_hook, **whole
                )
            except AlbumDetected as found:
                album_pipeline.open_link_album(
                    main_mod, project_id, url_or_id, found.info, dl_hook, update_pipe, cancel_event
                )
                return
        track_id = meta.get("id")
        with PROJECTS_LOCK:
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

        # Step 3 starts here: the lyric lookup runs while the stems are separated
        lyrics_job = start_lyrics(
            main_mod, custom_lyrics, meta["title"], meta["artist"], meta.get("duration")
        )

        # Step 2: Separate Stems (Vocals & Instrumental)
        duration = float(meta.get("duration") or 180)
        stems = separate_project_stems(
            main_mod, project_id, meta["audio_path"], audio_id, duration, update_pipe, cancel_event
        )

        # Steps 2b and 2c: vocal range and key, and chords, alongside the rest
        analyze_project_stems(main_mod, project_id, stems, cancel_event, "pipeline")

        # Step 3: Fetch Lyrics
        update_pipe("fetching_lyrics", 72, "Retrieving lyrics from LRCLIB...", 5)
        lyric_data = finish_lyrics(main_mod, lyrics_job, custom_lyrics, cancel_event)

        with PROJECTS_LOCK:
            proj = get_project_or_404(project_id)
            proj["lyric_source"] = lyric_data["source"]
            proj["lyric_source_id"] = lyric_data.get("source_id")
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
        # Before the lock: with the AAC preview on, this encodes the mix with FFmpeg, which
        # would hold up every status poll and save for seconds
        first_mix = master_fields(master_path)
        with PROJECTS_LOCK:
            proj = get_project_or_404(project_id)
            proj.update(first_mix)

        # Step 6: Ready!
        update_pipe("ready", 100, "Studio is ready! Sing and customize your track.", 0)

    except Exception as e:
        if cancel_event.is_set():
            # A cancel stops the job by raising inside it: no error, no traceback
            logger.info(f"Pipeline for {project_id} stopped after a cancel")
        else:
            logger.error(f"Pipeline error for {project_id}: {e}", exc_info=True)
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if proj is not None and _restarted(main_mod, project_id, cancel_event):
                logger.info(f"Song {project_id} was started again; leaving its status alone.")
            elif proj is not None:
                if cancel_event.is_set():
                    proj["status"] = "cancelled"
                    proj["status_detail"] = "Processing was cancelled by user"
                    proj["progress"] = 0
                else:
                    proj["status"] = "error"
                    proj["error"] = public_error(e)
                    proj["status_detail"] = f"Error: {public_error(e)}"
                save_projects()
            else:
                logger.info(
                    f"Project {project_id} was deleted during processing; skipping status update."
                )
    finally:
        if semaphore_acquired:
            main_mod.WORKER_SEMAPHORE.release()
        release_cancel_event(main_mod.active_cancellations, project_id, cancel_event)
        if track_id:
            release_cancel_event(main_mod.active_cancellations, track_id, cancel_event)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id, track_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )


# How long FFmpeg may take to turn an upload into the studio's WAV
TRANSCODE_TIMEOUT_SEC = 300


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
    update_pipe = _progress_updater(project_id, cancel_event, time.time())

    # Fast pre-acquire check
    proj = find_project(project_id)
    if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if proj and not _restarted(main_mod, project_id, cancel_event):
                proj["status"] = "cancelled"
                proj["status_detail"] = "Processing was cancelled by user"
                proj["progress"] = 0
                save_projects()
        release_cancel_event(main_mod.active_cancellations, project_id, cancel_event)
        return

    if proj is None:
        release_cancel_event(main_mod.active_cancellations, project_id, cancel_event)
        return

    semaphore_acquired = False
    try:
        main_mod.WORKER_SEMAPHORE.acquire()
        semaphore_acquired = True

        proj = find_project(project_id)
        if cancel_event.is_set() or (proj and proj.get("status") == "cancelled"):
            logger.info(f"Local project {project_id} was cancelled while queued")
            with PROJECTS_LOCK:
                proj = find_project(project_id)
                if proj and not _restarted(main_mod, project_id, cancel_event):
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
        warm_separation_gpu(main_mod, project_id)

        raw_path = Path(raw_audio_path)
        wav_target = downloads_dir / f"{project_id}.wav"
        album_check = not find_project(project_id).get("album_whole")
        # Chapters are lost in the WAV: read them while the upload is still as it was sent
        chapters = (
            file_chapters(raw_path)
            if album_check and raw_path.resolve() != wav_target.resolve()
            else []
        )

        needs_transcode = True
        if raw_path.resolve() == wav_target.resolve() and wav_target.exists():
            try:
                info = sf_mod.info(str(wav_target))
                if info.format == "WAV":
                    needs_transcode = False
                    duration = float(info.duration)
            except Exception:
                logger.info(f"{wav_target.name} is not a readable WAV; transcoding it")
                needs_transcode = True

        if needs_transcode:
            temp_wav = downloads_dir / f"{project_id}_norm.wav"
            cmd = [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
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
            try:
                # A long upload on a small CPU can take more than a minute to decode
                res = proc_mod.run(
                    cmd, capture_output=True, text=True, timeout=TRANSCODE_TIMEOUT_SEC
                )
                if res.returncode != 0:
                    reason = public_error(res.stderr or f"exit {res.returncode}")
                    raise RuntimeError(f"FFmpeg audio transcoding failed: {reason}")
                temp_wav.replace(wav_target)
            finally:
                # A failed or timed-out transcode leaves its half-written WAV behind
                temp_wav.unlink(missing_ok=True)
            if raw_path.resolve() != wav_target.resolve() and raw_path.exists():
                raw_path.unlink(missing_ok=True)
            try:
                info = sf_mod.info(str(wav_target))
                duration = float(info.duration)
            except Exception:
                logger.warning(
                    f"Could not read the length of {wav_target.name}; assuming 180 s",
                    exc_info=True,
                )
                duration = 180.0
        else:
            try:
                info = sf_mod.info(str(wav_target))
                duration = float(info.duration)
            except Exception:
                logger.warning(
                    f"Could not read the length of {wav_target.name}; assuming 180 s",
                    exc_info=True,
                )
                duration = 180.0

        with PROJECTS_LOCK:
            proj = get_project_or_404(project_id)
            proj["duration"] = duration
            proj["audio_path"] = str(wav_target)
            proj["audio_url"] = f"/static/downloads/{project_id}.wav"
            save_projects()

        # A file long enough to hold a whole album shows its songs to pick from instead
        if (
            album_check
            and duration >= ALBUM_MIN_SECONDS
            and album_pipeline.open_upload_album(
                project_id, wav_target, title, artist, duration, chapters, update_pipe, cancel_event
            )
        ):
            return

        # Step 3 starts here: the lyric lookup runs while the stems are separated
        lyrics_job = start_lyrics(main_mod, custom_lyrics, title, artist, duration)

        # Step 2: Separate Stems (Vocals & Instrumental)
        stems = separate_project_stems(
            main_mod, project_id, str(wav_target), project_id, duration, update_pipe, cancel_event
        )

        # Steps 2b and 2c: vocal range and key, and chords, alongside the rest
        analyze_project_stems(main_mod, project_id, stems, cancel_event, "local pipeline")

        # Step 3: Fetch / Process Lyrics
        update_pipe("fetching_lyrics", 72, "Processing song lyrics...", 5)
        lyric_data = finish_lyrics(main_mod, lyrics_job, custom_lyrics, cancel_event)

        with PROJECTS_LOCK:
            proj = get_project_or_404(project_id)
            proj["lyric_source"] = lyric_data["source"]
            proj["lyric_source_id"] = lyric_data.get("source_id")
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
        # Before the lock: with the AAC preview on, this encodes the mix with FFmpeg, which
        # would hold up every status poll and save for seconds
        first_mix = master_fields(master_path)
        with PROJECTS_LOCK:
            proj = get_project_or_404(project_id)
            proj.update(first_mix)

        # Step 6: Ready!
        update_pipe("ready", 100, "Studio is ready! Sing and customize your track.", 0)

    except Exception as e:
        if cancel_event.is_set():
            # A cancel stops the job by raising inside it: no error, no traceback
            logger.info(f"Pipeline for local track {project_id} stopped after a cancel")
        else:
            logger.error(f"Pipeline error for local track {project_id}: {e}", exc_info=True)
        with PROJECTS_LOCK:
            proj = find_project(project_id)
            if proj is not None and _restarted(main_mod, project_id, cancel_event):
                logger.info(f"Song {project_id} was started again; leaving its status alone.")
            elif proj is not None:
                if cancel_event.is_set():
                    proj["status"] = "cancelled"
                    proj["status_detail"] = "Processing was cancelled by user"
                    proj["progress"] = 0
                else:
                    proj["status"] = "error"
                    proj["error"] = public_error(e)
                    proj["status_detail"] = f"Error: {public_error(e)}"
                save_projects()
            else:
                logger.info(
                    f"Project {project_id} was deleted during processing; skipping status update."
                )
    finally:
        if semaphore_acquired:
            main_mod.WORKER_SEMAPHORE.release()
        release_cancel_event(main_mod.active_cancellations, project_id, cancel_event)
        if find_project(project_id) is None:
            try:
                cleanup_project_disk_artifacts(project_id)
            except Exception as cleanup_err:
                logger.warning(
                    f"Residual cleanup failed for deleted project {project_id}: {cleanup_err}"
                )
