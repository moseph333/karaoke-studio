"""Empirical adversarial stress-testing suite for Milestone 2: Aligner Global Offset Recovery.

Adversarial coverage:
1. Extreme global shift recovery across [-15.0s, +15.0s], horizon boundaries, and expanded search horizons.
2. Fractional sub-frame offsets testing continuous parabolic interpolation resolution (< 20ms).
3. Comprehensive sample rate invariance matrix (8kHz, 11.025kHz, 16kHz, 22.05kHz, 32kHz, 44.1kHz, 48kHz, 88.2kHz, 96kHz).
4. Extreme audio values: massive float scales (up to 1e37), quiet audio, pure silence, DC offsets, DC bias, stereo phase cancellation, and NaNs/Infs.
5. Pathological lyrics and duration asymmetry: inverted line timings, zero-length lines, extreme duration mismatch.
6. Pipeline integration via AudioAligner.align_lyrics: timestamp non-negativity and strict monotonicity under extreme shifts.
"""

import math
from typing import Any

import numpy as np
import pytest

from backend.services.aligner import AudioAligner, estimate_global_offset


def synthesize_vocal_track(
    phrases: list[tuple[float, float]],
    total_duration: float,
    sample_rate: int = 44100,
    carrier_freq: float = 440.0,
    amplitude: float = 0.6,
) -> np.ndarray:
    """Synthesizes a multi-phrase tonal vocal signal with silent gaps."""
    n_samples = max(1, round(total_duration * sample_rate))
    t = np.linspace(0, total_duration, n_samples, endpoint=False, dtype=np.float32)
    audio = np.zeros(n_samples, dtype=np.float32)

    for i, (s, e) in enumerate(phrases):
        if s < total_duration and e > 0:
            s_clamp = max(0.0, s)
            e_clamp = min(total_duration, e)
            if e_clamp > s_clamp:
                mask = (t >= s_clamp) & (t <= e_clamp)
                f = carrier_freq * (1.0 + 0.1 * (i % 3))
                audio[mask] = amplitude * np.sin(2.0 * np.pi * f * t[mask])

    return audio


class TestExtremeGlobalShiftRecovery:
    """Stress-tests recovery accuracy of estimate_global_offset across extreme positive and negative shifts."""

    @pytest.fixture
    def realistic_ballad_lyrics(self) -> list[dict[str, Any]]:
        return [
            {"id": 1, "text": "First line of the song", "start_time": 6.0, "end_time": 9.5},
            {"id": 2, "text": "Second line goes here", "start_time": 12.0, "end_time": 15.0},
            {"id": 3, "text": "Chorus begins right now", "start_time": 18.0, "end_time": 22.0},
            {"id": 4, "text": "Chorus sustained note", "start_time": 23.5, "end_time": 28.0},
            {"id": 5, "text": "Outro fading softly", "start_time": 32.0, "end_time": 35.5},
        ]

    @pytest.mark.parametrize(
        "shift",
        [
            -15.0,
            -14.5,
            -13.0,
            -11.2,
            -9.0,
            -7.5,
            -5.0,
            -3.2,
            -2.0,
            -1.0,
            0.0,
            1.0,
            2.0,
            3.2,
            5.0,
            7.5,
            9.0,
            11.2,
            13.0,
            14.5,
            15.0,
        ],
    )
    def test_extreme_shifts_recovery_mae(
        self, shift: float, realistic_ballad_lyrics: list[dict[str, Any]]
    ):
        """Verifies all shifts across [-15.0s, +15.0s] are recovered within MAE <= 150ms and confidence >= 0.15."""
        sr = 44100
        total_duration = 55.0
        phrases = [
            (line["start_time"] + shift, line["end_time"] + shift)
            for line in realistic_ballad_lyrics
        ]

        audio = synthesize_vocal_track(phrases, total_duration, sample_rate=sr)
        recovered_offset, confidence = estimate_global_offset(
            audio, sr, realistic_ballad_lyrics, max_offset=15.0
        )

        error_ms = abs(recovered_offset - shift) * 1000.0
        assert error_ms <= 150.0, (
            f"Shift {shift:+.2f}s exceeded 150ms MAE threshold: recovered {recovered_offset:+.4f}s (error: {error_ms:.2f}ms)"
        )
        assert confidence >= 0.15, (
            f"Shift {shift:+.2f}s yielded low confidence {confidence:.4f} < 0.15"
        )

    def test_horizon_boundaries_and_beyond(self, realistic_ballad_lyrics: list[dict[str, Any]]):
        """Verifies boundary behavior exactly at horizon (15.0s) and beyond horizon (16.0s, 20.0s)."""
        sr = 44100
        total_duration = 65.0

        # Boundary at +15.0s
        phrases_15 = [
            (line["start_time"] + 15.0, line["end_time"] + 15.0) for line in realistic_ballad_lyrics
        ]
        audio_15 = synthesize_vocal_track(phrases_15, total_duration, sample_rate=sr)
        off_15, conf_15 = estimate_global_offset(
            audio_15, sr, realistic_ballad_lyrics, max_offset=15.0
        )
        assert abs(off_15 - 15.0) * 1000.0 <= 50.0
        assert conf_15 >= 0.15

        # Beyond default horizon (+18.0s) with max_offset=15.0
        phrases_18 = [
            (line["start_time"] + 18.0, line["end_time"] + 18.0) for line in realistic_ballad_lyrics
        ]
        audio_18 = synthesize_vocal_track(phrases_18, total_duration, sample_rate=sr)
        off_beyond, _conf_beyond = estimate_global_offset(
            audio_18, sr, realistic_ballad_lyrics, max_offset=15.0
        )
        # Search window is clamped to [-15s, +15s], so true peak at +18s is unreachable
        assert abs(off_beyond) <= 15.0
        assert math.isfinite(_conf_beyond)

        # Expanded horizon allows recovery of +18.0s shift
        off_exp, conf_exp = estimate_global_offset(
            audio_18, sr, realistic_ballad_lyrics, max_offset=25.0
        )
        assert abs(off_exp - 18.0) * 1000.0 <= 50.0
        assert conf_exp >= 0.60


