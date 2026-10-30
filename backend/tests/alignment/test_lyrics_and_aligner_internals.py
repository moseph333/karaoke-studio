"""
Tier 5 White-Box Adversarial Stress & Hardening Test Suite (Milestone Final).

Empirical challenger tests stressing internal code branches, error handlers, and edge cases
across R1, R2, R3, and R4 in backend/services/lyrics.py and backend/services/aligner.py:
- Group 1 (R1): Regex/Zalgo injection, hostile HTTP payloads, candidate ranking edge cases,
  malformed LRC & Enhanced LRC parsing, and corrupted LRC generation.
- Group 2 (R2): Stereo phase cancellation, high-energy cocktail babble, extreme time offsets,
  sub-frame/impulse signals, NaN/Inf audio sanitization, and cadence mismatch rejection.
- Group 3 (R3): Line snapping with breath noise suppression, instrumental interlude preservation,
  sustained note extensions, inverted/zero line intervals, and M vs K untimed partitioning.
- Group 4 (R4): Rapid-tempo machine-gun word DP, multilingual Unicode & punctuation stress,
  voiced harmonic gating against mixed breath/drum bleed, sub-frame audio, and extreme sample rates.
- Group 5 (E2E): Full end-to-end chaining across R1 -> R2 -> R3 -> R4 with hostile inputs,
  malformed custom LRC realignment, and CPU execution budget verification.
"""

import math
import re
import time
from typing import Any
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf

import backend.services.aligner as aligner_mod
from backend.main import LyricLineSchema, WordTimingSchema
from backend.services.aligner import (
    AudioAligner,
    align_words_spectral,
    calculate_word_weight,
    count_syllables,
    enforce_monotonic_words,
    estimate_global_offset,
    refine_line_boundaries,
)
from backend.services.lyrics import (
    LyricsNormalizer,
    LyricsService,
    extract_base_title,
    extract_canonical,
    extract_primary_artist,
    generate_query_ladder,
)

# ==============================================================================
# Hermetic Zero-Network Isolation Fixture
# ==============================================================================


@pytest.fixture(autouse=True)
def prevent_external_network_leakage(monkeypatch):
    """Enforces zero live network leakage across all tier 5 tests."""
    monkeypatch.setattr(
        "backend.services.lyrics.syncedlyrics.search",
        lambda *args, **kwargs: None,
    )


# ==============================================================================
# Helper Utilities for Audio & Signal Generation
# ==============================================================================


def create_synthetic_signal(
    duration: float,
    vocal_events: list[dict[str, Any]],
    sr: int = 44100,
    noise_level: float = 0.001,
) -> np.ndarray:
    """Synthesizes deterministic mono vocal audio with harmonic tones, breath, or transients."""
    num_samples = int(duration * sr)
    t = np.linspace(0, duration, num_samples, endpoint=False)
    signal = np.random.RandomState(42).normal(0.0, noise_level, num_samples).astype(np.float32)

    ramp_dur = 0.02
    ramp_samples = max(2, int(ramp_dur * sr))
    window = np.hanning(ramp_samples * 2)
    attack = window[:ramp_samples]
    decay = window[ramp_samples:]

    for ev in vocal_events:
        idx_s = max(0, int(ev["start"] * sr))
        idx_e = min(num_samples, int(ev["end"] * sr))
        ev_len = idx_e - idx_s
        if ev_len <= 0:
            continue

        if ev.get("is_breath", False):
            rng = np.random.RandomState(int(ev["start"] * 1000) % 10000)
            breath = rng.normal(0.0, 0.40, ev_len).astype(np.float32)
            breath = np.diff(breath, prepend=breath[0])
            if ev_len >= ramp_samples * 2:
                breath[:ramp_samples] *= attack
                breath[-ramp_samples:] *= decay
            signal[idx_s:idx_e] += breath
        elif ev.get("is_transient", False):
            rng = np.random.RandomState(int(ev["start"] * 1000) % 10000)
            decay_env = np.exp(-np.linspace(0, 10, ev_len)).astype(np.float32)
            transient = (rng.normal(0.0, 0.7, ev_len).astype(np.float32) * decay_env).astype(
                np.float32
            )
            signal[idx_s:idx_e] += transient
        else:
            freq = float(ev.get("freq", 320.0))
            tone = (
                0.55 * np.sin(2 * np.pi * freq * t[idx_s:idx_e])
                + 0.28 * np.sin(2 * np.pi * (2 * freq) * t[idx_s:idx_e])
                + 0.14 * np.sin(2 * np.pi * (3 * freq) * t[idx_s:idx_e])
            ).astype(np.float32)
            if ev_len >= ramp_samples * 2:
                tone[:ramp_samples] *= attack
                tone[-ramp_samples:] *= decay
            signal[idx_s:idx_e] += tone

    return np.clip(signal, -0.99, 0.99)


