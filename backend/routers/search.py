"""Search API router: the song search behind the intake box (songs from the music catalogs,
see ``services/song_search``) and the YouTube upload search it falls back to. Both mark the
results that are already in the library."""

import logging
from typing import Any

from fastapi import APIRouter, HTTPException

from backend.background_jobs import BUSY_PIPELINE_STATES
from backend.project_store import PROJECTS_LOCK, merge_disk_projects
from backend.schemas import SearchRequest, SongSearchRequest
from backend.services import song_search

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["search"])

# A library song this much longer or shorter is another recording of the title
LIBRARY_SAME_SONG_SEC = 15.0
_LIBRARY_STATES = BUSY_PIPELINE_STATES | {"ready"}


def _library_songs() -> list[dict[str, Any]]:
    """What the search needs of each library song that is ready or being made: its ids,
    title, artist, length and status. A snapshot, taken under the lock."""
    import backend.main as main_mod

    merge_disk_projects(main_mod.projects)
    songs: dict[int, dict[str, Any]] = {}
    with PROJECTS_LOCK:
        for key, proj in main_mod.projects.items():
            if not isinstance(proj, dict) or proj.get("status") not in _LIBRARY_STATES:
                continue
            # A song stored under its id and its track id is one dict
            entry = songs.setdefault(
                id(proj),
                {
                    "ids": set(),
                    "id": proj.get("id") or key,
                    "status": proj.get("status"),
                    "title": str(proj.get("title") or ""),
                    "artist": str(proj.get("artist") or ""),
                    "duration": proj.get("duration"),
                },
            )
            entry["ids"].update(str(i) for i in (key, proj.get("id"), proj.get("track_id")) if i)
    return list(songs.values())


def _in_library(
    library: list[dict[str, Any]],
    track_ids: list[str],
    title: str = "",
    artist: str = "",
    duration: float | None = None,
) -> dict[str, Any] | None:
    """The library song a result is: made from the same catalog song or video, or with the
    same title and artist and about the same length (a pasted YouTube link and a searched
    song end up as different ids for one recording)."""
    for entry in library:
        if entry["ids"] & set(track_ids):
            return entry
    if not title or not artist:
        return None
    wanted = song_search.fold(song_search.base_title(title))
    plain = not song_search.version_labels(title)
    for entry in library:
        if song_search.fold(song_search.base_title(entry["title"])) != wanted:
            continue
        if not song_search.same_artist(entry["artist"], artist):
            continue
        length = entry["duration"]
        if isinstance(length, (int, float)) and length > 0 and duration:
            if abs(length - duration) <= LIBRARY_SAME_SONG_SEC:
                return entry
        elif plain:
            return entry
    return None


def _mark(result: dict[str, Any], entry: dict[str, Any] | None) -> dict[str, Any]:
    result["project_id"] = entry["id"] if entry else None
    result["project_status"] = entry["status"] if entry else None
    return result


@router.post(
    "/api/search/songs",
    summary="Search for songs by title, artist or both",
)
def search_songs(req: SongSearchRequest):
    """Songs for the typed words, best first, from the music catalogs in
    `SONG_SEARCH_SOURCES` (Deezer and the iTunes Store by default). Misspellings are
    tolerated; `corrected` is the respelled query when one was searched as well. Start a
    result with `POST /api/process` and its `url`.

    `sources` lists the catalogs that answered. When it is empty (none is configured, or
    none could be reached) `results` is empty too: search YouTube uploads with
    `POST /api/search` instead. A result that is already in the library carries its
    `project_id` and `project_status`."""
    try:
        outcome = song_search.search_songs(req.query)
    except Exception as e:
        logger.exception("Song search failed")
        raise HTTPException(status_code=500, detail="Search failed. Try again in a moment.") from e
    library = _library_songs() if outcome.results else []
    return {
        "query": " ".join(req.query.split()),
        "corrected": outcome.corrected,
        "sources": list(outcome.sources),
        "results": [
            _mark(
                song.public(),
                _in_library(library, song.track_ids, song.title, song.artist, song.duration),
            )
            for song in outcome.results[: req.limit or 8]
        ],
    }


@router.post("/api/search", summary="Search YouTube uploads")
def search_tracks(req: SearchRequest):
    """YouTube uploads for the typed words, in YouTube's order: for a song the catalogs do
    not list, or a particular upload of one. A result that is already in the library
    carries its `project_id` and `project_status`."""
    import backend.main as main_mod

    try:
        results = main_mod.downloader.search_tracks(req.query, limit=req.limit or 5)
        library = _library_songs() if results else []
        return {
            "results": [
                _mark(dict(r), _in_library(library, [str(r["id"])] if r.get("id") else []))
                for r in results
            ]
        }
    except Exception as e:
        logger.exception("Search failed")
        raise HTTPException(status_code=500, detail="Search failed. Try again in a moment.") from e
