"""Whole albums at intake: a pasted link (or an uploaded file) holding a whole album is not
made into one song. The intake pipeline hands it here instead. The album is downloaded once,
kept compressed, and its songs are listed (``album_tracks``, ``album_audio``). The project
then rests with status ``album`` and an ``album`` field, and the studio shows the song list.
Each song picked from it (``routers/albums.py``) becomes a project of its own,
``<album id>-tNN``, whose pipeline cuts the song out of the album here
(``song_audio``) where another song's pipeline would download it.

``album`` on the album project: ``kind`` ("link" or "upload"), ``url``, ``title``,
``artist``, ``duration``, ``source`` (where the song list came from: "chapters", "catalog",
"pauses" or "none"), ``catalog`` (the catalog album matched, if any), ``audio_file`` (the
album's audio in downloads/) and ``tracks`` (number, title, start, end, artist, named).
``album_track`` on a song's project: ``album_id``, ``number``, ``start``, ``end`` and what
is needed to fetch the album's audio again (``kind``, ``url``, ``audio_file``)."""

import logging
import threading
import time
from pathlib import Path
from typing import Any

from backend.config import DOWNLOADS_DIR
from backend.project_store import PROJECTS_LOCK, get_project_or_404, save_projects
from backend.services import album_audio, album_tracks
from backend.services.album_tracks import AlbumTrack
from backend.services.downloader import album_audio_path, track_artist
from backend.services.lyrics import LyricsNormalizer
from backend.services.media_links import UnusableLink

logger = logging.getLogger("karaoke_backend")

ALBUM_STATUS = "album"
# An upload is only taken for an album when this many songs are told apart by its pauses
UPLOAD_MIN_PAUSE_SONGS = 3

_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_GUARD = threading.Lock()


def _album_lock(album_id: str) -> threading.Lock:
    """One lock per album: two of its songs started together download it once."""
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(album_id, threading.Lock())


def song_project_id(album_id: str, number: int) -> str:
    """The project id of song ``number`` of an album: "<album id>-t03"."""
    return f"{album_id}-t{number:02d}"


def _downloads(main_mod) -> Path:
    return getattr(main_mod, "DOWNLOADS_DIR", DOWNLOADS_DIR)


def identify_tracks(
    audio_path: str | Path,
    artist: str,
    title: str,
    duration: float,
    chapters: list[dict[str, Any]],
    cancel_event: threading.Event | None = None,
) -> tuple[list[AlbumTrack], str, str, dict | None]:
    """The songs of an album recording: from its chapters, else from the album's track list
    in a music catalog, else from the pauses between songs, with every cut moved to the
    quiet that is really there. Returns the songs, the album artist (chapters can correct
    it), where the list came from and the catalog album matched."""
    envelope = album_audio.loudness_envelope(audio_path, cancel_event)
    if chapters:
        tracks, artist = album_tracks.tracks_from_chapters(chapters, artist)
        cuts = album_audio.snap_cuts(envelope, [t.start for t in tracks[1:]], duration)
        return album_tracks.recut(tracks, cuts), artist, "chapters", None
    catalog = album_tracks.find_catalog_album(artist, title, duration)
    if catalog is not None:
        tracks = album_tracks.tracks_from_lengths(catalog.songs, duration, catalog.artist)
        cuts = album_audio.place_cuts(
            envelope, [length for _, length, _ in catalog.songs], duration
        )
        return album_tracks.recut(tracks, cuts), catalog.artist, "catalog", catalog.public()
    cuts = album_audio.split_at_pauses(envelope, duration)
    if cuts:
        return album_tracks.tracks_from_cuts(cuts, duration), artist, "pauses", None
    return [], artist, "none", None


def _rest_as_album(
    project_id: str,
    album: dict[str, Any],
    thumbnail_path: str | None,
) -> None:
    """Puts the album project at rest with its song list for the studio to show."""
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        proj["status"] = ALBUM_STATUS
        proj["progress"] = 100
        count = len(album["tracks"])
        proj["status_detail"] = (
            f"{count} songs found. Pick the ones to make." if count else "No songs found."
        )
        proj["album"] = album
        proj["title"] = album["title"] or proj.get("title") or "Album"
        proj["artist"] = album["artist"] or proj.get("artist") or "Unknown Artist"
        proj["duration"] = album["duration"]
        proj["heartbeat"] = int(time.time() * 1000)
        proj["eta_seconds"] = 0
        if thumbnail_path:
            proj["thumbnail_path"] = thumbnail_path
            proj["thumbnail_url"] = f"/static/downloads/{Path(thumbnail_path).name}"
        proj.pop("error", None)
        save_projects()


