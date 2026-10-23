"""
Adversarial Stress Test Suite for Milestone 2 Remediation (R2).
Authored and executed by Challenger M2_4 (Empirical Challenger: Critic & Specialist).

Stress-tests:
1. Extended Stationary Noise Varieties (Continuous Drones, DTMF, Mains Hum, Vinyl Crackle, AM Noise)
2. Adversarial Uncorrelated Lyric Candidates (Aperiodic Interleaved, Dense Rap vs Ballad, Temporal Beat Mismatch, High-Line Count)
3. Extended Monte Carlo False Acceptance Rate (FAR) under diverse duty cycles with realistic line counts
4. Asymmetric & Multi-Peak Plateau Resolutions and Parabolic Peak Refinement
5. Boundary Limits, Multi-Channel Formats, and Sub-Threshold Preservation in AudioAligner
"""

import math

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import AudioAligner, estimate_global_offset

# ==============================================================================
# SUITE 1: EXTENDED STATIONARY NOISE VARIETIES
# ==============================================================================


class TestStationaryNoiseVarieties:
    """Stress tests candidate verification against complex acoustic noise varieties lacking singing."""

    @pytest.fixture
    def standard_lyrics(self):
        return [
            {"id": 0, "text": "Line one lyrical verse", "start_time": 3.0, "end_time": 6.0},
            {"id": 1, "text": "Line two lyrical verse", "start_time": 8.0, "end_time": 12.0},
            {"id": 2, "text": "Line three lyrical verse", "start_time": 15.0, "end_time": 19.0},
        ]

    def test_rejection_dtmf_dual_tone(self, standard_lyrics):
        """Continuous telephony dual-tone (e.g. 350 Hz + 440 Hz dial tone) must be rejected."""
        sr = 44100
        dur = 25.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        dial_tone = (
            0.25 * np.sin(2 * np.pi * 350 * t) + 0.25 * np.sin(2 * np.pi * 440 * t)
        ).astype(np.float32)
        offset, conf = estimate_global_offset(dial_tone, sr, standard_lyrics)
        assert conf < 0.15, f"Dial tone falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_pipe_organ_harmonic_drone(self, standard_lyrics):
        """Multi-harmonic stationary drone (110Hz, 220Hz, 440Hz, 880Hz, 1760Hz) must be rejected."""
        sr = 44100
        dur = 25.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        drone = np.zeros_like(t, dtype=np.float32)
        harmonics = [110.0, 220.0, 440.0, 880.0, 1760.0]
        weights = [0.3, 0.25, 0.2, 0.15, 0.1]
        for f, w in zip(harmonics, weights, strict=False):
            drone += (w * np.sin(2 * np.pi * f * t)).astype(np.float32)
        offset, conf = estimate_global_offset(drone, sr, standard_lyrics)
        assert conf < 0.15, f"Harmonic organ drone falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_european_50hz_mains_hum(self, standard_lyrics):
        """Continuous 50Hz electrical buzz with odd harmonics must be rejected."""
        sr = 44100
        dur = 25.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        hum = (
            0.30 * np.sin(2 * np.pi * 50 * t)
            + 0.15 * np.sin(2 * np.pi * 150 * t)
            + 0.08 * np.sin(2 * np.pi * 250 * t)
        ).astype(np.float32)
        offset, conf = estimate_global_offset(hum, sr, standard_lyrics)
        assert conf < 0.15, f"50Hz mains buzz falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_synthesizer_chorus_pad(self, standard_lyrics):
        """Continuous synthesizer pad with slight pitch vibrato (frequency modulation) must be rejected."""
        sr = 44100
        dur = 25.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        mod = 5.0 * np.sin(2 * np.pi * 4.0 * t)  # 4Hz vibrato, 5Hz depth
        synth = (0.4 * np.sin(2 * np.pi * (261.63 * t + mod))).astype(np.float32)
        offset, conf = estimate_global_offset(synth, sr, standard_lyrics)
        assert conf < 0.15, f"Chorus synth pad falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_vinyl_surface_hiss_and_crackle(self, standard_lyrics):
        """Continuous vinyl surface hiss with stochastic impulse crackle must be rejected."""
        sr = 44100
        dur = 25.0
        n = int(sr * dur)
        rng = np.random.RandomState(4242)
        # Hiss (low-passed white noise)
        white = rng.normal(0, 0.08, n).astype(np.float32)
        # Random crackle spikes (10 per second)
        crackle_locs = rng.choice(n, size=int(10 * dur), replace=False)
        white[crackle_locs] += rng.uniform(0.3, 0.7, size=len(crackle_locs)).astype(np.float32)
        offset, conf = estimate_global_offset(white, sr, standard_lyrics)
        assert conf < 0.15, f"Vinyl crackle falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_nyquist_frequency_tone(self, standard_lyrics):
        """Extreme alternating +1/-1 signal at Nyquist frequency (sample_rate / 2) must be rejected."""
        sr = 44100
        dur = 20.0
        n = int(sr * dur)
        nyquist = np.ones(n, dtype=np.float32)
        nyquist[1::2] = -1.0
        nyquist *= 0.5
        offset, conf = estimate_global_offset(nyquist, sr, standard_lyrics)
        assert conf < 0.15
        assert offset == 0.0

    def test_rejection_shallow_amplitude_modulated_noise(self, standard_lyrics):
        """White noise with shallow 20% amplitude modulation (still has high noise floor) must be rejected."""
        sr = 44100
        dur = 25.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        rng = np.random.RandomState(888)
        raw_noise = rng.normal(0, 0.1, len(t)).astype(np.float32)
        am_envelope = (1.0 + 0.2 * np.sin(2 * np.pi * 0.5 * t)).astype(np.float32)
        modulated_noise = raw_noise * am_envelope
        offset, conf = estimate_global_offset(modulated_noise, sr, standard_lyrics)
        assert conf < 0.15, f"Shallow AM noise falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0


