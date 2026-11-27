"""The show's video routes: whether a karaoke video can be embedded, and the copy the server
keeps of one that cannot.

A host screen asks about each YouTube video it queues. YouTube's oEmbed endpoint answers 200
for a video its embedded player will play and 401 for one whose uploader turned embedding
off; for those the host asks the server to fetch a copy, polls until it is ready and plays
the file on the stage."""

import pytest

import backend.main as main_mod
from backend import update_drain
from backend.services import show_videos
from backend.services.media_links import UnusableLink

VIDEO_ID = "dQw4w9WgXcQ"
OTHER_ID = "9bZkp7q19f0"
MP4_BYTES = b"\x00\x00\x00\x18ftypmp42" + b"karaoke-video" * 64


@pytest.fixture
def fetched(monkeypatch):
    """Stands in for yt-dlp: writes a small MP4 where a download would, and counts calls."""
    calls: list[str] = []

    def download(video_id, on_progress):
        calls.append(video_id)
        on_progress(50.0)
        target = show_videos.videos_dir() / f"{video_id}.fetch.mp4"
        target.write_bytes(MP4_BYTES)
        return target

    monkeypatch.setattr(show_videos, "download_video", download)
    return calls


def test_a_video_nobody_has_asked_about_has_no_copy(client):
    body = client.get(f"/api/show/videos/{VIDEO_ID}").json()

    assert body == {
        "video_id": VIDEO_ID,
        "embeddable": None,
        "title": None,
        "channel": None,
        "status": "none",
        "progress": 0,
        "url": None,
        "error": None,
        "downloads": True,
    }


@pytest.mark.parametrize(
    ("oembed_status", "expected"),
    [(200, True), (401, False), (403, False), (404, None), (500, None), (None, None)],
)
def test_embeddable_follows_youtubes_oembed_answer(client, monkeypatch, oembed_status, expected):
    monkeypatch.setattr(show_videos, "_oembed", lambda video_id: (oembed_status, {}))

    assert client.get(f"/api/show/videos/{VIDEO_ID}").json()["embeddable"] is expected


def test_a_video_that_can_be_embedded_comes_with_its_title_and_channel(client, monkeypatch):
    said = {"title": "  Halo (Karaoke Version)  ", "author_name": "Sing King", "html": "<iframe>"}
    monkeypatch.setattr(show_videos, "_oembed", lambda video_id: (200, said))

    body = client.get(f"/api/show/videos/{VIDEO_ID}").json()

    assert body["title"] == "Halo (Karaoke Version)"
    assert body["channel"] == "Sing King"


def test_a_video_youtube_will_not_embed_has_no_title_to_show(client, monkeypatch):
    monkeypatch.setattr(show_videos, "_oembed", lambda video_id: (401, {}))

    body = client.get(f"/api/show/videos/{VIDEO_ID}").json()

    assert (body["embeddable"], body["title"], body["channel"]) == (False, None, None)


def test_youtube_is_asked_once_for_a_video_it_answered_for(client, monkeypatch):
    asked: list[str] = []

    def oembed(video_id):
        asked.append(video_id)
        return 401, {}

    monkeypatch.setattr(show_videos, "_oembed", oembed)

    for _ in range(3):
        assert client.get(f"/api/show/videos/{VIDEO_ID}").json()["embeddable"] is False
    client.get(f"/api/show/videos/{OTHER_ID}")

    assert asked == [VIDEO_ID, OTHER_ID]


@pytest.mark.parametrize("bad_id", ["short", "x" * 12, "has space!!", "..secret..x"])
def test_only_a_video_id_names_a_video(client, bad_id):
    assert client.get(f"/api/show/videos/{bad_id}").status_code == 404
    assert client.post(f"/api/show/videos/{bad_id}/fetch").status_code == 404
    assert client.get(f"/api/show/videos/{bad_id}/file").status_code == 404


def test_a_full_link_is_not_taken_for_an_id(client):
    # The id names a file; the routes take the id alone, never something an id is read out of
    response = client.get("/api/show/videos/watch%3Fv%3DdQw4w9WgXcQ")

    assert response.status_code == 404


def test_fetching_keeps_a_copy_the_stage_can_play(client, fetched):
    started = client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert started.status_code == 200
    body = client.get(f"/api/show/videos/{VIDEO_ID}").json()
    assert body["status"] == "ready"
    assert body["progress"] == 100
    assert body["url"] == f"/api/show/videos/{VIDEO_ID}/file"
    assert fetched == [VIDEO_ID]

    video = client.get(body["url"])
    assert video.status_code == 200
    assert video.headers["content-type"] == "video/mp4"
    assert video.content == MP4_BYTES
    # No download left half-written beside it
    assert [p.name for p in show_videos.videos_dir().iterdir()] == [f"{VIDEO_ID}.mp4"]


