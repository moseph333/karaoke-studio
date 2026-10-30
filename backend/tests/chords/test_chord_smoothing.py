"""Empirical Adversarial Stress Test Suite for Milestone 1 Iteration 2.

Author: Challenger 1 (DSP & Transposition Adversarial Verifier)
Scope:
1. `smooth_segments` flicker pruning: verify that no sequence of raw segments
   (alternating flickers, all flickers, empty segments, boundary flickers)
   can cause an IndexError.
2. Monotonic interval induction: verify that output intervals strictly obey
   0 <= start_0 < end_0 <= start_1 < end_1 ... on all synthetic and adversarial audio.
3. Unicode slash chord transposition: test C/F♯, Am/B♭, F/C♯, etc., across
   all -12 to +12 semitones.
4. Modal key spellings: test Mixolydian, Dorian, Phrygian, Lydian, Locrian across all roots.
5. Synthesize additional DSP corner cases: ultra-short audio, DC bias, HDR bursts, 96kHz/192kHz.
"""

from __future__ import annotations

import random
from typing import Any

import numpy as np
import pytest

from backend.schemas import ChordsUpdateRequest
from backend.services.chord_detector import (
    NOTE_TO_PITCH_CLASS,
    ChordDetector,
    classify_key_spelling,
    parse_chord_symbol,
    transpose_chord,
    transpose_chord_progression,
)

# ==============================================================================
# Helper Verification Functions
# ==============================================================================


def assert_strictly_monotonic_intervals(
    segments: list[dict[str, Any]], total_duration: float | None = None, is_filtered: bool = False
) -> None:
    """Verifies that intervals strictly obey schema and monotonic sequencing rules."""
    if not segments:
        return

    # Check Pydantic validation on the full list
    req = ChordsUpdateRequest(chords=segments)
    assert len(req.chords) == len(segments)

    for i, s in enumerate(segments):
        start = s["start"]
        end = s["end"]
        # Basic interval validity
        assert start >= 0.0, f"Segment {i} start is negative: {start}"
        assert start < end, f"Segment {i} violates start < end: [{start}, {end}]"

        # Ordering between segments
        if i > 0:
            prev_end = segments[i - 1]["end"]
            assert start >= prev_end, (
                f"Segment {i} overlaps previous segment: prev_end={prev_end}, start={start}"
            )

    if not is_filtered and total_duration is not None and len(segments) > 0:
        assert segments[0]["start"] == 0.0, f"Initial start {segments[0]['start']} != 0.0"
        expected_end = round(total_duration, 3)
        if expected_end > 0.0:
            # End should be at least expected_end (or clamped slightly above if tiny)
            assert segments[-1]["end"] >= expected_end, (
                f"Terminal end {segments[-1]['end']} < expected {expected_end}"
            )


# ==============================================================================
# 1. Flicker Pruning & smooth_segments Stress Testing
# ==============================================================================


