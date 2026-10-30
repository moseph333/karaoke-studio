"""Responses: API JSON is gzipped, media is not, hashed frontend assets are cacheable for a
year, and a song can only render one video at a time."""

import threading

import pytest

from backend import config
from backend.http_delivery import IMMUTABLE_ASSET_CACHE, cache_control_for, compressible_path
from backend.main import active_cancellations, projects


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/api/projects", True),
        ("/api/project/abc", True),
        ("/assets/index-1a2b3c.js", True),
        ("/api/project/abc/export/audio/vocals", False),
        ("/api/project/abc/backdrop", False),
        ("/static/output/abc_master.wav", False),
        ("/", False),
    ],
)
def test_only_text_responses_are_compressed(path, expected):
    assert compressible_path(path) is expected


@pytest.mark.parametrize(
    ("path", "status", "expected"),
    [
        ("/assets/index-1a2b3c.js", 200, IMMUTABLE_ASSET_CACHE),
        ("/assets/missing.js", 404, None),
        ("/", 200, "no-cache"),
        ("/index.html", 200, "no-cache"),
        ("/api/projects", 200, None),
        ("/static/output/abc.mp4", 200, None),
    ],
)
def test_cache_policy_for_frontend_files(path, status, expected):
    assert cache_control_for(path, status) == expected


def test_large_api_responses_are_gzipped(client):
    for i in range(5):
        projects[f"gz{i}"] = {
            "id": f"gz{i}",
            "title": f"Song {i}",
            "status": "ready",
            "lines": [{"id": n, "text": "na " * 20} for n in range(20)],
        }

    res = client.get("/api/projects", headers={"Accept-Encoding": "gzip"})

    assert res.status_code == 200
    assert res.headers.get("content-encoding") == "gzip"
    assert len(res.json()) == 5


def test_media_is_served_uncompressed(client):
    (config.OUTPUT_DIR / "plain_master.wav").write_bytes(b"RIFF" + b"\x00" * 8192)

    res = client.get("/static/output/plain_master.wav", headers={"Accept-Encoding": "gzip"})

    assert res.status_code == 200
    assert "content-encoding" not in res.headers


@pytest.fixture
def renderable(tmp_path):
    inst = tmp_path / "inst.wav"
    inst.write_bytes(b"RIFF" + b"\x00" * 64)
    projects["twice"] = {
        "id": "twice",
        "status": "ready",
        "lines": [],
        "instrumental_path": str(inst),
    }
    return "twice"


def test_a_second_render_request_is_refused_while_one_runs(client, renderable):
    active_cancellations[f"{renderable}_render"] = threading.Event()  # a render in progress

    res = client.post(f"/api/project/{renderable}/render", json={})

    assert res.status_code == 409
    assert res.json()["detail"] == "A video is already rendering for this song"


def test_a_cancelled_render_does_not_block_the_next_request(client, renderable):
    winding_down = threading.Event()
    winding_down.set()
    active_cancellations[f"{renderable}_render"] = winding_down

    res = client.post(f"/api/project/{renderable}/render", json={})

    assert res.status_code == 200
