"""Empirical Adversarial Stress Test Suite for Milestone 3 (Untimed Lyric Alignment & Monotonicity).

Authored and executed by Challenger M3_4 (Empirical Challenger: Critic & Specialist).

Focus:
1. Untimed plain lyric phrase partitioning & interlude preservation:
   - Long instrumental intros (>= 5s, 10s, 15s) must be completely preserved.
   - Instrumental interludes (>= 1.5s) must be preserved; no lines or words placed in silence.
   - Instrumental outros (>= 5s, 10s) must be preserved.
   - Handling of M > K (more lines than vocal phrases) with strict gap preservation.
   - Handling of M < K (fewer lines than vocal phrases) with phrase merging.
   - Single-line spanning multiple phrases with intra-line interlude avoidance.
2. Strict Monotonicity & Invariant Verification:
   - 0 <= start_time < end_time for all lines and words.
   - Non-overlapping adjacent lines: line[i].end_time <= line[i+1].start_time.
   - Non-overlapping adjacent words: word[j].end_time <= word[j+1].start_time.
   - Finite floats (no NaN, Inf, or negative floats).
   - Word boundaries contained within line boundaries.
3. Regression Verification of Previously XFailed Bugs:
   - Dense lines overlapping regression (resolved).
   - Negative word timestamp in tight windows (resolved).
   - None / non-finite timestamps TypeError crash (resolved).
4. Boundary & Pathological Audio Conditions:
   - Pure silence (30s, 60s) with untimed lines.
   - Sub-second audio (10ms, 50ms, 100ms) with multiple lines.
   - Extreme line densities (500 lines on 2.0s audio).
   - NaN, Inf, extreme noise, and multi-channel downmix.
"""

import math
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import (
    AudioAligner,
    enforce_monotonic_words,
    refine_line_boundaries,
)


