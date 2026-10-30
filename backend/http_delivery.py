"""Compression and cache headers for HTTP responses.

API JSON and the built frontend's scripts and styles are gzipped; media under /static, the
audio stem downloads and the backdrop image are not (they are already compressed or streamed
by byte range, and older Starlette versions would compress them too). Vite's hashed assets
never change, so browsers may keep them for a year, while the page itself is revalidated so
a new build is picked up.
"""

from starlette.middleware.gzip import GZipMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

IMMUTABLE_ASSET_CACHE = "public, max-age=31536000, immutable"


def compressible_path(path: str) -> bool:
    if path.startswith("/assets/"):
        return True
    return (
        path.startswith("/api/") and "/export/audio/" not in path and not path.endswith("/backdrop")
    )


def cache_control_for(path: str, status_code: int) -> str | None:
    """The Cache-Control a frontend response should carry, or None to leave it unset."""
    if status_code != 200:
        return None  # never let a browser keep a missing asset for a year
    if path.startswith("/assets/"):
        return IMMUTABLE_ASSET_CACHE
    if path in ("/", "/index.html"):
        return "no-cache"
    return None


class CompressTextResponses:
    """Applies GZipMiddleware to the paths that compressible_path() accepts."""

    def __init__(self, app: ASGIApp, minimum_size: int = 1024) -> None:
        self.app = app
        self.gzip = GZipMiddleware(app, minimum_size=minimum_size)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and compressible_path(scope["path"]):
            await self.gzip(scope, receive, send)
        else:
            await self.app(scope, receive, send)
