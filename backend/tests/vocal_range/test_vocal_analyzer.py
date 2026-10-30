"""Comprehensive unit test suite for VocalRangeAnalyzer, pitch conversions, and key recommendation."""

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.services.vocal_analyzer import (
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
def analyzer() -> VocalRangeAnalyzer:
    return VocalRangeAnalyzer(
        sample_rate=16000,
        frame_length=2048,
        hop_length=512,
        min_freq=65.0,
        max_freq=1100.0,
    )


def test_hz_to_midi_and_back():
    assert hz_to_midi(440.0) == pytest.approx(69.0, abs=1e-4)
    assert hz_to_midi(261.6256) == pytest.approx(60.0, abs=1e-3)
    assert hz_to_midi(130.8128) == pytest.approx(48.0, abs=1e-3)

    for midi_val in [40.0, 48.0, 60.0, 69.0, 72.0, 84.0]:
        hz = midi_to_hz(midi_val)
        assert hz_to_midi(hz) == pytest.approx(midi_val, abs=1e-4)

    with pytest.raises(ValueError):
        hz_to_midi(0.0)
    with pytest.raises(ValueError):
        hz_to_midi(-10.0)
    with pytest.raises(ValueError):
        hz_to_midi(float("nan"))


def test_note_name_to_midi_and_back():
    test_cases = [
        ("C4", 60),
        ("A4", 69),
        ("E2", 40),
        ("C6", 84),
        ("C#3", 49),
        ("Db3", 49),
        ("F#5", 78),
        ("Gb5", 78),
        ("Bb4", 70),
        ("A#4", 70),
    ]
    for note_str, expected_midi in test_cases:
        midi = note_name_to_midi(note_str)
        assert midi == expected_midi
        canonical = midi_to_note_name(midi)
        assert note_name_to_midi(canonical) == expected_midi

    with pytest.raises(ValueError):
        note_name_to_midi("invalid")
    with pytest.raises(ValueError):
        note_name_to_midi("H4")
    with pytest.raises(ValueError):
        note_name_to_midi("C")


def test_project_key_transpositions():
    assert project_key("G Major", -2) == "F Major"
    assert project_key("C# Minor", 3) == "E Minor"
    assert project_key("Bb Major", 1) == "B Major"
    assert project_key("Unknown", 5) == "Unknown"
    assert project_key("", 3) == "Unknown"
    assert project_key("A Major", 12) == "A Major"
    assert project_key("D Minor", -12) == "D Minor"


def test_pure_sine_wave_pitch_accuracy(analyzer: VocalRangeAnalyzer):
    sr = 16000
    duration = 1.5
    t = np.arange(int(duration * sr)) / sr

    # Test A4 (440 Hz)
    sig_440 = np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    res_440 = analyzer.analyze_audio(sig_440, sr=sr)
    assert res_440["is_voiced"] is True
    assert res_440["lowest_note"] == "A4"
    assert res_440["highest_note"] == "A4"
    assert res_440["median_note"] == "A4"
    assert res_440["lowest_hz"] == pytest.approx(440.0, abs=1.0)
    assert res_440["highest_hz"] == pytest.approx(440.0, abs=1.0)

    # Test Middle C / C4 (261.63 Hz)
    sig_c4 = np.sin(2 * np.pi * 261.63 * t).astype(np.float32)
    res_c4 = analyzer.analyze_audio(sig_c4, sr=sr)
    assert res_c4["is_voiced"] is True
    assert res_c4["lowest_note"] == "C4"
    assert res_c4["highest_note"] == "C4"
    assert res_c4["median_note"] == "C4"
    assert res_c4["lowest_hz"] == pytest.approx(261.63, abs=1.0)


def test_synthetic_melody_range_and_tessitura(analyzer: VocalRangeAnalyzer):
    sr = 16000
    note_dur = 1.2
    t_note = np.arange(int(note_dur * sr)) / sr

    # Melody: C4 (261.63 Hz) -> E4 (329.63 Hz) -> G4 (392.00 Hz) -> C5 (523.25 Hz)
    f_c4 = np.sin(2 * np.pi * 261.63 * t_note).astype(np.float32)
    f_e4 = np.sin(2 * np.pi * 329.63 * t_note).astype(np.float32)
    f_g4 = np.sin(2 * np.pi * 392.00 * t_note).astype(np.float32)
    f_c5 = np.sin(2 * np.pi * 523.25 * t_note).astype(np.float32)

    melody = np.concatenate([f_c4, f_e4, f_g4, f_c5])
    res = analyzer.analyze_audio(melody, sr=sr)

    assert res["is_voiced"] is True
    assert res["lowest_note"] == "C4"
    assert res["highest_note"] == "C5"
    assert 255.0 <= res["lowest_hz"] <= 265.0
    assert 518.0 <= res["highest_hz"] <= 528.0

    # Tessitura captures interior notes
    assert res["tessitura_low_hz"] >= 260.0
    assert res["tessitura_high_hz"] <= 525.0
    assert 320.0 <= res["median_hz"] <= 400.0


def test_silence_and_zero_sample_audio(analyzer: VocalRangeAnalyzer):
    # 0-sample empty array
    res_empty = analyzer.analyze_audio(np.array([], dtype=np.float32))
    assert res_empty["is_voiced"] is False
    assert res_empty["lowest_note"] is None
    assert res_empty["highest_note"] is None
    assert res_empty["estimated_key"] == "Unknown"
    assert res_empty["total_frames_count"] == 0

    # 1.0s pure zeros
    res_zeros = analyzer.analyze_audio(np.zeros(16000, dtype=np.float32))
    assert res_zeros["is_voiced"] is False
    assert res_zeros["lowest_note"] is None
    assert res_zeros["estimated_key"] == "Unknown"
    assert res_zeros["key_confidence"] == 0.0


def test_ultra_short_audio(analyzer: VocalRangeAnalyzer):
    # Shorter than frame_length (50 samples < 2048)
    short_audio = np.ones(50, dtype=np.float32) * 0.5
    res = analyzer.analyze_audio(short_audio)
    assert res["is_voiced"] is False
    assert res["lowest_note"] is None
    assert res["total_frames_count"] == 0


def test_white_noise_unvoiced(analyzer: VocalRangeAnalyzer):
    # 1.0s random Gaussian noise (aperiodic)
    np.random.seed(42)
    noise = np.random.normal(0, 0.2, 16000).astype(np.float32)
    res = analyzer.analyze_audio(noise)
    assert res["is_voiced"] is False
    assert res["lowest_note"] is None
    assert res["voiced_frames_count"] == 0


def test_whisper_energy_gate(analyzer: VocalRangeAnalyzer):
    # Sine wave with amplitude far below energy threshold
    sr = 16000
    t = np.arange(sr) / sr
    whisper = (np.sin(2 * np.pi * 440.0 * t) * 1e-5).astype(np.float32)
    res = analyzer.analyze_audio(whisper, sr=sr)
    assert res["is_voiced"] is False


def test_key_estimation_accuracy(analyzer: VocalRangeAnalyzer):
    # Synthetic C Major: C(0), E(4), G(7), B(11)
    chroma_c_maj = np.zeros(12, dtype=float)
    chroma_c_maj[[0, 4, 7, 11]] = [5.0, 4.0, 4.5, 2.0]
    key_c, conf_c = analyzer.estimate_key(chroma_c_maj)
    assert key_c == "C Major"
    assert conf_c >= 0.70

    # Synthetic A Minor: A(9), C(0), E(4), G(7)
    chroma_a_min = np.zeros(12, dtype=float)
    chroma_a_min[[9, 0, 4, 7]] = [5.0, 3.5, 4.0, 2.0]
    key_a, conf_a = analyzer.estimate_key(chroma_a_min)
    assert key_a == "A Minor"
    assert conf_a >= 0.70

    # Zero vector
    key_zero, conf_zero = analyzer.estimate_key(np.zeros(12))
    assert key_zero == "Unknown"
    assert conf_zero == 0.0


def test_smart_key_recommender_presets(analyzer: VocalRangeAnalyzer):
    # Soprano song (D4 to G5, median A4)
    song_soprano = {
        "is_voiced": True,
        "lowest_note": "D4",
        "highest_note": "G5",
        "median_note": "A4",
        "estimated_key": "G Major",
    }
    # Recommending for Baritone (A2 to A4)
    rec_baritone = analyzer.recommend_key(song_soprano, target_preset="Baritone")
    assert -12 <= rec_baritone["recommended_semitones"] <= 12
    assert rec_baritone["recommended_semitones"] <= -8  # Must shift down significantly
    assert rec_baritone["projected_key"] != "Unknown"
    assert rec_baritone["projected_high_note"] is not None

    # Tenor song (C3 to C5, median C4) for Tenor singer
    song_tenor = {
        "is_voiced": True,
        "lowest_note": "C3",
        "highest_note": "C5",
        "median_note": "C4",
        "estimated_key": "C Major",
    }
    rec_tenor = analyzer.recommend_key(song_tenor, target_preset="Tenor")
    assert rec_tenor["recommended_semitones"] == 0
    assert rec_tenor["projected_key"] == "C Major"
    assert rec_tenor["cost"] == 0.0

    # Verify all 6 presets return valid semitones in [-12, +12]
    for preset_name in VOICE_PRESETS:
        rec = analyzer.recommend_key(song_soprano, target_preset=preset_name)
        assert -12 <= rec["recommended_semitones"] <= 12
        assert isinstance(rec["recommended_semitones"], int)


def test_smart_key_recommender_custom_notes(analyzer: VocalRangeAnalyzer):
    song = {
        "is_voiced": True,
        "lowest_note": "C3",
        "highest_note": "E4",
        "median_note": "C#4",
        "estimated_key": "C# Minor",
    }
    rec = analyzer.recommend_key(song, custom_low_note="E2", custom_high_note="E4")
    assert -12 <= rec["recommended_semitones"] <= 12
    assert isinstance(rec["recommended_semitones"], int)

    # Inverted custom notes (auto-swapped)
    rec_inv = analyzer.recommend_key(song, custom_low_note="E4", custom_high_note="E2")
    assert rec_inv["recommended_semitones"] == rec["recommended_semitones"]


def test_smart_key_recommender_unvoiced_song(analyzer: VocalRangeAnalyzer):
    unvoiced_song = {
        "is_voiced": False,
        "lowest_note": None,
        "highest_note": None,
        "median_note": None,
        "estimated_key": "Unknown",
    }
    rec = analyzer.recommend_key(unvoiced_song, target_preset="Tenor")
    assert rec["recommended_semitones"] == 0
    assert rec["projected_key"] == "Unknown"
    assert rec["projected_low_note"] is None
    assert rec["cost"] == 0.0


def test_smart_key_recommender_clamping_extremes(analyzer: VocalRangeAnalyzer):
    # Extremely high song (C6 to C8)
    extreme_high_song = {
        "is_voiced": True,
        "lowest_note": "C6",
        "highest_note": "C8",
        "median_note": "C7",
        "estimated_key": "C Major",
    }
    rec_high = analyzer.recommend_key(extreme_high_song, target_preset="Bass")
    assert rec_high["recommended_semitones"] == -12

    # Extremely low song (C1 to C2)
    extreme_low_song = {
        "is_voiced": True,
        "lowest_note": "C1",
        "highest_note": "C2",
        "median_note": "F#1",
        "estimated_key": "C Major",
    }
    rec_low = analyzer.recommend_key(extreme_low_song, target_preset="Soprano")
    assert rec_low["recommended_semitones"] == 12


def test_audio_file_loading_and_resampling(analyzer: VocalRangeAnalyzer, tmp_path: Path):
    sr_orig = 44100
    t = np.arange(sr_orig) / sr_orig
    audio_stereo = np.column_stack(
        [np.sin(2 * np.pi * 440.0 * t), np.sin(2 * np.pi * 440.0 * t)]
    ).astype(np.float32)

    wav_file = tmp_path / "test_stereo_44k.wav"
    sf.write(str(wav_file), audio_stereo, sr_orig)

    res = analyzer.analyze_vocals(wav_file)
    assert res["is_voiced"] is True
    assert res["lowest_note"] == "A4"

    # Non-existent file raises FileNotFoundError
    with pytest.raises(FileNotFoundError):
        analyzer.analyze_vocals(tmp_path / "non_existent_file.wav")
