"""Only /api/auth/* (and GET /api/health) answer without a session."""

import pytest

from backend import config


@pytest.fixture(autouse=True)
def passphrase(monkeypatch):
    monkeypatch.setattr(config, "APP_PASSWORD", "public-paths-passphrase")


def test_the_auth_routes_are_public(unauth_client):
    assert unauth_client.get("/api/auth/status").status_code == 200
    assert unauth_client.post("/api/auth/logout").status_code == 200


@pytest.mark.parametrize("path", ["/api/authority", "/api/authors", "/api/auth-export"])
def test_paths_that_only_start_like_auth_need_a_session(unauth_client, path):
    assert unauth_client.get(path).status_code == 401
