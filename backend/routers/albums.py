"""Album API router: the songs of a whole album that was pasted or uploaded (see
``backend/album_pipeline``). Lists them with the songs already made from them, starts the
picked ones as songs of their own, or makes the whole recording one song after all."""

import logging
import threading
import time
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, HTTPException

from backend import config
from backend.album_pipeline import ALBUM_STATUS, song_project_id
from backend.background_jobs import BUSY_PIPELINE_STATES, run_job
from backend.config import DOWNLOADS_DIR
from backend.project_store import (
    PROJECTS_LOCK,
    ensure_free_space,
    get_project_or_404,
    merge_disk_projects,
    save_projects,
)
from backend.schemas import AlbumSongsRequest, AlbumWholeRequest
from backend.services.downloader import album_audio_path
from backend.update_drain import ensure_not_draining

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["albums"])


def _album_of(proj: dict) -> dict:
    album = proj.get("album")
    if proj.get("status") != ALBUM_STATUS or not isinstance(album, dict):
        raise HTTPException(status_code=409, detail="That song is not an album to pick from.")
    return album


def _song_state(main_mod, pid: str) -> dict:
    song = main_mod.projects.get(pid)
    if not isinstance(song, dict):
        return {"project_id": None, "project_status": None}
    return {"project_id": song.get("id", pid), "project_status": song.get("status")}


@router.get("/api/project/{project_id}/album", summary="List the songs of an album")
def get_album(project_id: str):
    """The album's songs in order (number, title, start and end in seconds, whether the name
    is a stand-in such as "Track 3"), where the list came from (`source`: the recording's
    chapters, a music catalog's track list, or the pauses between songs), and for each song
    already made from the album its `project_id` and `project_status`."""
    import backend.main as main_mod

    merge_disk_projects(main_mod.projects)
    proj = get_project_or_404(project_id)
    with PROJECTS_LOCK:
        album = _album_of(proj)
        album_id = proj.get("id", project_id)
        tracks = [
            {**track, **_song_state(main_mod, song_project_id(album_id, int(track["number"])))}
            for track in album.get("tracks") or []
        ]
        limit = config.MAX_SONG_MINUTES * 60
        duration = float(album.get("duration") or 0)
        return {
            **{key: value for key, value in album.items() if key != "tracks"},
            "id": album_id,
            "thumbnail_url": proj.get("thumbnail_url"),
            "separation_quality": proj.get("separation_quality"),
            # Whether the whole recording may be made into one song (MAX_SONG_MINUTES)
            "whole_allowed": not limit or duration <= limit,
            "tracks": tracks,
        }