# ==============================================================================
# Group 1: Requirement 1 (R1) Adversarial Lyric Retrieval & Parsing
# ==============================================================================


class TestTier5R1AdversarialLyrics:
    """White-box adversarial tests for metadata normalization, LRCLIB ladder, and LRC parsing."""

    def test_r1_normalizer_regex_and_zalgo_injection(self):
        """Stresses normalizer against regex metacharacters, Zalgo diacritics, and RTL marks."""
        hostile_titles = [
            r"(?i)[a-z]+{1,3} (Official Video) [Remaster]",
            r".*+?^${}()|[\]\\",
            "C̸a̴n̸d̸y̴ (feat. G̸u̸e̸s̸t̸) [OST]",
            "\u200e\u202e\u200fSpecial Title \u200e(From Movie Soundtrack)",
            "((([[[{{{Unbalanced Brackets - 2021 Remaster",
            "Trailing Delimiters // - | : ",
            "\x00\x01\x08Title With Control Chars\x1f (Bonus Track)",
        ]
        hostile_artists = [
            r"(?<=foo)bar(?=baz) feat. Guest",
            "A̸r̸t̸i̸s̸t̴ & Collaborator x Third",
            "\u200e\u200fArabic Singer feat. English Singer",
            "Artist - Topic",
            "ArtistVEVO Official Channel",
            "---///::: ",
        ]

        for t in hostile_titles:
            clean_t = LyricsNormalizer.clean_title(t)
            assert isinstance(clean_t, str)
            base_t = extract_base_title(t)
            assert isinstance(base_t, str)

        for a in hostile_artists:
            clean_a = LyricsNormalizer.clean_artist(a)
            assert isinstance(clean_a, str)
            primary_a = extract_primary_artist(a)
            assert isinstance(primary_a, str)
            assert primary_a != ""

        # Test canonical extraction with swapped patterns and hostile delimiters
        can_t, can_a = extract_canonical(
            "David Bowie - Under Pressure (2011 Remaster)", "Queen & David Bowie"
        )
        assert "Under Pressure" in can_t
        assert "David Bowie" in can_a or "Queen" in can_a

    def test_r1_lrclib_malformed_and_hostile_network_responses(self, monkeypatch):
        """Verifies LRCLIB query ladder robustness when API returns corrupt JSON or non-dict payloads."""
        svc = LyricsService()

        # Case 1: Non-JSON raw HTML string response (e.g. 502 Bad Gateway)
        mock_resp_502 = MagicMock()
        mock_resp_502.status_code = 502
        mock_resp_502.json.side_effect = ValueError("Invalid JSON response")

        monkeypatch.setattr(
            "backend.services.lyrics.requests.get",
            lambda *args, **kwargs: mock_resp_502,
        )
        res = svc.fetch_lyrics("Test Title", "Test Artist", duration=180.0)
        assert res["source"] == "none"
        assert res["synced"] is False
        assert res["lines"] == []

        # Case 2: 200 OK returning non-dict payloads (e.g. raw integer, list of strings, empty list)
        responses = [
            12345,
            True,
            [],
            ["corrupted_string_instead_of_dict"],
            [{"trackName": "Corrupted", "syncedLyrics": 12345}],  # non-string syncedLyrics
        ]

        for bad_payload in responses:
            mock_resp = MagicMock()
            mock_resp.status_code = 200
            mock_resp.json.return_value = bad_payload

            monkeypatch.setattr(
                "backend.services.lyrics.requests.get",
                lambda *args, resp=mock_resp, **kwargs: resp,
            )
            # Must safely complete ladder without raising uncaught exceptions
            res = svc._fetch_from_lrclib("Test Title", "Test Artist", duration=180.0)
            assert res is None or isinstance(res, dict)

    def test_r1_candidate_ranking_pathological_pool(self):
        """Stresses candidate ranking with non-finite durations, massive candidate lists, and stubs."""
        pool: list[dict[str, Any]] = [
            # Candidate with missing fields
            {},
            # Candidate with None lyrics
            {"syncedLyrics": None, "plainLyrics": None},
            # Candidate with NaN duration
            {
                "trackName": "Song",
                "artistName": "Artist",
                "duration": float("nan"),
                "syncedLyrics": "[00:01.00] Line 1\n[00:05.00] Line 2",
            },
            # Candidate with Inf duration
            {
                "trackName": "Song",
                "artistName": "Artist",
                "duration": float("inf"),
                "syncedLyrics": "[00:01.00] Line 1\n[00:05.00] Line 2",
            },
            # Stub candidate (<6 lines) for long track (200s)
            {
                "trackName": "Song",
                "artistName": "Artist",
                "duration": 200.0,
                "syncedLyrics": "[00:01.00] Line 1\n[00:05.00] Line 2",
            },
            # Truncated snippet candidate (last timestamp is 20s for 200s track)
            {
                "trackName": "Song",
                "artistName": "Artist",
                "duration": 200.0,
                "syncedLyrics": (
                    "[00:01.00] Line 1\n[00:05.00] Line 2\n[00:10.00] Line 3\n"
                    "[00:15.00] Line 4\n[00:18.00] Line 5\n[00:20.00] Line 6"
                ),
            },
            # High-quality full candidate
            {
                "trackName": "Song",
                "artistName": "Artist",
                "duration": 200.0,
                "syncedLyrics": "\n".join(
                    f"[{i * 15 // 60:02d}:{i * 15 % 60:02d}.00] Lyric line {i}" for i in range(12)
                ),
            },
        ]

        best_cand, best_score = LyricsService.rank_candidates_with_score(
            pool, target_title="Song", target_artist="Artist", target_duration=200.0
        )
        assert best_cand is not None
        assert best_score > 0.0
        # The high-quality full candidate must win over stubs and truncated snippets
        assert len(best_cand["syncedLyrics"].splitlines()) == 12

    def test_r1_lrc_parser_extreme_timestamp_and_tag_fuzzing(self):
        """Fuzzes parse_lrc with out-of-order lines, repeated tags, negative offsets, and word sync."""
        hostile_lrc = """
[ti:Fuzzed Song]
[ar:Fuzzed Artist]
[offset:-5000]
[9999:59.99] Far future line that wraps around
[00:15.00][00:25.00] Repeated timestamp line
[00:02.00] Out of order earlier line
[00:10.00] <00:10.50>word1 <00:08.00>word2_inverted <invalid:tag>word3 <00:12.00>word4
[00:30.00] Line with unclosed tag <00:30.50 unclosed word
"""
        parsed = LyricsService.parse_lrc(hostile_lrc)
        assert len(parsed) >= 4

        # Verify lines are sorted chronologically despite out-of-order input
        times = [line["start_time"] for line in parsed]
        assert times == sorted(times)

        # Check all timestamps are finite and non-negative
        for line in parsed:
            assert line["start_time"] >= 0.0
            assert line["end_time"] > line["start_time"]
            assert math.isfinite(line["start_time"])
            assert math.isfinite(line["end_time"])
            for w in line.get("words", []):
                assert w["start_time"] >= line["start_time"]
                assert w["end_time"] <= line["end_time"] + 0.5
                assert w["start_time"] < w["end_time"]

    def test_r1_generate_lrc_hostile_inputs(self):
        """Verifies generate_lrc sanitizes NaN/Inf timestamps and nested tags."""
        hostile_lines = [
            {"id": 2, "text": "Third line [00:99.99]", "start_time": 10.5, "end_time": 14.0},
            {"id": 1, "text": "Second line", "start_time": float("nan"), "end_time": 5.0},
            {"id": 0, "text": "First line", "start_time": -3.5, "end_time": 2.0},
            {"id": 3, "text": "Fourth line <00:12.00>", "start_time": 20.0, "end_time": 24.0},
        ]
        lrc_text = LyricsService.generate_lrc(hostile_lines, title="Test", artist="Artist")
        assert "[ti:Test]" in lrc_text
        assert "[ar:Artist]" in lrc_text
        # Must sort chronologically and not contain NaN
        assert "nan" not in lrc_text.lower()
        assert "[00:00.00]First line" in lrc_text
        assert "[00:10.50]Third line" in lrc_text


