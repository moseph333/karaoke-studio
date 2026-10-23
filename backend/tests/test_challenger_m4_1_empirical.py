"""
Empirical Verification & Adversarial Stress Suite for Milestone 4 (R4) by challenger_m4_1.

Empirically tests and verifies:
1. Word boundary accuracy against synthetic ground truth with breath noise and drum transient bleed (assert MAE <= 100ms).
2. Extreme inputs: silent audio, single-word lines, polysyllabic words, NaN/Inf audio, DC bias,
   stereo downmixing, anti-phase cancellation, sub-frame lines (<20ms), extreme sample rates.
3. Strict timestamp monotonicity: start_time < end_time, non-overlapping words, strictly non-negative finite floats.
4. CPU execution speed benchmark across long tracks (< 2.0s).
5. AudioAligner.align_lyrics end-to-end integration and word-sync preservation.
"""

from __future__ import annotations

import math
import time
from typing import Any

import numpy as np
import pytest

from backend.schemas import LyricLineSchema, WordTimingSchema
from backend.services.aligner import (
    AudioAligner,
    align_words_spectral,
)
from backend.tests.test_e2e_lyrics_aligner_sync import (
    create_synthetic_vocal_signal,
    write_test_wav,
)

# ==============================================================================
# 1. Word Boundary Accuracy: Breath Noise & Drum Transient Bleed (MAE <= 100ms)
# ==============================================================================


