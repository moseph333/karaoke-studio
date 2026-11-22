"""The backdrop route serves the cover art the way a look treats it, so the stage shows the
image the video will."""

import subprocess
from pathlib import Path

import pytest

import backend.main as main_mod
from backend.main import projects
from backend.services import video_renderer as vr
from backend.services.stage_looks import LOOKS


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
    pid = "lookart01"
    thumbnail = main_mod.DOWNLOADS_DIR / "lookart01.jpg"
    thumbnail.write_bytes(b"jpeg cover")
    projects[pid] = {
        "id": pid,
        "title": "Cover",
        "status": "ready",
        "thumbnail_path": str(thumbnail),
    }
    yield projects[pid]
    projects.pop(pid, None)
    for leftover in main_mod.OUTPUT_DIR.glob("lookart01_backdrop*"):
        leftover.unlink(missing_ok=True)


def _chain(call: list[str]) -> str:
    return call[call.index("-vf") + 1]


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_a_look_gets_its_own_treatment_of_the_cover_art(client, art_project, ffmpeg_runs, look_id):
    res = client.get(f"/api/project/lookart01/backdrop?look={look_id}")
    assert res.status_code == 200
    assert _chain(ffmpeg_runs[0]) == vr.artwork_still(1920, 1080, look_id=look_id)[2]


def test_portrait_and_drifting_stills_follow_the_look_too(client, art_project, ffmpeg_runs):
    client.get("/api/project/lookart01/backdrop?look=cinema&aspect=9:16")
    client.get("/api/project/lookart01/backdrop?look=cinema&drift=1")
    assert _chain(ffmpeg_runs[0]) == vr.artwork_still(1080, 1920, look_id="cinema")[2]
    assert _chain(ffmpeg_runs[1]) == vr.artwork_still(1920, 1080, drift=True, look_id="cinema")[2]
    assert "pad=1080:1920:0:216:black" in _chain(ffmpeg_runs[0])
    assert "pad=" not in _chain(ffmpeg_runs[1])


def test_a_replaced_presets_id_is_served_its_looks_still(client, art_project, ffmpeg_runs):
    assert client.get("/api/project/lookart01/backdrop?look=afterglow").status_code == 200
    assert client.get("/api/project/lookart01/backdrop?look=marquee").status_code == 200
    # One still for both: the second request is served from the first one's file
    assert len(ffmpeg_runs) == 1
    assert _chain(ffmpeg_runs[0]) == vr.artwork_still(1920, 1080, look_id="marquee")[2]


def test_an_unknown_look_is_refused(client, art_project, ffmpeg_runs):
    res = client.get("/api/project/lookart01/backdrop?look=nope")
    assert res.status_code == 400
    assert ffmpeg_runs == []


def test_each_look_keeps_its_still_when_another_is_asked_for(client, art_project, ffmpeg_runs):
    """Switching looks back and forth must not render the same still again each time."""
    for look_id in ("marquee", "songbook", "marquee", "songbook"):
        assert client.get(f"/api/project/lookart01/backdrop?look={look_id}").status_code == 200
    assert client.get("/api/project/lookart01/backdrop").status_code == 200
    assert len(ffmpeg_runs) == 3
    kept = sorted(p.name.rsplit("_", 1)[0] for p in main_mod.OUTPUT_DIR.glob("lookart01_backdrop*"))
    assert kept == [
        "lookart01_backdrop-marquee_1920x1080",
        "lookart01_backdrop-songbook_1920x1080",
        "lookart01_backdrop_1920x1080",
    ]


def test_without_a_look_the_still_is_the_one_exports_always_drew(client, art_project, ffmpeg_runs):
    client.get("/api/project/lookart01/backdrop")
    assert _chain(ffmpeg_runs[0]) == vr.artwork_still(1920, 1080)[2]
    assert "boxblur=45:5" in _chain(ffmpeg_runs[0])
