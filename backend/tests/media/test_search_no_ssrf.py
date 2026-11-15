"""/api/search only ever searches YouTube: a URL or another site's search prefix in the
query is search text, never something yt-dlp fetches from the server's network."""

from unittest.mock import MagicMock, patch

import pytest

from backend.services.downloader import TrackDownloader


def _searched(tmp_path, query: str, limit: int = 5) -> tuple[str, dict]:
    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl = MagicMock()
        ydl.extract_info.return_value = {"entries": []}
        ydl_cls.return_value.__enter__.return_value = ydl
        TrackDownloader(output_dir=tmp_path).search_tracks(query, limit=limit)
    return ydl.extract_info.call_args.args[0], ydl_cls.call_args.args[0]


@pytest.mark.parametrize(
    "query",
    [
        "http://192.168.1.1/admin",
        "https://169.254.169.254/latest/meta-data/",
        "scsearch:anything",
        "ytsearchall:queen",
        "file:///etc/passwd",
    ],
)
def test_urls_and_prefixes_become_youtube_search_text(tmp_path, query):
    searched, opts = _searched(tmp_path, query)
    assert searched == f"ytsearch5:{query}"
    assert "default_search" not in opts


def test_the_result_cap_holds(tmp_path):
    searched, _ = _searched(tmp_path, "queen", limit=500)
    assert searched == "ytsearch50:queen"


def test_a_plain_query_is_searched(tmp_path):
    searched, _ = _searched(tmp_path, "  Bohemian Rhapsody  ", limit=3)
    assert searched == "ytsearch3:Bohemian Rhapsody"
