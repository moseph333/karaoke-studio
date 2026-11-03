"""POST /api/upload-instrumental checks the file's header before it replaces the song's backing
track, and refuses while the intake that would overwrite it is still running."""

import pytest

import backend.main as main_mod
from backend.project_store import PROJECTS_LOCK, load_projects, save_projects
from backend.routers import uploads

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(64)
OTHER_WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + b"\x01" * 64


@pytest.fixture
def song():
    pid = "inst_song"
    stem_dir = main_mod.STEMS_DIR / pid
    stem_dir.mkdir(parents=True, exist_ok=True)
    inst = stem_dir / "instrumental.wav"
    inst.write_bytes(WAV)
    main_mod.projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Backing Song",
        "status": "ready",
        "lines": [],
        "instrumental_path": str(inst),
        "instrumental_url": f"/static/stems/{pid}/instrumental.wav",
    }
    save_projects()
    return pid


def _upload(client, pid, payload, name="backing.wav", mime="audio/wav"):
    return client.post(
        "/api/upload-instrumental",
        data={"project_id": pid},
        files={"file": (name, payload, mime)},
    )


def _instrumental(pid) -> tuple:
    proj = main_mod.projects[pid]
    return proj["instrumental_path"], proj["instrumental_url"]


def _custom_files(pid) -> list[str]:
    return sorted(p.name for p in (main_mod.STEMS_DIR / pid).iterdir() if "custom" in p.name)


def test_a_file_that_is_not_audio_is_refused_and_leaves_nothing_behind(client, song):
    before = _instrumental(song)

    res = _upload(client, song, b"Hello, I am a text file and not a WAV at all")

    assert res.status_code == 400
    assert "invalid magic bytes" in res.json()["detail"]
    assert _instrumental(song) == before
    assert _custom_files(song) == []


def test_a_refused_upload_keeps_the_previous_custom_backing_track(client, song):
    assert _upload(client, song, WAV).status_code == 200
    custom = main_mod.STEMS_DIR / song / "custom_inst.wav"
    before = _instrumental(song)

    res = _upload(client, song, b"\x00" * 512)

    assert res.status_code == 400
    assert custom.read_bytes() == WAV
    assert _instrumental(song) == before
    assert load_projects()[song]["instrumental_path"] == str(custom)
    assert _custom_files(song) == ["custom_inst.wav"]


@pytest.mark.parametrize("status", ["separating", "aligning"])
def test_an_upload_while_the_song_is_still_processing_is_refused(client, song, status):
    main_mod.projects[song]["status"] = status
    before = _instrumental(song)

    res = _upload(client, song, WAV)

    assert res.status_code == 409
    assert res.json()["detail"] == "This song is still being processed"
    assert _instrumental(song) == before
    assert _custom_files(song) == []


def test_an_upload_while_the_stems_are_re_made_is_accepted(client, song):
    # The re-separation keeps custom_inst.* when it swaps the new stems in
    main_mod.projects[song]["separation_job"] = {"id": "j1", "status": "running", "progress": 40}

    res = _upload(client, song, WAV)

    assert res.status_code == 200, res.text
    assert main_mod.projects[song]["instrumental_url"].endswith("custom_inst.wav")


def test_an_accepted_upload_is_stored_under_the_store_lock(client, monkeypatch, song):
    held: list[bool] = []
    real = uploads.save_projects

    def spy(*args, **kwargs):
        held.append(PROJECTS_LOCK._is_owned())
        return real(*args, **kwargs)

    monkeypatch.setattr(uploads, "save_projects", spy)
    assert _upload(client, song, WAV).status_code == 200

    res = _upload(client, song, OTHER_WAV)

    assert res.status_code == 200, res.text
    assert held == [True, True]
    custom = main_mod.STEMS_DIR / song / "custom_inst.wav"
    assert custom.read_bytes() == OTHER_WAV
    assert _instrumental(song) == (str(custom), f"/static/stems/{song}/custom_inst.wav")
    assert res.json()["instrumental_url"] == f"/static/stems/{song}/custom_inst.wav"
    assert load_projects()[song]["instrumental_path"] == str(custom)
    assert _custom_files(song) == ["custom_inst.wav"]


def test_an_mp3_with_an_id3_tag_is_accepted(client, song):
    res = _upload(client, song, b"ID3\x04" + bytes(2048), name="backing.mp3", mime="audio/mpeg")

    assert res.status_code == 200, res.text
    assert res.json()["instrumental_url"].endswith("custom_inst.mp3")
    assert _custom_files(song) == ["custom_inst.mp3"]
