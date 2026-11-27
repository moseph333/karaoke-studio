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
    app_pwd = config.APP_PASSWORD
    admin = bool(config.ADMIN_PASSWORD)
    if not app_pwd:
        return {
            "auth_required": False,
            "authenticated": True,
            "admin": admin,
            "show": False,
            "show_authenticated": False,
        }
    authenticated = authenticated_within_limit(request, app_pwd)
    return {
        "auth_required": True,
        "authenticated": authenticated,
        "admin": admin,
        "show": show_auth.enabled(),
        "show_authenticated": show_auth.holds_token_within_limit(request),
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
    response = JSONResponse(content={"status": "ok", "token": token})
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
