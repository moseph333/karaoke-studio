"""Refreshing a cached song's metadata reads that one video, even when its URL names a
playlist too."""

from unittest.mock import MagicMock, patch

from backend.services.downloader import TrackDownloader


def test_a_playlist_url_reads_only_the_video(tmp_path):
    video_id = "dQw4w9WgXcQ"
    (tmp_path / f"{video_id}.wav").write_bytes(b"RIFF cached audio")
    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl = MagicMock()
        ydl.extract_info.return_value = {"title": "Song", "uploader": "Artist", "duration": 200}
        ydl_cls.return_value.__enter__.return_value = ydl
        TrackDownloader(output_dir=tmp_path).extract_info_and_download(
            f"https://www.youtube.com/watch?v={video_id}&list=PL0123456789"
        )
    assert ydl_cls.call_args.args[0]["noplaylist"] is True
