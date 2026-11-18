"""A custom backing track can be uploaded for any song id.

The route cleaned the id like an uploaded file name, which cuts leading and trailing "-", "_"
and ".". A YouTube id may start or end with "-" or "_", so those songs answered 404."""

import pytest

import backend.main as main_mod
from backend.main import projects

WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 64


def _song(pid: str, **fields) -> str:
    projects[pid] = {"id": pid, "status": "ready", "lines": [], **fields}
    return pid


def _upload(client, pid: str):
    return client.post(
        "/api/upload-instrumental",
        data={"project_id": pid},
        files={"file": ("backing.wav", WAV, "audio/wav")},
    )


@pytest.mark.parametrize("pid", ["-Ab3dEf9hIj", "_Ab3dEf9hIj", "Ab3dEf9hI-_", "--________-"])
def test_an_id_that_starts_or_ends_with_a_dash_or_underscore_is_found(client, pid):
    _song(pid)

    res = _upload(client, pid)

    assert res.status_code == 200, res.text
    assert res.json()["instrumental_url"] == f"/static/stems/{pid}/custom_inst.wav"
    stored = main_mod.STEMS_DIR / pid / "custom_inst.wav"
    assert stored.read_bytes() == WAV
    assert projects[pid]["instrumental_path"] == str(stored)


def test_a_song_addressed_by_its_track_id_keeps_the_file_under_its_own_id(client):
    _song("song-one", track_id="track-one")

    res = _upload(client, "track-one")

    assert res.status_code == 200, res.text
    assert res.json()["instrumental_url"] == "/static/stems/song-one/custom_inst.wav"
    assert (main_mod.STEMS_DIR / "song-one" / "custom_inst.wav").is_file()


@pytest.mark.parametrize("pid", ["../outside", "..", "a/b", "a\\b", "song.one", "", "x" * 65])
def test_text_that_is_not_a_song_id_is_no_song_and_writes_nothing(client, pid):
    res = _upload(client, pid)

    assert res.status_code in (404, 422)
    assert list(main_mod.STEMS_DIR.iterdir()) == []
