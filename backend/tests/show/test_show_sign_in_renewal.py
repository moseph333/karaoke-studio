"""Renewing a show sign-in: a show token that is still good is traded for a new one.

A show token lasts seven days, and a venue runs a show every week: signed in at the start of
one night, it would be signed out during the next. The host screen asks for a new token when
it opens and while it is open (`POST /api/auth/show-renew`), so that does not happen. Only a
show token is renewed, only for one that is still good, and the answer is never a 401."""

import base64
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import auth, config, show_auth
from backend.main import app

SHOW = "host-of-the-night"
SONG = "song-1"
DAY = 24 * 60 * 60
WEEK = 7 * DAY
NOT_RENEWED = {"status": "none"}


def _show_token_made(seconds_ago: int, passphrase: str = SHOW) -> str:
    """A show token signed as the server signs them, stamped in the past."""
    payload = {"u": "show", "t": int(auth.time.time()) - seconds_ago, "s": "0" * 16}
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(body).decode("utf-8").rstrip("=")
    key = auth.session_signing_key(show_auth._signing_secret(passphrase))
    sig = hmac.new(key, payload_b64.encode("utf-8"), hashlib.sha256).digest()
    return f"{payload_b64}.{base64.urlsafe_b64encode(sig).decode('utf-8').rstrip('=')}"


@pytest.fixture
def show_on(monkeypatch):
    monkeypatch.setattr(config, "SHOW_PASSWORD", SHOW)


@pytest.fixture
def song():
    main_mod.projects[SONG] = {"id": SONG, "status": "ready", "title": "Neon Skyline"}
    return SONG


def _renew(headers: dict[str, str] | None = None, cookies: dict[str, str] | None = None):
    return TestClient(app, cookies=cookies or {}).post("/api/auth/show-renew", headers=headers)


def _seconds_left(token: str) -> int | None:
    status = TestClient(app).get("/api/auth/status", headers={"X-Show-Token": token}).json()
    return status["show_expires_in"]


def test_a_token_near_its_end_is_traded_for_a_whole_week(show_on):
    old = _show_token_made(6 * DAY)
    assert _seconds_left(old) <= DAY

    res = _renew({"X-Show-Token": old})

    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["token"] and body["token"] != old
    assert body["expires_in"] == WEEK
    assert WEEK - 5 <= _seconds_left(body["token"]) <= WEEK


def test_the_new_token_comes_as_the_cookie_too(show_on):
    res = _renew({"X-Show-Token": _show_token_made(DAY)})

    assert res.cookies.get(show_auth.COOKIE_NAME) == res.json()["token"]
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert f"max-age={WEEK}" in cookie


def test_the_new_token_runs_the_show(show_on, song):
    token = _renew({"X-Show-Token": _show_token_made(6 * DAY)}).json()["token"]
    venue = TestClient(app, headers={"X-Show-Token": token})

    assert venue.get(f"/api/project/{SONG}").status_code == 200
    # It is still a show sign-in and nothing more
    assert venue.delete(f"/api/project/{SONG}").status_code == 403


def test_the_cookie_alone_is_renewed(show_on):
    """The media a page loads carries only the cookie, so a browser may hold nothing else."""
    res = _renew(cookies={show_auth.COOKIE_NAME: _show_token_made(DAY)})

    assert res.json()["status"] == "ok"
    assert res.cookies.get(show_auth.COOKIE_NAME)


@pytest.mark.parametrize(
    "headers",
    [
        lambda: {},
        lambda: {"X-Show-Token": "not-a-token"},
        lambda: {"X-Show-Token": _show_token_made(DAY, passphrase="another-passphrase")},
    ],
    ids=["no token", "garbage", "signed with another passphrase"],
)
def test_nothing_is_given_without_a_good_show_token(show_on, headers):
    # Made in the test, not when the file is read: signing reads the server's secret
    res = _renew(headers())

    assert res.status_code == 200
    assert res.json() == NOT_RENEWED
    assert res.headers.get_list("set-cookie") == []


def test_a_token_that_has_run_out_is_not_renewed(show_on):
    """Renewal keeps a sign-in in use going; it does not bring an ended one back."""
    res = _renew({"X-Show-Token": _show_token_made(WEEK + 60)})

    assert res.status_code == 200
    assert res.json() == NOT_RENEWED
    assert res.headers.get_list("set-cookie") == []


def test_a_studio_session_is_not_traded_for_a_show_token(show_on):
    session = auth.create_session_token(config.APP_PASSWORD)

    res = _renew({"X-Session-Token": session})

    assert res.json() == NOT_RENEWED


def test_a_studio_session_is_never_renewed(show_on):
    """Only the show sign-in renews: the studio's keeps its seven days."""
    session = auth.create_session_token(config.APP_PASSWORD)

    res = _renew({"X-Session-Token": session, "X-Show-Token": _show_token_made(DAY)})

    cookies = " ".join(res.headers.get_list("set-cookie"))
    assert show_auth.COOKIE_NAME in cookies
    assert "session_token" not in cookies and "karaoke_token" not in cookies


def test_a_server_with_no_show_sign_in_renews_nothing():
    assert _renew({"X-Show-Token": _show_token_made(DAY)}).json() == NOT_RENEWED


def test_a_changed_show_passphrase_ends_the_sign_in_renewed_or_not(show_on, monkeypatch):
    token = _renew({"X-Show-Token": _show_token_made(DAY)}).json()["token"]

    monkeypatch.setattr(config, "SHOW_PASSWORD", "a-new-passphrase")

    assert _renew({"X-Show-Token": token}).json() == NOT_RENEWED
    assert _seconds_left(token) is None


def test_an_address_over_the_guess_limit_is_not_renewed(show_on):
    for guess in range(config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS):
        _renew({"X-Show-Token": f"guess-{guess}"})

    res = _renew({"X-Show-Token": _show_token_made(DAY)})

    assert res.status_code == 200
    assert res.json() == NOT_RENEWED


def test_renewing_is_not_one_of_the_requests_a_show_token_opens():
    """It needs no entry in the list: the sign-in routes are open to every request, and the
    route decides for itself. Kept out of the list so the list stays what a show reads."""
    assert not show_auth.allows("POST", "/api/auth/show-renew")
