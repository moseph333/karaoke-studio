"""The web app manifest in the colours of the app theme a device has chosen.

Chrome on Android paints the strip under the gesture pill of an installed app, and its splash
screen, from the manifest's ``theme_color`` and ``background_color``, not from the page. The
built manifest carries the default theme's colour, so with another theme the installed app
kept a strip in the wrong colour (a dark bar under a light app). The page therefore links
``/manifest.json?bg=<hex>`` once a non-default theme is chosen, and this route answers with
the built manifest in that colour. Without a valid ``bg`` it serves the file as it is.
"""

import json
import re
from pathlib import Path

from fastapi import APIRouter
from fastapi.responses import FileResponse, Response

MANIFEST_NAME = "manifest.json"
MANIFEST_MEDIA_TYPE = "application/manifest+json"
_HEX_COLOUR = re.compile(r"[0-9a-fA-F]{6}")


def themed_manifest(raw: bytes, bg: str | None) -> bytes | None:
    """The manifest with both colours set to ``#<bg>``, or None to serve the file unchanged."""
    if not bg or not _HEX_COLOUR.fullmatch(bg):
        return None
    try:
        manifest = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(manifest, dict):
        return None
    colour = f"#{bg.lower()}"
    manifest["theme_color"] = colour
    manifest["background_color"] = colour
    return json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8")


def manifest_router(dist: Path) -> APIRouter:
    """A router serving ``/manifest.json`` from the built frontend in ``dist``."""
    router = APIRouter()

    @router.api_route(f"/{MANIFEST_NAME}", methods=["GET", "HEAD"], include_in_schema=False)
    def web_manifest(bg: str | None = None) -> Response:
        path = dist / MANIFEST_NAME
        if not path.is_file():
            return Response(status_code=404)
        themed = themed_manifest(path.read_bytes(), bg)
        if themed is None:
            return FileResponse(path, media_type=MANIFEST_MEDIA_TYPE)
        return Response(themed, media_type=MANIFEST_MEDIA_TYPE)

    return router
