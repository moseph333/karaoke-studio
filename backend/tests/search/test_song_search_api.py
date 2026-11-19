"""POST /api/search/songs and POST /api/search: the songs (or YouTube uploads) for the
typed words, with the ones already in the library marked so the studio opens them instead
of making them again."""

import backend.main as main_mod
from backend.services import song_search
from backend.tests.helpers.song_catalogs import FakeCatalogs, deezer_entry, itunes_entry

HALO = deezer_entry("Halo", "Beyoncé", song_id=100, duration=261, rank=900_000)
HALO_LIVE = deezer_entry("Halo (Live)", "Beyoncé", song_id=101, duration=392, rank=400_000)
HALO_APPLE = itunes_entry("Halo", "Beyoncé", song_id=200, seconds=261.6)


def _catalogs(monkeypatch, **listings) -> FakeCatalogs:
    fake = FakeCatalogs(
        deezer=listings.get("deezer", {"halo": [HALO, HALO_LIVE]}),
        itunes=listings.get("itunes", {"halo": [HALO_APPLE]}),
        suggest=listings.get("suggest", {}),
        down=listings.get("down", ()),
    )
    monkeypatch.setattr(song_search, "_get_json", fake)
    return fake


def _search(client, query="halo", **body):
    res = client.post("/api/search/songs", json={"query": query, **body})
    assert res.status_code == 200, res.text
    return res.json()


def test_songs_come_back_best_first_with_the_link_that_starts_each(client, monkeypatch):
    _catalogs(monkeypatch)

    data = _search(client, "  halo ")

    assert data["query"] == "halo"
    assert data["corrected"] is None
    assert data["sources"] == ["deezer", "itunes"]
    assert [(r["title"], r["versions"]) for r in data["results"]] == [
        ("Halo", []),
        ("Halo (Live)", ["live"]),
    ]
    first = data["results"][0]
    # One recording from both catalogs: started by its Deezer link, known by both ids
    assert first["url"] == "https://www.deezer.com/track/100"
    assert first["track_ids"] == ["deezer-100", "applemusic-200"]
    assert (first["project_id"], first["project_status"]) == (None, None)


def test_the_respelled_query_is_reported(client, monkeypatch):
    _catalogs(
        monkeypatch,
        deezer={"halo beyonce": [HALO]},
        itunes={},
        suggest={"hallo beyonse": ["halo beyonce"]},
    )

    data = _search(client, "hallo beyonse")

    assert data["corrected"] == "halo beyonce"
    assert [r["title"] for r in data["results"]] == ["Halo"]


def test_the_limit_caps_the_songs(client, monkeypatch):
    many = [deezer_entry(f"Song {n}", "Band", song_id=n, duration=100 + 10 * n) for n in range(20)]
    _catalogs(monkeypatch, deezer={"band": many}, itunes={})

    assert len(_search(client, "band")["results"]) == 8
    assert len(_search(client, "band", limit=3)["results"]) == 3
    assert len(_search(client, "band", limit=25)["results"]) == 20


def test_a_song_made_from_the_same_catalog_entry_is_marked(client, monkeypatch):
    _catalogs(monkeypatch)
    # Made earlier from the Apple Music entry of the recording Deezer lists too
    made = {"id": "applemusic-200", "track_id": "applemusic-200", "status": "ready"}
    monkeypatch.setitem(main_mod.projects, "applemusic-200", made)

    studio, live = _search(client)["results"]

    assert (studio["project_id"], studio["project_status"]) == ("applemusic-200", "ready")
    assert live["project_id"] is None


def test_a_song_made_from_a_youtube_link_is_marked_by_its_name_and_length(client, monkeypatch):
    _catalogs(monkeypatch)
    pasted = {
        "id": "bnVUHWCynig",
        "track_id": "bnVUHWCynig",
        "status": "separating",
        "title": "Halo",
        "artist": "Beyonce",
        "duration": 264.0,
    }
    monkeypatch.setitem(main_mod.projects, "bnVUHWCynig", pasted)

    studio, live = _search(client)["results"]

    assert (studio["project_id"], studio["project_status"]) == ("bnVUHWCynig", "separating")
    # The live take is another recording: two minutes longer
    assert live["project_id"] is None


