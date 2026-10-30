"""How projects.json is written: compact, with a backup renewed once a minute, progress ticks
throttled to about one write a second, and reloads from disk that never replace the projects
held in memory."""

import json
import os
import threading
import time

import backend.main as main_mod
from backend import project_store
from backend.main import projects
from backend.pipeline import _progress_updater
from backend.project_store import (
    find_project,
    merge_disk_projects,
    save_projects,
    save_projects_throttled,
)


def _disk() -> dict:
    return json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))


def _song(pid: str, **fields) -> dict:
    return {"id": pid, "title": pid.title(), "status": "ready", **fields}


def test_the_store_is_written_compactly():
    projects["compact"] = _song("compact", lines=[{"id": 1, "text": "la la"}])
    save_projects()

    raw = main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8")
    assert "\n" not in raw and ": " not in raw
    assert _disk()["compact"]["lines"] == [{"id": 1, "text": "la la"}]


def test_progress_saves_wait_out_the_interval():
    projects["busy"] = _song("busy", progress=10)
    save_projects_throttled()  # nothing written yet in this test, so this one goes through
    assert _disk()["busy"]["progress"] == 10

    projects["busy"]["progress"] = 20
    save_projects_throttled()
    assert _disk()["busy"]["progress"] == 10  # within the interval: memory only

    project_store._last_save_at = time.monotonic() - project_store.PROGRESS_SAVE_INTERVAL_SEC
    projects["busy"]["progress"] = 30
    save_projects_throttled()
    assert _disk()["busy"]["progress"] == 30


def test_the_backup_is_renewed_at_most_once_a_minute():
    backup = main_mod.PROJECTS_BACKUP_FILE
    projects["bak"] = _song("bak", title="First")
    save_projects()
    assert not backup.exists()  # nothing to back up before the first write

    projects["bak"]["title"] = "Second"
    save_projects()
    assert json.loads(backup.read_text())["bak"]["title"] == "First"

    projects["bak"]["title"] = "Third"
    save_projects()
    assert json.loads(backup.read_text())["bak"]["title"] == "First"  # still fresh

    an_hour_ago = time.time() - 3600
    os.utime(backup, (an_hour_ago, an_hour_ago))
    projects["bak"]["title"] = "Fourth"
    save_projects()
    assert json.loads(backup.read_text())["bak"]["title"] == "Third"


def _stale_disk_copy_and_a_newcomer(pid: str) -> None:
    on_disk = _disk()
    on_disk[pid]["progress"] = 1  # older than memory
    on_disk["newcomer"] = _song("newcomer")
    main_mod.PROJECTS_STORE_FILE.write_text(json.dumps(on_disk), encoding="utf-8")


def test_listing_songs_keeps_the_projects_in_memory(client):
    projects["held"] = _song("held", progress=55)
    save_projects()
    held = projects["held"]
    _stale_disk_copy_and_a_newcomer("held")

    res = client.get("/api/projects")

    assert res.status_code == 200
    assert projects["held"] is held  # a handler holding it still writes to the live project
    assert res.json()["held"]["progress"] == 55
    assert "newcomer" in res.json()  # songs that exist only on disk still show up


def test_a_lookup_miss_adds_disk_songs_without_replacing_live_ones():
    projects["live"] = _song("live", progress=70)
    save_projects()
    live = projects["live"]
    _stale_disk_copy_and_a_newcomer("live")

    assert find_project("newcomer")["title"] == "Newcomer"
    assert projects["live"] is live
    assert projects["live"]["progress"] == 70


def test_merging_skips_songs_already_in_memory():
    memory = {"a": {"id": "a", "v": "memory"}}
    projects["a"] = {"id": "a", "v": "disk"}
    projects["b"] = {"id": "b", "v": "disk"}
    save_projects()

    merge_disk_projects(memory)

    assert memory == {"a": {"id": "a", "v": "memory"}, "b": {"id": "b", "v": "disk"}}


def test_pipeline_progress_is_saved_on_status_changes_and_throttled_within_one():
    projects["piped"] = _song("piped", status="queued", progress=0)
    save_projects()
    update_pipe = _progress_updater("piped", threading.Event(), time.time())

    update_pipe("separating", 35, "Separating…")  # new status: written at once
    assert _disk()["piped"]["status"] == "separating"

    update_pipe("separating", 40, "chunk 3/25")  # same status, within the interval
    assert _disk()["piped"]["progress"] == 35
    assert projects["piped"]["progress"] == 40  # what the studio polls

    update_pipe("ready", 100, "Studio is ready!", 0)  # never held back
    assert _disk()["piped"]["status"] == "ready"
    assert _disk()["piped"]["progress"] == 100
