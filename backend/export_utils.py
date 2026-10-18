"""Utilities for sanitizing export filenames, encoding RFC 6266 / RFC 5987 Content-Disposition headers, and subtitle export formatting."""

import re
import unicodedata
from urllib.parse import quote


def sanitize_export_filename(
    title: str = "",
    artist: str = "",
    fallback: str = "karaoke",
    ascii_only: bool = False,
) -> str:
    """Sanitize track title and artist into a safe filename stem for downloads.

    If ascii_only is True, transliterates Latin diacritics to ASCII base characters
    and strips non-ASCII code points (falling back to an ASCII-sanitized fallback
    or 'karaoke' if no ASCII characters remain).
    If ascii_only is False, preserves UTF-8 Unicode characters while stripping
    filesystem-unsafe and header-control characters.
    """
    if artist and title:
        raw = f"{artist} - {title}".strip()
    elif title:
        raw = title.strip()
    elif artist:
        raw = artist.strip()
    else:
        raw = fallback.strip()

    if ascii_only:
        normalized = unicodedata.normalize("NFKD", raw)
        ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
        cleaned = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "_", ascii_text)
        cleaned = re.sub(r"[^\x20-\x7E]", "_", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._-")
        if not cleaned:
            fb_norm = (
                unicodedata.normalize("NFKD", fallback).encode("ascii", "ignore").decode("ascii")
            )
            fb_cleaned = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "_", fb_norm)
            fb_cleaned = re.sub(r"[^\x20-\x7E]", "_", fb_cleaned)
            fb_cleaned = re.sub(r"\s+", " ", fb_cleaned).strip(" ._-")
            cleaned = fb_cleaned or "karaoke"
        return cleaned
    else:
        cleaned = re.sub(r'[\r\n"\\/:*?<>|\x00-\x1f\x7f]', "_", raw)
        cleaned = re.sub(r"\s+", " ", cleaned).strip(" ._")
        return cleaned or fallback


def build_content_disposition(
    title: str = "",
    artist: str = "",
    ext: str = "lrc",
    fallback: str = "karaoke",
    disposition_type: str = "attachment",
) -> str:
    """Build an RFC 6266 / RFC 5987 compliant Content-Disposition header value.

    Provides a 7-bit US-ASCII filename parameter for legacy/Starlette header compliance
    and a filename*=UTF-8'' percent-encoded parameter for RFC 5987 aware clients.
    """
    clean_ext = ext.lstrip(".")
    ascii_stem = sanitize_export_filename(
        title=title, artist=artist, fallback=fallback, ascii_only=True
    )
    utf8_stem = sanitize_export_filename(
        title=title, artist=artist, fallback=fallback, ascii_only=False
    )
    ascii_filename = f"{ascii_stem}.{clean_ext}"
    utf8_filename = f"{utf8_stem}.{clean_ext}"
    encoded_utf8 = quote(utf8_filename, safe="")
    return f"{disposition_type}; filename=\"{ascii_filename}\"; filename*=UTF-8''{encoded_utf8}"