# ==============================================================================
# Group 2: Requirement 2 (R2) Adversarial Acoustic Verification & Global Offset
# ==============================================================================


class TestTier5R2AdversarialOffset:
    """White-box adversarial tests for FFT cross-correlation, offset recovery, and acoustic checks."""

    def test_r2_stereo_phase_cancellation_complete_annihilation(self):
        """Verifies estimate_global_offset handles stereo phase cancellation (L = +s, R = -s)."""
        sr = 44100
        dur = 8.0
        n_samples = int(dur * sr)
        # Create non-zero mono signal
        sig = np.sin(2 * np.pi * 440.0 * np.linspace(0, dur, n_samples)).astype(np.float32)
        # Stereo audio where Right channel is inverted Left channel: (L + R) / 2 == 0.0
        stereo_cancelled = np.column_stack((sig, -sig))

        lines = [
            {"start_time": 1.0, "end_time": 4.0, "text": "Line one"},
            {"start_time": 4.5, "end_time": 7.5, "text": "Line two"},
        ]

        offset, conf = estimate_global_offset(
            audio=stereo_cancelled,
            sample_rate=sr,
            lines=lines,
            max_offset=15.0,
        )
        assert offset == 0.0
        assert conf == 0.0
        assert math.isfinite(offset)
        assert math.isfinite(conf)

    def test_r2_high_energy_cocktail_babble_noise(self):
        """Verifies estimate_global_offset rejects high-energy stationary babble uncorrelated with lyrics."""
        sr = 44100
        dur = 12.0
        n_samples = int(dur * sr)
        t = np.linspace(0, dur, n_samples)
        # Construct cocktail babble: dense multi-frequency asynchronous sine cluster + noise
        babble = np.zeros(n_samples, dtype=np.float32)
        for f in [120, 185, 240, 310, 480, 620, 780, 950]:
            babble += 0.10 * np.sin(2 * np.pi * f * t).astype(np.float32)
        rng = np.random.RandomState(999)
        babble += rng.normal(0.0, 0.20, n_samples).astype(np.float32)
        babble = np.clip(babble, -0.95, 0.95)

        lines = [
            {"start_time": 2.0, "end_time": 4.0, "text": "Singing line 1"},
            {"start_time": 6.0, "end_time": 8.0, "text": "Singing line 2"},
        ]

        offset, conf = estimate_global_offset(
            audio=babble,
            sample_rate=sr,
            lines=lines,
            max_offset=10.0,
        )
        # Because acoustic energy does not match pulsed lyric lines, correlation must be rejected
        assert conf < 0.15
        assert offset == 0.0

    def test_r2_extreme_offsets_and_sub_sample_impulses(self):
        """Stresses boundary lags (+14.8s, +25.0s) and single-sample impulse audio."""
        sr = 44100
        # 1. Extreme shift within window (+14.0s)
        vocal_events = [
            {"start": 16.0, "end": 18.5, "freq": 350.0},
            {"start": 19.5, "end": 22.0, "freq": 350.0},
        ]
        audio = create_synthetic_signal(duration=25.0, vocal_events=vocal_events, sr=sr)
        lines = [
            {"start_time": 2.0, "end_time": 4.5, "text": "Phrase 1"},
            {"start_time": 5.5, "end_time": 8.0, "text": "Phrase 2"},
        ]
        # True offset is +14.0s (audio leads by 14s)
        offset, conf = estimate_global_offset(audio, sr, lines, max_offset=15.0)
        assert abs(offset - 14.0) <= 0.150
        assert conf >= 0.15

        # 2. Shift beyond max_offset (+20.0s when max_offset is 10.0s)
        offset_beyond, _conf_beyond = estimate_global_offset(audio, sr, lines, max_offset=10.0)
        # Should not falsely match an out-of-bounds offset
        assert abs(offset_beyond) <= 10.0

        # 3. Single-sample spike in silence
        spike_audio = np.zeros(sr * 2, dtype=np.float32)
        spike_audio[100] = 0.99
        off_spike, conf_spike = estimate_global_offset(spike_audio, sr, lines)
        assert off_spike == 0.0
        assert conf_spike < 0.15

    def test_r2_audio_with_nan_inf_dc_bias(self):
        """Verifies estimate_global_offset sanitizes corrupt audio arrays."""
        sr = 44100
        audio = np.ones(sr * 3, dtype=np.float32) * 0.8  # Strong DC bias
        audio[10:50] = float("nan")
        audio[100:150] = float("inf")
        audio[200:250] = float("-inf")

        lines = [{"start_time": 0.5, "end_time": 2.0, "text": "Line"}]
        offset, conf = estimate_global_offset(audio, sr, lines)
        assert offset == 0.0
        assert conf == 0.0


