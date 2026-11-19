"""LRCLIB track names that carry a mix, a featuring clause or an artist or album prefix
still count as the song asked for."""

import pytest

from backend.services.lyrics import LyricsNormalizer, LyricsService

SYNCED = "\n".join(
    f"[{(10 + 18 * i) // 60:02d}:{(10 + 18 * i) % 60:02d}.00]Line {i}" for i in range(12)
)
PLAIN = "\n".join(f"Line {i}" for i in range(12))


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


def test_another_artists_song_of_a_like_name_is_unrelated():
    # LRCLIB's title-only search for Imperial Teen's "You're One" offers this, synced and of
    # the same length
    other = cand("You're The One", "Guerilla Black feat. Mario Winans", "You're The One")
    assert not LyricsService.is_related(other, "You're One", "Imperial Teen")
    assert LyricsService.score_candidate(
        {**other, "duration": 219.0, "syncedLyrics": SYNCED}, "You're One", "Imperial Teen", 218.0
    ) < LyricsService.score_candidate(
        {**cand("You're One", "Imperial Teen"), "duration": 218.0, "plainLyrics": PLAIN},
        "You're One",
        "Imperial Teen",
        218.0,
    )


def test_another_artists_listing_with_the_songs_very_name_still_counts():
    # A cover, or an upload credited to a channel
    assert LyricsService.is_related(
        cand("You're One", "Some Cover Band"), "You're One", "Imperial Teen"
    )
    assert LyricsService.is_related(
        cand("You're One (Live)", "Some Cover Band", "Live"), "You're One", "Imperial Teen"
    )
    # Swapped artist and title
    assert LyricsService.is_related(
        cand("Imperial Teen", "You're One"), "You're One", "Imperial Teen"
    )
    # The upload's title names the artist ("Artist - Song" from a channel)
    assert LyricsService.is_related(
        cand("You're The One", "SWV"), "SWV - You're The One", "90s R&B Vault"
    )


def test_one_artist_written_two_ways_is_the_same_artist():
    assert LyricsService.same_artist("Beyoncé", "Beyonce")
    assert LyricsService.same_artist("Taylor Swift feat. Ed Sheeran", "Taylor Swift")
    assert LyricsService.same_artist("Charli XCX/Tom Boddy", "Charli XCX")
    assert not LyricsService.same_artist("Princess Nokia", "Prince")
    assert not LyricsService.same_artist("Guerilla Black feat. Mario Winans", "Imperial Teen")
