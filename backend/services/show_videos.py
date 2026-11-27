"""Karaoke videos for a show: whether YouTube lets one play in its embedded player, and a
copy kept on the server for the ones it does not.

A show (the host screen, ``/?show=1``) plays a YouTube karaoke video on the stage window
through YouTube's embedded player. Some uploaders turn embedding off, and such a video only
plays on youtube.com. ``embeddable`` asks YouTube's oEmbed endpoint, which answers 200 for a
video that can be embedded and 401 for one that cannot, so the host screen knows before the
singer is on stage. For the ones that cannot, ``run_fetch`` downloads the video with yt-dlp
as an MP4 a browser plays (H.264 and AAC where YouTube has them, 720p at most) into
``<data dir>/show_videos/<video id>.mp4``, and the stage plays that file instead.

Whether a copy exists is read from the file, never from memory: the in-memory jobs only say
what is being fetched now and what failed last. Copies are kept up to SHOW_VIDEO_CACHE_GB
(3 by default, 0 lifts the limit), the least recently used going first; SHOW_VIDEO_DOWNLOADS
off (``0``) turns the fallback off, and blocked videos are then simply not playable.
"""

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

import yt_dlp

from backend import config, server_settings
from backend.services.downloader import refuse_unsuitable
from backend.services.media_links import UnusableLink

logger = logging.getLogger("karaoke_backend")

VIDEOS_DIR_NAME = "show_videos"
DEFAULT_CACHE_GB = 3.0
MAX_HEIGHT = 720
# What a job's cancel event is registered under, so a host update waits for a running fetch
CANCEL_SUFFIX = "_show_video"
OEMBED_URL = (
    "https://www.youtube.com/oembed?format=json&url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D{}"
)
OEMBED_TIMEOUT_SEC = 6.0
# A video's embedding rarely changes; an answer that could not be had is asked again soon
EMBED_KNOWN_TTL_SEC = 3600.0
EMBED_UNKNOWN_TTL_SEC = 60.0
EMBED_CACHE_ENTRIES = 512
# One fetch at a time: each is a download and an FFmpeg remux
FETCH_SEMAPHORE = threading.Semaphore(1)
# H.264 with AAC where YouTube has them (every browser plays that), else the best picture up
# to the height limit, else whatever there is
VIDEO_FORMAT = (
    f"bv*[vcodec^=avc1][height<={MAX_HEIGHT}]+ba[acodec^=mp4a]/"
    f"bv*[height<={MAX_HEIGHT}]+ba/b[height<={MAX_HEIGHT}]/b"
)
# yt-dlp's own choice of YouTube clients first (None): it is the one that is offered the
# separate picture and sound streams, so 720p. The clients the song downloader uses come
# after; they get through where the first is refused, with a 360p file
CLIENT_PROFILES: tuple[list[str] | None, ...] = (
    None,
    ["ios", "android", "mweb"],
    ["android"],
    ["web"],
)
FETCH_FAILED_DETAIL = "That video could not be downloaded. Pick another upload of the song."

_lock = threading.RLock()
# video id -> {"status": "fetching" | "failed", "progress": 0..100, "error": str | None}
_jobs: dict[str, dict[str, Any]] = {}
# video id -> (asked at, what YouTube said: see listing)
_embeddable: dict[str, tuple[float, dict[str, Any]]] = {}


def downloads_enabled() -> bool:
    """SHOW_VIDEO_DOWNLOADS: on unless set to 0, false, off or no."""
    value = (server_settings.env("SHOW_VIDEO_DOWNLOADS", "1") or "").strip().lower()
    return value not in ("0", "false", "off", "no")


def cache_limit_bytes() -> int:
    """SHOW_VIDEO_CACHE_GB in bytes; 0 means no limit."""
    raw = server_settings.env("SHOW_VIDEO_CACHE_GB", str(DEFAULT_CACHE_GB))
    try:
        gigabytes = float((raw or "").strip())
    except ValueError:
        gigabytes = DEFAULT_CACHE_GB
    return max(0, int(gigabytes * 1024**3))


def capability() -> dict[str, Any]:
    """What the host screen needs to know about this server."""
    return {"video_downloads": downloads_enabled()}