# ==============================================================================
# Group 3: Requirement 3 (R3) Adversarial Line Snapping & Untimed Alignment
# ==============================================================================


class TestTier5R3AdversarialLineSnapping:
    """White-box adversarial tests for line boundary refinement and untimed phrase partitioning."""

    def test_r3_line_snapping_breath_noise_suppression(self):
        """Verifies line start onset snapping skips pre-singing breath noise."""
        sr = 44100
        # Breath from 1.6s to 1.95s, Voiced singing starts cleanly at 2.0s to 5.0s
        vocal_events = [
            {"start": 1.6, "end": 1.95, "is_breath": True},
            {"start": 2.0, "end": 5.0, "freq": 320.0},
        ]
        audio = create_synthetic_signal(duration=7.0, vocal_events=vocal_events, sr=sr)

        # Raw LRC line starts early at 1.5s
        lines = [{"id": 0, "start_time": 1.5, "end_time": 5.2, "text": "Voiced phrase"}]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        assert len(refined) == 1
        snapped_start = refined[0]["start_time"]
        # Must snap to voiced onset at ~2.0s, NOT to breath noise at 1.6s
        assert abs(snapped_start - 2.0) <= 0.120

    def test_r3_line_snapping_across_massive_instrumental_interludes(self):
        """Verifies line release trimming preserves long instrumental gaps (>= 1.5s)."""
        sr = 44100
        # Verse 1 (3.0s - 6.0s), 14s instrumental break, Verse 2 (20.0s - 23.0s)
        vocal_events = [
            {"start": 3.0, "end": 6.0, "freq": 300.0},
            {"start": 20.0, "end": 23.0, "freq": 300.0},
        ]
        audio = create_synthetic_signal(duration=26.0, vocal_events=vocal_events, sr=sr)

        # Buggy raw LRC line 0 extends all the way to 12.0s (6s bleed into silence)
        lines = [
            {"id": 0, "start_time": 3.0, "end_time": 12.0, "text": "Before interlude"},
            {"id": 1, "start_time": 20.0, "end_time": 23.0, "text": "After interlude"},
        ]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        assert len(refined) == 2
        # Line 0 end must be trimmed to actual vocal release (~6.0s + 0.10s hangover = 6.1s)
        assert abs(refined[0]["end_time"] - 6.10) <= 0.120
        # Instrumental silence between line 0 and line 1 must be preserved (> 13s)
        assert refined[1]["start_time"] - refined[0]["end_time"] >= 13.0

    def test_r3_sustained_note_extension_into_instrumental_pause(self):
        """Verifies line end extends when singer sustains a note past raw LRC boundary."""
        sr = 44100
        # Singer sustains note from 2.0s to 5.5s
        vocal_events = [{"start": 2.0, "end": 5.5, "freq": 330.0}]
        audio = create_synthetic_signal(duration=8.0, vocal_events=vocal_events, sr=sr)

        # Raw LRC cut line short at 4.2s (clips note by 1.3s)
        lines = [{"id": 0, "start_time": 2.0, "end_time": 4.2, "text": "Sustained note"}]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        assert len(refined) == 1
        # Line end should trace forward and encompass the sustained note up to ~5.6s
        assert refined[0]["end_time"] >= 5.40

    def test_r3_degenerate_lines_inverted_and_zero_duration(self):
        """Stresses refine_line_boundaries with inverted, zero-length, and None timestamps."""
        sr = 44100
        audio = create_synthetic_signal(
            duration=6.0, vocal_events=[{"start": 1.0, "end": 4.0}], sr=sr
        )

        pathological_lines = [
            {"id": 0, "start_time": 3.0, "end_time": 1.0, "text": "Inverted"},
            {"id": 1, "start_time": 2.5, "end_time": 2.5, "text": "Zero length"},
            {"id": 2, "start_time": -4.0, "end_time": None, "text": "Negative and None"},
        ]

        refined = refine_line_boundaries(audio, sr, pathological_lines)
        assert len(refined) == 3
        prev_e = 0.0
        for l_item in refined:
            assert l_item["start_time"] >= prev_e
            assert l_item["end_time"] > l_item["start_time"]
            assert math.isfinite(l_item["start_time"])
            assert math.isfinite(l_item["end_time"])
            prev_e = l_item["end_time"]

    def test_r3_untimed_phrase_partitioning_pathological_m_vs_k(self):
        """Tests DP partitioning when M >> K (many lines, few phrases) and M << K (few lines, many phrases)."""
        aligner = AudioAligner()

        # 1. M (20 lines) >> K (2 phrases)
        lines_20 = [{"id": i, "text": f"Line {i} with several words"} for i in range(20)]
        phrases_2 = [(2.0, 10.0), (14.0, 22.0)]
        part_20 = aligner._partition_lines_into_phrases(lines_20, phrases_2, duration=25.0)
        assert len(part_20) == 20
        prev_e = 0.0
        for line_item in part_20:
            assert line_item["start_time"] >= prev_e
            assert line_item["end_time"] > line_item["start_time"]
            prev_e = line_item["end_time"]

        # 2. M (2 lines) << K (8 phrases) -> tests phrase merging
        lines_2 = [{"id": 0, "text": "First line"}, {"id": 1, "text": "Second line"}]
        phrases_8 = [(float(i * 3), float(i * 3 + 2)) for i in range(8)]
        part_2 = aligner._partition_lines_into_phrases(lines_2, phrases_8, duration=30.0)
        assert len(part_2) == 2
        assert part_2[0]["start_time"] < part_2[0]["end_time"]
        assert part_2[0]["end_time"] <= part_2[1]["start_time"]
        assert part_2[1]["end_time"] <= 30.0


