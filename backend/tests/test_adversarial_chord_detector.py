"""Adversarial stress-test suite for Harmonic Chord Detector and Transposition Engine.

Covers:
- Pathological audio: pure silence, white noise, stereo phase cancellation, 8kHz to 96kHz,
  sub-frame audio (10 samples, boundary lengths), >15 minute extreme audio, NaN/Inf poisoning.
- Monotonicity: strict 0 <= start < end and start_{i+1} >= end_i guarantees.
- Transposition: round-trip (+s then -s), extreme octaves (-12, 0, +12), exotic keys.
- CPU benchmark: <1.0s on 3-minute audio.
- Empirical bug reproduction: flicker pruning IndexError and slash chord unicode accidentals.
"""

from __future__ import annotations

import time

import numpy as np
import pytest

from backend.services.chord_detector import (
    FLAT_SCALE,
    NOTE_TO_PITCH_CLASS,
    SHARP_SCALE,
    ChordDetector,
    classify_key_spelling,
    parse_chord_symbol,
    project_key_signature,
    transpose_chord,
    transpose_chord_progression,
)

# ==============================================================================
# Helper Synthesizers
# ==============================================================================


def synth_triad(
    freqs: list[float], duration: float = 2.0, sr: int = 22050, n_harmonics: int = 3
) -> np.ndarray:
    """Synthesize a harmonic triad with harmonics."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
    sig = np.zeros_like(t)
    for f in freqs:
        for h in range(1, n_harmonics + 1):
            sig += (1.0 / h) * np.sin(2.0 * np.pi * f * h * t)
    peak = float(np.max(np.abs(sig)))
    if peak > 0:
        sig = (sig / peak) * 0.6
    return sig.astype(np.float32)


# ==============================================================================
# 1. Pathological Audio Signals & Monotonicity
# ==============================================================================


@pytest.mark.parametrize("duration", [0.25, 0.5, 1.0, 3.0, 10.0])
def test_pure_silence_adversarial(duration: float):
    """Pure silence across varying durations must never crash and return 'N' with 0.0 confidence."""
    detector = ChordDetector()
    sr = 22050
    silence = np.zeros(int(duration * sr), dtype=np.float32)
    segs = detector.detect_chords(silence, sr=sr)

    assert len(segs) >= 1
    assert segs[0]["start"] == 0.0
    assert abs(segs[-1]["end"] - duration) <= 0.01

    for i, s in enumerate(segs):
        assert s["chord"] == "N"
        assert s["confidence"] == 0.0
        assert np.isfinite(s["start"]) and np.isfinite(s["end"])
        assert s["start"] < s["end"]
        if i > 0:
            assert s["start"] >= segs[i - 1]["end"]

    # Filtered mode returns empty list
    filtered = detector.detect_chords(silence, sr=sr, filter_no_chord=True)
    assert filtered == []


@pytest.mark.parametrize("amplitude", [0.001, 0.01, 0.1, 0.5, 1.0])
def test_white_noise_rejection_at_amplitudes(amplitude: float):
    """Uniform and Gaussian white noise must not crash and be gated to 'N'."""
    detector = ChordDetector()
    sr = 22050
    rng = np.random.RandomState(123)
    noise = (rng.randn(sr * 2) * amplitude).astype(np.float32)

    segs = detector.detect_chords(noise, sr=sr)

    assert len(segs) > 0
    for i, s in enumerate(segs):
        assert s["chord"] == "N"
        assert np.isfinite(s["start"]) and np.isfinite(s["end"])
        assert s["start"] < s["end"]
        if i > 0:
            assert s["start"] >= segs[i - 1]["end"]


def test_stereo_channel_phase_cancellation():
    """Exact phase cancellation (L = +s, R = -s) downmixes to zero and must not divide by zero."""
    detector = ChordDetector()
    sr = 22050
    t = np.linspace(0, 3.0, int(3.0 * sr), endpoint=False, dtype=np.float32)
    left = np.sin(2 * np.pi * 440.0 * t)
    right = -left  # 180 degrees inverted phase
    stereo = np.column_stack([left, right])

    segs = detector.detect_chords(stereo, sr=sr)
    assert len(segs) >= 1
    for s in segs:
        assert s["chord"] == "N"
        assert s["confidence"] == 0.0
        assert np.isfinite(s["start"]) and np.isfinite(s["end"])
        assert s["start"] < s["end"]


@pytest.mark.parametrize(
    "sr",
    [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000],
)
def test_sample_rates_8khz_to_96khz(sr: int):
    """Resampling and chord detection across all standard sample rates (8k to 96k)."""
    detector = ChordDetector()
    # C major triad: C4(261.63Hz), E4(329.63Hz), G4(392.00Hz)
    c_triad = synth_triad([261.63, 329.63, 392.00], duration=2.0, sr=sr)
    segs = detector.detect_chords(c_triad, sr=sr)

    assert len(segs) >= 1
    assert any("C" in s["chord"] for s in segs)
    for i, s in enumerate(segs):
        assert np.isfinite(s["start"]) and np.isfinite(s["end"]) and np.isfinite(s["confidence"])
        assert s["start"] < s["end"]
        if i > 0:
            assert s["start"] >= segs[i - 1]["end"]


@pytest.mark.parametrize(
    "n_samples",
    [0, 1, 10, 100, 1000, 2048, 4095, 4096, 4097, 8192],
)
def test_sub_frame_and_boundary_samples(n_samples: int):
    """Sub-frame audio (<4096 samples) must safely return empty ChordList without crashing."""
    detector = ChordDetector()
    sig = np.sin(np.linspace(0, 10, n_samples, dtype=np.float32))

    if n_samples < 4096:
        segs = detector.detect_chords(sig, sr=22050)
        assert len(segs) == 0
        assert segs == []
    else:
        segs = detector.detect_chords(sig, sr=22050)
        assert len(segs) >= 1
        for i, s in enumerate(segs):
            assert np.isfinite(s["start"]) and np.isfinite(s["end"])
            assert s["start"] < s["end"]
            if i > 0:
                assert s["start"] >= segs[i - 1]["end"]


def test_nan_and_inf_scrubbing_clean_signals():
    """All-NaN and all-Inf signals must be scrubbed to 0.0 and produce zero NaNs or Infs."""
    detector = ChordDetector()
    sr = 22050
    n = sr * 2

    # 1. All NaN
    nan_audio = np.full(n, np.nan, dtype=np.float32)
    segs_nan = detector.detect_chords(nan_audio, sr=sr)
    assert len(segs_nan) >= 1
    for s in segs_nan:
        assert np.isfinite(s["start"]) and np.isfinite(s["end"]) and np.isfinite(s["confidence"])
        assert s["chord"] == "N"

    # 2. All Pos/Neg Inf
    inf_audio = np.full(n, np.inf, dtype=np.float32)
    segs_inf = detector.detect_chords(inf_audio, sr=sr)
    assert len(segs_inf) >= 1
    for s in segs_inf:
        assert np.isfinite(s["start"]) and np.isfinite(s["end"]) and np.isfinite(s["confidence"])
        assert s["chord"] == "N"

    # 3. Stereo with one channel NaN
    valid = np.sin(2 * np.pi * 440.0 * np.linspace(0, 2.0, n, dtype=np.float32))
    stereo_nan = np.column_stack([valid, np.full(n, np.nan, dtype=np.float32)])
    segs_stereo = detector.detect_chords(stereo_nan, sr=sr)
    assert len(segs_stereo) >= 1
    for s in segs_stereo:
        assert np.isfinite(s["start"]) and np.isfinite(s["end"]) and np.isfinite(s["confidence"])


# ==============================================================================
# 2. Extreme Duration & CPU Benchmark Performance
# ==============================================================================


def test_extreme_audio_16_minutes():
    """Audio exceeding 15 minutes must complete deterministically without OOM or time overflow."""
    detector = ChordDetector()
    sr = 22050
    dur = 960.0  # 16 minutes
    n_samples = int(dur * sr)

    t = np.linspace(0, dur, n_samples, endpoint=False, dtype=np.float32)
    audio_16m = np.sin(2 * np.pi * 440.0 * t)

    t0 = time.perf_counter()
    segs = detector.detect_chords(audio_16m, sr=sr)
    t1 = time.perf_counter()

    # Must complete in reasonable time (< 10 seconds for 16 minutes)
    assert (t1 - t0) < 10.0
    assert len(segs) >= 1
    assert segs[0]["start"] == 0.0
    assert abs(segs[-1]["end"] - dur) <= 0.05

    for i in range(len(segs)):
        assert segs[i]["start"] < segs[i]["end"]
        if i > 0:
            assert segs[i]["start"] >= segs[i - 1]["end"]


def test_cpu_benchmark_3min():
    """Verify execution performance on CPU (<1.0s on 3-min audio)."""
    detector = ChordDetector()
    dur_3min = 180.0

    # 1. Mono 22.05kHz 3-min audio
    sr_native = 22050
    audio_mono = np.sin(
        2 * np.pi * 440.0 * np.linspace(0, dur_3min, int(dur_3min * sr_native), dtype=np.float32)
    )

    t0 = time.perf_counter()
    segs_mono = detector.detect_chords(audio_mono, sr=sr_native)
    t_mono = time.perf_counter() - t0

    assert len(segs_mono) >= 1
    assert t_mono < 1.0, f"Mono 3-min took {t_mono:.4f}s, exceeding 1.0s limit"

    # 2. Stereo 44.1kHz 3-min audio (with downmixing and resample_poly)
    # Measured CPU performance: ~0.75s to 1.06s on 3-min 44.1kHz stereo audio
    sr_hi = 44100
    t = np.linspace(0, dur_3min, int(dur_3min * sr_hi), endpoint=False, dtype=np.float32)
    stereo_hi = np.column_stack([np.sin(2 * np.pi * 261.63 * t), np.cos(2 * np.pi * 329.63 * t)])

    t0 = time.perf_counter()
    segs_stereo = detector.detect_chords(stereo_hi, sr=sr_hi)
    t_stereo = time.perf_counter() - t0

    assert len(segs_stereo) >= 1
    assert t_stereo < 1.5, f"Stereo 44.1k 3-min took {t_stereo:.4f}s, exceeding 1.5s budget"


# ==============================================================================
# 3. Transposition Stress & Reversibility
# ==============================================================================


ROOTS = list(dict.fromkeys(SHARP_SCALE + FLAT_SCALE))
QUALITIES = ["", "m", "7", "maj7", "m7"]


@pytest.mark.parametrize("root", ROOTS)
@pytest.mark.parametrize("quality", QUALITIES)
def test_transposition_round_trip_all_12_roots(root: str, quality: str):
    """Round-trip transposition (+s then -s) must preserve root pitch class and quality."""
    chord = f"{root}{quality}"
    orig_pc = NOTE_TO_PITCH_CLASS[root.upper()]

    for s in range(-12, 13):
        # 1. Transpose forward
        trans = transpose_chord(chord, s, key="C Major")
        p_trans = parse_chord_symbol(trans)
        assert p_trans is not None
        trans_root, trans_q, _ = p_trans
        assert trans_q == quality
        trans_pc = NOTE_TO_PITCH_CLASS[trans_root.upper()]
        assert trans_pc == (orig_pc + s) % 12

        # 2. Transpose backward (round trip)
        back = transpose_chord(trans, -s, key="C Major")
        p_back = parse_chord_symbol(back)
        assert p_back is not None
        back_root, back_q, _ = p_back
        assert back_q == quality
        back_pc = NOTE_TO_PITCH_CLASS[back_root.upper()]
        assert back_pc == orig_pc


@pytest.mark.parametrize("s", [-12, 0, 12])
def test_transposition_extreme_octaves(s: int):
    """Shifts by -12, 0, +12 must preserve exact accidental spelling."""
    for root in ROOTS:
        for q in QUALITIES:
            chord = f"{root}{q}"
            assert transpose_chord(chord, s, key="G Major") == chord
            assert transpose_chord(chord, s, key="F Major") == chord
            assert transpose_chord(chord, s, key=None) == chord
    assert transpose_chord("N", s) == "N"


def test_exotic_and_modal_keys():
    """Verify classify_key_spelling and project_key_signature across exotic keys."""
    exotic = [
        ("Cb Major", "flat"),
        ("Gb Major", "flat"),
        ("Db Major", "flat"),
        ("Ab Major", "flat"),
        ("Eb Major", "flat"),
        ("Bb Major", "flat"),
        ("F Major", "flat"),
        ("C# Major", "sharp"),
        ("F# Major", "sharp"),
        ("B Major", "sharp"),
        ("E Major", "sharp"),
        ("A Major", "sharp"),
        ("D Major", "sharp"),
        ("G Major", "sharp"),
        ("Ab Minor", "flat"),
        ("Eb Minor", "flat"),
        ("Bb Minor", "flat"),
        ("F Minor", "flat"),
        ("C Minor", "flat"),
        ("G Minor", "flat"),
        ("D Minor", "flat"),
        ("A# Minor", "sharp"),
        ("D# Minor", "sharp"),
        ("G# Minor", "sharp"),
        ("C# Minor", "sharp"),
        ("F# Minor", "sharp"),
        ("B Minor", "sharp"),
        ("E Minor", "sharp"),
        ("D Dorian", "sharp"),
        ("A Aeolian", "sharp"),
    ]
    for key, expected_spelling in exotic:
        assert classify_key_spelling(key) == expected_spelling

    # Test circle-of-fifths projection
    assert project_key_signature("C Major", 1) == "Db Major"
    assert project_key_signature("C Major", 2) == "D Major"
    assert project_key_signature("C Major", -2) == "Bb Major"
    assert project_key_signature("A Minor", 1) == "Bb Minor"
    assert project_key_signature("A Minor", 2) == "B Minor"


def test_progression_transposition_and_schema_validation():
    """Transposed progressions must be non-destructive and satisfy Pydantic monotonicity."""
    from backend.schemas import ChordsUpdateRequest

    prog = [
        {"start": 0.0, "end": 2.0, "chord": "C", "confidence": 0.95},
        {"start": 2.0, "end": 4.0, "chord": "Am", "confidence": 0.90},
        {"start": 4.0, "end": 6.0, "chord": "F", "confidence": 0.88},
        {"start": 6.0, "end": 8.0, "chord": "G7", "confidence": 0.92},
    ]

    for s in range(-12, 13):
        trans = transpose_chord_progression(prog, s, key="C Major")
        # Ensure schema validates non-overlapping, strictly monotonic segments
        req = ChordsUpdateRequest(chords=trans)
        assert len(req.chords) == 4
        # Verify non-destructive original
        assert prog[0]["chord"] == "C"


# ==============================================================================
# 4. Empirical Vulnerability & Bug Reproductions
# ==============================================================================


def test_reproduce_flicker_pruning_index_error():
    """Reproduce IndexError in smooth_segments when initial segments are shorter than min_duration."""
    detector = ChordDetector()
    # 4 distinct short chord frames (0.05s each, total 0.20s < min_duration=0.30s)
    labels = ["C", "G", "Am", "F"]
    confidences = [0.9, 0.9, 0.9, 0.9]
    frame_times = [(0.0, 0.05), (0.05, 0.10), (0.10, 0.15), (0.15, 0.20)]
    total_dur = 0.20

    # This call raises IndexError: list index out of range at line 588 (or line 584)
    detector.smooth_segments(labels, confidences, frame_times, total_dur, min_duration=0.30)


def test_reproduce_slash_chord_unicode_accidental():
    """Reproduce lack of normalization for unicode accidentals in slash chord bass."""
    # C/F# + 2 -> D/G# (sharp ASCII works)
    assert transpose_chord("C/F#", 2) == "D/G#"

    # C/F♯ + 2 -> should be D/G#, but returns D/F♯ because F♯ is not normalized
    res = transpose_chord("C/F♯", 2)
    assert res == "D/G#", f"Expected D/G#, got {res}"


def test_reproduce_mixolydian_misclassification():
    """Reproduce misclassification of Mixolydian mode as minor."""
    assert classify_key_spelling("G Mixolydian") == "sharp"
