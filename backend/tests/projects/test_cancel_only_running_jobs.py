"""A cancel acts only on a job that is running: one that arrives after the job finished (a
race, or a second tab) changes nothing and leaves no set cancel event behind, so the next
job does not start out cancelled."""

import threading

import pytest

import backend.main as main_mod
from backend.main import active_cancellations, projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest


@pytest.fixture
def song(tmp_path, monkeypatch):
    pid = "latecancel01"
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Encore",
        "artist": "Too Late",
        "status": "ready",
        "lines": [{"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "x", "words": []}],
        "chords": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "instrumental_path": str(tmp_path / "inst.wav"),
    }
    monkeypatch.setattr(
        main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: kw["output_ass_path"]
    )
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kw: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(main_mod.video_renderer, "render_video", lambda **kw: None)
    monkeypatch.setattr(
        main_mod.youtube_service, "generate_youtube_package", lambda **kw: {"title": "t"}
    )
    yield pid
    projects.pop(pid, None)


def test_a_cancel_after_a_finished_render_does_not_cancel_the_next(client, song):
    run_video_render(song, RenderRequest())
    assert projects[song]["render_status"] == "completed"

    res = client.post(f"/api/project/{song}/cancel-render")

    assert res.json() == {"status": "ok", "cancelled": False}
    assert projects[song]["render_status"] == "completed"
    assert f"{song}_render" not in active_cancellations
    # The next render runs to the end instead of reading a leftover cancel
    run_video_render(song, RenderRequest(aspect_ratio="9:16"))
    assert projects[song]["render_status"] == "completed"


def test_a_cancel_after_the_song_is_ready_keeps_it_ready(client, song):
    res = client.post(f"/api/project/{song}/cancel")
    assert res.json() == {"status": "ok", "cancelled": False}
    assert projects[song]["status"] == "ready"
    assert song not in active_cancellations


def test_a_cancel_for_an_unknown_song_registers_nothing(client):
    client.post("/api/project/nobody/cancel")
    client.post("/api/project/nobody/cancel-render")
    assert "nobody" not in active_cancellations
    assert "nobody_render" not in active_cancellations


def test_a_running_job_is_signalled_and_marked(client, song):
    event = threading.Event()
    active_cancellations[song] = event
    projects[song]["status"] = "aligning"
    try:
        res = client.post(f"/api/project/{song}/cancel")
        assert res.json() == {"status": "ok", "cancelled": True}
        assert event.is_set()
        assert projects[song]["status"] == "cancelled"
    finally:
        active_cancellations.pop(song, None)