# ==============================================================================
# Group 4: Requirement 4 (R4) Adversarial Sub-Line Word Synchronization
# ==============================================================================


class TestTier5R4AdversarialWordSync:
    """White-box adversarial tests for spectral flux, voiced harmonic gating, and syllable DP."""

    def test_r4_rapid_tempo_machine_gun_words_stress(self):
        """Stresses syllable DP with 16 rapid monosyllabic/bisyllabic words in a 1.2s window."""
        sr = 44100
        dur = 2.0
        # Synthesize 4 rapid harmonic bursts inside the 1.2s window
        vocal_events = [
            {"start": 0.35, "end": 0.55, "freq": 280.0},
            {"start": 0.60, "end": 0.85, "freq": 320.0},
            {"start": 0.90, "end": 1.15, "freq": 360.0},
            {"start": 1.20, "end": 1.45, "freq": 400.0},
        ]
        audio = create_synthetic_signal(duration=dur, vocal_events=vocal_events, sr=sr)
        words = [
            "quick",
            "fast",
            "speed",
            "tempo",
            "run",
            "dash",
            "sprint",
            "go",
            "now",
            "jump",
            "hop",
            "skip",
            "beat",
            "drop",
            "flow",
            "end",
        ]

        t0 = time.perf_counter()
        aligned = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=words,
            line_start=0.30,
            line_end=1.50,
        )
        t_elapsed = time.perf_counter() - t0
        assert t_elapsed < 0.08  # Under 80ms CPU execution

        assert len(aligned) == 16
        cur_t = 0.30
        for w in aligned:
            assert w["start_time"] >= cur_t
            assert w["end_time"] > w["start_time"]
            assert w["end_time"] <= 1.501
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])
            cur_t = w["end_time"]

    def test_r4_multilingual_unicode_and_punctuation_stress(self):
        """Stresses syllable counting, weighting, and alignment against multilingual text."""
        multilingual_words = [
            "Supercalifragilisticexpialidocious",
            "Празднование,",
            "東京都港区芝公園!",
            "Überraschung?!",
            "[Bridge]:",
            "---",
            "&^%$#",
        ]

        # Verify count_syllables and calculate_word_weight never crash
        for w in multilingual_words:
            syl = count_syllables(w)
            wt = calculate_word_weight(w)
            assert syl >= 1
            assert wt >= 0.5
            assert math.isfinite(wt)

        # Test alignment with multilingual words
        dummy_audio = np.random.RandomState(42).normal(0.0, 0.1, 44100).astype(np.float32)
        aligned = align_words_spectral(
            audio_segment=dummy_audio,
            sample_rate=44100,
            words=multilingual_words,
            line_start=1.0,
            line_end=4.0,
        )
        assert len(aligned) == len(multilingual_words)
        cur_t = 1.0
        for w in aligned:
            assert w["start_time"] >= cur_t
            assert w["end_time"] > w["start_time"]
            cur_t = w["end_time"]

    def test_r4_gating_rejects_mixed_breath_and_drum_bleed(self):
        """Verifies voiced harmonic gating rejects both breath noise and drum transient bleed."""
        sr = 44100
        # Timeline:
        # [0.0 - 0.25]: Heavy breath noise
        # [0.35 - 0.70]: True voiced vowel (word 1)
        # [0.80 - 0.90]: Loud drum transient bleed (impulse)
        # [1.00 - 1.40]: True voiced vowel (word 2)
        vocal_events = [
            {"start": 0.0, "end": 0.25, "is_breath": True},
            {"start": 0.35, "end": 0.70, "freq": 300.0},
            {"start": 0.80, "end": 0.90, "is_transient": True},
            {"start": 1.00, "end": 1.40, "freq": 350.0},
        ]
        audio = create_synthetic_signal(duration=1.6, vocal_events=vocal_events, sr=sr)
        words = ["First", "Second"]

        aligned = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=words,
            line_start=0.0,
            line_end=1.5,
        )
        assert len(aligned) == 2

        # Word 1 start must not snap into breath noise [0.0 - 0.25]
        assert aligned[0]["start_time"] >= 0.28
        # Word 2 start must not snap to drum bleed at 0.80s, but near voiced burst at ~1.00s
        assert aligned[1]["start_time"] >= 0.92

    def test_r4_sub_frame_and_single_sample_slices(self):
        """Verifies align_words_spectral graceful fallback on sub-frame audio clips (< 25ms)."""
        # 1. Audio with 5 samples (< 0.15ms)
        tiny_audio = np.array([0.1, 0.2, 0.3, 0.2, 0.1], dtype=np.float32)
        aligned = align_words_spectral(
            audio_segment=tiny_audio,
            sample_rate=44100,
            words=["One", "Two"],
            line_start=0.0,
            line_end=1.0,
        )
        assert len(aligned) == 2
        assert aligned[0]["start_time"] < aligned[0]["end_time"]
        assert aligned[0]["end_time"] <= aligned[1]["start_time"]

        # 2. Audio is None or empty array
        aligned_none = align_words_spectral(
            audio_segment=np.zeros(0, dtype=np.float32),
            sample_rate=44100,
            words=["Fallback"],
            line_start=2.0,
            line_end=3.0,
        )
        assert len(aligned_none) == 1
        assert aligned_none[0]["start_time"] == 2.0
        assert aligned_none[0]["end_time"] == 3.0

    def test_r4_high_and_low_sample_rate_resilience(self):
        """Stresses FFT framing and autocorrelation bounds on 96kHz and 8kHz audio."""
        for sr in [96000, 8000]:
            dur = 2.0
            vocal_events = [{"start": 0.5, "end": 1.5, "freq": 260.0}]
            audio = create_synthetic_signal(duration=dur, vocal_events=vocal_events, sr=sr)
            aligned = align_words_spectral(
                audio_segment=audio,
                sample_rate=sr,
                words=["Sample", "Rate", "Check"],
                line_start=0.4,
                line_end=1.6,
            )
            assert len(aligned) == 3
            cur_t = 0.4
            for w in aligned:
                assert w["start_time"] >= cur_t
                assert w["end_time"] > w["start_time"]
                cur_t = w["end_time"]