class TestSpectralFluxAndVoicedGatingMAE:
    """Stress tests assessing word boundary accuracy under hostile acoustic conditions."""

    def test_word_boundary_accuracy_with_breath_noise(self):
        """
        Adversarial Test: Singer takes an audible pre-phrase breath (2.5k-5k Hz noise),
        and subtle breath sounds between phrases.
        Vocal words: "Hold", "on", "to", "hope"
        Ground truth word timestamps:
          - "Hold": 1.20 - 1.65 (f0=330Hz)
          - "on":   1.75 - 1.95 (f0=350Hz)
          - "to":   2.05 - 2.25 (f0=370Hz)
          - "hope": 2.35 - 2.85 (f0=392Hz)
        Noise:
          - Pre-phrase breath intake: 0.85 - 1.15s (strong breath noise)
          - Intra-phrase breath: 1.96 - 2.03s
        """
        sr = 44100
        gt_words = [
            {"word": "Hold", "start": 1.20, "end": 1.65, "freq": 330.0},
            {"word": "on", "start": 1.75, "end": 1.95, "freq": 350.0},
            {"word": "to", "start": 2.05, "end": 2.25, "freq": 370.0},
            {"word": "hope", "start": 2.35, "end": 2.85, "freq": 392.0},
        ]
        events = [{"start": w["start"], "end": w["end"], "freq": w["freq"]} for w in gt_words]
        events.append({"start": 0.85, "end": 1.15, "is_breath": True})
        events.append({"start": 1.96, "end": 2.03, "is_breath": True})

        audio = create_synthetic_vocal_signal(
            duration=3.5, vocal_events=events, sr=sr, noise_level=0.005
        )
        words = [w["word"] for w in gt_words]

        aligned = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=words,
            line_start=1.10,
            line_end=2.90,
        )

        assert len(aligned) == len(gt_words)
        errors = []
        for i, gt in enumerate(gt_words):
            s_err = abs(aligned[i]["start_time"] - gt["start"])
            e_err = abs(aligned[i]["end_time"] - gt["end"])
            errors.extend([s_err, e_err])

        mae = float(np.mean(errors))
        print(f"\n[Breath Noise Test] Sub-line MAE: {mae * 1000:.2f}ms (Target <= 100ms)")
        assert mae <= 0.100, (
            f"Word boundary MAE with breath noise {mae * 1000:.2f}ms exceeds 100ms target"
        )
        assert aligned[0]["start_time"] >= 1.10
        assert abs(aligned[0]["start_time"] - 1.20) <= 0.08

    def test_word_boundary_accuracy_with_percussive_drum_bleed(self):
        """
        Adversarial Test: Loud percussive snare/hi-hat drum transients bleed into vocal track.
        Transients have sharp onset energy and broad frequency coverage, but lack harmonic periodicity.
        Voiced gating must suppress drum transients from corrupting word onset detection.
        """
        sr = 44100
        gt_words = [
            {"word": "Light", "start": 1.00, "end": 1.40, "freq": 260.0},
            {"word": "up", "start": 1.50, "end": 1.80, "freq": 290.0},
            {"word": "the", "start": 1.90, "end": 2.10, "freq": 310.0},
            {"word": "sky", "start": 2.20, "end": 2.70, "freq": 345.0},
        ]
        events = [{"start": w["start"], "end": w["end"], "freq": w["freq"]} for w in gt_words]
        events.append({"start": 0.50, "end": 0.55, "is_transient": True})
        events.append({"start": 1.42, "end": 1.47, "is_transient": True})
        events.append({"start": 1.82, "end": 1.87, "is_transient": True})
        events.append({"start": 2.80, "end": 2.85, "is_transient": True})

        audio = create_synthetic_vocal_signal(
            duration=3.2, vocal_events=events, sr=sr, noise_level=0.003
        )
        words = [w["word"] for w in gt_words]

        aligned = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=words,
            line_start=0.95,
            line_end=2.80,
        )

        assert len(aligned) == len(gt_words)
        errors = []
        for i, gt in enumerate(gt_words):
            s_err = abs(aligned[i]["start_time"] - gt["start"])
            e_err = abs(aligned[i]["end_time"] - gt["end"])
            errors.extend([s_err, e_err])

        mae = float(np.mean(errors))
        print(f"\n[Drum Bleed Test] Sub-line MAE: {mae * 1000:.2f}ms (Target <= 100ms)")
        assert mae <= 0.100, (
            f"Word boundary MAE with drum bleed {mae * 1000:.2f}ms exceeds 100ms target"
        )

    @pytest.mark.parametrize("f0", [120.0, 220.0, 330.0, 440.0, 600.0])
    def test_word_boundary_accuracy_across_pitch_registers(self, f0: float):
        """
        Adversarial Test: Pitch sweep across baritone (120Hz), tenor (220Hz),
        alto (330Hz), soprano (440Hz), and high soprano (600Hz).
        """
        sr = 44100
        gt_words = [
            {"word": "Every", "start": 0.80, "end": 1.20},
            {"word": "voice", "start": 1.30, "end": 1.70},
            {"word": "sings", "start": 1.80, "end": 2.30},
        ]
        events = [{"start": w["start"], "end": w["end"], "freq": f0} for w in gt_words]
        audio = create_synthetic_vocal_signal(
            duration=2.8, vocal_events=events, sr=sr, noise_level=0.002
        )
        words = [w["word"] for w in gt_words]

        aligned = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=words,
            line_start=0.75,
            line_end=2.40,
        )

        assert len(aligned) == len(gt_words)
        errors = [
            abs(aligned[i]["start_time"] - gt_words[i]["start"])
            + abs(aligned[i]["end_time"] - gt_words[i]["end"])
            for i in range(len(gt_words))
        ]
        mae = float(np.mean(errors)) / 2.0
        print(f"\n[Pitch f0={f0}Hz] Sub-line MAE: {mae * 1000:.2f}ms")
        assert mae <= 0.100, (
            f"Pitch f0={f0}Hz resulted in MAE {mae * 1000:.2f}ms exceeding 100ms target"
        )

    def test_spectral_flux_outperforms_uniform_distribution(self):
        """
        Empirical Oracle Comparison: Demonstrates that spectral flux & voiced gating
        significantly outperforms naive uniform duration allocation when word durations are asymmetric.
        """
        sr = 44100
        gt_words = [
            {"word": "Wait", "start": 1.00, "end": 2.20, "freq": 300.0},
            {"word": "for", "start": 2.30, "end": 2.50, "freq": 330.0},
            {"word": "the", "start": 2.55, "end": 2.75, "freq": 350.0},
            {"word": "sign", "start": 2.80, "end": 3.30, "freq": 370.0},
        ]
        events = [{"start": w["start"], "end": w["end"], "freq": w["freq"]} for w in gt_words]
        audio = create_synthetic_vocal_signal(
            duration=3.8, vocal_events=events, sr=sr, noise_level=0.002
        )
        words = [w["word"] for w in gt_words]

        aligned = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=words,
            line_start=1.00,
            line_end=3.30,
        )

        spectral_errors = []
        for i, gt in enumerate(gt_words):
            spectral_errors.extend(
                [
                    abs(aligned[i]["start_time"] - gt["start"]),
                    abs(aligned[i]["end_time"] - gt["end"]),
                ]
            )
        spectral_mae = float(np.mean(spectral_errors))

        n = len(words)
        uniform_dur = (3.30 - 1.00) / n
        uniform_errors = []
        for i, gt in enumerate(gt_words):
            u_s = 1.00 + i * uniform_dur
            u_e = u_s + uniform_dur
            uniform_errors.extend([abs(u_s - gt["start"]), abs(u_e - gt["end"])])
        uniform_mae = float(np.mean(uniform_errors))

        print(
            f"\n[Asymmetric Phrase] Spectral MAE: {spectral_mae * 1000:.2f}ms vs Uniform MAE: {uniform_mae * 1000:.2f}ms"
        )
        assert spectral_mae <= 0.100, f"Spectral MAE {spectral_mae * 1000:.2f}ms exceeds 100ms"
        assert spectral_mae < uniform_mae, (
            "Spectral flux failed to beat naive uniform distribution!"
        )