# ==============================================================================
# SUITE 2: ADVERSARIAL UNCORRELATED LYRIC CANDIDATES
# ==============================================================================


class TestAdversarialUncorrelatedLyrics:
    """Stress tests evaluating candidate rejection with adversarial lyric timing structures."""

    @pytest.fixture
    def structured_ballad_audio(self):
        """Vocal track with 5 distinct vocal phrases spaced with varying aperiodic intervals."""
        sr = 44100
        dur = 60.0
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        phrases = [(5.0, 9.0), (14.0, 18.0), (25.0, 29.0), (39.0, 43.0), (51.0, 55.0)]
        for s, e in phrases:
            audio[int(s * sr) : int(e * sr)] = 0.5 * np.sin(
                2 * np.pi * 330 * t[int(s * sr) : int(e * sr)]
            )
        return audio, sr

    def test_rejection_mismatched_pacing_candidate(self, structured_ballad_audio):
        """Candidate lines with completely mismatched inter-phrase tempo and pacing must be rejected."""
        audio, sr = structured_ballad_audio
        # Audio phrases are spaced at: 5-9, 14-18, 25-29, 39-43, 51-55 (spacing 9s to 14s)
        # Candidate has rapid 2.5s lines spaced every 4s to 5s (incompatible pacing):
        uncorrelated_lines = [
            {"id": 0, "text": "Verse 1", "start_time": 5.0, "end_time": 7.5},
            {"id": 1, "text": "Verse 2", "start_time": 9.0, "end_time": 11.5},
            {"id": 2, "text": "Verse 3", "start_time": 14.0, "end_time": 16.5},
            {"id": 3, "text": "Verse 4", "start_time": 20.0, "end_time": 22.5},
            {"id": 4, "text": "Verse 5", "start_time": 25.0, "end_time": 27.5},
            {"id": 5, "text": "Verse 6", "start_time": 30.0, "end_time": 32.5},
        ]
        offset, conf = estimate_global_offset(audio, sr, uncorrelated_lines, max_offset=8.0)
        assert conf < 0.15, (
            f"Uncorrelated pacing candidate falsely accepted with confidence {conf:.4f}"
        )
        assert offset == 0.0

    def test_global_offset_recovery_on_valid_shifted_candidate(self, structured_ballad_audio):
        """Candidate lines matching audio phrases shifted systematically by +6.0s must be recovered."""
        audio, sr = structured_ballad_audio
        # Audio sings at: 5-9, 14-18, 25-29, 39-43, 51-55
        # Candidate lines systematically lead audio by -6.0s (audio occurs 6s later):
        shifted_lines = [
            {"id": 0, "text": "Line 0", "start_time": 11.0, "end_time": 15.0},
            {"id": 1, "text": "Line 1", "start_time": 20.0, "end_time": 24.0},
            {"id": 2, "text": "Line 2", "start_time": 31.0, "end_time": 35.0},
            {"id": 3, "text": "Line 3", "start_time": 45.0, "end_time": 49.0},
        ]
        offset, conf = estimate_global_offset(audio, sr, shifted_lines, max_offset=8.0)
        # Shift is -6.0s
        err = abs(offset - (-6.0))
        assert err <= 0.050, f"Offset recovery error {err * 1000:.1f}ms exceeds 50ms (got {offset})"
        assert conf >= 0.20

    def test_rejection_rapid_spoken_word_staccato_candidate(self, structured_ballad_audio):
        """Candidate with 40 ultra-rapid staccato lines (0.3s line, 0.2s pause) against smooth ballad."""
        audio, sr = structured_ballad_audio
        rapid_lines = [
            {
                "id": i,
                "text": f"Syllable {i}",
                "start_time": 5.0 + i * 0.5,
                "end_time": 5.0 + i * 0.5 + 0.3,
            }
            for i in range(40)
        ]
        offset, conf = estimate_global_offset(audio, sr, rapid_lines, max_offset=10.0)
        assert conf < 0.15, f"Rapid staccato candidate falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_temporal_period_mismatch(self):
        """Audio sings with period 7s, candidate lines pulse with period 11s. Must reject beat mismatch."""
        sr = 44100
        dur = 77.0
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for start in np.arange(5.0, dur - 5.0, 7.0):
            s, e = start, start + 3.0
            audio[int(s * sr) : int(e * sr)] = 0.5 * np.sin(
                2 * np.pi * 400 * t[int(s * sr) : int(e * sr)]
            )

        mismatched_lines = [
            {
                "id": i,
                "text": f"Line {i}",
                "start_time": float(start),
                "end_time": float(start + 3.0),
            }
            for i, start in enumerate(np.arange(5.0, dur - 5.0, 11.0))
        ]
        offset, conf = estimate_global_offset(audio, sr, mismatched_lines, max_offset=15.0)
        assert conf < 0.15, f"Period mismatch candidate falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_candidate_with_inverted_or_zero_duration_lines(
        self, structured_ballad_audio
    ):
        """Candidate containing malformed lines (end <= start) among valid lines must not crash or trigger false offset."""
        audio, sr = structured_ballad_audio
        malformed_lines = [
            {"id": 0, "text": "Valid line", "start_time": 10.0, "end_time": 14.0},
            {"id": 1, "text": "Zero duration", "start_time": 18.0, "end_time": 18.0},
            {"id": 2, "text": "Inverted duration", "start_time": 25.0, "end_time": 22.0},
            {"id": 3, "text": "Negative times", "start_time": -5.0, "end_time": -1.0},
        ]
        _offset, conf = estimate_global_offset(audio, sr, malformed_lines, max_offset=5.0)
        assert conf < 0.50

    def test_rejection_candidate_extending_far_beyond_audio_duration(self, structured_ballad_audio):
        """Candidate lasting 300 seconds fed against a 60 second audio file."""
        audio, sr = structured_ballad_audio
        long_lines = [
            {
                "id": i,
                "text": f"Line {i}",
                "start_time": float(i * 10),
                "end_time": float(i * 10 + 6),
            }
            for i in range(30)
        ]
        offset, conf = estimate_global_offset(audio, sr, long_lines, max_offset=15.0)
        assert conf < 0.15, f"Over-long candidate falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    @pytest.mark.parametrize("duty_cycle", [0.15, 0.30, 0.50, 0.70])
    def test_monte_carlo_diverse_duty_cycle_far(self, duty_cycle):
        """Evaluates False Acceptance Rate across random candidates with realistic line counts (12-16 lines)."""
        sr = 44100
        dur = 120.0
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        phrases = [
            (15.0, 18.0),
            (19.0, 22.0),
            (24.0, 28.0),
            (45.0, 49.0),
            (50.0, 54.0),
            (56.0, 60.0),
            (61.0, 64.0),
            (75.0, 78.0),
            (80.0, 83.0),
            (85.0, 89.0),
            (95.0, 99.0),
            (101.0, 105.0),
            (107.0, 111.0),
            (112.0, 115.0),
        ]
        for s, e in phrases:
            audio[int(s * sr) : int(e * sr)] = 0.5 * np.sin(
                2 * np.pi * 320.0 * t[int(s * sr) : int(e * sr)]
            )

        rng = np.random.RandomState(int(duty_cycle * 1000) + 19)
        trials = 30
        false_accepts = 0

        for _trial in range(trials):
            lines = []
            curr = rng.uniform(5.0, 15.0)
            while curr < dur - 10.0:
                line_dur = rng.uniform(2.5, 5.0)
                gap = line_dur * (1.0 - duty_cycle) / duty_cycle
                lines.append(
                    {
                        "id": len(lines),
                        "text": "Word",
                        "start_time": curr,
                        "end_time": curr + line_dur,
                    }
                )
                curr += line_dur + gap
            if len(lines) < 6:
                continue
            _offset, conf = estimate_global_offset(audio, sr, lines, max_offset=15.0)
            if conf >= 0.15:
                false_accepts += 1

        far = false_accepts / trials
        assert far <= 0.10, (
            f"Duty cycle {duty_cycle}: FAR {far * 100:.1f}% exceeds 10% maximum tolerance"
        )


