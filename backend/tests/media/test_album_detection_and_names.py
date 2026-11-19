"""A pasted link that is a whole album is told apart from a song before anything downloads,
and its songs are read from its chapters.

The chapters below are those of a real fan upload of a 1996 album (YouTube, 38:48, "Artist -
Album [1996] FULL ALBUM"), which no music catalog lists."""

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
import yt_dlp

from backend.services import album_tracks
from backend.services.album_tracks import (
    album_names,
    clean_chapter_title,
    looks_like_album,
    tracks_from_chapters,
    usable_chapters,
)
from backend.services.downloader import AlbumDetected, TrackDownloader, intake_filter
from backend.tests.helpers.albums import album_info

SEASICK = {
    "id": "CLirngSrDhg",
    "title": "Imperial Teen - Seasick [1996] FULL ALBUM",
    "duration": 2328,
    "uploader": "LizzFizz420",
    "chapters": [
        {"start_time": 0, "title": "1. Imperial Teen", "end_time": 296},
        {"start_time": 296, "title": "2. Water Boy", "end_time": 392},
        {"start_time": 392, "title": "3. Butch", "end_time": 660},
        {"start_time": 660, "title": "4. Pig Latin", "end_time": 844},
        {"start_time": 844, "title": "5. Blaming the Baby", "end_time": 979},
        {"start_time": 979, "title": "6. You're One", "end_time": 1182},
        {"start_time": 1182, "title": "7. Balloon", "end_time": 1409},
        {"start_time": 1409, "title": "8. Tippy Tap", "end_time": 1662},
        {"start_time": 1662, "title": "9. Copafeelia", "end_time": 1830},
        {"start_time": 1830, "title": "10. Luxury", "end_time": 2092},
        {"start_time": 2092, "title": "11. Eternity", "end_time": 2328},
    ],
}


def test_a_full_album_upload_with_chapters_is_an_album():
    assert looks_like_album(SEASICK)


def test_its_artist_and_album_come_from_the_title_without_the_upload_notes():
    assert album_names(SEASICK, "LizzFizz420") == ("Imperial Teen", "Seasick")


def test_its_songs_are_the_chapters_without_their_numbers():
    tracks, artist = tracks_from_chapters(usable_chapters(SEASICK), "Imperial Teen")
    assert artist == "Imperial Teen"
    assert [t.title for t in tracks][:3] == ["Imperial Teen", "Water Boy", "Butch"]
    assert [(t.start, t.end) for t in tracks][-1] == (2092.0, 2328.0)
    assert all(t.named and not t.artist for t in tracks)
    assert [t.number for t in tracks] == list(range(1, 12))


@pytest.mark.parametrize(
    "info",
    [
        # A song with sections as chapters
        album_info("a", 420, [(0, "Intro"), (60, "Verse"), (200, "Outro")], title="Song"),
        # A long song with no chapters and no album words
        album_info("b", 1300, title="Artist - Twenty Minute Epic"),
        # Called an album, but too short to hold one
        album_info("c", 400, title="Band - Record (Full Album)"),
        # A video split into short topics
        album_info("d", 900, [(0, "Hi"), (30, "One"), (60, "Two"), (90, "Three")], title="Vlog"),
        {"title": "Live now (Full Album)", "duration": 3000, "is_live": True},
        None,
    ],
)
def test_a_song_a_long_song_and_other_videos_are_not_albums(info):
    assert not looks_like_album(info)


def test_album_words_alone_make_a_long_recording_an_album():
    for title in (
        "X - Y (Full Album)",
        "X - Y [FULL EP]",
        "X – Álbum Completo",
        "X - Y Complete Album",
    ):
        assert looks_like_album(album_info("e", 1800, title=title)), title


def test_three_song_length_chapters_make_an_album_without_album_words():
    chapters = [(0, "First Song"), (200, "Second Song"), (430, "Third Song")]
    assert looks_like_album(album_info("f", 700, chapters, title="Band - Record"))


@pytest.mark.parametrize(
    ("text", "position", "clean"),
    [
        ("1. Imperial Teen", 1, "Imperial Teen"),
        ("03 - Butch (5:12)", 3, "Butch"),
        ("[00:00] 01) Opening", 1, "Opening"),
        ("A2 Side Two Song", 6, "Side Two Song"),
        ("Track 4: Pig Latin", 4, "Pig Latin"),
        ("1979", 3, "1979"),
        ("99 Problems", 2, "99 Problems"),
        ("2 Become 1", 2, "Become 1"),  # its position, taken for the track number
        ("“Quoted Song”", 1, "Quoted Song"),
    ],
)
def test_chapter_titles_lose_their_numbers_and_timestamps(text, position, clean):
    assert clean_chapter_title(text, position) == clean


def test_chapters_named_artist_dash_song_drop_the_artist_and_correct_the_album_artist():
    info = album_info(
        "g",
        700,
        [(0, "The Band - First"), (200, "The Band - Second"), (430, "The Band - Third")],
    )
    tracks, artist = tracks_from_chapters(usable_chapters(info), "Some Fan")
    assert artist == "The Band"
    assert [t.title for t in tracks] == ["First", "Second", "Third"]


