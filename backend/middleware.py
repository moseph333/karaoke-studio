"""Passphrase auth and security headers, as pure ASGI middleware.

They replace two BaseHTTPMiddleware layers, which ran every request's endpoint in a task of
its own and passed each response body through an extra stream.
"""

from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend import config
from backend.auth import authenticate_request
from backend.http_delivery import cache_control_for


class PassphraseAuth:
    """While APP_PASSWORD is set (read on each request), answers 401 to /api/ and /static/
    requests without a valid session. /api/auth stays open, and GET /api/health for health
    checks and uptime monitors; its POST form and /api/system/update can start a production
    update, so they need a session.

    Wrong credentials in headers or cookies count against the login rate limit, and a client
    IP over it gets a 429 with Retry-After before its credentials are compared. A 401 for
    cookie credentials also expires both session cookies, so a stale cookie counts once."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        app_pwd = config.APP_PASSWORD
        if scope["type"] == "http" and app_pwd:
            path = scope["path"]
            is_public_api = path.startswith("/api/auth") or (
                path == "/api/health" and scope["method"] in ("GET", "HEAD")
            )
            protected = (path.startswith("/api/") and not is_public_api) or path.startswith(
                "/static/"
            )
            if protected:
                try:
                    authenticated, stale_cookie = authenticate_request(Request(scope), app_pwd)
                except HTTPException as exc:
                    limited = JSONResponse(
                        status_code=exc.status_code,
                        content={"detail": exc.detail},
                        headers=exc.headers,
                    )
                    await limited(scope, receive, send)
                    return
                if not authenticated:
                    response = JSONResponse(
                        status_code=401, content={"detail": "Invalid or missing studio passphrase"}
                    )
                    if stale_cookie:
                        response.delete_cookie("session_token")
                        response.delete_cookie("karaoke_token")
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


class SecurityHeaders:
    """nosniff, frame and referrer headers on every response, plus the Cache-Control of
    cache_control_for() when the response sets none."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                cache_control = cache_control_for(path, message["status"])
                if cache_control and "cache-control" not in headers:
                    headers["Cache-Control"] = cache_control
            await send(message)

        await self.app(scope, receive, send_with_headers)