class TestFractionalSubFrameInterpolation:
    """Stress-tests continuous sub-frame parabolic interpolation for offsets not aligned to 20ms grid."""

    @pytest.mark.parametrize(
        "frac_shift",
        [
            0.003,
            0.007,
            0.0135,
            0.0175,
            0.023,
            0.027,
            0.033,
            0.041,
            0.055,
            0.077,
            0.111,
            0.237,
            0.5432,
            1.4142,
            2.7182,
            5.4321,
            -0.003,
            -0.007,
            -0.0135,
            -0.0175,
            -0.023,
            -0.027,
            -0.033,
            -0.041,
            -0.055,
            -0.077,
            -0.111,
            -0.237,
            -0.5432,
            -1.4142,
            -2.7182,
            -5.4321,
        ],
    )
    def test_fractional_sub_frame_offset_mae(self, frac_shift: float):
        """Verifies sub-frame offsets achieve MAE <= 20ms due to parabolic peak interpolation."""
        sr = 44100
        lines = [
            {"start_time": 8.0, "end_time": 11.0, "text": "phrase alpha"},
            {"start_time": 14.0, "end_time": 17.0, "text": "phrase beta"},
            {"start_time": 20.0, "end_time": 23.5, "text": "phrase gamma"},
            {"start_time": 26.0, "end_time": 29.0, "text": "phrase delta"},
        ]
        total_duration = 45.0
        phrases = [
            (line["start_time"] + frac_shift, line["end_time"] + frac_shift) for line in lines
        ]
        audio = synthesize_vocal_track(phrases, total_duration, sample_rate=sr)

        recovered_offset, confidence = estimate_global_offset(audio, sr, lines, max_offset=15.0)
        error_ms = abs(recovered_offset - frac_shift) * 1000.0

        assert error_ms <= 20.0, (
            f"Sub-frame shift {frac_shift:+.4f}s error {error_ms:.2f}ms exceeded 20ms target"
        )
        assert confidence >= 0.70