def test_a_compilation_keeps_each_songs_own_artist():
    info = album_info(
        "h",
        700,
        [(0, "Singer A - First"), (200, "Group B - Second"), (430, "Duo C - Third")],
        title="Summer Hits (Full Album)",
    )
    tracks, artist = tracks_from_chapters(usable_chapters(info), "Various Artists")
    assert artist == "Various Artists"
    assert [(t.artist, t.title) for t in tracks] == [
        ("Singer A", "First"),
        ("Group B", "Second"),
        ("Duo C", "Third"),
    ]


def test_untitled_chapters_get_stand_in_names_marked_as_unnamed():
    info = album_info("i", 700, [(0, "<Untitled Chapter 1>"), (200, "Track 2"), (430, "Real")])
    tracks, _ = tracks_from_chapters(usable_chapters(info), "X")
    assert [(t.title, t.named) for t in tracks] == [
        ("Track 1", False),
        ("Track 2", False),
        ("Real", True),
    ]


def test_chapters_out_of_order_or_past_the_end_are_dropped():
    info = {
        "duration": 500,
        "chapters": [
            {"start_time": 0, "title": "a"},
            {"start_time": 0, "title": "duplicate"},
            {"start_time": 200, "title": "b"},
            {"start_time": 150, "title": "out of order"},
            {"start_time": 600, "title": "after the end"},
        ],
    }
    assert [(c["title"], c["start"], c["end"]) for c in usable_chapters(info)] == [
        ("a", 0.0, 200.0),
        ("b", 200.0, 500.0),
    ]


def test_album_names_prefer_yt_dlps_own_fields_and_fall_back_to_the_channel():
    assert album_names({"artist": "A", "album": "B", "title": "whatever"}) == ("A", "B")
    assert album_names({"title": "Greatest Record (Full Album) HQ"}, "Band - Topic") == (
        "Band",
        "Greatest Record",
    )


def test_yt_dlp_hands_the_album_on_from_its_match_filter_and_a_song_passes():
    with yt_dlp.YoutubeDL({"quiet": True, "match_filter": intake_filter(True)}) as ydl:
        with pytest.raises(AlbumDetected) as found:
            ydl._match_entry(dict(SEASICK), False)
        assert found.value.info["id"] == "CLirngSrDhg"
        assert ydl._match_entry({"id": "x", "title": "Song", "duration": 200}, False) is None
    with yt_dlp.YoutubeDL({"quiet": True, "match_filter": intake_filter(False)}) as ydl:
        assert ydl._match_entry(dict(SEASICK), False) is None


def _fake_ydl(folder, info):
    """A yt-dlp stand-in that calls its match_filter as yt-dlp does, then 'downloads'."""
    ydl_cls = patch("yt_dlp.YoutubeDL").start()
    attempts = []

    def extract(url, download=True):
        attempts.append(url)
        opts = ydl_cls.call_args.args[0]
        opts["match_filter"](dict(info), incomplete=False)
        written = opts["outtmpl"].replace("%(id)s", info["id"]).replace("%(ext)s", "wav")
        Path(written).write_bytes(b"RIFF....")
        return dict(info)

    ydl = MagicMock()
    ydl.extract_info.side_effect = extract
    ydl_cls.return_value.__enter__.return_value = ydl
    return attempts


def test_a_pasted_album_raises_before_it_downloads_and_tries_no_other_client(tmp_path):
    folder = tmp_path / "downloads"
    folder.mkdir()
    attempts = _fake_ydl(folder, SEASICK)
    try:
        with pytest.raises(AlbumDetected):
            TrackDownloader(output_dir=folder).extract_info_and_download(SEASICK["id"])
    finally:
        patch.stopall()
    assert len(attempts) == 1
    assert list(folder.iterdir()) == []


def test_an_album_made_as_one_song_downloads_when_detection_is_off(tmp_path, monkeypatch):
    from backend import config

    monkeypatch.setattr(config, "MAX_SONG_MINUTES", 60)
    _fake_ydl(tmp_path, SEASICK)
    try:
        meta = TrackDownloader(output_dir=tmp_path).extract_info_and_download(
            SEASICK["id"], detect_album=False
        )
    finally:
        patch.stopall()
    assert meta["id"] == "CLirngSrDhg"


def test_a_song_matched_from_a_catalog_is_never_taken_for_an_album(tmp_path):
    _fake_ydl(tmp_path, {**SEASICK, "id": "matchedvid1"})
    try:
        meta = TrackDownloader(output_dir=tmp_path).extract_info_and_download(
            "matchedvid1", file_stem="deezer-123"
        )
    finally:
        patch.stopall()
    assert meta["id"] == "deezer-123"


def test_the_album_limit_follows_its_setting(monkeypatch):
    from backend import config

    monkeypatch.setattr(config, "MAX_ALBUM_MINUTES", 90)
    assert album_tracks.album_limit_seconds() == 5400
    monkeypatch.setattr(config, "MAX_ALBUM_MINUTES", 0)
    assert album_tracks.album_limit_seconds() is None
    assert config._max_album_minutes(None) == 120
    assert config._max_album_minutes(" 45 ") == 45
    assert config._max_album_minutes("lots") == 120