def videos_dir() -> Path:
    """The folder of kept copies, read on each call (tests give every test its own data folder)."""
    path = Path(config.DATA_DIR) / VIDEOS_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def video_file(video_id: str) -> Path:
    return videos_dir() / f"{video_id}.mp4"


def has_copy(video_id: str) -> bool:
    try:
        return video_file(video_id).stat().st_size > 0
    except OSError:
        return False


def touch(video_id: str) -> None:
    """Marks a copy as just used, so it is the last one the size limit removes."""
    try:
        os.utime(video_file(video_id))
    except OSError:
        pass


def _oembed(video_id: str) -> tuple[int | None, dict[str, Any]]:
    """YouTube's oEmbed answer for the video: its HTTP status (None when it cannot be asked)
    and, for a video that can be embedded, what it says of it (``title``, ``author_name``)."""
    request = urllib.request.Request(
        OEMBED_URL.format(video_id), headers={"User-Agent": "Mozilla/5.0"}
    )
    try:
        with urllib.request.urlopen(request, timeout=OEMBED_TIMEOUT_SEC) as response:
            code = int(response.status)
            try:
                data = json.loads(response.read().decode("utf-8", "replace"))
            except ValueError:
                data = {}
            return code, data if isinstance(data, dict) else {}
    except urllib.error.HTTPError as exc:
        return int(exc.code), {}
    except (OSError, ValueError) as exc:
        logger.info(f"Could not ask YouTube whether {video_id} can be embedded: {exc}")
        return None, {}


def _text(value: Any) -> str | None:
    text = value.strip() if isinstance(value, str) else ""
    return text[:300] or None


def listing(video_id: str) -> dict[str, Any]:
    """What YouTube says of the video: ``embeddable`` (True, False when the uploader turned
    embedding off, None when YouTube could not be asked or does not know the video), and its
    ``title`` and ``channel`` when it gave them (it gives neither for a video it will not
    embed). Remembered: an hour for an answer, a minute for none."""
    now = time.monotonic()
    with _lock:
        cached = _embeddable.get(video_id)
        if cached:
            asked_at, answer = cached
            known = answer["embeddable"] is not None
            if now - asked_at < (EMBED_KNOWN_TTL_SEC if known else EMBED_UNKNOWN_TTL_SEC):
                return dict(answer)
    code, data = _oembed(video_id)
    answer = {
        "embeddable": True if code == 200 else False if code in (401, 403) else None,
        "title": _text(data.get("title")),
        "channel": _text(data.get("author_name")),
    }
    with _lock:
        if len(_embeddable) >= EMBED_CACHE_ENTRIES:
            _embeddable.pop(next(iter(_embeddable)))
        _embeddable[video_id] = (now, answer)
    return dict(answer)


def embeddable(video_id: str) -> bool | None:
    """Whether YouTube's embedded player will play the video (see ``listing``)."""
    return listing(video_id)["embeddable"]


def file_url(video_id: str) -> str:
    return f"/api/show/videos/{video_id}/file"


def status(video_id: str, *, check_embed: bool = True) -> dict[str, Any]:
    """What the host screen shows for a queued video: whether it can be embedded, and where
    its copy stands (``none``, ``fetching``, ``ready`` or ``failed``)."""
    with _lock:
        job = dict(_jobs.get(video_id) or {})
    ready = has_copy(video_id)
    if ready:
        state, progress, error = "ready", 100, None
    elif job:
        state, progress, error = job["status"], job.get("progress", 0), job.get("error")
    else:
        state, progress, error = "none", 0, None
    said = listing(video_id) if check_embed else {}
    return {
        "video_id": video_id,
        "embeddable": said.get("embeddable"),
        "title": said.get("title"),
        "channel": said.get("channel"),
        "status": state,
        "progress": progress,
        "url": file_url(video_id) if ready else None,
        "error": error,
        "downloads": downloads_enabled(),
    }


def claim_fetch(video_id: str) -> bool:
    """Marks the video as being fetched. False when it has a copy or a fetch already runs, so
    two requests for one video start one download."""
    with _lock:
        if has_copy(video_id):
            return False
        if (_jobs.get(video_id) or {}).get("status") == "fetching":
            return False
        _jobs[video_id] = {"status": "fetching", "progress": 0, "error": None}
        return True


