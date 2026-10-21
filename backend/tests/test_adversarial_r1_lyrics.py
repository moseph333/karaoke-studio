"""Adversarial stress-testing and empirical fuzzing for Requirement R1.

Covers:
- LyricsNormalizer against messy real-world strings, nested brackets, featured artists, unicode spaces, and delimiters
- rank_candidates against duration anomalies (0, negative, None, NaN, Inf), plain vs synced trade-offs, and exact ties
- parse_lrc against extreme offsets, malformed Enhanced LRC tags, empty segments, and raw tag leakage
- AudioAligner.align_lyrics explicit word sync preservation across real stems and synthetic edge cases
"""

import os
import re
import tempfile

import numpy as np
import soundfile as sf

from backend.services.aligner import AudioAligner
from backend.services.lyrics import LyricsNormalizer, LyricsService

# ==============================================================================
# Challenge 1: LyricsNormalizer Adversarial Corpus Fuzzing
# ==============================================================================


def test_lyrics_normalizer_adversarial_bracket_nesting():
    """Stress test LyricsNormalizer with deep and varied bracket nestings."""
    # Deeply nested media noise
    clean_t, clean_a = LyricsNormalizer.normalize_track_metadata(
        "Song Title (Official Video [HD] (Remastered) {Audio})", "Artist Name"
    )
    assert "Song Title" in clean_t
    assert clean_a == "Artist Name"

    # Multi-layered brackets
    clean_t2, _ = LyricsNormalizer.normalize_track_metadata("Title (((4K)))", "Artist")
    assert "Title" in clean_t2

    # Unclosed bracket resilience
    clean_t3, _ = LyricsNormalizer.normalize_track_metadata("Title (Official Video [HD", "Artist")
    assert isinstance(clean_t3, str)


def test_lyrics_normalizer_adversarial_featured_artists_and_casing():
    """Stress test featured artist extraction with diverse casings and delimiters."""
    # Differing casing: FT., FEAT., featuring
    clean_t, clean_a = LyricsNormalizer.normalize_track_metadata(
        "Song FT. Artist B & FEAT. Artist C", "Artist A"
    )
    assert clean_t == "Song"
    assert clean_a == "Artist A"

    # Bracketed featured artist
    clean_t2, clean_a2 = LyricsNormalizer.normalize_track_metadata(
        "Song (feat. Artist B, featuring Artist C)", "Artist A"
    )
    assert clean_t2 == "Song"
    assert clean_a2 == "Artist A"

    # Pronoun exemption: 'Stay With Me' must preserve title
    clean_t3, clean_a3 = LyricsNormalizer.normalize_track_metadata("Stay With Me", "Sam Smith")
    assert clean_t3 == "Stay With Me"
    assert clean_a3 == "Sam Smith"


def test_lyrics_normalizer_adversarial_delimiters_and_unicode_spaces():
    """Stress test non-standard delimiters, trailing noise, and unicode spacing."""
    # Strange delimiters: pipe, double slash, em-dash
    clean_t, clean_a = LyricsNormalizer.normalize_track_metadata(
        "Song | Official Video // HD - 4K: visualizer", "Artist"
    )
    assert clean_t == "Song"
    assert clean_a == "Artist"

    # Unicode non-breaking space and narrow space
    clean_t2, clean_a2 = LyricsNormalizer.normalize_track_metadata(
        "Song\u00a0Name\u202f[HD]", "Artist\u00a0-\u00a0Topic"
    )
    assert clean_t2 == "Song Name"
    assert clean_a2 == "Artist"

    # Trailing delimiter clusters
    clean_t3, _ = LyricsNormalizer.normalize_track_metadata("Song Name - - -", "Artist")
    assert "Song Name" in clean_t3


def test_lyrics_normalizer_adversarial_types_and_extremes():
    """Stress test empty, None, and extremely long metadata inputs."""
    assert LyricsNormalizer.normalize_track_metadata("", "") == ("", "Unknown Artist")
    assert LyricsNormalizer.normalize_track_metadata(None, None) == ("", "Unknown Artist")

    huge_title = "Title " * 500
    huge_artist = "Artist " * 500
    clean_t, clean_a = LyricsNormalizer.normalize_track_metadata(huge_title, huge_artist)
    assert len(clean_t) > 0
    assert len(clean_a) > 0


# ==============================================================================
# Challenge 2: rank_candidates Adversarial Pool Fuzzing
# ==============================================================================


