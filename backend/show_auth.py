"""A sign-in that only runs a show: whoever knows SHOW_PASSWORD.

A show (the host screen of a karaoke night, ``/?show=1``) may be run by somebody who should
not have the studio: a venue's host needs the queue, the library's songs and the karaoke
videos, not the means to edit or delete anything. SHOW_PASSWORD is a second passphrase for
them. The host screen trades it for a show token (signed like a session token, with a key of
its own, good for seven days), sent in ``X-Show-Token`` and, for the media a page loads by
itself (the song's audio, a video's copy, the cover art), in the ``show_token`` cookie.

A show token opens only what a show reads (``ALLOWED``): the list of songs, one song, its
cover art, the capabilities, the YouTube search, the show's video routes and the media under
``/static``. Anything else answers 403, never 401: the studio takes a 401 from any route to
mean its session ended. With SHOW_PASSWORD unset there are no show tokens and the show is run
with the studio passphrase; on a server with no studio passphrase everything is open anyway.

Wrong show passphrases are limited per address like wrong studio ones (the same counts and
window), but counted apart from them, as the admin passphrase's are.
"""

import hmac
import re

from fastapi import HTTPException, Request

from backend import config
from backend.auth import (
    _token_status,
    check_login_rate_limit,
    create_session_token,
    get_client_ip,
    record_credential_failure,
)

TOKEN_HEADER = "x-show-token"
COOKIE_NAME = "show_token"
TOKEN_MAX_AGE_SEC = 60 * 60 * 24 * 7

SHOW_OFF_DETAIL = "This server has no show passphrase. Sign in with the studio passphrase."
WRONG_PASSPHRASE_DETAIL = "Incorrect show passphrase"
SHOW_ONLY_DETAIL = (
    "This sign-in only runs the show. Sign in with the studio passphrase to do anything else."
)

_READ = frozenset({"GET", "HEAD"})
_POST = frozenset({"POST"})
# What a show token may ask for: (methods, the whole path)
ALLOWED: tuple[tuple[frozenset[str], re.Pattern[str]], ...] = (
    (_READ, re.compile(r"/static/.+")),
    (_READ, re.compile(r"/api/projects")),
    (_READ, re.compile(r"/api/project/[^/]+")),
    (_READ, re.compile(r"/api/project/[^/]+/backdrop")),
    (_READ, re.compile(r"/api/capabilities")),
    (_POST, re.compile(r"/api/search")),
    (_READ, re.compile(r"/api/show/videos/[^/]+")),
    (_READ, re.compile(r"/api/show/videos/[^/]+/file")),
    (_POST, re.compile(r"/api/show/videos/[^/]+/fetch")),
)


def enabled() -> bool:
    """Whether a venue can sign in to run a show only: both passphrases are set (without a
    studio passphrase nothing needs a sign-in)."""
    return bool(config.SHOW_PASSWORD and config.APP_PASSWORD)


def _signing_secret(show_pwd: str) -> str:
    """What show tokens are signed with. The prefix keeps them apart from session and admin
    tokens even on a server where two passphrases are the same."""
    return "show\0" + show_pwd


def create_show_token() -> str:
    """A token for the host's browser, or "" when the server has no show passphrase."""
    if not enabled():
        return ""
    return create_session_token(_signing_secret(config.SHOW_PASSWORD), client_id="show")


def passphrase_matches(candidate: str) -> bool:
    show_pwd = config.SHOW_PASSWORD
    if not show_pwd or not candidate:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), show_pwd.encode("utf-8"))


def limit_key(request: Request) -> str:
    """The name an address's show guesses are counted under, apart from its studio ones."""
    return "show|" + get_client_ip(request)


def _presented(request: Request) -> list[str]:
    """The show tokens a request carries: the header's, else the cookie's."""
    header = (request.headers.get(TOKEN_HEADER) or "").strip()
    if header:
        return [header]
    cookie = (request.cookies.get(COOKIE_NAME) or "").strip()
    return [cookie] if cookie else []


def holds_token(request: Request) -> bool:
    """Whether the request carries a valid show token. A forged one counts against the
    address's show limit, and an address over it gets the 429 (an HTTPException) even with a
    good one; a token that has only expired is no guess."""
    if not enabled():
        return False
    tokens = _presented(request)
    if not tokens:
        return False
    key = limit_key(request)
    check_login_rate_limit(key)
    for token in tokens:
        status = _token_status(token, _signing_secret(config.SHOW_PASSWORD), TOKEN_MAX_AGE_SEC)
        if status == "valid":
            return True
        if status == "invalid":
            record_credential_failure(key, token)
    return False


def holds_token_within_limit(request: Request) -> bool:
    """``holds_token`` for routes that answer either way: False while the address is over
    the limit."""
    try:
        return holds_token(request)
    except HTTPException:
        return False


def allows(method: str, path: str) -> bool:
    """Whether a show token may make this request."""
    return any(method in methods and pattern.fullmatch(path) for methods, pattern in ALLOWED)