# ==============================================================================
# SUITE 3: PLATEAU RESOLUTIONS & PEAK INTERPOLATION
# ==============================================================================


class TestPlateauAndPeakInterpolation:
    """Stress tests plateau resolution, ambiguity breaking, and parabolic peak interpolation."""

    def test_asymmetric_embedded_phrase_plateau(self):
        """Phrase of 2.0s inside a line of 6.0s embedded at the trailing edge."""
        sr = 44100
        dur = 30.0
        # Line is 5.0 to 11.0 (dur = 6.0s)
        # Phrase is 2.0s long at 9.0s to 11.0s.
        lines = [
            {"id": 0, "text": "Line 1", "start_time": 5.0, "end_time": 11.0},
            {"id": 1, "text": "Line 2", "start_time": 15.0, "end_time": 21.0},
        ]
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        phrases = [(9.0, 11.0), (19.0, 21.0)]
        for s, e in phrases:
            audio[int(s * sr) : int(e * sr)] = 0.5 * np.sin(
                2 * np.pi * 440 * t[int(s * sr) : int(e * sr)]
            )

        offset, conf = estimate_global_offset(audio, sr, lines, max_offset=10.0)
        # Phrase is already inside the line at offset 0.0, so plateau resolution must select offset = 0.0
        assert offset == 0.0, f"Expected offset 0.0 on embedded plateau, got {offset}"
        assert conf >= 0.15

    @pytest.mark.parametrize("sub_frame_shift", [0.005, 0.012, -0.007, -0.015])
    def test_sub_frame_parabolic_peak_accuracy(self, sub_frame_shift):
        """Tests that isolated correlation peak with sub-frame fractional shift is recovered by parabolic fit."""
        sr = 44100
        dur = 30.0
        shift = 2.0 + sub_frame_shift
        lines = [
            {"id": 0, "text": "Phrase 1", "start_time": 4.0, "end_time": 7.0},
            {"id": 1, "text": "Phrase 2", "start_time": 10.0, "end_time": 13.0},
            {"id": 2, "text": "Phrase 3", "start_time": 17.0, "end_time": 20.0},
        ]
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + shift) * sr)
            e = int((line_item["end_time"] + shift) * sr)
            audio[s:e] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])

        offset, conf = estimate_global_offset(audio, sr, lines, max_offset=10.0)
        err = abs(offset - shift)
        assert err <= 0.015, (
            f"Sub-frame shift {shift}s recovered as {offset}s (error {err * 1000:.1f}ms > 15ms)"
        )
        assert conf >= 0.70

    def test_exact_max_offset_boundary(self):
        """Signal shifted by exactly +15.0s (the default max_offset). Must be recovered without clipping."""
        sr = 44100
        dur = 45.0
        shift = 15.0
        lines = [
            {"id": 0, "text": "Line 1", "start_time": 2.0, "end_time": 6.0},
            {"id": 1, "text": "Line 2", "start_time": 8.0, "end_time": 12.0},
            {"id": 2, "text": "Line 3", "start_time": 15.0, "end_time": 19.0},
        ]
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + shift) * sr)
            e = int((line_item["end_time"] + shift) * sr)
            audio[s:e] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])

        offset, conf = estimate_global_offset(audio, sr, lines, max_offset=15.0)
        err = abs(offset - shift)
        assert err <= 0.040, (
            f"Boundary +15.0s offset recovered as {offset}s (err {err * 1000:.1f}ms)"
        )
        assert conf >= 0.70

    def test_exceeding_max_offset_is_safely_ignored(self):
        """Signal shifted by +18.0s when max_offset is 15.0s. Must not return out-of-bounds offset."""
        sr = 44100
        dur = 45.0
        shift = 18.0
        lines = [
            {"id": 0, "text": "Line 1", "start_time": 2.0, "end_time": 6.0},
            {"id": 1, "text": "Line 2", "start_time": 8.0, "end_time": 12.0},
        ]
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + shift) * sr)
            e = int((line_item["end_time"] + shift) * sr)
            audio[s:e] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])

        offset, conf = estimate_global_offset(audio, sr, lines, max_offset=15.0)
        assert abs(offset) <= 15.0
        if conf < 0.15:
            assert offset == 0.0


