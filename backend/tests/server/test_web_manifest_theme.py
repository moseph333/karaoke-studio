"""The web app manifest follows the app theme a device chose: ``/manifest.json?bg=<hex>``
answers with the built manifest in that colour, which Chrome on Android paints under the
gesture pill and on the splash screen of the installed app."""

import json

import pytest
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.testclient import TestClient

from backend.web_manifest import manifest_router, themed_manifest

BUILT = {
    "id": "/",
    "name": "Karaoke Studio",
    "theme_color": "#0b0b12",
    "background_color": "#0b0b12",
    "shortcuts": [{"name": "New song", "url": "/?shortcut=new"}],
}


@pytest.fixture
def served(tmp_path):
    """A client for an app that serves a built frontend the way main.py does."""
    (tmp_path / "manifest.json").write_text(json.dumps(BUILT), encoding="utf-8")
    (tmp_path / "index.html").write_text("<!doctype html>", encoding="utf-8")
    app = FastAPI()
    app.include_router(manifest_router(tmp_path))
    app.mount("/", StaticFiles(directory=str(tmp_path), html=True), name="frontend")
    return TestClient(app)


def test_the_manifest_takes_the_colour_of_the_chosen_theme(served):
    res = served.get("/manifest.json", params={"bg": "F4F4F0"})

    assert res.status_code == 200
    assert res.headers["content-type"].startswith("application/manifest+json")
    manifest = res.json()
    assert manifest["theme_color"] == "#f4f4f0"
    assert manifest["background_color"] == "#f4f4f0"
    # Everything else is the built manifest: the same app, only recoloured
    assert {k: v for k, v in manifest.items() if not k.endswith("_color")} == {
        k: v for k, v in BUILT.items() if not k.endswith("_color")
    }


def test_the_manifest_is_served_as_built_without_a_colour(served):
    res = served.get("/manifest.json")

    assert res.status_code == 200
    assert res.json() == BUILT


@pytest.mark.parametrize("bg", ["", "fff", "#f4f4f0", "zzzzzz", "f4f4f0ff", 'f4f4f0"}'])
def test_anything_but_six_hex_digits_is_ignored(served, bg):
    res = served.get("/manifest.json", params={"bg": bg})

    assert res.status_code == 200
    assert res.json() == BUILT


def test_a_build_without_a_manifest_answers_404(tmp_path):
    app = FastAPI()
    app.include_router(manifest_router(tmp_path))

    assert TestClient(app).get("/manifest.json", params={"bg": "f4f4f0"}).status_code == 404


def test_a_manifest_that_is_not_an_object_is_left_alone():
    assert themed_manifest(b"[]", "f4f4f0") is None
    assert themed_manifest(b"not json", "f4f4f0") is None
