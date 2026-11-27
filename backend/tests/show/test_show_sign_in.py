"""The show-only sign-in: a venue's host knows SHOW_PASSWORD, which runs a show and reads the
library and can change nothing.

The host screen trades the show passphrase for a show token. With it the routes a show
makes go through (the songs, one song, its cover art, the YouTube search, the show's videos,
the media); every other route answers 403, never 401, which the screen would take for being
signed out. The token is of its own kind: it is not a session, and a session is not one."""

import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config, show_auth
from backend.auth import create_session_token
from backend.main import app
from backend.services import show_videos

SHOW = "host-of-the-night"
SONG = "song-1"
VIDEO_ID = "dQw4w9WgXcQ"


@pytest.fixture
def show_on(monkeypatch):
    monkeypatch.setattr(config, "SHOW_PASSWORD", SHOW)


@pytest.fixture
def song():
    """A finished song in the library."""
    main_mod.projects[SONG] = {
        "id": SONG,
        "status": "ready",
        "title": "Neon Skyline",
        "artist": "The Midnight Static",
        "lines": [{"id": 1, "text": "city lights", "start_time": 1.0, "end_time": 2.0}],
    }
    return SONG


@pytest.fixture
def venue(show_on):
    """A browser signed in with the show passphrase: it sends the token as a header."""
    browser = TestClient(app)
    res = browser.post("/api/auth/show-login", json={"password": SHOW})
    assert res.status_code == 200, res.text
    browser.cookies.clear()
    browser.headers["X-Show-Token"] = res.json()["token"]
    return browser


# --- Signing in ---


def test_the_show_passphrase_is_traded_for_a_token_and_a_cookie(show_on):
    browser = TestClient(app)

    res = browser.post("/api/auth/show-login", json={"password": SHOW})

    assert res.status_code == 200
    token = res.json()["token"]
    assert token
    assert res.cookies.get(show_auth.COOKIE_NAME) == token
    cookie = res.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie


def test_a_wrong_show_passphrase_is_refused(show_on):
    res = TestClient(app).post("/api/auth/show-login", json={"password": "a guess"})

    assert res.status_code == 401
    assert res.json()["detail"] == show_auth.WRONG_PASSPHRASE_DETAIL


def test_the_studio_passphrase_is_not_the_show_passphrase(show_on):
    res = TestClient(app).post("/api/auth/show-login", json={"password": config.APP_PASSWORD})

    assert res.status_code == 401


def test_a_server_without_a_show_passphrase_has_no_show_sign_in(unauth_client):
    res = unauth_client.post("/api/auth/show-login", json={"password": SHOW})

    assert res.status_code == 403
    assert res.json()["detail"] == show_auth.SHOW_OFF_DETAIL


def test_guesses_at_the_show_passphrase_are_limited(show_on):
    browser = TestClient(app)
    for _ in range(config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS):
        assert browser.post("/api/auth/show-login", json={"password": "nope"}).status_code == 401

    locked = browser.post("/api/auth/show-login", json={"password": SHOW})

    assert locked.status_code == 429


def test_guessing_at_the_show_passphrase_does_not_lock_the_studio_out(show_on, client):
    browser = TestClient(app)
    for _ in range(config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS + 1):
        browser.post("/api/auth/show-login", json={"password": "nope"})

    assert client.get("/api/projects").status_code == 200
    login = TestClient(app).post(
        "/api/auth/login", json={"password": config.APP_PASSWORD, "username": "Owner"}
    )
    assert login.status_code == 200


def test_the_status_says_whether_the_server_has_a_show_sign_in(show_on, unauth_client, venue):
    signed_out = unauth_client.get("/api/auth/status").json()
    assert signed_out["show"] is True
    assert signed_out["show_authenticated"] is False
    assert signed_out["authenticated"] is False

    signed_in = venue.get("/api/auth/status").json()
    assert signed_in["show_authenticated"] is True
    # A show sign-in is not a studio session
    assert signed_in["authenticated"] is False


def test_signing_out_gives_the_cookie_back(show_on):
    browser = TestClient(app)
    browser.post("/api/auth/show-login", json={"password": SHOW})

    res = browser.post("/api/auth/logout")

    assert f"{show_auth.COOKIE_NAME}=" in res.headers["set-cookie"]
    assert "max-age=0" in res.headers["set-cookie"].lower()