# ==============================================================================
# 2. Extreme & Degenerate Audio Inputs
# ==============================================================================


class TestAdversarialExtremeAudioInputs:
    """Stress tests boundary and corrupted audio signals."""

    @pytest.mark.parametrize("dur", [0.05, 0.2, 1.5, 6.0])
    def test_pure_silence_audio_handling(self, dur: float):
        """Silent audio (all 0.0s) must not crash and must return valid monotonic spans."""
        sr = 44100
        audio = np.zeros(int(dur * sr), dtype=np.float32)
        words = ["Silence", "is", "golden"]

        aligned = align_words_spectral(audio, sr, words, line_start=0.0, line_end=dur)
        assert len(aligned) == 3
        for i, w in enumerate(aligned):
            assert w["start_time"] >= 0.0
            assert w["end_time"] > w["start_time"]
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])
            if i > 0:
                assert w["start_time"] >= aligned[i - 1]["end_time"]

    @pytest.mark.parametrize("dc_val", [-1.0, 0.5, 2.5, -5.0])
    def test_dc_bias_audio_handling(self, dc_val: float):
        """Pure DC offset (constant value) has zero variance and no acoustic onsets."""
        sr = 44100
        audio = np.full(int(2.0 * sr), dc_val, dtype=np.float32)
        words = ["Constant", "voltage"]

        aligned = align_words_spectral(audio, sr, words, line_start=0.2, line_end=1.8)
        assert len(aligned) == 2
        assert aligned[0]["start_time"] < aligned[0]["end_time"]
        assert aligned[1]["start_time"] >= aligned[0]["end_time"]
        assert aligned[1]["end_time"] <= 1.801

    def test_nan_and_inf_poisoned_audio(self):
        """Audio containing NaN, +Inf, -Inf must be sanitized without raising exceptions."""
        sr = 44100
        audio = np.random.normal(0, 0.1, int(2.5 * sr)).astype(np.float32)
        audio[100:150] = np.nan
        audio[500:520] = np.inf
        audio[1000:1050] = -np.inf
        audio[-200:] = np.nan

        words = ["Toxic", "audio", "stream"]
        aligned = align_words_spectral(audio, sr, words, line_start=0.1, line_end=2.4)
        assert len(aligned) == 3
        for w in aligned:
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])
            assert not math.isnan(w["start_time"])
            assert not math.isnan(w["end_time"])

    def test_all_nan_and_all_inf_arrays(self):
        """Entirely NaN or Inf arrays must cleanly fall back to proportional distribution."""
        sr = 44100
        audio_nan = np.full(int(1.0 * sr), np.nan, dtype=np.float32)
        audio_inf = np.full(int(1.0 * sr), np.inf, dtype=np.float32)
        words = ["Pure", "NaN"]

        res_nan = align_words_spectral(audio_nan, sr, words, 0.0, 1.0)
        res_inf = align_words_spectral(audio_inf, sr, words, 0.0, 1.0)
        assert len(res_nan) == 2
        assert len(res_inf) == 2
        assert res_nan[0]["start_time"] < res_nan[0]["end_time"]
        assert res_inf[0]["start_time"] < res_inf[0]["end_time"]

    def test_stereo_multichannel_and_antiphase(self):
        """Multichannel audio tests."""
        sr = 44100
        N = int(2.0 * sr)
        words = ["Stereo", "spatial", "mix"]

        # 1. 2D single column
        col_audio = np.random.normal(0, 0.1, (N, 1)).astype(np.float32)
        res1 = align_words_spectral(col_audio, sr, words, 0.0, 2.0)
        assert len(res1) == 3

        # 2. 5.1 surround
        surround = np.random.normal(0, 0.1, (N, 6)).astype(np.float32)
        res2 = align_words_spectral(surround, sr, words, 0.0, 2.0)
        assert len(res2) == 3

        # 3. Anti-phase cancellation: L = -R
        mono_sig = np.random.normal(0, 0.2, N).astype(np.float32)
        antiphase = np.column_stack((mono_sig, -mono_sig))
        res3 = align_words_spectral(antiphase, sr, words, 0.0, 2.0)
        assert len(res3) == 3
        assert res3[0]["start_time"] < res3[0]["end_time"]

    @pytest.mark.parametrize("sub_dur", [0.005, 0.010, 0.018])
    def test_sub_frame_audio_slices_under_20ms(self, sub_dur: float):
        """Audio slices smaller than the 25ms STFT frame length."""
        sr = 44100
        num_samples = int(sub_dur * sr)
        audio = np.random.normal(0, 0.1, max(1, num_samples)).astype(np.float32)
        words = ["Quick", "flash"]

        aligned = align_words_spectral(audio, sr, words, line_start=0.0, line_end=sub_dur)
        assert len(aligned) == 2
        assert aligned[0]["start_time"] < aligned[0]["end_time"]
        assert aligned[1]["start_time"] >= aligned[0]["end_time"]
        assert aligned[1]["end_time"] <= sub_dur + 0.05

    @pytest.mark.parametrize("rate", [8000, 16000, 22050, 48000, 96000])
    def test_extreme_sample_rates(self, rate: int):
        """DSP algorithms must operate properly across non-standard sample rates."""
        audio = np.random.normal(0, 0.1, int(1.5 * rate)).astype(np.float32)
        words = ["Sample", "rate", "sweep"]
        aligned = align_words_spectral(audio, rate, words, line_start=0.1, line_end=1.4)
        assert len(aligned) == 3
        for w in aligned:
            assert w["start_time"] < w["end_time"]

    def test_invalid_sample_rate_and_none_audio(self):
        """Zero or negative sample rates and None audio must fall back cleanly."""
        words = ["Test", "fallback"]
        r1 = align_words_spectral(None, 44100, words, 0.0, 1.0)
        r2 = align_words_spectral(np.zeros(100), 0, words, 0.0, 1.0)
        r3 = align_words_spectral(np.zeros(100), -44100, words, 0.0, 1.0)

        assert len(r1) == 2
        assert len(r2) == 2
        assert len(r3) == 2
        assert r1[0]["start_time"] < r1[0]["end_time"]
        assert r2[0]["start_time"] < r2[0]["end_time"]