def test_rank_candidates_duration_anomalies():
    """Verify rank_candidates gracefully handles 0, negative, None, NaN, and Inf durations."""
    target_title = "Shape of You"
    target_artist = "Ed Sheeran"
    target_dur = 233.0

    pool = [
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "duration": 0,
            "syncedLyrics": "[00:01.00] Line 1",
        },
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "duration": -50,
            "syncedLyrics": "[00:01.00] Line 1",
        },
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "duration": None,
            "syncedLyrics": "[00:01.00] Line 1",
        },
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "syncedLyrics": "[00:01.00] Line 1",
        },
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "duration": "invalid",
            "syncedLyrics": "[00:01.00] Line 1",
        },
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "duration": float("nan"),
            "syncedLyrics": "[00:01.00] Line 1",
        },
        {
            "trackName": "Shape of You",
            "artistName": "Ed Sheeran",
            "duration": float("inf"),
            "syncedLyrics": "[00:01.00] Line 1",
        },
    ]

    for cand in pool:
        best = LyricsService.rank_candidates([cand], target_title, target_artist, target_dur)
        assert best is not None


def test_rank_candidates_synced_vs_plain_and_duration_ranking():
    """Verify syncedLyrics preference and duration proximity tie-breaking."""
    target_dur = 200.0

    # Synced lyrics candidate matching duration vs far off
    synced_close = {
        "id": "synced_close",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 201.0,
        "syncedLyrics": "[00:01.00] Test",
    }
    synced_far = {
        "id": "synced_far",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 290.0,
        "syncedLyrics": "[00:01.00] Test",
    }

    winner = LyricsService.rank_candidates([synced_far, synced_close], "Song", "Artist", target_dur)
    assert winner["id"] == "synced_close"


def test_rank_candidates_deterministic_tie_breaking():
    """Verify candidates with identical scores break ties deterministically without crashing."""
    c1 = {
        "id": "c1",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 180,
        "syncedLyrics": "[00:01.00] Test",
    }
    c2 = {
        "id": "c2",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 180,
        "syncedLyrics": "[00:01.00] Test",
    }

    winner1 = LyricsService.rank_candidates([c1, c2], "Song", "Artist", 180)
    assert winner1["id"] == "c1"

    winner2 = LyricsService.rank_candidates([c2, c1], "Song", "Artist", 180)
    assert winner2["id"] == "c2"


# ==============================================================================
# Challenge 3: parse_lrc Malformed Enhanced LRC & Tag Leakage
# ==============================================================================


def test_parse_lrc_negative_offset_header_clamped_at_zero():
    """Negative offset headers [offset:-10000] shift timestamps and clamp at 0.0."""
    lrc = """[offset:-10000]
[00:05.00]First line
[00:15.00]Second line
"""
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 2
    assert lines[0]["start_time"] == 0.0
    assert lines[0]["end_time"] == 5.0
    assert lines[1]["start_time"] == 5.0
    assert lines[1]["end_time"] == 9.0

    for line_item in lines:
        assert line_item["start_time"] >= 0.0
        assert line_item["end_time"] >= 0.0
        for w in line_item["words"]:
            assert w["start_time"] >= 0.0
            assert w["end_time"] >= 0.0


def test_parse_lrc_huge_positive_offset_header():
    """Huge positive offset headers [offset:+600000] shift all timestamps safely."""
    lrc = """[offset:+600000]
[00:05.00]First line
[00:15.00]Second line
"""
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 2
    assert lines[0]["start_time"] == 605.0
    assert lines[0]["end_time"] == 609.5
    assert lines[1]["start_time"] == 615.0
    assert lines[1]["end_time"] == 619.0


def test_parse_lrc_malformed_enhanced_tags_and_zero_tag_leakage():
    """Verify that NO raw <...> or [...] tags ever leak into display text or word strings."""
    adversarial_inputs = [
        # Consecutive tags
        "[00:01.00]<00:01.00><00:01.50>word <00:02.00><00:02.50>another",
        # Trailing tags
        "[00:01.00]<00:01.00>word <00:02.00>another <00:03.00>",
        # Tags with missing digits / non-standard format
        "[00:01.00]prefix <1:2.3>word <00:02.50>middle <bad_tag>end",
        # Mixed <> and [] tags
        "[00:01.00]Hello [00:02.00]World <00:03.00>Again [Chorus] End",
        # Consecutive word tags with no text between
        "[00:01.00]<00:01.00><00:02.00><00:03.00>",
    ]

    for content in adversarial_inputs:
        parsed = LyricsService.parse_lrc(content)
        for line in parsed:
            assert not re.search(r"\[.*?\]|<.*?>", line["text"]), (
                f"Raw tag leak in text: {line['text']}"
            )
            for w in line["words"]:
                assert not re.search(r"\[.*?\]|<.*?>", w["word"]), (
                    f"Raw tag leak in word: {w['word']}"
                )
                assert w["start_time"] <= w["end_time"], f"Invalid word duration: {w}"


