"""Who may open the Server settings page: whoever knows ADMIN_PASSWORD, on top of the studio
passphrase. A refusal is 403, never 401 (which the studio takes for a signed-out session)."""

import pytest

from backend import admin_auth, config, server_settings
from backend.auth import create_session_token

ADMIN = "owner-only-words"


@pytest.fixture
def owner(monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", ADMIN)
    return {"X-Admin-Password": ADMIN}


def unlock(client) -> str:
    res = client.post("/api/admin/login", json={"password": ADMIN})
    assert res.status_code == 200, res.text
    return res.json()["token"]


# --- A server without an admin passphrase ---


def test_without_an_admin_passphrase_the_page_is_off(client):
    assert client.get("/api/admin/status").json() == {"enabled": False, "authenticated": False}
    assert client.get("/api/auth/status").json()["admin"] is False

    for res in (
        client.get("/api/admin/settings"),
        client.put("/api/admin/settings", json={"values": {"render.prewarm": False}}),
        client.post("/api/admin/login", json={"password": "anything"}),
    ):
        assert res.status_code == 403
        assert "ADMIN_PASSWORD" in res.json()["detail"]
    assert server_settings.saved() == {}


def test_the_studio_passphrase_is_no_admin_passphrase_when_none_is_set(client):
    res = client.get("/api/admin/settings", headers={"X-Admin-Password": config.APP_PASSWORD})

    assert res.status_code == 403


# --- Unlocking ---


def test_the_studio_learns_that_the_server_has_an_owner(client, owner):
    assert client.get("/api/auth/status").json()["admin"] is True
    assert client.get("/api/admin/status").json() == {"enabled": True, "authenticated": False}


def test_the_admin_passphrase_is_traded_for_a_token(client, owner):
    token = unlock(client)

    assert token and token != ADMIN
    headers = {"X-Admin-Token": token}
    assert client.get("/api/admin/status", headers=headers).json() == {
        "enabled": True,
        "authenticated": True,
    }
    assert client.get("/api/admin/settings", headers=headers).status_code == 200


def test_a_script_may_send_the_passphrase_itself(client, owner):
    assert client.get("/api/admin/settings", headers=owner).status_code == 200


def test_spaces_around_the_passphrase_are_forgiven_at_login(client, owner):
    res = client.post("/api/admin/login", json={"password": f"  {ADMIN} "})

    assert res.status_code == 200


# --- Refusals ---


def test_a_signed_in_singer_is_refused_without_the_admin_passphrase(client, owner):
    for res in (
        client.get("/api/admin/settings"),
        client.put("/api/admin/settings", json={"values": {"render.prewarm": False}}),
    ):
        assert res.status_code == 403
        assert res.json()["detail"] == admin_auth.ADMIN_LOCKED_DETAIL
    assert server_settings.saved() == {}


def test_a_wrong_admin_passphrase_is_403_not_401(client, owner):
    """The studio signs a singer out on any 401."""
    wrong_login = client.post("/api/admin/login", json={"password": "guess"})
    wrong_header = client.get("/api/admin/settings", headers={"X-Admin-Password": "guess"})
    wrong_token = client.get("/api/admin/settings", headers={"X-Admin-Token": "abc.def"})

    assert [wrong_login.status_code, wrong_header.status_code, wrong_token.status_code] == [
        403,
        403,
        403,
    ]
    assert wrong_login.json()["detail"] == "Incorrect admin passphrase"
    # The singer's session still works
    assert client.get("/api/projects").status_code == 200


def test_the_admin_routes_need_the_studio_passphrase_too(unauth_client, owner):
    res = unauth_client.get("/api/admin/settings", headers=owner)

    assert res.status_code == 401


def test_a_studio_session_token_is_not_an_admin_token(client, owner):
    session = create_session_token(config.APP_PASSWORD, "Ana")

    res = client.get("/api/admin/settings", headers={"X-Admin-Token": session})

    assert res.status_code == 403


def test_the_two_kinds_of_token_stay_apart_when_both_passphrases_are_the_same(client, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_PASSWORD", config.APP_PASSWORD)
    session = create_session_token(config.APP_PASSWORD, "Ana")

    as_session = client.get("/api/admin/settings", headers={"X-Admin-Token": session})
    as_admin = client.get(
        "/api/admin/settings", headers={"X-Admin-Token": admin_auth.create_admin_token()}
    )

    assert as_session.status_code == 403
    assert as_admin.status_code == 200


def test_an_admin_token_does_not_sign_a_singer_in(unauth_client, owner):
    token = admin_auth.create_admin_token()

    res = unauth_client.get("/api/projects", headers={"X-App-Password": token})

    assert res.status_code == 401


def test_changing_the_admin_passphrase_ends_the_owners_sessions(client, owner, monkeypatch):
    token = unlock(client)

    monkeypatch.setattr(config, "ADMIN_PASSWORD", "new-owner-words")

    assert client.get("/api/admin/settings", headers={"X-Admin-Token": token}).status_code == 403


def test_the_admin_passphrase_is_never_read_from_a_cookie(client, owner):
    """Only headers a page must set itself count, so another website's request, which could
    carry cookies, never comes from the owner."""
    client.cookies.set("admin_token", admin_auth.create_admin_token())
    client.cookies.set("x-admin-token", admin_auth.create_admin_token())

    assert client.get("/api/admin/settings").status_code == 403


# --- Guessing ---


def test_wrong_admin_passphrases_run_into_the_login_limit(client, owner, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 3)

    answers = [
        client.post("/api/admin/login", json={"password": f"guess {n}"}).status_code
        for n in range(4)
    ]

    assert answers == [403, 403, 403, 429]
    # Limited, even the right passphrase waits
    assert client.post("/api/admin/login", json={"password": ADMIN}).status_code == 429


def test_guesses_in_the_header_count_once_each(client, owner, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 2)
    wrong = {"X-Admin-Password": "guess"}

    # The same wrong value again is not another guess
    assert [client.get("/api/admin/settings", headers=wrong).status_code for _ in range(3)] == [
        403,
        403,
        403,
    ]
    other = client.get("/api/admin/settings", headers={"X-Admin-Password": "another"})
    assert other.status_code == 403
    assert client.get("/api/admin/settings", headers=owner).status_code == 429


def test_guessing_at_the_admin_passphrase_locks_nobody_out_of_the_studio(
    client, owner, monkeypatch
):
    """A room of singers shares one address: admin guesses are counted apart."""
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 2)
    for n in range(3):
        client.post("/api/admin/login", json={"password": f"guess {n}"})
    assert client.post("/api/admin/login", json={"password": ADMIN}).status_code == 429

    assert client.get("/api/projects").status_code == 200
    assert client.post("/api/auth/login", json={"password": config.APP_PASSWORD}).status_code == 200


def test_a_limited_address_reads_as_locked_not_as_an_error(client, owner, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 1)
    client.post("/api/admin/login", json={"password": "guess"})

    res = client.get("/api/admin/status", headers=owner)

    assert res.status_code == 200
    assert res.json() == {"enabled": True, "authenticated": False}


def test_unlocking_clears_the_addresss_earlier_misses(client, owner, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 3)
    for n in range(2):
        client.post("/api/admin/login", json={"password": f"guess {n}"})

    unlock(client)

    for n in range(2):
        assert client.post("/api/admin/login", json={"password": f"more {n}"}).status_code == 403
