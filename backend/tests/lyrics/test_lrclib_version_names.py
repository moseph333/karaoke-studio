"""LRCLIB track names that carry a mix, a featuring clause or an artist or album prefix
still count as the song asked for."""

import pytest

from backend.services.lyrics import LyricsNormalizer, LyricsService


def cand(track: str, artist: str, album: str = "") -> dict:
    return {"trackName": track, "artistName": artist, "albumName": album}


@pytest.mark.parametrize(
    "track,album",
    [
        ("Laser Sharks (Original Mix)", "Protos"),
        ("Protos - Laser Sharks", "SAVANT COMPLETE"),
        ("Savant - Laser Sharks", "Protos"),
        ("Laser Sharks", "Protos"),
    ],
)
def test_every_laser_sharks_listing_is_the_same_song(track, album):
    assert LyricsService.is_related(cand(track, "Savant", album), "Laser Sharks", "Savant")
    assert LyricsService.is_related(cand(track, "Savant", album), "Laser Sharks [Protos]", "Savant")


def test_a_featuring_clause_cut_off_by_lrclib_still_matches():
    hbms = "Handsome Boy Modeling School"
    assert LyricsService.is_related(
        cand("Metaphysical (feat. Miho Hator", hbms), "Metaphysical (A Good Day)", hbms
    )


def test_another_song_by_the_same_artist_stays_unrelated():
    hbms = "Handsome Boy Modeling School"
    assert not LyricsService.is_related(cand("The Truth", hbms), "Metaphysical (A Good Day)", hbms)
    assert not LyricsService.is_related(
        cand("Burgertime (Savant Theme) (Original Mix)", "Savant"), "Laser Sharks", "Savant"
    )


def test_candidate_song_name_strips_prefixes_only_when_they_name_the_artist_or_album():
    name = LyricsService.candidate_song_name
    assert name("Protos - Laser Sharks", "Savant", "Protos") == "Laser Sharks"
    assert name("Savant - Laser Sharks", "Savant") == "Laser Sharks"
    assert name("Laser Sharks (Original Mix)", "Savant") == "Laser Sharks"
    # A dash that is part of the song's name stays
    assert name("Hide - Seek", "Imogen Heap") == "Hide - Seek"


def test_clean_title_drops_a_featuring_clause_that_never_closes():
    assert LyricsNormalizer.clean_title("Metaphysical (feat. Miho Hator") == "Metaphysical"
    # A title whose own bracket is only "with" text is not touched by the cut-off rule
    assert LyricsNormalizer.clean_title("Stay (With Me") == "Stay (With Me"
