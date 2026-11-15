"""GET /api/projects?summary=1: the short entries the library grid loads instead of whole songs."""

import backend.main as main_mod
from backend.routers.projects import SUMMARY_FIELDS


def _song(song_id: str, **fields) -> dict:
    proj = {
        "id": song_id,
        "track_id": song_id,
        "status": "ready",
        "progress": 100,
        "title": f"Song {song_id}",
        "artist": "The Band",
        "duration": 180.0,
        "thumbnail_url": f"/static/downloads/{song_id}.jpg",
        "created_by": "Alex",
        "created_at": 1700000000.0,
        "audio_path": f"/data/downloads/{song_id}.wav",
        "lines": [
            {"id": i, "text": f"Line {i} of the song", "start_time": i, "end_time": i + 1}
            for i in range(60)
        ],
        "chords": [{"chord": "C", "start_time": 0.0, "end_time": 1.0}] * 100,
        **fields,
    }
    main_mod.projects[song_id] = proj
    return proj


def test_summary_entries_carry_only_what_a_library_card_shows(client):
    _song("lib1")

    res = client.get("/api/projects?summary=1")

    assert res.status_code == 200
    entry = res.json()["lib1"]
    assert set(entry) == {*SUMMARY_FIELDS, "summary"}
    assert entry["summary"] is True
    assert (entry["title"], entry["artist"], entry["status"]) == ("Song lib1", "The Band", "ready")
    assert entry["thumbnail_url"] == "/static/downloads/lib1.jpg"
    assert entry["created_by"] == "Alex"
    # Neither the lyrics nor server file paths
    assert "lines" not in entry and "chords" not in entry and "audio_path" not in entry


def test_summary_leaves_out_fields_a_song_does_not_have_yet(client):
    main_mod.projects["new1"] = {"id": "new1", "status": "error", "error": "Download failed"}

    entry = client.get("/api/projects?summary=1").json()["new1"]

    assert entry == {"id": "new1", "status": "error", "summary": True}


def test_summary_is_far_smaller_than_the_full_listing(client):
    for i in range(5):
        _song(f"big{i}")

    summary = client.get("/api/projects?summary=1")
    full = client.get("/api/projects")

    assert len(summary.content) * 10 < len(full.content)


def test_the_full_listing_is_unchanged_without_the_parameter(client):
    _song("full1")

    entry = client.get("/api/projects").json()["full1"]

    assert len(entry["lines"]) == 60
    assert "summary" not in entry


def test_summary_respects_the_my_scope(client):
    _song("mine1", created_by="Alex")
    _song("theirs1", created_by="Sam")

    listed = client.get("/api/projects?summary=1&scope=my&user=Alex").json()

    assert "mine1" in listed and "theirs1" not in listed


def test_summary_entries_are_snapshots_of_the_store(client):
    proj = _song("snap1")

    entry = client.get("/api/projects?summary=1").json()["snap1"]
    entry["title"] = "Changed"

    assert proj["title"] == "Song snap1"
    assert "summary" not in proj