def open_link_album(
    main_mod,
    project_id: str,
    url: str,
    info: dict[str, Any],
    progress_hook,
    update_pipe,
    cancel_event: threading.Event,
) -> None:
    """A pasted link turned out to be a whole album (``downloader.AlbumDetected``): download
    it, list its songs and leave the project showing them."""
    duration = float(info.get("duration") or 0)
    limit = album_tracks.album_limit_seconds()
    if limit and duration > limit:
        raise UnusableLink(
            f"That album recording is {int(duration // 60)} minutes long. "
            f"The longest album this server downloads is {int(limit // 60)} minutes."
        )
    update_pipe(
        "downloading", 12, "This link is a whole album. Downloading it to find its songs..."
    )
    album_id = (get_project_or_404(project_id).get("track_id")) or project_id
    with _album_lock(album_id):
        audio = main_mod.downloader.download_album_audio(url, album_id, progress_hook)
    update_pipe("processing", 40, "Finding where each song starts...", 20)
    uploader, _ = track_artist(info, "")
    artist, title = album_tracks.album_names(info, uploader)
    tracks, artist, source, catalog = identify_tracks(
        audio["audio_path"],
        artist,
        title,
        duration,
        album_tracks.usable_chapters(info),
        cancel_event,
    )
    album = {
        "kind": "link",
        "url": url,
        "title": title or str(info.get("title") or ""),
        "artist": artist,
        "duration": duration,
        "source": source,
        "catalog": catalog,
        "audio_file": Path(audio["audio_path"]).name,
        "tracks": [t.public() for t in tracks],
    }
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        proj["url"] = url
        proj["raw_title"] = info.get("title")
    _rest_as_album(project_id, album, audio.get("thumbnail_path"))


def open_upload_album(
    project_id: str,
    wav_path: Path,
    title: str,
    artist: str,
    duration: float,
    chapters: list[dict[str, Any]],
    update_pipe,
    cancel_event: threading.Event,
) -> bool:
    """An uploaded file long enough to be an album: list its songs from its own chapters,
    the catalog album of the title and artist given, or its pauses. True when it is an album
    (the project then shows its songs); False for one long song, which goes on as usual."""
    update_pipe("processing", 8, "Checking whether the file is a whole album...")
    usable = album_tracks.usable_chapters({"chapters": chapters, "duration": duration})
    tracks, found_artist, source, catalog = identify_tracks(
        wav_path, artist, title, duration, usable, cancel_event
    )
    if source == "none" or (source == "pauses" and len(tracks) < UPLOAD_MIN_PAUSE_SONGS):
        return False
    album = {
        "kind": "upload",
        "url": None,
        "title": title,
        "artist": found_artist,
        "duration": duration,
        "source": source,
        "catalog": catalog,
        "audio_file": wav_path.name,
        "tracks": [t.public() for t in tracks],
    }
    _rest_as_album(project_id, album, None)
    return True


def _album_source(main_mod, track: dict[str, Any], progress_hook) -> Path:
    """The album's audio for one of its songs, downloaded again if it is gone (a link's)."""
    folder = _downloads(main_mod)
    album_id = str(track["album_id"])
    with _album_lock(album_id):
        if track.get("kind") == "upload":
            source = folder / str(track.get("audio_file") or f"{album_id}.wav")
            if not source.is_file():
                raise RuntimeError(
                    "The album file this song came from was deleted. Upload the album again."
                )
            return source
        source = album_audio_path(folder, album_id)
        if source is None:
            if not track.get("url"):
                raise RuntimeError("The album this song came from is gone. Paste its link again.")
            source = Path(
                main_mod.downloader.download_album_audio(track["url"], album_id, progress_hook)[
                    "audio_path"
                ]
            )
        return source


def song_audio(main_mod, project_id: str, progress_hook, update_pipe) -> dict[str, Any]:
    """What the downloader returns for a song, for a song picked from an album: its part of
    the album cut out as the song's WAV, with the album's cover and the song's own title."""
    proj = get_project_or_404(project_id)
    track = dict(proj["album_track"])
    update_pipe("downloading", 15, "Cutting the song out of the album...", 10)
    source = _album_source(main_mod, track, progress_hook)
    target = _downloads(main_mod) / f"{project_id}.wav"
    length = album_audio.cut_song(source, float(track["start"]), float(track["end"]), target)
    title, artist = LyricsNormalizer.normalize_track_metadata(
        str(proj.get("title") or track.get("title") or f"Track {track.get('number')}"),
        str(proj.get("artist") or "Unknown Artist"),
    )
    album_proj = main_mod.projects.get(track["album_id"])
    thumbnail = (album_proj or {}).get("thumbnail_path") if isinstance(album_proj, dict) else None
    if thumbnail and not Path(thumbnail).is_file():
        thumbnail = None
    return {
        "id": project_id,
        "title": title,
        "raw_title": proj.get("title"),
        "artist": artist,
        "duration": round(length, 3),
        "audio_path": str(target),
        "thumbnail_path": thumbnail or proj.get("thumbnail_path"),
        "url": track.get("url") or proj.get("url"),
    }
