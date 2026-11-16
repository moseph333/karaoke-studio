"""Fan uploads: a video titled "Artist - Song" posted by a channel that is not the artist."""

from backend.services.downloader import track_artist
from backend.services.lyrics import LyricsNormalizer, LyricsService


def normalize(title: str, artist: str, from_uploader: bool) -> tuple[str, str]:
    return LyricsNormalizer.normalize_track_metadata(title, artist, from_uploader)


def test_a_fan_upload_names_the_artist_before_the_dash():
    assert normalize(
        'Handsome Boy Modeling School - "Metaphysical (A Good Day)"', "solonmonkey", True
    ) == ("Metaphysical (A Good Day)", "Handsome Boy Modeling School")


def test_a_fan_upload_drops_the_quality_tag_and_keeps_the_song():
    title, artist = normalize(
        "Savant - Laser Sharks [Protos] (FULL / HQ)", "Mix and Match Content", True
    )
    assert artist == "Savant"
    assert title == "Laser Sharks [Protos]"
    assert LyricsNormalizer.extract_base_title(title) == "Laser Sharks"


def test_the_artist_field_from_youtube_is_trusted_over_the_title():
    # yt-dlp's own artist field: the title's dash is a subtitle, not an artist
    assert normalize("Song Name - Part Two", "Real Artist", False) == (
        "Song Name - Part Two",
        "Real Artist",
    )


def test_an_uploader_without_an_artist_field_keeps_remaster_and_live_titles():
    assert normalize("Bohemian Rhapsody - Remastered 2011", "Queen Official", True) == (
        "Bohemian Rhapsody",
        "Queen",
    )
    assert normalize("Creep - Live", "Radiohead", True) == ("Creep", "Radiohead")


def test_the_artists_own_channel_still_matches_either_side():
    assert normalize("Laser Sharks - Savant", "Savant", True) == ("Laser Sharks", "Savant")
    assert normalize("Savant - Laser Sharks", "SavantVEVO", True) == ("Laser Sharks", "Savant")


def test_track_artist_says_when_the_artist_is_only_the_uploader():
    assert track_artist({"artist": "Savant", "uploader": "Fan"}, "x") == ("Savant", False)
    assert track_artist({"uploader": "solonmonkey"}, "x") == ("solonmonkey", True)
    assert track_artist({"artist": " ", "uploader": ""}, "Unknown Artist") == (
        "Unknown Artist",
        False,
    )
    assert track_artist(None, "Unknown Artist") == ("Unknown Artist", False)


def test_the_lrclib_ladder_for_a_fan_upload_searches_the_song_by_its_artist():
    title, artist = normalize(
        "Savant - Laser Sharks [Protos] (FULL / HQ)", "Mix and Match Content", True
    )
    queries = [
        step.get("q") or step["params"].get("track_name")
        for step in LyricsService.generate_query_ladder(title, artist, 244)
    ]
    assert "Laser Sharks Savant" in queries
    assert not any("Mix" in q for q in queries)
