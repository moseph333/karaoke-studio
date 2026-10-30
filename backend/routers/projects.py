"""Project management API router handling search, intake processing, project queries, metadata updates, lyric editing, audio mixing, cancellation, deletion, and YouTube metadata generation."""

import hashlib
import logging
import os
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Response
from fastapi.responses import FileResponse

from backend import realignment
from backend.background_jobs import SEPARATION_JOB, job_active
from backend.config import OUTPUT_DIR
from backend.project_store import (
    PROJECTS_LOCK,
    cleanup_project_disk_artifacts,
    find_project,
    get_project_or_404,
    merge_disk_projects,
    save_projects,
)
from backend.reseparation import cancel_key as reseparation_cancel_key
from backend.reseparation import settle_stale_job
from backend.schemas import (
    ChordsUpdateRequest,
    KeyRecommendationRequest,
    KeyRecommendationResponse,
    LyricsUpdateRequest,
    MixRequest,
    ProcessRequest,
    ProjectChordsResponse,
    ProjectMetadataUpdate,
    RealignLyricsRequest,
    RenderRequest,
    SearchRequest,
    VocalRangeData,
)
from backend.services import remote_render
from backend.services.lyric_sync import prepare_existing_lines, sync_lyrics
from backend.services.video_renderer import artwork_still, render_still
from backend.services.waveform import (
    DEFAULT_BINS,
    MAX_BINS,
    MIN_BINS,
    WaveformUnavailable,
    compute_peaks,
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

    merge_disk_projects(main_mod.projects)

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
    if req.separation_quality:
        proj_data["separation_quality"] = req.separation_quality
    cancel_event = threading.Event()
    main_mod.active_cancellations[project_id] = cancel_event
    if video_id and video_id != project_id:
        main_mod.active_cancellations[video_id] = cancel_event
    main_mod.projects[project_id] = proj_data
    save_projects()
    bg_tasks.add_task(main_mod.run_pipeline, project_id, req.url_or_id, req.custom_lyrics)
    return {"project_id": project_id, "status": "queued"}


@router.get("/api/projects")
def list_projects(scope: str | None = "all", user: str | None = None):
    import backend.main as main_mod

    merge_disk_projects(main_mod.projects)

    if scope == "my" and user:
        return {pid: p for pid, p in main_mod.projects.items() if p.get("created_by") == user}
    return main_mod.projects


@router.get("/api/project/{project_id}")
def get_project(project_id: str):
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    # Background jobs left running by a previous server process would otherwise poll forever
    settled = settle_stale_job(proj, main_mod.active_cancellations)
    if realignment.settle_stale_job(proj, main_mod.active_cancellations) or settled:
        save_projects()
    return proj


@router.get(
    "/api/project/{project_id}/vocal-range",
    response_model=VocalRangeData,
    summary="Get project vocal range analysis with on-demand auto-backfill",
)
def get_vocal_range(project_id: str):
    """Returns cached vocal range analysis for a project.

    If vocal range metadata is not yet present and the isolated vocal stem exists on disk,
    this endpoint automatically computes the acoustic analysis on demand and updates the
    project store without requiring full stem re-separation.
    """
    import backend.main as main_mod

    proj = get_project_or_404(project_id)

    cached_range = proj.get("vocal_range")
    if cached_range:
        return cached_range

    vocals_path = proj.get("vocals_path")
    if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
        logger.warning(
            f"Vocal range analysis rejected for {project_id}: vocals stem missing or empty ({vocals_path})"
        )
        raise HTTPException(
            status_code=400,
            detail="Cannot analyze vocal range: isolated vocal stem missing or not ready",
        )

    try:
        # Execute CPU-bound acoustic analysis outside PROJECTS_LOCK
        vocal_range = main_mod.vocal_analyzer.analyze_vocals(vocals_path)

        with PROJECTS_LOCK:
            target_proj = get_project_or_404(project_id)
            target_proj["vocal_range"] = vocal_range
            save_projects()

        return vocal_range
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Vocal range analysis failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to analyze vocal range: {e}") from e


@router.post(
    "/api/project/{project_id}/vocal-range",
    response_model=VocalRangeData,
    summary="Force re-analysis of project vocal range",
)
def reanalyze_vocal_range(project_id: str):
    """Forces re-analysis of the project's vocal stem and refreshes cached metadata."""
    import backend.main as main_mod

    proj = get_project_or_404(project_id)

    vocals_path = proj.get("vocals_path")
    if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
        logger.warning(
            f"Forced vocal range re-analysis rejected for {project_id}: vocals stem missing or empty ({vocals_path})"
        )
        raise HTTPException(
            status_code=400,
            detail="Cannot analyze vocal range: isolated vocal stem missing or not ready",
        )

    try:
        # Execute CPU-bound acoustic analysis outside PROJECTS_LOCK
        vocal_range = main_mod.vocal_analyzer.analyze_vocals(vocals_path)

        with PROJECTS_LOCK:
            target_proj = get_project_or_404(project_id)
            target_proj["vocal_range"] = vocal_range
            save_projects()

        return vocal_range
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Vocal range re-analysis failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to re-analyze vocal range: {e}") from e


@router.post(
    "/api/project/{project_id}/recommend-key",
    response_model=KeyRecommendationResponse,
    summary="Recommend optimal pitch transposition for a target singer voice profile",
)
def recommend_key(project_id: str, req: KeyRecommendationRequest):
    """Recommends an integer semitone transposition within [-12, +12] that optimizes
    the song's vocal peaks and median range into the singer's target voice range.
    """
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    vocal_range = proj.get("vocal_range")

    # On-demand backfill if range missing but stem available
    if not vocal_range:
        vocals_path = proj.get("vocals_path")
        if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
            raise HTTPException(
                status_code=400,
                detail="Cannot recommend key: vocal range analysis unavailable and vocal stem missing",
            )
        vocal_range = main_mod.vocal_analyzer.analyze_vocals(vocals_path)
        with PROJECTS_LOCK:
            target_proj = get_project_or_404(project_id)
            target_proj["vocal_range"] = vocal_range
            save_projects()

    # Safe handling for unvoiced or silent audio
    if not vocal_range.get("is_voiced") or not vocal_range.get("lowest_note"):
        return {
            "recommended_semitones": 0,
            "projected_key": vocal_range.get("estimated_key", "Unknown"),
            "projected_low_note": None,
            "projected_high_note": None,
            "cost": 0.0,
            "is_in_range": True,
            "target_preset": req.target_voice_preset,
            "original_key": vocal_range.get("estimated_key", "Unknown"),
        }

    try:
        recommendation = main_mod.vocal_analyzer.recommend_key(
            song_vocal_range=vocal_range,
            target_voice_preset=req.target_voice_preset,
            custom_low_note=req.custom_low_note,
            custom_high_note=req.custom_high_note,
        )
        return recommendation
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Key recommendation failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to recommend key: {e}") from e


@router.get(
    "/api/project/{project_id}/chords",
    response_model=ProjectChordsResponse,
    summary="Get project harmonic chord progression with on-demand auto-backfill",
)
def get_project_chords(project_id: str, semitones: int = 0):
    """Returns cached harmonic chord progression segments for a project.

    If chords are not yet stored and the isolated instrumental stem exists on disk,
    this endpoint automatically detects the chord progression on-demand from
    instrumental_path without re-running Demucs stem separation, persisting the result atomically.
    Optionally transposes chords if semitones != 0 is specified.
    """
    import backend.main as main_mod
    from backend.services.chord_detector import project_key_signature, transpose_chord_progression

    if not (-12 <= semitones <= 12):
        raise HTTPException(
            status_code=422,
            detail=f"semitones must be in range [-12, 12], got {semitones}",
        )

    proj = get_project_or_404(project_id)
    estimated_key = (
        proj.get("vocal_range", {}).get("estimated_key")
        if isinstance(proj.get("vocal_range"), dict)
        else None
    )

    # 1. Fast path: cached chords already present in project store
    cached_chords = proj.get("chords")
    if cached_chords is not None:
        chords_to_return = cached_chords
        if semitones != 0:
            target_key = project_key_signature(estimated_key, semitones) if estimated_key else None
            chords_to_return = transpose_chord_progression(
                cached_chords, semitones=semitones, key=target_key
            )
        return ProjectChordsResponse(
            project_id=proj.get("id", project_id),
            chords=chords_to_return,
            estimated_key=estimated_key,
            detected=True,
        )

    # 2. On-demand auto-backfill: verify audio stem availability
    inst_path = proj.get("instrumental_path")
    audio_stem = inst_path
    if not audio_stem or not os.path.isfile(audio_stem) or os.path.getsize(audio_stem) == 0:
        audio_stem = proj.get("audio_path")
        if not audio_stem or not os.path.isfile(audio_stem) or os.path.getsize(audio_stem) == 0:
            if cached_chords is not None:
                return ProjectChordsResponse(
                    project_id=proj.get("id", project_id),
                    chords=[],
                    estimated_key=estimated_key,
                    detected=False,
                )
            logger.warning(
                f"Chord detection rejected for project {project_id}: instrumental stem missing or empty ({inst_path})"
            )
            raise HTTPException(
                status_code=400,
                detail="Cannot detect chords: instrumental stem missing or not ready",
            )

    try:
        # 3. Execute CPU-bound STFT and chroma extraction OUTSIDE PROJECTS_LOCK
        detector = getattr(main_mod, "chord_detector", None)
        if detector is None:
            from backend.services.chord_detector import ChordDetector

            detector = ChordDetector()

        detected_chords = detector.detect_chords(audio_stem)

        # 4. Atomically persist detected chords under PROJECTS_LOCK
        with PROJECTS_LOCK:
            target_proj = get_project_or_404(project_id)
            if target_proj.get("chords") is None:
                target_proj["chords"] = detected_chords
                save_projects()
            else:
                detected_chords = target_proj["chords"]

        chords_to_return = detected_chords
        if semitones != 0:
            target_key = project_key_signature(estimated_key, semitones) if estimated_key else None
            chords_to_return = transpose_chord_progression(
                detected_chords, semitones=semitones, key=target_key
            )

        return ProjectChordsResponse(
            project_id=target_proj.get("id", project_id),
            chords=chords_to_return,
            estimated_key=estimated_key,
            detected=True,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chord detection failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to detect chords: {e}") from e


@router.post(
    "/api/project/{project_id}/chords",
    summary="Update project chord progression segments atomically with strict validation",
)
def update_project_chords_endpoint(project_id: str, req: ChordsUpdateRequest):
    """Atomically updates a project's chord progression segments.

    Enforces strict interval monotonicity: start < end for each chord,
    and end_i <= start_{i+1} across all consecutive segments. Non-overlapping
    intervals are strictly enforced; violations reject with HTTP 422.
    Persists atomically to projects.json under PROJECTS_LOCK.
    """
    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    serialized_chords = [chord.model_dump() for chord in req.chords]

    with PROJECTS_LOCK:
        target_proj = get_project_or_404(project_id)
        target_proj["chords"] = serialized_chords
        save_projects()

    return {
        "status": "ok",
        "project_id": target_proj.get("id", project_id),
        "chords_count": len(serialized_chords),
        "chords": target_proj["chords"],
    }


@router.post(
    "/api/project/{project_id}/chords/detect",
    response_model=ProjectChordsResponse,
    summary="Force re-detection of project harmonic chord progression",
)
def force_redetect_chords(project_id: str):
    """Forces re-detection of the project's harmonic chord progression from the instrumental stem,

    overwriting any existing or cached chord progression and persisting atomically.
    """
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    if proj.get("status") in ("processing", "queued", "downloading", "separating"):
        raise HTTPException(
            status_code=400,
            detail="Cannot detect chords: project processing is not complete",
        )

    inst_path = proj.get("instrumental_path")
    audio_stem = inst_path
    if not audio_stem or not os.path.isfile(audio_stem) or os.path.getsize(audio_stem) == 0:
        audio_stem = proj.get("audio_path")
        if not audio_stem or not os.path.isfile(audio_stem) or os.path.getsize(audio_stem) == 0:
            logger.warning(
                f"Forced chord detection rejected for project {project_id}: instrumental stem missing or empty ({inst_path})"
            )
            raise HTTPException(
                status_code=400,
                detail="Cannot detect chords: instrumental stem missing or not ready",
            )

    try:
        detector = getattr(main_mod, "chord_detector", None)
        if detector is None:
            from backend.services.chord_detector import ChordDetector

            detector = ChordDetector()

        detected_chords = detector.detect_chords(audio_stem)

        with PROJECTS_LOCK:
            target_proj = get_project_or_404(project_id)
            target_proj["chords"] = detected_chords
            save_projects()

        estimated_key = (
            target_proj.get("vocal_range", {}).get("estimated_key")
            if isinstance(target_proj.get("vocal_range"), dict)
            else None
        )

        return ProjectChordsResponse(
            project_id=target_proj.get("id", project_id),
            chords=detected_chords,
            estimated_key=estimated_key,
            detected=True,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Forced chord re-detection failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to detect chords: {e}") from e


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


def _search_lyrics(self, track_name: str, artist_name: str | None = None) -> list[dict]:
    import requests

    clean_title = (track_name or "").strip()
    clean_artist = (artist_name or "").strip()
    results = []

    # 1. Try structured search by track_name and artist_name
    params = {}
    if clean_title:
        params["track_name"] = clean_title
    if clean_artist:
        params["artist_name"] = clean_artist
    try:
        resp = requests.get(f"{self.lrclib_url}/search", params=params, timeout=5)
        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                results = data
    except Exception as e:
        logger.warning(f"LRCLIB structured search failed: {e}")

    # 2. If no results, fallback to general q search
    if not results and (clean_title or clean_artist):
        q = f"{clean_title} {clean_artist}".strip()
        try:
            resp = requests.get(f"{self.lrclib_url}/search", params={"q": q}, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    results = data
        except Exception as e:
            logger.warning(f"LRCLIB query search failed: {e}")

    candidates = []
    for item in results:
        if not isinstance(item, dict):
            continue
        candidates.append(
            {
                "id": item.get("id"),
                "track_name": item.get("trackName")
                or item.get("name")
                or item.get("track_name")
                or "",
                "artist_name": item.get("artistName") or item.get("artist_name") or "",
                "album_name": item.get("albumName") or item.get("album_name") or "",
                "duration": float(item.get("duration", 0.0) or 0.0),
                "instrumental": bool(item.get("instrumental", False)),
                "plain_lyrics": item.get("plainLyrics") or item.get("plain_lyrics") or "",
                "synced_lyrics": item.get("syncedLyrics") or item.get("synced_lyrics") or "",
            }
        )
    return candidates


@router.get("/api/project/{project_id}/lyrics/candidates")
def get_lyric_candidates(
    project_id: str,
    track_name: str | None = None,
    artist_name: str | None = None,
):
    import backend.main as main_mod

    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")

    query_title = (
        track_name if track_name is not None and track_name.strip() else proj.get("title", "")
    )
    query_artist = (
        artist_name if artist_name is not None and artist_name.strip() else proj.get("artist", "")
    )

    if not hasattr(main_mod.lyrics_service, "search_lyrics"):
        main_mod.lyrics_service.__class__.search_lyrics = _search_lyrics

    raw_candidates = main_mod.lyrics_service.search_lyrics(query_title, query_artist)

    candidates = []
    for item in raw_candidates or []:
        if not isinstance(item, dict):
            continue
        candidates.append(
            {
                "id": item.get("id"),
                "track_name": item.get("track_name")
                or item.get("trackName")
                or item.get("name")
                or "",
                "artist_name": item.get("artist_name") or item.get("artistName") or "",
                "album_name": item.get("album_name") or item.get("albumName") or "",
                "duration": float(item.get("duration", 0.0) or 0.0),
                "instrumental": bool(item.get("instrumental", False)),
                "plain_lyrics": item.get("plain_lyrics") or item.get("plainLyrics") or "",
                "synced_lyrics": item.get("synced_lyrics") or item.get("syncedLyrics") or "",
            }
        )

    return candidates


@router.post("/api/project/{project_id}/realign-lyrics")
def realign_lyrics(
    project_id: str, req: RealignLyricsRequest, bg_tasks: BackgroundTasks, response: Response
):
    """Realigns project lyrics acoustically using existing vocal stem.

    Takes custom lyrics (LRC or plain text), an LRCLIB re-fetch, or the studio's current
    ``lines`` to re-time, and aligns the words against the existing isolated vocal stem
    without re-running separation. Answered within the request by the fast DSP aligner, or
    with ``background: true`` queued as a job (202, ``sync_job`` on the project) that runs
    the server's configured aligner, neural when available.
    """
    import backend.main as main_mod

    proj = find_project(project_id)
    if not proj:
        raise HTTPException(status_code=404, detail="Project not found")
    pid = proj.get("id", project_id)

    vocals_path = proj.get("vocals_path")
    if not vocals_path or not os.path.isfile(vocals_path) or os.path.getsize(vocals_path) == 0:
        logger.warning(
            f"Lyric realignment rejected for {project_id}: vocals stem missing or empty ({vocals_path})"
        )
        raise HTTPException(
            status_code=400,
            detail="Cannot realign lyrics: isolated vocal stem missing or not ready",
        )

    has_custom = bool(req.custom_lyrics and req.custom_lyrics.strip())
    if not req.fetch_lrclib and not has_custom and not req.lines:
        raise HTTPException(
            status_code=400,
            detail="Must provide either custom_lyrics or fetch_lrclib=True",
        )

    with PROJECTS_LOCK:
        if realignment.settle_stale_job(proj, main_mod.active_cancellations):
            save_projects()
        if req.background:
            reason = realignment.conflict_reason(proj)
        elif realignment.job_is_active(proj) or job_active(proj, SEPARATION_JOB):
            # Either job would overwrite this result when it finishes
            reason = realignment.conflict_reason(proj)
        else:
            reason = None
    if reason:
        raise HTTPException(status_code=409, detail=reason)

    try:
        if req.fetch_lrclib:
            mode = "lrclib"
            lyric_data = main_mod.lyrics_service.fetch_lyrics(
                proj.get("title", "Karaoke Track"),
                proj.get("artist", "Artist"),
                proj.get("duration"),
            )
        elif has_custom:
            mode = "custom"
            lyric_data = main_mod.lyrics_service.process_custom_lyrics(req.custom_lyrics or "")
        else:
            mode = "lines"
            lines = prepare_existing_lines([line.model_dump() for line in req.lines or []])
            lyric_data = {"lines": lines, "source": proj.get("lyric_source")}

        lines_to_align = lyric_data.get("lines") or []
        if not lines_to_align:
            raise HTTPException(
                status_code=400,
                detail="No lyric lines found in provided input or LRCLIB response",
            )

        if req.background:
            with PROJECTS_LOCK:
                proj = find_project(pid)
                if not proj:
                    raise HTTPException(status_code=404, detail="Project not found")
                reason = realignment.conflict_reason(proj)
                if reason:
                    raise HTTPException(status_code=409, detail=reason)
                job = realignment.create_job(proj, mode)
                main_mod.active_cancellations[realignment.cancel_key(pid)] = threading.Event()
                save_projects()
            bg_tasks.add_task(
                realignment.run_realignment, pid, job["id"], lines_to_align, lyric_data, mode
            )
            response.status_code = 202
            return {"status": "queued", "job": job}

        # Answered within the request, so the fast DSP aligner
        result = sync_lyrics(vocals_path, lines_to_align, lyric_data=lyric_data, engine="dsp")
        aligned_lines = result.lines

        with PROJECTS_LOCK:
            # Aligning took a while and the project dict may have been reloaded meanwhile
            proj = find_project(pid)
            if not proj:
                raise HTTPException(status_code=404, detail="Project not found")
            realignment.store_aligned_lines(main_mod, proj, aligned_lines)
            if mode == "lines":
                if proj.get("lyric_timing") in (None, "none"):
                    proj["lyric_timing"] = result.lyric_timing
            else:
                proj["lyric_source"] = lyric_data.get("source", "custom")
                proj["is_synced"] = lyric_data.get("synced", True)
                proj["lyric_timing"] = result.lyric_timing
            proj["sync_report"] = result.report
            save_projects()

        return {
            "status": "ok",
            "lines": aligned_lines,
            "source": proj.get("lyric_source"),
            "is_synced": proj.get("is_synced"),
            "sync_report": result.report,
            "lyric_timing": proj.get("lyric_timing", result.lyric_timing),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Lyric realignment failed for {project_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to realign lyrics: {e}") from e


# Smallest plausible WAV render: anything at or below a bare RIFF header is a broken file
_MIN_MIX_BYTES = 44
# Bump when the mixer's sound changes, so that renders made by the older mixer are made again
MIX_CACHE_VERSION = "2"
MIX_CACHE_MARKER = ".mix-cache-version"


def mix_cache_epoch(output_dir) -> float:
    """When this mixer version started rendering into ``output_dir``: the modification time
    of a marker file holding MIX_CACHE_VERSION, written on first use. Older renders (from
    Karaoke Studio 1.x, say) are not reused."""
    marker = Path(output_dir) / MIX_CACHE_MARKER
    try:
        if marker.read_text(encoding="utf-8").strip() == MIX_CACHE_VERSION:
            return marker.stat().st_mtime
    except OSError:
        pass
    try:
        marker.write_text(MIX_CACHE_VERSION, encoding="utf-8")
        return marker.stat().st_mtime
    except OSError:
        return float("inf")  # nowhere to note the version: render every time


def reusable_mix_path(output_dir, output_filename: str, sources: list) -> str | None:
    """
    Return a previously rendered mix when it can be served again: it exists, is more
    than a bare WAV header, was made by this mixer version, and is newer than every source
    stem (a replaced instrumental or re-separated stems invalidate it).
    """
    if not isinstance(output_dir, (str, os.PathLike)):
        return None
    epoch = mix_cache_epoch(output_dir)
    candidate = Path(output_dir) / output_filename
    try:
        stat = candidate.stat()
    except OSError:
        return None
    if stat.st_size <= _MIN_MIX_BYTES or stat.st_mtime < epoch:
        return None
    for source in sources:
        try:
            if source and os.path.getmtime(source) > stat.st_mtime:
                return None
        except OSError:
            continue
    return str(candidate)


def mix_version(path: str) -> int:
    """Millisecond modification stamp used to cache-bust the master audio URL."""
    try:
        return os.stat(path).st_mtime_ns // 1_000_000
    except OSError:
        return int(time.time() * 1000)


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

    # Key / guide changes revisit the same few combinations: reuse renders that are
    # still newer than their stems instead of re-running FFmpeg.
    sources = [inst_path]
    if req.guide_volume > 0.001 and proj.get("vocals_path"):
        sources.append(proj["vocals_path"])
    output_dir = getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR)
    master_path = reusable_mix_path(output_dir, output_filename, sources)
    if master_path:
        logger.info(f"Reusing cached mix {output_filename} for project {project_id}")
    else:
        master_path = main_mod.audio_mixer.mix_and_shift(
            instrumental_path=proj["instrumental_path"],
            vocals_path=proj.get("vocals_path"),
            semitones=req.semitones,
            guide_volume=req.guide_volume,
            output_filename=output_filename,
        )

    proj["master_audio_path"] = master_path
    # Versioned URL: a re-render under the same name must not be served from browser cache
    proj["master_audio_url"] = f"/static/output/{output_filename}?v={mix_version(master_path)}"
    proj["semitones"] = req.semitones
    proj["guide_volume"] = req.guide_volume
    save_projects()

    return {"status": "ok", "master_audio_url": proj["master_audio_url"]}


@router.get("/api/project/{project_id}/waveform")
def get_project_waveform(
    project_id: str,
    bins: int = Query(DEFAULT_BINS, ge=MIN_BINS, le=MAX_BINS, description="Number of peaks"),
):
    """Loudness overview of the audio the studio plays (normalized 0-1 peaks).

    Prefers the current master mix, then the instrumental stem, then the original upload;
    results are cached until the file changes.
    """
    proj = get_project_or_404(project_id)
    candidates = (
        ("master", proj.get("master_audio_path")),
        ("instrumental", proj.get("instrumental_path")),
        ("original", proj.get("audio_path")),
    )
    for source, path in candidates:
        if not path or not os.path.isfile(path):
            continue
        try:
            peaks, duration = compute_peaks(path, bins)
        except WaveformUnavailable as exc:
            logger.info(f"Waveform source {source} unusable for {project_id}: {exc}")
            continue
        return {
            "project_id": project_id,
            "source": source,
            "bins": len(peaks),
            "duration": duration,
            "peaks": peaks,
        }
    raise HTTPException(
        status_code=409, detail="Waveform is not available until the audio is ready"
    )


@router.get("/api/project/{project_id}/backdrop")
def get_project_backdrop(
    project_id: str,
    aspect: Literal["16:9", "9:16"] = Query("16:9", description="Video format"),
    drift: bool = Query(False, description="The larger still the drifting style pans across"),
):
    """The song's cover art exactly as video exports draw it (filled, blurred and darkened), so
    the stage preview shows the same image instead of imitating it.

    Rendered once per thumbnail and size into the output folder, under the project's prefix so
    deleting the project removes it.
    """
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    thumbnail = proj.get("thumbnail_path")
    if not thumbnail or not os.path.isfile(thumbnail):
        raise HTTPException(status_code=404, detail="This song has no cover art")
    width, height = (1080, 1920) if aspect == "9:16" else (1920, 1080)
    width, height, chain = artwork_still(width, height, drift=drift)

    source = Path(thumbnail)
    info = source.stat()
    key = f"{chain}|{source.resolve()}|{info.st_mtime_ns}|{info.st_size}"
    digest = hashlib.sha256(key.encode()).hexdigest()[:12]
    prefix = f"{Path(str(proj.get('id') or project_id)).name}_backdrop_{width}x{height}_"
    output_dir = Path(getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR))
    target = output_dir / f"{prefix}{digest}.png"
    if not target.is_file():
        scratch = output_dir / f"{prefix}{uuid.uuid4().hex[:8]}.tmp.png"
        try:
            render_still(source, chain, scratch)
            os.replace(scratch, target)
        except (RuntimeError, OSError, subprocess.SubprocessError) as exc:
            scratch.unlink(missing_ok=True)
            logger.warning(f"Could not prepare the backdrop for {project_id}: {exc}")
            raise HTTPException(status_code=500, detail="Could not prepare the cover art") from exc
        # Stills made for an earlier thumbnail are never served again (another request's
        # unfinished scratch file is left alone)
        for stale in output_dir.glob(f"{prefix}*.png"):
            if stale != target and not stale.name.endswith(".tmp.png"):
                stale.unlink(missing_ok=True)
    return FileResponse(target, media_type="image/png", headers={"Cache-Control": "no-cache"})


@router.post("/api/project/{project_id}/render")
def render_video(project_id: str, req: RenderRequest, bg_tasks: BackgroundTasks):
    import backend.main as main_mod

    proj = get_project_or_404(project_id)
    render_key = f"{project_id}_render"
    # A second request (a double click, another tab) would run a second FFmpeg encode into
    # the same files. run_video_render removes this event when it ends; a set one is a
    # cancelled render winding down.
    running = main_mod.active_cancellations.get(render_key)
    if running is not None and not running.is_set():
        raise HTTPException(status_code=409, detail="A video is already rendering for this song")
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
    main_mod.active_cancellations.setdefault(render_key, threading.Event())
    proj["render_progress"] = 5
    proj["render_detail"] = "Queueing render job..."
    proj["render_eta_seconds"] = 45
    proj["render_heartbeat"] = int(time.time() * 1000)
    save_projects()
    bg_tasks.add_task(main_mod.run_video_render, project_id, req)

    return {"status": "queued"}


@router.post("/api/render/warmup", status_code=202)
def warm_up_render(bg_tasks: BackgroundTasks):
    """Start a cloud CPU while the export options are chosen (RENDER_REMOTE=modal and
    RENDER_REMOTE_PREWARM on). The Export dialog calls this when it opens; the work happens
    after the response, and nothing happens when exports render here."""
    cloud = remote_render.prewarm_enabled() and remote_render.enabled()
    if cloud:
        bg_tasks.add_task(remote_render.warm_up)
    return {"status": "warming" if cloud else "local"}


@router.post("/api/project/{project_id}/cancel")
def cancel_project(project_id: str):
    import backend.main as main_mod

    main_mod.active_cancellations.setdefault(project_id, threading.Event()).set()
    proj = find_project(project_id)
    if proj:
        track_id = proj.get("track_id")
        if track_id and track_id != project_id:
            main_mod.active_cancellations.setdefault(track_id, threading.Event()).set()
        proj["status"] = "cancelled"
        proj["status_detail"] = "Processing cancelled by user"
        proj["progress"] = 0
        save_projects()
    return {"status": "ok"}


@router.post("/api/project/{project_id}/cancel-render")
def cancel_render(project_id: str):
    import backend.main as main_mod

    render_key = f"{project_id}_render"
    main_mod.active_cancellations.setdefault(render_key, threading.Event()).set()
    proj = find_project(project_id)
    if proj:
        track_id = proj.get("track_id")
        if track_id and track_id != project_id:
            main_mod.active_cancellations.setdefault(f"{track_id}_render", threading.Event()).set()
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
    cancel_keys = {
        pid,
        f"{pid}_render",
        reseparation_cancel_key(pid),
        realignment.cancel_key(pid),
    }
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
