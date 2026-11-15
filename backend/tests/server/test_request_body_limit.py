"""Oversized request bodies get 413 before they are read into memory or onto disk; uploads
keep their own, larger limits."""

import asyncio

import httpx
import pytest

from backend import config
from backend.main import app
from backend.middleware import body_limit_for
from backend.upload_utils import MAX_TRACK_UPLOAD_BYTES


@pytest.fixture(autouse=True)
def small_limit(monkeypatch):
    monkeypatch.setattr(config, "MAX_JSON_BODY_MB", 0.01)  # about 10 KB


def test_a_declared_oversized_json_body_is_refused(client):
    res = client.post(
        "/api/project/any/lyrics",
        content=b'{"lines": "' + b"x" * 20_000 + b'"}',
        headers={"Content-Type": "application/json"},
    )
    assert res.status_code == 413
    assert res.json()["detail"] == "The request is too large."
    assert res.headers["X-Content-Type-Options"] == "nosniff"


def test_a_body_without_a_length_is_counted_as_it_is_read(auth_headers):
    async def chunks():
        yield b'{"query": "'
        for _ in range(30):
            yield b"y" * 1000
        yield b'"}'

    async def post():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            return await ac.post(
                "/api/search",
                content=chunks(),
                headers={**auth_headers, "Content-Type": "application/json"},
            )

    res = asyncio.run(post())
    assert res.status_code == 413


def test_a_small_body_still_goes_through(client):
    res = client.post("/api/search", json={"query": ""})
    assert res.status_code != 413


def test_uploads_keep_their_own_limit():
    assert body_limit_for("/api/upload-track") > MAX_TRACK_UPLOAD_BYTES
    assert body_limit_for("/api/upload-track") > body_limit_for("/api/search")


def test_the_json_limit_follows_the_setting(monkeypatch):
    monkeypatch.setattr(config, "MAX_JSON_BODY_MB", 16)
    assert body_limit_for("/api/project/x/lyrics") == 16 * 1024 * 1024
