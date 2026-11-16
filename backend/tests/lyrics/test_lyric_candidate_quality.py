"""A clean transcription of a song wins over a sloppy one (ALL CAPS, overlong lines, "x2"
markers, translator's notes, lines crammed into the last second)."""

from backend.services.lyrics import QUALITY_PENALTIES, LyricsService
from backend.tests.helpers.lrclib_listings import (
    LASER_SHARKS_ALL_CAPS,
    LASER_SHARKS_CLEAN,
    METAPHYSICAL,
)


def test_the_messy_laser_sharks_listing_shows_every_sign_of_sloppiness():
    penalty, flags = LyricsService.lyric_quality(LASER_SHARKS_ALL_CAPS["syncedLyrics"])
    assert set(flags) == set(QUALITY_PENALTIES)
    assert penalty == sum(QUALITY_PENALTIES.values())


def test_clean_listings_carry_no_penalty():
    for listing in (LASER_SHARKS_CLEAN, METAPHYSICAL):
        assert LyricsService.lyric_quality(listing["syncedLyrics"]) == (0, [])


def test_the_clean_listing_wins_even_when_lrclib_lists_the_messy_one_first():
    best = LyricsService.rank_candidates(
        [LASER_SHARKS_ALL_CAPS, LASER_SHARKS_CLEAN], "Laser Sharks", "Savant", 244
    )
    assert best["id"] == LASER_SHARKS_CLEAN["id"]


def test_each_sign_is_detected_on_its_own():
    quality = LyricsService.lyric_quality
    shouted = "[00:01.00] HELLO THERE MY FRIEND\n[00:04.00] HOW ARE YOU DOING TODAY MY FRIEND\n"
    assert quality(shouted)[1] == ["all_caps"]
    assert quality("[00:01.00] " + "la " * 50)[1] == ["long_lines"]
    assert quality("[00:01.00] Happy shark x2\n")[1] == ["repeat_markers"]
    assert quality("[00:01.00] Oh oh (2x)\n")[1] == ["repeat_markers"]
    assert quality("[00:01.00] Translation Japanese:\n")[1] == ["annotations"]
    tail = "".join(f"[00:{s:05.2f}] line\n" for s in (10, 20, 30, 59.1, 59.4, 59.7)) + (
        "[01:00.00]\n"
    )
    assert quality(tail)[1] == ["crammed_tail"]


def test_ordinary_lyrics_are_not_mistaken_for_sloppiness():
    quality = LyricsService.lyric_quality
    # "x" inside words, short shouted lines, and a sung parenthesis stay clean
    text = (
        "[00:01.00] Relax, max out the box\n"
        "[00:05.00] HEY!\n"
        "[00:09.00] (It's the laser sharks)\n"
        "[00:12.00] I said it was 2x better\n"
    )
    assert quality(text) == (0, [])
