"""An uploaded song's text fields have the limits a link intake and a rename have.

POST /api/upload-track took its title, artist, creator and lyrics as plain form fields, so
each could hold as much text as the request allowed and all of it went into projects.json.
They now have the limits of ProcessRequest (lyrics 50,000, creator 64) and
ProjectMetadataUpdate (title and artist 300)."""

import pytest

import backend.main as main_mod
from backend.main import active_cancellations, projects

WAV = b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 64
LIMITS = {"title": 300, "artist": 300, "created_by": 64, "custom_lyrics": 50_000}


@pytest.fixture
def uploads(monkeypatch):
    started = []
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args: started.append(args))
    before = set(projects)
    yield started
    for pid in set(projects) - before:
        projects.pop(pid, None)
        active_cancellations.pop(pid, None)


def _upload(client, **fields):
    return client.post(
        "/api/upload-track", data=fields, files={"file": ("song.wav", WAV, "audio/wav")}
    )


@pytest.mark.parametrize("field", list(LIMITS))
def test_a_field_over_its_limit_is_refused_and_nothing_is_stored(client, uploads, field):
    before = set(projects)

    res = _upload(client, **{field: "x" * (LIMITS[field] + 1)})

    assert res.status_code == 422, res.text
    assert field in str(res.json()["detail"])
    assert set(projects) == before
    assert uploads == []
    assert list(main_mod.DOWNLOADS_DIR.iterdir()) == []


def test_fields_at_their_limits_are_accepted(client, uploads):
    res = _upload(client, **{field: "x" * limit for field, limit in LIMITS.items()})

    assert res.status_code == 200, res.text
    song = projects[res.json()["project_id"]]
    assert song["title"] == "x" * 300
    assert song["artist"] == "x" * 300
    assert song["created_by"] == "x" * 64
    assert len(uploads) == 1
    assert uploads[0][-1] == "x" * 50_000
