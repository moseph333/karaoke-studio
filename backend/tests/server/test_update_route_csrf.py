"""A web page cannot start an update with a visitor's cookie: a cookie-authenticated (or
open-access) update request must be JSON, which a cross-site page cannot send without a
CORS preflight. Scripts that send X-App-Password may post any content type."""

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import app


@pytest.fixture(autouse=True)
def no_git(monkeypatch):
    requested = []
    monkeypatch.setattr(config, "check_for_updates", lambda force_remote=False: {"status": "ok"})
    monkeypatch.setattr(
        config, "trigger_system_update", lambda: requested.append(True) or {"status": "updating"}
    )
    return requested


@pytest.fixture
def cookie_client(auth_cookies):
    return TestClient(app, cookies=auth_cookies)


@pytest.mark.parametrize("path", ["/api/system/update", "/api/health"])
def test_a_text_plain_update_with_a_cookie_is_refused(cookie_client, no_git, path):
    res = cookie_client.post(
        path, content=b'{"action":"update"}', headers={"Content-Type": "text/plain"}
    )
    assert res.status_code == 415
    assert no_git == []


def test_a_form_post_on_an_open_install_is_refused(unauth_client, monkeypatch, no_git):
    monkeypatch.setattr(config, "APP_PASSWORD", "")
    res = unauth_client.post("/api/system/update", data={"action": "update"})
    assert res.status_code == 415
    assert no_git == []


def test_a_json_update_with_a_cookie_goes_through(cookie_client, no_git):
    res = cookie_client.post("/api/system/update", json={"action": "update"})
    assert res.status_code == 200
    assert no_git == [True]


def test_a_script_with_the_passphrase_header_may_post_any_type(auth_headers, no_git):
    script = TestClient(app, headers=auth_headers)
    res = script.post(
        "/api/system/update",
        content=b'{"action":"update"}',
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert res.status_code == 200
    assert no_git == [True]


def test_a_body_that_is_not_json_is_a_400(client, no_git):
    res = client.post(
        "/api/system/update", content=b"{action", headers={"Content-Type": "application/json"}
    )
    assert res.status_code == 400
    assert no_git == []


def test_an_empty_body_still_checks(cookie_client, no_git):
    assert cookie_client.post("/api/system/update").status_code == 200
    assert no_git == []
