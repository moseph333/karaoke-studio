"""Route handlers write songs under PROJECTS_LOCK and look them up again inside it, so a save,
a project list or a worker never sees a song halfway through an update."""

import threading

import pytest

import backend.main as main_mod
from backend import master_audio
from backend.project_store import PROJECTS_LOCK, load_projects, save_projects
from backend.routers import projects as projects_router
from backend.routers import uploads
from backend.routers.projects import update_project_metadata
from backend.schemas import ProjectMetadataUpdate

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(64)


def _spy_saves(monkeypatch, module) -> list[bool]:
    """Records, for each save the module makes, whether it held the store lock."""
    held: list[bool] = []
    real = module.save_projects

    def spy(*args, **kwargs):
        held.append(PROJECTS_LOCK._is_owned())
        return real(*args, **kwargs)

    monkeypatch.setattr(module, "save_projects", spy)
    return held


class _RecordingDict(dict):
    """A dict that records whether the store lock was held for each get() or new key."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.gets: list[bool] = []
        self.inserts: list[bool] = []

    def get(self, *args, **kwargs):
        self.gets.append(PROJECTS_LOCK._is_owned())
        return super().get(*args, **kwargs)

    def __setitem__(self, key, value):
        self.inserts.append(PROJECTS_LOCK._is_owned())
        super().__setitem__(key, value)


@pytest.fixture
def song():
    """A finished song with an instrumental, saved to disk."""
    pid = "lock_song"
    stem_dir = main_mod.STEMS_DIR / pid
    stem_dir.mkdir(parents=True, exist_ok=True)
    inst = stem_dir / "instrumental.wav"
    inst.write_bytes(WAV)
    main_mod.projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Lock Song",
        "artist": "Store Band",
        "status": "ready",
        "lines": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "instrumental_path": str(inst),
    }
    save_projects()
    return pid


def _fake_mix(on_mix=None):
    def mix_and_shift(*, output_filename, **_kwargs):
        if on_mix:
            on_mix()
        out = main_mod.OUTPUT_DIR / output_filename
        out.write_bytes(WAV + bytes(4096))
        return str(out)

    return mix_and_shift


def test_mix_stores_the_new_master_under_the_store_lock(client, monkeypatch, song):
    held = _spy_saves(monkeypatch, projects_router)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", _fake_mix())
    monkeypatch.setattr(master_audio, "preview_for", lambda _path: None)

    res = client.post(f"/api/project/{song}/mix", json={"semitones": 2, "guide_volume": 0.3})

    assert res.status_code == 200, res.text
    assert held == [True]
    stored = main_mod.projects[song]
    assert (stored["semitones"], stored["guide_volume"]) == (2, 0.3)
    assert res.json()["master_audio_url"] == stored["master_audio_url"]


def test_a_mix_of_a_song_deleted_meanwhile_returns_404_and_does_not_bring_it_back(
    client, monkeypatch, song
):
    def delete_song():
        # What the delete route does while the mix runs
        with PROJECTS_LOCK:
            main_mod.projects.pop(song)
            save_projects()

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", _fake_mix(on_mix=delete_song))
    monkeypatch.setattr(master_audio, "preview_for", lambda _path: None)

    res = client.post(f"/api/project/{song}/mix", json={"semitones": 1})

    assert res.status_code == 404
    assert song not in main_mod.projects
    assert song not in load_projects()


def test_render_start_checks_and_queues_under_the_store_lock(client, monkeypatch, song):
    held = _spy_saves(monkeypatch, projects_router)
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)

    first = client.post(f"/api/project/{song}/render", json={})

    assert first.status_code == 200, first.text
    assert held == [True]
    assert main_mod.projects[song]["render_status"] == "queued"
    # The render is registered together with "queued", so a second click is refused
    assert f"{song}_render" in main_mod.active_cancellations
    second = client.post(f"/api/project/{song}/render", json={})
    assert second.status_code == 409


def test_the_render_conflict_check_runs_under_the_store_lock(client, monkeypatch, song):
    cancellations = _RecordingDict()
    monkeypatch.setattr(main_mod, "active_cancellations", cancellations)
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)

    res = client.post(f"/api/project/{song}/render", json={})

    assert res.status_code == 200, res.text
    assert cancellations.gets == [True]


@pytest.mark.parametrize(
    ("route", "field", "expected"),
    [("cancel", "status", "cancelled"), ("cancel-render", "render_status", "idle")],
)
def test_cancel_routes_write_under_the_store_lock(
    client, monkeypatch, song, route, field, expected
):
    held = _spy_saves(monkeypatch, projects_router)

    res = client.post(f"/api/project/{song}/{route}")

    assert res.status_code == 200
    assert held == [True]
    assert main_mod.projects[song][field] == expected
    assert load_projects()[song][field] == expected


def test_patch_returns_a_snapshot_not_the_stored_song(monkeypatch, song):
    held = _spy_saves(monkeypatch, projects_router)

    result = update_project_metadata(song, ProjectMetadataUpdate(title="  Renamed  "))

    stored = main_mod.projects[song]
    assert held == [True]
    assert result is not stored
    assert result["title"] == stored["title"] == "Renamed"
    result["title"] = "Changed after the response"
    result["lines"].append({"id": 9})
    assert stored["title"] == "Renamed"
    assert stored["lines"] == []


def test_process_inserts_the_new_song_under_the_store_lock(client, monkeypatch):
    held = _spy_saves(monkeypatch, projects_router)
    store = _RecordingDict()
    monkeypatch.setattr(main_mod, "projects", store)
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *_args: None)

    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    assert res.status_code == 200, res.text
    assert store.inserts == [True]
    assert held == [True]
    assert store["dQw4w9WgXcQ"]["status"] == "queued"


def test_upload_track_inserts_the_new_song_under_the_store_lock(client, monkeypatch):
    held = _spy_saves(monkeypatch, uploads)
    store = _RecordingDict()
    monkeypatch.setattr(main_mod, "projects", store)
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *_args: None)

    res = client.post("/api/upload-track", files={"file": ("song.wav", WAV, "audio/wav")})

    assert res.status_code == 200, res.text
    pid = res.json()["project_id"]
    assert store.inserts == [True]
    assert held == [True]
    assert store[pid]["status"] == "queued"
    assert isinstance(main_mod.active_cancellations[pid], threading.Event)


@pytest.mark.parametrize(
    "branch", ["cancelled before it started", "cancelled while queued", "failed"]
)
def test_the_render_job_writes_its_end_states_under_the_store_lock(monkeypatch, song, branch):
    from backend import render_worker
    from backend.schemas import RenderRequest

    saves: list[tuple[bool, str | None]] = []
    real = render_worker.save_projects

    def spy(*args, **kwargs):
        saves.append((PROJECTS_LOCK._is_owned(), main_mod.projects[song].get("render_status")))
        return real(*args, **kwargs)

    monkeypatch.setattr(render_worker, "save_projects", spy)
    event = threading.Event()
    main_mod.active_cancellations[f"{song}_render"] = event
    if branch == "cancelled before it started":
        event.set()
    elif branch == "cancelled while queued":

        class CancelWhileWaiting:
            def acquire(self):
                event.set()

            def release(self):
                pass

        monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", CancelWhileWaiting())
    else:

        def broken_subtitles(**_kwargs):
            raise RuntimeError("subtitle writer broke")

        monkeypatch.setattr(main_mod.video_renderer, "generate_ass_subtitles", broken_subtitles)

    render_worker.run_video_render(song, RenderRequest())

    expected = "error" if branch == "failed" else "idle"
    assert saves[-1] == (True, expected)
    assert load_projects()[song]["render_status"] == expected
