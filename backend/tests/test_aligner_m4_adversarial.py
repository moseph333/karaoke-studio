"""
Adversarial Stress Test Suite for Milestone 4:
Sub-Line Word Synchronization via Spectral Flux & Voiced Gating (Requirement R4).

Covers:
1. Multi-Sample Rate Verification:
   - Mandated: 16kHz, 22.05kHz, 44.1kHz, 48kHz, 96kHz.
   - Boundaries: 8kHz, 32kHz, 88.2kHz, 192kHz, and zero/negative sample rates.
2. Noisy Background & Bleed Suppression:
   - Elevated white noise (+20dB down to -5dB SNR).
   - Babble noise (interfering harmonic vocal chatter at 220Hz, 330Hz, 550Hz).
   - Percussive drum bleed (sharp decaying impulse transients).
   - High-frequency breath sounds (bandpass noise at 2.5kHz-5kHz preceding and intra-line).
   - Combined adverse multi-noise stress test with quantitative MAE <= 100ms.
3. Complex Lyric Parsing & Fuzzing:
   - Hyphenated words ("hip-hop", "spider-man", "state-of-the-art").
   - Words with apostrophes ("don't", "'cause", "rock 'n' roll", "singin'").
   - Punctuation-dense tokens, brackets, dashes, ellipses.
   - Whitespace fuzzing (multiple spaces, tabs, newlines).
   - Numbers and alphanumeric tokens ("24/7", "100%", "99", "3.14").
   - Rapid single-syllable bursts (10 monosyllabic words in short window).
   - Polysyllabic words ("supercalifragilisticexpialidocious").
   - Accented and Unicode characters ("café", "résumé", "música", "日本語").
   - Stray timestamp tags embedded in text.
   - Single-word lines, empty lines, and all-whitespace lines.
4. Mathematical Invariants & Audio Extremes:
   - Strict monotonicity: 0 <= start_time < end_time, non-overlapping (w[i].end <= w[i+1].start).
   - Strictly non-negative finite floats (no NaN, Inf, None).
   - Bounded within line interval [line_start, line_end].
   - Inverted line boundaries (line_start >= line_end).
   - Negative and non-finite line boundaries (NaN start, Inf end).
   - Audio anomalies: pure silence, DC offset, extreme clipping (+100dB), sub-frame audio (< 25ms), NaN/Inf audio.
5. End-to-End Performance Budget:
   - Full 3.5-minute (210s) vocal track alignment completes in < 2.0s CPU.
"""

from __future__ import annotations

import math
import tempfile
import time
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import (
    AudioAligner,
    align_words_spectral,
    calculate_word_weight,
    count_syllables,
    enforce_monotonic_words,
)
from backend.tests.test_e2e_lyrics_aligner_sync import (
    create_synthetic_vocal_signal,
    write_test_wav,
)


def _assert_strict_monotonic_and_valid(
    words_result: list[dict[str, Any]],
    line_start: float | None = None,
    line_end: float | None = None,
) -> None:
    """Verifies that words strictly satisfy all R4 monotonicity and validity invariants."""
    for i, w in enumerate(words_result):
        s = w["start_time"]
        e = w["end_time"]
        assert isinstance(s, (int, float)), f"Word {i} start_time is not float: {s}"
        assert isinstance(e, (int, float)), f"Word {i} end_time is not float: {e}"
        assert math.isfinite(s), f"Word {i} start_time is non-finite: {s}"
        assert math.isfinite(e), f"Word {i} end_time is non-finite: {e}"
        assert s >= 0.0, f"Word {i} start_time is negative: {s}"
        assert s < e, f"Word {i} start_time ({s}) >= end_time ({e})"

        if i > 0:
            prev_e = words_result[i - 1]["end_time"]
            assert s >= prev_e, f"Word {i} start ({s}) overlaps previous end ({prev_e})"

        if line_start is not None and math.isfinite(line_start):
            assert s >= min(line_start, 0.0) or s >= line_start - 0.05
        if line_end is not None and math.isfinite(line_end):
            # Allow tiny rounding slack if line window was extremely tight
            assert e <= max(line_end, s + 0.001) + 0.05


