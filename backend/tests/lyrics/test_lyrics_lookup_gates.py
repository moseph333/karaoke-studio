"""First-pass lyric lookup: a lyrics file for another version or another song does not win,
noisy titles keep the song's name, credit lines are not sung, and LRC lines end once sung."""

from unittest.mock import MagicMock, patch

import pytest

from backend.services.downloader import music_track_title
from backend.services.lyrics import (
    LyricsNormalizer,
    LyricsService,
    is_credit_line,
    sung_line_seconds,
)

SYNCED = "\n".join(
    f"[{(10 + 20 * i) // 60:02d}:{(10 + 20 * i) % 60:02d}.00]Line number {i} of the song"
    for i in range(12)
)  # covers the whole song, so it is not taken for a truncated snippet
PLAIN = "\n".join(f"Line number {i} of the song" for i in range(12))


def _lrclib(get=None, search=None):
    """requests.get for LRCLIB: ``get`` answers /get (None means 404), ``search`` /search."""

    def fake(url, params=None, timeout=5):
        response = MagicMock()
        if url.endswith("/get"):
            payload = get(params) if callable(get) else get
            response.status_code = 200 if payload is not None else 404
            response.json.return_value = payload
        else:
            response.status_code = 200
            response.json.return_value = search or []
        return response

    return fake


def _record(duration, synced=SYNCED, plain=PLAIN, track="Don't Ask Me", artist="Soccer Mommy"):
    return {
        "trackName": track,
        "artistName": artist,
        "duration": duration,
        "syncedLyrics": synced,
        "plainLyrics": plain,
    }


def test_synced_lyrics_for_a_much_longer_version_are_not_taken_at_once():
    live = _record(330.0)  # a live version, a minute longer than the audio
    studio = _record(268.0)

    def get(params):
        return live if "duration" not in params else None

    with patch("requests.get", side_effect=_lrclib(get=get, search=[live, studio])):
        result = LyricsService()._fetch_from_lrclib("Don't Ask Me", "Soccer Mommy", 269.0)
    assert result["synced"] is True
    assert result["source"] == "lrclib_search"
    assert result["lines"] == LyricsService.parse_lrc(studio["syncedLyrics"])


def test_a_matching_length_is_still_taken_at_once():
    with patch("requests.get", side_effect=_lrclib(get=_record(271.0))):
        result = LyricsService()._fetch_from_lrclib("Don't Ask Me", "Soccer Mommy", 269.0)
    assert (result["source"], result["synced"]) == ("lrclib", True)


def test_another_songs_search_hit_loses_to_the_exact_plain_lyrics():
    exact_plain = _record(269.0, synced="")
    other_song = _record(269.0, track="Completely Different Tune", artist="Someone Else")

    with patch("requests.get", side_effect=_lrclib(get=exact_plain, search=[other_song])):
        result = LyricsService()._fetch_from_lrclib("Don't Ask Me", "Soccer Mommy", 269.0)
    assert result["synced"] is False
    assert result["plain_lyrics"] == PLAIN


def test_another_songs_search_hit_alone_is_not_taken():
    other_song = _record(269.0, track="Completely Different Tune", artist="Someone Else")
    with patch("requests.get", side_effect=_lrclib(get=None, search=[other_song])):
        assert LyricsService()._fetch_from_lrclib("Don't Ask Me", "Soccer Mommy", 269.0) is None


def test_the_wrong_version_is_kept_when_nothing_better_exists():
    live = _record(330.0)
    with patch("requests.get", side_effect=_lrclib(get=live, search=[])):
        result = LyricsService()._fetch_from_lrclib("Don't Ask Me", "Soccer Mommy", 269.0)
    # still synced: the aligner corrects a lyrics file timed for another version
    assert (result["source"], result["synced"]) == ("lrclib", True)


def test_a_length_check_needs_both_lengths():
    assert LyricsService.duration_matches({"duration": 270.0}, 262.0)
    assert not LyricsService.duration_matches({"duration": 300.0}, 262.0)
    assert LyricsService.duration_matches({"duration": None}, 262.0)
    assert LyricsService.duration_matches({"duration": 300.0}, None)