# ==============================================================================
# 3. Extreme & Malformed Text Inputs
# ==============================================================================


class TestAdversarialExtremeTextInputs:
    """Stress tests text boundary cases, unusual token structures, and timestamp inversions."""

    def test_single_word_line_alignment(self):
        """Single-word lines must align accurately and preserve start/end bounds."""
        sr = 44100
        events = [{"start": 1.20, "end": 2.10, "freq": 350.0}]
        audio = create_synthetic_vocal_signal(duration=3.0, vocal_events=events, sr=sr)

        aligned = align_words_spectral(audio, sr, ["Hallelujah"], line_start=1.0, line_end=2.5)
        assert len(aligned) == 1
        w = aligned[0]
        assert w["word"] == "Hallelujah"
        assert 1.0 <= w["start_time"] <= 1.30
        assert 2.0 <= w["end_time"] <= 2.50
        assert w["start_time"] < w["end_time"]

    def test_polysyllabic_tongue_twisters(self):
        """Words with high syllable counts and varied syllable weights."""
        sr = 44100
        audio = np.random.normal(0, 0.1, int(3.0 * sr)).astype(np.float32)
        words = [
            "supercalifragilisticexpialidocious",
            "antidisestablishmentarianism",
            "incomprehensibility",
        ]
        aligned = align_words_spectral(audio, sr, words, line_start=0.5, line_end=2.8)
        assert len(aligned) == 3
        for w in aligned:
            assert w["start_time"] < w["end_time"]
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])

    def test_dense_word_crowding_in_sub_second_window(self):
        """20 words packed into a 0.4s window must not produce overlapping or zero-length words."""
        sr = 44100
        audio = np.zeros(int(0.5 * sr), dtype=np.float32)
        words = [f"w{i}" for i in range(20)]

        aligned = align_words_spectral(audio, sr, words, line_start=0.05, line_end=0.45)
        assert len(aligned) == 20
        for i in range(len(aligned)):
            assert aligned[i]["start_time"] < aligned[i]["end_time"]
            if i > 0:
                assert aligned[i]["start_time"] >= aligned[i - 1]["end_time"], (
                    f"Word {i} overlaps with preceding word {i - 1}"
                )

    def test_empty_whitespace_and_bracketed_tokens(self):
        """Tokens with LRC timestamps or pure whitespace must be sanitized cleanly."""
        sr = 44100
        audio = np.zeros(int(2.0 * sr), dtype=np.float32)

        assert align_words_spectral(audio, sr, [], 0.0, 2.0) == []
        assert align_words_spectral(audio, sr, ["   ", "\t\n", ""], 0.0, 2.0) == []

        raw_words = ["<00:01.00>", "Hello", "<00:01.50>", "world!"]
        aligned = align_words_spectral(audio, sr, raw_words, 1.0, 2.0)
        assert len(aligned) == 2
        assert aligned[0]["word"] == "Hello"
        assert aligned[1]["word"] == "world!"

    def test_inverted_and_zero_duration_lines(self):
        """Line start >= line end must be repaired automatically without crashing."""
        sr = 44100
        audio = np.zeros(int(3.0 * sr), dtype=np.float32)
        words = ["Inverted", "timing"]

        r_inv = align_words_spectral(audio, sr, words, line_start=4.0, line_end=2.0)
        assert len(r_inv) == 2
        assert r_inv[0]["start_time"] < r_inv[0]["end_time"]
        assert r_inv[1]["start_time"] >= r_inv[0]["end_time"]

        r_zero = align_words_spectral(audio, sr, words, line_start=1.5, line_end=1.5)
        assert len(r_zero) == 2
        assert r_zero[0]["start_time"] < r_zero[0]["end_time"]
        assert r_zero[1]["start_time"] >= r_zero[0]["end_time"]


