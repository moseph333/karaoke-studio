"""Song downloads and YouTube search, wrapping yt-dlp: searches YouTube, downloads the audio
(as WAV) and thumbnail of a YouTube, SoundCloud, Bandcamp, Vimeo or Internet Archive link
(see ``media_links``), and reads the title, artist and length the lyric lookup needs."""

import logging
import re
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
import yt_dlp

from backend import config
from backend.config import DOWNLOADS_DIR
from backend.services.lyrics import LyricsNormalizer
from backend.services.media_links import (
    SITE_NAMES,
    MediaLink,
    UnusableLink,
    link_site,
    parse_media_link,
)
from backend.services.song_lookup import fetch_song_info, find_on_youtube

logger = logging.getLogger(__name__)


class DownloadCancelled(RuntimeError):
    """Raised from a progress hook to stop a download the user cancelled."""


def _is_cancel(exc: BaseException | None) -> bool:
    """Whether exc is, or wraps, a DownloadCancelled (yt-dlp may wrap what a progress hook
    raises in a DownloadError that keeps the original in exc_info)."""
    seen: set[int] = set()
    while exc is not None and id(exc) not in seen:
        if isinstance(exc, DownloadCancelled):
            return True
        seen.add(id(exc))
        wrapped = getattr(exc, "exc_info", None)
        inner = wrapped[1] if isinstance(wrapped, tuple) and len(wrapped) > 1 else None
        exc = inner if isinstance(inner, BaseException) else (exc.__cause__ or exc.__context__)
    return False


def music_track_title(meta: dict[str, Any] | None) -> str | None:
    """The song's own name when yt-dlp knows it: YouTube Music, auto-generated "- Topic"
    uploads and many official videos carry ``track`` and ``artist`` fields, which find the
    lyrics far more reliably than a video title like "Artist - Song (Official Video) [4K]"."""
    if not isinstance(meta, dict):
        return None
    track, artist = meta.get("track"), meta.get("artist")
    if isinstance(track, str) and track.strip() and isinstance(artist, str) and artist.strip():
        return track.strip()
    return None


def track_artist(meta: dict[str, Any] | None, fallback: str) -> tuple[str, bool]:
    """The artist yt-dlp reports (an Internet Archive recording names it as its creator),
    else the uploading channel, and whether it is only the channel: a fan upload's channel is
    not the artist, so its title is trusted instead. An uploader that is an email address
    (Internet Archive accounts) is never shown as the artist."""
    if not isinstance(meta, dict):
        return fallback, False
    artist = meta.get("artist")
    if isinstance(artist, str) and artist.strip():
        return artist, False
    creators = meta.get("creators")
    creator = creators[0] if isinstance(creators, list) and creators else meta.get("creator")
    if isinstance(creator, str) and creator.strip():
        return creator, False
    uploader = meta.get("uploader")
    if isinstance(uploader, str) and uploader.strip() and "@" not in uploader:
        return uploader, True
    return fallback, False


def _unfinished_marker(wav_path: Path) -> Path:
    return wav_path.with_name(f"{wav_path.name}.unfinished")


def cached_audio(wav_path: Path | None) -> bool:
    """Whether a finished download is at wav_path. A WAV whose download never finished (the
    server was stopped while FFmpeg wrote it) still has its marker beside it: it holds only
    the start of the song, so it is deleted instead of reused."""
    if wav_path is None:
        return False
    marker = _unfinished_marker(wav_path)
    if marker.exists():
        logger.warning(f"Removing {wav_path.name}: its download never finished")
        wav_path.unlink(missing_ok=True)
        marker.unlink(missing_ok=True)
        return False
    return wav_path.is_file() and wav_path.stat().st_size > 0


@contextmanager
def fresh_download(wav_path: Path | None) -> Iterator[None]:
    """Wraps a download that writes wav_path. yt-dlp's FFmpeg step writes the WAV straight
    to its final name and leaves it there when it fails, and the next request would take
    that file for the whole song. So a marker sits beside the WAV while it is written
    (see cached_audio), and a download that raises takes its partial WAV with it."""
    if wav_path is None:
        yield
        return
    marker = _unfinished_marker(wav_path)
    marker.touch()
    try:
        yield
    except BaseException:
        wav_path.unlink(missing_ok=True)
        marker.unlink(missing_ok=True)
        raise
    marker.unlink(missing_ok=True)


def refuse_unsuitable(info: dict[str, Any] | None, *, incomplete: bool = False) -> None:
    """Refuses a recording that is no song to download: a live stream (yt-dlp would record
    it for as long as it runs) or one longer than MAX_SONG_MINUTES (an hours-long video
    fills the disk). Raises UnusableLink saying why; a length yt-dlp does not know passes.

    Also yt-dlp's ``match_filter``, which it calls with the video's metadata before it
    downloads anything: returning None accepts the video."""
    if not isinstance(info, dict):
        return None
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        raise UnusableLink(
            "That link is a live stream, which has no end to download. "
            "Paste a link to a finished recording of the song."
        )
    limit = config.MAX_SONG_MINUTES
    duration = info.get("duration")
    if (
        limit
        and isinstance(duration, (int, float))
        and not isinstance(duration, bool)
        and duration > limit * 60
    ):
        raise UnusableLink(
            f"That recording is {int(duration // 60)} minutes long. "
            f"The longest this server downloads is {limit} minutes."
        )
    return None


