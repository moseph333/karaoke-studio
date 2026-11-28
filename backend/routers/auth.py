"""Authentication API router handling login, logout, and session status endpoints."""

import hmac
import logging

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import JSONResponse

from backend import config, show_auth
from backend.auth import (
    authenticated_within_limit,
    check_login_rate_limit,
    create_session_token,
    get_client_ip,
    record_login_failure,
    reset_login_failures,
    session_seconds_left,
)
from backend.schemas import LoginRequest, ShowLoginRequest

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["auth"])


@router.get("/api/auth/status")
async def auth_status(request: Request):
    # Wrong credentials count against the login limit here too, and a client over it reads
    # authenticated: false (not 429, which the studio would take for open access). Async, so
    # checking and counting a guess is one step on the event loop.
    # "admin": this server has an owner who can change its settings (ADMIN_PASSWORD), so the
    # studio offers the Server settings page
    # "show": this server has a passphrase that only runs a show (SHOW_PASSWORD), which the
    # host screen's sign-in takes as well; "show_authenticated": the request carries its token
    # "expires_in", "show_expires_in": the seconds the session token and the show token it
    # carries still have, null without one (so a screen that must not be signed out in the
    # middle of something can ask for the passphrase beforehand)
    app_pwd = config.APP_PASSWORD
    admin = bool(config.ADMIN_PASSWORD)
    if not app_pwd:
        return {
            "auth_required": False,
            "authenticated": True,
            "admin": admin,
            "show": False,
            "show_authenticated": False,
            "expires_in": None,
            "show_expires_in": None,
        }
    authenticated = authenticated_within_limit(request, app_pwd)
    show_authenticated = show_auth.holds_token_within_limit(request)
    return {
        "auth_required": True,
        "authenticated": authenticated,
        "admin": admin,
        "show": show_auth.enabled(),
        "show_authenticated": show_authenticated,
        "expires_in": session_seconds_left(request, app_pwd) if authenticated else None,
        "show_expires_in": show_auth.seconds_left(request) if show_authenticated else None,
    }


@router.post("/api/auth/show-login", summary="Sign in to run a show only")
async def auth_show_login(req: ShowLoginRequest, request: Request):
    """Trades the show passphrase (SHOW_PASSWORD) for a show token: send it in
    `X-Show-Token`. It opens what a show reads (the songs, the YouTube search, the show's
    videos, the media) and nothing that changes the library. 403 on a server with no show
    passphrase; wrong guesses are limited per address, apart from studio ones."""
    if not show_auth.enabled():
        raise HTTPException(status_code=403, detail=show_auth.SHOW_OFF_DETAIL)
    # Async, like the studio's login: the limit check, the comparison and the count are one
    # step on the event loop
    key = show_auth.limit_key(request)
    check_login_rate_limit(key)
    if not show_auth.passphrase_matches((req.password or "").strip()):
        record_login_failure(key)
        logger.warning(f"Failed show sign-in from {get_client_ip(request)}")
        raise HTTPException(status_code=401, detail=show_auth.WRONG_PASSPHRASE_DETAIL)
    reset_login_failures(key)
    token = show_auth.create_show_token()
    logger.info(f"Signed in a show host from {get_client_ip(request)}")
    return _show_token_response(request, token)


def _show_token_response(request: Request, token: str) -> JSONResponse:
    """A new show token, in the body and as the cookie."""
    response = JSONResponse(
        content={"status": "ok", "token": token, "expires_in": show_auth.TOKEN_MAX_AGE_SEC}
    )
    is_https = request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
    # The media a page loads by itself (audio, a video's copy, cover art) carries no header
    response.set_cookie(
        key=show_auth.COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=is_https,
        max_age=show_auth.TOKEN_MAX_AGE_SEC,
    )
    return response


@router.post("/api/auth/show-renew", summary="Renew a show sign-in that is still good")
async def auth_show_renew(request: Request):
    """Trades a show token that is still good for a new one, good for seven days from now
    (`{token, expires_in}`, also the `show_token` cookie). The host screen asks when it opens
    and every few hours while it is open, so a venue that runs a show every week is not
    signed out in the middle of one.

    It renews show tokens only: a show token changes nothing on the server, and the studio's
    session keeps its seven days. Without a good show token it answers `{"status": "none"}`
    and sets nothing: never 401, which the host screen takes for being signed out. Changing
    SHOW_PASSWORD still ends every show sign-in, renewed or not."""
    # Async, like the sign-ins: counting a forged token is one step on the event loop
    if not show_auth.holds_token_within_limit(request):
        return JSONResponse(content={"status": "none"})
    return _show_token_response(request, show_auth.create_show_token())


@router.post("/api/auth/login")
async def auth_login(req: LoginRequest, request: Request):
    # Async, like the middleware: checking the limit, comparing and counting the failure are
    # one step on the event loop. In the threadpool, parallel guesses would all pass the check
    # before any of them was counted.
    client_ip = get_client_ip(request)
    check_login_rate_limit(client_ip)
    clean_username = (req.username or "").strip() or "Friend"

    if config.APP_PASSWORD:
        pwd = (req.password or "").strip()
        if not pwd:
            record_login_failure(client_ip)
            logger.warning(f"Login without a passphrase from {client_ip}")
            raise HTTPException(status_code=401, detail="Incorrect studio passphrase")
        try:
            is_valid = hmac.compare_digest(pwd.encode("utf-8"), config.APP_PASSWORD.encode("utf-8"))
        except Exception:
            is_valid = False
        if not is_valid:
            record_login_failure(client_ip)
            logger.warning(f"Failed login attempt for user: {clean_username} from {client_ip}")
            raise HTTPException(status_code=401, detail="Incorrect studio passphrase")

        reset_login_failures(client_ip)
        session_token = create_session_token(config.APP_PASSWORD, client_id=clean_username)
        logger.info(f"Signed in user {clean_username} from {client_ip}")
    else:
        session_token = "ok"

    response = JSONResponse(
        content={
            "status": "ok",
            "token": session_token,
            "username": clean_username,
        }
    )
    if config.APP_PASSWORD:
        is_https = (
            request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"
        )
        max_age = 60 * 60 * 24 * 7  # 7 days
        for cookie_name in ["session_token", "karaoke_token"]:
            try:
                response.set_cookie(
                    key=cookie_name,
                    value=session_token,
                    httponly=True,
                    samesite="lax",
                    secure=is_https,
                    max_age=max_age,
                )
            except Exception:
                logger.warning(f"Could not set the {cookie_name} cookie", exc_info=True)
    return response


@router.post("/api/auth/logout")
def auth_logout(request: Request):
    logger.info(f"Signed out a session from {get_client_ip(request)}")
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie(key="session_token")
    response.delete_cookie(key="karaoke_token")
    response.delete_cookie(key=show_auth.COOKIE_NAME)
    return response