@pytest.mark.parametrize(
    ("title", "artist", "expected"),
    [
        ("Oasis - Live Forever", "Oasis", ("Live Forever", "Oasis")),
        ("Wings - Live and Let Die", "Wings", ("Live and Let Die", "Wings")),
        ("Artist - Audio Kids", "Unknown Artist", ("Audio Kids", "Artist")),
        ("Song - Official Video HD", "X", ("Song", "X")),
        ("Song | Official Audio", "X", ("Song", "X")),
        ("Song - 2011 Remaster", "X", ("Song", "X")),
        ("Song - Live at Wembley 1986", "X", ("Song", "X")),
        ("Song - Live 1986", "X", ("Song", "X")),
        ('Let It Go - From "Frozen" (Official)', "X", ("Let It Go", "X")),
    ],
)
def test_trailing_noise_is_removed_but_song_names_survive(title, artist, expected):
    assert LyricsNormalizer.normalize_track_metadata(title, artist) == expected


def test_youtube_music_metadata_names_the_song():
    meta = {"title": "Soccer Mommy - Dont Ask Me (Official Audio)", "track": "Don't Ask Me"}
    assert music_track_title({**meta, "artist": "Soccer Mommy"}) == "Don't Ask Me"
    assert music_track_title(meta) is None  # no artist: the video title is all there is
    assert music_track_title({"track": "  ", "artist": "X"}) is None
    assert music_track_title(None) is None


@pytest.mark.parametrize(
    "line",
    ["作词 : Someone", "作曲：Someone", "Lyrics by: Someone", "Written by: A & B", "Composed by:X"],
)
def test_credit_lines_are_recognised(line):
    assert is_credit_line(line)


@pytest.mark.parametrize("line", ["Written in the stars", "Composed by the sea", "曲終"])
def test_sung_lines_are_not_credit_lines(line):
    assert not is_credit_line(line)


def test_credit_lines_are_dropped_from_lyrics():
    lrc = "[00:00.00] 作词 : Someone\n[00:00.50] 作曲 : Someone\n[00:12.00]First sung line\n"
    assert [x["text"] for x in LyricsService.parse_lrc(lrc)] == ["First sung line"]
    plain = "Written by: Someone\nFirst sung line\nSecond line"
    assert [x["text"] for x in LyricsService.parse_plain_text(plain)] == [
        "First sung line",
        "Second line",
    ]


def test_lrc_lines_end_once_their_words_are_sung():
    lrc = (
        "[00:18.23] No longer wanting\n"
        "[00:25.93] No longer longing\n"
        "[00:27.00] And a line that runs straight into the next one\n"
        "[00:28.00] Last\n"
        "[00:40.00] \n"
        "[00:41.00] After a blank stamp\n"
    )
    lines = LyricsService.parse_lrc(lrc)
    assert [x["text"] for x in lines][-1] == "After a blank stamp"
    first = lines[0]
    assert first["end_time"] == pytest.approx(18.23 + sung_line_seconds("No longer wanting"))
    assert first["end_time"] < 25.93
    # words share the sung span, not the gap before the next line
    assert first["words"][-1]["end_time"] == pytest.approx(first["end_time"], abs=0.002)
    assert lines[2]["end_time"] == 28.0  # stops where the next line starts
    assert lines[3]["end_time"] == pytest.approx(28.0 + sung_line_seconds("Last"))


def test_a_blank_timestamp_ends_the_line_before_it():
    lines = LyricsService.parse_lrc(
        "[00:10.00]My will is gone and I don't feel a thing\n[00:12.00]\n"
    )
    assert len(lines) == 1
    assert lines[0]["end_time"] == 12.0


def test_word_timed_lines_keep_their_end():
    lines = LyricsService.parse_lrc("[00:01.00]<00:01.00>one <00:01.50>two\n[00:06.00]three\n")
    assert lines[0]["has_word_sync"] is True
    assert lines[0]["end_time"] == 6.0


def test_sung_length_counts_syllables_within_limits():
    assert sung_line_seconds("Oh") == 2.5
    assert sung_line_seconds("No longer wanting") == 3.5
    assert sung_line_seconds("word " * 40) == 8.0
    assert sung_line_seconds("我们一起唱歌") == 4.0