# Matched YouTube uploads a Spotify, Apple Music or TIDAL song tries before giving up
LOOKUP_ATTEMPTS = 3


class TrackDownloader:
    def __init__(self, output_dir: Path = DOWNLOADS_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def search_tracks(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Search YouTube/YouTube Music for tracks; a failed search finds nothing."""
        try:
            return self.search_tracks_or_raise(query, limit)
        except Exception as e:
            logger.warning(f"Error during YouTube search for query '{query}': {e}")
            return []

    def search_tracks_or_raise(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """search_tracks, raising yt-dlp's error when the search itself fails (so a song
        lookup can tell "YouTube did not answer" from "no upload matches")."""
        if not query or not query.strip():
            return []

        bounded_limit = max(1, min(limit, 50))
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": True,
        }
        # The search prefix is always written out. yt-dlp applies a default_search only to
        # input without a URL scheme, so "http://192.168.1.1/" would have been fetched from
        # the server's network, and "scsearch:" or "ytsearchall:" would pick another site or
        # lift the result cap. With the prefix, everything after it is search text.
        search = f"ytsearch{bounded_limit}:{query.strip()}"
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(search, download=False)
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
                        "artist": entry.get("uploader") or entry.get("channel") or "Unknown Artist",
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

    def extract_info_and_download(
        self, url_or_id: str, progress_hook=None, *, file_stem: str | None = None
    ) -> dict[str, Any]:
        """Download the audio and thumbnail of a YouTube video (link or id) or of a song on
        another supported site (see ``media_links``). ``file_stem`` names a YouTube video's
        files (and the returned id) instead of its video id: a song matched from Spotify,
        Apple Music or TIDAL keeps its own files, apart from a song made from the video."""
        if not url_or_id or not str(url_or_id).strip():
            raise ValueError("URL or video ID cannot be empty")

        url_or_id = str(url_or_id).strip()
        if link_site(url_or_id) not in (None, "youtube"):
            link = parse_media_link(url_or_id)
            if link.lookup:
                return self._download_by_lookup(link, progress_hook)
            return self._download_from_site(link, progress_hook)
        video_id = self.extract_video_id(url_or_id)
        stem = file_stem or video_id
        wav_path = self.output_dir / f"{stem}.wav" if stem else None

        # Check for existing local cached audio (non-empty, and downloaded to the end)
        if cached_audio(wav_path):
            logger.info(f"Local audio file already cached for {stem}, skipping download.")
            thumb_path = None
            for ext in ["webp", "jpg", "jpeg", "png"]:
                candidate = self.output_dir / f"{stem}.{ext}"
                if candidate.is_file() and candidate.stat().st_size > 0:
                    thumb_path = candidate
                    break

            # Metadata fallback defaults (never hardcoded song titles)
            fallback_title = f"Track {video_id}" if video_id else "Track"
            title = fallback_title
            artist = "Unknown Artist"
            duration = 0
            song_title = None
            artist_is_uploader = False

            try:
                ydl_opts_meta = {
                    "skip_download": True,
                    # A cached song's URL can carry &list=...: read the one video only
                    "noplaylist": True,
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
                        artist, artist_is_uploader = track_artist(meta, artist)
                        duration = meta.get("duration", 0)
                        song_title = music_track_title(meta)
            except Exception as e:
                logger.warning(
                    f"Could not refresh metadata online for cached track {video_id}, using fallback: {e}"
                )

            clean_title, clean_artist = LyricsNormalizer.normalize_track_metadata(
                song_title or title, artist, artist_is_uploader
            )

            return {
                "id": stem,
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
            "outtmpl": str(self.output_dir / f"{file_stem or '%(id)s'}.%(ext)s"),
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": "wav",
                }
            ],
            "writethumbnail": True,
            "quiet": True,
            "no_warnings": True,
            # Checked on the metadata, before the download starts
            "match_filter": refuse_unsuitable,
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

        with fresh_download(wav_path):
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
                    if _is_cancel(e) or isinstance(e, UnusableLink):
                        # The user cancelled, or the video is live or too long: trying the
                        # next client would only start over
                        raise
                    err_msg = f"Profile {clients} failed: {e}"
                    logger.warning(err_msg)
                    attempt_errors.append(err_msg)
                    last_err = e

            if not meta:
                summary = "; ".join(attempt_errors) if attempt_errors else "unknown error"
                raise RuntimeError(
                    f"Failed to extract/download video from '{url}' across all client profiles. Errors: {summary}"
                ) from last_err

        v_id = file_stem or meta.get("id") or video_id
        title = meta.get("title") or "Unknown Track"
        artist, artist_is_uploader = track_artist(meta, "Unknown Artist")
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

        clean_title, clean_artist = LyricsNormalizer.normalize_track_metadata(
            music_track_title(meta) or title, artist, artist_is_uploader
        )

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

    def _download_by_lookup(self, link: MediaLink, progress_hook=None) -> dict[str, Any]:
        """A Spotify, Apple Music or TIDAL song: read its title, artist and length from the
        service, find the same recording on YouTube and download that. The song keeps the
        service's title and artist, which find the lyrics better than a video title, and its
        link as ``url``, so Try again looks it up again; ``song_match`` records what was
        matched."""
        info = fetch_song_info(link)
        matches = find_on_youtube(info, self.search_tracks_or_raise)[:LOOKUP_ATTEMPTS]
        result: dict[str, Any] = {}
        for attempt, match in enumerate(matches, start=1):
            try:
                result = self.extract_info_and_download(
                    match["url"], progress_hook, file_stem=link.track_id
                )
                break
            except Exception as e:
                # An upload blocked where the server is, or removed since the search: the
                # next match is the same song. YouTube's bot check blocks every upload alike
                if _is_cancel(e) or attempt == len(matches) or "not a bot" in str(e).lower():
                    raise
                logger.warning(f"Matched upload {match.get('id')} failed, trying the next: {e}")
        title, artist = LyricsNormalizer.normalize_track_metadata(info.title, info.artist)
        return {
            **result,
            "title": title,
            "artist": artist,
            "url": link.url,
            "song_match": {
                "site": link.site,
                "title": info.title,
                "artist": ", ".join(info.artists),
                "duration": info.duration,
                "youtube_id": match.get("id"),
                "youtube_title": result.get("raw_title"),
                "youtube_url": match["url"],
            },
        }

    def _thumbnail_for(self, stem: str) -> Path | None:
        """The thumbnail yt-dlp wrote beside the audio, if any."""
        for ext in ["webp", "jpg", "jpeg", "png"]:
            candidate = self.output_dir / f"{stem}.{ext}"
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
        return None

    def _download_from_site(self, link: MediaLink, progress_hook=None) -> dict[str, Any]:
        """Download a SoundCloud, Bandcamp, Vimeo or Internet Archive song, named by its track
        id (the site's own ids can collide across sites and Archive ones hold slashes). The
        link is read first and the download refused when it holds several recordings (an
        Archive item of a whole album), so one paste never downloads a dozen songs. Audio
        already on disk is reused; its metadata is refreshed when the site answers."""
        site_name = SITE_NAMES.get(link.site, link.site)
        wav_path = self.output_dir / f"{link.track_id}.wav"
        cached = cached_audio(wav_path)
        ydl_opts: dict[str, Any] = {
            "format": "bestaudio/ba/b",
            "outtmpl": str(self.output_dir / f"{link.track_id}.%(ext)s"),
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
            "writethumbnail": True,
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
        }
        if progress_hook:
            ydl_opts["progress_hooks"] = [progress_hook]

        meta: dict[str, Any] = {}
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                meta = _single_recording(ydl.extract_info(link.url, download=False), site_name)
                if not cached:
                    refuse_unsuitable(meta)
                    with fresh_download(wav_path):
                        meta = ydl.process_ie_result(meta, download=True) or meta
        except UnusableLink:
            raise
        except Exception as e:
            if _is_cancel(e):
                raise
            if not cached:
                raise RuntimeError(f"Failed to download audio from {site_name}: {e}") from e
            logger.warning(f"Could not refresh metadata for cached track {link.track_id}: {e}")
            meta = {}

        if not wav_path.is_file() or wav_path.stat().st_size == 0:
            raise RuntimeError(f"Expected extracted audio file not found or empty: {wav_path}")

        title = meta.get("title") or meta.get("track") or f"Track {link.track_id}"
        artist, artist_is_uploader = track_artist(meta, "Unknown Artist")
        clean_title, clean_artist = LyricsNormalizer.normalize_track_metadata(
            music_track_title(meta) or title, artist, artist_is_uploader
        )
        thumb_path = self._thumbnail_for(link.track_id)
        return {
            "id": link.track_id,
            "title": clean_title,
            "raw_title": title,
            "artist": clean_artist,
            "duration": meta.get("duration") or 0,
            "audio_path": str(wav_path),
            "thumbnail_path": str(thumb_path) if thumb_path else None,
            "thumbnail_url": f"/static/downloads/{thumb_path.name}" if thumb_path else None,
            "url": link.url,
        }


def _single_recording(info: dict[str, Any] | None, site_name: str) -> dict[str, Any]:
    """The one recording a link points to: a playlist of one is unwrapped, a longer one
    refused with what to paste instead."""
    if not isinstance(info, dict):
        raise RuntimeError(f"{site_name} returned nothing for this link")
    if info.get("_type") != "playlist" and "entries" not in info:
        return info
    entries = [entry for entry in (info.get("entries") or []) if isinstance(entry, dict)]
    if len(entries) == 1:
        return entries[0]
    if not entries:
        raise UnusableLink(f"That {site_name} link holds no recording that can be downloaded.")
    raise UnusableLink(
        f"That {site_name} link holds {len(entries)} recordings. "
        "Open the one you want and paste its link."
    )