class TestSampleRateMatrixInvariance:
    """Stress-tests global offset estimation across 9 different audio sample rates from 8kHz to 96kHz."""

    SAMPLE_RATES: tuple[int, ...] = (8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000)

    @pytest.mark.parametrize("sr", SAMPLE_RATES)
    def test_sample_rate_multi_shift_recovery(self, sr: int):
        """Verifies offset recovery accuracy (MAE <= 100ms) across various sample rates."""
        test_shifts = [-5.0, -1.8, 0.0, 2.5, 6.0]
        lines = [
            {"start_time": 8.0, "end_time": 11.0, "text": "multi rate phrase one"},
            {"start_time": 14.0, "end_time": 17.5, "text": "multi rate phrase two"},
            {"start_time": 20.0, "end_time": 23.0, "text": "multi rate phrase three"},
        ]
        total_duration = 35.0

        for shift in test_shifts:
            phrases = [(line["start_time"] + shift, line["end_time"] + shift) for line in lines]
            audio = synthesize_vocal_track(phrases, total_duration, sample_rate=sr)

            recovered_offset, confidence = estimate_global_offset(audio, sr, lines, max_offset=15.0)
            error_ms = abs(recovered_offset - shift) * 1000.0

            assert error_ms <= 100.0, (
                f"Sample rate {sr}Hz at shift {shift:+.2f}s had error {error_ms:.2f}ms > 100ms"
            )
            assert confidence >= 0.40, (
                f"Sample rate {sr}Hz at shift {shift:+.2f}s had low confidence {confidence:.3f}"
            )

    @pytest.mark.parametrize("sr", SAMPLE_RATES)
    def test_sample_rate_pure_silence_safety(self, sr: int):
        """Verifies pure silence at any sample rate returns (0.0, 0.0) without division-by-zero."""
        silent = np.zeros(sr * 5, dtype=np.float32)
        lines = [{"start_time": 1.0, "end_time": 3.0, "text": "silent test"}]

        offset, conf = estimate_global_offset(silent, sr, lines)
        assert offset == 0.0
        assert conf == 0.0