def _set_progress(video_id: str, percent: float) -> None:
    with _lock:
        job = _jobs.get(video_id)
        if job and job.get("status") == "fetching":
            job["progress"] = max(job.get("progress", 0), min(99, int(percent)))


def _remove_partials(video_id: str) -> None:
    for leftover in videos_dir().glob(f"{video_id}.fetch.*"):
        leftover.unlink(missing_ok=True)


def download_video(video_id: str, on_progress: Callable[[float], None]) -> Path:
    """Downloads the video as an MP4 and returns the finished file, which the caller moves
    into place. Raises UnusableLink for a live stream or a recording over the length limit,
    RuntimeError when no YouTube client could download it."""
    folder = videos_dir()
    target = folder / f"{video_id}.fetch.mp4"

    def hook(event: dict[str, Any]) -> None:
        total = event.get("total_bytes") or event.get("total_bytes_estimate")
        if event.get("status") == "downloading" and total:
            on_progress(100.0 * float(event.get("downloaded_bytes") or 0) / float(total))

    options: dict[str, Any] = {
        "format": VIDEO_FORMAT,
        "merge_output_format": "mp4",
        "outtmpl": str(folder / f"{video_id}.fetch.%(ext)s"),
        "postprocessors": [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}],
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        # Checked on the metadata, before anything downloads
        "match_filter": refuse_unsuitable,
        "progress_hooks": [hook],
    }
    errors: list[str] = []
    for clients in CLIENT_PROFILES:
        if clients is None:
            options.pop("extractor_args", None)
        else:
            options["extractor_args"] = {"youtube": {"player_client": clients}}
        try:
            with yt_dlp.YoutubeDL(options) as ydl:
                ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=True)
        except UnusableLink:
            raise
        except Exception as exc:
            errors.append(f"{clients or 'default clients'}: {exc}")
            _remove_partials(video_id)
            continue
        if target.is_file() and target.stat().st_size > 0:
            return target
        errors.append(f"{clients or 'default clients'}: no MP4 was written")
        _remove_partials(video_id)
    raise RuntimeError(f"Could not download {video_id}: {'; '.join(errors)}")


def evict(keep: str | None = None) -> list[str]:
    """Removes the least recently used copies until the folder is within its size limit.
    ``keep`` (the copy just fetched) is never removed. Returns the video ids removed."""
    limit = cache_limit_bytes()
    if limit <= 0:
        return []
    files = []
    for path in videos_dir().glob("*.mp4"):
        if path.name.endswith(".fetch.mp4"):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        files.append((stat.st_mtime, stat.st_size, path))
    total = sum(size for _, size, _ in files)
    removed: list[str] = []
    for _, size, path in sorted(files, key=lambda item: item[0]):
        if total <= limit:
            break
        if path.stem == keep:
            continue
        path.unlink(missing_ok=True)
        total -= size
        removed.append(path.stem)
    if removed:
        logger.info(f"Removed {len(removed)} show video(s) to stay within the size limit")
    return removed


def run_fetch(video_id: str) -> None:
    """The background job behind ``POST /api/show/videos/{id}/fetch``: downloads the video,
    moves it into place and trims the folder. The route claimed the fetch and registered its
    cancel event; this releases both."""
    import backend.main as main_mod
    from backend.background_jobs import release_cancel_event

    key = f"{video_id}{CANCEL_SUFFIX}"
    event = main_mod.active_cancellations.get(key)
    try:
        with FETCH_SEMAPHORE:
            if not has_copy(video_id):
                finished = download_video(video_id, lambda pct: _set_progress(video_id, pct))
                os.replace(finished, video_file(video_id))
                evict(keep=video_id)
        with _lock:
            _jobs.pop(video_id, None)
    except UnusableLink as exc:
        with _lock:
            _jobs[video_id] = {"status": "failed", "progress": 0, "error": str(exc)}
    except Exception:
        logger.exception(f"Fetching show video {video_id} failed")
        with _lock:
            _jobs[video_id] = {"status": "failed", "progress": 0, "error": FETCH_FAILED_DETAIL}
    finally:
        _remove_partials(video_id)
        if event is not None:
            release_cancel_event(main_mod.active_cancellations, key, event)


def reset() -> None:
    """Forgets jobs and embed answers (between tests)."""
    with _lock:
        _jobs.clear()
        _embeddable.clear()
