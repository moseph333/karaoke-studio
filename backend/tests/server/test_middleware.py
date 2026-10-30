"""The pure ASGI middleware: passphrase auth and security headers."""

from starlette.middleware.base import BaseHTTPMiddleware

import backend.main as main_mod
from backend import config
from backend.http_delivery import CompressTextResponses
from backend.middleware import PassphraseAuth, SecurityHeaders

SECURITY_HEADERS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
}


def _has_security_headers(response) -> bool:
    return all(response.headers.get(name) == value for name, value in SECURITY_HEADERS.items())


def test_no_base_http_middleware_and_the_same_order():
    classes = [m.cls for m in main_mod.app.user_middleware]
    assert BaseHTTPMiddleware not in classes
    # Outermost first: compression wraps the headers, which wrap auth (so a 401 has them)
    assert classes.index(CompressTextResponses) < classes.index(SecurityHeaders)
    assert classes.index(SecurityHeaders) < classes.index(PassphraseAuth)


def test_a_401_carries_the_security_headers(unauth_client):
    res = unauth_client.get("/api/projects")
    assert res.status_code == 401
    assert res.json() == {"detail": "Invalid or missing studio passphrase"}
    assert _has_security_headers(res)


def test_authenticated_responses_carry_them_too(client):
    res = client.get("/api/projects")
    assert res.status_code == 200
    assert _has_security_headers(res)


def test_the_passphrase_is_read_on_each_request(unauth_client, monkeypatch):
    assert unauth_client.get("/api/projects").status_code == 401
    monkeypatch.setattr(config, "APP_PASSWORD", "")
    assert unauth_client.get("/api/projects").status_code == 200


def test_open_and_protected_routes(unauth_client, monkeypatch):
    monkeypatch.setattr(config, "check_for_updates", lambda force_remote=False: {"ok": True})
    assert unauth_client.get("/api/auth/status").status_code == 200
    assert unauth_client.get("/api/health").status_code == 200
    assert unauth_client.post("/api/health", json={"action": "check"}).status_code == 401
    assert unauth_client.post("/api/system/update", json={}).status_code == 401
    assert unauth_client.get("/static/output/anything.wav").status_code == 401


def test_range_requests_pass_through(client):
    media = main_mod.OUTPUT_DIR / "ranged.wav"
    media.write_bytes(bytes(range(256)) * 16)

    res = client.get("/static/output/ranged.wav", headers={"Range": "bytes=10-19"})

    assert res.status_code == 206
    assert res.content == bytes(range(10, 20))
    assert res.headers["content-range"] == f"bytes 10-19/{256 * 16}"
    assert _has_security_headers(res)
