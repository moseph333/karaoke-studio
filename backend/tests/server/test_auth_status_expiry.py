"""How long a sign-in has left, as `GET /api/auth/status` reports it.

A session token and a show token are good for seven days from when they were made. The status
says how many seconds each has left, so a screen that must not be signed out in the middle of
something (a show's host screen) can ask for the passphrase beforehand. A request signed in
with the passphrase itself carries nothing that runs out, and a request that is not signed in
is told nothing."""

import base64
import hashlib
import hmac
import json

import pytest
from fastapi.testclient import TestClient

from backend import auth, config, show_auth
from backend.main import app

WEEK = 7 * 24 * 60 * 60
SHOW = "host-of-the-night"


def _token_made(seconds_ago: int, secret: str) -> str:
    """A token signed as the server signs them, stamped in the past."""
    payload = {"u": "user", "t": int(auth.time.time()) - seconds_ago, "s": "0" * 16}
    body = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(body).decode("utf-8").rstrip("=")
    sig = hmac.new(
        auth.session_signing_key(secret), payload_b64.encode("utf-8"), hashlib.sha256
    ).digest()
    return f"{payload_b64}.{base64.urlsafe_b64encode(sig).decode('utf-8').rstrip('=')}"


@pytest.fixture
def show_on(monkeypatch):
    monkeypatch.setattr(config, "SHOW_PASSWORD", SHOW)


def _status(headers: dict[str, str]) -> dict:
    res = TestClient(app).get("/api/auth/status", headers=headers)
    assert res.status_code == 200, res.text
    return res.json()


def test_a_new_session_has_the_whole_week_left():
    token = auth.create_session_token(config.APP_PASSWORD)

    status = _status({"X-Session-Token": token})

    assert status["authenticated"] is True
    assert WEEK - 5 <= status["expires_in"] <= WEEK


def test_a_session_six_days_old_has_a_day_left():
    token = _token_made(6 * 24 * 60 * 60, config.APP_PASSWORD)

    status = _status({"X-Session-Token": token})

    assert 24 * 60 * 60 - 5 <= status["expires_in"] <= 24 * 60 * 60


def test_a_session_over_a_week_old_is_signed_out_and_told_nothing():
    token = _token_made(WEEK + 60, config.APP_PASSWORD)

    status = _status({"X-Session-Token": token})

    assert status["authenticated"] is False
    assert status["expires_in"] is None


def test_the_passphrase_itself_does_not_run_out():
    status = _status({"X-App-Password": config.APP_PASSWORD})

    assert status["authenticated"] is True
    assert status["expires_in"] is None


def test_a_request_that_is_not_signed_in_is_told_nothing():
    status = _status({})

    assert status["authenticated"] is False
    assert status["expires_in"] is None
    assert status["show_expires_in"] is None


def test_a_token_stamped_ahead_of_the_clock_is_good_for_no_more_than_a_week():
    token = _token_made(-120, config.APP_PASSWORD)

    assert _status({"X-Session-Token": token})["expires_in"] == WEEK


def test_a_show_sign_in_says_how_long_it_has_left(show_on):
    token = _token_made(5 * 24 * 60 * 60, show_auth._signing_secret(SHOW))

    status = _status({"X-Show-Token": token})

    assert status["show_authenticated"] is True
    assert 2 * 24 * 60 * 60 - 5 <= status["show_expires_in"] <= 2 * 24 * 60 * 60
    # It is not a studio session, so it has no time of that kind
    assert status["authenticated"] is False
    assert status["expires_in"] is None


def test_a_show_sign_in_over_a_week_old_is_told_nothing(show_on):
    token = _token_made(WEEK + 60, show_auth._signing_secret(SHOW))

    status = _status({"X-Show-Token": token})

    assert status["show_authenticated"] is False
    assert status["show_expires_in"] is None


def test_a_show_token_on_a_server_with_no_show_sign_in_is_told_nothing():
    token = _token_made(60, show_auth._signing_secret(SHOW))

    assert _status({"X-Show-Token": token})["show_expires_in"] is None


def test_both_sign_ins_are_told_apart(show_on):
    session = _token_made(24 * 60 * 60, config.APP_PASSWORD)
    show = _token_made(3 * 24 * 60 * 60, show_auth._signing_secret(SHOW))

    status = _status({"X-Session-Token": session, "X-Show-Token": show})

    assert 6 * 24 * 60 * 60 - 5 <= status["expires_in"] <= 6 * 24 * 60 * 60
    assert 4 * 24 * 60 * 60 - 5 <= status["show_expires_in"] <= 4 * 24 * 60 * 60
