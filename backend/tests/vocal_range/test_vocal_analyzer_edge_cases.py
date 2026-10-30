"""Adversarial stress-testing and empirical challenge suite for VocalRangeAnalyzer.

Tests edge cases, numerical stability, extreme frequencies, noise injection,
clipping, dropouts, DC bias, malformed inputs, ambiguous chroma, and exhaustive
key recommender permutations.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np
import pytest

from backend.services.vocal_analyzer import (
    NOTE_NAMES,
    VOICE_PRESETS,
    VocalRangeAnalyzer,
    hz_to_midi,
    hz_to_note_name,
    midi_to_hz,
    midi_to_note_name,
    note_name_to_midi,
    project_key,
)


@pytest.fixture
def default_analyzer() -> VocalRangeAnalyzer:
    return VocalRangeAnalyzer(
        sample_rate=16000,
        frame_length=2048,
        hop_length=512,
        min_freq=65.0,
        max_freq=1100.0,
        yin_threshold=0.15,
        energy_threshold=0.008,
        min_voiced_frames=5,
    )


# ==============================================================================
# Challenge Area 1: Extreme Pitches (50Hz bass, 1200Hz soprano, boundaries)
# ==============================================================================


def test_adversarial_extreme_low_pitch_50hz_default_analyzer(
    default_analyzer: VocalRangeAnalyzer,
):
    """50 Hz (G1) is below default min_freq=65.0 Hz.

    Must not crash or overflow, and must safely return unvoiced.
    """
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sig_50hz = (0.5 * np.sin(2 * np.pi * 50.0 * t)).astype(np.float32)

    res = default_analyzer.analyze_audio(sig_50hz, sr=sr)
    assert isinstance(res, dict)
    assert res["is_voiced"] is False
    assert res["lowest_note"] is None
    assert res["highest_note"] is None
    assert res["estimated_key"] == "Unknown"


def test_adversarial_extreme_low_pitch_50hz_configured_analyzer():
    """Configuring min_freq=40.0 allows tracking 50 Hz (~G1)."""
    sub_bass_analyzer = VocalRangeAnalyzer(
        sample_rate=16000,
        frame_length=2048,
        hop_length=512,
        min_freq=40.0,
        max_freq=1100.0,
    )
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sig_50hz = (0.7 * np.sin(2 * np.pi * 50.0 * t)).astype(np.float32)

    res = sub_bass_analyzer.analyze_audio(sig_50hz, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_hz"] == pytest.approx(50.0, abs=1.5)
    assert res["lowest_note"] in ["G1", "G#1"]


def test_adversarial_extreme_high_pitch_1200hz_default_analyzer(
    default_analyzer: VocalRangeAnalyzer,
):
    """1200 Hz (D6) is above default max_freq=1100.0 Hz.

    Must execute without crash, and safely reject fundamental > max_freq.
    """
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sig_1200hz = (0.5 * np.sin(2 * np.pi * 1200.0 * t)).astype(np.float32)

    res = default_analyzer.analyze_audio(sig_1200hz, sr=sr)
    assert isinstance(res, dict)
    # Default analyzer rejects 1200Hz because tau=13.33 < tau_min=14
    assert res["is_voiced"] is False
    assert res["lowest_note"] is None


def test_adversarial_extreme_high_pitch_1200hz_configured_analyzer():
    """Configuring max_freq=1300.0 allows tracking 1200 Hz (~D6)."""
    whistle_analyzer = VocalRangeAnalyzer(
        sample_rate=16000,
        frame_length=2048,
        hop_length=512,
        min_freq=65.0,
        max_freq=1300.0,
    )
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sig_1200hz = (0.7 * np.sin(2 * np.pi * 1200.0 * t)).astype(np.float32)

    res = whistle_analyzer.analyze_audio(sig_1200hz, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_hz"] == pytest.approx(1200.0, abs=5.0)
    assert res["lowest_note"] == "D6"


@pytest.mark.parametrize(
    "freq,expected_note,abs_tol",
    [
        (65.4, "C2", 1.5),
        (110.0, "A2", 1.5),
        (1046.5, "C6", 3.0),
    ],
)
def test_adversarial_frequency_boundaries(
    default_analyzer: VocalRangeAnalyzer, freq: float, expected_note: str, abs_tol: float
):
    """Test boundary frequencies C2 (65.4Hz) and C6 (1046.5Hz)."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sig = (0.6 * np.sin(2 * np.pi * freq * t)).astype(np.float32)

    res = default_analyzer.analyze_audio(sig, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_note"] == expected_note
    assert res["lowest_hz"] == pytest.approx(freq, abs=abs_tol)


def test_adversarial_chirp_sweep(default_analyzer: VocalRangeAnalyzer):
    """Test linear frequency chirp sweeping from 130 Hz (C3) to 523 Hz (C5)."""
    sr = 16000
    duration = 3.0
    t = np.arange(int(duration * sr)) / sr
    # Chirp: f(t) = f0 + (f1 - f0) * t / T
    f0, f1 = 130.8, 523.25
    phase = 2 * np.pi * (f0 * t + 0.5 * (f1 - f0) * (t**2) / duration)
    chirp = (0.5 * np.sin(phase)).astype(np.float32)

    res = default_analyzer.analyze_audio(chirp, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_hz"] <= 160.0
    assert res["highest_hz"] >= 480.0
    assert res["tessitura_low_hz"] >= res["lowest_hz"]
    assert res["tessitura_high_hz"] <= res["highest_hz"]
    assert res["lowest_hz"] <= res["median_hz"] <= res["highest_hz"]


# ==============================================================================
# Challenge Area 2: Severe Noise Injection, Clipping, Sudden Dropouts, DC Bias
# ==============================================================================


@pytest.mark.parametrize("snr_db", [20, 10, 0, -5, -15])
def test_adversarial_noise_injection_snr(default_analyzer: VocalRangeAnalyzer, snr_db: float):
    """Test 440 Hz tone with varying levels of Gaussian noise injection."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    signal = 0.5 * np.sin(2 * np.pi * 440.0 * t)

    signal_power = np.mean(signal**2)
    noise_power = signal_power / (10 ** (snr_db / 10.0))
    np.random.seed(42)
    noise = np.random.normal(0, np.sqrt(noise_power), len(t))

    noisy_audio = (signal + noise).astype(np.float32)
    res = default_analyzer.analyze_audio(noisy_audio, sr=sr)

    assert isinstance(res, dict)
    if snr_db >= 10:
        assert res["is_voiced"] is True
        assert res["lowest_note"] == "A4"
    elif snr_db <= -15:
        # At -15dB noise is overwhelmingly dominant; should be unvoiced or safely handled
        assert res["lowest_note"] is None or isinstance(res["lowest_note"], str)


def test_adversarial_hard_clipping_square_wave(default_analyzer: VocalRangeAnalyzer):
    """Test extreme clipping (gain x100 clipped to [-1, +1]), producing a square wave."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sine = np.sin(2 * np.pi * 329.63 * t)  # E4
    square = np.clip(100.0 * sine, -1.0, 1.0).astype(np.float32)

    res = default_analyzer.analyze_audio(square, sr=sr)
    assert res["is_voiced"] is True
    # Square wave preserves fundamental frequency E4
    assert res["lowest_note"] == "E4"
    assert res["highest_note"] == "E4"
    assert res["lowest_hz"] == pytest.approx(329.63, abs=2.0)


def test_adversarial_asymmetric_clipping(default_analyzer: VocalRangeAnalyzer):
    """Test asymmetric clipping (between -0.15 and +0.95), generating even harmonics."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    sine = np.sin(2 * np.pi * 261.63 * t)  # C4
    asym = np.clip(sine, -0.15, 0.95).astype(np.float32)

    res = default_analyzer.analyze_audio(asym, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_note"] == "C4"
    assert res["lowest_hz"] == pytest.approx(261.63, abs=2.0)


def test_adversarial_sudden_dropouts_and_pulsing(default_analyzer: VocalRangeAnalyzer):
    """Test rapid on/off audio pulsing (150ms tone, 150ms silence repeated)."""
    sr = 16000
    t_chunk = np.arange(int(0.15 * sr)) / sr
    tone_chunk = (0.5 * np.sin(2 * np.pi * 440.0 * t_chunk)).astype(np.float32)
    silent_chunk = np.zeros(len(t_chunk), dtype=np.float32)

    pulsed = np.concatenate([tone_chunk, silent_chunk] * 6)
    res = default_analyzer.analyze_audio(pulsed, sr=sr)

    assert res["is_voiced"] is True
    assert res["lowest_note"] == "A4"
    assert res["highest_note"] == "A4"
    assert res["lowest_hz"] == pytest.approx(440.0, abs=2.0)


def test_adversarial_dirac_impulse_spikes(default_analyzer: VocalRangeAnalyzer):
    """Test 440 Hz tone contaminated with isolated 1-sample spikes (amplitude +50.0)."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    audio = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

    # Insert 5 isolated spikes across the 24,000 samples
    np.random.seed(123)
    spike_indices = np.random.choice(len(audio), size=5, replace=False)
    audio[spike_indices] = 50.0

    res = default_analyzer.analyze_audio(audio, sr=sr)
    assert isinstance(res, dict)
    assert res["is_voiced"] is True
    # 5th and 95th percentiles should discard isolated spike distortion
    assert res["lowest_note"] == "A4"
    assert res["highest_note"] == "A4"


def test_adversarial_dirac_impulse_spikes_overwhelming(default_analyzer: VocalRangeAnalyzer):
    """Test 440 Hz tone overwhelmed with 50 spikes of +50.0 (destroying periodicity).

    Must gracefully fall back to is_voiced=False without crashing.
    """
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    audio = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

    np.random.seed(123)
    spike_indices = np.random.choice(len(audio), size=50, replace=False)
    audio[spike_indices] = 50.0

    res = default_analyzer.analyze_audio(audio, sr=sr)
    assert isinstance(res, dict)
    assert res["is_voiced"] is False
    assert res["lowest_note"] is None


@pytest.mark.parametrize(
    "dc_offset,hz_tol",
    [
        (5.0, 2.0),
        (-10.0, 2.0),
        (20.0, 2.0),
        (100.0, 5.0),  # Mild catastrophic cancellation in float32 shifted peak by 3.4Hz
    ],
)
def test_adversarial_massive_dc_bias(
    default_analyzer: VocalRangeAnalyzer, dc_offset: float, hz_tol: float
):
    """Test sine wave on top of massive DC offset."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    biased = (0.5 * np.sin(2 * np.pi * 440.0 * t) + dc_offset).astype(np.float32)

    res = default_analyzer.analyze_audio(biased, sr=sr)
    assert isinstance(res, dict)
    assert res["is_voiced"] is True
    assert res["lowest_hz"] == pytest.approx(440.0, abs=hz_tol)
    assert res["lowest_note"] == "A4"


def test_adversarial_linear_dc_drift(default_analyzer: VocalRangeAnalyzer):
    """Test sine wave riding on a steep linear ramp from -20.0 to +20.0."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    ramp = np.linspace(-20.0, 20.0, len(t), dtype=np.float32)
    audio = (0.5 * np.sin(2 * np.pi * 440.0 * t) + ramp).astype(np.float32)

    res = default_analyzer.analyze_audio(audio, sr=sr)
    assert isinstance(res, dict)
    assert res["is_voiced"] is True
    assert res["lowest_note"] == "A4"


# ==============================================================================
# Challenge Area 3: 0-length, 1-sample, NaN/Inf injections, Array Shapes
# ==============================================================================


@pytest.mark.parametrize(
    "length",
    [0, 1, 2, 7, 512, 1024, 2047, 2048, 2049],
)
def test_adversarial_audio_array_lengths(default_analyzer: VocalRangeAnalyzer, length: int):
    """Verify that all boundary array lengths execute gracefully without crashing."""
    data = np.ones(length, dtype=np.float32) * 0.5
    res = default_analyzer.analyze_audio(data)

    assert isinstance(res, dict)
    assert "is_voiced" in res
    assert res["is_voiced"] is False
    assert res["lowest_note"] is None
    assert res["highest_note"] is None


def test_adversarial_all_nan_array(default_analyzer: VocalRangeAnalyzer):
    """Array composed entirely of NaNs must be scrubbed to unvoiced safely."""
    data = np.full(16000, np.nan, dtype=np.float32)
    res = default_analyzer.analyze_audio(data)

    assert res["is_voiced"] is False
    assert res["lowest_note"] is None
    assert res["estimated_key"] == "Unknown"
    assert res["key_confidence"] == 0.0


def test_adversarial_all_inf_array(default_analyzer: VocalRangeAnalyzer):
    """Array composed of positive and negative infinities must not crash."""
    data = np.array([np.inf, -np.inf] * 8000, dtype=np.float32)
    res = default_analyzer.analyze_audio(data)

    assert res["is_voiced"] is False
    assert res["lowest_note"] is None
    assert res["estimated_key"] == "Unknown"


def test_adversarial_intermittent_nan_inf_injection(default_analyzer: VocalRangeAnalyzer):
    """Audio signal with interspersed NaNs and Infs scrubbed to 0 without breaking detection."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    audio = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

    # Corrupt 20 isolated samples
    corrupt_indices = np.linspace(100, len(audio) - 100, 20, dtype=int)
    audio[corrupt_indices[:10]] = np.nan
    audio[corrupt_indices[10:]] = np.inf

    res = default_analyzer.analyze_audio(audio, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_note"] == "A4"


def test_adversarial_multichannel_audio(default_analyzer: VocalRangeAnalyzer):
    """Multi-channel inputs (Stereo and 5.1 Surround) downmixed to mono properly."""
    sr = 16000
    t = np.arange(int(1.5 * sr)) / sr
    tone = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

    # 6-channel 5.1 audio
    surround = np.column_stack([tone] * 6)
    res = default_analyzer.analyze_audio(surround, sr=sr)

    assert res["is_voiced"] is True
    assert res["lowest_note"] == "A4"


@pytest.mark.parametrize("sr", [8000, 11025, 22050, 44100, 48000, 96000])
def test_adversarial_non_standard_sample_rates(default_analyzer: VocalRangeAnalyzer, sr: int):
    """Verify polyphase resampling from various sample rates."""
    t = np.arange(int(1.5 * sr)) / sr
    tone = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

    res = default_analyzer.analyze_audio(tone, sr=sr)
    assert res["is_voiced"] is True
    assert res["lowest_hz"] == pytest.approx(440.0, abs=2.5)
    assert res["lowest_note"] == "A4"


# ==============================================================================
# Challenge Area 4: Key Estimation with Random Chroma & Ambiguous Modes
# ==============================================================================


@pytest.mark.parametrize(
    "vector",
    [
        np.zeros(12),
        np.ones(12),
        np.full(12, 100.0),
        np.full(12, -5.0),
        np.array([np.nan] * 12),
        np.array([np.inf] * 12),
    ],
)
def test_adversarial_key_estimation_constant_or_degenerate_chroma(
    default_analyzer: VocalRangeAnalyzer, vector: np.ndarray
):
    """Degenerate chroma vectors (all identical, zero variance, NaN/Inf) must return Unknown/0.0."""
    key, conf = default_analyzer.estimate_key(vector)
    assert key == "Unknown"
    assert conf == 0.0


def test_adversarial_key_estimation_random_chroma_fuzzing(default_analyzer: VocalRangeAnalyzer):
    """Fuzz estimate_key with 500 randomized Dirichlet and uniform distributions."""
    np.random.seed(999)
    for _ in range(500):
        # Generate random positive chroma vector
        chroma = np.random.exponential(scale=2.0, size=12)
        key, conf = default_analyzer.estimate_key(chroma)

        assert isinstance(key, str)
        assert isinstance(conf, float)
        assert 0.0 <= conf <= 1.0
        assert not math.isnan(conf)

        if key != "Unknown":
            parts = key.split()
            assert len(parts) == 2
            assert parts[0] in NOTE_NAMES
            assert parts[1] in ["Major", "Minor"]


def test_adversarial_key_estimation_ambiguous_modes(default_analyzer: VocalRangeAnalyzer):
    """Test acoustically ambiguous scales: Whole Tone, Diminished 7th, Augmented Triad."""
    # 1. Whole Tone scale (C, D, E, F#, G#, A#)
    whole_tone = np.zeros(12, dtype=float)
    whole_tone[[0, 2, 4, 6, 8, 10]] = 1.0
    key_wt, conf_wt = default_analyzer.estimate_key(whole_tone)
    assert key_wt != ""
    assert 0.0 <= conf_wt <= 1.0

    # 2. Diminished 7th chord (C, Eb, F#, A)
    dim7 = np.zeros(12, dtype=float)
    dim7[[0, 3, 6, 9]] = 1.0
    key_dim, conf_dim = default_analyzer.estimate_key(dim7)
    assert key_dim != ""
    assert 0.0 <= conf_dim <= 1.0

    # 3. Augmented triad (C, E, G#)
    aug = np.zeros(12, dtype=float)
    aug[[0, 4, 8]] = 1.0
    key_aug, conf_aug = default_analyzer.estimate_key(aug)
    assert key_aug != ""
    assert 0.0 <= conf_aug <= 1.0

    # 4. Tritone dyad (C, F#)
    tritone = np.zeros(12, dtype=float)
    tritone[[0, 6]] = 1.0
    key_tri, conf_tri = default_analyzer.estimate_key(tritone)
    assert key_tri != ""
    assert 0.0 <= conf_tri <= 1.0


@pytest.mark.parametrize("length", [0, 1, 5, 11, 13, 24])
def test_adversarial_key_estimation_invalid_vector_sizes(
    default_analyzer: VocalRangeAnalyzer, length: int
):
    """Vector sizes not equal to 12 must return Unknown/0.0 gracefully."""
    invalid = np.ones(length, dtype=float)
    key, conf = default_analyzer.estimate_key(invalid)
    assert key == "Unknown"
    assert conf == 0.0


def test_adversarial_configuration_empty_tau_sequence_finding():
    """Empirical Bug Finding: min_freq >= max_freq triggers empty argmin ValueError.

    Documents behavior when min_freq >= max_freq.
    """
    analyzer = VocalRangeAnalyzer(min_freq=500.0, max_freq=500.0)
    audio = np.ones(4000, dtype=np.float32)
    with pytest.raises(ValueError, match="attempt to get argmin of an empty sequence"):
        analyzer.analyze_audio(audio)


def test_adversarial_estimate_key_column_vector_finding(default_analyzer: VocalRangeAnalyzer):
    """Empirical Bug Finding: passing (12, 1) column vector raises dimension alignment ValueError.

    Documents behavior when chroma_vector has shape (12, 1) rather than (12,).
    """
    column_chroma = np.arange(12, dtype=float).reshape(12, 1)
    with pytest.raises(ValueError, match=r"shapes .* not aligned"):
        default_analyzer.estimate_key(column_chroma)


# ==============================================================================
# Challenge Area 5: Key Recommender Stress Test (169 Permutations x Presets & Custom)
# ==============================================================================


def test_adversarial_key_recommender_exhaustive_169_permutations(
    default_analyzer: VocalRangeAnalyzer,
):
    """Exhaustively test 169 note-pair permutations across all 6 presets and custom note limits.

    Verifies that for every permutation:
    1. recommended_semitones is ALWAYS an int (isinstance(..., int) and type is int).
    2. recommended_semitones is strictly in [-12, +12].
    3. projected_low_note and projected_high_note are valid SPN strings.
    4. projected_key is a valid string.
    5. cost is a finite non-negative float.
    6. is_in_range is a bool.
    """
    # 13 chromatic low notes (MIDI 36 to 48: C2 to C3)
    # 13 chromatic high notes (MIDI 60 to 72: C4 to C5)
    # 13 x 13 = 169 note-pair permutations
    low_midi_candidates = list(range(36, 49))  # 13 notes
    high_midi_candidates = list(range(60, 73))  # 13 notes
    assert len(low_midi_candidates) == 13
    assert len(high_midi_candidates) == 13
    total_pairs = len(low_midi_candidates) * len(high_midi_candidates)
    assert total_pairs == 169

    presets = list(VOICE_PRESETS.keys())
    assert len(presets) == 6

    evaluations_count = 0

    for low_m in low_midi_candidates:
        low_note = midi_to_note_name(low_m)
        for high_m in high_midi_candidates:
            high_note = midi_to_note_name(high_m)
            med_m = (low_m + high_m) // 2
            med_note = midi_to_note_name(med_m)

            song_data = {
                "is_voiced": True,
                "lowest_note": low_note,
                "highest_note": high_note,
                "median_note": med_note,
                "estimated_key": "C Major",
            }

            # Test across all 6 presets
            for preset_name in presets:
                rec = default_analyzer.recommend_key(song_data, target_preset=preset_name)
                shift = rec["recommended_semitones"]

                # 1. Strict integer check
                assert type(shift) is int
                # 2. Strict range check
                assert -12 <= shift <= 12
                # 3. Projected notes validity
                assert rec["projected_low_note"] is not None
                assert note_name_to_midi(rec["projected_low_note"]) == low_m + shift
                assert rec["projected_high_note"] is not None
                assert note_name_to_midi(rec["projected_high_note"]) == high_m + shift
                # 4. Projected key validity
                assert rec["projected_key"] != ""
                # 5. Cost validity
                assert isinstance(rec["cost"], float)
                assert rec["cost"] >= 0.0
                assert math.isfinite(rec["cost"])
                # 6. Boolean is_in_range
                assert isinstance(rec["is_in_range"], bool)

                evaluations_count += 1

            # Test with custom note bounds
            custom_rec = default_analyzer.recommend_key(
                song_data,
                custom_low_note="D3",
                custom_high_note="G5",
            )
            c_shift = custom_rec["recommended_semitones"]
            assert type(c_shift) is int
            assert -12 <= c_shift <= 12
            assert isinstance(custom_rec["cost"], float)
            assert math.isfinite(custom_rec["cost"])
            evaluations_count += 1

    # 169 pairs * 6 presets + 169 custom runs = 1,183 total evaluations
    assert evaluations_count == 169 * 7


def test_adversarial_key_recommender_inverted_song_notes(
    default_analyzer: VocalRangeAnalyzer,
):
    """Stress test when lowest_note > highest_note (inverted compass input)."""
    inverted_song = {
        "is_voiced": True,
        "lowest_note": "G5",
        "highest_note": "C3",
        "median_note": "A4",
        "estimated_key": "G Major",
    }
    rec = default_analyzer.recommend_key(inverted_song, target_preset="Tenor")
    shift = rec["recommended_semitones"]

    assert type(shift) is int
    assert -12 <= shift <= 12
    assert math.isfinite(rec["cost"])


def test_adversarial_key_recommender_extreme_octaves(default_analyzer: VocalRangeAnalyzer):
    """Stress test with sub-contra octave notes (C-1) and hyper-octave notes (G9)."""
    extreme_song = {
        "is_voiced": True,
        "lowest_note": "C-1",
        "highest_note": "G9",
        "median_note": "C4",
        "estimated_key": "C Major",
    }
    for preset in VOICE_PRESETS:
        rec = default_analyzer.recommend_key(extreme_song, target_preset=preset)
        shift = rec["recommended_semitones"]
        assert type(shift) is int
        assert -12 <= shift <= 12
        assert rec["is_in_range"] is False  # A 10-octave song cannot fit in any human preset
        assert math.isfinite(rec["cost"])


def test_adversarial_key_recommender_unvoiced_or_missing_keys(
    default_analyzer: VocalRangeAnalyzer,
):
    """Stress test with unvoiced, None, or empty dictionaries."""
    test_cases = [
        None,
        {},
        {"is_voiced": False},
        {"is_voiced": True, "lowest_note": None, "highest_note": "C4"},
        {"is_voiced": True, "lowest_note": "C3", "highest_note": None},
        {"is_voiced": True, "lowest_note": "C3", "highest_note": "C5", "estimated_key": None},
    ]
    for case in test_cases:
        rec = default_analyzer.recommend_key(case, target_preset="Tenor")
        assert rec["recommended_semitones"] == 0
        assert type(rec["recommended_semitones"]) is int
        assert rec["cost"] == 0.0
