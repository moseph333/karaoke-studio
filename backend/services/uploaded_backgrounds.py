"""Uploaded stage backgrounds: deleting one the studio has let go of.

An upload's id is kept only by the browser that sent it, in its stage settings, so the server
cannot tell which files are still wanted and never deleted any. The studio now says when it
replaces or removes its upload (``DELETE /api/background/{id}``) and the file goes.

A render asked for with an upload reads the file when it reaches FFmpeg, which can be long
after the request when other jobs are ahead of it. The render route holds the file from the
request to the end of the render; a delete that arrives meanwhile is carried out then.
Holds live in memory: a restart forgets a delete that was waiting, and that file stays.
"""

import logging
import re
import threading
from pathlib import Path

from backend.config import BACKGROUNDS_DIR

logger = logging.getLogger("karaoke_backend")

# What POST /api/upload-background names a file: eight hex digits, "_", the cleaned file name
ID_RE = re.compile(r"[0-9a-f]{8}_[A-Za-z0-9_.-]{1,255}")

_GUARD = threading.Lock()
# How many renders hold each upload, and the uploads to delete once nothing holds them
_HELD: dict[str, int] = {}
_DELETE_WHEN_FREE: set[str] = set()


def is_id(text: object) -> bool:
    """Whether the text is an upload's id. Anything else never becomes part of a path."""
    return isinstance(text, str) and ID_RE.fullmatch(text) is not None


def _file(bg_id: str) -> Path:
    import backend.main as main_mod

    return Path(getattr(main_mod, "BACKGROUNDS_DIR", BACKGROUNDS_DIR)) / bg_id


def _unlink(bg_id: str) -> bool:
    try:
        _file(bg_id).unlink()
    except FileNotFoundError:
        return False
    except OSError as exc:
        logger.warning(f"Could not delete the uploaded background {bg_id}: {exc}")
        return False
    logger.info(f"Deleted the uploaded background {bg_id}")
    return True


def hold(bg_id: object) -> None:
    """Keeps an upload on disk for a render that was asked for with it. Each hold needs a
    ``release``; anything that is not an upload's id is ignored by both."""
    if not is_id(bg_id):
        return
    with _GUARD:
        _HELD[bg_id] = _HELD.get(bg_id, 0) + 1


def release(bg_id: object) -> None:
    """Ends a render's hold, and deletes the upload if the studio let go of it meanwhile."""
    if not is_id(bg_id):
        return
    with _GUARD:
        left = _HELD.get(bg_id, 0) - 1
        if left > 0:
            _HELD[bg_id] = left
            return
        _HELD.pop(bg_id, None)
        if bg_id in _DELETE_WHEN_FREE:
            _DELETE_WHEN_FREE.discard(bg_id)
            _unlink(bg_id)


def remove(bg_id: str) -> bool:
    """Deletes an upload the studio no longer shows. True when the file is gone now; False
    when a render still holds it (it goes when that render ends) or it was not there."""
    with _GUARD:
        if _HELD.get(bg_id, 0) > 0:
            _DELETE_WHEN_FREE.add(bg_id)
            return False
        return _unlink(bg_id)


def forget_holds() -> None:
    """Drops every hold and waiting delete (tests start from none)."""
    with _GUARD:
        _HELD.clear()
        _DELETE_WHEN_FREE.clear()
