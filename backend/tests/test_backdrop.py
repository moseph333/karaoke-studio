"""Cover-art backdrop endpoint: the stage preview is served the still that exports draw."""

import os
import subprocess
from pathlib import Path

import pytest

import backend.main as main_mod
from backend.main import projects
from backend.services import video_renderer as vr


@pytest.fixture
def ffmpeg_runs(monkeypatch):
    """Stands in for the one-off FFmpeg still step, writing a PNG and recording each command."""
    calls: list[list[str]] = []

    def run(cmd, *args, **kwargs):
        calls.append(list(cmd))
        Path(cmd[-1]).write_bytes(b"\x89PNG backdrop")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(vr.subprocess, "run", run)
    return calls


@pytest.fixture
def art_project():
    pid = "art01"
    thumbnail = main_mod.DOWNLOADS_DIR / "art01.jpg"
    thumbnail.write_bytes(b"jpeg cover")
    projects[pid] = {
        "id": pid,
        "title": "Cover",
        "status": "ready",
        "thumbnail_path": str(thumbnail),
    }
    yield projects[pid]
    projects.pop(pid, None)


def _backdrops() -> list[str]:
    return sorted(p.name for p in main_mod.OUTPUT_DIR.glob("art01_backdrop_*"))


def test_the_backdrop_is_the_export_still_rendered_once(client, art_project, ffmpeg_runs):
    res = client.get(f"/api/project/{art_project['id']}/backdrop")

    assert res.status_code == 200
    assert res.headers["content-type"] == "image/png"
    assert res.headers["cache-control"] == "no-cache"
    assert res.content == b"\x89PNG backdrop"
    assert len(ffmpeg_runs) == 1
    _, _, chain = vr.artwork_still(1920, 1080)
    assert ffmpeg_runs[0][ffmpeg_runs[0].index("-vf") + 1] == chain
    assert ffmpeg_runs[0][ffmpeg_runs[0].index("-i") + 1] == art_project["thumbnail_path"]

    assert client.get(f"/api/project/{art_project['id']}/backdrop").status_code == 200
    assert len(ffmpeg_runs) == 1  # served from the cache
    [name] = _backdrops()
    assert name.startswith("art01_backdrop_1920x1080_") and name.endswith(".png")


def test_portrait_and_drift_stills_have_their_own_sizes(client, art_project, ffmpeg_runs):
    pid = art_project["id"]
    assert client.get(f"/api/project/{pid}/backdrop", params={"aspect": "9:16"}).status_code == 200
    assert client.get(f"/api/project/{pid}/backdrop", params={"drift": 1}).status_code == 200
    params = {"aspect": "9:16", "drift": "true"}
    assert client.get(f"/api/project/{pid}/backdrop", params=params).status_code == 200

    sizes = {name.split("_")[2] for name in _backdrops()}
    assert sizes == {"1080x1920", "2150x1210", "1210x2150"}
    _, _, drift_chain = vr.artwork_still(1920, 1080, drift=True)
    assert [cmd[cmd.index("-vf") + 1] for cmd in ffmpeg_runs][1] == drift_chain


def test_a_new_thumbnail_replaces_the_cached_still(client, art_project, ffmpeg_runs):
    pid = art_project["id"]
    client.get(f"/api/project/{pid}/backdrop")
    [first] = _backdrops()

    thumbnail = Path(art_project["thumbnail_path"])
    thumbnail.write_bytes(b"a different, longer jpeg cover")
    later = thumbnail.stat().st_mtime + 5
    os.utime(thumbnail, (later, later))
    assert client.get(f"/api/project/{pid}/backdrop").status_code == 200

    assert len(ffmpeg_runs) == 2
    [second] = _backdrops()
    assert second != first


def test_songs_without_cover_art_and_bad_requests(client, art_project, ffmpeg_runs):
    pid = art_project["id"]
    assert client.get(f"/api/project/{pid}/backdrop", params={"aspect": "4:3"}).status_code == 422
    assert client.get("/api/project/does-not-exist/backdrop").status_code == 404

    art_project["thumbnail_path"] = str(main_mod.DOWNLOADS_DIR / "gone.jpg")
    assert client.get(f"/api/project/{pid}/backdrop").status_code == 404
    # A remote thumbnail URL alone is not art the export can draw
    art_project.pop("thumbnail_path")
    art_project["thumbnail_url"] = "https://i.ytimg.com/vi/x/hqdefault.jpg"
    assert client.get(f"/api/project/{pid}/backdrop").status_code == 404
    assert ffmpeg_runs == []


def test_a_failed_still_step_reports_an_error_and_leaves_nothing(client, art_project, monkeypatch):
    def run(cmd, *args, **kwargs):
        Path(cmd[-1]).write_bytes(b"")  # FFmpeg died after creating the file
        return subprocess.CompletedProcess(cmd, 1, "", "Invalid data found")

    monkeypatch.setattr(vr.subprocess, "run", run)
    res = client.get(f"/api/project/{art_project['id']}/backdrop")

    assert res.status_code == 500
    assert list(main_mod.OUTPUT_DIR.glob("art01_*")) == []


def test_the_backdrop_needs_a_session(unauth_client, art_project, ffmpeg_runs):
    assert unauth_client.get(f"/api/project/{art_project['id']}/backdrop").status_code == 401
    assert ffmpeg_runs == []


def test_deleting_the_song_removes_its_backdrops(client, art_project, ffmpeg_runs):
    pid = art_project["id"]
    client.get(f"/api/project/{pid}/backdrop")
    client.get(f"/api/project/{pid}/backdrop", params={"drift": 1})
    assert len(_backdrops()) == 2

    assert client.delete(f"/api/project/{pid}").status_code == 200
    assert _backdrops() == []