class TestSmoothSegmentsFlickerPruningAdversarial:
    """Adversarial stress-testing of smooth_segments against IndexError and degradation."""

    @pytest.fixture
    def detector(self) -> ChordDetector:
        return ChordDetector()

    def test_empty_labels_returns_empty_chord_list(self, detector: ChordDetector):
        res = detector.smooth_segments([], [], [], 0.0)
        assert len(res) == 0
        assert res.get("chords") == []

    def test_single_flicker_boundary_clamping(self, detector: ChordDetector):
        res = detector.smooth_segments(["C"], [0.85], [(0.0, 0.05)], 0.05, min_duration=0.30)
        assert len(res) == 1
        assert res[0]["start"] == 0.0
        assert res[0]["end"] >= 0.01
        assert res[0]["chord"] == "C"

    def test_two_flickers_below_min_duration(self, detector: ChordDetector):
        # Two consecutive flickers (0.05s each, total 0.10s < 0.30s)
        labels = ["C", "G"]
        confs = [0.8, 0.7]
        frame_times = [(0.0, 0.05), (0.05, 0.10)]
        res = detector.smooth_segments(labels, confs, frame_times, 0.10, min_duration=0.30)
        assert len(res) == 1
        assert_strictly_monotonic_intervals(res, 0.10)

    def test_alternating_flicker_sequences_do_not_index_error(self, detector: ChordDetector):
        # Alternating flickers of length 20
        n = 20
        labels = ["C", "G"] * 10
        confs = [0.9] * n
        frame_times = [(round(i * 0.05, 3), round((i + 1) * 0.05, 3)) for i in range(n)]
        res = detector.smooth_segments(labels, confs, frame_times, 1.0, min_duration=0.30)
        assert len(res) >= 1
        assert_strictly_monotonic_intervals(res, 1.0)

    def test_all_flickers_massive_chain_collapses_cleanly(self, detector: ChordDetector):
        # 100 consecutive flickers of 0.01s each
        n = 100
        labels = [f"chord_{i % 5}" for i in range(n)]
        confs = [0.5] * n
        frame_times = [(round(i * 0.01, 3), round((i + 1) * 0.01, 3)) for i in range(n)]
        res = detector.smooth_segments(labels, confs, frame_times, 1.0, min_duration=0.30)
        assert len(res) >= 1
        assert_strictly_monotonic_intervals(res, 1.0)

    def test_flicker_at_start_boundary(self, detector: ChordDetector):
        hop = 2048 / 22050
        labels = ["C"] * 2 + ["Am"] * 15
        confs = [0.9] * len(labels)
        frame_times = [(i * hop, (i + 1) * hop) for i in range(len(labels))]
        tot_dur = len(labels) * hop
        res = detector.smooth_segments(labels, confs, frame_times, tot_dur, min_duration=0.30)
        assert len(res) == 1
        assert res[0]["chord"] == "Am"
        assert res[0]["start"] == 0.0
        assert_strictly_monotonic_intervals(res, tot_dur)

    def test_flicker_at_end_boundary(self, detector: ChordDetector):
        hop = 2048 / 22050
        labels = ["Am"] * 15 + ["F"] * 2
        confs = [0.9] * len(labels)
        frame_times = [(i * hop, (i + 1) * hop) for i in range(len(labels))]
        tot_dur = len(labels) * hop
        res = detector.smooth_segments(labels, confs, frame_times, tot_dur, min_duration=0.30)
        assert len(res) == 1
        assert res[-1]["chord"] == "Am"
        assert_strictly_monotonic_intervals(res, tot_dur)

    def test_flicker_at_both_boundaries(self, detector: ChordDetector):
        hop = 2048 / 22050
        labels = ["C"] * 2 + ["Am"] * 15 + ["F"] * 2
        confs = [0.9] * len(labels)
        frame_times = [(i * hop, (i + 1) * hop) for i in range(len(labels))]
        tot_dur = len(labels) * hop
        res = detector.smooth_segments(labels, confs, frame_times, tot_dur, min_duration=0.30)
        assert len(res) == 1
        assert res[0]["chord"] == "Am"
        assert res[0]["start"] == 0.0
        assert_strictly_monotonic_intervals(res, tot_dur)

    def test_sandwiched_identical_chord_flicker_merging(self, detector: ChordDetector):
        # A flicker of G between two C segments should bridge them into a single C segment
        hop = 2048 / 22050
        labels = ["C"] * 10 + ["G"] * 2 + ["C"] * 9
        confs = [0.9] * len(labels)
        frame_times = [(i * hop, (i + 1) * hop) for i in range(len(labels))]
        tot_dur = len(labels) * hop
        res = detector.smooth_segments(labels, confs, frame_times, tot_dur, min_duration=0.30)
        assert len(res) == 1
        assert res[0]["chord"] == "C"
        assert res[0]["start"] == 0.0
        assert_strictly_monotonic_intervals(res, tot_dur)

    def test_stochastic_fuzzing_smooth_segments(self, detector: ChordDetector):
        # 1,000 randomized fuzz trials with arbitrary lengths, durations, and chords
        pool = ["C", "G", "Am", "F", "Dm", "Em", "N", "G7", "Cmaj7", "Dm7"]
        rng = random.Random(1337)

        for _ in range(1000):
            k = rng.randint(1, 35)
            lbls = [rng.choice(pool) for _ in range(k)]
            cfs = [rng.uniform(0.1, 1.0) for _ in range(k)]
            cur = 0.0
            fts = []
            for _ in range(k):
                d = rng.uniform(0.01, 0.45)
                fts.append((round(cur, 3), round(cur + d, 3)))
                cur += d
            tot_dur = round(cur, 3)
            min_dur = rng.uniform(0.1, 0.5)
            filt = rng.choice([True, False])

            out = detector.smooth_segments(
                lbls, cfs, fts, tot_dur, min_duration=min_dur, filter_no_chord=filt
            )
            assert_strictly_monotonic_intervals(out, tot_dur, is_filtered=filt)