class TestExtremeAudioValuesAndPathologies:
    """Stress-tests numerical stability and safety under extreme values, clipping, DC, and corrupted data."""

    @pytest.fixture
    def test_lines(self) -> list[dict[str, Any]]:
        return [
            {"start_time": 2.0, "end_time": 4.5, "text": "line one"},
            {"start_time": 6.5, "end_time": 9.0, "text": "line two"},
        ]

    @pytest.mark.parametrize("scale", [1.0, 10.0, 1e4, 1e8, 1e16, 1e25, 1e36])
    def test_massive_positive_float_amplitudes(
        self, scale: float, test_lines: list[dict[str, Any]]
    ):
        """Verifies normalization prevents float squaring overflow up to 1e36."""
        sr = 44100
        audio = synthesize_vocal_track([(4.0, 6.5), (8.5, 11.0)], 14.0, sample_rate=sr)
        scaled_audio = (audio * scale).astype(np.float32)

        off, conf = estimate_global_offset(scaled_audio, sr, test_lines)
        assert math.isfinite(off)
        assert math.isfinite(conf)
        assert abs(off - 2.0) * 1000.0 <= 20.0
        assert conf >= 0.50

    @pytest.mark.parametrize("scale", [-1.0, -10.0, -1e6, -1e20, -1e36])
    def test_massive_negative_float_amplitudes(
        self, scale: float, test_lines: list[dict[str, Any]]
    ):
        """Verifies inverted phase with massive amplitudes recovers offset accurately."""
        sr = 44100
        audio = synthesize_vocal_track([(4.0, 6.5), (8.5, 11.0)], 14.0, sample_rate=sr)
        scaled_audio = (audio * scale).astype(np.float32)

        off, conf = estimate_global_offset(scaled_audio, sr, test_lines)
        assert math.isfinite(off)
        assert math.isfinite(conf)
        assert abs(off - 2.0) * 1000.0 <= 20.0
        assert conf >= 0.50

    @pytest.mark.parametrize("quiet_scale", [0.5, 0.1, 0.05, 0.01, 0.005])
    def test_low_amplitude_audio_recovery(
        self, quiet_scale: float, test_lines: list[dict[str, Any]]
    ):
        """Verifies low amplitude signals (-6dB down to -46dB) still recover offset."""
        sr = 44100
        audio = synthesize_vocal_track([(4.0, 6.5), (8.5, 11.0)], 14.0, sample_rate=sr)
        quiet_audio = (audio * quiet_scale).astype(np.float32)

        off, conf = estimate_global_offset(quiet_audio, sr, test_lines)
        assert abs(off - 2.0) * 1000.0 <= 20.0
        assert conf >= 0.50

    @pytest.mark.parametrize("dc_val", [0.5, -0.8, 10.0, -100.0, 1000.0])
    def test_pure_dc_offsets_rejection(self, dc_val: float, test_lines: list[dict[str, Any]]):
        """Verifies pure constant DC signals are safely rejected as zero offset and zero confidence."""
        sr = 44100
        dc_audio = np.full(sr * 10, dc_val, dtype=np.float32)

        off, conf = estimate_global_offset(dc_audio, sr, test_lines)
        assert off == 0.0
        assert conf == 0.0

    def test_vocal_with_small_dc_bias(self, test_lines: list[dict[str, Any]]):
        """Verifies vocal track with small ADC hardware DC bias (+0.02) recovers offset."""
        sr = 44100
        audio = synthesize_vocal_track([(4.0, 6.5), (8.5, 11.0)], 14.0, sample_rate=sr)
        audio_biased = audio + 0.02

        off, conf = estimate_global_offset(audio_biased, sr, test_lines)
        assert abs(off - 2.0) * 1000.0 <= 20.0
        assert conf >= 0.50

    def test_nan_inf_corrupted_arrays(self, test_lines: list[dict[str, Any]]):
        """Verifies arrays filled with or interspersed with NaNs and Infs do not crash."""
        sr = 44100
        corrupt = np.array([np.nan, np.inf, -np.inf, np.nan, 0.0], dtype=np.float32)
        off, conf = estimate_global_offset(corrupt, sr, test_lines)
        assert off == 0.0
        assert conf == 0.0

        # Interspersed NaNs in audio
        audio = synthesize_vocal_track([(4.0, 6.5), (8.5, 11.0)], 14.0, sample_rate=sr)
        audio[::100] = np.nan
        audio[1::200] = np.inf
        off_inter, conf_inter = estimate_global_offset(audio, sr, test_lines)
        assert math.isfinite(off_inter)
        assert math.isfinite(conf_inter)

    def test_multichannel_audio_and_phase_cancellation(self, test_lines: list[dict[str, Any]]):
        """Verifies multichannel downmix and inverted stereo phase cancellation safety."""
        sr = 44100
        audio = synthesize_vocal_track([(4.0, 6.5), (8.5, 11.0)], 14.0, sample_rate=sr)

        # 4-channel surround
        quad = np.stack([audio, audio * 0.8, audio * 0.6, audio * 0.4], axis=-1)
        off_quad, conf_quad = estimate_global_offset(quad, sr, test_lines)
        assert abs(off_quad - 2.0) * 1000.0 <= 20.0
        assert conf_quad >= 0.50

        # Exact out-of-phase stereo (L = audio, R = -audio -> downmix cancels to exact zero)
        out_of_phase = np.stack([audio, -audio], axis=-1)
        off_canc, conf_canc = estimate_global_offset(out_of_phase, sr, test_lines)
        assert off_canc == 0.0
        assert conf_canc == 0.0

    def test_pathological_lyrics_input(self):
        """Verifies degenerate or pathological line timing entries return safe defaults."""
        sr = 44100
        audio = synthesize_vocal_track([(2.0, 5.0)], 10.0, sample_rate=sr)

        # Inverted line (start > end)
        inverted = [{"start_time": 5.0, "end_time": 2.0, "text": "inverted"}]
        off, conf = estimate_global_offset(audio, sr, inverted)
        assert off == 0.0
        assert conf == 0.0

        # Zero length line (start == end)
        zero_len = [{"start_time": 3.0, "end_time": 3.0, "text": "zero"}]
        off, conf = estimate_global_offset(audio, sr, zero_len)
        assert off == 0.0
        assert conf == 0.0

        # Negative start and end times
        negative = [{"start_time": -5.0, "end_time": -2.0, "text": "negative"}]
        off, conf = estimate_global_offset(audio, sr, negative)
        assert math.isfinite(off)
        assert math.isfinite(conf)

    def test_duration_asymmetry(self):
        """Verifies extreme duration mismatches between audio and lyrics do not crash."""
        sr = 44100
        lines = [{"start_time": 2.0, "end_time": 4.0, "text": "short"}]

        # Very long audio (120s) with 4s lyrics
        long_audio = np.zeros(sr * 120, dtype=np.float32)
        long_audio[int(sr * 10) : int(sr * 12)] = 0.5
        off, conf = estimate_global_offset(long_audio, sr, lines, max_offset=15.0)
        assert math.isfinite(off)
        assert math.isfinite(conf)

        # Very short audio (0.05s, only 2 frames) with normal lyrics
        short_audio = np.zeros(int(sr * 0.05), dtype=np.float32)
        off_short, conf_short = estimate_global_offset(short_audio, sr, lines, max_offset=15.0)
        assert off_short == 0.0
        assert conf_short == 0.0