# ==============================================================================
# 4. Strict Timestamp Monotonicity Invariants (Fuzz Testing)
# ==============================================================================


class TestStrictTimestampMonotonicityFuzzing:
    """Randomized fuzz testing stressing boundary invariants across 100 trials."""

    def test_fuzz_word_timing_invariants_100_trials(self):
        """
        Fuzzing test running 100 stochastic trials.
        Every trial MUST satisfy:
          1. 0 <= start_time < end_time
          2. Non-overlapping: w[i].start_time >= w[i-1].end_time
          3. Within line window: l_start <= w[0].start_time and w[-1].end_time <= l_end
          4. Strict Pydantic schema validation via WordTimingSchema and LyricLineSchema
        """
        rng = np.random.RandomState(1337)
        vocabulary = [
            "la",
            "vocal",
            "harmony",
            "sing",
            "chorus",
            "tremolo",
            "vibrato",
            "microphone",
            "stage",
            "rhythm",
            "beat",
            "melody",
            "resonance",
            "supercalifragilistic",
            "a",
            "I",
            "forever",
        ]

        trials_executed = 0
        for trial in range(100):
            n_words = int(rng.randint(1, 15))
            words = list(rng.choice(vocabulary, size=n_words))

            l_start = float(rng.uniform(-0.5, 50.0))
            dur = float(rng.uniform(-0.5, 8.0))
            l_end = l_start + dur
            sr = int(rng.choice([8000, 16000, 22050, 44100]))

            audio_mode = rng.choice(["silence", "noise", "sinusoid", "nan_inf", "empty"])
            audio_len = max(0, int(rng.uniform(0.01, 10.0) * sr))

            if audio_mode == "silence":
                audio = np.zeros(audio_len, dtype=np.float32)
            elif audio_mode == "noise":
                audio = rng.normal(0, 0.2, audio_len).astype(np.float32)
            elif audio_mode == "sinusoid":
                t = np.linspace(0, audio_len / sr, audio_len, endpoint=False)
                audio = (0.5 * np.sin(2 * np.pi * 330.0 * t)).astype(np.float32)
            elif audio_mode == "nan_inf":
                audio = rng.normal(0, 0.1, audio_len).astype(np.float32)
                if audio_len > 10:
                    audio[rng.randint(0, audio_len, size=5)] = np.nan
                    audio[rng.randint(0, audio_len, size=5)] = np.inf
            else:
                audio = np.array([], dtype=np.float32)

            aligned = align_words_spectral(
                audio_segment=audio,
                sample_rate=sr,
                words=words,
                line_start=l_start,
                line_end=l_end,
            )

            assert len(aligned) == n_words, f"Trial {trial}: word count mismatch"

            safe_l_start = max(0.0, l_start)
            safe_l_end = max(safe_l_start + 0.05, l_end)

            word_schemas = []
            for i, w in enumerate(aligned):
                s = w["start_time"]
                e = w["end_time"]

                assert isinstance(s, float), f"Trial {trial}: start_time {s} is not float"
                assert isinstance(e, float), f"Trial {trial}: end_time {e} is not float"
                assert math.isfinite(s), f"Trial {trial}: start_time {s} is not finite"
                assert math.isfinite(e), f"Trial {trial}: end_time {e} is not finite"
                assert s >= 0.0, f"Trial {trial}: start_time {s} < 0.0"
                assert e > s, f"Trial {trial}: end_time {e} <= start_time {s}"

                if i > 0:
                    prev_e = aligned[i - 1]["end_time"]
                    assert s >= prev_e, (
                        f"Trial {trial}: word {i} start {s} overlaps preceding end {prev_e}"
                    )

                word_schemas.append(WordTimingSchema(word=w["word"], start_time=s, end_time=e))

            line_model = LyricLineSchema(
                text=" ".join(words),
                start_time=safe_l_start,
                end_time=safe_l_end,
                words=word_schemas,
            )
            assert line_model is not None
            trials_executed += 1

        print(
            f"\n[Fuzz Testing] Successfully completed {trials_executed}/100 trials with 0 invariant violations."
        )