# --- What a show sign-in opens ---


def test_a_show_reads_the_songs_and_one_song(venue, song):
    listing = venue.get("/api/projects?scope=all&summary=1")
    assert listing.status_code == 200
    assert SONG in listing.json()

    one = venue.get(f"/api/project/{SONG}")
    assert one.status_code == 200
    assert one.json()["title"] == "Neon Skyline"


def test_a_show_searches_youtube_and_asks_about_its_videos(venue, monkeypatch):
    monkeypatch.setattr(main_mod.downloader, "search_tracks", lambda query, limit=5: [])

    assert venue.post("/api/search", json={"query": "halo karaoke"}).status_code == 200
    assert venue.get(f"/api/show/videos/{VIDEO_ID}").status_code == 200
    assert venue.get("/api/capabilities").status_code == 200


def test_a_show_fetches_and_plays_a_videos_copy(venue, monkeypatch):
    def download(video_id, on_progress):
        target = show_videos.videos_dir() / f"{video_id}.fetch.mp4"
        target.write_bytes(b"mp4")
        return target

    monkeypatch.setattr(show_videos, "download_video", download)

    assert venue.post(f"/api/show/videos/{VIDEO_ID}/fetch").status_code == 200
    video = venue.get(f"/api/show/videos/{VIDEO_ID}/file")
    assert video.status_code == 200
    assert video.content == b"mp4"


def test_a_show_asks_for_a_song_it_could_not_find_and_reads_the_requests(venue):
    asked = venue.post("/api/show/requests", json={"song": "Pink Pony Club", "singer": "Ana"})
    assert asked.status_code == 200

    listed = venue.get("/api/show/requests")
    assert listed.status_code == 200
    assert [entry["song"] for entry in listed.json()["requests"]] == ["Pink Pony Club"]


def test_a_show_cannot_take_a_request_off_the_list(venue, client):
    request_id = venue.post("/api/show/requests", json={"song": "Halo"}).json()["request"]["id"]

    refused = venue.delete(f"/api/show/requests/{request_id}")

    assert refused.status_code == 403
    assert refused.json()["detail"] == show_auth.SHOW_ONLY_DETAIL
    assert len(venue.get("/api/show/requests").json()["requests"]) == 1
    # The studio can
    assert client.delete(f"/api/show/requests/{request_id}").status_code == 200


def test_a_show_loads_media_with_the_cookie_alone(show_on, song):
    # <audio>, <video> and <img> send no header: the cookie the sign-in set has to do
    browser = TestClient(app)
    browser.post("/api/auth/show-login", json={"password": SHOW})
    (config.OUTPUT_DIR / "mix.wav").write_bytes(b"RIFF")

    assert browser.get("/static/output/mix.wav").status_code == 200
    assert browser.get(f"/api/project/{SONG}").status_code == 200


# --- What it does not ---


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("post", f"/api/project/{SONG}/lyrics", {"lines": []}),
        ("patch", f"/api/project/{SONG}", {"title": "Renamed"}),
        ("delete", f"/api/project/{SONG}", None),
        ("post", f"/api/project/{SONG}/render", {}),
        ("post", f"/api/project/{SONG}/mix", {"semitones": 2}),
        ("post", f"/api/project/{SONG}/reseparate", {"quality": "best"}),
        ("post", "/api/process", {"url": f"https://www.youtube.com/watch?v={VIDEO_ID}"}),
        ("post", "/api/search/songs", {"query": "halo"}),
        ("get", f"/api/project/{SONG}/status", None),
        ("get", "/api/admin/settings", None),
        ("post", "/api/system/update", {"action": "update"}),
        ("post", "/api/health", {"action": "update"}),
        ("delete", f"/api/show/videos/{VIDEO_ID}", None),
        ("post", "/static/output/mix.wav", None),
    ],
)
def test_a_show_cannot_change_or_reach_anything_else(venue, song, method, path, body):
    kwargs = {"json": body} if body is not None else {}

    res = getattr(venue, method)(path, **kwargs)

    assert res.status_code == 403
    assert res.json()["detail"] == show_auth.SHOW_ONLY_DETAIL
    # Nothing happened to the song
    assert main_mod.projects[SONG]["title"] == "Neon Skyline"
    assert SONG in main_mod.projects


