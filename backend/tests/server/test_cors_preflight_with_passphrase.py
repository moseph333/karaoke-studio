"""A studio served from another origin works behind the passphrase.

Browsers send a CORS preflight (OPTIONS) without credentials. The CORS middleware sat inside
the passphrase check, so with APP_PASSWORD set every preflight answered 401 and no request
from an allowed origin could follow; the 401s themselves had no CORS headers, so the page
could not even read them to show the login."""

ORIGIN = "http://localhost:5173"


def _preflight(client, origin=ORIGIN, method="POST"):
    return client.options(
        "/api/process",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": method,
            "Access-Control-Request-Headers": "content-type,x-session-token",
        },
    )


def test_a_preflight_from_an_allowed_origin_is_answered_without_credentials(unauth_client):
    res = _preflight(unauth_client)

    assert res.status_code == 200
    assert res.headers["access-control-allow-origin"] == ORIGIN
    assert res.headers["access-control-allow-credentials"] == "true"
    assert "x-session-token" in res.headers["access-control-allow-headers"].lower()


def test_a_preflight_from_another_origin_is_still_refused(unauth_client):
    res = _preflight(unauth_client, origin="https://evil.example")

    assert res.status_code == 400
    assert "access-control-allow-origin" not in res.headers


def test_a_401_can_be_read_by_the_page_at_an_allowed_origin(unauth_client):
    res = unauth_client.get("/api/projects", headers={"Origin": ORIGIN})

    assert res.status_code == 401
    assert res.headers["access-control-allow-origin"] == ORIGIN
    # Still inside the security headers
    assert res.headers["x-content-type-options"] == "nosniff"


def test_the_request_itself_still_needs_the_passphrase(unauth_client, client):
    headers = {"Origin": ORIGIN}

    assert unauth_client.get("/api/projects", headers=headers).status_code == 401
    assert client.get("/api/projects", headers=headers).status_code == 200


def test_another_origin_gets_no_cors_headers_on_its_401(unauth_client):
    res = unauth_client.get("/api/projects", headers={"Origin": "https://evil.example"})

    assert res.status_code == 401
    assert "access-control-allow-origin" not in res.headers
