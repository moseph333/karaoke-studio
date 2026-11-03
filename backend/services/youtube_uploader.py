"""YouTube metadata kit generator: the title, description, tags and chapter markers for a rendered karaoke video, kept within YouTube's limits."""

import logging
import math
from typing import Any

from backend.config import YOUTUBE_CLIENT_SECRETS_FILE
from backend.services.ass_generator import (
    COUNTDOWN_LEAD_IN_SECONDS,
    INSTRUMENTAL_GAP_THRESHOLD_SECONDS,
    instrumental_gaps,
    line_span,
    safe_time,
)

logger = logging.getLogger(__name__)

# YouTube's limits. A title holds 100 characters. Tags hold 500 characters in all, counting
# a comma between tags and the quotes YouTube puts around a tag with a space. Chapters show
# only when there are at least 3, the first starts at 00:00 and each lasts 10 s or more.
_TITLE_LIMIT = 100
_TITLE_SUFFIXES = (" (Karaoke Version / With Lyrics)", " (Karaoke Version)", " (Karaoke)")
_TAGS_LIMIT = 500
_MIN_CHAPTER_SEC = 10
_MIN_CHAPTERS = 3
_CHAPTER_NAME_CHARS = 40
_PLACEHOLDER_ARTISTS = frozenset({"unknown artist", "unknown", "artist"})
_PLACEHOLDER_TITLE = "Karaoke Track"


def _collapse(text: Any) -> str:
    return " ".join(str(text or "").split())


def _credited_artist(artist: str) -> str:
    """The artist to name in the title, tags and description: '' for a blank or placeholder
    artist."""
    name = artist.strip()
    return "" if name.casefold() in _PLACEHOLDER_ARTISTS else name


def _video_title(artist: str, title: str) -> str:
    """'Artist - Title' plus the longest suffix that fits in YouTube's 100 characters. When
    even ' (Karaoke)' does not fit, the song's name is cut short and ends with '…'."""
    credited = _credited_artist(artist)
    song = title or _PLACEHOLDER_TITLE
    base = f"{credited} - {song}" if credited else song
    for suffix in _TITLE_SUFFIXES:
        if len(base) + len(suffix) <= _TITLE_LIMIT:
            return base + suffix
    shortest = _TITLE_SUFFIXES[-1]
    return base[: _TITLE_LIMIT - len(shortest) - 1].rstrip() + "…" + shortest


def _tag_length(tags: list[str]) -> int:
    """The length YouTube counts against its 500-character tag limit."""
    commas = max(0, len(tags) - 1)
    return commas + sum(len(tag) + 2 if " " in tag else len(tag) for tag in tags)


def _tags(artist: str, title: str) -> list[str]:
    """The search tags: no empty or repeated tag, and within YouTube's 500 characters (a tag
    that would go over is left out)."""
    credited = _credited_artist(artist).lower()
    song = title.lower()
    candidates = [
        "karaoke",
        "karaoke version",
        "instrumental",
        "lyrics",
        "sing along",
        credited,
        song,
        f"{credited} karaoke" if credited else "",
        f"{song} karaoke" if song else "",
        "backing track",
        "karaoke with lyrics",
    ]
    tags: list[str] = []
    for candidate in candidates:
        tag = _collapse(candidate)
        if tag and tag not in tags and _tag_length([*tags, tag]) <= _TAGS_LIMIT:
            tags.append(tag)
    return tags


def _timestamp(seconds: int) -> str:
    """MM:SS, or H:MM:SS from one hour on."""
    hours, rest = divmod(seconds, 3600)
    minutes, secs = divmod(rest, 60)
    return f"{hours}:{minutes:02d}:{secs:02d}" if hours else f"{minutes:02d}:{secs:02d}"


def _section_name(line: dict) -> str:
    """A chapter's name: its first line, cut to 40 characters."""
    name = _collapse(line.get("text")) or "Vocals"
    if len(name) > _CHAPTER_NAME_CHARS:
        name = name[: _CHAPTER_NAME_CHARS - 1].rstrip() + "…"
    return name