# ==============================================================================
# SUITE 4: ROBUSTNESS & PIPELINE THRESHOLDING IN AUDIOALIGNER
# ==============================================================================


class TestAudioAlignerIntegrationAndRobustness:
    """Stress tests verifying AudioAligner respects thresholding and preserves timestamps."""

    def test_audio_aligner_preserves_timestamps_on_sub_threshold_offset(self, tmp_path):
        """Small offsets (< 0.10s) must NOT alter original line timestamps in AudioAligner.align_lyrics."""
        sr = 44100
        dur = 20.0
        lines = [
            {"id": 0, "text": "Hello world", "start_time": 2.0, "end_time": 5.0},
            {"id": 1, "text": "Singing along", "start_time": 7.0, "end_time": 10.0},
        ]
        # Audio shifted by only 0.05s (50ms)
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + 0.05) * sr)
            e = int((line_item["end_time"] + 0.05) * sr)
            audio[s:e] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])

        wav_file = tmp_path / "vocals_small_shift.wav"
        sf.write(str(wav_file), audio, sr)

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        # Line 0 start_time must remain exactly 2.0 (untouched because offset 0.05 < 0.10s threshold)
        assert aligned[0]["start_time"] == 2.0
        assert aligned[1]["start_time"] == 7.0

    def test_audio_aligner_applies_offset_on_strong_shift(self, tmp_path):
        """Offsets >= 0.10s with confidence >= 0.20 MUST shift line timestamps in AudioAligner.align_lyrics."""
        sr = 44100
        dur = 25.0
        lines = [
            {"id": 0, "text": "Hello world", "start_time": 2.0, "end_time": 5.0},
            {"id": 1, "text": "Singing along", "start_time": 7.0, "end_time": 10.0},
            {"id": 2, "text": "Final phrase", "start_time": 12.0, "end_time": 15.0},
        ]
        shift = 2.50
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + shift) * sr)
            e = int((line_item["end_time"] + shift) * sr)
            audio[s:e] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])

        wav_file = tmp_path / "vocals_strong_shift.wav"
        sf.write(str(wav_file), audio, sr)

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        # Line 0 start_time should be shifted by ~2.50s (within 50ms)
        expected = 2.0 + shift
        assert abs(aligned[0]["start_time"] - expected) <= 0.050

    def test_large_amplitude_audio_normalization(self):
        """Audio with extreme amplitude (> 1000.0) does not overflow float32 or cause NaN."""
        sr = 44100
        dur = 20.0
        lines = [
            {"id": 0, "text": "Loud line", "start_time": 2.0, "end_time": 5.0},
            {"id": 1, "text": "Loud line 2", "start_time": 7.0, "end_time": 10.0},
        ]
        shift = 1.5
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + shift) * sr)
            e = int((line_item["end_time"] + shift) * sr)
            audio[s:e] = 5000.0 * np.sin(2 * np.pi * 440 * t[s:e])

        offset, conf = estimate_global_offset(audio, sr, lines)
        assert math.isfinite(offset) and math.isfinite(conf)
        err = abs(offset - shift)
        assert err <= 0.040
        assert conf >= 0.70

    def test_multichannel_audio_handling(self):
        """Multi-channel (4-channel audio) with vocals on 2 channels is processed accurately."""
        sr = 44100
        dur = 20.0
        lines = [
            {"id": 0, "text": "Line 1", "start_time": 2.0, "end_time": 5.0},
            {"id": 1, "text": "Line 2", "start_time": 7.0, "end_time": 10.0},
        ]
        shift = 1.0
        n = int(sr * dur)
        audio_4ch = np.zeros((n, 4), dtype=np.float32)
        t = np.linspace(0, dur, n, endpoint=False)
        for line_item in lines:
            s = int((line_item["start_time"] + shift) * sr)
            e = int((line_item["end_time"] + shift) * sr)
            audio_4ch[s:e, 0] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])
            audio_4ch[s:e, 1] = 0.5 * np.sin(2 * np.pi * 440 * t[s:e])

        offset, conf = estimate_global_offset(audio_4ch, sr, lines)
        err = abs(offset - shift)
        assert err <= 0.040
        assert conf >= 0.70

    def test_rejection_babble_cocktail_party_noise(self):
        """Babble cocktail party noise (superposition of 50 asynchronous sinusoidal voices) is rejected."""
        sr = 44100
        dur = 25.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)
        rng = np.random.RandomState(999)
        babble = np.zeros_like(t, dtype=np.float32)
        for _ in range(50):
            f = rng.uniform(120.0, 3200.0)
            phase = rng.uniform(0.0, 2 * np.pi)
            babble += (0.02 * np.sin(2 * np.pi * f * t + phase)).astype(np.float32)

        lines = [
            {"id": 0, "text": "Phrase 1", "start_time": 3.0, "end_time": 6.0},
            {"id": 1, "text": "Phrase 2", "start_time": 8.0, "end_time": 12.0},
            {"id": 2, "text": "Phrase 3", "start_time": 15.0, "end_time": 19.0},
        ]
        offset, conf = estimate_global_offset(babble, sr, lines)
        assert conf < 0.15, f"Babble noise falsely accepted with confidence {conf:.4f}"
        assert offset == 0.0

    def test_rejection_multi_phrase_inverted_temporal_structure(self):
        """Candidate with inverted inter-phrase pacing across 7 phrases must be rejected."""
        sr = 44100
        dur = 80.0
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        audio_phrases = [
            (2.0, 5.0),
            (8.0, 11.0),
            (20.0, 23.0),
            (32.0, 35.0),
            (45.0, 48.0),
            (60.0, 63.0),
            (70.0, 73.0),
        ]
        for s, e in audio_phrases:
            audio[int(s * sr) : int(e * sr)] = 0.5 * np.sin(
                2 * np.pi * 440 * t[int(s * sr) : int(e * sr)]
            )

        cand_lines = [
            {"id": 0, "text": "L0", "start_time": 2.0, "end_time": 5.0},
            {"id": 1, "text": "L1", "start_time": 12.0, "end_time": 15.0},
            {"id": 2, "text": "L2", "start_time": 27.0, "end_time": 30.0},
            {"id": 3, "text": "L3", "start_time": 40.0, "end_time": 43.0},
            {"id": 4, "text": "L4", "start_time": 52.0, "end_time": 55.0},
            {"id": 5, "text": "L5", "start_time": 64.0, "end_time": 67.0},
            {"id": 6, "text": "L6", "start_time": 70.0, "end_time": 73.0},
        ]
        offset, conf = estimate_global_offset(audio, sr, cand_lines, max_offset=10.0)
        assert conf < 0.15, (
            f"Inverted structure candidate falsely accepted with confidence {conf:.4f}"
        )
        assert offset == 0.0

    def test_robustness_ultra_short_audio(self):
        """Audio shorter than a single 20ms analysis frame (< 882 samples) returns safely without exception."""
        sr = 44100
        audio = np.ones(100, dtype=np.float32) * 0.1
        lines = [{"id": 0, "text": "T", "start_time": 1.0, "end_time": 3.0}]
        offset, conf = estimate_global_offset(audio, sr, lines)
        assert offset == 0.0 and conf == 0.0

    def test_robustness_max_offset_zero(self):
        """Zero max_offset returns offset 0.0 safely without exception."""
        sr = 44100
        dur = 10.0
        audio = np.zeros(int(sr * dur), dtype=np.float32)
        t = np.linspace(0, dur, len(audio), endpoint=False)
        audio[int(2.0 * sr) : int(5.0 * sr)] = 0.5 * np.sin(
            2 * np.pi * 440 * t[int(2.0 * sr) : int(5.0 * sr)]
        )
        lines = [{"id": 0, "text": "T", "start_time": 2.0, "end_time": 5.0}]
        offset, _conf = estimate_global_offset(audio, sr, lines, max_offset=0.0)
        assert offset == 0.0

    def test_robustness_nan_in_lines_and_nan_inf_audio(self):
        """Audio containing NaN/Inf and lines containing NaN are handled defensively without crash."""
        sr = 44100
        audio = np.array(
            [0.5, float("nan"), -0.5, float("inf"), float("-inf"), 0.2] * 7000, dtype=np.float32
        )
        lines = [
            {"id": 0, "text": "Valid", "start_time": 2.0, "end_time": 5.0},
            {"id": 1, "text": "NaN", "start_time": float("nan"), "end_time": float("nan")},
        ]
        offset, conf = estimate_global_offset(audio, sr, lines)
        assert math.isfinite(offset) and math.isfinite(conf)
        assert offset == 0.0 and conf == 0.0
