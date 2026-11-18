"""A download that stopped part-way is never taken for the whole song.

yt-dlp's FFmpeg step writes ``<id>.wav`` straight to its final name and leaves what it wrote
when it fails or the server stops. The next request for the song found a non-empty WAV and
skipped the download, so the song was made from its first seconds."""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch

import pytest

from backend.services.downloader import TrackDownloader
from backend.services.media_links import parse_media_link

VIDEO_ID = "dQw4w9WgXcQ"
SOUNDCLOUD_URL = "https://soundcloud.com/some-artist/some-song"
INFO = {"id": VIDEO_ID, "title": "Song", "uploader": "Artist", "duration": 200}


@pytest.fixture
def folder(tmp_path):
    path = tmp_path / "downloads"
    path.mkdir()
    return path


@contextmanager
def _yt_dlp(extract=None, process=None):
    ydl = MagicMock()
    if extract:
        ydl.extract_info.side_effect = extract
    if process:
        ydl.process_ie_result.side_effect = process
    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl_cls.return_value.__enter__.return_value = ydl
        yield ydl


def test_a_youtube_download_that_fails_takes_its_partial_wav_with_it(folder):
    wav = folder / f"{VIDEO_ID}.wav"

    def extract(url, download=True):
        wav.write_bytes(b"RIFF the first seconds")
        raise RuntimeError("ffmpeg exited with code 1")

    with _yt_dlp(extract=extract), pytest.raises(RuntimeError, match="all client profiles"):
        TrackDownloader(output_dir=folder).extract_info_and_download(VIDEO_ID)
    assert list(folder.iterdir()) == []


def test_a_wav_left_by_a_stopped_server_is_downloaded_again(folder):
    wav = folder / f"{VIDEO_ID}.wav"
    downloader = TrackDownloader(output_dir=folder)

    def killed(url, download=True):
        wav.write_bytes(b"RIFF the first seconds")
        raise SystemExit

    # The process ends before anything can clean up
    with (
        _yt_dlp(extract=killed),
        patch("backend.services.downloader.Path.unlink"),
        pytest.raises(SystemExit),
    ):
        downloader.extract_info_and_download(VIDEO_ID)
    assert wav.exists()

    downloads = []

    def extract(url, download=True):
        downloads.append(download)
        if download:
            wav.write_bytes(b"RIFF the whole song")
        return dict(INFO)

    with _yt_dlp(extract=extract):
        meta = downloader.extract_info_and_download(VIDEO_ID)
    assert downloads == [True]
    assert wav.read_bytes() == b"RIFF the whole song"
    assert meta["audio_path"] == str(wav)
    assert [p.name for p in folder.iterdir()] == [wav.name]


def test_a_finished_download_is_still_reused(folder):
    wav = folder / f"{VIDEO_ID}.wav"
    downloader = TrackDownloader(output_dir=folder)
    downloads = []

    def extract(url, download=True):
        downloads.append(download)
        if download:
            wav.write_bytes(b"RIFF the whole song")
        return dict(INFO)

    with _yt_dlp(extract=extract):
        downloader.extract_info_and_download(VIDEO_ID)
        downloader.extract_info_and_download(VIDEO_ID)
    assert downloads == [True, False]  # the second call only refreshes the metadata


def test_another_sites_failed_download_takes_its_partial_wav_with_it(folder):
    link = parse_media_link(SOUNDCLOUD_URL)
    wav = folder / f"{link.track_id}.wav"

    def process(info, download=True):
        wav.write_bytes(b"RIFF the first seconds")
        raise RuntimeError("ffmpeg exited with code 1")

    with (
        _yt_dlp(extract=lambda url, download=False: {"id": "1", "title": "Song"}, process=process),
        pytest.raises(RuntimeError, match="Failed to download audio from SoundCloud"),
    ):
        TrackDownloader(output_dir=folder).extract_info_and_download(SOUNDCLOUD_URL)
    assert list(folder.iterdir()) == []