# ==============================================================================
# 2. Monotonic Interval Induction Stress Testing
# ==============================================================================


class TestMonotonicIntervalInductionAdversarial:
    """Stress tests interval monotonicity across adversarial signals and time boundaries."""

    @pytest.fixture
    def detector(self) -> ChordDetector:
        return ChordDetector()

    def test_boundary_audio_sample_lengths(self, detector: ChordDetector):
        # Test boundary sample counts around nperseg (4096)
        sr = 22050
        sample_counts = [0, 1, 10, 500, 2048, 4095, 4096, 4097, 8192, 12345]
        for count in sample_counts:
            audio = (0.3 * np.sin(2 * np.pi * 440 * np.arange(count) / sr)).astype(np.float32)
            res = detector.detect_chords(audio, sr=sr)
            if count < 4096:
                assert len(res) == 0
            else:
                dur = count / sr
                assert_strictly_monotonic_intervals(res, dur)

    def test_monotonic_intervals_with_microsecond_steps(self, detector: ChordDetector):
        # Frame times spaced by 0.001s
        labels = ["C", "Am", "F", "G"] * 5
        confs = [0.8] * 20
        fts = [(i * 0.001, (i + 1) * 0.001) for i in range(20)]
        res = detector.smooth_segments(labels, confs, fts, 0.020, min_duration=0.30)
        assert len(res) == 1
        assert_strictly_monotonic_intervals(res, 0.020)

    def test_monotonic_intervals_inverted_frame_times_recovery(self, detector: ChordDetector):
        # Pathological raw frame times where start == end
        labels = ["C", "G"]
        confs = [0.8, 0.8]
        fts = [(0.0, 0.0), (0.0, 0.0)]
        res = detector.smooth_segments(labels, confs, fts, 0.0, min_duration=0.30)
        assert len(res) == 1
        assert res[0]["start"] == 0.0
        assert res[0]["end"] >= 0.01
        assert_strictly_monotonic_intervals(res)

    def test_rapid_alternating_burst_signals(self, detector: ChordDetector):
        # Audio signal with rapid 50ms alternating bursts of C major and A minor tones
        sr = 22050
        duration = 2.0
        t = np.arange(int(sr * duration)) / sr
        sig = np.zeros_like(t, dtype=np.float32)

        # Tone frequencies: C4=261.63, E4=329.63, G4=392.00, A4=440.00, C5=523.25
        chunk_len = int(sr * 0.05)  # 50ms chunks
        for i in range(0, len(t), chunk_len):
            idx_end = min(len(t), i + chunk_len)
            sub_t = t[i:idx_end]
            if (i // chunk_len) % 2 == 0:
                # C Major
                sig[i:idx_end] = (
                    np.sin(2 * np.pi * 261.63 * sub_t)
                    + np.sin(2 * np.pi * 329.63 * sub_t)
                    + np.sin(2 * np.pi * 392.00 * sub_t)
                )
            else:
                # A Minor
                sig[i:idx_end] = (
                    np.sin(2 * np.pi * 440.00 * sub_t)
                    + np.sin(2 * np.pi * 261.63 * sub_t)
                    + np.sin(2 * np.pi * 329.63 * sub_t)
                )

        sig = (sig / np.max(np.abs(sig)) * 0.8).astype(np.float32)
        res = detector.detect_chords(sig, sr=sr)
        assert len(res) >= 1
        assert_strictly_monotonic_intervals(res, duration)


# ==============================================================================
# 3. Unicode Slash Chord Transposition Stress Testing
# ==============================================================================


UNICODE_SLASH_CHORDS = [
    ("C/F♯", 0, 6, "", None),
    ("Am/B♭", 9, 10, "m", None),
    ("F/C♯", 5, 1, "", None),
    ("G/A♭", 7, 8, "", None),
    ("D/E♭", 2, 3, "", None),
    ("B♭/D♯", 10, 3, "", None),
    ("F♯/A♯", 6, 10, "", None),
    ("C♯/G♯", 1, 8, "", None),
    ("E♭/B♭", 3, 10, "", None),
    ("G♯m7/D♯", 8, 3, "m7", None),
    ("D♭maj7/A♭", 1, 8, "maj7", None),
    ("F♯7/C♯", 6, 1, "7", None),
    ("C/E", 0, 4, "", None),
    ("Am/G", 9, 7, "m", None),
    ("D7/F♯", 2, 6, "7", None),
    ("Em7/B♭", 4, 10, "m7", None),
]


class TestUnicodeSlashChordTranspositionMatrix:
    """Stress tests unicode accidental normalization and transposition across [-12, +12]."""

    @pytest.mark.parametrize("chord, orig_root_pc, orig_bass_pc, qual, _", UNICODE_SLASH_CHORDS)
    def test_unicode_slash_chord_transposition_all_semitones(
        self, chord: str, orig_root_pc: int, orig_bass_pc: int, qual: str, _: Any
    ):
        for s in range(-12, 13):
            res = transpose_chord(chord, s)
            if s == 0:
                # 0 is identity
                assert res == chord
                continue

            # Non-zero shifts must never emit unicode accidentals
            assert "♯" not in res and "♭" not in res, f"Unicode accidental in {res}"

            parsed = parse_chord_symbol(res)
            assert parsed is not None, f"Failed to parse transposed chord '{res}'"
            r_res, q_res, b_res = parsed

            assert q_res == qual, f"Quality changed from {qual} to {q_res} in {res}"
            assert b_res is not None, f"Bass missing in slash chord result {res}"

            res_root_pc = NOTE_TO_PITCH_CLASS[r_res.upper()]
            res_bass_pc = NOTE_TO_PITCH_CLASS[b_res.upper()]

            expected_root_pc = (orig_root_pc + s) % 12
            expected_bass_pc = (orig_bass_pc + s) % 12

            assert res_root_pc == expected_root_pc, (
                f"Root PC mismatch: expected {expected_root_pc}, got {res_root_pc} in {res}"
            )
            assert res_bass_pc == expected_bass_pc, (
                f"Bass PC mismatch: expected {expected_bass_pc}, got {res_bass_pc} in {res}"
            )

    def test_unicode_slash_chord_extreme_octave_identity(self):
        # Shifting by +12 or -12 preserves pitch classes and standardizes unicode accidentals
        assert transpose_chord("C/F♯", 12) == "C/F#"
        assert transpose_chord("C/F♯", -12) == "C/F#"
        assert transpose_chord("Am/B♭", 12) == "Am/Bb"
        assert transpose_chord("Am/B♭", -12) == "Am/Bb"
        assert transpose_chord("F/C♯", 12) == "F/C#"
        assert transpose_chord("F/C♯", -12) == "F/C#"

    def test_unicode_slash_chord_progression_pydantic_validation(self):
        prog = [
            {"start": 0.0, "end": 1.0, "chord": "C/F♯", "confidence": 0.95},
            {"start": 1.0, "end": 2.0, "chord": "Am/B♭", "confidence": 0.90},
            {"start": 2.0, "end": 3.0, "chord": "F/C♯", "confidence": 0.88},
            {"start": 3.0, "end": 4.0, "chord": "G7/D", "confidence": 0.92},
        ]
        for s in range(-12, 13):
            transposed = transpose_chord_progression(prog, s)
            req = ChordsUpdateRequest(chords=transposed)
            assert len(req.chords) == 4
            for seg in transposed:
                assert "/" in seg["chord"]
                if s != 0:
                    assert "♯" not in seg["chord"]
                    assert "♭" not in seg["chord"]


# ==============================================================================
# 4. Modal Key Spellings Verification
# ==============================================================================


ALL_ROOTS = ["C", "G", "D", "A", "E", "B", "F#", "F", "Bb", "Eb", "Ab", "Db"]
MODES = ["Mixolydian", "Dorian", "Phrygian", "Lydian", "Locrian"]


class TestModalKeySpellingsAdversarial:
    """Tests key-aware enharmonic classification across church modes and all roots."""

    @pytest.mark.parametrize("mode", MODES)
    @pytest.mark.parametrize("root", ALL_ROOTS)
    def test_modal_key_spelling_returns_valid_preference(self, root: str, mode: str):
        key_str = f"{root} {mode}"
        spelling = classify_key_spelling(key_str)
        assert spelling in (
            "sharp",
            "flat",
        ), f"Invalid spelling '{spelling}' returned for {key_str}"

    def test_mixolydian_classification(self):
        # G Mixolydian is major-like in circle of fifths (sharp key)
        assert classify_key_spelling("G Mixolydian") == "sharp"
        # F Mixolydian is flat key
        assert classify_key_spelling("F Mixolydian") == "flat"
        # Bb Mixolydian is flat key
        assert classify_key_spelling("Bb Mixolydian") == "flat"
        # D Mixolydian is sharp key
        assert classify_key_spelling("D Mixolydian") == "sharp"

    def test_dorian_classification(self):
        # D Dorian (sharp scale default)
        assert classify_key_spelling("D Dorian") == "sharp"
        # Bb Dorian (flat scale)
        assert classify_key_spelling("Bb Dorian") == "flat"
        # Eb Dorian (flat scale)
        assert classify_key_spelling("Eb Dorian") == "flat"

    def test_phrygian_classification(self):
        assert classify_key_spelling("E Phrygian") == "sharp"
        assert classify_key_spelling("Ab Phrygian") == "flat"

    def test_lydian_classification(self):
        assert classify_key_spelling("F Lydian") == "flat"
        assert classify_key_spelling("A Lydian") == "sharp"

    def test_locrian_classification(self):
        assert classify_key_spelling("B Locrian") == "sharp"
        assert classify_key_spelling("Db Locrian") == "flat"


# ==============================================================================
# 5. DSP Corner Cases (Ultra-short, DC bias, HDR Bursts, 96kHz)
# ==============================================================================


class TestDSPCornerCasesAdversarial:
    """Stress tests DSP robustness against ultra-short audio, DC bias, HDR, and 96kHz."""

    @pytest.fixture
    def detector(self) -> ChordDetector:
        return ChordDetector()

    def test_ultra_short_signals_do_not_crash(self, detector: ChordDetector):
        # Empty array
        res_empty = detector.detect_chords(np.array([], dtype=np.float32))
        assert len(res_empty) == 0

        # Sub-nperseg signals
        for n in [1, 10, 100, 2048, 4095]:
            sig = np.random.randn(n).astype(np.float32)
            res = detector.detect_chords(sig)
            assert len(res) == 0

    def test_massive_dc_bias_rejection(self, detector: ChordDetector):
        # Strong DC bias (+5.0 and -5.0) with slight harmonic tone
        sr = 22050
        t = np.arange(sr * 2) / sr
        for dc in [5.0, -5.0, 10.0]:
            sig = dc + 0.5 * np.sin(2 * np.pi * 440.0 * t)
            res = detector.detect_chords(sig.astype(np.float32), sr=sr)
            assert_strictly_monotonic_intervals(res, 2.0)

    def test_high_dynamic_range_burst_and_clipping(self, detector: ChordDetector):
        # Near-silent signal with a single extreme impulse of 10,000.0 (extreme clipping)
        sr = 22050
        duration = 2.0
        sig = np.zeros(int(sr * duration), dtype=np.float32)
        sig[sr : sr + 100] = 10000.0
        res = detector.detect_chords(sig, sr=sr)
        assert_strictly_monotonic_intervals(res, duration)

    def test_nan_and_inf_audio_samples_do_not_propagate(self, detector: ChordDetector):
        # Audio containing NaN and Inf values
        sr = 22050
        t = np.arange(sr * 2) / sr
        sig = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        sig[100:150] = np.nan
        sig[200:250] = np.inf
        sig[300:350] = -np.inf

        res = detector.detect_chords(sig, sr=sr)
        assert_strictly_monotonic_intervals(res, 2.0)
        for s in res:
            assert not np.isnan(s["start"])
            assert not np.isnan(s["end"])
            assert not np.isnan(s["confidence"])

    def test_high_sample_rate_96khz_and_192khz(self, detector: ChordDetector):
        # Multi-tone C Major chord synthesized at 96kHz and 192kHz
        for sr in [96000, 192000]:
            t = np.arange(sr * 2) / sr
            # C major triad: C4 (261.63), E4 (329.63), G4 (392.00)
            sig = (
                np.sin(2 * np.pi * 261.63 * t)
                + np.sin(2 * np.pi * 329.63 * t)
                + np.sin(2 * np.pi * 392.00 * t)
            ).astype(np.float32)

            res = detector.detect_chords(sig, sr=sr)
            assert len(res) >= 1
            assert_strictly_monotonic_intervals(res, 2.0)
            # Should detect 'C' as dominant harmonic chord
            detected_chords = [c["chord"] for c in res if c["chord"] != "N"]
            if detected_chords:
                assert "C" in detected_chords
