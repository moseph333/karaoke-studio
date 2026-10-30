from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.services.downloader import TrackDownloader

# ==============================================================================
# 1. extract_video_id Unit Tests
# ==============================================================================


@pytest.mark.parametrize(
    "url_or_id,expected_id",
    [
        ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("ab-cd_ef123", "ab-cd_ef123"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("http://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://music.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("http://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://m.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/v/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&index=2", "dQw4w9WgXcQ"),
        (
            "https://www.youtube.com/watch?utm_source=fb&v=dQw4w9WgXcQ&utm_campaign=promo",
            "dQw4w9WgXcQ",
        ),
        ("https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ?t=15", "dQw4w9WgXcQ"),
    ],
)
def test_extract_video_id_valid_formats(url_or_id, expected_id):
    assert TrackDownloader.extract_video_id(url_or_id) == expected_id


@pytest.mark.parametrize(
    "invalid_input",
    [
        "https://notyoutube.org/watch?v=123",
        "https://notyoutube.org/watch?v=dQw4w9WgXcQ",
        "https://notyoutube.org/12345678901",
        "https://vimeo.com/12345678901",
        "https://evil.com/shorts/dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/watch?v=toolongvideoidentifier",
        "just-a-random-string-not-an-id",
        "",
        "   ",
        None,
    ],
)
def test_extract_video_id_invalid_formats(invalid_input):
    assert TrackDownloader.extract_video_id(invalid_input) is None


# ==============================================================================
# 2. search_tracks Unit Tests
# ==============================================================================


def test_search_tracks_success(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    mock_info = {
        "entries": [
            {
                "id": "vid12345678",
                "title": "Bohemian Rhapsody",
                "uploader": "Queen",
                "duration": 354,
                "thumbnail": "https://img.youtube.com/thumb1.jpg",
            },
            {
                "id": "vid87654321",
                "title": "Don't Stop Me Now",
                "channel": "Queen Official",
                "duration": 210,
                "thumbnails": [{"url": "https://img.youtube.com/thumb2.jpg"}],
            },
        ]
    }

    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_instance = MagicMock()
        mock_instance.extract_info.return_value = mock_info
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        results = downloader.search_tracks("Queen", limit=2)
        assert len(results) == 2
        assert results[0]["id"] == "vid12345678"
        assert results[0]["title"] == "Bohemian Rhapsody"
        assert results[0]["artist"] == "Queen"
        assert results[0]["url"] == "https://www.youtube.com/watch?v=vid12345678"
        assert results[0]["thumbnail"] == "https://img.youtube.com/thumb1.jpg"

        assert results[1]["artist"] == "Queen Official"
        assert results[1]["thumbnail"] == "https://img.youtube.com/thumb2.jpg"


def test_search_tracks_empty_or_whitespace(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    assert downloader.search_tracks("") == []
    assert downloader.search_tracks("   ") == []


def test_search_tracks_handles_yt_dlp_exception(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = RuntimeError("Network error")
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        results = downloader.search_tracks("Queen", limit=5)
        assert results == []


# ==============================================================================
# 3. extract_info_and_download Unit Tests
# ==============================================================================


def test_extract_info_and_download_cached_reuse_no_hardcoded_country_girl(tmp_path):
    """
    Verifies that cached audio files are reused and the hardcoded 'Country Girl'
    fallback title (previously triggered for qjQiHXgTdLQ) is completely eliminated.
    """
    downloader = TrackDownloader(output_dir=tmp_path)
    video_id = "qjQiHXgTdLQ"
    cached_wav = tmp_path / f"{video_id}.wav"
    cached_wav.write_bytes(b"RIFF" + b"\x00" * 100)
    cached_thumb = tmp_path / f"{video_id}.jpg"
    cached_thumb.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 20)

    # When metadata extraction fails, title must NOT be "Country Girl"
    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = RuntimeError("Offline mode")
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        res = downloader.extract_info_and_download(video_id)
        assert res["id"] == video_id
        assert res["audio_path"] == str(cached_wav)
        assert res["thumbnail_path"] == str(cached_thumb)
        assert res["title"] != "Country Girl"
        assert res["raw_title"] != "Country Girl"
        assert "Country Girl" not in res["title"]
        assert res["title"] == f"Track {video_id}"
        assert res["artist"] == "Unknown Artist"


def test_extract_info_and_download_fresh_success(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    video_id = "freshTrack1"
    url = f"https://www.youtube.com/watch?v={video_id}"

    mock_meta = {
        "id": video_id,
        "title": "Adele - Someone Like You (Official Music Video)",
        "uploader": "Adele",
        "duration": 285,
        "thumbnail": "https://img.youtube.com/fresh.jpg",
    }

    def fake_extract(u, download=True):
        (tmp_path / f"{video_id}.wav").write_bytes(b"RIFF" + b"\x00" * 200)
        (tmp_path / f"{video_id}.jpg").write_bytes(b"JPEGDATA")
        return mock_meta

    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = fake_extract
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        res = downloader.extract_info_and_download(url)
        assert res["id"] == video_id
        assert res["title"] == "Someone Like You"  # Stripped bracketed suffixes
        assert res["artist"] == "Adele"
        assert res["duration"] == 285
        assert Path(res["audio_path"]).exists()
        assert Path(res["thumbnail_path"]).exists()


def test_client_profile_iteration_and_fallback(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    video_id = "fallbackTrk"
    url = f"https://www.youtube.com/watch?v={video_id}"

    mock_meta = {
        "id": video_id,
        "title": "Fallback Track",
        "uploader": "Artist",
        "duration": 120,
    }

    attempt_count = 0

    def fake_extract_with_fallback(u, download=True):
        nonlocal attempt_count
        attempt_count += 1
        if attempt_count == 1:
            raise RuntimeError("Bot detected on primary profile")
        # Succeed on second client profile
        (tmp_path / f"{video_id}.wav").write_bytes(b"RIFF" + b"\x00" * 200)
        return mock_meta

    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = fake_extract_with_fallback
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        res = downloader.extract_info_and_download(url)
        assert res["id"] == video_id
        assert attempt_count == 2
        assert Path(res["audio_path"]).exists()


def test_all_client_profiles_fail_raises_runtime_error(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    video_id = "blockedTrk1"
    url = f"https://www.youtube.com/watch?v={video_id}"

    with patch("yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = RuntimeError("Sign in required")
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        with pytest.raises(RuntimeError) as exc_info:
            downloader.extract_info_and_download(url)

        err_text = str(exc_info.value)
        assert "Failed to extract/download video" in err_text
        assert "across all client profiles" in err_text


def test_empty_input_raises_value_error(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    with pytest.raises(ValueError):
        downloader.extract_info_and_download("")
    with pytest.raises(ValueError):
        downloader.extract_info_and_download("   ")


def test_thumbnail_download_fallback(tmp_path):
    downloader = TrackDownloader(output_dir=tmp_path)
    video_id = "thumbFallbk"
    url = f"https://www.youtube.com/watch?v={video_id}"

    mock_meta = {
        "id": video_id,
        "title": "Thumb Song",
        "uploader": "Thumb Artist",
        "duration": 100,
        "thumbnail": "https://img.youtube.com/thumb_direct.jpg",
    }

    def fake_extract(u, download=True):
        (tmp_path / f"{video_id}.wav").write_bytes(b"RIFF" + b"\x00" * 200)
        # Note: no local thumbnail file written by yt-dlp
        return mock_meta

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.content = b"THUMBNAIL_BYTES"

    with (
        patch("yt_dlp.YoutubeDL") as mock_ydl_cls,
        patch("requests.get", return_value=mock_response) as mock_get,
    ):
        mock_instance = MagicMock()
        mock_instance.extract_info.side_effect = fake_extract
        mock_ydl_cls.return_value.__enter__.return_value = mock_instance

        res = downloader.extract_info_and_download(url)
        assert res["thumbnail_path"] is not None
        assert Path(res["thumbnail_path"]).exists()
        assert Path(res["thumbnail_path"]).read_bytes() == b"THUMBNAIL_BYTES"
        mock_get.assert_called_once_with("https://img.youtube.com/thumb_direct.jpg", timeout=10)
