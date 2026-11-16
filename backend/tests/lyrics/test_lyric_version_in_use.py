"""The studio's list of LRCLIB versions comes best first with each version's quality flags,
and a song remembers which listing its lyrics came from."""

import types
from unittest.mock import MagicMock, patch

import pytest

import backend.main as main_mod
import backend.routers.projects as projects_router
from backend.main import projects
from backend.project_store import save_projects
from backend.services.lyrics import LyricsService
from backend.tests.helpers.lrclib_listings import LASER_SHARKS_ALL_CAPS, LASER_SHARKS_CLEAN

LINES = [{"id": 0, "text": "Lasers from the dark", "start_time": 1.0, "end_time": 3.0}]


def lrclib_answer(payload):
    resp = MagicMock(status_code=200)
    resp.json.return_value = payload
    return resp


@pytest.fixture
def song(tmp_path, monkeypatch):
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"RIFF" + bytes(64))
    projects["sharks"] = {
        "id": "sharks",
        "track_id": "sharks",
        "title": "Laser Sharks",
        "artist": "Savant",
        "status": "ready",
        "duration": 244.0,
        "lines": LINES,
        "vocals_path": str(vocals),
    }
    save_projects()
    monkeypatch.setattr(
        projects_router,
        "sync_lyrics",
        lambda _vocals, lines, **k: types.SimpleNamespace(
            lines=lines, report={}, lyric_timing="line"
        ),
    )
    yield "sharks"
    projects.pop("sharks", None)


def test_the_clean_version_is_listed_first_with_the_messy_ones_flags(client, song):
    main_mod.projects[song]["lyric_source_id"] = LASER_SHARKS_CLEAN["id"]
    with patch(
        "requests.get", return_value=lrclib_answer([LASER_SHARKS_ALL_CAPS, LASER_SHARKS_CLEAN])
    ):
        res = client.get(f"/api/project/{song}/lyrics/candidates")
    assert res.status_code == 200
    listed = res.json()
    assert [c["id"] for c in listed] == [LASER_SHARKS_CLEAN["id"], LASER_SHARKS_ALL_CAPS["id"]]
    assert listed[0]["quality_flags"] == []
    assert "all_caps" in listed[1]["quality_flags"]
    assert [c["in_use"] for c in listed] == [True, False]


def test_applying_a_listed_version_remembers_it(client, song):
    res = client.post(
        f"/api/project/{song}/realign-lyrics",
        json={
            "custom_lyrics": LASER_SHARKS_CLEAN["syncedLyrics"],
            "lyric_source_id": LASER_SHARKS_CLEAN["id"],
        },
    )
    assert res.status_code == 200
    assert main_mod.projects[song]["lyric_source_id"] == LASER_SHARKS_CLEAN["id"]


def test_pasted_lyrics_clear_the_remembered_version(client, song):
    main_mod.projects[song]["lyric_source_id"] = 123
    res = client.post(
        f"/api/project/{song}/realign-lyrics",
        json={"custom_lyrics": "[00:01.00] My own words\n[00:04.00] And more"},
    )
    assert res.status_code == 200
    assert main_mod.projects[song]["lyric_source_id"] is None


def test_a_fetched_listing_reports_its_id():
    service = LyricsService()
    with patch("requests.get", return_value=lrclib_answer(LASER_SHARKS_CLEAN)):
        result = service.fetch_lyrics("Laser Sharks", "Savant", 242)
    assert result["source"] == "lrclib"
    assert result["source_id"] == LASER_SHARKS_CLEAN["id"]
