"""GET /api/project/{id}/status: the progress fields the studio polls while a job runs."""

import threading
import time

import backend.main as main_mod
from backend import pipeline
from backend.project_store import PROJECTS_LOCK
from backend.routers.projects import STATUS_FIELDS, get_project, get_project_status


def _song(**fields) -> dict:
    proj = {
        "id": "st1",
        "status": "separating",
        "progress": 42,
        "status_detail": "Separating vocals",
        "title": "Status Song",
        "lines": [{"id": 1, "text": "First line", "start_time": 1.0, "end_time": 2.0, "words": []}],
        "chords": [{"chord": "C", "start_time": 0.0, "end_time": 1.0}],
        **fields,
    }
    main_mod.projects["st1"] = proj
    return proj


def test_returns_every_progress_field_and_none_of_the_rest(client):
    _song(render_status="rendering", render_progress=55)

    res = client.get("/api/project/st1/status")

    assert res.status_code == 200
    body = res.json()
    assert set(body) == set(STATUS_FIELDS)
    assert body["id"] == "st1"
    assert (body["status"], body["progress"]) == ("separating", 42)
    assert (body["render_status"], body["render_progress"]) == ("rendering", 55)
    # Unset fields are present as null, so the studio can tell a cleared field apart
    assert body["error"] is None
    assert body["sync_job"] is None
    assert "lines" not in body and "chords" not in body


def test_is_far_smaller_than_the_full_project(client):
    _song(lines=[{"id": i, "text": f"Line {i} " * 8, "words": []} for i in range(200)])
    status = client.get("/api/project/st1/status")
    full = client.get("/api/project/st1")
    assert len(status.content) < 1024
    assert len(status.content) * 20 < len(full.content)


def test_status_and_full_project_are_snapshots_of_the_store():
    proj = _song(separation_job={"id": "j1", "status": "done", "progress": 100})

    status = get_project_status("st1")
    status["separation_job"]["progress"] = 0
    full = get_project("st1")
    full["lines"].append({"id": 2})
    full["title"] = "Changed"

    assert proj["separation_job"]["progress"] == 100
    assert len(proj["lines"]) == 1
    assert proj["title"] == "Status Song"


def test_settles_a_job_left_running_by_a_restart(client):
    _song(status="ready", sync_job={"id": "old", "status": "running", "progress": 30})

    job = client.get("/api/project/st1/status").json()["sync_job"]

    assert job["status"] == "error"
    assert "server restart" in job["detail"]
    assert main_mod.projects["st1"]["sync_job"]["status"] == "error"


def test_unknown_song_is_404(client):
    assert client.get("/api/project/missing/status").status_code == 404


def test_needs_the_passphrase(unauth_client):
    _song()
    assert unauth_client.get("/api/project/st1/status").status_code == 401


def test_pipeline_progress_is_written_under_the_store_lock():
    proj = _song()
    update = pipeline._progress_updater("st1", threading.Event(), time.time())

    with PROJECTS_LOCK:
        worker = threading.Thread(target=update, args=("aligning", 80, "Aligning lyrics"))
        worker.start()
        worker.join(timeout=0.3)
        # A status poll holding the lock never sees half an update
        assert worker.is_alive()
        assert proj["status"] == "separating"

    worker.join(timeout=5)
    assert (proj["status"], proj["progress"], proj["status_detail"]) == (
        "aligning",
        80,
        "Aligning lyrics",
    )
