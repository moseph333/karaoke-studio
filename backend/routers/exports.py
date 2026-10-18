"""Subtitle export API router providing instant standalone .lrc and .ass file downloads."""

from fastapi import APIRouter, HTTPException, Query, Response

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