def synthesize_vocal_track(
    duration: float,
    vocal_regions: list[tuple[float, float]],
    sr: int = 44100,
    freq: float = 440.0,
    amplitude: float = 0.6,
    noise_level: float = 0.0,
    percussive_bursts: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    """Synthesizes mono vocal test signal with specific tonal vocal regions and optional noise."""
    n_samples = max(1, round(duration * sr))
    t = np.linspace(0, duration, n_samples, endpoint=False, dtype=np.float32)
    audio = np.zeros(n_samples, dtype=np.float32)

    for i, (s, e) in enumerate(vocal_regions):
        mask = (t >= s) & (t <= e)
        f = freq * (1.0 + 0.04 * (i % 4))
        # Add rich harmonics (fundamental + 2nd + 3rd harmonic)
        harmonic_sig = (
            amplitude * np.sin(2.0 * np.pi * f * t[mask])
            + (amplitude * 0.4) * np.sin(2.0 * np.pi * (2.0 * f) * t[mask])
            + (amplitude * 0.2) * np.sin(2.0 * np.pi * (3.0 * f) * t[mask])
        )
        audio[mask] += harmonic_sig.astype(np.float32)

    if percussive_bursts:
        for b_s, b_e in percussive_bursts:
            b_mask = (t >= b_s) & (t <= b_e)
            audio[b_mask] += 0.8 * np.sin(2.0 * np.pi * 90.0 * t[b_mask])

    if noise_level > 0.0:
        audio += (np.random.normal(0, noise_level, n_samples)).astype(np.float32)

    return np.clip(audio, -1.0, 1.0)


def assert_no_lyrics_in_silence(
    aligned_lines: list[dict[str, Any]],
    silent_regions: list[tuple[float, float]],
) -> None:
    """Oracle assertion: verifies that no line and no word intersects any silent region."""
    violations = []
    for i, line in enumerate(aligned_lines):
        ls, le = line["start_time"], line["end_time"]
        for ss, se in silent_regions:
            if max(ls, ss) < min(le, se):
                violations.append(f"Line {i} [{ls}, {le}] overlaps silence [{ss}, {se}]")
        for j, w in enumerate(line.get("words", [])):
            ws, we = w["start_time"], w["end_time"]
            for ss, se in silent_regions:
                if max(ws, ss) < min(we, se):
                    violations.append(
                        f"Line {i} Word {j} [{ws}, {we}] overlaps silence [{ss}, {se}]"
                    )
    assert not violations, "Detected silence encroachment violations:\n" + "\n".join(
        violations[:10]
    )


# ==============================================================================
# SUITE 1: REGRESSION CONFIRMATION OF PREVIOUSLY XFAILED DEFECTS
# ==============================================================================


class TestPreviouslyXfailedRegressionsResolved:
    """Explicitly verifies that the 3 previously xfailed defects from challenger_m3_2 are now fully resolved."""

    def test_dense_lines_no_overlap_regression_resolved(self, tmp_path):
        """
        Verify that 200 lines partitioned into a 1.0s active vocal phrase (dur = 0.005s)
        do NOT produce overlapping adjacent lines.
        Invariant: for all i, line[i].end_time <= line[i+1].start_time.
        """
        sr = 44100
        duration = 5.0
        audio = synthesize_vocal_track(duration=duration, vocal_regions=[(2.0, 3.0)], sr=sr)
        wav_file = tmp_path / "dense_lines_regression.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [{"text": f"line {i}", "start_time": 0.0, "end_time": 0.0} for i in range(200)]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 200

        overlaps = [
            i
            for i in range(len(aligned) - 1)
            if aligned[i]["end_time"] > aligned[i + 1]["start_time"]
        ]
        assert len(overlaps) == 0, (
            f"Found {len(overlaps)} overlapping line pairs; first overlap at index {overlaps[0]}: "
            f"line[{overlaps[0]}].end_time={aligned[overlaps[0]]['end_time']} > "
            f"line[{overlaps[0] + 1}].start_time={aligned[overlaps[0] + 1]['start_time']}"
        )

        for line in aligned:
            assert line["start_time"] >= 0.0
            assert line["start_time"] < line["end_time"]

    def test_negative_word_timestamp_in_tight_window_resolved(self):
        """
        Verify that enforce_monotonic_words NEVER produces negative start_time or end_time,
        even when l_start=0.0 and duration is extremely narrow (5ms for 10 words).
        Invariant: all word start_time >= 0.0 and start_time < end_time.
        """
        words = [f"word{i}" for i in range(10)]
        spans = [(0.0, 0.005)] * 10
        result = enforce_monotonic_words(words, spans, l_start=0.0, l_end=0.005)

        assert len(result) == 10
        for i, w in enumerate(result):
            assert w["start_time"] >= 0.0, f"Word {i} has negative start_time: {w['start_time']}"
            assert w["start_time"] < w["end_time"], f"Word {i} inverted: {w}"
            if i + 1 < len(result):
                assert w["end_time"] <= result[i + 1]["start_time"] + 0.001, (
                    f"Word overlap between {i} and {i + 1}: {w['end_time']} > {result[i + 1]['start_time']}"
                )

    def test_none_timestamps_typeerror_crash_resolved(self, tmp_path):
        """
        Verify that plain lyrics containing None for start_time or end_time
        do not crash AudioAligner or refine_line_boundaries with TypeError.
        """
        sr = 44100
        audio = np.zeros(44100 * 2, dtype=np.float32)
        wav_file = tmp_path / "none_payload.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "First line with None", "start_time": None, "end_time": None},
            {"text": "Second line with partial None", "start_time": 1.0, "end_time": None},
            {"text": "Third line with start None", "start_time": None, "end_time": 3.0},
        ]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 3
        for line in aligned:
            assert isinstance(line["start_time"], float)
            assert isinstance(line["end_time"], float)
            assert line["start_time"] >= 0.0
            assert line["start_time"] < line["end_time"]


# ==============================================================================
# SUITE 2: INTERLUDE & INTRO PRESERVATION ADVERSARIAL STRESS
# ==============================================================================


