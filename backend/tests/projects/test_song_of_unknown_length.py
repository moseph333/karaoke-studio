"""A song whose length yt-dlp did not know can still be edited.

yt-dlp reports an unknown length as ``"duration": None``. The downloader stored that on the
song, and saving lyrics (or storing re-timed ones) compared the last line's end with None:
a TypeError, so every lyric save answered 500."""

from unittest.mock import MagicMock, patch

import pytest

from backend import realignment
from backend.main import projects
from backend.services.downloader import TrackDownloader

VIDEO_ID = "dQw4w9WgXcQ"
LINES = [
    {
        "id": 1,
        "text": "Only line",
        "start_time": 1.0,
        "end_time": 2.5,
        "words": [
            {"word": "Only", "start_time": 1.0, "end_time": 1.5},
            {"word": "line", "start_time": 1.5, "end_time": 2.5},
        ],
    }
]


@pytest.fixture
def song():
    pid = "nolength01"
    projects[pid] = {"id": pid, "status": "ready", "title": "T", "artist": "A", "lines": []}
    yield projects[pid]
    projects.pop(pid, None)


@pytest.mark.parametrize("stored", ["none", "missing"])
def test_lyrics_save_on_a_song_without_a_length(client, song, stored):
    if stored == "none":
        song["duration"] = None

    res = client.post(f"/api/project/{song['id']}/lyrics", json={"lines": LINES})

    assert res.status_code == 200, res.text
    assert song["duration"] == 2.5
    assert song["lines"][0]["text"] == "Only line"


def test_re_timed_lines_are_stored_on_a_song_without_a_length(song):
    song["duration"] = None

    realignment.store_aligned_lines(song, [dict(LINES[0])])

    assert song["duration"] == 2.5


def test_a_known_length_is_only_ever_stretched(client, song):
    song["duration"] = 200.0

    res = client.post(f"/api/project/{song['id']}/lyrics", json={"lines": LINES})

    assert res.status_code == 200
    assert song["duration"] == 200.0


@pytest.mark.parametrize("cached", [False, True], ids=["download", "cached audio"])
def test_the_downloader_reports_an_unknown_length_as_zero(tmp_path, cached):
    folder = tmp_path / "downloads"
    folder.mkdir()
    wav = folder / f"{VIDEO_ID}.wav"
    if cached:
        wav.write_bytes(b"RIFF cached audio")

    def extract(url, download=True):
        if download:
            wav.write_bytes(b"RIFF audio")
        return {"id": VIDEO_ID, "title": "Song", "uploader": "Artist", "duration": None}

    with patch("yt_dlp.YoutubeDL") as ydl_cls:
        ydl = MagicMock()
        ydl.extract_info.side_effect = extract
        ydl_cls.return_value.__enter__.return_value = ydl
        meta = TrackDownloader(output_dir=folder).extract_info_and_download(VIDEO_ID)

    assert meta["duration"] == 0