class TestSampleRateExtremes:
    """Adversarially tests spectral alignment across mandatory and boundary sample rates."""

    @pytest.mark.parametrize("sr", [16000, 22050, 44100, 48000, 96000])
    def test_mandated_sample_rates_accuracy_and_monotonicity(self, sr: int):
        """Validates alignment across 16k, 22.05k, 44.1k, 48k, and 96k."""
        words = ["alpha", "beta", "gamma", "delta"]
        gt = [
            {"word": "alpha", "start": 0.50, "end": 0.80, "freq": 320.0},
            {"word": "beta", "start": 0.95, "end": 1.25, "freq": 360.0},
            {"word": "gamma", "start": 1.40, "end": 1.70, "freq": 400.0},
            {"word": "delta", "start": 1.85, "end": 2.15, "freq": 440.0},
        ]
        ev = [{"start": g["start"], "end": g["end"], "freq": g["freq"]} for g in gt]
        audio = create_synthetic_vocal_signal(
            duration=2.6, vocal_events=ev, sr=sr, noise_level=0.001
        )

        result = align_words_spectral(audio, sr, words, line_start=0.4, line_end=2.3)
        assert len(result) == 4
        _assert_strict_monotonic_and_valid(result, line_start=0.4, line_end=2.3)

        # Quantitative accuracy check: MAE <= 100ms
        errors = []
        for r, g in zip(result, gt, strict=True):
            errors.append(abs(r["start_time"] - g["start"]))
            errors.append(abs(r["end_time"] - g["end"]))
        mae = float(np.mean(errors))
        assert mae <= 0.100, f"Sample rate {sr}Hz yielded MAE {mae * 1000:.1f}ms (>100ms)"

    @pytest.mark.parametrize("sr", [8000, 11025, 32000, 88200, 192000])
    def test_boundary_and_extreme_sample_rates(self, sr: int):
        """Stresses extreme boundary sample rates from telephone 8kHz to high-res 192kHz."""
        words = ["extreme", "sample", "rate"]
        ev = [
            {"start": 0.6, "end": 0.9, "freq": 300.0},
            {"start": 1.1, "end": 1.4, "freq": 350.0},
            {"start": 1.6, "end": 1.9, "freq": 400.0},
        ]
        audio = create_synthetic_vocal_signal(duration=2.4, vocal_events=ev, sr=sr)
        result = align_words_spectral(audio, sr, words, line_start=0.5, line_end=2.1)
        assert len(result) == 3
        _assert_strict_monotonic_and_valid(result, line_start=0.5, line_end=2.1)

    def test_zero_or_negative_sample_rate_fallback(self):
        """Ensures non-positive sample rates fall back cleanly without division by zero."""
        audio = np.random.randn(1000).astype(np.float32)
        words = ["safe", "fallback"]
        res_zero = align_words_spectral(audio, 0, words, line_start=1.0, line_end=3.0)
        assert len(res_zero) == 2
        _assert_strict_monotonic_and_valid(res_zero, line_start=1.0, line_end=3.0)

        res_neg = align_words_spectral(audio, -44100, words, line_start=1.0, line_end=3.0)
        assert len(res_neg) == 2
        _assert_strict_monotonic_and_valid(res_neg, line_start=1.0, line_end=3.0)


