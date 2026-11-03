"""Intakes, renders and background jobs that a previous server process left running are marked
as interrupted, at startup and whenever a song, its status or the library is read, while the
jobs this process runs are left alone. At startup the staged stems and unfinished mixes they
left half-made are deleted too."""

import json
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import background_jobs, pipeline, realignment, render_worker, reseparation
from backend.background_jobs import (
    BUSY_PIPELINE_STATES,
    INTERRUPTED_BY_RESTART,
    RENDER_ACTIVE_STATES,
    SEPARATION_JOB,
    conflict_reason,
    release_cancel_event,
    settle_orphaned_intake,
)
from backend.master_audio import remove_unfinished_mixes
from backend.project_store import save_projects
from backend.routers import projects as projects_router
from backend.schemas import RenderRequest

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(64)


def _store(proj: dict, *aliases: str) -> dict:
    """Puts a song in memory (under its id and any alias) and on disk."""
    main_mod.projects[proj["id"]] = proj
    for alias in aliases:
        main_mod.projects[alias] = proj
    save_projects()
    return proj


def _on_disk() -> dict:
    return json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))


def _count_saves(monkeypatch) -> list[int]:
    """Counts the saves the projects router makes."""
    calls: list[int] = []
    real = projects_router.save_projects

    def spy(*args, **kwargs):
        calls.append(1)
        return real(*args, **kwargs)

    monkeypatch.setattr(projects_router, "save_projects", spy)
    return calls


def _intake(status: str = "separating", **fields) -> dict:
    """A song whose intake an earlier process was running (heartbeat from before this one)."""
    return {
        "id": "s1",
        "track_id": "yt1",
        "title": "Cut Off",
        "status": status,
        "progress": 40,
        "status_detail": "Separating vocals",
        "eta_seconds": 30,
        "heartbeat": background_jobs.PROCESS_STARTED_AT_MS - 60_000,
        "lines": [],
        **fields,
    }


def _rendering(render_status: str = "rendering", **fields) -> dict:
    """A finished song whose render an earlier process was running."""
    return {
        "id": "s1",
        "track_id": "yt1",
        "title": "Cut Off",
        "status": "ready",
        "lines": [],
        "render_status": render_status,
        "render_progress": 55,
        "render_detail": "Encoding video",
        "render_eta_seconds": 20,
        "video_url": "/static/output/yt1_karaoke.mp4?v=1",
        **fields,
    }


@pytest.mark.parametrize("status", sorted(BUSY_PIPELINE_STATES))
def test_a_status_poll_marks_an_intake_left_busy_by_a_restart_as_failed(client, status):
    _store(_intake(status))

    body = client.get("/api/project/s1/status").json()

    assert body["status"] == "error"
    assert body["error"] == INTERRUPTED_BY_RESTART
    assert body["status_detail"] == f"Error: {INTERRUPTED_BY_RESTART}"
    assert body["eta_seconds"] is None
    # The last stage reached stays visible
    assert body["progress"] == 40
    stored = _on_disk()["s1"]
    assert (stored["status"], stored["error"]) == ("error", INTERRUPTED_BY_RESTART)


@pytest.mark.parametrize("render_status", RENDER_ACTIVE_STATES)
def test_reading_a_song_marks_a_render_left_by_a_restart_as_failed(client, render_status):
    proj = _store(_rendering(render_status))

    body = client.get("/api/project/s1").json()

    assert body["render_status"] == "error"
    assert body["render_error"] == INTERRUPTED_BY_RESTART
    assert body["render_detail"] == f"Render error: {INTERRUPTED_BY_RESTART}"
    assert body["render_eta_seconds"] is None
    # The previous video stays available
    assert body["video_url"] == "/static/output/yt1_karaoke.mp4?v=1"
    assert body["status"] == "ready"
    assert _on_disk()["s1"]["render_status"] == "error"
    # The stems can be re-made again
    assert conflict_reason(proj, SEPARATION_JOB) is None


def test_a_render_with_a_fresh_heartbeat_but_no_event_is_still_settled(client):
    # Renders are settled on the cancel event alone
    _store(_rendering(render_heartbeat=int(time.time() * 1000) + 3_600_000))

    body = client.get("/api/project/s1/status").json()

    assert body["render_status"] == "error"