@router.post(
    "/api/project/{project_id}/album/songs",
    summary="Make songs from an album",
)
def make_album_songs(project_id: str, req: AlbumSongsRequest, bg_tasks: BackgroundTasks):
    """Starts each picked song of the album as a song of its own (project id
    `<album id>-tNN`), cut out of the album's audio. A song already made or being made is
    left as it is; a failed or cancelled one starts again. A `title` renames the song (and
    the album's list), `artist` the album's artist; both find the lyrics. Returns each
    song's `project_id` and `status`, in the order picked."""
    import backend.main as main_mod

    merge_disk_projects(main_mod.projects)
    proj = get_project_or_404(project_id)
    album = _album_of(proj)
    numbers = {int(track["number"]) for track in album.get("tracks") or []}
    unknown = sorted({pick.number for pick in req.songs} - numbers)
    if unknown:
        raise HTTPException(
            status_code=400, detail=f"The album has no song {', '.join(map(str, unknown))}."
        )
    ensure_free_space()
    ensure_not_draining()

    started: list[dict] = []
    to_run: list[str] = []
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        album = _album_of(proj)
        album_id = proj.get("id", project_id)
        if req.artist and req.artist.strip():
            album["artist"] = " ".join(req.artist.split())
            proj["artist"] = album["artist"]
        tracks = {int(track["number"]): track for track in album.get("tracks") or []}
        seen: set[int] = set()
        for pick in req.songs:
            if pick.number in seen:
                continue
            seen.add(pick.number)
            track = tracks[pick.number]
            if pick.title and pick.title.strip():
                track["title"] = " ".join(pick.title.split())
                track["named"] = True
            pid = song_project_id(album_id, pick.number)
            existing = main_mod.projects.get(pid)
            if isinstance(existing, dict):
                status = existing.get("status")
                running = status in BUSY_PIPELINE_STATES and pid in main_mod.active_cancellations
                if status == "ready" or running:
                    started.append({"project_id": pid, "number": pick.number, "status": status})
                    continue
            song = {
                "id": pid,
                "track_id": pid,
                "status": "queued",
                "progress": 0,
                "lines": [],
                "semitones": 0,
                "guide_volume": 0.0,
                "created_by": req.created_by or proj.get("created_by") or "Friend",
                "created_at": int(time.time()),
                "title": track["title"],
                "artist": track.get("artist") or album.get("artist") or "Unknown Artist",
                "album_track": {
                    "album_id": album_id,
                    "album_title": album.get("title"),
                    "number": pick.number,
                    "start": track["start"],
                    "end": track["end"],
                    "kind": album.get("kind"),
                    "url": album.get("url"),
                    "audio_file": album.get("audio_file"),
                },
            }
            if album.get("url"):
                song["url"] = album["url"]
            if proj.get("thumbnail_url"):
                song["thumbnail_url"] = proj["thumbnail_url"]
            if proj.get("thumbnail_path"):
                song["thumbnail_path"] = proj["thumbnail_path"]
            quality = req.separation_quality or proj.get("separation_quality")
            if quality:
                song["separation_quality"] = quality
            main_mod.active_cancellations[pid] = threading.Event()
            main_mod.projects[pid] = song
            to_run.append(pid)
            started.append({"project_id": pid, "number": pick.number, "status": "queued"})
        save_projects()
    for pid in to_run:
        url = main_mod.projects[pid].get("url") or pid
        bg_tasks.add_task(run_job, main_mod.run_pipeline, pid, url, None)
    return {"projects": started}


@router.post(
    "/api/project/{project_id}/album/whole",
    summary="Make a whole album recording one song",
)
def make_album_whole(project_id: str, req: AlbumWholeRequest, bg_tasks: BackgroundTasks):
    """Makes the recording one song after all, as if it were not an album: for a long song
    that was taken for an album, or an album sung through. A link's recording must be no
    longer than `MAX_SONG_MINUTES`."""
    import backend.main as main_mod

    merge_disk_projects(main_mod.projects)
    proj = get_project_or_404(project_id)
    album = _album_of(proj)
    limit = config.MAX_SONG_MINUTES
    duration = float(album.get("duration") or 0)
    if album.get("kind") == "link" and limit and duration > limit * 60:
        raise HTTPException(
            status_code=400,
            detail=(
                f"That recording is {int(duration // 60)} minutes long, longer than the "
                f"{limit} minutes this server makes into one song. Pick its songs instead."
            ),
        )
    ensure_free_space()
    ensure_not_draining()
    downloads = getattr(main_mod, "DOWNLOADS_DIR", DOWNLOADS_DIR)
    with PROJECTS_LOCK:
        proj = get_project_or_404(project_id)
        album = _album_of(proj)
        proj.pop("album", None)
        proj["album_whole"] = True
        proj["status"] = "queued"
        proj["progress"] = 0
        proj["status_detail"] = "Queued"
        if req.separation_quality:
            proj["separation_quality"] = req.separation_quality
        main_mod.active_cancellations[proj.get("id", project_id)] = threading.Event()
        save_projects()
    album_id = proj.get("id", project_id)
    if album.get("kind") == "upload":
        wav = downloads / str(album.get("audio_file") or f"{album_id}.wav")
        bg_tasks.add_task(
            run_job,
            main_mod.run_local_pipeline,
            album_id,
            str(wav),
            proj.get("title") or "",
            proj.get("artist") or "",
            None,
        )
    else:
        # The song is downloaded as a song; the album's compressed copy is not needed now
        compressed = album_audio_path(downloads, album_id)
        if compressed is not None:
            Path(compressed).unlink(missing_ok=True)
        bg_tasks.add_task(run_job, main_mod.run_pipeline, album_id, album.get("url"), None)
    return {"project_id": album_id, "status": "queued"}
