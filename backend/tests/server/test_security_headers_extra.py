"""API and media responses are sandboxed by a CSP; every response turns off browser features
the studio never uses and isolates its window from openers."""

from backend import config
from backend.middleware import API_AND_MEDIA_CSP, PERMISSIONS_POLICY


def test_api_responses_are_sandboxed(client):
    res = client.get("/api/health")
    assert res.headers["Content-Security-Policy"] == API_AND_MEDIA_CSP
    assert res.headers["Permissions-Policy"] == PERMISSIONS_POLICY
    assert res.headers["Cross-Origin-Opener-Policy"] == "same-origin"


def test_static_media_is_sandboxed(client):
    (config.BACKGROUNDS_DIR / "bg.html").write_text("<script>alert(1)</script>")
    res = client.get("/static/backgrounds/bg.html")
    assert res.status_code == 200
    assert "sandbox" in res.headers["Content-Security-Policy"]


def test_a_401_is_sandboxed_too(unauth_client):
    res = unauth_client.get("/api/projects")
    assert res.status_code == 401
    assert res.headers["Content-Security-Policy"] == API_AND_MEDIA_CSP


def test_the_api_reference_page_is_not_sandboxed(client):
    res = client.get("/api/docs")
    assert res.status_code == 200
    assert "Content-Security-Policy" not in res.headers