# ==============================================================================
# Group 5: Requirement 1-4 End-to-End Adversarial Chaining
# ==============================================================================


class TestTier5EndToEndChainAdversarial:
    """White-box tests chaining all stages: R1 retrieval -> R2 offset -> R3 snapping -> R4 word sync."""

    def test_tier5_e2e_full_chain_adversarial_workflow(self, tmp_path, monkeypatch):
        """
        Executes end-to-end chaining:
        1. Query normalization with noisy collaborative title + remaster tags.
        2. LRCLIB query ladder progressing through 404s and stubs to find complete synced lyrics.
        3. AudioAligner processing vocals.wav with +3.5s intro shift and instrumental interludes.
        4. Global offset correction, line onset/offset snapping, and spectral word synchronization.
        5. Invariant validation against LyricLineSchema and WordTimingSchema.
        """
        raw_title = "Under Pressure (2011 Remaster) [Official Music Video]"
        raw_artist = "Queen & David Bowie - Topic"

        # 1. Normalization
        clean_title, clean_artist = extract_canonical(raw_title, raw_artist)
        assert clean_title == "Under Pressure"
        assert "Queen" in clean_artist

        ladder = generate_query_ladder(raw_title, raw_artist, duration=240.0)
        assert len(ladder) >= 5

        # 2. Mock LRCLIB API ladder resolution
        # Simulate: Stage 1 (exact with duration) -> 404
        #           Stage 2 (exact without duration) -> returns stub (< 4 lines)
        #           Stage 3 (search clean) -> returns candidate with full synced lyrics (10 lines)
        full_lrc = (
            "[00:01.00] Pressure pushing down on me\n"
            "[00:04.50] Pressing down on you no man ask for\n"
            "[00:08.50] Under pressure that burns a building down\n"
            "[00:12.00] Splits a family in two\n"
            "[00:15.50] Puts people on streets\n"
            "[00:19.00] It is the terror of knowing\n"
            "[00:22.50] What this world is about\n"
            "[00:26.00] Watching some good friends\n"
            "[00:29.50] Screaming let me out\n"
            "[00:33.00] Tomorrow gets me higher"
        )

        def mock_lrclib_get(url, params=None, timeout=5):
            mock = MagicMock()
            if "/get" in url:
                mock.status_code = 404
                mock.json.return_value = {"message": "Not found"}
            elif "/search" in url:
                mock.status_code = 200
                mock.json.return_value = [
                    {
                        "id": 1001,
                        "trackName": "Under Pressure",
                        "artistName": "Queen",
                        "duration": 240.0,
                        "syncedLyrics": full_lrc,
                        "plainLyrics": full_lrc,
                    }
                ]
            return mock

        monkeypatch.setattr("backend.services.lyrics.requests.get", mock_lrclib_get)

        svc = LyricsService()
        fetch_res = svc.fetch_lyrics(raw_title, raw_artist, duration=240.0)
        assert fetch_res["synced"] is True
        assert len(fetch_res["lines"]) == 10

        # 3. Synthesize isolated vocal track:
        # Ground truth: Video intro shifted by +3.50s.
        # Synthesize 3 active vocal phrases with 2 instrumental pauses (2.5s and 3.0s).
        sr = 44100
        # Line 0 shifted: [00:01.00 + 3.5s] = [4.5s, 7.5s]
        # Line 1 shifted: [00:04.50 + 3.5s] = [8.0s, 11.0s]
        # Line 2 shifted: [00:08.50 + 3.5s] = [12.0s, 15.0s]
        vocal_events = [
            {"start": 4.5, "end": 7.5, "freq": 300.0},
            {"start": 8.0, "end": 11.0, "freq": 320.0},
            {"start": 12.0, "end": 15.0, "freq": 340.0},
        ]
        # Plus add some drum transient bleed during silence at 17.0s
        vocal_events.append({"start": 17.0, "end": 17.2, "is_transient": True})

        audio_mono = create_synthetic_signal(duration=25.0, vocal_events=vocal_events, sr=sr)
        # Stereo audio with slightly asymmetric channel gain
        audio_stereo = np.column_stack((audio_mono * 0.95, audio_mono * 1.05))
        vocals_path = str(tmp_path / "vocals.wav")
        sf.write(vocals_path, audio_stereo, sr)

        # 4. AudioAligner processing with auto_offset and line boundary refinement
        aligner = AudioAligner()
        # Take first 3 fetched lines to align against our 3 vocal events
        test_lines = fetch_res["lines"][:3]

        aligned_lines = aligner.align_lyrics(
            vocals_path=vocals_path,
            lines=test_lines,
            auto_offset_correction=True,
            refine_line_boundaries=True,
        )

        assert len(aligned_lines) == 3

        # 5. Verify offset was applied: line 0 start was 1.0s, shifted by ~3.5s -> ~4.5s
        assert abs(aligned_lines[0]["start_time"] - 4.50) <= 0.150

        # 6. Validate strict monotonicity and Pydantic schema compliance
        prev_line_end = 0.0
        for l_item in aligned_lines:
            # Validate against Pydantic LyricLineSchema
            validated_line = LyricLineSchema(**l_item)
            assert validated_line.start_time >= prev_line_end
            assert validated_line.end_time > validated_line.start_time
            prev_line_end = validated_line.end_time

            # Validate sub-line words
            prev_w_end = validated_line.start_time
            for w in validated_line.words:
                assert w.start_time >= prev_w_end
                assert w.end_time > w.start_time
                assert w.end_time <= validated_line.end_time + 0.05
                assert math.isfinite(w.start_time)
                assert math.isfinite(w.end_time)
                prev_w_end = w.end_time

    def test_tier5_e2e_custom_malformed_lrc_realignment(self, tmp_path):
        """Verifies process_custom_lyrics -> align_lyrics handles malformed LRC re-imports."""
        malformed_lrc = """
[ti:Custom Bad LRC]
[offset:+200]
[00:03.00] First imported line
[00:01.00] Out of order line with <00:01.50>word1 <00:02.00>word2
[00:06.00] Third line
"""
        svc = LyricsService()
        parsed = svc.process_custom_lyrics(malformed_lrc)
        assert parsed["synced"] is True
        assert len(parsed["lines"]) == 3

        # Create audio fixture with 3 matching vocal phrases
        sr = 44100
        events = [
            {"start": 1.2, "end": 2.5, "freq": 280.0},
            {"start": 3.2, "end": 5.0, "freq": 310.0},
            {"start": 6.2, "end": 8.0, "freq": 340.0},
        ]
        audio = create_synthetic_signal(duration=10.0, vocal_events=events, sr=sr)
        vocals_path = str(tmp_path / "custom_vocals.wav")
        sf.write(vocals_path, audio, sr)

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(vocals_path, parsed["lines"])
        assert len(aligned) == 3

        prev_e = 0.0
        for line in aligned:
            assert line["start_time"] >= prev_e
            assert line["end_time"] > line["start_time"]
            prev_e = line["end_time"]
            for w in line.get("words", []):
                WordTimingSchema(**w)

    def test_tier5_adversarial_cpu_and_memory_efficiency(self, tmp_path):
        """Verifies full 3.5-minute track alignment with 50 lines completes in < 1.5s on CPU."""
        sr = 44100
        total_dur = 210.0  # 3.5 minutes
        # Synthesize vocal track with 50 lines (3.0s active, 1.2s pause)
        events = []
        lines = []
        cur_t = 2.0
        for i in range(50):
            events.append({"start": cur_t, "end": cur_t + 2.8, "freq": 300.0 + (i % 5) * 20.0})
            lines.append(
                {
                    "id": i,
                    "text": f"Line {i} featuring multiple rhythmic vocalized syllables to align",
                    "start_time": cur_t,
                    "end_time": cur_t + 2.8,
                }
            )
            cur_t += 4.0

        audio = create_synthetic_signal(duration=total_dur, vocal_events=events, sr=sr)
        vocals_path = str(tmp_path / "long_track.wav")
        sf.write(vocals_path, audio, sr)

        aligner = AudioAligner()
        t_start = time.perf_counter()
        aligned = aligner.align_lyrics(
            vocals_path=vocals_path,
            lines=lines,
            auto_offset_correction=True,
            refine_line_boundaries=True,
        )
        t_elapsed = time.perf_counter() - t_start

        assert len(aligned) == 50
        # Check strict CPU execution budget: must be well under 2.0s
        assert t_elapsed < 1.50, f"Alignment took {t_elapsed:.3f}s (budget: < 1.5s)"