@pytest.mark.parametrize(
    "key, song",
    [
        ("s1", _intake),
        ("yt1", _intake),
        ("s1_render", _rendering),
        ("yt1_render", _rendering),
    ],
)
def test_jobs_this_process_runs_are_left_alone(client, monkeypatch, key, song):
    proj = _store(song())
    before = json.loads(json.dumps(proj))
    main_mod.active_cancellations[key] = threading.Event()
    saves = _count_saves(monkeypatch)

    client.get("/api/project/s1/status")
    client.get("/api/project/s1")
    client.get("/api/projects")

    assert proj == before
    assert saves == []


@pytest.mark.parametrize(
    "heartbeat",
    [
        pytest.param(lambda: background_jobs.PROCESS_STARTED_AT_MS + 3_600_000, id="an-hour-ahead"),
        pytest.param(lambda: int(time.time() * 1000), id="now"),
        pytest.param(lambda: str(int(time.time() * 1000)), id="now-as-text"),
    ],
)
def test_an_intake_whose_heartbeat_is_newer_than_this_process_is_left_alone(client, heartbeat):
    # The shape of seed_demo's processing song: no event, heartbeat ahead of the start
    proj = _store(_intake(heartbeat=heartbeat()))

    body = client.get("/api/project/s1/status").json()

    assert body["status"] == "separating"
    assert body["error"] is None
    assert proj["status"] == "separating"


@pytest.mark.parametrize(
    "heartbeat",
    [
        pytest.param(lambda: background_jobs.PROCESS_STARTED_AT_MS - 1, id="just-before-start"),
        pytest.param(lambda: 0, id="zero"),
        pytest.param(lambda: None, id="null"),
        pytest.param(lambda: "soon", id="unreadable-text"),
        pytest.param(lambda: True, id="boolean"),
        pytest.param(lambda: {"ms": 1}, id="object"),
        pytest.param(lambda: float("nan"), id="nan"),
        pytest.param(lambda: float("inf"), id="infinite"),
        pytest.param(lambda: 10**400, id="too-large-for-a-float"),
    ],
)
def test_an_intake_with_an_older_or_unreadable_heartbeat_is_settled(heartbeat):
    proj = _intake(heartbeat=heartbeat())

    assert settle_orphaned_intake(proj, {}) is True
    assert (proj["status"], proj["error"]) == ("error", INTERRUPTED_BY_RESTART)


def test_an_intake_without_a_heartbeat_is_settled(client):
    song = _intake()
    del song["heartbeat"]
    _store(song)

    assert client.get("/api/project/s1/status").json()["status"] == "error"


def test_an_intake_heartbeat_is_compared_with_this_process_start(monkeypatch):
    beat = int(time.time() * 1000)
    proj = _intake(heartbeat=beat)
    monkeypatch.setattr(background_jobs, "PROCESS_STARTED_AT_MS", beat + 1)

    assert settle_orphaned_intake(proj, {}) is True


@pytest.mark.parametrize(
    "fields",
    [
        {"status": "ready"},
        {"status": "error", "error": "Download failed"},
        {"status": "cancelled"},
        {"status": "ready", "render_status": "idle"},
        {"status": "ready", "render_status": "completed"},
        {"status": "ready", "render_status": "error", "render_error": "FFmpeg failed"},
        {"status": None},
        {"status": ["queued"]},
        {"status": "ready", "render_status": {"state": "rendering"}},
    ],
)
def test_finished_songs_are_unchanged_and_not_saved(client, monkeypatch, fields):
    proj = _store({"id": "s1", "track_id": "yt1", "title": "Done", "lines": [], **fields})
    before = json.loads(json.dumps(proj))
    saves = _count_saves(monkeypatch)

    assert client.get("/api/project/s1/status").status_code == 200
    assert client.get("/api/project/s1").status_code == 200
    assert client.get("/api/projects").status_code == 200

    assert proj == before
    assert saves == []


