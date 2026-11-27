"""The copies a show keeps of videos that cannot be embedded: what yt-dlp is asked for, and
which copies go when the folder passes its size limit."""

import copy
import os
from typing import ClassVar

import pytest
import yt_dlp

from backend import update_drain
from backend.services import show_videos
from backend.services.downloader import refuse_unsuitable
from backend.services.media_links import UnusableLink

VIDEO_ID = "dQw4w9WgXcQ"
SONG_CLIENTS = [["ios", "android", "mweb"], ["android"], ["web"]]


def _clients(options: dict) -> list[str] | None:
    """The YouTube clients an attempt names; None when it leaves the choice to yt-dlp."""
    return options.get("extractor_args", {}).get("youtube", {}).get("player_client")


class FakeYoutubeDL:
    """yt-dlp's downloader: records the options of every attempt and writes the merged MP4,
    unless the attempt's clients are listed in ``failing`` (None: yt-dlp's own choice of
    clients, which is what an attempt without ``extractor_args`` uses)."""

    attempts: ClassVar[list[dict]] = []
    failing: ClassVar[list[list[str] | None]] = []
    error: ClassVar[Exception] = RuntimeError("HTTP Error 403: Forbidden")

    def __init__(self, options):
        self.options = options
        # The caller reuses one options dict and swaps the clients in for each attempt
        FakeYoutubeDL.attempts.append(copy.deepcopy(options))

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False):
        if _clients(self.options) in FakeYoutubeDL.failing:
            raise FakeYoutubeDL.error
        out = self.options["outtmpl"].replace("%(ext)s", "mp4")
        with open(out, "wb") as handle:
            handle.write(b"mp4-bytes")
        return {"id": VIDEO_ID, "url": url}


@pytest.fixture
def ytdl(monkeypatch):
    FakeYoutubeDL.attempts = []
    FakeYoutubeDL.failing = []
    FakeYoutubeDL.error = RuntimeError("HTTP Error 403: Forbidden")
    monkeypatch.setattr(yt_dlp, "YoutubeDL", FakeYoutubeDL)
    return FakeYoutubeDL


def test_the_video_is_asked_for_as_an_mp4_a_browser_plays(ytdl):
    finished = show_videos.download_video(VIDEO_ID, lambda percent: None)

    assert finished == show_videos.videos_dir() / f"{VIDEO_ID}.fetch.mp4"
    assert finished.read_bytes() == b"mp4-bytes"
    assert len(ytdl.attempts) == 1
    options = ytdl.attempts[0]
    # H.264 with AAC first, then the best picture there is, never above 720p
    assert options["format"] == (
        "bv*[vcodec^=avc1][height<=720]+ba[acodec^=mp4a]/bv*[height<=720]+ba/b[height<=720]/b"
    )
    # yt-dlp's own clients are the ones offered 720p; the song downloader's get 360p
    assert _clients(options) is None
    assert options["merge_output_format"] == "mp4"
    assert options["noplaylist"] is True
    # A live stream or an hours-long video is refused on its metadata, before it downloads
    assert options["match_filter"] is refuse_unsuitable


def test_the_song_downloaders_clients_are_tried_when_the_first_choice_fails(ytdl):
    ytdl.failing = [None, ["ios", "android", "mweb"]]

    finished = show_videos.download_video(VIDEO_ID, lambda percent: None)

    assert finished.is_file()
    assert [_clients(a) for a in ytdl.attempts] == [None, ["ios", "android", "mweb"], ["android"]]


def test_a_video_no_client_can_download_fails_and_leaves_nothing(ytdl):
    ytdl.failing = [None, *SONG_CLIENTS]

    with pytest.raises(RuntimeError, match="Could not download"):
        show_videos.download_video(VIDEO_ID, lambda percent: None)

    assert list(show_videos.videos_dir().iterdir()) == []