class TestPipelineIntegrationAndMonotonicityUnderExtremeShifts:
    """Stress-tests AudioAligner.align_lyrics timestamp integrity and word monotonicity under large shifts."""

    def test_align_lyrics_extreme_positive_shift_monotonicity(self, tmp_path):
        """Verifies +8.0s shift in align_lyrics shifts lines/words and enforces strict monotonicity."""
        sr = 44100
        duration = 25.0
        audio = synthesize_vocal_track([(10.0, 13.0), (16.0, 19.0)], duration, sample_rate=sr)

        audio_file = tmp_path / "extreme_pos_shift.wav"
        import soundfile as sf

        sf.write(str(audio_file), audio, sr)

        # Original unshifted lines at 2.0s and 8.0s (shift = +8.0s)
        lines = [
            {"id": 0, "text": "first line here", "start_time": 2.0, "end_time": 5.0, "words": []},
            {"id": 1, "text": "second line here", "start_time": 8.0, "end_time": 11.0, "words": []},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(audio_file), lines, auto_offset_correction=True)

        assert len(aligned) == 2
        # Lines should be shifted towards ~10.0s and ~16.0s
        assert aligned[0]["start_time"] >= 9.0
        assert aligned[0]["end_time"] > aligned[0]["start_time"]
        assert aligned[1]["start_time"] >= 15.0
        assert aligned[1]["end_time"] > aligned[1]["start_time"]

        for line_item in aligned:
            words = line_item["words"]
            assert len(words) == 3
            cur_t = line_item["start_time"]
            for w in words:
                assert w["start_time"] >= 0.0
                assert w["start_time"] < w["end_time"]
                assert w["start_time"] >= cur_t - 0.05
                cur_t = w["end_time"]

    def test_align_lyrics_extreme_negative_shift_clamping(self, tmp_path):
        """Verifies negative shift (-5.0s) clamps timestamps at >= 0.0 without invalid or negative times."""
        sr = 44100
        duration = 20.0
        audio = synthesize_vocal_track([(1.0, 4.0), (6.0, 9.0)], duration, sample_rate=sr)

        audio_file = tmp_path / "extreme_neg_shift.wav"
        import soundfile as sf

        sf.write(str(audio_file), audio, sr)

        # Original unshifted lines at 6.0s and 11.0s (shift = -5.0s)
        lines = [
            {"id": 0, "text": "early vocal note", "start_time": 6.0, "end_time": 9.0, "words": []},
            {
                "id": 1,
                "text": "later vocal note",
                "start_time": 11.0,
                "end_time": 14.0,
                "words": [],
            },
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(audio_file), lines, auto_offset_correction=True)

        assert len(aligned) == 2
        assert aligned[0]["start_time"] >= 0.0
        assert aligned[0]["start_time"] < aligned[0]["end_time"]
        assert aligned[1]["start_time"] > aligned[0]["start_time"]

        for line_item in aligned:
            words = line_item["words"]
            for w in words:
                assert w["start_time"] >= 0.0
                assert w["start_time"] < w["end_time"]
