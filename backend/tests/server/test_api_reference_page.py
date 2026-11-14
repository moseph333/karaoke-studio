"""The interactive API reference at /api/docs and its OpenAPI schema."""

import backend.main as main_mod
from backend.routers.api_docs import SCALAR_SCRIPT, docs_page_html


def test_the_reference_page_loads_scalar_over_the_studio_schema(client):
    res = client.get("/api/docs")
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/html")
    assert res.headers["cache-control"] == "no-cache"
    assert SCALAR_SCRIPT in res.text
    assert "@scalar/api-reference@1." in SCALAR_SCRIPT  # pinned, never "latest"
    assert '"url": "/api/openapi.json"' in res.text


def test_the_schema_lists_the_routes_and_the_auth_schemes(client):
    res = client.get("/api/openapi.json")
    assert res.status_code == 200
    schema = res.json()
    assert schema["info"]["title"] == "Karaoke Studio API"
    assert "/api/projects" in schema["paths"]
    assert "/api/docs" not in schema["paths"]
    schemes = schema["components"]["securitySchemes"]
    assert schemes["passphrase"] == {
        "type": "apiKey",
        "in": "header",
        "name": "X-App-Password",
        "description": "The studio passphrase (APP_PASSWORD).",
    }
    assert {"sessionToken", "sessionCookie"} <= set(schemes)
    assert {} in schema["security"]  # open access while no passphrase is set


def test_both_sit_behind_the_passphrase(unauth_client):
    assert unauth_client.get("/api/docs").status_code == 401
    assert unauth_client.get("/api/openapi.json").status_code == 401


def test_fastapis_unguarded_default_pages_are_off(client):
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
    assert main_mod.app.docs_url is None and main_mod.app.redoc_url is None


def test_a_title_cannot_break_out_of_the_page():
    page = docs_page_html("</script><b>x</b>")
    assert "<title>&lt;/script&gt;&lt;b&gt;x&lt;/b&gt;</title>" in page
    config_line = next(line for line in page.splitlines() if "createApiReference" in line)
    assert "<" not in config_line.split("createApiReference")[1]
