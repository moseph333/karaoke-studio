"""An update waits for running jobs: while the host's .update_draining marker is fresh, new songs,
track uploads, renders, re-separations and background re-alignments answer 503, edits keep
saving, and the server tells the host how many jobs still run through .jobs_active."""

import asyncio
import json
import os
import threading
import time

import pytest

import backend.main as main_mod
from backend import background_jobs, update_drain
from backend.project_store import save_projects
from backend.routers import quality as quality_router

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(64)


@pytest.fixture
def draining():
    """The host has built the new image and waits for running jobs."""
    marker = update_drain.drain_file()
    marker.write_text(json.dumps({"requested_at": time.time()}), encoding="utf-8")
    return marker


@pytest.fixture
def song():
    """A finished song with its original audio, an instrumental and a vocal stem."""
    pid = "drain_song"
    stem_dir = main_mod.STEMS_DIR / pid
    stem_dir.mkdir(parents=True, exist_ok=True)
    (stem_dir / "instrumental.wav").write_bytes(WAV)
    (stem_dir / "vocals.wav").write_bytes(WAV)
    audio = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
    audio.write_bytes(WAV)
    main_mod.projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Title",
        "artist": "Artist",
        "status": "ready",
        "duration": 10.0,
        "lines": [{"id": 1, "text": "old words", "start_time": 1.0, "end_time": 2.0}],
        "audio_path": str(audio),
        "instrumental_path": str(stem_dir / "instrumental.wav"),
        "vocals_path": str(stem_dir / "vocals.wav"),
    }
    save_projects()
    return pid


def _assert_draining(res):
    assert res.status_code == 503, res.text
    assert "about to update" in res.json()["detail"]
    assert res.headers["retry-after"] == str(update_drain.RETRY_AFTER_SEC)


# --- The marker ---------------------------------------------------------------------------


def test_no_marker_means_no_drain():
    assert update_drain.is_draining() is False
    update_drain.ensure_not_draining()


def test_a_fresh_marker_drains(draining):
    assert update_drain.is_draining() is True


def test_a_marker_left_by_a_host_that_gave_up_is_ignored(draining, monkeypatch):
    monkeypatch.setenv("UPDATE_DRAIN_MAX_SEC", "60")
    old = time.time() - 60 - update_drain.DRAIN_STALE_MARGIN_SEC - 1
    os.utime(draining, (old, old))
    assert update_drain.is_draining() is False


@pytest.mark.parametrize(("value", "expected"), [("", 2700), ("junk", 2700), ("-5", 0), ("90", 90)])
def test_the_drain_limit_reads_its_setting(monkeypatch, value, expected):
    monkeypatch.setenv("UPDATE_DRAIN_MAX_SEC", value)
    assert update_drain.drain_max_sec() == expected


def test_startup_removes_the_marker_since_the_update_has_happened(draining):
    async def start_and_stop():
        async with main_mod.lifespan(main_mod.app):
            pass

    asyncio.run(start_and_stop())

    assert not draining.exists()
    assert update_drain.is_draining() is False


# --- Routes that start work ---------------------------------------------------------------


def test_a_new_song_waits_for_the_update(client, monkeypatch, draining):
    started: list[tuple] = []
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *args: started.append(args))

    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    _assert_draining(res)
    assert main_mod.projects == {}
    assert main_mod.active_cancellations == {}
    assert started == []


def test_a_song_already_ready_still_opens_while_draining(client, draining):
    main_mod.projects["dQw4w9WgXcQ"] = {
        "id": "dQw4w9WgXcQ",
        "track_id": "dQw4w9WgXcQ",
        "status": "ready",
    }

    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    assert res.status_code == 200, res.text


def test_a_track_upload_waits_for_the_update(client, monkeypatch, draining):
    started: list[tuple] = []
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args: started.append(args))

    res = client.post("/api/upload-track", files={"file": ("song.wav", WAV, "audio/wav")})

    _assert_draining(res)
    assert main_mod.projects == {}
    assert list(main_mod.DOWNLOADS_DIR.iterdir()) == []
    assert started == []


