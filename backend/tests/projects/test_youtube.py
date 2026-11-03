"""The YouTube kit: chapters that follow the song's instrumental gaps and that YouTube will
show, a title within 100 characters and tags within 500 (backend/services/youtube_uploader)."""

import pytest

from backend.services.youtube_uploader import (
    YouTubeMetadataService,
    _tag_length,
    youtube_chapters,
)


def _line(start: float, end: float, text: str | None = None) -> dict:
    return {"text": text or f"Line at {start:g}", "start_time": start, "end_time": end}


def _package(**kwargs):
    args = {"title": "Song", "artist": "A", "lines": []}
    args.update(kwargs)
    return YouTubeMetadataService.generate_youtube_package(**args)


def test_generate_youtube_package():
    sample_lines = [
        {"id": 0, "text": "First line of the song", "start_time": 5.0, "end_time": 9.0},
        {"id": 1, "text": "Second line of the song", "start_time": 10.0, "end_time": 14.0},
    ]

    pkg = YouTubeMetadataService.generate_youtube_package(
        title="Bohemian Rhapsody",
        artist="Queen",
        lines=sample_lines,
        semitones=2,
        has_guide_vocal=True,
    )

    assert "Queen - Bohemian Rhapsody (Karaoke Version" in pkg["title"]
    assert "+2 Semitones" in pkg["key_note"]
    assert "Instrumental with Backing/Guide" in pkg["description"]
    # A 14 s song is too short for three chapters of 10 s, so YouTube would show none.
    assert "Timestamps:" not in pkg["description"]
    assert "Created with Karaoke Studio." in pkg["description"]
    assert "YouTube Karaoke Studio" not in pkg["description"]
    assert "First line of the song" in pkg["lyrics"]
    assert "karaoke" in pkg["tags"]
    assert "queen" in pkg["tags"]


# --- Chapters -----------------------------------------------------------------------------


def test_chapters_start_at_each_instrumental_gap_with_an_intro_and_an_outro():
    lines = [_line(20, 30, "Verse one"), _line(31, 40), _line(60, 75, "Chorus")]

    chapters = youtube_chapters(lines, duration=120.0)

    # Each section starts when its countdown does, 3 s before the line.
    assert chapters == ["00:00 - Intro", "00:17 - Verse one", "00:57 - Chorus", "01:15 - Outro"]
    pkg = _package(lines=lines, duration=120.0)
    assert "🕒 Timestamps:\n" + "\n".join(chapters) + "\n\n" in pkg["description"]


def test_a_section_starting_under_10_s_after_the_chapter_before_joins_that_chapter():
    lines = [
        _line(8, 30, "First"),
        _line(35, 50, "Second"),
        _line(56, 58, "Third"),
        _line(63, 90, "Fourth"),
    ]

    # The short wait before the first line is no Intro: the first section starts at 00:00.
    # "Fourth" would start 7 s after "Third", so it joins Third's chapter; the 5 s outro is
    # too short for a chapter of its own.
    assert youtube_chapters(lines, duration=95.0) == [
        "00:00 - First",
        "00:32 - Second",
        "00:53 - Third",
    ]


@pytest.mark.parametrize(
    "lines, duration",
    [
        ([], 200.0),
        ([_line(5, 9), _line(10, 14)], None),
        ([_line(5, 9), _line(10, 14)], float("nan")),
        ([_line(15, 20)], 30.0),
    ],
    ids=["no lines", "short song", "bad duration", "two chapters"],
)
def test_songs_youtube_would_show_no_chapters_for_get_no_timestamps_block(lines, duration):
    assert youtube_chapters(lines, duration=duration) == []
    assert "Timestamps:" not in _package(lines=lines, duration=duration)["description"]


def test_chapters_past_an_hour_use_hours_and_long_names_are_cut_to_40_characters():
    words = "a very long opening line that goes on and on for quite a while"
    lines = [_line(3605, 3640, words)]

    chapters = youtube_chapters(lines, duration=3700.0)

    assert chapters[0] == "00:00 - Intro"
    assert chapters[1].startswith("1:00:02 - ")
    assert chapters[2] == "1:00:40 - Outro"
    name = chapters[1].removeprefix("1:00:02 - ")
    assert len(name) <= 40
    assert name.endswith("…")
    assert words.startswith(name.removesuffix("…"))


def test_chapters_stay_in_order_for_unsorted_lines():
    lines = [_line(20, 30, "Late"), _line(60, 70, "Later"), _line(5, 8, "Early")]

    chapters = youtube_chapters(lines, duration=100.0)

    assert chapters == ["00:00 - Intro", "00:17 - Late", "00:57 - Later", "01:10 - Outro"]


# --- Title --------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "title_chars, ending",
    [
        (64, " (Karaoke Version / With Lyrics)"),
        (65, " (Karaoke Version)"),
        (79, " (Karaoke)"),
        (200, "… (Karaoke)"),
    ],
)
def test_the_title_fits_youtubes_100_characters_by_shortening_the_suffix_first(title_chars, ending):
    title = "x" * title_chars

    yt_title = _package(title=title, artist="A")["title"]

    assert len(yt_title) <= 100
    assert yt_title.endswith(ending)
    assert yt_title.startswith("A - x")
    if title_chars < 200:
        assert yt_title == f"A - {title}{ending}"
    else:
        assert len(yt_title) == 100


def test_an_empty_title_falls_back_to_karaoke_track():
    pkg = _package(title="   ", artist="A")

    assert pkg["title"] == "A - Karaoke Track (Karaoke Version / With Lyrics)"
    assert '"Karaoke Track"' in pkg["description"]


@pytest.mark.parametrize("artist", ["Unknown Artist", "unknown", "Artist", "", "   ", None])
def test_a_blank_or_placeholder_artist_is_left_out_of_the_title_and_tags(artist):
    pkg = _package(title="Song", artist=artist)

    assert pkg["title"] == "Song (Karaoke Version / With Lyrics)"
    assert not any("unknown" in tag or tag in ("artist", "artist karaoke") for tag in pkg["tags"])
    assert "song" in pkg["tags"]
    assert "song karaoke" in pkg["tags"]


# --- Tags ---------------------------------------------------------------------------------


def test_tags_have_no_duplicates_and_no_empty_entries():
    tags = _package(title="Lyrics", artist="  Some   Band  ")["tags"]

    assert tags.count("lyrics") == 1
    assert all(tag and tag == " ".join(tag.split()) for tag in tags)
    assert len(tags) == len(set(tags))
    assert "some band" in tags
    assert "some band karaoke" in tags
    assert "lyrics karaoke" in tags


def test_tags_stay_within_youtubes_500_characters():
    tags = _package(title="x" * 400, artist="A")["tags"]

    # YouTube counts a comma between tags and quotes around a tag with a space.
    assert _tag_length(tags) <= 500
    assert "backing track" in tags
    assert "x" * 400 in tags
    assert f"{'x' * 400} karaoke" not in tags


def test_tag_length_counts_commas_and_quotes_like_youtube():
    assert _tag_length([]) == 0
    assert _tag_length(["karaoke"]) == 7
    assert _tag_length(["karaoke", "sing along"]) == 7 + 1 + 12


# --- Malformed lines ----------------------------------------------------------------------


def test_malformed_lines_do_not_break_the_kit():
    lines = [None, "not a line", {"text": 42, "start_time": 20.0, "end_time": 30.0}, _line(31, 40)]

    pkg = _package(lines=lines, duration=60.0)

    assert pkg["lyrics"] == "42\nLine at 31"
    assert "00:17 - 42" in pkg["description"]
    assert _package(lines=None)["lyrics"] == ""
