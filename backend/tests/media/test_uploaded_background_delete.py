"""An uploaded stage background is deleted when the studio lets go of it.

Uploads stayed in the backgrounds folder for good: their ids live only in each browser's
stage settings, so the server could not tell which were still wanted. The studio now asks
for its upload to be deleted when it is replaced or removed, and a video that was asked for
with the upload keeps the file until that render ends."""

import pytest

import backend.main as main_mod
from backend.project_store import save_projects
from backend.services import uploaded_backgrounds

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
WAV = b"RIFF" + b"\x00" * 64


def _upload(client, name: str = "stage.png") -> str:
    res = client.post("/api/upload-background", files={"file": (name, PNG, "image/png")})
    assert res.status_code == 200, res.text
    return res.json()["bg_id"]


def _file(bg_id: str):
    return main_mod.BACKGROUNDS_DIR / bg_id


@pytest.fixture
def song():
    """A finished song a video can be asked for."""
    pid = "bg_song"
    stem_dir = main_mod.STEMS_DIR / pid
    stem_dir.mkdir(parents=True, exist_ok=True)
    (stem_dir / "instrumental.wav").write_bytes(WAV)
    main_mod.projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Title",
        "artist": "Artist",
        "status": "ready",
        "duration": 10.0,
        "lines": [{"id": 1, "text": "words", "start_time": 1.0, "end_time": 2.0}],
        "instrumental_path": str(stem_dir / "instrumental.wav"),
    }
    save_projects()
    return pid


def test_an_upload_the_studio_lets_go_of_is_deleted(client):
    bg_id = _upload(client)
    assert client.get(f"/static/backgrounds/{bg_id}").status_code == 200

    res = client.delete(f"/api/background/{bg_id}")

    assert res.status_code == 200
    assert res.json() == {"status": "ok", "deleted": True}
    assert not _file(bg_id).exists()
    assert client.get(f"/static/backgrounds/{bg_id}").status_code == 404


def test_deleting_one_upload_leaves_the_others(client):
    kept, gone = _upload(client, "kept.png"), _upload(client, "gone.png")

    client.delete(f"/api/background/{gone}")

    assert _file(kept).exists() and not _file(gone).exists()


def test_an_upload_already_gone_is_answered_without_an_error(client):
    bg_id = _upload(client)
    client.delete(f"/api/background/{bg_id}")

    again = client.delete(f"/api/background/{bg_id}")

    assert again.status_code == 200
    assert again.json() == {"status": "ok", "deleted": False}


@pytest.mark.parametrize(
    "not_an_id",
    ["stage.png", "..", "%2e%2e%2f%2e%2e%2fprojects.json", "0123456g_stage.png", "01234567_"],
)
def test_only_an_uploads_id_names_a_file_to_delete(client, not_an_id):
    outside = main_mod.BACKGROUNDS_DIR.parent / "projects.json"
    outside.write_text("{}")
    inside = main_mod.BACKGROUNDS_DIR / "stage.png"
    inside.write_bytes(PNG)

    res = client.delete(f"/api/background/{not_an_id}")

    assert res.status_code == 404
    assert outside.exists() and inside.exists()


def test_deleting_needs_a_session(unauth_client, client):
    bg_id = _upload(client)

    assert unauth_client.delete(f"/api/background/{bg_id}").status_code == 401
    assert _file(bg_id).exists()


def test_a_video_asked_for_with_the_upload_keeps_it_until_the_render_ends(
    client, monkeypatch, song
):
    bg_id = _upload(client)
    seen = {}

    def render(project_id, req):
        # The studio replaces its background while the video is queued or rendering
        seen["answer"] = client.delete(f"/api/background/{bg_id}").json()
        seen["file_during_render"] = _file(bg_id).exists()

    monkeypatch.setattr(main_mod, "run_video_render", render)

    res = client.post(f"/api/project/{song}/render", json={"custom_bg_id": bg_id})

    assert res.status_code == 200, res.text
    assert seen == {"answer": {"status": "ok", "deleted": False}, "file_during_render": True}
    # The test client runs the render before it answers: it has ended, and the file with it
    assert not _file(bg_id).exists()


def test_a_render_that_fails_still_lets_go_of_the_upload(client, monkeypatch, song):
    bg_id = _upload(client)

    def render(project_id, req):
        client.delete(f"/api/background/{bg_id}")
        raise RuntimeError("the render broke")

    monkeypatch.setattr(main_mod, "run_video_render", render)

    client.post(f"/api/project/{song}/render", json={"custom_bg_id": bg_id})

    assert not _file(bg_id).exists()


def test_a_render_ending_does_not_delete_an_upload_the_studio_still_shows(
    client, monkeypatch, song
):
    bg_id = _upload(client)
    monkeypatch.setattr(main_mod, "run_video_render", lambda *args: None)

    client.post(f"/api/project/{song}/render", json={"custom_bg_id": bg_id})

    assert _file(bg_id).exists()
    # Nothing holds it any more: the next delete is carried out at once
    assert client.delete(f"/api/background/{bg_id}").json()["deleted"] is True


def test_a_refused_render_holds_nothing(client, monkeypatch):
    bg_id = _upload(client)

    res = client.post("/api/project/no_such_song/render", json={"custom_bg_id": bg_id})

    assert res.status_code == 404
    assert client.delete(f"/api/background/{bg_id}").json()["deleted"] is True


def test_an_upload_two_renders_use_goes_when_the_second_ends(client):
    bg_id = _upload(client)
    uploaded_backgrounds.hold(bg_id)
    uploaded_backgrounds.hold(bg_id)

    assert uploaded_backgrounds.remove(bg_id) is False
    uploaded_backgrounds.release(bg_id)
    assert _file(bg_id).exists()
    uploaded_backgrounds.release(bg_id)
    assert not _file(bg_id).exists()


def test_a_render_without_an_upload_holds_and_releases_nothing(client, monkeypatch, song):
    monkeypatch.setattr(main_mod, "run_video_render", lambda *args: None)

    for bg in (None, "../../etc/passwd", "stage.png"):
        res = client.post(f"/api/project/{song}/render", json={"custom_bg_id": bg})
        assert res.status_code == 200, res.text
        # The stand-in render does not end the way a real one does
        main_mod.active_cancellations.clear()

    assert uploaded_backgrounds._HELD == {}
