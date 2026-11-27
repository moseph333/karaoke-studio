"""Who may change the server's settings: whoever knows ADMIN_PASSWORD.

The studio has one shared passphrase and no accounts, so the owner is told apart by a second
secret. The Server settings page trades it for an admin token (signed like a session token,
with a key of its own, good for seven days) and sends that in ``X-Admin-Token``; scripts may
send the passphrase itself in ``X-Admin-Password``. Headers only, never a cookie, so no other
website's request can carry it. With ADMIN_PASSWORD unset there is no owner and every admin
route refuses.

A refusal is always 403, never 401: the studio takes a 401 from any route to mean its
session ended, and would sign a singer out for mistyping the admin passphrase.

Wrong admin passphrases are limited per address like wrong studio ones (the same counts and
window), but counted apart from them: guessing at the admin passphrase locks that address
out of the admin routes only, not a room of singers out of the studio.
"""

import hmac

from fastapi import HTTPException, Request

from backend import config
from backend.auth import (
    _token_status,
    check_login_rate_limit,
    create_session_token,
    get_client_ip,
    record_credential_failure,
)

TOKEN_HEADER = "x-admin-token"
PASSWORD_HEADER = "x-admin-password"

ADMIN_OFF_DETAIL = (
    "This server has no admin passphrase, so its settings cannot be changed from the studio. "
    "Set ADMIN_PASSWORD on the server to turn the page on."
)
ADMIN_LOCKED_DETAIL = "Enter the admin passphrase to change this server's settings."
WRONG_PASSPHRASE_DETAIL = "Incorrect admin passphrase"


def enabled() -> bool:
    """Whether this server has an owner who can change its settings (ADMIN_PASSWORD is set)."""
    return bool(config.ADMIN_PASSWORD)


def _signing_secret(admin_pwd: str) -> str:
    """What admin tokens are signed with in place of the studio passphrase. The prefix keeps
    the two kinds of token apart even on a server where both passphrases are the same."""
    return "admin\0" + admin_pwd


def create_admin_token() -> str:
    """A token for the owner's browser, or "" when the server has no admin passphrase."""
    admin_pwd = config.ADMIN_PASSWORD
    return create_session_token(_signing_secret(admin_pwd), client_id="admin") if admin_pwd else ""


def passphrase_matches(candidate: str) -> bool:
    admin_pwd = config.ADMIN_PASSWORD
    if not admin_pwd or not candidate:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), admin_pwd.encode("utf-8"))


def limit_key(request: Request) -> str:
    """The name an address's admin guesses are counted under, apart from its studio ones."""
    return "admin|" + get_client_ip(request)


def _presented(request: Request) -> list[tuple[str, str]]:
    """The admin credentials a request carries, as (header, value)."""
    found = []
    for header in (TOKEN_HEADER, PASSWORD_HEADER):
        value = (request.headers.get(header) or "").strip()
        if value:
            found.append((header, value))
    return found


def is_admin(request: Request) -> bool:
    """Whether the request comes from the owner. A wrong passphrase or a forged token counts
    against the address's admin limit, and an address over it gets the 429 even with the
    right one. An admin token that has only expired is no guess, so it does not count."""
    admin_pwd = config.ADMIN_PASSWORD
    if not admin_pwd:
        return False
    client_ip = limit_key(request)
    check_login_rate_limit(client_ip)
    for header, value in _presented(request):
        if header == PASSWORD_HEADER and passphrase_matches(value):
            return True
        status = _token_status(value, _signing_secret(admin_pwd))
        if status == "valid":
            return True
        if status == "invalid":
            record_credential_failure(client_ip, value)
    return False


async def require_admin(request: Request) -> None:
    """Route dependency: 403 unless the request comes from the owner. Async, like the login
    route: checking the limit, comparing and counting a failure are one step on the event
    loop."""
    if not enabled():
        raise HTTPException(status_code=403, detail=ADMIN_OFF_DETAIL)
    if not is_admin(request):
        raise HTTPException(status_code=403, detail=ADMIN_LOCKED_DETAIL)