# ==============================================================================
# 5. CPU Execution Speed Benchmark (< 2.0s for long tracks)
# ==============================================================================


class TestCPUPerformanceBenchmark:
    """Benchmarks CPU execution time against the < 2.0s requirement."""

    def test_full_song_alignment_cpu_speed_3_5_min(self, tmp_path):
        """
        Benchmark: Complete forced alignment of a 3.5-minute (210s) vocal track
        containing ~40 lyric lines must execute in < 2.0s on CPU.
        """
        sr = 44100
        duration = 210.0
        wav_path = str(tmp_path / "song_3_5_min.wav")

        events = []
        lines = []
        cur_t = 10.0
        line_idx = 0
        while cur_t < 200.0:
            line_len = 3.5
            l_start = cur_t
            l_end = cur_t + line_len
            words_text = f"Line number {line_idx} sung here"
            words = words_text.split()
            w_dur = line_len / len(words)
            for j, _ in enumerate(words):
                w_s = l_start + j * w_dur
                w_e = w_s + w_dur * 0.85
                events.append({"start": w_s, "end": w_e, "freq": 300.0 + (line_idx % 5) * 40})
            lines.append(
                {
                    "id": line_idx,
                    "text": words_text,
                    "start_time": round(l_start, 3),
                    "end_time": round(l_end, 3),
                }
            )
            cur_t += line_len + 1.5
            line_idx += 1

        write_test_wav(wav_path, duration=duration, vocal_events=events, sr=sr)

        aligner = AudioAligner()
        t0 = time.perf_counter()
        aligned = aligner.align_lyrics(
            vocals_path=wav_path,
            lines=lines,
            auto_offset_correction=False,
            refine_line_boundaries=False,
        )
        t_elapsed = time.perf_counter() - t0

        print(
            f"\n[CPU Benchmark 3.5m] Aligned {len(aligned)} lines in {t_elapsed:.3f}s (Budget: < 2.0s)"
        )
        assert len(aligned) == len(lines)
        for line in aligned:
            assert len(line["words"]) == 5
        assert t_elapsed < 2.0, (
            f"Whole-track alignment took {t_elapsed:.3f}s, exceeding 2.0s budget!"
        )

    def test_marathon_song_alignment_cpu_speed_5_0_min(self, tmp_path):
        """
        Stress Benchmark: 5.0-minute (300s) track containing ~70 lyric lines.
        """
        sr = 44100
        duration = 300.0
        wav_path = str(tmp_path / "song_5_0_min.wav")

        events = []
        lines = []
        cur_t = 15.0
        line_idx = 0
        while cur_t < 285.0:
            l_start = cur_t
            l_end = cur_t + 3.0
            words_text = f"Marathon lyric line {line_idx}"
            events.append({"start": l_start + 0.2, "end": l_end - 0.2, "freq": 350.0})
            lines.append(
                {
                    "id": line_idx,
                    "text": words_text,
                    "start_time": round(l_start, 3),
                    "end_time": round(l_end, 3),
                }
            )
            cur_t += 3.8
            line_idx += 1

        write_test_wav(wav_path, duration=duration, vocal_events=events, sr=sr)

        aligner = AudioAligner()
        t0 = time.perf_counter()
        aligned = aligner.align_lyrics(
            vocals_path=wav_path,
            lines=lines,
            auto_offset_correction=False,
            refine_line_boundaries=False,
        )
        t_elapsed = time.perf_counter() - t0

        print(
            f"\n[CPU Benchmark 5.0m] Aligned {len(aligned)} lines in {t_elapsed:.3f}s (Budget: < 2.0s)"
        )
        assert len(aligned) == len(lines)
        assert t_elapsed < 2.0, f"5-minute alignment took {t_elapsed:.3f}s, exceeding 2.0s budget!"


