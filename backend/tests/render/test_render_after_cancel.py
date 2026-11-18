"""Exporting again right after cancelling a render.

The cancelled render keeps its cancel event, set, until it has stopped. A render requested
meanwhile used to share that event: it saw itself cancelled before it started and the export
was dropped without a word. It now gets an event of its own, waits for the old render to let
go of the song's files, and the old render leaves the song's render fields to it."""

import threading

import pytest

import backend.main as main_mod
from backend.main import active_cancellations, projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest

KEY = "encore02_render"


@pytest.fixture
def song(tmp_path, monkeypatch):
    """A ready song whose subtitles, mix, FFmpeg render and YouTube kit are stand-ins."""
    pid = "encore02"
    inst = tmp_path / "inst.wav"
    inst.write_bytes(b"RIFF" + b"\x00" * 64)
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Encore",
        "artist": "Second Take",
        "status": "ready",
        "lines": [],
        "chords": [],
        "instrumental_path": str(inst),
    }
    monkeypatch.setattr(
        main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: kw["output_ass_path"]
    )
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kw: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(main_mod.video_renderer, "render_video", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        main_mod.youtube_service, "generate_youtube_package", lambda **kw: {"title": "t"}
    )
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(2))
    yield pid
    projects.pop(pid, None)


def test_an_export_requested_while_a_cancelled_render_stops_is_rendered(client, song):
    stopping = threading.Event()
    stopping.set()
    active_cancellations[KEY] = stopping

    res = client.post(f"/api/project/{song}/render", json={})

    assert res.status_code == 200
    # TestClient ran the render after the response
    assert projects[song]["render_status"] == "completed"
    assert projects[song]["video_url"].startswith("/static/output/encore02_karaoke.mp4")


def test_the_new_request_gets_a_cancel_event_of_its_own(client, song, monkeypatch):
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)
    stopping = threading.Event()
    stopping.set()
    active_cancellations[KEY] = stopping

    client.post(f"/api/project/{song}/render", json={})

    assert active_cancellations[KEY] is not stopping
    assert not active_cancellations[KEY].is_set()


def test_a_cancelled_render_that_stops_late_leaves_the_new_render_its_status(song, monkeypatch):
    old_event, new_event = threading.Event(), threading.Event()
    active_cancellations[KEY] = old_event

    def cancelled_then_requested_again(**_kwargs):
        old_event.set()
        active_cancellations[KEY] = new_event
        projects[song]["render_status"] = "queued"
        projects[song]["render_detail"] = "Queueing render job..."
        raise RuntimeError("Video rendering was cancelled by user")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", cancelled_then_requested_again)
    run_video_render(song, RenderRequest())

    assert projects[song]["render_status"] == "queued"
    assert projects[song]["render_detail"] == "Queueing render job..."
    assert active_cancellations[KEY] is new_event


def test_a_render_that_finished_despite_its_cancel_does_not_report_over_the_new_one(
    song, monkeypatch
):
    old_event, new_event = threading.Event(), threading.Event()
    active_cancellations[KEY] = old_event

    def finished_anyway(**_kwargs):
        old_event.set()
        active_cancellations[KEY] = new_event
        projects[song]["render_status"] = "queued"

    monkeypatch.setattr(main_mod.video_renderer, "render_video", finished_anyway)
    run_video_render(song, RenderRequest())

    assert projects[song]["render_status"] == "queued"
    assert "video_url" not in projects[song]


def test_a_render_cancelled_in_the_queue_stops_waiting_for_a_slot(song, monkeypatch):
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(0))
    event = threading.Event()
    active_cancellations[KEY] = event
    projects[song]["render_status"] = "queued"
    queued = threading.Thread(target=run_video_render, args=(song, RenderRequest()), daemon=True)
    queued.start()

    event.set()
    queued.join(timeout=5)

    assert not queued.is_alive()
    assert projects[song]["render_status"] == "idle"
    assert KEY not in active_cancellations


def test_the_new_render_waits_until_the_cancelled_one_has_let_go_of_the_files(song, monkeypatch):
    old_event, new_event = threading.Event(), threading.Event()
    active_cancellations[KEY] = old_event
    encoding, let_go = threading.Event(), threading.Event()
    renders = []

    def render_video(**_kwargs):
        renders.append(threading.current_thread().name)
        if len(renders) == 1:
            encoding.set()
            assert let_go.wait(timeout=5)
            raise RuntimeError("Video rendering was cancelled by user")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", render_video)
    old = threading.Thread(
        target=run_video_render, args=(song, RenderRequest()), name="old", daemon=True
    )
    old.start()
    assert encoding.wait(timeout=5)

    # Cancelled, and requested again at once (what the cancel and render routes do)
    old_event.set()
    active_cancellations[KEY] = new_event
    projects[song]["render_status"] = "queued"
    new = threading.Thread(
        target=run_video_render, args=(song, RenderRequest()), name="new", daemon=True
    )
    new.start()
    new.join(timeout=0.6)
    assert new.is_alive()
    assert renders == ["old"]

    let_go.set()
    old.join(timeout=5)
    new.join(timeout=5)

    assert renders == ["old", "new"]
    assert projects[song]["render_status"] == "completed"
    assert KEY not in active_cancellations
