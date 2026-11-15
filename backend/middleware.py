"""Passphrase auth and security headers, as pure ASGI middleware.

They replace two BaseHTTPMiddleware layers, which ran every request's endpoint in a task of
its own and passed each response body through an extra stream.
"""

import re
import uuid

from fastapi import HTTPException as FastAPIHTTPException
from starlette.datastructures import MutableHeaders
from starlette.exceptions import HTTPException
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from backend import config
from backend.auth import authenticate_request, get_client_ip, log_credential_rejection
from backend.http_delivery import cache_control_for
from backend.logging_setup import request_id_var
from backend.upload_utils import (
    MAX_BACKGROUND_UPLOAD_BYTES,
    MAX_INSTRUMENTAL_UPLOAD_BYTES,
    MAX_TRACK_UPLOAD_BYTES,
)

REQUEST_ID_HEADER = "X-Request-ID"
# An id a proxy already gave the request is kept if it looks like one
_REQUEST_ID_PATTERN = re.compile(r"[A-Za-z0-9-]{1,64}")


class RequestContext:
    """Gives each HTTP request an id: the X-Request-ID it came with (if it is 1-64 letters,
    digits and dashes) or a new one. The id tags the app's log lines while the request is
    handled, is kept in scope["state"]["request_id"] for the error handler, and is echoed in
    the response's X-Request-ID header."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        incoming = Request(scope).headers.get(REQUEST_ID_HEADER, "")
        request_id = incoming if _REQUEST_ID_PATTERN.fullmatch(incoming) else uuid.uuid4().hex[:12]
        scope.setdefault("state", {})["request_id"] = request_id

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        token = request_id_var.set(request_id)
        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)


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
            # /api/auth/* exactly: a later route that merely starts with "/api/auth" (say
            # /api/authors) stays behind the passphrase
            is_public_api = (
                path == "/api/auth"
                or path.startswith("/api/auth/")
                or (path == "/api/health" and scope["method"] in ("GET", "HEAD"))
            )
            protected = (path.startswith("/api/") and not is_public_api) or path.startswith(
                "/static/"
            )
            if protected:
                request = Request(scope)
                try:
                    authenticated, stale_cookie = authenticate_request(request, app_pwd)
                except HTTPException as exc:
                    limited = JSONResponse(
                        status_code=exc.status_code,
                        content={"detail": exc.detail},
                        headers=exc.headers,
                    )
                    await limited(scope, receive, send)
                    return
                if not authenticated:
                    if _presents_credentials(request):
                        log_credential_rejection(get_client_ip(request))
                    response = JSONResponse(
                        status_code=401, content={"detail": "Invalid or missing studio passphrase"}
                    )
                    if stale_cookie:
                        response.delete_cookie("session_token")
                        response.delete_cookie("karaoke_token")
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


def _presents_credentials(request: Request) -> bool:
    """Whether a refused request carried any credential (one without is a client that has not
    signed in yet, which is not worth a log line)."""
    headers = request.headers
    return bool(
        headers.get("x-session-token")
        or headers.get("x-app-password")
        or (headers.get("authorization") or "").startswith("Bearer ")
        or request.cookies.get("session_token")
        or request.cookies.get("karaoke_token")
    )


# Answered whatever ALLOWED_HOSTS says: a rebinding attack needs a name the attacker owns,
# and the container's health check asks localhost
_LOOPBACK_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})


def host_allowed(host_header: str, allowed: list[str]) -> bool:
    """Whether a Host header (port and IPv6 brackets ignored) is one of the allowed names; a
    "*.example.com" entry matches example.com's subdomains. An empty list allows any."""
    if not allowed:
        return True
    host = host_header.strip().lower()
    if host.startswith("["):
        host = host[1 : host.find("]")] if "]" in host else host
    elif host.count(":") == 1:
        host = host.split(":", 1)[0]
    if host in _LOOPBACK_HOSTS:
        return True
    for pattern in allowed:
        if pattern.startswith("*.") and host.endswith(pattern[1:]) and host != pattern[2:]:
            return True
        if host == pattern:
            return True
    return False


class AllowedHosts:
    """With ALLOWED_HOSTS set (read on each request), answers 400 to a request whose Host
    header names another host, so a website that rebinds its own DNS name to this server
    cannot read or drive the API (which, without a passphrase, needs no credentials)."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and config.ALLOWED_HOSTS:
            host = Request(scope).headers.get("host", "")
            if not host_allowed(host, config.ALLOWED_HOSTS):
                response = JSONResponse(status_code=400, content={"detail": "Invalid host header"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


# Multipart framing and the form's other fields on top of the file itself
_UPLOAD_SLACK_BYTES = 1024 * 1024
_UPLOAD_LIMITS = {
    "/api/upload-track": MAX_TRACK_UPLOAD_BYTES,
    "/api/upload-audio": MAX_TRACK_UPLOAD_BYTES,
    "/api/upload-instrumental": MAX_INSTRUMENTAL_UPLOAD_BYTES,
    "/api/upload-background": MAX_BACKGROUND_UPLOAD_BYTES,
}
BODY_TOO_LARGE_DETAIL = "The request is too large."


def body_limit_for(path: str) -> int:
    """The largest body a request to path may send: an upload route's own file limit plus
    1 MB, else MAX_JSON_BODY_MB (read on each request)."""
    upload_limit = _UPLOAD_LIMITS.get(path)
    if upload_limit is not None:
        return upload_limit + _UPLOAD_SLACK_BYTES
    return int(config.MAX_JSON_BODY_MB * 1024 * 1024)


class BodyLimit:
    """Answers 413 to a request whose body is larger than body_limit_for(path).

    A Content-Length over the limit is refused before anything is read. A body without one
    (chunked) is counted as the app reads it, and reading past the limit raises the 413.
    Without this, Starlette spooled a whole multipart upload to disk, and parsed a JSON body
    of any size in memory, before a route could look at its size."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        limit = body_limit_for(scope["path"])
        declared = Request(scope).headers.get("content-length")
        if declared is not None and declared.strip().isdigit() and int(declared) > limit:
            response = JSONResponse(status_code=413, content={"detail": BODY_TOO_LARGE_DETAIL})
            await response(scope, receive, send)
            return

        received = 0

        async def counting_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    # FastAPI re-raises an HTTPException met while it reads the body
                    raise FastAPIHTTPException(status_code=413, detail=BODY_TOO_LARGE_DETAIL)
            return message

        await self.app(scope, counting_receive, send)


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