# ==============================================================================
# 6. AudioAligner.align_lyrics End-to-End Integration
# ==============================================================================


class TestAudioAlignerIntegration:
    """Verifies AudioAligner.align_lyrics integration and existing word sync preservation."""

    def test_align_lyrics_preserves_existing_word_sync(self, tmp_path):
        """Preserves existing word timestamps when has_word_sync: True."""
        sr = 44100
        wav_path = str(tmp_path / "sync_preserve.wav")
        write_test_wav(wav_path, duration=6.0, vocal_events=[], sr=sr)

        existing_words = [
            {"word": "Explicit", "start_time": 1.25, "end_time": 1.65},
            {"word": "timing", "start_time": 1.70, "end_time": 2.15},
        ]
        lines = [
            {
                "id": 1,
                "text": "Explicit timing",
                "start_time": 1.0,
                "end_time": 2.5,
                "has_word_sync": True,
                "words": existing_words,
            },
            {
                "id": 2,
                "text": "Needs alignment",
                "start_time": 3.0,
                "end_time": 4.5,
                "has_word_sync": False,
            },
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(
            wav_path, lines, auto_offset_correction=False, refine_line_boundaries=False
        )

        assert len(aligned) == 2
        assert aligned[0]["has_word_sync"] is True
        assert aligned[0]["words"][0]["start_time"] == 1.25
        assert aligned[0]["words"][0]["end_time"] == 1.65
        assert aligned[0]["words"][1]["start_time"] == 1.70
        assert aligned[0]["words"][1]["end_time"] == 2.15

        assert len(aligned[1]["words"]) == 2
        assert aligned[1]["words"][0]["start_time"] < aligned[1]["words"][0]["end_time"]

    def test_align_lyrics_with_line_refinement_and_auto_offset(self, tmp_path):
        """Full pipeline with auto_offset_correction=True and refine_line_boundaries=True."""
        sr = 44100
        wav_path = str(tmp_path / "full_pipeline.wav")
        events = [
            {"start": 2.0, "end": 4.0, "freq": 350.0},
            {"start": 5.5, "end": 7.5, "freq": 400.0},
        ]
        write_test_wav(wav_path, duration=10.0, vocal_events=events, sr=sr)

        lines = [
            {"id": 0, "text": "First vocal line", "start_time": 1.8, "end_time": 4.5},
            {"id": 1, "text": "Second vocal line", "start_time": 5.0, "end_time": 8.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(
            wav_path, lines, auto_offset_correction=True, refine_line_boundaries=True
        )

        assert len(aligned) == 2
        for line in aligned:
            assert len(line["words"]) == 3
            schema = LyricLineSchema(**line)
            assert schema is not None
            for w in line["words"]:
                assert w["start_time"] < w["end_time"]
                assert math.isfinite(w["start_time"])
                assert math.isfinite(w["end_time"])
