"""A download the user cancelled stops at once: the other YouTube client profiles, tried
after a real failure, are not tried after a cancel."""

from unittest.mock import MagicMock, patch

import pytest
import yt_dlp

from backend.services.downloader import DownloadCancelled, TrackDownloader


def _download(tmp_path, error):
    attempts = []

    def extract(url, download=True):
        attempts.append(url)
        raise error

    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl = MagicMock()
        ydl.extract_info.side_effect = extract
        ydl_cls.return_value.__enter__.return_value = ydl
        with pytest.raises(Exception) as caught:
            TrackDownloader(output_dir=tmp_path).extract_info_and_download("dQw4w9WgXcQ")
    return attempts, caught.value


def test_a_cancel_is_not_retried_with_other_clients(tmp_path):
    attempts, error = _download(tmp_path, DownloadCancelled("Processing cancelled by user"))
    assert len(attempts) == 1
    assert isinstance(error, DownloadCancelled)


def test_a_cancel_wrapped_by_yt_dlp_is_recognised(tmp_path):
    original = DownloadCancelled("Processing cancelled by user")
    wrapped = yt_dlp.utils.DownloadError(
        "ERROR: cancelled", exc_info=(type(original), original, None)
    )
    attempts, _ = _download(tmp_path, wrapped)
    assert len(attempts) == 1


def test_a_real_failure_still_tries_every_client(tmp_path):
    attempts, error = _download(tmp_path, RuntimeError("HTTP Error 403"))
    assert len(attempts) == 3
    assert "across all client profiles" in str(error)