def test_the_refusal_is_never_a_401_which_would_sign_the_host_out(venue, song):
    assert venue.delete(f"/api/project/{SONG}").status_code == 403


def test_a_route_that_only_starts_like_an_allowed_one_is_refused(venue, song):
    assert venue.get(f"/api/project/{SONG}/lyrics/candidates").status_code == 403
    assert venue.get("/api/projects/export").status_code == 403


# --- The token is of its own kind ---


def test_a_show_token_is_not_a_session(venue, song):
    token = venue.headers["X-Show-Token"]
    as_session = TestClient(app, headers={"X-Session-Token": token})

    assert as_session.get("/api/projects").status_code == 401
    assert as_session.delete(f"/api/project/{SONG}").status_code == 401
    assert SONG in main_mod.projects


def test_a_session_token_is_not_a_show_token(show_on, song):
    session = create_session_token(config.APP_PASSWORD, client_id="Owner")
    as_show = TestClient(app, headers={"X-Show-Token": session})

    assert as_show.get("/api/projects").status_code == 401


def test_a_forged_show_token_is_refused_and_counted(show_on, song):
    browser = TestClient(app)
    for attempt in range(config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS):
        res = browser.get("/api/projects", headers={"X-Show-Token": f"forged-{attempt}"})
        assert res.status_code == 401

    locked = browser.get("/api/projects", headers={"X-Show-Token": "forged-again"})

    assert locked.status_code == 429


def test_a_token_stops_working_when_the_show_passphrase_changes(venue, song, monkeypatch):
    assert venue.get("/api/projects").status_code == 200

    monkeypatch.setattr(config, "SHOW_PASSWORD", "another-night")

    assert venue.get("/api/projects").status_code == 401


def test_a_token_stops_working_when_the_show_sign_in_is_turned_off(venue, song, monkeypatch):
    monkeypatch.setattr(config, "SHOW_PASSWORD", "")

    assert venue.get("/api/projects").status_code == 401


def test_the_studio_passphrase_still_opens_everything(show_on, client, song):
    assert client.get("/api/projects").status_code == 200
    assert client.patch(f"/api/project/{SONG}", json={"title": "Renamed"}).status_code == 200
    assert main_mod.projects[SONG]["title"] == "Renamed"


def test_a_studio_session_wins_over_a_show_token_sent_with_it(venue, client, song):
    client.headers["X-Show-Token"] = venue.headers["X-Show-Token"]

    assert client.patch(f"/api/project/{SONG}", json={"title": "Renamed"}).status_code == 200


def test_without_a_studio_passphrase_there_is_nothing_to_sign_in_to(monkeypatch):
    monkeypatch.setattr(config, "APP_PASSWORD", "")
    monkeypatch.setattr(config, "SHOW_PASSWORD", SHOW)
    browser = TestClient(app)

    assert show_auth.enabled() is False
    assert browser.get("/api/auth/status").json()["show"] is False
    assert browser.post("/api/auth/show-login", json={"password": SHOW}).status_code == 403
    assert browser.get("/api/projects").status_code == 200


@pytest.mark.parametrize(
    ("method", "path", "allowed"),
    [
        ("GET", "/api/projects", True),
        ("HEAD", "/static/output/a.wav", True),
        ("GET", "/api/project/abc", True),
        ("GET", "/api/project/abc/backdrop", True),
        ("POST", "/api/search", True),
        ("POST", f"/api/show/videos/{VIDEO_ID}/fetch", True),
        ("GET", f"/api/show/videos/{VIDEO_ID}/file", True),
        ("POST", "/api/projects", False),
        ("DELETE", "/api/project/abc", False),
        ("GET", "/api/project/abc/chords", False),
        ("GET", "/static/", False),
        ("GET", "/api/show/videos", False),
        ("GET", "/api/show/requests", True),
        ("POST", "/api/show/requests", True),
        ("DELETE", "/api/show/requests", False),
        ("DELETE", "/api/show/requests/abc", False),
        ("POST", "/api/show/requests/abc", False),
        ("PUT", "/api/admin/settings", False),
    ],
)
def test_what_a_show_token_may_ask_for(method, path, allowed):
    assert show_auth.allows(method, path) is allowed