def test_other_songs_failed_songs_and_other_artists_are_not_marked(client, monkeypatch):
    _catalogs(monkeypatch)
    library = {
        "failed": {"id": "deezer-100", "status": "failed", "title": "Halo", "artist": "Beyoncé"},
        "cover": {"id": "c", "status": "ready", "title": "Halo", "artist": "Cage the Elephant"},
        "other": {"id": "o", "status": "ready", "title": "Halo Halo", "artist": "Beyoncé"},
        "edit": {
            "id": "e",
            "status": "ready",
            "title": "Halo",
            "artist": "Beyoncé",
            "duration": 90,
        },
    }
    for key, proj in library.items():
        monkeypatch.setitem(main_mod.projects, key, proj)

    assert [r["project_id"] for r in _search(client)["results"]] == [None, None]


def test_a_library_song_without_a_length_matches_the_plain_recording_only(client, monkeypatch):
    _catalogs(monkeypatch)
    monkeypatch.setitem(
        main_mod.projects,
        "upload",
        {"id": "upload", "status": "ready", "title": "Halo", "artist": "Beyoncé"},
    )

    studio, live = _search(client)["results"]

    assert studio["project_id"] == "upload"
    assert live["project_id"] is None


def test_no_catalog_answering_says_so_with_no_songs(client, monkeypatch):
    _catalogs(monkeypatch, down=("deezer", "itunes"))

    data = _search(client)

    assert (data["results"], data["sources"]) == ([], [])


def test_the_catalog_search_switched_off_answers_the_same_way(client, monkeypatch):
    from backend import config

    fake = _catalogs(monkeypatch)
    monkeypatch.setattr(config, "SONG_SEARCH_SOURCES", ())

    data = _search(client)

    assert (data["results"], data["sources"]) == ([], [])
    assert fake.requests == []


def test_a_search_that_breaks_reports_no_details(client, monkeypatch):
    def crash(query):
        raise RuntimeError("secret at /srv/karaoke")

    monkeypatch.setattr(song_search, "search_songs", crash)

    res = client.post("/api/search/songs", json={"query": "halo"})

    assert res.status_code == 500
    assert "/srv/karaoke" not in res.text


def test_the_request_is_checked(client, unauth_client, monkeypatch):
    _catalogs(monkeypatch)
    assert client.post("/api/search/songs", json={"query": "x" * 201}).status_code == 422
    assert client.post("/api/search/songs", json={"query": "halo", "limit": 26}).status_code == 422
    assert client.post("/api/search/songs", json={}).status_code == 422
    assert unauth_client.post("/api/search/songs", json={"query": "halo"}).status_code == 401


def test_youtube_uploads_already_in_the_library_are_marked(client, monkeypatch):
    uploads = [
        {"id": "bnVUHWCynig", "title": "Beyoncé - Halo", "artist": "Beyoncé", "duration": 264},
        {"id": "aaaaaaaaaaa", "title": "Halo (Lyrics)", "artist": "LyricsChannel", "duration": 262},
    ]
    monkeypatch.setattr(main_mod.downloader, "search_tracks", lambda q, limit=5: uploads)
    made = {"id": "bnVUHWCynig", "track_id": "bnVUHWCynig", "status": "ready", "title": "Halo"}
    monkeypatch.setitem(main_mod.projects, "bnVUHWCynig", made)

    results = client.post("/api/search", json={"query": "halo"}).json()["results"]

    assert [(r["id"], r["project_id"], r["project_status"]) for r in results] == [
        ("bnVUHWCynig", "bnVUHWCynig", "ready"),
        ("aaaaaaaaaaa", None, None),
    ]
    # The downloader's own list is left as it was
    assert "project_id" not in uploads[0]
