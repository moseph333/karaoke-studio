"""Writes a song's Advanced SubStation Alpha (.ass) subtitle file in one of the stage looks:
the words filled as they are sung (\\kf), in a 16:9 or a 9:16 frame, with the look's title
cards, count-in, break marker, part names and progress line.

This is the entry the render worker and the subtitle download use. resolve_look_style
(ass_style) decides the look from the request; generate_look_ass (ass_look) draws it."""

from pathlib import Path
from typing import Any

from backend.services.ass_document import (
    BACKSLASH_GUARD,
    css_to_ass_color,
    escape_ass_text,
    format_ass_time,
    safe_time,
    to_css_color,
)
from backend.services.ass_look import generate_look_ass, look_fonts
from backend.services.ass_style import clean_style_config, resolve_look_style, resolve_sync_mode
from backend.services.stage_timing import (
    COUNTDOWN_LEAD_IN_SECONDS,
    GAP_LABEL_DELAY_SECONDS,
    INSTRUMENTAL_GAP_THRESHOLD_SECONDS,
    OUTRO_DELAY_SECONDS,
    OUTRO_MIN_SECONDS,
    instrumental_gaps,
    line_span,
    singer_part,
)

# The names other modules and the tests import from here, wherever they are defined
__all__ = [
    "BACKSLASH_GUARD",
    "COUNTDOWN_LEAD_IN_SECONDS",
    "GAP_LABEL_DELAY_SECONDS",
    "INSTRUMENTAL_GAP_THRESHOLD_SECONDS",
    "OUTRO_DELAY_SECONDS",
    "OUTRO_MIN_SECONDS",
    "card_names",
    "clean_style_config",
    "css_to_ass_color",
    "escape_ass_text",
    "export_fonts",
    "export_title",
    "format_ass_time",
    "generate_ass",
    "generate_ass_content",
    "generate_ass_subtitles",
    "generate_karaoke_ass",
    "instrumental_gaps",
    "line_span",
    "resolve_look_style",
    "resolve_sync_mode",
    "safe_time",
    "singer_part",
    "to_css_color",
]

# Placeholders a song without a known artist carries, which no card should show
_NO_ARTIST = frozenset({"", "unknown artist", "artist"})


def export_title(proj: dict) -> str:
    """The title an export carries (the subtitle file's own title): "Artist - Title", or
    whichever of the two the song has."""
    title = str(proj.get("title") or "").strip()
    artist = str(proj.get("artist") or "").strip()
    return f"{artist} - {title}" if (artist and title) else (title or artist or "Karaoke Track")


def card_names(proj: dict) -> tuple[str, str]:
    """The title and artist a video's cards show; an artist that is only a placeholder
    ("Unknown Artist") is left out."""
    title = " ".join(str(proj.get("title") or "").split())
    artist = " ".join(str(proj.get("artist") or "").split())
    return title, ("" if artist.lower() in _NO_ARTIST else artist)


def generate_ass_content(
    lines: list[dict[str, Any]],
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    title: str = "",
    style_config: dict[str, Any] | None = None,
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    chords: list[dict[str, Any]] | None = None,
    include_chords: bool = False,
    semitones: int = 0,
    key: str | None = None,
    sync_mode: str = "word",
    song_duration: float | None = None,
    *,
    card_title: str | None = None,
    card_artist: str | None = None,
    part_names: dict[str, str] | None = None,
    frame: str = "video",
) -> str:
    """The subtitle file of ``lines`` in the look the request asks for (``theme_id``, a look's
    id or the id of a preset a look replaced).

    resolve_look_style decides between the arguments, ``style_config`` and the look. ``title``
    is the file's own title; the cards show ``card_title`` and ``card_artist`` (the title
    alone when neither is given). ``song_duration`` is the song's length, which the end card
    and the progress line need. Chords are drawn when ``include_chords`` (or style_config's)
    says so, transposed by ``semitones``. ``part_names`` are the song's own names for its
    parts. ``frame`` "subtitles" is the plain download, without the progress line.
    """
    style = resolve_look_style(
        style_config=style_config,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        singer2_color=singer2_color,
        both_color=both_color,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        sync_mode=sync_mode,
        part_names=part_names,
        frame=frame,
    )
    given = clean_style_config(style_config)
    chords_enabled = bool(given["include_chords"]) if "include_chords" in given else include_chords
    if "semitones" in given:
        semitones = int(given["semitones"])
    if chords is None:
        chords = given.get("chords")
    if key is None:
        key = given.get("key")
    if card_title is None and card_artist is None:
        card_title = title
    return generate_look_ass(
        lines,
        style,
        title=str(card_title or ""),
        artist=str(card_artist or ""),
        doc_title=title,
        duration=song_duration,
        chords=chords if chords_enabled and isinstance(chords, list) else None,
        semitones=semitones,
        key=key,
    )


def export_fonts(
    style_config: dict[str, Any] | None = None,
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
) -> list[str]:
    """The font files the subtitle file of this request needs, which a cloud render must
    hold."""
    return look_fonts(resolve_look_style(style_config, aspect_ratio, theme_id))


def generate_ass_subtitles(
    lines: list[dict[str, Any]],
    output_ass_path: Path,
    style_config: dict[str, Any] | None = None,
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    title: str = "",
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    chords: list[dict[str, Any]] | None = None,
    include_chords: bool = False,
    semitones: int = 0,
    key: str | None = None,
    sync_mode: str = "word",
    song_duration: float | None = None,
    *,
    card_title: str | None = None,
    card_artist: str | None = None,
    part_names: dict[str, str] | None = None,
    frame: str = "video",
) -> str:
    """Writes generate_ass_content's file to ``output_ass_path`` and returns the path."""
    content = generate_ass_content(
        lines=lines,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        singer2_color=singer2_color,
        both_color=both_color,
        title=title,
        style_config=style_config,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        chords=chords,
        include_chords=include_chords,
        semitones=semitones,
        key=key,
        sync_mode=sync_mode,
        song_duration=song_duration,
        card_title=card_title,
        card_artist=card_artist,
        part_names=part_names,
        frame=frame,
    )
    output_ass_path.write_text(content, encoding="utf-8")
    return str(output_ass_path)


# Backward-compatible aliases
generate_ass = generate_ass_subtitles
generate_karaoke_ass = generate_ass_content
