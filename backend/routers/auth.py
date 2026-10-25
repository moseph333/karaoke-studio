"""Authentication API router handling login, logout, and session status endpoints."""

import hmac
import logging

from fastapi import APIRouter, HTTPException, Request
from starlette.responses import JSONResponse

from backend import config
from backend.auth import (
    check_login_rate_limit,
    create_session_token,
    get_client_ip,
    is_authenticated,
    record_login_failure,
    reset_login_failures,
)
from backend.schemas import LoginRequest

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["auth"])


@router.get("/api/auth/status")
def auth_status(request: Request):
    app_pwd = config.APP_PASSWORD
    if not app_pwd:
        return {"auth_required": False, "authenticated": True}
    return {"auth_required": True, "authenticated": is_authenticated(request, app_pwd)}


@router.post("/api/auth/login")
def auth_login(req: LoginRequest, request: Request):
    client_ip = get_client_ip(request)
    check_login_rate_limit(client_ip)
    clean_username = (req.username or "").strip() or "Friend"

    if config.APP_PASSWORD:
        pwd = (req.password or "").strip()
        if not pwd:
            record_login_failure(client_ip)
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
                pass
    return response


@router.post("/api/auth/logout")
def auth_logout():
    response = JSONResponse(content={"status": "ok"})
    response.delete_cookie(key="session_token")
    response.delete_cookie(key="karaoke_token")
    return response
