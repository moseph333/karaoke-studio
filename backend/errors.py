"""Error text that is safe to store on a song and show in the studio.

A job's exception text comes from yt-dlp, FFmpeg, soundfile or a cloud worker and often
names absolute server paths (the data folder, the checkout) or runs to kilobytes of FFmpeg
output. public_error() keeps what it says and drops where the server keeps its files.
"""

import re

from backend import config

PUBLIC_ERROR_LIMIT = 400
_WHITESPACE = re.compile(r"\s+")


def _server_roots() -> list[str]:
    """The folders whose absolute paths are cut from error text, longest first, so a data
    folder inside the checkout loses its whole prefix."""
    roots = set()
    for root in (config.DATA_DIR, config.BASE_DIR):
        for form in (root, root.resolve()):
            text = str(form).rstrip("/")
            if len(text) > 1:
                roots.add(text)
    return sorted(roots, key=len, reverse=True)


def public_error(exc: BaseException | str, limit: int = PUBLIC_ERROR_LIMIT) -> str:
    """exc's message (its type name if it has none) with the data folder and checkout paths
    made relative, whitespace collapsed to single spaces and cut to ``limit`` characters."""
    text = str(exc).strip() or (type(exc).__name__ if isinstance(exc, BaseException) else "")
    for root in _server_roots():
        text = text.replace(root + "/", "").replace(root, ".")
    text = _WHITESPACE.sub(" ", text).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return text
