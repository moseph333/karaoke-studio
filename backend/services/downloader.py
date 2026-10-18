"""YouTube audio extraction and search service wrapping yt-dlp to query tracks, download audio streams, and extract metadata and thumbnails."""

import logging
import re
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
import yt_dlp

from backend.config import DOWNLOADS_DIR

logger = logging.getLogger(__name__)


class TrackDownloader:
    def __init__(self, output_dir: Path = DOWNLOADS_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def search_tracks(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Search YouTube/YouTube Music for tracks."""
        if not query or not query.strip():
            return []

        bounded_limit = max(1, min(limit, 50))
        ydl_opts = {
            "default_search": f"ytsearch{bounded_limit}:",
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(query.strip(), download=False)
                if not info or "entries" not in info:
                    return []

                results = []
                for entry in info["entries"]:
                    if not entry:
                        continue
                    results.append(
                        {
                            "id": entry.get("id"),
                            "title": entry.get("title"),
                            "artist": entry.get("uploader")
                            or entry.get("channel")
                            or "Unknown Artist",
                            "duration": entry.get("duration", 0),
                            "url": f"https://www.youtube.com/watch?v={entry.get('id')}",
                            "thumbnail": entry.get("thumbnail")
                            or (
                                entry.get("thumbnails", [{}])[-1].get("url")
                                if entry.get("thumbnails")
                                else None
                            ),
                        }
                    )
                return results
        except Exception as e:
            logger.warning(f"Error during YouTube search for query '{query}': {e}")
            return []

    @staticmethod
    def extract_video_id(url_or_id: str | None) -> str | None:
        """
        Reliably extracts an 11-character YouTube video ID.
        Supports:
          - Raw 11-char IDs (e.g. 'dQw4w9WgXcQ')
          - Standard watch URLs ('/watch?v=...') even with arbitrary query/tracking params or playlists
          - YouTube Shorts ('/shorts/<id>')
          - Shortlinks ('youtu.be/<id>')
          - Embedded URLs ('/embed/<id>')
          - Mobile / Music / No-cookie YouTube subdomains
        Returns None for non-YouTube URLs or malformed IDs.
        """
        if not url_or_id or not isinstance(url_or_id, str):
            return None

        clean_input = url_or_id.strip()
        if not clean_input:
            return None

        # 1. Bare 11-character ID check
        if re.fullmatch(r"^[0-9A-Za-z_-]{11}$", clean_input):
            return clean_input

        # 2. Parse URL structure
        candidate = clean_input
        if not candidate.startswith(("http://", "https://")):
            candidate = "https://" + candidate

        try:
            parsed = urlparse(candidate)
            hostname = (parsed.hostname or "").lower()

            is_youtube_host = (
                hostname == "youtu.be"
                or hostname == "youtube.com"
                or hostname.endswith(".youtube.com")
                or hostname.endswith(".youtube-nocookie.com")
            )
            if not is_youtube_host:
                return None

            # Handle youtu.be/<id>
            if hostname == "youtu.be":
                parts = [p for p in parsed.path.split("/") if p]
                if parts and re.fullmatch(r"^[0-9A-Za-z_-]{11}$", parts[0]):
                    return parts[0]
                return None

            # Handle youtube.com (standard, mobile, music, nocookie)
            path = parsed.path.rstrip("/")
            if path == "/watch":
                qs = parse_qs(parsed.query)
                v_list = qs.get("v")
                if v_list and re.fullmatch(r"^[0-9A-Za-z_-]{11}$", v_list[0]):
                    return v_list[0]
            elif path.startswith("/shorts/"):
                parts = [p for p in path.split("/") if p]
                if (
                    len(parts) >= 2
                    and parts[0] == "shorts"
                    and re.fullmatch(r"^[0-9A-Za-z_-]{11}$", parts[1])
                ):
                    return parts[1]
            elif path.startswith("/embed/"):
                parts = [p for p in path.split("/") if p]
                if (
                    len(parts) >= 2
                    and parts[0] == "embed"
                    and re.fullmatch(r"^[0-9A-Za-z_-]{11}$", parts[1])
                ):
                    return parts[1]
            elif path.startswith("/v/"):
                parts = [p for p in path.split("/") if p]
                if (
                    len(parts) >= 2
                    and parts[0] == "v"
                    and re.fullmatch(r"^[0-9A-Za-z_-]{11}$", parts[1])
                ):
                    return parts[1]
            elif path.startswith("/live/"):
                parts = [p for p in path.split("/") if p]
                if (
                    len(parts) >= 2
                    and parts[0] == "live"
                    and re.fullmatch(r"^[0-9A-Za-z_-]{11}$", parts[1])
                ):
                    return parts[1]

        except Exception:
            return None

        return None

    def extract_info_and_download(self, url_or_id: str, progress_hook=None) -> dict[str, Any]:
        """Download audio and thumbnail from YouTube/YouTube Music."""
        if not url_or_id or not str(url_or_id).strip():
            raise ValueError("URL or video ID cannot be empty")

        url_or_id = str(url_or_id).strip()
        video_id = self.extract_video_id(url_or_id)
        wav_path = self.output_dir / f"{video_id}.wav" if video_id else None

        # Check for existing local cached audio (non-empty)
        if wav_path and wav_path.is_file() and wav_path.stat().st_size > 0:
            logger.info(f"Local audio file already cached for {video_id}, skipping download.")
            thumb_path = None
            for ext in ["webp", "jpg", "jpeg", "png"]:
                candidate = self.output_dir / f"{video_id}.{ext}"
                if candidate.is_file() and candidate.stat().st_size > 0:
                    thumb_path = candidate
                    break

            # Metadata fallback defaults (never hardcoded song titles)
            fallback_title = f"Track {video_id}" if video_id else "Track"
            title = fallback_title
            artist = "Unknown Artist"
            duration = 0

            try:
                ydl_opts_meta = {
                    "skip_download": True,
                    "quiet": True,
                    "no_warnings": True,
                    "extractor_args": {
                        "youtube": {
                            "player_client": ["ios", "android", "mweb"],
                        }
                    },
                }
                with yt_dlp.YoutubeDL(ydl_opts_meta) as ydl:
                    meta = ydl.extract_info(url_or_id, download=False)
                    if meta:
                        title = meta.get("title") or title
                        artist = meta.get("artist") or meta.get("uploader") or artist
                        duration = meta.get("duration", 0)
            except Exception as e:
                logger.warning(
                    f"Could not refresh metadata online for cached track {video_id}, using fallback: {e}"
                )

            clean_title = title
            clean_artist = artist
            if " - " in title:
                parts = title.split(" - ", 1)
                clean_artist = parts[0].strip()
                clean_title = re.sub(
                    r"[\(\[\{].*?(official|audio|video|lyrics|hd|4k|hq).*?[\)\]\}]",
                    "",
                    parts[1],
                    flags=re.I,
                ).strip()

            return {
                "id": video_id,
                "title": clean_title,
                "raw_title": title,
                "artist": clean_artist,
                "duration": duration,
                "audio_path": str(wav_path),
                "thumbnail_path": str(thumb_path) if thumb_path else None,
                "thumbnail_url": f"/static/downloads/{thumb_path.name}" if thumb_path else None,
                "url": url_or_id
                if (url_or_id.startswith("http://") or url_or_id.startswith("https://"))
                else f"https://www.youtube.com/watch?v={video_id}",
            }

        # Normalize download URL
        if video_id:
            url = f"https://www.youtube.com/watch?v={video_id}"
        elif url_or_id.startswith("http://") or url_or_id.startswith("https://"):
            url = url_or_id
        else:
            url = f"https://www.youtube.com/watch?v={url_or_id}"

        ydl_opts = {
            "format": "bestaudio/ba/b[height<=?720]/b",
            "outtmpl": str(self.output_dir / "%(id)s.%(ext)s"),
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                }
            ],
            "writethumbnail": True,
            "quiet": True,
            "no_warnings": True,
        }

        if progress_hook:
            ydl_opts["progress_hooks"] = [progress_hook]

        client_profiles = [
            ["ios", "android", "mweb"],
            ["android"],
            ["web"],
        ]

        meta = None
        attempt_errors: list[str] = []
        last_err: Exception | None = None

        for clients in client_profiles:
            ydl_opts["extractor_args"] = {"youtube": {"player_client": clients}}
            try:
                logger.info(f"Attempting download with client profile: {clients}")
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    meta = ydl.extract_info(url, download=True)
                    if meta:
                        logger.info(f"Download succeeded with client profile: {clients}")
                        break
            except Exception as e:
                err_msg = f"Profile {clients} failed: {e}"
                logger.warning(err_msg)
                attempt_errors.append(err_msg)
                last_err = e

        if not meta:
            summary = "; ".join(attempt_errors) if attempt_errors else "unknown error"
            raise RuntimeError(
                f"Failed to extract/download video from '{url}' across all client profiles. Errors: {summary}"
            ) from last_err

        v_id = meta.get("id") or video_id
        title = meta.get("title") or "Unknown Track"
        artist = meta.get("artist") or meta.get("uploader") or "Unknown Artist"
        duration = meta.get("duration", 0)

        # Audio file path
        final_wav = self.output_dir / f"{v_id}.wav"
        if not final_wav.exists() or final_wav.stat().st_size == 0:
            raise RuntimeError(f"Expected extracted audio file not found or empty: {final_wav}")

        # Find downloaded thumbnail
        thumb_path = None
        for ext in ["webp", "jpg", "jpeg", "png"]:
            candidate = self.output_dir / f"{v_id}.{ext}"
            if candidate.is_file() and candidate.stat().st_size > 0:
                thumb_path = candidate
                break

        if not thumb_path and meta.get("thumbnail"):
            thumb_candidate = self.output_dir / f"{v_id}.jpg"
            try:
                res = requests.get(meta.get("thumbnail"), timeout=10)
                if res.status_code == 200 and len(res.content) > 0:
                    thumb_candidate.write_bytes(res.content)
                    thumb_path = thumb_candidate
            except Exception as e:
                logger.warning(f"Could not download thumbnail directly: {e}")

        clean_title = title
        clean_artist = artist
        if " - " in title:
            parts = title.split(" - ", 1)
            clean_artist = parts[0].strip()
            clean_title = re.sub(
                r"[\(\[\{].*?(official|audio|video|lyrics|hd|4k|hq).*?[\)\]\}]",
                "",
                parts[1],
                flags=re.I,
            ).strip()

        return {
            "id": v_id,
            "title": clean_title,
            "raw_title": title,
            "artist": clean_artist,
            "duration": duration,
            "audio_path": str(final_wav),
            "thumbnail_path": str(thumb_path) if thumb_path else None,
            "thumbnail_url": meta.get("thumbnail"),
            "url": url,
        }
