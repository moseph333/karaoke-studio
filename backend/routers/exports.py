"""Export API router providing instant standalone .lrc/.ass subtitle and audio stem downloads."""

import os
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse

from backend.export_utils import build_content_disposition
from backend.project_store import get_project_or_404
from backend.services.ass_generator import VISUAL_THEMES

router = APIRouter(tags=["exports"])


@router.get("/api/project/{project_id}/export/lrc")
def export_project_lrc(project_id: str):
    """Export project lyric lines as standard UTF-8 .lrc subtitle file."""
    import backend.main as main_mod

    proj = get_project_or_404(project_id)

    lines = proj.get("lines")
    if not lines or not isinstance(lines, list):
        raise HTTPException(status_code=400, detail="Project has no lyric lines to export")

    title = proj.get("title", "")
    artist = proj.get("artist", "")
    lrc_content = main_mod.lyrics_service.generate_lrc(lines, title=title, artist=artist)

    if not main_mod.lyrics_service.is_lrc(lrc_content):
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


@router.get("/api/project/{project_id}/export/ass")
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
    """Export synchronized Advanced SubStation Alpha (.ass) subtitles for a project.

    Supports aspect ratios ('16:9' or '9:16'), visual theme presets, progressive \\kf tags,
    and direct color overrides. Does NOT require prior video rendering.
    """
    import backend.main as main_mod

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

    ass_content = main_mod.video_renderer.generate_ass_content(
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


def _get_audio_media_type(ext: str) -> str:
    ext_lower = ext.lower()
    if ext_lower == "wav":
        return "audio/wav"
    if ext_lower == "mp3":
        return "audio/mpeg"
    if ext_lower == "flac":
        return "audio/flac"
    if ext_lower in ("m4a", "aac"):
        return "audio/mp4"
    if ext_lower == "ogg":
        return "audio/ogg"
    return f"audio/{ext_lower}"


@router.get("/api/project/{project_id}/export/audio/{stem_type}")
def export_project_audio_stem(
    project_id: str,
    stem_type: str,
):
    """Export audio stem (instrumental, vocals, or master mix) with RFC 6266 attachment header."""
    proj = get_project_or_404(project_id)

    if proj.get("status") not in ("ready",):
        raise HTTPException(status_code=400, detail="Project audio is not ready for export")

    if stem_type == "instrumental":
        file_path = proj.get("instrumental_path")
        suffix = " (Instrumental)"
    elif stem_type == "vocals":
        file_path = proj.get("vocals_path")
        suffix = " (Vocals)"
    elif stem_type == "master":
        file_path = proj.get("master_audio_path")
        suffix = " (Master Mix)"
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid stem type '{stem_type}'. Allowed: 'instrumental', 'vocals', 'master'",
        )

    if not file_path or not os.path.isfile(file_path) or os.path.getsize(file_path) == 0:
        raise HTTPException(
            status_code=400,
            detail=f"Audio file for {stem_type} not found on disk",
        )

    ext = Path(file_path).suffix.lstrip(".").lower() or "wav"
    media_type = _get_audio_media_type(ext)
    raw_title = proj.get("title") or "Track"
    title = f"{raw_title}{suffix}".strip()
    artist = proj.get("artist", "")

    headers = {
        "Content-Disposition": build_content_disposition(
            title=title,
            artist=artist,
            ext=ext,
            fallback=f"{project_id}_{stem_type}",
        )
    }

    return FileResponse(
        path=file_path,
        media_type=media_type,
        headers=headers,
    )