def test_the_copy_is_served_in_ranges_so_the_stage_can_seek(client, fetched):
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    part = client.get(f"/api/show/videos/{VIDEO_ID}/file", headers={"Range": "bytes=4-11"})

    assert part.status_code == 206
    assert part.content == MP4_BYTES[4:12]


def test_a_video_with_a_copy_is_not_downloaded_again(client, fetched):
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")
    again = client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert again.json()["status"] == "ready"
    assert fetched == [VIDEO_ID]


def test_there_is_no_file_before_a_copy_is_ready(client):
    assert client.get(f"/api/show/videos/{VIDEO_ID}/file").status_code == 404


def test_a_fetch_releases_its_place_among_the_running_jobs(client, fetched):
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert main_mod.active_cancellations == {}
    assert update_drain.active_jobs()["count"] == 0


def test_a_fetch_counts_as_a_show_video_job_while_it_runs(client, monkeypatch):
    seen: dict = {}

    def download(video_id, on_progress):
        seen.update(update_drain.active_jobs())
        seen["status"] = show_videos.status(video_id, check_embed=False)["status"]
        target = show_videos.videos_dir() / f"{video_id}.fetch.mp4"
        target.write_bytes(MP4_BYTES)
        return target

    monkeypatch.setattr(show_videos, "download_video", download)

    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert seen["kinds"] == {"show video": 1}
    assert seen["status"] == "fetching"


def test_a_failed_download_says_so_and_can_be_tried_again(client, monkeypatch, fetched):
    def broken(video_id, on_progress):
        raise RuntimeError("Sign in to confirm you're not a bot")

    monkeypatch.setattr(show_videos, "download_video", broken)
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    failed = client.get(f"/api/show/videos/{VIDEO_ID}").json()
    assert failed["status"] == "failed"
    assert failed["error"] == show_videos.FETCH_FAILED_DETAIL
    assert "bot" not in failed["error"]
    assert main_mod.active_cancellations == {}


def test_a_refused_video_gives_its_reason(client, monkeypatch):
    def refused(video_id, on_progress):
        raise UnusableLink("That link is a live stream, which has no end to download.")

    monkeypatch.setattr(show_videos, "download_video", refused)
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    failed = client.get(f"/api/show/videos/{VIDEO_ID}").json()
    assert failed["status"] == "failed"
    assert "live stream" in failed["error"]


def test_a_failed_video_fetches_on_the_next_request(client, monkeypatch, fetched):
    def broken(video_id, on_progress):
        raise RuntimeError("network")

    working = show_videos.download_video
    monkeypatch.setattr(show_videos, "download_video", broken)
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")
    monkeypatch.setattr(show_videos, "download_video", working)

    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert client.get(f"/api/show/videos/{VIDEO_ID}").json()["status"] == "ready"


def test_a_server_that_keeps_no_copies_refuses_to_fetch(client, monkeypatch, fetched):
    monkeypatch.setenv("SHOW_VIDEO_DOWNLOADS", "0")

    response = client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert response.status_code == 409
    assert fetched == []
    assert client.get(f"/api/show/videos/{VIDEO_ID}").json()["downloads"] is False
    assert client.get("/api/capabilities").json()["show"] == {"video_downloads": False}


def test_capabilities_say_copies_are_kept_by_default(client):
    assert client.get("/api/capabilities").json()["show"] == {"video_downloads": True}


def test_no_fetch_starts_while_an_update_waits(client, fetched):
    update_drain.drain_file().write_text("")

    response = client.post(f"/api/show/videos/{VIDEO_ID}/fetch")

    assert response.status_code == 503
    assert fetched == []
    assert client.get(f"/api/show/videos/{VIDEO_ID}").json()["status"] == "none"


def test_a_video_already_kept_still_answers_while_an_update_waits(client, fetched):
    client.post(f"/api/show/videos/{VIDEO_ID}/fetch")
    update_drain.drain_file().write_text("")

    assert client.post(f"/api/show/videos/{VIDEO_ID}/fetch").json()["status"] == "ready"


def test_the_routes_need_the_passphrase(unauth_client):
    assert unauth_client.get(f"/api/show/videos/{VIDEO_ID}").status_code == 401
    assert unauth_client.post(f"/api/show/videos/{VIDEO_ID}/fetch").status_code == 401
    assert unauth_client.get(f"/api/show/videos/{VIDEO_ID}/file").status_code == 401