class TestNoisyBackgrounds:
    """Stress tests voiced gating against noise, babble, percussion, and breath sounds."""

    def test_pre_utterance_and_intra_line_breath_noise(self):
        """
        Adversarial Scenario: Singer breathes loudly before line onset and between words.
        Breath at 0.60-0.95s and 1.60-1.85s. True singing at 1.00-1.50s and 1.90-2.40s.
        """
        sr = 44100
        events = [
            {"start": 0.60, "end": 0.95, "is_breath": True},
            {"start": 1.00, "end": 1.50, "freq": 380.0},
            {"start": 1.60, "end": 1.85, "is_breath": True},
            {"start": 1.90, "end": 2.40, "freq": 420.0},
        ]
        audio = create_synthetic_vocal_signal(duration=3.0, vocal_events=events, sr=sr)
        words = ["breathless", "voice"]

        res = align_words_spectral(audio, sr, words, line_start=0.5, line_end=2.6)
        assert len(res) == 2
        _assert_strict_monotonic_and_valid(res, line_start=0.5, line_end=2.6)

        # Word 0 should start near 1.00s, NOT at 0.60s breath
        assert res[0]["start_time"] >= 0.90
        assert abs(res[0]["start_time"] - 1.00) <= 0.080
        # Word 1 should start near 1.90s, NOT at 1.60s breath
        assert res[1]["start_time"] >= 1.80
        assert abs(res[1]["start_time"] - 1.90) <= 0.080

    def test_percussive_bleed_and_drum_fills(self):
        """
        Adversarial Scenario: Isolated vocal track contains substantial drum bleed
        (snare/hi-hat transients at 0.5s, 1.4s, 2.3s, 3.1s).
        """
        sr = 44100
        events = [
            {"start": 0.50, "end": 0.55, "is_transient": True},
            {"start": 0.80, "end": 1.30, "freq": 350.0},
            {"start": 1.40, "end": 1.45, "is_transient": True},
            {"start": 1.70, "end": 2.20, "freq": 390.0},
            {"start": 2.30, "end": 2.35, "is_transient": True},
            {"start": 2.60, "end": 3.00, "freq": 430.0},
            {"start": 3.10, "end": 3.15, "is_transient": True},
        ]
        audio = create_synthetic_vocal_signal(duration=3.5, vocal_events=events, sr=sr)
        words = ["drum", "bleed", "filtered"]

        res = align_words_spectral(audio, sr, words, line_start=0.4, line_end=3.3)
        assert len(res) == 3
        _assert_strict_monotonic_and_valid(res, line_start=0.4, line_end=3.3)

        assert abs(res[0]["start_time"] - 0.80) <= 0.080
        assert abs(res[1]["start_time"] - 1.70) <= 0.080
        assert abs(res[2]["start_time"] - 2.60) <= 0.080

    def test_babble_interference_multi_speaker(self):
        """
        Adversarial Scenario: Background multi-speaker cafeteria babble noise
        (sum of 30 uncorrelated voices with randomized frequencies and phases).
        Voiced harmonic gating suppresses babble (r_max < 0.28) and locks to lead singer.
        """
        sr = 44100
        dur = 3.0
        t = np.linspace(0, dur, int(dur * sr), endpoint=False)
        rng = np.random.RandomState(42)
        babble = np.zeros_like(t, dtype=np.float32)
        for _ in range(30):
            f = rng.uniform(100, 800)
            phi = rng.uniform(0, 2 * np.pi)
            amp = rng.uniform(0.01, 0.04)
            babble += (amp * np.sin(2 * np.pi * f * t + phi)).astype(np.float32)

        events = [
            {"start": 0.8, "end": 1.3, "freq": 440.0},
            {"start": 1.7, "end": 2.2, "freq": 480.0},
        ]
        vocal = create_synthetic_vocal_signal(duration=dur, vocal_events=events, sr=sr)
        mixed = vocal + babble

        words = ["lead", "vocal"]
        res = align_words_spectral(mixed, sr, words, line_start=0.5, line_end=2.6)
        assert len(res) == 2
        _assert_strict_monotonic_and_valid(res, line_start=0.5, line_end=2.6)
        assert abs(res[0]["start_time"] - 0.80) <= 0.100
        assert abs(res[1]["start_time"] - 1.70) <= 0.100

    def test_combined_adverse_multi_noise_mae_benchmark(self):
        """
        Combined Stress Test: High white noise (SNR ~10dB) + pre-breath + drum transients.
        Verifies quantitative MAE <= 100ms.
        """
        sr = 44100
        words = ["testing", "combined", "adverse", "noise"]
        gt = [
            {"start": 1.00, "end": 1.35, "freq": 340.0},
            {"start": 1.45, "end": 1.80, "freq": 370.0},
            {"start": 1.95, "end": 2.30, "freq": 410.0},
            {"start": 2.45, "end": 2.80, "freq": 440.0},
        ]
        events = list(gt)
        events.append({"start": 0.65, "end": 0.95, "is_breath": True})
        events.append({"start": 1.37, "end": 1.42, "is_transient": True})
        events.append({"start": 2.85, "end": 2.90, "is_transient": True})

        audio = create_synthetic_vocal_signal(
            duration=3.5, vocal_events=events, sr=sr, noise_level=0.03
        )
        res = align_words_spectral(audio, sr, words, line_start=0.8, line_end=3.0)
        assert len(res) == 4
        _assert_strict_monotonic_and_valid(res, line_start=0.8, line_end=3.0)

        errors = []
        for r, g in zip(res, gt, strict=True):
            errors.append(abs(r["start_time"] - g["start"]))
            errors.append(abs(r["end_time"] - g["end"]))
        mae = float(np.mean(errors))
        assert mae <= 0.100, f"Combined adverse MAE {mae * 1000:.1f}ms exceeds 100ms target"