def test_the_library_settles_every_job_and_saves_once(client, monkeypatch):
    intake = _store(_intake(), "yt1")
    render = _store(_rendering(id="r1", track_id="ytr"))
    jobs = _store(
        {
            "id": "j1",
            "title": "Jobs",
            "status": "ready",
            "lines": [],
            "separation_job": {"id": "sep", "status": "running", "progress": 50},
            "sync_job": {"id": "syn", "status": "queued", "progress": 0},
        }
    )
    live = _store(_intake(id="l1", track_id="ytl"))
    main_mod.active_cancellations["l1"] = threading.Event()
    saves = _count_saves(monkeypatch)

    body = client.get("/api/projects").json()

    # The alias is the same song, handled once
    assert body["s1"]["status"] == body["yt1"]["status"] == "error"
    assert intake["error"] == INTERRUPTED_BY_RESTART
    assert render["render_status"] == "error"
    assert jobs["separation_job"]["status"] == "error"
    assert jobs["sync_job"]["status"] == "error"
    assert live["status"] == "separating"
    assert len(saves) == 1
    stored = _on_disk()
    assert stored["s1"]["status"] == "error"
    assert stored["r1"]["render_status"] == "error"
    assert stored["j1"]["sync_job"]["status"] == "error"
    assert stored["l1"]["status"] == "separating"


def test_the_my_scope_of_the_library_settles_too(client):
    _store(_intake(created_by="Ana"))

    body = client.get("/api/projects", params={"scope": "my", "user": "Ana"}).json()

    assert body["s1"]["status"] == "error"


def test_settling_every_song_counts_songs_once_and_skips_entries_that_are_not_songs(monkeypatch):
    saves: list[int] = []
    monkeypatch.setattr(projects_router, "save_projects", lambda **_kwargs: saves.append(1))
    _store(_intake(), "yt1")
    main_mod.projects["_schema"] = 1  # type: ignore[assignment]

    assert projects_router.settle_all_stale_jobs() == 1
    assert projects_router.settle_all_stale_jobs() == 0
    assert saves == [1]


def _seed_every_job_kind() -> None:
    _store(_intake(), "yt1")
    _store(_rendering(id="r1", track_id="ytr"))
    _store(
        {
            "id": "j1",
            "title": "Jobs",
            "status": "ready",
            "lines": [],
            "separation_job": {"id": "sep", "status": "queued", "progress": 0},
            "sync_job": {"id": "syn", "status": "running", "progress": 30},
        }
    )


def test_startup_settles_jobs_left_by_the_previous_process_before_any_request():
    _seed_every_job_kind()

    with TestClient(main_mod.app):
        projs = main_mod.projects
        assert projs["s1"]["status"] == "error"
        assert projs["s1"]["error"] == INTERRUPTED_BY_RESTART
        assert projs["r1"]["render_status"] == "error"
        assert projs["j1"]["separation_job"]["status"] == "error"
        assert projs["j1"]["sync_job"]["status"] == "error"
        stored = _on_disk()
        assert stored["s1"]["status"] == "error"
        assert stored["r1"]["render_error"] == INTERRUPTED_BY_RESTART
        assert stored["j1"]["separation_job"]["status"] == "error"
        assert stored["j1"]["sync_job"]["status"] == "error"


def test_startup_with_only_finished_songs_does_not_write_the_store(monkeypatch):
    main_mod.projects["done"] = {"id": "done", "status": "ready", "render_status": "completed"}
    main_mod.projects["failed"] = {"id": "failed", "status": "error", "error": "No audio"}
    saves = _count_saves(monkeypatch)

    with TestClient(main_mod.app):
        pass

    assert saves == []
    assert not main_mod.PROJECTS_STORE_FILE.exists()


def test_startup_goes_on_when_settling_fails(monkeypatch, caplog, auth_headers):
    def broken():
        raise RuntimeError("store is broken")

    monkeypatch.setattr(main_mod, "settle_all_stale_jobs", broken)

    with TestClient(main_mod.app, headers=auth_headers) as started:
        assert started.get("/api/health").status_code == 200

    assert "Could not settle the jobs left by the previous server process" in caplog.text


