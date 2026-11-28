"""The studio's own pages carry a Content-Security-Policy that runs script only from this
server and YouTube's player; files that are not pages, the offline page and the API keep
what they had; PAGE_CONTENT_SECURITY_POLICY replaces or drops the policy."""

import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from backend.middleware import API_AND_MEDIA_CSP, PAGE_CSP, SecurityHeaders, page_csp

FRONTEND = Path(__file__).resolve().parents[3] / "frontend"


@pytest.fixture
def site(tmp_path):
    """A built frontend in miniature behind the real middleware."""
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><div id=root></div>")
    (dist / "offline.html").write_text("<!doctype html><script>location.reload()</script>")
    (dist / "sw.js").write_text("self.addEventListener('fetch', () => {});")
    (dist / "assets" / "index-1a2b3c.js").write_text("console.log('app')")
    (dist / "manifest.json").write_text("{}")
    app = FastAPI()

    @app.get("/api/thing")
    def thing():
        return {"ok": True}

    @app.get("/own-policy", response_class=HTMLResponse)
    def own_policy():
        return HTMLResponse("<p>hi</p>", headers={"Content-Security-Policy": "default-src 'none'"})

    app.mount("/", StaticFiles(directory=str(dist), html=True), name="frontend")
    app.add_middleware(SecurityHeaders)
    return TestClient(app)


def _directives(policy: str) -> dict[str, list[str]]:
    parsed = {}
    for part in policy.split(";"):
        name, *sources = part.split()
        parsed[name] = sources
    return parsed


@pytest.mark.parametrize("path", ["/", "/index.html", "/?stage=1", "/?show=1"])
def test_the_studios_pages_carry_the_policy(site, path):
    res = site.get(path)

    assert res.status_code == 200
    assert res.headers["Content-Security-Policy"] == PAGE_CSP


def test_script_runs_only_from_this_server_and_youtubes_player():
    policy = _directives(PAGE_CSP)

    assert policy["script-src"] == ["'self'", "https://www.youtube.com"]
    assert policy["default-src"] == ["'self'"]
    assert policy["connect-src"] == ["'self'"]
    assert policy["object-src"] == ["'none'"]
    assert policy["base-uri"] == ["'self'"]
    assert policy["form-action"] == ["'self'"]
    assert policy["frame-ancestors"] == ["'none'"]
    assert "https://www.youtube.com" in policy["frame-src"]


def test_no_directive_that_loads_or_runs_code_allows_inline_eval_or_any_host():
    policy = _directives(PAGE_CSP)

    for name in ("default-src", "script-src", "connect-src", "frame-src", "worker-src"):
        for source in policy[name]:
            assert source not in ("'unsafe-inline'", "'unsafe-eval'", "*", "https:", "data:"), name


def test_artwork_and_previews_may_come_from_the_catalogs():
    policy = _directives(PAGE_CSP)

    assert "https:" in policy["img-src"]
    assert "https:" in policy["media-src"]


@pytest.mark.parametrize("path", ["/sw.js", "/assets/index-1a2b3c.js", "/manifest.json"])
def test_files_that_are_not_pages_get_no_policy(site, path):
    # On sw.js the page's policy would become the service worker's own
    res = site.get(path)

    assert res.status_code == 200
    assert "Content-Security-Policy" not in res.headers


def test_the_offline_page_keeps_its_inline_script(site):
    res = site.get("/offline.html")

    assert res.status_code == 200
    assert "Content-Security-Policy" not in res.headers


def test_api_responses_stay_sandboxed(site):
    assert site.get("/api/thing").headers["Content-Security-Policy"] == API_AND_MEDIA_CSP


def test_a_response_with_a_policy_of_its_own_keeps_it(site):
    assert site.get("/own-policy").headers["Content-Security-Policy"] == "default-src 'none'"


@pytest.mark.parametrize("value", ["off", "OFF", "none", "0"])
def test_the_policy_can_be_switched_off(site, monkeypatch, value):
    monkeypatch.setenv("PAGE_CONTENT_SECURITY_POLICY", value)

    assert page_csp() == ""
    assert "Content-Security-Policy" not in site.get("/").headers


def test_the_policy_can_be_replaced(site, monkeypatch):
    own = "default-src 'self'; script-src 'self' https://www.youtube.com https://cdn.example"
    monkeypatch.setenv("PAGE_CONTENT_SECURITY_POLICY", f"  {own}  ")

    assert site.get("/").headers["Content-Security-Policy"] == own


def test_an_empty_setting_keeps_the_built_in_policy(site, monkeypatch):
    monkeypatch.setenv("PAGE_CONTENT_SECURITY_POLICY", "  ")

    assert site.get("/").headers["Content-Security-Policy"] == PAGE_CSP


def test_the_page_has_no_inline_script_for_the_policy_to_block():
    """script-src has no hash and no 'unsafe-inline': a <script> without src, or an on*
    attribute, in index.html would silently stop running in production."""
    page = (FRONTEND / "index.html").read_text(encoding="utf-8")
    without_comments = re.sub(r"<!--.*?-->", "", page, flags=re.DOTALL)

    scripts = re.findall(r"<script\b[^>]*>", without_comments)
    assert scripts, "index.html loads the app with a script tag"
    assert all(re.search(r"\bsrc=", tag) for tag in scripts)
    assert not re.search(r"<[^>]+\son[a-z]+\s*=", without_comments)


def test_the_script_the_page_loads_from_elsewhere_is_the_one_the_policy_names():
    loader = (FRONTEND / "src" / "utils" / "youtube.ts").read_text(encoding="utf-8")

    assert "https://www.youtube.com/iframe_api" in loader
