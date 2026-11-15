"""An in-request lyric re-alignment reports its new lines as saved, so a failed write (a full
disk) answers 507 and leaves the old lines in memory, as other edits do."""

import errno
import json
import types

import pytest

import backend.main as main_mod
import backend.project_store as project_store
import backend.routers.projects as projects_router
from backend.main import projects
from backend.project_store import SAVE_FAILED_DETAIL, save_projects

OLD_LINES = [{"id": 1, "text": "old words", "start_time": 1.0, "end_time": 2.0, "words": []}]
NEW_LINES = [{"id": 1, "text": "new words", "start_time": 3.0, "end_time": 30.0, "words": []}]


@pytest.fixture
def song(tmp_path, monkeypatch):
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"RIFF" + bytes(64))
    projects["realign507"] = {
        "id": "realign507",
        "track_id": "realign507",
        "title": "T",
        "artist": "A",
        "status": "ready",
        "duration": 10.0,
        "lines": OLD_LINES,
        "lyric_timing": "word",
        "vocals_path": str(vocals),
    }
    save_projects()
    report = {"fidelity": "high"}
    monkeypatch.setattr(
        projects_router,
        "sync_lyrics",
        lambda *a, **k: types.SimpleNamespace(lines=NEW_LINES, report=report, lyric_timing="word"),
    )
    yield "realign507"
    projects.pop("realign507", None)


def test_a_full_disk_answers_507_and_keeps_the_old_lines(client, song, monkeypatch):
    def no_space(_fd):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(project_store.os, "fsync", no_space)

    res = client.post(f"/api/project/{song}/realign-lyrics", json={"lines": OLD_LINES})

    assert res.status_code == 507
    assert res.json()["detail"] == SAVE_FAILED_DETAIL
    assert main_mod.projects[song]["lines"] == OLD_LINES
    assert main_mod.projects[song]["duration"] == 10.0
    assert "sync_report" not in main_mod.projects[song]


def test_a_working_disk_saves_the_new_lines(client, song):
    res = client.post(f"/api/project/{song}/realign-lyrics", json={"lines": OLD_LINES})

    assert res.status_code == 200
    stored = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))[song]
    assert stored["lines"] == NEW_LINES
    assert stored["duration"] == 30.0
