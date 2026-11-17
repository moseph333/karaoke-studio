"""Downloading a SoundCloud, Bandcamp, Vimeo or Internet Archive song: the link is read before
anything downloads, a link holding several recordings is refused, the audio is named by the
song's track id, and audio already on disk is reused."""

from unittest.mock import MagicMock, patch

import pytest

from backend.services.downloader import DownloadCancelled, TrackDownloader
from backend.services.media_links import UnusableLink, parse_media_link

SOUNDCLOUD = "https://soundcloud.com/forss/flickermood"
ARCHIVE = "https://archive.org/details/gd1977-05-08"


def _fake_ydl(tmp_path, info, track_id, write_audio=True):
    """A yt-dlp whose download writes <track_id>.wav and a thumbnail, as the real one does
    with the outtmpl the downloader passes."""
    ydl = MagicMock()
    ydl.extract_info.return_value = info

    def download(result, download=True):
        if write_audio:
            (tmp_path / f"{track_id}.wav").write_bytes(b"RIFF audio")
            (tmp_path / f"{track_id}.jpg").write_bytes(b"\xff\xd8 jpeg")
        return result

    ydl.process_ie_result.side_effect = download
    return ydl


def _download(tmp_path, url, ydl):
    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl_cls.return_value.__enter__.return_value = ydl
        result = TrackDownloader(output_dir=tmp_path).extract_info_and_download(url)
    return result, ydl_cls


def test_a_soundcloud_song_is_downloaded_under_its_track_id(tmp_path):
    track_id = parse_media_link(SOUNDCLOUD).track_id
    info = {"id": "1234", "title": "Flickermood", "artist": "Forss", "duration": 213.9}
    ydl = _fake_ydl(tmp_path, info, track_id)

    result, ydl_cls = _download(tmp_path, SOUNDCLOUD, ydl)

    opts = ydl_cls.call_args.args[0]
    assert opts["outtmpl"] == str(tmp_path / f"{track_id}.%(ext)s")
    assert opts["noplaylist"] is True
    assert "extractor_args" not in opts  # YouTube's player clients are YouTube's alone
    ydl.extract_info.assert_called_once_with(SOUNDCLOUD, download=False)
    ydl.process_ie_result.assert_called_once()
    assert result["id"] == track_id
    assert (result["title"], result["artist"], result["duration"]) == (
        "Flickermood",
        "Forss",
        213.9,
    )
    assert result["audio_path"] == str(tmp_path / f"{track_id}.wav")
    assert result["thumbnail_url"] == f"/static/downloads/{track_id}.jpg"
    assert result["url"] == SOUNDCLOUD


def test_an_uploaders_artist_dash_title_is_split(tmp_path):
    url = "https://vimeo.com/76979871"
    info = {"id": "76979871", "title": "Some Band - A Song (Live)", "uploader": "A Fan"}
    result, _ = _download(tmp_path, url, _fake_ydl(tmp_path, info, "vimeo-76979871"))
    assert result["artist"] == "Some Band"
    assert result["title"].startswith("A Song")


def test_an_archive_recording_names_its_creator_not_the_uploaders_email(tmp_path):
    url = f"{ARCHIVE}/track07.flac"
    track_id = parse_media_link(url).track_id
    info = {
        "id": "gd1977-05-08/track07.flac",
        "title": "Deal",
        "track": "Deal",
        "creators": ["Grateful Dead"],
        "uploader": "someone@example.com",
        "duration": 438.7,
    }
    result, _ = _download(tmp_path, url, _fake_ydl(tmp_path, info, track_id))
    assert (result["title"], result["artist"]) == ("Deal", "Grateful Dead")
    assert result["id"] == track_id  # not the Archive's own id, which holds a slash


def test_a_link_holding_one_recording_downloads_that_recording(tmp_path):
    track_id = parse_media_link(ARCHIVE).track_id
    entry = {"id": "x/one.mp3", "title": "Only Song", "artist": "Band"}
    ydl = _fake_ydl(tmp_path, {"_type": "playlist", "entries": [entry]}, track_id)
    result, _ = _download(tmp_path, ARCHIVE, ydl)
    assert ydl.process_ie_result.call_args.args[0] is entry
    assert result["title"] == "Only Song"


def test_a_link_holding_several_recordings_is_refused_before_downloading(tmp_path):
    entries = [{"id": f"x/{n}.mp3", "title": f"Song {n}"} for n in range(12)]
    track_id = parse_media_link(ARCHIVE).track_id
    ydl = _fake_ydl(tmp_path, {"_type": "playlist", "entries": entries}, track_id)
    with pytest.raises(UnusableLink, match="holds 12 recordings"):
        _download(tmp_path, ARCHIVE, ydl)
    ydl.process_ie_result.assert_not_called()
    assert not list(tmp_path.glob(f"{track_id}.*"))


def test_audio_on_disk_is_reused_and_its_metadata_refreshed(tmp_path):
    track_id = parse_media_link(SOUNDCLOUD).track_id
    (tmp_path / f"{track_id}.wav").write_bytes(b"RIFF cached")
    ydl = _fake_ydl(tmp_path, {"title": "Flickermood", "artist": "Forss"}, track_id)
    result, _ = _download(tmp_path, SOUNDCLOUD, ydl)
    ydl.process_ie_result.assert_not_called()
    assert (result["title"], result["artist"]) == ("Flickermood", "Forss")


def test_audio_on_disk_still_opens_when_the_site_does_not_answer(tmp_path):
    track_id = parse_media_link(SOUNDCLOUD).track_id
    (tmp_path / f"{track_id}.wav").write_bytes(b"RIFF cached")
    ydl = MagicMock()
    ydl.extract_info.side_effect = RuntimeError("HTTP Error 503")
    result, _ = _download(tmp_path, SOUNDCLOUD, ydl)
    assert result["audio_path"] == str(tmp_path / f"{track_id}.wav")
    assert result["title"] == f"Track {track_id}"


def test_a_failed_download_names_the_site(tmp_path):
    ydl = MagicMock()
    ydl.extract_info.side_effect = RuntimeError("This track is not available in your country")
    with pytest.raises(RuntimeError, match=r"from SoundCloud: .*your country"):
        _download(tmp_path, SOUNDCLOUD, ydl)


def test_a_cancel_stops_the_download_as_a_cancel(tmp_path):
    track_id = parse_media_link(SOUNDCLOUD).track_id
    ydl = _fake_ydl(tmp_path, {"title": "Flickermood"}, track_id)
    ydl.process_ie_result.side_effect = DownloadCancelled("Processing cancelled by user")
    with pytest.raises(DownloadCancelled):
        _download(tmp_path, SOUNDCLOUD, ydl)


def test_a_link_that_is_not_one_song_is_refused_without_the_network(tmp_path):
    with patch("yt_dlp.YoutubeDL") as ydl_cls, pytest.raises(UnusableLink, match="album"):
        TrackDownloader(output_dir=tmp_path).extract_info_and_download(
            "https://artist.bandcamp.com/album/a-record"
        )
    ydl_cls.assert_not_called()