def youtube_chapters(lines: Any, duration: Any = None) -> list[str]:
    """The video's chapter markers ('MM:SS - name'), or [] when YouTube would not show them.

    A chapter starts with the song's first line and after every instrumental gap (the
    countdown's rule, ass_generator.instrumental_gaps), when that line's countdown starts, and
    is named by that line. A long wait before the first line gets an Intro, and one after the
    last line an Outro. A section starting less than 10 s after the chapter before joins that
    chapter, and a last chapter shorter than 10 s is dropped.
    """
    if not isinstance(lines, list):
        return []
    indexes = [i for i, line in enumerate(lines) if isinstance(line, dict)]
    if not indexes:
        return []
    last_end = max(line_span(lines[i])[1] for i in indexes)
    song_end = max(safe_time(duration), last_end)

    marks: list[tuple[int, str]] = []
    for i in sorted({indexes[0], *instrumental_gaps(lines)}):
        start, _ = line_span(lines[i])
        marks.append((int(max(0.0, start - COUNTDOWN_LEAD_IN_SECONDS)), _section_name(lines[i])))
    if marks[0][0] >= _MIN_CHAPTER_SEC:
        marks.insert(0, (0, "Intro"))
    else:
        marks[0] = (0, marks[0][1])
    if song_end - last_end >= INSTRUMENTAL_GAP_THRESHOLD_SECONDS:
        marks.append((math.ceil(last_end), "Outro"))

    chapters: list[tuple[int, str]] = []
    for at, name in marks:
        if not chapters or at - chapters[-1][0] >= _MIN_CHAPTER_SEC:
            chapters.append((at, name))
    if song_end - chapters[-1][0] < _MIN_CHAPTER_SEC:
        chapters.pop()
    if len(chapters) < _MIN_CHAPTERS:
        return []
    return [f"{_timestamp(at)} - {name}" for at, name in chapters]


class YouTubeMetadataService:
    @staticmethod
    def generate_youtube_package(
        title: str,
        artist: str,
        lines: list[dict[str, Any]],
        semitones: int = 0,
        has_guide_vocal: bool = False,
        duration: float | None = None,
    ) -> dict[str, Any]:
        """
        Creates SEO-optimized metadata and description for YouTube upload.
        """
        title = str(title or "").strip()
        artist = str(artist or "").strip()
        song = title or _PLACEHOLDER_TITLE
        # An unknown artist is left out rather than credited as "Unknown Artist" or nobody
        credited = _credited_artist(artist)
        originally_by = f" originally by {credited}" if credited else ""
        artist_bullet = f"• Original Artist: {credited}\n" if credited else ""
        key_note = f"Key: {'Original Key' if semitones == 0 else f'{semitones:+d} Semitones'}"
        vocal_type = (
            "Instrumental with Backing/Guide" if has_guide_vocal else "Instrumental Backing Track"
        )

        # Build clean lyrics text
        dict_lines = (
            [line for line in lines if isinstance(line, dict)] if isinstance(lines, list) else []
        )
        lyric_lines = [str(line.get("text") or "").strip() for line in dict_lines]
        lyrics_text = "\n".join(text for text in lyric_lines if text)

        chapters = youtube_chapters(lines, duration)
        timestamps = f"🕒 Timestamps:\n{chr(10).join(chapters)}\n\n" if chapters else ""

        description = (
            f'Sing along to "{song}"{originally_by}!\n\n'
            f"🎵 Details:\n"
            f"• Song: {song}\n"
            f"{artist_bullet}"
            f"• {key_note}\n"
            f"• Type: {vocal_type}\n\n"
            f"{timestamps}"
            f"📜 Lyrics:\n"
            f"{lyrics_text}\n\n"
            f"-----------------------------------------\n"
            f"Created with Karaoke Studio.\n"
            f"All rights belong to their respective copyright holders."
        )

        return {
            "title": _video_title(artist, title),
            "description": description,
            "tags": _tags(artist, title),
            "key_note": key_note,
            "lyrics": lyrics_text,
            "privacy_status": "unlisted",
        }

    @staticmethod
    def is_oauth_configured() -> bool:
        return YOUTUBE_CLIENT_SECRETS_FILE.exists()
