"""A re-separation, re-alignment or song loop whose song is deleted before the job starts
releases the cancel event its route registered, so the update drain does not wait on a job
that never runs."""

import threading

import pytest

import backend.main as main_mod
from backend import realignment, reseparation, song_loop
from backend.background_jobs import SEPARATION_JOB, SONG_LOOP_JOB, SYNC_JOB
from backend.main import active_cancellations, projects


@pytest.mark.parametrize(
    ("module", "run"),
    [
        (reseparation, lambda pid: reseparation.run_reseparation(pid, "job-1")),
        (realignment, lambda pid: realignment.run_realignment(pid, "job-1", [], {}, "auto")),
        (song_loop, lambda pid: song_loop.run_song_loop(pid, "job-1")),
    ],
    ids=["reseparation", "realignment", "song loop"],
)
def test_a_job_for_a_deleted_song_releases_its_event(module, run):
    key = module.cancel_key("deleted01")
    active_cancellations[key] = threading.Event()  # what the route registered

    run("deleted01")  # the song is gone

    assert key not in active_cancellations


@pytest.mark.parametrize(
    ("module", "field", "run"),
    [
        (reseparation, SEPARATION_JOB, lambda pid: reseparation.run_reseparation(pid, "old")),
        (
            realignment,
            SYNC_JOB,
            lambda pid: realignment.run_realignment(pid, "old", [], {}, "auto"),
        ),
        (song_loop, SONG_LOOP_JOB, lambda pid: song_loop.run_song_loop(pid, "old")),
    ],
    ids=["reseparation", "realignment", "song loop"],
)
def test_an_event_owned_by_a_newer_running_job_is_kept(module, field, run):
    projects["alive01"] = {
        "id": "alive01",
        "status": "ready",
        field: {"id": "new", "status": "running"},
    }
    key = module.cancel_key("alive01")
    event = threading.Event()
    active_cancellations[key] = event
    try:
        run("alive01")  # a stale job: its id no longer matches the song's job
        assert active_cancellations.get(key) is event
    finally:
        active_cancellations.pop(key, None)
        projects.pop("alive01", None)
        main_mod.projects.pop("alive01", None)
