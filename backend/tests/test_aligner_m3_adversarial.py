"""
Adversarial Stress Test Suite for Milestone 3 (Line Boundary Snapping & Alignment).
Covers:
- Noisy phrase onsets (breath noise, percussive clicks, elevated background noise)
- Leading line starts across wide lead sweeps (0.1s to 2.0s)
- Lagging line starts across wide lag sweeps (0.1s to 1.5s, including t=0 boundary)
- Delayed line ends (bleed into instrumental gaps >= 1.0s) and premature line ends
- Multi-line sequences with tight inter-line spacing and overlapping raw timestamps
- Audio anomalies (NaN/Inf, stereo/multichannel, extreme sample rates, pure silence)
- Quantitative MAE computation verifying the MAE <= 120ms acceptance criterion
"""

import math
from typing import Any

import numpy as np
import pytest

from backend.services.aligner import AudioAligner, refine_line_boundaries
from backend.tests.helpers.audio_signals import (
    create_synthetic_vocal_signal,
)


class TestNoisyPhraseOnsets:
    """Stress tests assessing snapping accuracy in the presence of noise around vocal onsets."""

    def test_breath_noise_before_vocal_onset(self):
        """
        Adversarial Scenario: Singer takes a distinct audible breath immediately before vocalizing.
        Breath at 1.80s-2.05s, true vocal singing starts at 2.10s-4.00s.
        Raw LRC line starts early at 1.70s.
        """
        sr = 44100
        events = [
            {"start": 1.80, "end": 2.05, "is_breath": True},
            {"start": 2.10, "end": 4.00, "freq": 440.0},
        ]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.70, "end_time": 4.00, "text": "Breath before singing"}]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 1
        snapped_s = refined[0]["start_time"]

        # Measure error relative to true vocal singing onset (2.10s)
        # and document whether RMS energy triggers on the breath noise
        error_to_singing = abs(snapped_s - 2.10)
        error_to_breath = abs(snapped_s - 1.80)
        print(f"\n[Breath Test] Snapped start: {snapped_s:.3f}s (singing: 2.10s, breath: 1.80s)")
        print(
            f"Error to singing onset: {error_to_singing * 1000:.1f}ms, to breath: {error_to_breath * 1000:.1f}ms"
        )

        # Start must be valid and non-negative
        assert snapped_s >= 0.0
        assert snapped_s < refined[0]["end_time"]

    def test_breath_noise_mae_target(self):
        """Verifies whether breath noise causes onset error to exceed the 120ms MAE target."""
        sr = 44100
        events = [
            {"start": 1.70, "end": 1.95, "is_breath": True},
            {"start": 2.10, "end": 4.00, "freq": 440.0},
        ]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.60, "end_time": 4.00, "text": "Breath before singing"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        error = abs(snapped_s - 2.10)
        assert error <= 0.120, f"Breath error {error * 1000:.1f}ms exceeds 120ms target"

    def test_percussive_transient_before_vocal_onset(self):
        """
        Adversarial Scenario: A sharp percussive drum bleed occurs 300ms before singing.
        Transient at 1.70s-1.75s, true vocal onset at 2.00s-4.00s.
        Raw LRC starts early at 1.50s.
        """
        sr = 44100
        events = [
            {"start": 1.70, "end": 1.75, "is_transient": True},
            {"start": 2.00, "end": 4.00, "freq": 440.0},
        ]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.50, "end_time": 4.00, "text": "Drum transient bleed"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        print(
            f"\n[Transient Test] Snapped start: {snapped_s:.3f}s (singing: 2.00s, transient: 1.70s)"
        )
        assert snapped_s >= 0.0

    def test_noisy_background_onset_mae_sweep(self):
        """
        Adversarial Scenario: Elevated background noise levels across multiple trials.
        Evaluates whether MAE <= 120ms holds under moderate background noise.
        """
        sr = 44100
        onsets = [1.50, 2.20, 3.10]
        raw_starts = [1.10, 1.80, 2.60]  # each leads by 400-500ms
        errors = []

        for gt_onset, raw_s in zip(onsets, raw_starts, strict=False):
            events = [{"start": gt_onset, "end": gt_onset + 1.5, "freq": 380.0}]
            audio = create_synthetic_vocal_signal(
                duration=gt_onset + 3.0, vocal_events=events, sr=sr, noise_level=0.01
            )
            lines = [{"start_time": raw_s, "end_time": gt_onset + 1.5, "text": "Noise sweep"}]
            refined = refine_line_boundaries(audio, sr, lines)
            err = abs(refined[0]["start_time"] - gt_onset)
            errors.append(err)

        mae = float(np.mean(errors))
        print(f"\n[Noise Sweep MAE]: {mae * 1000:.1f}ms")
        assert mae <= 0.120, f"MAE {mae * 1000:.1f}ms exceeds 120ms"


