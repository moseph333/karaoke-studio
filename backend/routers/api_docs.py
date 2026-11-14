"""Interactive API reference: a Scalar page at /api/docs over the OpenAPI schema at
/api/openapi.json.

Both sit under /api/, so PassphraseAuth guards them like every other route while
APP_PASSWORD is set; a browser that has signed in to the studio carries the session cookie
there, and Scalar's "Test request" panel sends it along. FastAPI's own /docs, /redoc and
/openapi.json are switched off in main.py, as they would sit outside that gate.
"""

import html
import json
from typing import Any

from fastapi import APIRouter, FastAPI
from fastapi.openapi.utils import get_openapi
from fastapi.responses import HTMLResponse

OPENAPI_URL = "/api/openapi.json"
DOCS_URL = "/api/docs"

# Pinned: the page loads it from the CDN at view time
SCALAR_VERSION = "1.76.4"
SCALAR_SCRIPT = f"https://cdn.jsdelivr.net/npm/@scalar/api-reference@{SCALAR_VERSION}"

API_DESCRIPTION = """\
The HTTP API behind the Karaoke Studio web app: intake (YouTube or upload), project and
lyric editing, background quality jobs, renders and exports.

**Authentication.** With `APP_PASSWORD` unset the API is open. Otherwise every `/api/*`
route except `GET /api/health` and `/api/auth/*`, and every `/static/*` file, needs a session
token from `POST /api/auth/login` or the passphrase itself, sent as the `X-App-Password`
header, as `Authorization: Bearer <token>`, or as the `session_token` cookie the login sets.
Wrong credentials count against a per-IP rate limit (429 with `Retry-After`).

**Long jobs.** Processing, renders, re-separation and re-alignment run in the background:
the starting route returns at once and the project's `status`, `progress` and job fields
report how it goes, so poll `GET /api/project/{id}`.
"""

router = APIRouter()


def build_openapi(app: FastAPI) -> dict[str, Any]:
    """The app's OpenAPI schema, plus the studio's auth schemes, cached on the app."""
    if app.openapi_schema:
        return app.openapi_schema
    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=API_DESCRIPTION,
        routes=app.routes,
    )
    components = schema.setdefault("components", {})
    components["securitySchemes"] = {
        "passphrase": {
            "type": "apiKey",
            "in": "header",
            "name": "X-App-Password",
            "description": "The studio passphrase (APP_PASSWORD).",
        },
        "sessionToken": {
            "type": "http",
            "scheme": "bearer",
            "description": "A session token from POST /api/auth/login, valid for 7 days.",
        },
        "sessionCookie": {
            "type": "apiKey",
            "in": "cookie",
            "name": "session_token",
            "description": "Set by POST /api/auth/login when a passphrase is configured.",
        },
    }
    # Any one scheme is enough, and none while no passphrase is set
    schema["security"] = [
        {},
        {"passphrase": []},
        {"sessionToken": []},
        {"sessionCookie": []},
    ]
    app.openapi_schema = schema
    return schema


def install_openapi(app: FastAPI) -> None:
    app.openapi = lambda: build_openapi(app)  # type: ignore[method-assign]


def docs_page_html(title: str) -> str:
    config = {
        "url": OPENAPI_URL,
        "theme": "purple",
        "layout": "modern",
        "darkMode": True,
        "hideDownloadButton": False,
        "withDefaultFonts": True,
        "metaData": {"title": title},
        "defaultHttpClient": {"targetKey": "shell", "clientKey": "curl"},
        "authentication": {"preferredSecurityScheme": "passphrase"},
        # No hosted-service upsells (deploy, SDKs) or AI chat that would send the schema away
        "showDeveloperTools": "never",
        "agent": {"disabled": True},
    }
    # Escape "<" so nothing in the config can close the <script> element
    config_json = json.dumps(config).replace("<", "\\u003c")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>{html.escape(title)}</title>
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
  </head>
  <body>
    <div id="app"></div>
    <script src="{SCALAR_SCRIPT}"></script>
    <script>
      Scalar.createApiReference('#app', {config_json});
    </script>
  </body>
</html>
"""


@router.get(DOCS_URL, include_in_schema=False)
def api_docs() -> HTMLResponse:
    """The interactive API reference."""
    return HTMLResponse(docs_page_html("Karaoke Studio API"), headers={"Cache-Control": "no-cache"})