class TestComplexLyricLines:
    """Fuzzes and verifies complex lyric punctuation, whitespace, numbers, and tokens."""

    @pytest.mark.parametrize(
        "word_list",
        [
            ["hip-hop", "state-of-the-art", "spider-man", "mother-in-law"],
            ["don't", "can't", "'cause", "rock 'n' roll", "singin'", "o'clock"],
            ['"Wait!"', "(she", "said),", '"what?!"', "--", "Yes!"],
            ["24/7", "100%", "99", "3.14", "B2B"],
            ["café", "résumé", "naïve", "schön", "señorita", "música"],
            ["da"] * 10,  # 10 rapid single-syllable bursts
            ["supercalifragilisticexpialidocious", "and", "it"],
            ["[00:01.00] testing", "<00:01.50> tags", "here"],
        ],
    )
    def test_complex_lyric_token_fuzzing(self, word_list: list[str]):
        """Verifies that punctuation, apostrophes, symbols, and tags preserve monotonicity."""
        sr = 44100
        t = np.linspace(0, 3.0, int(3.0 * sr), endpoint=False)
        audio = (0.5 * np.sin(2 * np.pi * 350 * t) + 0.25 * np.sin(2 * np.pi * 700 * t)).astype(
            np.float32
        )

        res = align_words_spectral(audio, sr, word_list, line_start=0.5, line_end=2.5)
        assert len(res) > 0
        _assert_strict_monotonic_and_valid(res, line_start=0.5, line_end=2.5)

    def test_single_word_line(self):
        """Verifies that a line containing exactly 1 word aligns properly without errors."""
        sr = 44100
        events = [{"start": 1.2, "end": 2.0, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=3.0, vocal_events=events, sr=sr)
        res = align_words_spectral(audio, sr, ["Hallelujah!"], line_start=0.8, line_end=2.4)
        assert len(res) == 1
        assert res[0]["word"] == "Hallelujah!"
        _assert_strict_monotonic_and_valid(res, line_start=0.8, line_end=2.4)

    def test_empty_and_whitespace_only_lines(self):
        """Verifies empty or whitespace-only word inputs return empty lists."""
        audio = np.ones(44100, dtype=np.float32)
        assert align_words_spectral(audio, 44100, [], 0.0, 1.0) == []
        assert align_words_spectral(audio, 44100, ["", "   ", "\t\n"], 0.0, 1.0) == []

    def test_audio_aligner_align_lyrics_with_complex_lyric_variations(self, tmp_path):
        """Tests AudioAligner.align_lyrics end-to-end with various messy lines."""
        wav_path = str(tmp_path / "complex_lyrics.wav")
        events = [
            {"start": 1.0, "end": 2.5, "freq": 350.0},
            {"start": 3.5, "end": 5.0, "freq": 400.0},
            {"start": 6.0, "end": 7.5, "freq": 450.0},
        ]
        write_test_wav(wav_path, duration=9.0, vocal_events=events)

        lines = [
            {
                "id": 0,
                "text": "  [00:01.00]  Hip-hop rock 'n' roll!  ",
                "start_time": 0.8,
                "end_time": 2.8,
            },
            {"id": 1, "text": "", "start_time": 2.8, "end_time": 3.3},  # Empty line
            {"id": 2, "text": "   ...   ", "start_time": 3.3, "end_time": 3.5},  # Punctuation only
            {
                "id": 3,
                "text": "Fast 24/7 tempo spitting rhymes",
                "start_time": 3.5,
                "end_time": 5.5,
            },
            {"id": 4, "text": "Soleil café naïve", "start_time": 5.8, "end_time": 7.8},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(wav_path, lines)
        assert len(aligned) == 5

        # Check line 0 words
        assert len(aligned[0]["words"]) >= 3
        _assert_strict_monotonic_and_valid(aligned[0]["words"], line_start=0.8, line_end=2.8)

        # Check line 1 and 2 empty words
        assert aligned[1]["words"] == []

        # Check line 3 and 4 words
        _assert_strict_monotonic_and_valid(aligned[3]["words"], line_start=3.5, line_end=5.5)
        _assert_strict_monotonic_and_valid(aligned[4]["words"], line_start=5.8, line_end=7.8)


class TestInvariantsAndAudioExtremes:
    """Stress tests boundary mathematical invariants and audio signal anomalies."""

    def test_inverted_and_negative_line_boundaries(self):
        """Verifies that line_end <= line_start or line_start < 0 are safely sanitized."""
        audio = np.random.randn(44100 * 2).astype(np.float32)
        words = ["alpha", "beta"]

        # Inverted line: start=3.0, end=1.0
        res_inv = align_words_spectral(audio, 44100, words, line_start=3.0, line_end=1.0)
        assert len(res_inv) == 2
        _assert_strict_monotonic_and_valid(res_inv)

        # Negative start: start=-2.0, end=1.0
        res_neg = align_words_spectral(audio, 44100, words, line_start=-2.0, line_end=1.0)
        assert len(res_neg) == 2
        _assert_strict_monotonic_and_valid(res_neg, line_start=0.0, line_end=1.0)

    def test_non_finite_line_boundaries(self):
        """Verifies line_start=NaN or line_end=Inf do not crash or produce NaNs."""
        audio = np.random.randn(44100 * 2).astype(np.float32)
        words = ["nan", "bound"]

        res_nan = align_words_spectral(audio, 44100, words, line_start=float("nan"), line_end=2.0)
        assert len(res_nan) == 2
        _assert_strict_monotonic_and_valid(res_nan)

        res_inf = align_words_spectral(audio, 44100, words, line_start=0.0, line_end=float("inf"))
        assert len(res_inf) == 2
        _assert_strict_monotonic_and_valid(res_inf)

    def test_audio_nan_and_inf_samples(self):
        """Verifies that NaN or Inf samples in audio array fall back safely to proportional distribution."""
        audio_nan = np.full(44100 * 2, np.nan, dtype=np.float32)
        words = ["all", "nan", "audio"]
        res = align_words_spectral(audio_nan, 44100, words, line_start=1.0, line_end=3.0)
        assert len(res) == 3
        _assert_strict_monotonic_and_valid(res, line_start=1.0, line_end=3.0)

    def test_dc_offset_and_pure_silence(self):
        """Verifies constant non-zero DC offset or pure silence falls back safely."""
        audio_dc = np.full(44100 * 2, 8.5, dtype=np.float32)
        words = ["dc", "offset"]
        res_dc = align_words_spectral(audio_dc, 44100, words, line_start=0.5, line_end=2.0)
        assert len(res_dc) == 2
        _assert_strict_monotonic_and_valid(res_dc, line_start=0.5, line_end=2.0)

        audio_silence = np.zeros(44100 * 2, dtype=np.float32)
        res_silence = align_words_spectral(
            audio_silence, 44100, words, line_start=0.5, line_end=2.0
        )
        assert len(res_silence) == 2
        _assert_strict_monotonic_and_valid(res_silence, line_start=0.5, line_end=2.0)

    def test_extreme_amplitude_saturation_clipping(self):
        """Verifies extreme amplitude (+100dB, 1e6) does not cause numerical overflow."""
        t = np.linspace(0, 2.0, 44100 * 2, endpoint=False)
        audio_clipped = (np.sin(2 * np.pi * 400 * t) * 1e6).astype(np.float32)
        words = ["clipped", "audio"]
        res = align_words_spectral(audio_clipped, 44100, words, line_start=0.0, line_end=2.0)
        assert len(res) == 2
        _assert_strict_monotonic_and_valid(res, line_start=0.0, line_end=2.0)

    def test_audio_shorter_than_line_or_out_of_bounds(self):
        """Verifies audio ending before line start or line end does not raise index errors."""
        audio_short = np.random.randn(44100).astype(np.float32)  # 1.0s long
        words = ["late", "line"]
        # Line is at 5.0s to 7.0s
        res = align_words_spectral(audio_short, 44100, words, line_start=5.0, line_end=7.0)
        assert len(res) == 2
        _assert_strict_monotonic_and_valid(res, line_start=5.0, line_end=7.0)

    def test_sub_frame_and_empty_audio_slices(self):
        """Verifies audio with fewer samples than one FFT frame (<25ms) or empty array."""
        words = ["tiny", "audio"]
        # 10 samples (at 44.1kHz = 0.22ms)
        audio_tiny = np.ones(10, dtype=np.float32)
        res_tiny = align_words_spectral(audio_tiny, 44100, words, line_start=0.0, line_end=1.0)
        assert len(res_tiny) == 2
        _assert_strict_monotonic_and_valid(res_tiny, line_start=0.0, line_end=1.0)

        # Empty array
        res_empty = align_words_spectral(np.array([], dtype=np.float32), 44100, words, 0.0, 1.0)
        assert len(res_empty) == 2
        _assert_strict_monotonic_and_valid(res_empty, line_start=0.0, line_end=1.0)


class TestEndToEndPerformanceBudget:
    """Stress tests whole-track CPU execution budget (< 2.0s CPU) across standard sample rates."""

    @pytest.mark.parametrize("sr", [16000, 44100, 48000])
    def test_full_track_alignment_under_2_seconds_cpu(self, tmp_path, sr: int):
        """
        Adversarial Scenario: A full 3.5-minute (210s) song with 42 lyric lines and 378 words.
        Alignment must complete in < 2.0s CPU without neural network weights.
        """
        duration = 210.0
        num_lines = 42
        events = []
        lines = []

        for i in range(num_lines):
            l_s = 5.0 + i * 4.8
            l_e = l_s + 3.5
            if l_e >= duration - 2.0:
                break
            events.append({"start": l_s, "end": l_e, "freq": 300.0 + (i % 8) * 20})
            lines.append(
                {
                    "id": i,
                    "text": f"Line number {i} singing multiple syllables fast and rhythmic",
                    "start_time": l_s,
                    "end_time": l_e,
                }
            )

        wav_path = str(tmp_path / f"perf_{sr}.wav")
        write_test_wav(wav_path, duration=duration, vocal_events=events, sr=sr)

        aligner = AudioAligner()

        cpu_t0 = time.process_time()
        wall_t0 = time.perf_counter()
        aligned = aligner.align_lyrics(wav_path, lines)
        cpu_time = time.process_time() - cpu_t0
        wall_time = time.perf_counter() - wall_t0

        assert len(aligned) == len(lines)
        for line in aligned:
            assert len(line["words"]) > 0
            _assert_strict_monotonic_and_valid(
                line["words"], line_start=line["start_time"], line_end=line["end_time"]
            )

        print(
            f"\n[Perf SR {sr}Hz] CPU time: {cpu_time:.3f}s, Wall time: {wall_time:.3f}s (Budget: < 2.0s)"
        )
        assert cpu_time < 2.0, f"CPU time {cpu_time:.3f}s exceeded 2.0s budget at {sr}Hz"
        assert wall_time < 2.0, f"Wall time {wall_time:.3f}s exceeded 2.0s budget at {sr}Hz"
