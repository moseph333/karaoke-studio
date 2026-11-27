"""The Server settings page's API: the owner unlocks it with the admin passphrase, reads every
setting and saves changes, which take effect at once (see backend.admin_auth for who the
owner is, backend.services.admin_settings for the settings)."""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from backend import admin_auth
from backend.auth import (
    check_login_rate_limit,
    get_client_ip,
    record_login_failure,
    reset_login_failures,
)
from backend.project_store import SAVE_FAILED_DETAIL
from backend.schemas import AdminLoginRequest, AdminSettingsUpdate
from backend.services import admin_settings

logger = logging.getLogger("karaoke_backend")

router = APIRouter(tags=["admin"])


@router.get("/api/admin/status")
async def admin_status(request: Request):
    """Whether this server has an admin passphrase, and whether this browser has given it."""
    if not admin_auth.enabled():
        return {"enabled": False, "authenticated": False}
    try:
        authenticated = admin_auth.is_admin(request)
    except HTTPException:
        # Over the login limit: the page reads "locked" and the next unlock says why
        authenticated = False
    return {"enabled": True, "authenticated": authenticated}


@router.post("/api/admin/login")
async def admin_login(req: AdminLoginRequest, request: Request):
    """Trades the admin passphrase for a token the page sends as X-Admin-Token."""
    if not admin_auth.enabled():
        raise HTTPException(status_code=403, detail=admin_auth.ADMIN_OFF_DETAIL)
    client_ip = get_client_ip(request)
    limit_key = admin_auth.limit_key(request)
    check_login_rate_limit(limit_key)
    if not admin_auth.passphrase_matches((req.password or "").strip()):
        record_login_failure(limit_key)
        logger.warning(f"Wrong admin passphrase from {client_ip}")
        raise HTTPException(status_code=403, detail=admin_auth.WRONG_PASSPHRASE_DETAIL)
    reset_login_failures(limit_key)
    logger.info(f"Server settings unlocked from {client_ip}")
    return {"status": "ok", "token": admin_auth.create_admin_token()}


@router.get("/api/admin/settings", dependencies=[Depends(admin_auth.require_admin)])
def read_settings():
    """Every setting: its value now, what the environment alone gives, and its options."""
    return admin_settings.describe()


@router.put("/api/admin/settings", dependencies=[Depends(admin_auth.require_admin)])
def save_settings(req: AdminSettingsUpdate, request: Request):
    """Saves changes by setting id (null forgets a saved value) and answers with every
    setting as it now stands. All of the changes are saved or none."""
    try:
        changed = admin_settings.update(req.values)
    except admin_settings.SettingError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        logger.error(f"Could not save the server settings: {exc}")
        raise HTTPException(status_code=507, detail=SAVE_FAILED_DETAIL) from exc
    logger.info(f"Server settings changed from {get_client_ip(request)}: {', '.join(changed)}")
    return admin_settings.describe()