def test_a_refused_video_is_not_tried_with_another_client(ytdl):
    ytdl.failing = [None]
    ytdl.error = UnusableLink("That link is a live stream, which has no end to download.")

    with pytest.raises(UnusableLink):
        show_videos.download_video(VIDEO_ID, lambda percent: None)

    assert len(ytdl.attempts) == 1


def test_progress_is_reported_from_the_bytes_downloaded(ytdl):
    seen: list[float] = []
    show_videos.download_video(VIDEO_ID, seen.append)

    hook = ytdl.attempts[0]["progress_hooks"][0]
    hook({"status": "downloading", "downloaded_bytes": 250, "total_bytes": 1000})
    hook({"status": "downloading", "downloaded_bytes": 600, "total_bytes_estimate": 1200})
    hook({"status": "downloading", "downloaded_bytes": 10})
    hook({"status": "finished", "downloaded_bytes": 1000, "total_bytes": 1000})

    assert seen == [25.0, 50.0]


def _copy(video_id: str, megabytes: int, age_sec: int) -> None:
    """A kept copy of this size, last used this long ago."""
    path = show_videos.video_file(video_id)
    with open(path, "wb") as handle:
        handle.truncate(megabytes * 1024 * 1024)
    stamp = 1_700_000_000 - age_sec
    os.utime(path, (stamp, stamp))


def _kept() -> set[str]:
    return {p.stem for p in show_videos.videos_dir().glob("*.mp4")}


def test_the_least_recently_used_copies_go_first(monkeypatch):
    monkeypatch.setenv("SHOW_VIDEO_CACHE_GB", "0.01")  # about 10 MB
    _copy("oldestvideo", 4, age_sec=300)
    _copy("middlevideo", 4, age_sec=200)
    _copy("newestvideo", 4, age_sec=100)

    removed = show_videos.evict()

    assert removed == ["oldestvideo"]
    assert _kept() == {"middlevideo", "newestvideo"}


def test_the_copy_just_fetched_is_never_the_one_removed(monkeypatch):
    monkeypatch.setenv("SHOW_VIDEO_CACHE_GB", "0.005")  # about 5 MB
    _copy("justfetched", 8, age_sec=300)
    _copy("usedearlier", 4, age_sec=100)

    show_videos.evict(keep="justfetched")

    assert _kept() == {"justfetched"}


def test_playing_a_copy_keeps_it_from_being_removed(monkeypatch):
    monkeypatch.setenv("SHOW_VIDEO_CACHE_GB", "0.005")
    _copy("playedtoday", 4, age_sec=300)
    _copy("notplayedxx", 4, age_sec=100)

    show_videos.touch("playedtoday")
    show_videos.evict()

    assert _kept() == {"playedtoday"}


@pytest.mark.parametrize("limit", ["0", "0.0"])
def test_no_limit_removes_nothing(monkeypatch, limit):
    monkeypatch.setenv("SHOW_VIDEO_CACHE_GB", limit)
    _copy("oldestvideo", 4, age_sec=300)
    _copy("newestvideo", 4, age_sec=100)

    assert show_videos.evict() == []
    assert _kept() == {"oldestvideo", "newestvideo"}


def test_a_limit_that_cannot_be_read_falls_back_to_the_default(monkeypatch):
    monkeypatch.setenv("SHOW_VIDEO_CACHE_GB", "plenty")

    assert show_videos.cache_limit_bytes() == int(show_videos.DEFAULT_CACHE_GB * 1024**3)


@pytest.mark.parametrize(
    ("value", "enabled"),
    [("1", True), ("yes", True), ("", True), ("0", False), ("false", False), ("OFF", False)],
)
def test_downloads_are_on_unless_switched_off(monkeypatch, value, enabled):
    monkeypatch.setenv("SHOW_VIDEO_DOWNLOADS", value)

    assert show_videos.downloads_enabled() is enabled


def test_a_fetch_is_named_among_the_jobs_an_update_waits_for():
    assert update_drain._job_kind(f"{VIDEO_ID}_show_video") == "show video"
