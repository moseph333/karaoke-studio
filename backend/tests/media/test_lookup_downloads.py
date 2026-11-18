"""Downloading a Spotify, Apple Music, TIDAL or Deezer song: the matched YouTube upload is downloaded
under the song's own track id, the song keeps the service's title, artist and link, and a
match that cannot be downloaded gives way to the next one."""

from unittest.mock import MagicMock, patch

import pytest

from backend.services.downloader import DownloadCancelled, TrackDownloader
from backend.services.song_lookup import SongInfo, SongNotFound

SPOTIFY = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=shared"
TRACK_ID = "spotify-4cOdK2wGLETKBW3PvgPWqT"
INFO = SongInfo(title="Never Gonna Give You Up", artists=["Rick Astley"], duration=214.0)


def _match(video_id):
    return {"id": video_id, "url": f"https://www.youtube.com/watch?v={video_id}"}


def _ydl(tmp_path, fail=None):
    """A yt-dlp whose YouTube download writes the audio at its outtmpl, or raises fail[url]."""
    fail = fail or {}
    ydl = MagicMock()

    def extract(url, download=True):
        if url in fail:
            raise fail[url]
        (tmp_path / f"{TRACK_ID}.wav").write_bytes(b"RIFF audio")
        return {
            "id": url[-4:],
            "title": "Rick Astley - Never Gonna Give You Up (Official Video)",
            "uploader": "Rick Astley",
            "duration": 213,
        }

    ydl.extract_info.side_effect = extract
    return ydl


def _download(tmp_path, ydl, matches):
    with (
        patch("backend.services.downloader.fetch_song_info", return_value=INFO),
        patch("backend.services.downloader.find_on_youtube", return_value=matches) as find,
        patch("yt_dlp.YoutubeDL") as ydl_cls,
    ):
        ydl_cls.return_value.__enter__.return_value = ydl
        result = TrackDownloader(output_dir=tmp_path).extract_info_and_download(SPOTIFY)
    return result, ydl_cls, find


def test_the_matched_upload_is_downloaded_under_the_songs_own_track_id(tmp_path):
    result, ydl_cls, _ = _download(tmp_path, _ydl(tmp_path), [_match("best")])

    assert ydl_cls.call_args.args[0]["outtmpl"] == str(tmp_path / f"{TRACK_ID}.%(ext)s")
    assert result["id"] == TRACK_ID
    assert result["audio_path"] == str(tmp_path / f"{TRACK_ID}.wav")
    assert (result["title"], result["artist"]) == ("Never Gonna Give You Up", "Rick Astley")
    assert result["duration"] == 213  # the audio's own length
    assert result["url"] == "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
    assert result["song_match"] == {
        "site": "spotify",
        "title": "Never Gonna Give You Up",
        "artist": "Rick Astley",
        "duration": 214.0,
        "youtube_id": "best",
        "youtube_title": "Rick Astley - Never Gonna Give You Up (Official Video)",
        "youtube_url": "https://www.youtube.com/watch?v=best",
    }


def test_a_match_that_cannot_be_downloaded_gives_way_to_the_next(tmp_path):
    blocked = "https://www.youtube.com/watch?v=lock"
    ydl = _ydl(tmp_path, fail={blocked: RuntimeError("Video unavailable in your country")})
    result, _, _ = _download(tmp_path, ydl, [_match("lock"), _match("next")])
    assert result["song_match"]["youtube_id"] == "next"


def test_the_last_matchs_failure_is_reported(tmp_path):
    urls = [f"https://www.youtube.com/watch?v={v}" for v in ("aaaa", "bbbb")]
    ydl = _ydl(tmp_path, fail={u: RuntimeError("Video unavailable") for u in urls})
    with pytest.raises(RuntimeError, match="Video unavailable"):
        _download(tmp_path, ydl, [_match("aaaa"), _match("bbbb")])


@pytest.mark.parametrize(
    "error",
    [
        DownloadCancelled("Processing cancelled by user"),
        RuntimeError("Sign in to confirm you’re not a bot"),
    ],
)
def test_a_cancel_or_youtubes_bot_check_stops_at_the_first_match(tmp_path, error):
    first = "https://www.youtube.com/watch?v=aaaa"
    ydl = _ydl(tmp_path, fail={first: error})
    with pytest.raises(type(error)):
        _download(tmp_path, ydl, [_match("aaaa"), _match("bbbb")])
    tried = {call.args[0] for call in ydl.extract_info.call_args_list}
    assert tried == {first}


def test_at_most_three_matches_are_tried(tmp_path):
    ids = ["aaaa", "bbbb", "cccc", "dddd"]
    urls = [f"https://www.youtube.com/watch?v={v}" for v in ids]
    ydl = _ydl(tmp_path, fail={u: RuntimeError("Video unavailable") for u in urls})
    with pytest.raises(RuntimeError):
        _download(tmp_path, ydl, [_match(v) for v in ids])
    assert urls[3] not in {call.args[0] for call in ydl.extract_info.call_args_list}


def test_a_song_not_on_youtube_downloads_nothing(tmp_path):
    with (
        patch("backend.services.downloader.fetch_song_info", return_value=INFO),
        patch(
            "backend.services.downloader.find_on_youtube",
            side_effect=SongNotFound("Could not find it on YouTube"),
        ),
        patch("yt_dlp.YoutubeDL") as ydl_cls,
        pytest.raises(SongNotFound),
    ):
        TrackDownloader(output_dir=tmp_path).extract_info_and_download(SPOTIFY)
    ydl_cls.assert_not_called()
