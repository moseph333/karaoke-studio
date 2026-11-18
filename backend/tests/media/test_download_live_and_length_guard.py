"""A link to a live stream or to an hours-long video is refused before it downloads.

yt-dlp records a live stream for as long as it runs, and a ten-hour video becomes a WAV of
several gigabytes, either of which fills the server's disk. The downloader now reads the
metadata first: a live stream is refused, and so is a recording longer than
MAX_SONG_MINUTES (60 by default, 0 lifts the limit)."""

from unittest.mock import MagicMock, patch

import pytest
import yt_dlp

from backend import config
from backend.services.downloader import TrackDownloader, refuse_unsuitable
from backend.services.media_links import UnusableLink

VIDEO_ID = "dQw4w9WgXcQ"
SOUNDCLOUD_URL = "https://soundcloud.com/some-artist/some-song"


@pytest.fixture
def folder(tmp_path):
    path = tmp_path / "downloads"
    path.mkdir()
    return path


@pytest.mark.parametrize(
    "info",
    [
        {"is_live": True},
        {"live_status": "is_live"},
        {"live_status": "is_upcoming"},
    ],
)
def test_a_live_or_upcoming_stream_is_refused(info):
    with pytest.raises(UnusableLink, match="live stream"):
        refuse_unsuitable({"id": VIDEO_ID, **info})


def test_a_recording_longer_than_the_limit_is_refused_with_both_lengths():
    with pytest.raises(UnusableLink, match=r"600 minutes long.*60 minutes"):
        refuse_unsuitable({"id": VIDEO_ID, "duration": 36_000})


@pytest.mark.parametrize(
    "info",
    [
        {"duration": 3600},  # exactly the limit
        {"duration": 215.4},
        {"duration": None},
        {},
        {"is_live": False, "live_status": "was_live", "duration": 300},
    ],
)
def test_a_song_and_a_recording_of_unknown_length_pass(info):
    assert refuse_unsuitable({"id": VIDEO_ID, **info}) is None
    assert refuse_unsuitable({"id": VIDEO_ID, **info}, incomplete=True) is None


def test_the_limit_follows_the_setting_and_zero_lifts_it(monkeypatch):
    monkeypatch.setattr(config, "MAX_SONG_MINUTES", 5)
    with pytest.raises(UnusableLink, match="5 minutes"):
        refuse_unsuitable({"duration": 301})
    monkeypatch.setattr(config, "MAX_SONG_MINUTES", 0)
    assert refuse_unsuitable({"duration": 36_000}) is None
    with pytest.raises(UnusableLink, match="live stream"):
        refuse_unsuitable({"is_live": True, "duration": 10})


@pytest.mark.parametrize(
    ("raw", "minutes"),
    [(None, 60), ("", 60), ("90", 90), (" 15 ", 15), ("0", 0), ("-5", 0), ("an hour", 60)],
)
def test_the_setting_is_whole_minutes_with_an_hour_as_the_default(raw, minutes):
    assert config._max_song_minutes(raw) == minutes


def test_yt_dlp_hands_the_refusal_on_from_its_match_filter():
    with yt_dlp.YoutubeDL({"quiet": True, "match_filter": refuse_unsuitable}) as ydl:
        with pytest.raises(UnusableLink, match="live stream"):
            ydl._match_entry({"id": VIDEO_ID, "title": "Live now", "is_live": True}, False)
        assert ydl._match_entry({"id": VIDEO_ID, "title": "Song", "duration": 200}, False) is None


def test_a_youtube_video_that_is_too_long_is_refused_once_and_downloads_nothing(folder):
    attempts = []

    with patch("yt_dlp.YoutubeDL") as ydl_cls:

        def extract(url, download=True):
            attempts.append(url)
            # As yt-dlp does once it has the metadata, before it downloads
            ydl_cls.call_args.args[0]["match_filter"](
                {"id": VIDEO_ID, "title": "10 hours of rain", "duration": 36_000},
                incomplete=False,
            )
            (folder / f"{VIDEO_ID}.wav").write_bytes(b"RIFF hours of audio")
            return {"id": VIDEO_ID, "title": "10 hours of rain", "duration": 36_000}

        ydl = MagicMock()
        ydl.extract_info.side_effect = extract
        ydl_cls.return_value.__enter__.return_value = ydl
        with pytest.raises(UnusableLink, match="600 minutes long"):
            TrackDownloader(output_dir=folder).extract_info_and_download(VIDEO_ID)

    assert len(attempts) == 1  # the other player clients would say the same
    assert list(folder.iterdir()) == []


def test_another_sites_live_or_long_recording_is_refused_before_the_download(folder):
    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl = MagicMock()
        ydl.extract_info.return_value = {"id": "1", "title": "DJ set", "duration": 7200}
        ydl_cls.return_value.__enter__.return_value = ydl
        with pytest.raises(UnusableLink, match="120 minutes long"):
            TrackDownloader(output_dir=folder).extract_info_and_download(SOUNDCLOUD_URL)

    ydl.process_ie_result.assert_not_called()
    assert list(folder.iterdir()) == []