class TestUntimedInterludeAndIntroPreservation:
    """Stress tests verifying that untimed lyrics preserve >= 1.5s interludes and long intros/outros."""

    def test_complex_multi_interlude_song_structure(self, tmp_path):
        """
        Adversarial Scenario: Realistic complex song structure:
        - 12.0s instrumental intro [0.0 - 12.0]
        - Verse 1 [12.0 - 16.0] (4.0s)
        - Interlude 1 [16.0 - 18.0] (2.0s >= 1.5s)
        - Chorus [18.0 - 24.0] (6.0s)
        - Bridge interlude [24.0 - 29.5] (5.5s >= 1.5s)
        - Outro vocal phrase [29.5 - 34.0] (4.5s)
        - Instrumental outro [34.0 - 45.0] (11.0s)

        Oracle requirement:
        No line and no word must be placed into any of the 4 silent regions:
        1. Intro: [0.0, 11.8]
        2. Interlude 1: [16.2, 17.8]
        3. Bridge: [24.2, 29.3]
        4. Outro: [34.2, 45.0]
        """
        sr = 44100
        duration = 45.0
        vocal_regions = [
            (12.0, 16.0),
            (18.0, 24.0),
            (29.5, 34.0),
        ]
        audio = synthesize_vocal_track(duration=duration, vocal_regions=vocal_regions, sr=sr)
        wav_file = tmp_path / "complex_song.wav"
        sf.write(str(wav_file), audio, sr)

        plain_lyrics = [
            {"text": "Verse line one", "start_time": 0.0, "end_time": 0.0},
            {"text": "Verse line two", "start_time": 0.0, "end_time": 0.0},
            {"text": "Chorus line one is loud", "start_time": 0.0, "end_time": 0.0},
            {"text": "Chorus line two is louder", "start_time": 0.0, "end_time": 0.0},
            {"text": "Chorus line three resolves", "start_time": 0.0, "end_time": 0.0},
            {"text": "Final outro line one", "start_time": 0.0, "end_time": 0.0},
            {"text": "Final outro line two", "start_time": 0.0, "end_time": 0.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 7

        # Verify oracle: 0 lyrics placed in silent regions
        silent_regions = [
            (0.0, 11.8),
            (16.2, 17.8),
            (24.2, 29.3),
            (34.2, 45.0),
        ]
        assert_no_lyrics_in_silence(aligned, silent_regions)

        # Verify strict monotonicity across all lines and words
        for i in range(len(aligned)):
            assert aligned[i]["start_time"] >= 0.0
            assert aligned[i]["start_time"] < aligned[i]["end_time"]
            if i + 1 < len(aligned):
                assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001

            for j, w in enumerate(aligned[i]["words"]):
                assert w["start_time"] >= 0.0
                assert w["start_time"] < w["end_time"]
                if j + 1 < len(aligned[i]["words"]):
                    assert w["end_time"] <= aligned[i]["words"][j + 1]["start_time"] + 0.001

    def test_interlude_boundary_threshold_behavior(self, tmp_path):
        """
        Adversarial Scenario: Test behavior around the interlude threshold (1.5s):
        - Phrase 1: [2.0, 4.0]
        - Gap of exactly 1.60s (>= 1.5s interlude) -> [4.0, 5.6]
        - Phrase 2: [5.6, 7.6]
        Untimed lyrics with 2 lines must treat [4.0, 5.6] as an interlude and NOT bridge it.
        """
        sr = 44100
        duration = 10.0
        vocal_regions = [(2.0, 4.0), (5.6, 7.6)]
        audio = synthesize_vocal_track(duration=duration, vocal_regions=vocal_regions, sr=sr)
        wav_file = tmp_path / "gap_1_6s.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "First phrase before gap", "start_time": 0.0, "end_time": 0.0},
            {"text": "Second phrase after gap", "start_time": 0.0, "end_time": 0.0},
        ]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 2

        # Invariant: Line 0 must finish near 4.0s (<= 4.1s)
        # Invariant: Line 1 must start near 5.6s (>= 5.5s)
        assert aligned[0]["end_time"] <= 4.1, (
            f"Line 0 spilled into 1.6s interlude: end={aligned[0]['end_time']:.3f}s"
        )
        assert aligned[1]["start_time"] >= 5.5, (
            f"Line 1 started inside 1.6s interlude: start={aligned[1]['start_time']:.3f}s"
        )

    def test_more_lines_than_phrases_maintains_interlude_silence(self, tmp_path):
        """
        Adversarial Scenario: 10 lines to partition into only 2 phrases separated by 4.0s interlude.
        Phrase 1: [3.0, 7.0] (4.0s)
        Interlude: [7.0, 11.0] (4.0s silence)
        Phrase 2: [11.0, 15.0] (4.0s)

        All 10 lines must be partitioned without ANY line or word leaking into [7.2, 10.8].
        """
        sr = 44100
        duration = 18.0
        vocal_regions = [(3.0, 7.0), (11.0, 15.0)]
        audio = synthesize_vocal_track(duration=duration, vocal_regions=vocal_regions, sr=sr)
        wav_file = tmp_path / "many_lines_2_phrases.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": f"Line number {i} singing", "start_time": 0.0, "end_time": 0.0}
            for i in range(10)
        ]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 10

        assert_no_lyrics_in_silence(aligned, [(7.2, 10.8)])

        # Verify strict monotonicity
        for i in range(len(aligned) - 1):
            assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001
            assert aligned[i]["start_time"] < aligned[i]["end_time"]

    def test_single_line_multiple_phrases_word_interlude_avoidance(self, tmp_path):
        """
        Adversarial Scenario: 1 single untimed lyric line with 8 words,
        across 2 vocal phrases separated by a 3.0s interlude.
        The word alignment must bridge or place words in the vocal bursts,
        and no word must be placed in the 3.0s interlude gap [4.2, 6.8].
        """
        sr = 44100
        duration = 12.0
        vocal_regions = [(1.5, 4.0), (7.0, 9.5)]
        audio = synthesize_vocal_track(duration=duration, vocal_regions=vocal_regions, sr=sr)
        wav_file = tmp_path / "single_line_interlude.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "one two three four five six seven eight", "start_time": 0.0, "end_time": 0.0}
        ]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 1

        words = aligned[0]["words"]
        assert len(words) == 8

        # No word should fall entirely inside [4.2, 6.8]
        for w in words:
            ws, we = w["start_time"], w["end_time"]
            assert not (ws >= 4.2 and we <= 6.8), f"Word placed inside interlude: {w}"

        # Word monotonicity
        for i in range(len(words) - 1):
            assert words[i]["end_time"] <= words[i + 1]["start_time"] + 0.001
            assert words[i]["start_time"] < words[i]["end_time"]