def test_a_render_waits_without_blocking_the_next_one(client, monkeypatch, song, draining):
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)

    res = client.post(f"/api/project/{song}/render", json={})

    _assert_draining(res)
    assert "render_status" not in main_mod.projects[song]
    assert f"{song}_render" not in main_mod.active_cancellations

    draining.unlink()
    again = client.post(f"/api/project/{song}/render", json={})
    assert again.status_code == 200, again.text
    assert main_mod.projects[song]["render_status"] == "queued"


def test_a_reseparation_waits_for_the_update(client, monkeypatch, song, draining):
    started: list[tuple] = []
    monkeypatch.setattr(quality_router, "run_job", lambda *args: started.append(args))

    res = client.post(f"/api/project/{song}/reseparate", json={"quality": "fast"})

    _assert_draining(res)
    assert started == []
    assert "separation_job" not in main_mod.projects[song]
    assert main_mod.active_cancellations == {}


def test_a_background_realignment_waits_for_the_update(client, song, draining):
    res = client.post(
        f"/api/project/{song}/realign-lyrics",
        json={"custom_lyrics": "new words", "background": True},
    )

    _assert_draining(res)
    assert "sync_job" not in main_mod.projects[song]
    assert main_mod.active_cancellations == {}


def test_lyric_edits_still_save_while_draining(client, song, draining):
    lines = [{"id": 1, "text": "new words", "start_time": 1.0, "end_time": 2.0}]

    res = client.post(f"/api/project/{song}/lyrics", json={"lines": lines})

    assert res.status_code == 200, res.text
    assert main_mod.projects[song]["lines"][0]["text"] == "new words"


def test_not_found_still_answers_first_while_draining(client, draining):
    assert client.post("/api/project/nope/reseparate", json={"quality": "fast"}).status_code == 404
    assert client.post("/api/project/nope/render", json={}).status_code == 404


# --- Telling the host how many jobs run ---------------------------------------------------


def _jobs_file() -> dict:
    return json.loads(update_drain.jobs_file().read_text(encoding="utf-8"))


def test_the_job_count_names_each_kind():
    for key in ("a", "a_render", "b_reseparate", "c_sync", "d_render"):
        main_mod.active_cancellations[key] = threading.Event()

    update_drain.write_jobs_active()

    written = _jobs_file()
    assert written["count"] == 5
    assert written["kinds"] == {"intake": 1, "render": 2, "stems": 1, "lyrics": 1}
    assert time.time() - written["updated_at"] < 5


def test_a_job_reports_itself_while_it_runs_and_clears_when_it_ends():
    seen: list[int] = []

    def job():
        seen.append(_jobs_file()["count"])
        background_jobs.release_cancel_event(main_mod.active_cancellations, "s_render", event)

    event = threading.Event()
    main_mod.active_cancellations["s_render"] = event

    asyncio.run(background_jobs.run_job(job))

    assert seen == [1]
    assert _jobs_file()["count"] == 0


def test_a_job_that_fails_still_clears_its_count():
    event = threading.Event()
    main_mod.active_cancellations["s"] = event

    def job():
        background_jobs.release_cancel_event(main_mod.active_cancellations, "s", event)
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        asyncio.run(background_jobs.run_job(job))

    assert _jobs_file()["count"] == 0


def test_a_failed_write_never_raises(monkeypatch):
    def broken(*_args, **_kwargs):
        raise OSError("read-only file system")

    monkeypatch.setattr(update_drain.os, "replace", broken)
    update_drain.write_jobs_active()


# --- What the studio sees -----------------------------------------------------------------


def test_health_reports_the_drain_and_the_job_count(client, draining):
    main_mod.active_cancellations["x_render"] = threading.Event()

    body = client.get("/api/health").json()

    assert body["draining"] is True
    assert body["active_jobs"] == 1
    assert body["updating"] is True


def test_health_reports_no_drain_by_default(client):
    body = client.get("/api/health").json()

    assert body["draining"] is False
    assert body["active_jobs"] == 0