# ==============================================================================
# Challenge 4: AudioAligner.align_lyrics Explicit Word Sync Preservation
# ==============================================================================


def test_align_lyrics_preserves_explicit_word_sync_across_audio():
    """Verify that lines with has_word_sync = True preserve exact timestamps across audio stems."""
    aligner = AudioAligner()
    enhanced_lrc = """[00:04.200]<00:04.200>First <00:05.100>line <00:06.000>of <00:07.000>song <00:08.500>
[00:08.500]<00:08.500>Second <00:09.500>line <00:11.000>with <00:12.500>words <00:14.000>
[00:14.000]<00:14.000>Final <00:15.500>chorus <00:17.000>line <00:19.000>
"""
    lines = LyricsService.parse_lrc(enhanced_lrc)
    assert len(lines) == 3
    assert all(line_item["has_word_sync"] for line_item in lines)

    # Test with real stems if present
    real_stems = [
        "workspace_data/stems/local_bcb4ffe0/vocals.wav",
        "workspace_data/stems/mKB_8uTVlXw/vocals.wav",
    ]
    for stem in real_stems:
        if os.path.exists(stem):
            aligned = aligner.align_lyrics(stem, lines)
            for orig, res in zip(lines, aligned, strict=True):
                assert res.get("has_word_sync") is True
                assert res["words"] == orig["words"]
                assert res["start_time"] == orig["start_time"]
                assert res["end_time"] == orig["end_time"]

    # Test with synthetic pure silence, 96kHz, stereo, and sub-frame audio
    with tempfile.TemporaryDirectory() as tmpdir:
        # Pure silence
        silence_file = os.path.join(tmpdir, "silence.wav")
        sf.write(silence_file, np.zeros(44100 * 5, dtype=np.float32), 44100)
        res_silence = aligner.align_lyrics(silence_file, lines)
        for orig, res in zip(lines, res_silence, strict=True):
            assert res["words"] == orig["words"]

        # 96kHz audio
        hi_sr_file = os.path.join(tmpdir, "hi_sr.wav")
        sf.write(hi_sr_file, np.random.randn(96000 * 5).astype(np.float32), 96000)
        res_hi = aligner.align_lyrics(hi_sr_file, lines)
        for orig, res in zip(lines, res_hi, strict=True):
            assert res["words"] == orig["words"]

        # Stereo audio
        stereo_file = os.path.join(tmpdir, "stereo.wav")
        sf.write(stereo_file, np.random.randn(44100 * 5, 2).astype(np.float32), 44100)
        res_stereo = aligner.align_lyrics(stereo_file, lines)
        for orig, res in zip(lines, res_stereo, strict=True):
            assert res["words"] == orig["words"]


def test_align_lyrics_mixed_explicit_and_untimed_lines():
    """Verify alignment of songs with mixed explicit word sync and untimed lines."""
    aligner = AudioAligner()
    mixed_lrc = """[00:04.200]<00:04.200>First <00:05.100>line <00:06.000>of <00:07.000>song <00:08.500>
[00:08.500]Standard un-timed line without word tags
[00:14.000]<00:14.000>Final <00:15.500>chorus <00:17.000>line <00:19.000>
"""
    lines = LyricsService.parse_lrc(mixed_lrc)
    stem_path = "workspace_data/stems/mKB_8uTVlXw/vocals.wav"
    if os.path.exists(stem_path):
        aligned = aligner.align_lyrics(stem_path, lines)
        # Line 0 explicit words preserved
        assert aligned[0]["has_word_sync"] is True
        assert aligned[0]["words"] == lines[0]["words"]
        # Line 1 un-timed words aligned via audio energy
        assert aligned[1].get("has_word_sync") is not True
        assert len(aligned[1]["words"]) == len(lines[1]["words"])
        # Line 2 explicit words preserved
        assert aligned[2]["has_word_sync"] is True
        assert aligned[2]["words"] == lines[2]["words"]
