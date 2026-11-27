"""Song requests: the songs a show's host could not find, kept for the owner to make.

A singer asks the host of a karaoke night for a song. The host looks for a karaoke video of
it and for it in the library (``/?show=1``, "Add a singer"); when neither has it, the host
files a request. The requests wait in ``<data dir>/show_requests.json`` until the owner, on
the studio's home screen, makes the song or removes the request. Nothing is made by itself:
a request is the words the host typed, and the owner picks the recording.

A song asked for again is one request counted again (the words compared without case or
spacing), with the singers who asked, and it moves to the front of the list. The list holds
``MAX_REQUESTS`` songs and refuses more: whoever holds a show sign-in can add to it, so it
must not grow without limit, and dropping the oldest would let new ones push real ones out.

The file is read on every call and written atomically; nothing is kept in memory.
"""

import json
import logging
import threading
import time
import unicodedata
import uuid
from pathlib import Path
from typing import Any

from backend import config
from backend.project_store import write_text_atomically

logger = logging.getLogger("karaoke_backend")

REQUESTS_FILE_NAME = "show_requests.json"
MAX_REQUESTS = 200
SONG_MAX = 120
SINGER_MAX = 40
SHOW_MAX = 60
# The singers named on one request: the first few who asked
SINGERS_KEPT = 8
FULL_DETAIL = (
    "The request list is full. It has room again once the owner makes or removes some of "
    "the songs on it."
)

_lock = threading.RLock()


class RequestsFull(Exception):
    """The list holds MAX_REQUESTS songs already."""


def requests_file() -> Path:
    return Path(config.DATA_DIR) / REQUESTS_FILE_NAME


def clean(text: Any, limit: int) -> str:
    """Typed words on one line: no control characters, single spaces, at most ``limit``
    characters."""
    if not isinstance(text, str):
        return ""
    printable = "".join(" " if unicodedata.category(ch)[0] == "C" else ch for ch in text)
    return " ".join(printable.split())[:limit].strip()


def _key(song: str) -> str:
    """What makes two requests the same song: the words, whatever their case."""
    return clean(song, SONG_MAX).casefold()


def _entry(raw: Any) -> dict[str, Any] | None:
    """A stored request as the API gives it, or None for something that is not one."""
    if not isinstance(raw, dict):
        return None
    request_id = raw.get("id")
    song = clean(raw.get("song"), SONG_MAX)
    if not isinstance(request_id, str) or not request_id or not song:
        return None
    singers_raw = raw.get("singers")
    singers = (
        [clean(name, SINGER_MAX) for name in singers_raw] if isinstance(singers_raw, list) else []
    )
    count = raw.get("count")
    asked_at = raw.get("requested_at")
    return {
        "id": request_id,
        "song": song,
        "singers": [name for name in singers if name][:SINGERS_KEPT],
        "show": clean(raw.get("show"), SHOW_MAX),
        "count": count
        if isinstance(count, int) and not isinstance(count, bool) and count > 0
        else 1,
        "requested_at": asked_at
        if isinstance(asked_at, int) and not isinstance(asked_at, bool)
        else 0,
    }


def _read() -> list[dict[str, Any]]:
    """The stored requests, oldest first. A missing file is an empty list, and so is one
    that cannot be read: the next request then starts the list again."""
    path = requests_file()
    try:
        stored = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []
    except (OSError, ValueError) as e:
        logger.warning(f"Could not read {path.name}, starting the request list again: {e}")
        return []
    raw = stored.get("requests") if isinstance(stored, dict) else None
    if not isinstance(raw, list):
        return []
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        entry = _entry(item)
        if entry and entry["id"] not in seen:
            seen.add(entry["id"])
            entries.append(entry)
    return entries


def _write(entries: list[dict[str, Any]]) -> None:
    """Raises what the disk raised (OSError on a full one), leaving the file as it was."""
    text = json.dumps({"version": 1, "requests": entries}, ensure_ascii=False, indent=1)
    write_text_atomically(requests_file(), text)


def listing() -> list[dict[str, Any]]:
    """Every request, the latest asked for first."""
    with _lock:
        return list(reversed(_read()))


def add(song: str, singer: str = "", show: str = "") -> dict[str, Any]:
    """Files a request for ``song`` (cleaned words, not empty) and returns it. A song already
    on the list is counted once more and gains the singer. Raises RequestsFull for a new
    song when the list is full, and OSError when the disk refuses the write."""
    song = clean(song, SONG_MAX)
    singer = clean(singer, SINGER_MAX)
    show = clean(show, SHOW_MAX)
    if not song:
        raise ValueError("a request needs a song")
    now = int(time.time())
    with _lock:
        entries = _read()
        key = _key(song)
        entry = next((e for e in entries if _key(e["song"]) == key), None)
        if entry:
            entries.remove(entry)
            entry["count"] += 1
            entry["requested_at"] = now
            if show:
                entry["show"] = show
        else:
            if len(entries) >= MAX_REQUESTS:
                raise RequestsFull()
            entry = {
                "id": uuid.uuid4().hex[:12],
                "song": song,
                "singers": [],
                "show": show,
                "count": 1,
                "requested_at": now,
            }
        known = {name.casefold() for name in entry["singers"]}
        if singer and singer.casefold() not in known and len(entry["singers"]) < SINGERS_KEPT:
            entry["singers"].append(singer)
        entries.append(entry)
        _write(entries)
        return entry


def remove(request_id: str) -> bool:
    """Takes a request off the list; False when there is none with that id. Raises OSError
    when the disk refuses the write."""
    with _lock:
        entries = _read()
        kept = [e for e in entries if e["id"] != request_id]
        if len(kept) == len(entries):
            return False
        _write(kept)
        return True
