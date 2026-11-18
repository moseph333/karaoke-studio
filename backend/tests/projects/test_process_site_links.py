"""Starting a song from a SoundCloud, Bandcamp, Vimeo, Internet Archive, Spotify, Apple Music,
TIDAL or Deezer link: the project is named by the song's track id, keeps its link from the start (so
a failed download can be tried again), and the same song pasted twice opens the one project."""

import backend.main as main_mod
from backend.services.media_links import parse_media_link

LINK = "https://soundcloud.com/forss/flickermood"


def test_a_site_link_starts_a_project_named_by_its_track_id(client, monkeypatch):
    started = []
    monkeypatch.setattr(main_mod, "run_pipeline", lambda pid, url, lyrics=None: started.append(url))

    res = client.post("/api/process", json={"url_or_id": LINK})

    assert res.status_code == 200
    track_id = parse_media_link(LINK).track_id
    assert res.json() == {"project_id": track_id, "status": "queued"}
    proj = main_mod.projects[track_id]
    assert (proj["track_id"], proj["url"]) == (track_id, LINK)
    assert started == [LINK]


def test_the_same_song_pasted_again_opens_its_ready_project(client, monkeypatch):
    monkeypatch.setattr(main_mod, "run_pipeline", lambda pid, url, lyrics=None: None)
    track_id = parse_media_link(LINK).track_id
    ready = {"id": track_id, "track_id": track_id, "status": "ready", "lines": []}
    monkeypatch.setitem(main_mod.projects, track_id, ready)

    res = client.post("/api/process", json={"url_or_id": LINK + "?si=shared-from-the-app"})

    assert res.json() == {"project_id": track_id, "status": "ready"}


def test_a_link_that_is_not_one_song_explains_itself(client):
    res = client.post("/api/process", json={"url_or_id": "https://artist.bandcamp.com/album/x"})
    assert res.status_code == 422
    assert "Bandcamp album" in str(res.json()["detail"])


def test_a_link_to_another_site_names_the_supported_ones(client):
    res = client.post(
        "/api/process", json={"url_or_id": "https://music.amazon.com/tracks/B0ABCDEFGH"}
    )
    assert res.status_code == 422
    detail = str(res.json()["detail"])
    assert "Internet Archive, Spotify, Apple Music, TIDAL or Deezer" in detail


def test_a_spotify_link_starts_a_project_named_by_its_spotify_id(client, monkeypatch):
    started = []
    monkeypatch.setattr(main_mod, "run_pipeline", lambda pid, url, lyrics=None: started.append(url))
    link = "https://open.spotify.com/intl-de/track/4cOdK2wGLETKBW3PvgPWqT?si=abc"

    res = client.post("/api/process", json={"url_or_id": link})

    assert res.json() == {"project_id": "spotify-4cOdK2wGLETKBW3PvgPWqT", "status": "queued"}
    proj = main_mod.projects["spotify-4cOdK2wGLETKBW3PvgPWqT"]
    assert proj["url"] == "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
    assert started == [link]
