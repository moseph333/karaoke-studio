"""Export API router providing instant standalone .lrc/.ass subtitle and audio stem downloads."""

import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import FileResponse

from backend.background_jobs import BUSY_PIPELINE_STATES
from backend.export_utils import build_content_disposition
from backend.project_analysis import StemMissing, chords_for_export, ensure_chords, estimated_key
from backend.project_store import get_project_or_404
from backend.services.ass_generator import VISUAL_THEMES
from backend.services.chord_detector import (
    NO_CHORD_VALUES,
    project_key_signature,
    transpose_chord_progression,
)
from backend.services.lyrics import LyricsService

router = APIRouter(tags=["exports"])


def format_timestamp(seconds: float) -> str:
    """Formats seconds into an [mm:ss.xx] timestamp tag, with the LRC export's formatter (a
    separate copy here printed 59.996 s as [00:60.00] instead of [01:00.00])."""
    return LyricsService.format_lrc_timestamp(seconds)


def generate_chord_sheet(
    lines: list[dict[str, Any]],
    chords: list[dict[str, Any]],
    title: str = "",
    artist: str = "",
    estimated_key: str | None = None,
    semitones: int = 0,
) -> str:
    """Generates a standalone monospaced Chord & Lyric Lead Sheet in Markdown.

    Args:
        lines: Project lyric lines with timestamps and optional word-level tokens.
        chords: Timecoded chord progression segments.
        title: Track title.
        artist: Track artist.
        estimated_key: Detected musical key signature.
        semitones: Semitone transposition offset in [-12, +12].

    Returns:
        Formatted UTF-8 Markdown chord sheet with lead sheet alignment and RFC metadata.
    """
    # 1. Transpose chords if semitones != 0
    eff_key = estimated_key
    transposed_chords = chords
    if semitones != 0 and chords:
        target_key = project_key_signature(estimated_key, semitones) if estimated_key else None
        transposed_chords = transpose_chord_progression(chords, semitones=semitones, key=target_key)
        if target_key:
            eff_key = target_key

    # 2. Build metadata header
    header_lines = []
    clean_title = title.strip() or "Untitled Track"
    header_lines.append(f"# {clean_title}")
    if artist.strip():
        header_lines.append(f"**Artist:** {artist.strip()}")

    if eff_key:
        if semitones != 0 and estimated_key and estimated_key != eff_key:
            header_lines.append(f"**Key:** {eff_key} (Transposed from {estimated_key})")
        else:
            header_lines.append(f"**Key:** {eff_key}")
    else:
        if semitones != 0:
            shift_note = f"+{semitones}" if semitones > 0 else f"{semitones}"
            header_lines.append(f"**Key:** Standard ({shift_note} semitones)")
        else:
            header_lines.append("**Key:** Standard / Not specified")

    if semitones > 0:
        header_lines.append(f"**Pitch Shift:** +{semitones} semitones")
    elif semitones < 0:
        header_lines.append(f"**Pitch Shift:** {semitones} semitones")
    else:
        header_lines.append("**Pitch Shift:** Original key (0 semitones)")

    header_lines.append("")
    header_lines.append("---")
    header_lines.append("")

    # 3. Sort lines and chords chronologically
    sorted_lines = sorted(lines, key=lambda ln: float(ln.get("start_time", 0.0))) if lines else []
    sorted_chords = (
        sorted(transposed_chords, key=lambda c: float(c.get("start", 0.0)))
        if transposed_chords
        else []
    )

    body_lines: list[str] = []

    def format_instrumental_block(gap_start: float, gap_chords: list[dict[str, Any]]) -> list[str]:
        cleaned_symbols = []
        for c in gap_chords:
            sym = str(c.get("chord", "")).strip()
            if (
                sym
                and sym not in NO_CHORD_VALUES
                and (not cleaned_symbols or cleaned_symbols[-1] != sym)
            ):
                cleaned_symbols.append(sym)
        ts = format_timestamp(gap_start)
        if cleaned_symbols:
            prog_str = " - ".join(cleaned_symbols)
            return [f"{ts}  [Instrumental]", f"            Chords: {prog_str}"]
        else:
            return [f"{ts}  [Instrumental]"]

    # 4. Handle pure instrumental track (no lyric lines)
    if not sorted_lines:
        if sorted_chords:
            chunk: list[dict[str, Any]] = []
            chunk_start = float(sorted_chords[0].get("start", 0.0))
            last_end = chunk_start
            for c in sorted_chords:
                c_start = float(c.get("start", 0.0))
                c_end = float(c.get("end", c_start + 1.0))
                if c_start - last_end > 4.0 or len(chunk) >= 8:
                    if chunk:
                        body_lines.extend(format_instrumental_block(chunk_start, chunk))
                        body_lines.append("")
                    chunk = [c]
                    chunk_start = c_start
                else:
                    chunk.append(c)
                last_end = c_end
            if chunk:
                body_lines.extend(format_instrumental_block(chunk_start, chunk))
        else:
            body_lines.append("[No lyric lines or chords available]")
    else:
        # 5. Check Intro chords before first lyric line
        first_line_start = float(sorted_lines[0].get("start_time", 0.0))
        intro_chords = [c for c in sorted_chords if float(c.get("end", 0.0)) <= first_line_start]
        if intro_chords:
            body_lines.extend(
                format_instrumental_block(float(intro_chords[0].get("start", 0.0)), intro_chords)
            )
            body_lines.append("")

        # 6. Iterate through lyric lines and inter-line gaps
        for i, line in enumerate(sorted_lines):
            l_start = float(line.get("start_time", 0.0))
            l_end = float(line.get("end_time", l_start + 1.0))

            # Inter-line instrumental gap check
            if i > 0:
                prev_end = float(sorted_lines[i - 1].get("end_time", 0.0))
                if l_start - prev_end >= 2.0:
                    gap_chords = [
                        c
                        for c in sorted_chords
                        if float(c.get("start", 0.0)) >= prev_end - 0.1
                        and float(c.get("end", 0.0)) <= l_start + 0.1
                    ]
                    if gap_chords:
                        body_lines.extend(
                            format_instrumental_block(
                                float(gap_chords[0].get("start", 0.0)), gap_chords
                            )
                        )
                        body_lines.append("")

            # Find chords active during this lyric line
            line_chords = [
                c
                for c in sorted_chords
                if float(c.get("start", 0.0)) < l_end and float(c.get("end", 0.0)) > l_start
            ]
            text = str(line.get("text", "")).strip()
            raw_words = line.get("words", [])
            words = raw_words if isinstance(raw_words, list) else []
            valid_chords = [
                c
                for c in line_chords
                if c.get("chord") and str(c.get("chord")).strip() not in NO_CHORD_VALUES
            ]

            ts = format_timestamp(l_start)
            prefix_spaces = " " * (len(ts) + 2)

            if not valid_chords:
                body_lines.append(f"{ts}  {text}")
            else:
                # Word character span mapping
                word_spans = []
                curr = 0
                for w in words:
                    if not isinstance(w, dict):
                        continue
                    w_text = str(w.get("word", ""))
                    if not w_text:
                        continue
                    idx = text.find(w_text, curr)
                    if idx != -1:
                        word_spans.append(
                            {
                                "word": w_text,
                                "char_start": idx,
                                "start_time": float(w.get("start_time", l_start)),
                            }
                        )
                        curr = idx + len(w_text)

                chord_placements = []
                for c in valid_chords:
                    c_sym = str(c.get("chord", "")).strip()
                    c_start = float(c.get("start", 0.0))
                    target_char = 0
                    if word_spans and c_start > l_start:
                        best_w = min(word_spans, key=lambda w: abs(w["start_time"] - c_start))
                        target_char = best_w["char_start"]
                    elif not word_spans and c_start > l_start:
                        dur = max(0.1, l_end - l_start)
                        ratio = min(1.0, max(0.0, (c_start - l_start) / dur))
                        target_char = int(ratio * len(text))
                        m = re.search(r"\S+", text[target_char:])
                        if m:
                            target_char += m.start()
                    chord_placements.append((target_char, c_sym))

                chord_placements.sort(key=lambda x: x[0])
                buf: list[str] = []
                for pos, sym in chord_placements:
                    if len(buf) < pos:
                        buf.extend([" "] * (pos - len(buf)))
                    elif len(buf) > pos:
                        buf.append(" ")
                    buf.extend(list(sym))

                chord_str = "".join(buf)
                body_lines.append(f"{ts}  {chord_str}")
                body_lines.append(f"{prefix_spaces}{text}")

            body_lines.append("")

        # 7. Check Outro chords after final lyric line
        last_line_end = float(sorted_lines[-1].get("end_time", 0.0))
        outro_chords = [
            c for c in sorted_chords if float(c.get("start", 0.0)) >= last_line_end - 0.2
        ]
        if outro_chords:
            body_lines.extend(
                format_instrumental_block(float(outro_chords[0].get("start", 0.0)), outro_chords)
            )
            body_lines.append("")

    full_md = "\n".join(header_lines) + "```\n" + "\n".join(body_lines).rstrip() + "\n```\n"
    return full_md


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
        None, description="Optional primary (sung) ASS or CSS hex color override"
    ),
    secondary_color: str | None = Query(
        None, description="Optional secondary (unsung) ASS or CSS hex color override"
    ),
    font_size_scale: float = Query(
        1.0, ge=0.5, le=3.0, description="Font size scale factor (0.5 to 3.0)"
    ),
    include_countdown: bool = Query(
        True, description="Include instrumental gap countdown cues in generated .ass script"
    ),
    include_chords: bool = Query(
        False, description="Include transposed chord progression cues in generated .ass script"
    ),
    semitones: int = Query(
        0,
        ge=-12,
        le=12,
        description="Pitch shift in semitones for chord transposition (-12 to +12)",
    ),
    sync_mode: str = Query(
        "word",
        description="Lyric synchronization mode: 'word' or 'line'",
    ),
    singer2_color: str | None = Query(
        None, description="Optional Singer 2 sung color (CSS hex or ASS) for duet lines"
    ),
    both_color: str | None = Query(
        None, description="Optional sung color (CSS hex or ASS) for lines sung by both singers"
    ),
):
    """Export synchronized Advanced SubStation Alpha (.ass) subtitles for a project.

    Supports aspect ratios ('16:9' or '9:16'), visual theme presets, progressive \\kf tags,
    line-by-line illumination mode, font size scaling, direct color overrides,
    and optional transposed chords on Layer 2.
    Does NOT require prior video rendering.
    """
    import backend.main as main_mod

    proj = get_project_or_404(project_id)

    # 1. Validate sync_mode
    clean_sync_mode = str(sync_mode or "word").strip().lower()
    if clean_sync_mode not in ("word", "line"):
        raise HTTPException(
            status_code=400,
            detail="Invalid sync_mode. Must be 'word' or 'line'",
        )

    # 2. Validate aspect_ratio
    if aspect_ratio not in ("16:9", "9:16"):
        raise HTTPException(
            status_code=400,
            detail="Invalid aspect ratio. Must be '16:9' or '9:16'",
        )

    # 3. Validate theme_id if provided
    if theme_id is not None and theme_id not in VISUAL_THEMES:
        allowed_themes = list(VISUAL_THEMES.keys())
        raise HTTPException(
            status_code=400,
            detail=f"Invalid theme_id '{theme_id}'. Must be one of: {allowed_themes}",
        )

    # 4. Pre-flight check: Active processing without lyrics cannot export
    if proj.get("status") in BUSY_PIPELINE_STATES and not proj.get("lines"):
        raise HTTPException(
            status_code=400,
            detail="Project lyrics are not ready for export",
        )

    lines = proj.get("lines")
    chords = chords_for_export(project_id, include_chords)

    if (not lines or not isinstance(lines, list)) and (not include_chords or not chords):
        raise HTTPException(status_code=400, detail="Project has no lyric lines to export")

    title = proj.get("title", "").strip()
    artist = proj.get("artist", "").strip()
    track_title = (
        f"{artist} - {title}" if (artist and title) else (title or artist or "Karaoke Track")
    )

    # Empty colours count as not chosen: the stage look's (or the default) applies. The
    # duet colours come from the stage look panel.
    ass_content = main_mod.video_renderer.generate_ass_content(
        lines=lines or [],
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color or None,
        secondary_color=secondary_color or None,
        singer2_color=singer2_color or None,
        both_color=both_color or None,
        title=track_title,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        chords=chords,
        include_chords=include_chords,
        semitones=semitones,
        key=estimated_key(proj),
        sync_mode=clean_sync_mode,
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


@router.get("/api/project/{project_id}/export/chord-sheet")
def export_project_chord_sheet(
    project_id: str,
    semitones: int = Query(
        0,
        ge=-12,
        le=12,
        description="Semitone transposition offset in [-12, +12]",
    ),
):
    """Export project lyric lines and chords as a downloadable Chord & Lyric Sheet in Markdown.

    Transposes chords across [-12, +12] with circle-of-fifths key projection,
    aligns chord symbols above corresponding lyric lines and words, emits clean
    [Instrumental] blocks for non-vocal sections, and encodes compliant RFC 5987 /
    RFC 6266 Content-Disposition headers.
    """
    proj = get_project_or_404(project_id)

    lines = proj.get("lines")

    # 1. The stored chords, else detected now; without any audio the sheet has lyrics only
    try:
        chords = ensure_chords(project_id)
    except StemMissing:
        chords = []
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to detect chords: {e}") from e

    # 2. Reject export if neither lyrics nor chords exist
    if (not lines or not isinstance(lines, list)) and (not chords):
        raise HTTPException(
            status_code=400,
            detail="Project has no lyric lines or chords to export",
        )

    title = proj.get("title", "").strip()
    artist = proj.get("artist", "").strip()
    # 3. Generate lead sheet content
    sheet_content = generate_chord_sheet(
        lines=lines or [],
        chords=chords or [],
        title=title,
        artist=artist,
        estimated_key=estimated_key(proj),
        semitones=semitones,
    )

    # 4. Formulate RFC 5987 / RFC 6266 filename header
    raw_title = title or "Track"
    chord_title = f"{raw_title} (Chords)".strip() if "chord" not in raw_title.lower() else raw_title

    headers = {
        "Content-Disposition": build_content_disposition(
            title=chord_title,
            artist=artist,
            ext="md",
            fallback=f"{project_id}_chords",
        )
    }

    return Response(
        content=sheet_content,
        media_type="text/markdown; charset=utf-8",
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