class TestLeadingLineStarts:
    """Stress tests assessing line start snapping when raw LRC leads the vocal onset."""

    @pytest.mark.parametrize("lead_sec", [0.10, 0.25, 0.50, 0.75, 1.00])
    def test_leading_start_within_search_window(self, lead_sec):
        """Verifies start snapping when raw LRC leads vocal onset by 0.10s to 1.00s."""
        sr = 44100
        gt_onset = 2.50
        raw_start = gt_onset - lead_sec
        events = [{"start": gt_onset, "end": 4.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": raw_start, "end_time": 4.50, "text": f"Leading {lead_sec}s"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        error = abs(snapped_s - gt_onset)
        print(
            f"\n[Lead {lead_sec}s] Raw: {raw_start:.2f}s -> Snapped: {snapped_s:.3f}s, Error: {error * 1000:.1f}ms"
        )
        assert error <= 0.120, f"Error {error * 1000:.1f}ms exceeds 120ms limit"

    def test_extreme_leading_start_beyond_search_window(self):
        """
        Adversarial Scenario: Raw LRC leads vocal onset by 1.6s (beyond the 1.2s forward search limit).
        Vocal onset at 3.00s, raw LRC start at 1.40s.
        """
        sr = 44100
        gt_onset = 3.00
        raw_start = 1.40  # 1.6s early (> 1.2s search window)
        events = [{"start": gt_onset, "end": 5.00, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=7.0, vocal_events=events, sr=sr)
        lines = [{"start_time": raw_start, "end_time": 5.00, "text": "Extreme lead"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        print(f"\n[Extreme Lead 1.6s] Raw: {raw_start:.2f}s -> Snapped: {snapped_s:.3f}s")
        # Documents behavioral limit: does it snap or remain at raw_start?


class TestLaggingLineStarts:
    """Stress tests assessing line start snapping when raw LRC lags behind the vocal onset."""

    @pytest.mark.parametrize("lag_sec", [0.10, 0.25, 0.50, 0.75, 0.90])
    def test_lagging_start_within_search_window(self, lag_sec):
        """Verifies start snapping backward when raw LRC lags behind vocal onset by 0.10s to 0.90s."""
        sr = 44100
        gt_onset = 2.00
        raw_start = gt_onset + lag_sec
        events = [{"start": gt_onset, "end": 4.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": raw_start, "end_time": 4.50, "text": f"Lagging {lag_sec}s"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        error = abs(snapped_s - gt_onset)
        print(
            f"\n[Lag {lag_sec}s] Raw: {raw_start:.2f}s -> Snapped: {snapped_s:.3f}s, Error: {error * 1000:.1f}ms"
        )
        assert error <= 0.120, f"Error {error * 1000:.1f}ms exceeds 120ms limit"

    def test_lagging_start_when_onset_at_zero(self):
        """
        Adversarial Edge Case: Vocal phrase begins immediately at t=0.00s.
        Raw LRC start is lagging at t=0.40s.
        Tests whether backward tracing correctly snaps to 0.00s when first_act_idx reaches 0.
        """
        sr = 44100
        events = [{"start": 0.00, "end": 3.00, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 0.40, "end_time": 3.00, "text": "Starts at zero"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        error = abs(snapped_s - 0.00)
        print(
            f"\n[Onset at t=0.0s] Raw: 0.40s -> Snapped: {snapped_s:.3f}s, Error: {error * 1000:.1f}ms"
        )
        # Check if error <= 120ms

    def test_lagging_start_when_onset_at_zero_mae_target(self):
        """Verifies whether lagging start snaps to onset when singing begins at t=0.00s."""
        sr = 44100
        events = [{"start": 0.00, "end": 3.00, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 0.40, "end_time": 3.00, "text": "Starts at zero"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        error = abs(snapped_s - 0.00)
        assert error <= 0.120, (
            f"Error {error * 1000:.1f}ms exceeds 120ms limit when onset is at 0.0s"
        )


class TestDelayedAndPrematureLineEnds:
    """Stress tests assessing release trimming and behavior with premature/delayed line ends."""

    @pytest.mark.parametrize("bleed_sec", [1.00, 1.50, 2.50, 4.00])
    def test_delayed_end_instrumental_gap_trimming(self, bleed_sec):
        """
        Verifies line end trimming when raw end extends into instrumental silence >= 1.0s.
        Ground truth vocal release = 3.00s. Hangover = ~0.10s.
        Target release: ~3.10s (MAE <= 120ms of 3.10s).
        """
        sr = 44100
        gt_release = 3.00
        raw_end = gt_release + bleed_sec
        events = [{"start": 1.00, "end": gt_release, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=raw_end + 1.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": raw_end, "text": f"Bleed {bleed_sec}s"}]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        snapped_e = refined[0]["end_time"]
        expected_e = gt_release + 0.10  # 3.10s
        error = abs(snapped_e - expected_e)
        print(
            f"\n[Bleed {bleed_sec}s] Raw end: {raw_end:.2f}s -> Snapped: {snapped_e:.3f}s, Error to expected: {error * 1000:.1f}ms"
        )
        assert error <= 0.120, f"End trimming error {error * 1000:.1f}ms exceeds 120ms target"

    def test_silence_gap_under_min_gap_threshold(self):
        """
        Verifies behavior when silence gap is 0.6s (< min_silence_gap of 1.0s).
        The algorithm should NOT trim line end when silence gap < 1.0s.
        """
        sr = 44100
        gt_release = 3.00
        raw_end = 3.60  # silence gap = 0.6s
        events = [{"start": 1.00, "end": gt_release, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": raw_end, "text": "Small silence gap"}]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        snapped_e = refined[0]["end_time"]
        print(f"\n[Sub-threshold Gap 0.6s] Raw: {raw_end:.2f}s -> Snapped: {snapped_e:.3f}s")
        assert snapped_e == pytest.approx(raw_end, abs=0.05)

    def test_premature_line_end_clipped_sustained_note(self):
        """
        Adversarial Scenario: Singer sustains a long note to 4.50s, but raw LRC end is premature at 3.20s.
        Investigate whether line refinement extends or leaves the note clipped.
        """
        sr = 44100
        events = [{"start": 1.00, "end": 4.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": 3.20, "text": "Sustained note clipped"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_e = refined[0]["end_time"]
        print(
            f"\n[Premature End] Raw end: 3.20s (vocal ends at 4.50s) -> Snapped: {snapped_e:.3f}s"
        )
        assert snapped_e >= refined[0]["start_time"]

    def test_premature_line_end_clipped_sustained_note_mae_target(self):
        """Verifies whether line end extends to true release when singer sustains note past raw_e."""
        sr = 44100
        events = [{"start": 1.00, "end": 4.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=6.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": 3.20, "text": "Sustained note clipped"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_e = refined[0]["end_time"]
        expected_e = 4.50 + 0.10  # 4.60s release target
        error = abs(snapped_e - expected_e)
        assert error <= 0.120, (
            f"Error {error * 1000:.1f}ms exceeds 120ms limit on clipped sustained note"
        )


class TestMultiLineSequencesAndMonotonicity:
    """Stress tests with multiple consecutive lines, tight gaps, and monotonicity requirements."""

    def test_multi_line_consecutive_snapping(self):
        """
        Multiple consecutive lines with alternating lead and lag, plus trailing bleed.
        Verifies non-overlapping order and overall MAE <= 120ms.
        """
        sr = 44100
        gt_phrases = [
            {"start": 1.50, "end": 3.20, "freq": 350.0},
            {"start": 4.50, "end": 6.00, "freq": 400.0},
            {"start": 7.50, "end": 9.20, "freq": 450.0},
        ]
        audio = create_synthetic_vocal_signal(duration=12.0, vocal_events=gt_phrases, sr=sr)

        # Line 0: leads by 0.4s (1.10s), ends with 1.8s bleed (5.00s -> should trim before 4.50s)
        # Line 1: lags by 0.3s (4.80s), ends with 1.0s bleed (7.00s)
        # Line 2: leads by 0.3s (7.20s), ends with 2.0s bleed (11.20s)
        lines = [
            {"start_time": 1.10, "end_time": 4.30, "text": "Line 1 leading and bleeding"},
            {"start_time": 4.80, "end_time": 7.10, "text": "Line 2 lagging and bleeding"},
            {"start_time": 7.20, "end_time": 11.20, "text": "Line 3 leading and bleeding"},
        ]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        assert len(refined) == 3

        # Strict monotonicity & ordering
        for i in range(len(refined)):
            assert refined[i]["start_time"] < refined[i]["end_time"]
            if i + 1 < len(refined):
                assert refined[i]["end_time"] <= refined[i + 1]["start_time"]

        start_errors = [abs(refined[i]["start_time"] - gt_phrases[i]["start"]) for i in range(3)]
        end_targets = [p["end"] + 0.10 for p in gt_phrases]
        end_errors = [abs(refined[i]["end_time"] - end_targets[i]) for i in range(3)]
        all_errors = start_errors + end_errors
        mae = float(np.mean(all_errors))
        print(f"\n[Multi-Line Snapping MAE]: {mae * 1000:.1f}ms")
        for i in range(3):
            print(
                f"Line {i}: Start err={start_errors[i] * 1000:.1f}ms, End err={end_errors[i] * 1000:.1f}ms"
            )
        assert mae <= 0.120, f"Multi-line MAE {mae * 1000:.1f}ms exceeds 120ms target"

    def test_tight_interline_gap_and_monotonicity(self):
        """Lines separated by only 0.20s vocal gap."""
        sr = 44100
        gt_phrases = [
            {"start": 1.00, "end": 2.50, "freq": 350.0},
            {"start": 2.70, "end": 4.00, "freq": 400.0},
        ]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=gt_phrases, sr=sr)
        lines = [
            {"start_time": 0.80, "end_time": 2.50, "text": "Line tight 1"},
            {"start_time": 2.65, "end_time": 4.20, "text": "Line tight 2"},
        ]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 2
        assert refined[0]["end_time"] <= refined[1]["start_time"]
        assert refined[0]["start_time"] < refined[0]["end_time"]
        assert refined[1]["start_time"] < refined[1]["end_time"]


class TestAudioAndInputCornerCases:
    """Stress tests on unusual audio inputs and data structures."""

    def test_audio_with_nan_and_inf(self):
        """Audio containing NaN and Inf values must not crash and produce clean finite output."""
        sr = 44100
        events = [{"start": 1.00, "end": 3.00, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        audio[100:200] = np.nan
        audio[500:600] = np.inf
        audio[800:900] = -np.inf

        lines = [{"start_time": 0.70, "end_time": 4.50, "text": "Corrupted audio"}]
        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 1
        s = refined[0]["start_time"]
        e = refined[0]["end_time"]
        assert math.isfinite(s) and math.isfinite(e)
        assert 0.0 <= s < e

    def test_multichannel_5_1_audio(self):
        """Audio with 6 channels (5.1 surround sound)."""
        sr = 44100
        events = [{"start": 1.00, "end": 3.00, "freq": 440.0}]
        mono = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        surround = np.stack([mono] * 6, axis=-1)

        lines = [{"start_time": 0.70, "end_time": 4.50, "text": "Surround 5.1"}]
        refined = refine_line_boundaries(surround, sr, lines)
        assert len(refined) == 1
        assert abs(refined[0]["start_time"] - 1.00) <= 0.120

    def test_sample_rates_sweep(self):
        """Tests varying sample rates: 16kHz, 22.05kHz, 44.1kHz, 48kHz, 96kHz."""
        for sr in [16000, 22050, 44100, 48000, 96000]:
            events = [{"start": 1.00, "end": 2.50, "freq": 440.0}]
            audio = create_synthetic_vocal_signal(duration=4.0, vocal_events=events, sr=sr)
            lines = [{"start_time": 0.60, "end_time": 4.00, "text": f"SR {sr}"}]
            refined = refine_line_boundaries(audio, sr, lines)
            assert len(refined) == 1
            s = refined[0]["start_time"]
            assert abs(s - 1.00) <= 0.120, (
                f"SR {sr} start error {abs(s - 1.00) * 1000:.1f}ms exceeds 120ms"
            )

    def test_empty_audio_and_zero_sample_rate(self):
        """Zero length audio or invalid sample rate fallbacks."""
        empty_audio = np.zeros(0, dtype=np.float32)
        lines = [{"start_time": 1.00, "end_time": 3.00, "text": "Empty audio"}]
        refined = refine_line_boundaries(empty_audio, 44100, lines)
        assert len(refined) == 1
        assert refined[0]["start_time"] == 1.00
        assert refined[0]["end_time"] == 3.00

        audio = np.zeros(44100, dtype=np.float32)
        refined_sr0 = refine_line_boundaries(audio, 0, lines)
        assert len(refined_sr0) == 1