def _restart_leftovers() -> tuple[list[Path], list[Path]]:
    """What a re-separation and the mixer had half-made when the server stopped, and the
    finished files next to them that must stay."""
    stems, output = main_mod.STEMS_DIR, main_mod.OUTPUT_DIR
    leftovers = [
        stems / ".staging" / "ytj" / "job1" / "vocals.wav",
        stems / ".staging" / "ytj" / "job2" / "no_vocals.wav",
        stems / ".staging" / "up2" / "job3" / "vocals.wav",
        output / "ytj_mix_2_30.tmp_1a2b3c4d.wav",
        output / "ytj_mix_2_30.tmp_5e6f7a8b.m4a",
        output / "up2_master.tmp_0a1b2c3d.wav",
    ]
    kept = [
        stems / "ytj" / "vocals.wav",
        stems / "ytj" / "no_vocals.wav",
        output / "ytj_mix_2_30.wav",
        output / "ytj_mix_2_30.m4a",
        output / "up2_master.wav",
        output / "ytj_karaoke.mp4",
        output / "ytj.ass",
        output / "ytj_bg_1a2b3c4d.tmp.png",  # a thumbnail being processed: not the mixer's
    ]
    for path in [*leftovers, *kept]:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(WAV)
    return leftovers, kept


def test_removing_staged_stems_deletes_every_staged_job_folder():
    _leftovers, kept = _restart_leftovers()

    assert reseparation.remove_staged_stems() == 3

    assert not (main_mod.STEMS_DIR / ".staging").exists()
    assert all(path.exists() for path in kept)
    assert reseparation.remove_staged_stems() == 0


def test_removing_unfinished_mixes_deletes_only_the_files_the_mixer_was_writing():
    leftovers, kept = _restart_leftovers()

    assert remove_unfinished_mixes() == 3

    output = main_mod.OUTPUT_DIR
    assert [path for path in leftovers if path.parent == output and path.exists()] == []
    assert all(path.exists() for path in kept)
    assert remove_unfinished_mixes() == 0


def test_startup_removes_the_staged_stems_and_unfinished_mixes_a_restart_left():
    _store(
        {
            "id": "j1",
            "track_id": "ytj",
            "title": "Jobs",
            "status": "ready",
            "lines": [],
            "separation_job": {"id": "job1", "status": "running", "progress": 40},
        },
        "ytj",
    )
    leftovers, kept = _restart_leftovers()

    with TestClient(main_mod.app):
        assert main_mod.projects["j1"]["separation_job"]["status"] == "error"
        assert [path for path in leftovers if path.exists()] == []
        assert not (main_mod.STEMS_DIR / ".staging").exists()
        assert all(path.exists() for path in kept)


@pytest.mark.parametrize(
    "step, message",
    [
        ("remove_staged_stems", "Could not remove the staged stems left by the previous process"),
        (
            "remove_unfinished_mixes",
            "Could not remove the unfinished mixes left by the previous process",
        ),
        ("start_pruning_mixes_of_every_song", "Could not start pruning the cached mixes"),
    ],
)
def test_startup_goes_on_when_a_leftover_cleanup_step_fails(
    monkeypatch, caplog, auth_headers, step, message
):
    def broken():
        raise PermissionError("data folder is read-only")

    monkeypatch.setattr(main_mod, step, broken)
    leftovers, _kept = _restart_leftovers()

    with TestClient(main_mod.app, headers=auth_headers) as started:
        assert started.get("/api/health").status_code == 200

    assert message in caplog.text
    # The other steps still ran
    staged, unfinished = leftovers[:3], leftovers[3:]
    if step != "remove_staged_stems":
        assert [path for path in staged if path.exists()] == []
    if step != "remove_unfinished_mixes":
        assert [path for path in unfinished if path.exists()] == []


def test_a_render_registers_its_event_before_it_shows_as_queued(client, monkeypatch):
    queued_with_event: list[bool] = []

    class _WatchedSong(dict):
        def __setitem__(self, key, value):
            if key == "render_status" and value == "queued":
                queued_with_event.append("o1_render" in main_mod.active_cancellations)
            super().__setitem__(key, value)

    stem_dir = main_mod.STEMS_DIR / "o1"
    stem_dir.mkdir(parents=True, exist_ok=True)
    inst = stem_dir / "instrumental.wav"
    inst.write_bytes(WAV)
    main_mod.projects["o1"] = _WatchedSong(
        id="o1", title="Order", status="ready", lines=[], instrumental_path=str(inst)
    )
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)

    res = client.post("/api/project/o1/render", json={})

    assert res.status_code == 200
    assert queued_with_event == [True]
    # Still running as far as this process knows, so a read leaves it queued
    assert client.get("/api/project/o1/status").json()["render_status"] == "queued"


