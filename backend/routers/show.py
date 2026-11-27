"""Show API router: the YouTube karaoke videos a host screen queues for the stage window
(see ``services/show_videos``) and the requests for songs the host could not find (see
``services/show_requests``). The queue itself lives in the host's browser."""

import logging
import threading

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import FileResponse

from backend.background_jobs import run_job
from backend.project_store import PROJECTS_LOCK, SAVE_FAILED_DETAIL, ensure_free_space
from backend.schemas import SongRequestCreate
from backend.services import show_requests, show_videos
from backend.services.downloader import TrackDownloader
from backend.update_drain import ensure_not_draining

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["show"])

DOWNLOADS_OFF_DETAIL = "This server does not keep copies of videos."
NO_SONG_DETAIL = "Type the song to ask for."


def _video_id(raw: str) -> str:
    """The id itself, nothing else: it names a file in the data folder."""
    video_id = TrackDownloader.extract_video_id(raw)
    if not video_id or video_id != raw:
        raise HTTPException(status_code=404, detail="That is not a YouTube video id.")
    return video_id


@router.get("/api/show/videos/{video_id}", summary="Whether a karaoke video can play on stage")
def show_video(video_id: str):
    """Whether YouTube's embedded player plays the video (`embeddable`: true, false when its
    uploader turned embedding off, null when YouTube could not be asked), and where the
    server's own copy of it stands: `status` is `none`, `fetching` (with `progress`),
    `ready` (with the `url` to play) or `failed` (with `error`). `downloads` says whether
    this server keeps copies at all."""
    return show_videos.status(_video_id(video_id))


@router.post(
    "/api/show/videos/{video_id}/fetch",
    summary="Keep a copy of a karaoke video that cannot be embedded",
)
def fetch_show_video(video_id: str, bg_tasks: BackgroundTasks):
    """Downloads the video in the background so the stage can play it as a file. Answers like
    `GET /api/show/videos/{video_id}`; poll that until `status` is `ready` or `failed`. A
    video that has a copy, or is being fetched, starts nothing."""
    import backend.main as main_mod

    vid = _video_id(video_id)
    if not show_videos.downloads_enabled():
        raise HTTPException(status_code=409, detail=DOWNLOADS_OFF_DETAIL)
    if not show_videos.has_copy(vid):
        ensure_free_space()
        ensure_not_draining()
        if show_videos.claim_fetch(vid):
            with PROJECTS_LOCK:
                main_mod.active_cancellations[f"{vid}{show_videos.CANCEL_SUFFIX}"] = (
                    threading.Event()
                )
            bg_tasks.add_task(run_job, show_videos.run_fetch, vid)
    return show_videos.status(vid, check_embed=False)


@router.get("/api/show/videos/{video_id}/file", summary="The server's copy of a karaoke video")
def show_video_file(video_id: str):
    """The MP4 kept for a video (ranges are served, so the stage can seek). 404 until
    `status` is `ready`."""
    vid = _video_id(video_id)
    if not show_videos.has_copy(vid):
        raise HTTPException(status_code=404, detail="There is no copy of that video.")
    show_videos.touch(vid)
    return FileResponse(
        show_videos.video_file(vid), media_type="video/mp4", headers={"Cache-Control": "no-cache"}
    )


@router.get("/api/show/requests", summary="The songs a show asked for")
def song_requests():
    """The songs hosts could not find, waiting for the owner to make them, the latest asked
    for first: each has an `id`, the `song` as typed, the `singers` who asked, the `show` it
    was last asked at, how many times it was asked for (`count`) and when it last was
    (`requested_at`, seconds since 1970)."""
    return {"requests": show_requests.listing()}


@router.post("/api/show/requests", summary="Ask for a song the show could not find")
def request_song(req: SongRequestCreate):
    """Files a request for a song, for the owner to make later; nothing is made by itself.
    A song already asked for is counted once more. Answers the `request` and the whole list
    (`requests`). 422 without a song, 409 when the list is full, 507 on a full disk."""
    song = show_requests.clean(req.song, show_requests.SONG_MAX)
    if not song:
        raise HTTPException(status_code=422, detail=NO_SONG_DETAIL)
    try:
        entry = show_requests.add(song, req.singer or "", req.show or "")
    except show_requests.RequestsFull as e:
        raise HTTPException(status_code=409, detail=show_requests.FULL_DETAIL) from e
    except OSError as e:
        logger.error(f"Could not save a song request: {e}")
        raise HTTPException(status_code=507, detail=SAVE_FAILED_DETAIL) from e
    return {"request": entry, "requests": show_requests.listing()}


@router.delete("/api/show/requests/{request_id}", summary="Take a song off the request list")
def remove_song_request(request_id: str):
    """Removes a request, once its song is made or will not be. The studio's own: a show
    sign-in cannot. Answers the list that is left. 404 for a request that is not there."""
    try:
        removed = show_requests.remove(request_id)
    except OSError as e:
        logger.error(f"Could not save the song requests: {e}")
        raise HTTPException(status_code=507, detail=SAVE_FAILED_DETAIL) from e
    if not removed:
        raise HTTPException(status_code=404, detail="That request is not on the list.")
    return {"requests": show_requests.listing()}
