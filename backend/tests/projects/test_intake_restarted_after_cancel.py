"""Starting a song again while its cancelled run is still queued or stopping.

The old run noticed its cancel only later (when a job slot came free, or at its next
step) and then wrote "cancelled" onto the song, which by then was the new run's: the
restarted song showed as cancelled while it was being processed."""

import threading

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects

SONG = "restart0001"


def _youtube(pid):
    pipeline.run_pipeline(pid, pid)


def _upload(pid):
    pipeline.run_local_pipeline(pid, "/nowhere/upload.mp3", "Song", "Singer")


RUNS = {"youtube": _youtube, "upload": _upload}


@pytest.fixture
def old_run():
    """A queued song with the cancel event of the run that is about to be cancelled."""
    event = threading.Event()
    active_cancellations[SONG] = event
    projects[SONG] = {"id": SONG, "status": "queued", "progress": 0, "lines": []}
    yield event
    projects.pop(SONG, None)
    active_cancellations.pop(SONG, None)


def _cancel_and_start_again(old_event: threading.Event) -> threading.Event:
    """What POST /cancel followed by POST /api/process does to the store."""
    old_event.set()
    new_event = threading.Event()
    active_cancellations[SONG] = new_event
    projects[SONG] = {"id": SONG, "status": "queued", "progress": 0, "lines": []}
    return new_event


@pytest.mark.parametrize("kind", list(RUNS))
def test_a_run_cancelled_in_the_queue_leaves_the_restarted_song_alone(monkeypatch, old_run, kind):
    restarted = []

    class SlotFreesAfterTheRestart:
        def acquire(self, *args, **kwargs):
            restarted.append(_cancel_and_start_again(old_run))
            return True

        def release(self):
            pass

    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", SlotFreesAfterTheRestart())

    RUNS[kind](SONG)

    assert projects[SONG]["status"] == "queued"
    assert active_cancellations[SONG] is restarted[0]


@pytest.mark.parametrize("kind", list(RUNS))
def test_a_run_cancelled_at_work_leaves_the_restarted_song_alone(monkeypatch, old_run, kind):
    restarted = []

    def cancelled_at_this_step(*_args, **_kwargs):
        restarted.append(_cancel_and_start_again(old_run))
        raise RuntimeError("Processing cancelled by user")

    monkeypatch.setattr(pipeline, "warm_separation_gpu", cancelled_at_this_step)

    RUNS[kind](SONG)

    assert projects[SONG]["status"] == "queued"
    assert "error" not in projects[SONG]
    assert active_cancellations[SONG] is restarted[0]


@pytest.mark.parametrize("kind", list(RUNS))
def test_a_cancelled_run_that_was_not_restarted_is_still_marked_cancelled(
    monkeypatch, old_run, kind
):
    def cancelled_at_this_step(*_args, **_kwargs):
        old_run.set()
        raise RuntimeError("Processing cancelled by user")

    monkeypatch.setattr(pipeline, "warm_separation_gpu", cancelled_at_this_step)

    RUNS[kind](SONG)

    assert projects[SONG]["status"] == "cancelled"
    assert SONG not in active_cancellations