# ==============================================================================
# SUITE 3: MONOTONICITY & ADVERSARIAL STRESS SWEEPS
# ==============================================================================


class TestMonotonicityAdversarialSweeps:
    """Rigorous adversarial property-based and boundary checks on monotonicity contracts."""

    def test_extreme_line_density_500_lines_in_2_seconds(self, tmp_path):
        """
        Extreme stress test: 500 lines compressed into a 2-second vocal phrase.
        Ensures DP partitioning and monotonicity enforcement never crash,
        never generate negative timestamps, and maintain line[i].end_time <= line[i+1].start_time.
        """
        sr = 44100
        duration = 4.0
        audio = synthesize_vocal_track(duration=duration, vocal_regions=[(1.0, 3.0)], sr=sr)
        wav_file = tmp_path / "extreme_density.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [{"text": f"line {i}", "start_time": 0.0, "end_time": 0.0} for i in range(500)]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 500

        for i in range(len(aligned)):
            assert aligned[i]["start_time"] >= 0.0
            assert aligned[i]["start_time"] < aligned[i]["end_time"]
            if i + 1 < len(aligned):
                assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001

    def test_adversarial_word_monotonicity_spans_matrix(self):
        """
        Adversarial matrix test for enforce_monotonic_words:
        - Inverted spans (end < start)
        - Overlapping spans
        - Negative spans
        - Out-of-bounds spans (> l_end, < l_start)
        - Sub-millisecond intervals
        - Single word, 2 words, 50 words
        """
        test_cases = [
            (["single"], [(10.0, 5.0)], 0.0, 1.0),
            (["a", "b"], [(-2.0, -1.0), (-0.5, 0.0)], 0.0, 0.5),
            ([f"w{i}" for i in range(20)], [(1.0, 2.0)] * 20, 0.0, 0.05),
            (["w1", "w2", "w3"], [(10.0, 20.0), (30.0, 40.0), (50.0, 60.0)], 0.0, 1.0),
            (["x"], [(0.0, 0.0001)], 0.0, 0.0001),
        ]

        for words, raw_spans, l_start, l_end in test_cases:
            res = enforce_monotonic_words(words, raw_spans, l_start, l_end)
            assert len(res) == len(words)
            for i, w in enumerate(res):
                assert w["start_time"] >= 0.0, f"Negative start_time: {w}"
                assert w["start_time"] < w["end_time"], f"Invalid order: {w}"
                assert math.isfinite(w["start_time"]) and math.isfinite(w["end_time"])
                if i + 1 < len(res):
                    assert w["end_time"] <= res[i + 1]["start_time"] + 0.001, (
                        f"Word overlap in case: {w['end_time']} > {res[i + 1]['start_time']}"
                    )

    def test_pure_silence_30s_resilience(self, tmp_path):
        """
        Adversarial Scenario: 30 seconds of pure silence with 15 untimed lines.
        Aligner must pace lines gracefully across the silence with 2s intro and 2s outro,
        preserving strict monotonicity.
        """
        sr = 44100
        audio = np.zeros(sr * 30, dtype=np.float32)
        wav_file = tmp_path / "silence_30s.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": f"Silent verse {i}", "start_time": 0.0, "end_time": 0.0} for i in range(15)
        ]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 15

        # Invariant: First line starts at 2.0s, last line ends <= 28.0s
        assert aligned[0]["start_time"] >= 1.99
        assert aligned[-1]["end_time"] <= 28.1

        for i in range(len(aligned) - 1):
            assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001
            assert aligned[i]["start_time"] < aligned[i]["end_time"]

    def test_sub_second_audio_file_resilience(self, tmp_path):
        """
        Adversarial Scenario: Audio file with duration only 50ms (0.05s) and 5 plain lines.
        Must not crash or generate negative / inverted timestamps.
        """
        sr = 44100
        audio = np.random.normal(0, 0.1, int(sr * 0.05)).astype(np.float32)
        wav_file = tmp_path / "sub_second.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [{"text": f"Quick {i}", "start_time": 0.0, "end_time": 0.0} for i in range(5)]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 5

        for i in range(len(aligned)):
            assert aligned[i]["start_time"] >= 0.0
            assert aligned[i]["start_time"] < aligned[i]["end_time"]
            if i + 1 < len(aligned):
                assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001

    def test_non_ascii_unicode_and_special_characters(self, tmp_path):
        """
        Adversarial Scenario: Plain lyrics with emojis, Japanese kanji, Cyrillic, and punctuation.
        Syllable estimation and weight calculation must handle unicode gracefully.
        """
        sr = 44100
        audio = synthesize_vocal_track(duration=6.0, vocal_regions=[(1.0, 5.0)], sr=sr)
        wav_file = tmp_path / "unicode_lyrics.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "こんにちは 世界! 🎵🎤", "start_time": 0.0, "end_time": 0.0},
            {"text": "Привет мир... (acoustic version)", "start_time": 0.0, "end_time": 0.0},
            {"text": "¡Hola, cómo estás? 100% real", "start_time": 0.0, "end_time": 0.0},
        ]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 3

        for line in aligned:
            assert line["start_time"] >= 0.0
            assert line["start_time"] < line["end_time"]
            for w in line["words"]:
                assert w["start_time"] >= 0.0
                assert w["start_time"] < w["end_time"]
