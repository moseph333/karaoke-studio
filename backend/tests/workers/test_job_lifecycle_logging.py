"""run_job logs when each background job starts and ends, and logs (rather than raises) an
exception the job left unhandled."""

import logging

import anyio

from backend.background_jobs import run_job


def run_pipeline(project_id: str) -> None:
    pass


def run_video_render(project_id: str) -> None:
    raise ValueError("unhandled")


def test_start_and_end_are_logged_with_the_song_and_duration(caplog):
    caplog.set_level(logging.INFO, logger="karaoke_backend")
    anyio.run(run_job, run_pipeline, "song-1")
    messages = [r.getMessage() for r in caplog.records]
    assert "Job run_pipeline for song-1 started" in messages
    assert any(m.startswith("Job run_pipeline for song-1 ended after ") for m in messages)


def test_an_unhandled_failure_is_logged_with_its_traceback(caplog):
    caplog.set_level(logging.INFO, logger="karaoke_backend")
    anyio.run(run_job, run_video_render, "song-2")
    failed = [r for r in caplog.records if "failed after" in r.getMessage()]
    assert len(failed) == 1
    assert failed[0].levelno == logging.ERROR
    assert failed[0].exc_info[0] is ValueError
    assert "song-2" in failed[0].getMessage()