def test_a_finished_job_removes_only_its_own_cancel_event():
    old, new = threading.Event(), threading.Event()
    events = {"s1": new}

    # A job cancelled and submitted again at once: the old run ends after the new one started
    release_cancel_event(events, "s1", old)
    assert events == {"s1": new}

    release_cancel_event(events, "s1", new)
    assert events == {}

    release_cancel_event(events, "s1", new)
    assert events == {}


def test_reading_a_song_with_a_heartbeat_too_large_for_a_float_settles_it(client):
    _store(_intake(heartbeat=10**400))

    assert client.get("/api/project/s1/status").json()["status"] == "error"
    assert client.get("/api/projects").status_code == 200


class _CancelledWhileWaiting:
    """A job slot handed over only after the user cancelled the job waiting for it."""

    def __init__(self, event: threading.Event):
        self.event = event

    def acquire(self, blocking: bool = True, timeout: float | None = None) -> bool:
        self.event.set()
        return True

    def release(self) -> None:
        pass


def _queue_intake(proj: dict) -> None:
    proj.update(status="queued", progress=0, status_detail="Queued")


def _queue_render(proj: dict) -> None:
    proj["render_status"] = "queued"


def _old_reseparation(proj: dict):
    job_id = reseparation.create_job(proj, "fast", False, False)["id"]
    return lambda: reseparation.run_reseparation("s1", job_id)


def _old_realignment(proj: dict):
    job_id = realignment.create_job(proj, "lines")["id"]
    return lambda: realignment.run_realignment("s1", job_id, [], {}, "lines")


# job: (module that saves its end state, cancel key, song, the old run, what a new request
# does to the song, whether a status read shows the new run as still waiting)
_JOBS = {
    "youtube-intake": (
        pipeline,
        "s1",
        lambda: _intake("queued"),
        lambda _proj: lambda: pipeline.run_pipeline("s1", "yt1"),
        _queue_intake,
        lambda body: body["status"] == "queued",
    ),
    "upload-intake": (
        pipeline,
        "s1",
        lambda: _intake("queued"),
        lambda _proj: lambda: pipeline.run_local_pipeline("s1", "song.wav", "Cut Off", "Band"),
        _queue_intake,
        lambda body: body["status"] == "queued",
    ),
    "render": (
        render_worker,
        "s1_render",
        lambda: _rendering("queued"),
        lambda _proj: lambda: render_worker.run_video_render("s1", RenderRequest()),
        _queue_render,
        lambda body: body["render_status"] == "queued",
    ),
    "re-separation": (
        reseparation,
        reseparation.cancel_key("s1"),
        lambda: _rendering("idle"),
        _old_reseparation,
        lambda proj: reseparation.create_job(proj, "best", False, False),
        lambda body: body["separation_job"]["status"] == "queued",
    ),
    "re-alignment": (
        realignment,
        realignment.cancel_key("s1"),
        lambda: _rendering("idle"),
        _old_realignment,
        lambda proj: realignment.create_job(proj, "lines"),
        lambda body: body["sync_job"]["status"] == "queued",
    ),
}


@pytest.mark.parametrize("cancelled", ["before it started", "while queued"])
@pytest.mark.parametrize("job", list(_JOBS))
def test_a_job_cancelled_and_requested_again_at_once_keeps_the_new_request_event(
    client, monkeypatch, job, cancelled
):
    module, key, song, old_run, queue_again, waiting = _JOBS[job]
    proj = _store(song())
    run = old_run(proj)
    old_event, new_event = threading.Event(), threading.Event()
    main_mod.active_cancellations[key] = old_event
    if cancelled == "before it started":
        old_event.set()
        monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(1))
    else:
        monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", _CancelledWhileWaiting(old_event))
    real_save = module.save_projects
    requested_again: list[bool] = []

    def save_then_request_again(*args, **kwargs):
        result = real_save(*args, **kwargs)
        if not requested_again:
            # The old run has just saved its cancelled state: a new request for the song
            # lands now, before the old run has removed its event
            requested_again.append(True)
            main_mod.active_cancellations[key] = new_event
            queue_again(main_mod.projects["s1"])
            real_save()
        return result

    monkeypatch.setattr(module, "save_projects", save_then_request_again)

    run()

    assert requested_again == [True]
    assert main_mod.active_cancellations[key] is new_event
    # The new run is still this process's, so a read does not take it for one cut off
    body = client.get("/api/project/s1/status").json()
    assert waiting(body), body
