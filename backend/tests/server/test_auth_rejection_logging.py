"""Auth events reach the log: sign-ins, sign-outs, and refused credentials (once per client
IP and window, since a stale session resends them with every request)."""

import logging

import pytest

from backend import config

PASSPHRASE = "rejection-log-passphrase"


@pytest.fixture(autouse=True)
def passphrase(monkeypatch):
    monkeypatch.setattr(config, "APP_PASSWORD", PASSPHRASE)


def test_wrong_credentials_are_logged_once_per_window(unauth_client, caplog):
    caplog.set_level(logging.WARNING, logger="karaoke_backend")
    headers = {"X-Forwarded-For": "203.0.113.5"}
    for i in range(3):
        res = unauth_client.get("/api/projects", headers={**headers, "X-App-Password": f"w{i}"})
        assert res.status_code == 401
    rejections = [r for r in caplog.records if "Rejected wrong or expired" in r.getMessage()]
    assert len(rejections) == 1
    assert "203.0.113.5" in rejections[0].getMessage()


def test_a_request_without_credentials_is_not_logged(unauth_client, caplog):
    caplog.set_level(logging.WARNING, logger="karaoke_backend")
    assert unauth_client.get("/api/projects").status_code == 401
    assert "Rejected" not in caplog.text


def test_sign_in_and_out_are_logged(unauth_client, caplog):
    caplog.set_level(logging.INFO, logger="karaoke_backend")
    res = unauth_client.post("/api/auth/login", json={"password": PASSPHRASE, "username": "Ann"})
    assert res.status_code == 200
    unauth_client.post("/api/auth/logout")
    assert "Signed in user Ann" in caplog.text
    assert "Signed out a session" in caplog.text


def test_a_blank_passphrase_is_logged(unauth_client, caplog):
    caplog.set_level(logging.WARNING, logger="karaoke_backend")
    assert unauth_client.post("/api/auth/login", json={"password": " "}).status_code == 401
    assert "Login without a passphrase" in caplog.text
