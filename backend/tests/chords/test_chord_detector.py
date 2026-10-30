"""Unit and DSP integration tests for Harmonic Chord Progression Detector and Transposition Engine."""

from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

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

NOTE_FREQS = {
    "C3": 130.81,
    "D3": 146.83,
    "E3": 164.81,
    "F3": 174.61,
    "G3": 196.00,
    "A3": 220.00,
    "B3": 246.94,
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "F4": 349.23,
    "G4": 392.00,
    "A4": 440.00,
    "B4": 493.88,
    "C5": 523.25,
    "D5": 587.33,
    "E5": 659.25,
    "F5": 698.46,
    "G5": 783.99,
    "A5": 880.00,
    "B5": 987.77,
}

CHORD_VOICINGS = {
    "C": ["C4", "E4", "G4"],
    "Am": ["A3", "C4", "E4"],
    "F": ["F3", "A3", "C4"],
    "G": ["G3", "B3", "D4"],
    "G7": ["G3", "B3", "D4", "F4"],
    "Cmaj7": ["C4", "E4", "G4", "B4"],
    "Dm7": ["D4", "F4", "A4", "C5"],
}


def synth_chord(
    chord: str, duration: float = 1.0, sr: int = 22050, n_harmonics: int = 3
) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sig = np.zeros_like(t, dtype=np.float32)
    notes = CHORD_VOICINGS.get(chord, ["C4", "E4", "G4"])
    for note in notes:
        freq = NOTE_FREQS[note]
        for h in range(1, n_harmonics + 1):
            sig += (1.0 / h) * np.sin(2.0 * np.pi * freq * h * t, dtype=np.float32)
    peak = float(np.max(np.abs(sig)))
    if peak > 0:
        sig = (sig / peak) * 0.5
    return sig


def synth_progression(progression: list[tuple[str, float]], sr: int = 22050):
    audio_parts = []
    truth = []
    cur_t = 0.0
    for chord, dur in progression:
        part = synth_chord(chord, dur, sr)
        audio_parts.append(part)
        truth.append({"start": round(cur_t, 2), "end": round(cur_t + dur, 2), "chord": chord})
        cur_t += dur
    full_audio = np.concatenate(audio_parts)
    return full_audio, truth


# ==============================================================================
# 1. Harmonic Detection Tests
# ==============================================================================


def test_detect_progression_c_am_f_g7():
    detector = ChordDetector()
    prog = [("C", 1.5), ("Am", 1.5), ("F", 1.5), ("G7", 1.5)]
    audio, _ = synth_progression(prog)

    segments = detector.detect_chords(audio)
    assert len(segments) >= 4

    # Extract non-silent sequence
    detected_chords = [s["chord"] for s in segments if s["chord"] != "N"]
    assert "C" in detected_chords
    assert "Am" in detected_chords
    assert "F" in detected_chords
    assert "G7" in detected_chords

    # Verify chronological order
    first_c = next(i for i, s in enumerate(segments) if s["chord"] == "C")
    first_am = next(i for i, s in enumerate(segments) if s["chord"] == "Am")
    first_f = next(i for i, s in enumerate(segments) if s["chord"] == "F")
    first_g7 = next(i for i, s in enumerate(segments) if s["chord"] == "G7")
    assert first_c < first_am < first_f < first_g7


def test_detect_progression_cmaj7_dm7():
    detector = ChordDetector()
    prog = [("Cmaj7", 2.0), ("Dm7", 2.0)]
    audio, _ = synth_progression(prog)

    segments = detector.detect_chords(audio)
    assert len(segments) >= 2
    detected_chords = [s["chord"] for s in segments if s["chord"] != "N"]
    assert "Cmaj7" in detected_chords
    assert "Dm7" in detected_chords

    idx_cmaj7 = next(i for i, s in enumerate(segments) if s["chord"] == "Cmaj7")
    idx_dm7 = next(i for i, s in enumerate(segments) if s["chord"] == "Dm7")
    assert idx_cmaj7 < idx_dm7


def test_silence_rejection():
    detector = ChordDetector()
    silence = np.zeros(22050 * 3, dtype=np.float32)

    segments = detector.detect_chords(silence)
    assert len(segments) > 0
    for s in segments:
        assert s["chord"] == "N"
        assert s["confidence"] == 0.0

    filtered = detector.detect_chords(silence, filter_no_chord=True)
    assert filtered == []


def test_white_noise_rejection():
    detector = ChordDetector()
    rng = np.random.RandomState(42)
    noise = (rng.randn(22050 * 3) * 0.1).astype(np.float32)

    segments = detector.detect_chords(noise)
    assert len(segments) > 0
    # Flatness and correlation cutoff gate noise to 'N'
    for s in segments:
        assert s["chord"] == "N"


def test_multichannel_downmix():
    detector = ChordDetector()
    c_audio = synth_chord("C", duration=1.0)
    stereo = np.column_stack([c_audio, c_audio])
    assert stereo.shape == (22050, 2)

    segments = detector.detect_chords(stereo)
    assert len(segments) > 0
    assert any(s["chord"] == "C" for s in segments)


def test_96khz_resampling():
    detector = ChordDetector()
    c_audio = synth_chord("C", duration=1.0, sr=96000)
    segments = detector.detect_chords(c_audio, sr=96000)
    assert len(segments) > 0
    assert any(s["chord"] == "C" for s in segments)


def test_audio_file_path_input(tmp_path: Path):
    detector = ChordDetector()
    c_audio = synth_chord("C", duration=1.0)
    wav_path = tmp_path / "c_chord.wav"
    sf.write(str(wav_path), c_audio, 22050)

    segments = detector.detect_chords(str(wav_path))
    assert len(segments) > 0
    assert any(s["chord"] == "C" for s in segments)


def test_missing_audio_file_raises():
    detector = ChordDetector()
    with pytest.raises(FileNotFoundError):
        detector.detect_chords("/nonexistent/path/to/missing.wav")


def test_adversarial_audio_inputs():
    detector = ChordDetector()

    # Empty array
    assert detector.detect_chords(np.array([], dtype=np.float32)) == []

    # Sub-frame audio
    assert detector.detect_chords(np.ones(100, dtype=np.float32)) == []

    # Audio with NaN and Inf
    corrupted = synth_chord("C", duration=1.0)
    corrupted[100:150] = np.nan
    corrupted[200:250] = np.inf
    corrupted[300:350] = -np.inf
    segments = detector.detect_chords(corrupted)
    assert len(segments) > 0
    for s in segments:
        assert np.isfinite(s["start"])
        assert np.isfinite(s["end"])
        assert np.isfinite(s["confidence"])


def test_interval_monotonicity_guarantee():
    detector = ChordDetector()
    prog = [("C", 1.0), ("Am", 1.0), ("F", 1.0), ("G", 1.0)]
    audio, _ = synth_progression(prog)
    segments = detector.detect_chords(audio)

    for i in range(len(segments)):
        assert segments[i]["start"] < segments[i]["end"]
        assert segments[i]["start"] >= 0.0
        if i > 0:
            assert segments[i]["start"] >= segments[i - 1]["end"]


# ==============================================================================
# 2. Transposition Engine & Enharmonics Tests
# ==============================================================================


ROOTS_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
QUALITIES = ["", "m", "7", "maj7", "m7"]
SEMITONES_RANGE = list(range(-12, 13))


def test_strict_identity_at_zero():
    for root in [*ROOTS_SHARP, "Db", "Eb", "Gb", "Ab", "Bb"]:
        for q in QUALITIES:
            chord = f"{root}{q}"
            assert transpose_chord(chord, 0) == chord
            assert transpose_chord(chord, 0, key="F Major") == chord
            assert transpose_chord(chord, 0, key="G Major") == chord
    assert transpose_chord("N", 0) == "N"


def test_accidental_preservation_at_octaves():
    for s in (-12, 12):
        assert transpose_chord("C#", s, key="F Major") == "C#"
        assert transpose_chord("Db", s, key="G Major") == "Db"
        assert transpose_chord("Bbmaj7", s, key="D Major") == "Bbmaj7"
        assert transpose_chord("A#m7", s, key="Eb Major") == "A#m7"
        assert transpose_chord("N", s) == "N"


def test_key_enharmonic_spelling_flat_keys():
    # Db Major (flat key)
    assert transpose_chord("C", 1, key="Db Major") == "Db"
    # Bb Major (flat key)
    assert transpose_chord("G7", 3, key="Bb Major") == "Bb7"
    assert transpose_chord("Am", 1, key="Bb Major") == "Bbm"
    # F Major (flat key)
    assert transpose_chord("G", -2, key="F Major") == "F"
    assert transpose_chord("Cmaj7", -2, key="F Major") == "Bbmaj7"


def test_key_enharmonic_spelling_sharp_keys():
    # D Major (sharp key)
    assert transpose_chord("C", 2, key="D Major") == "D"
    # B Minor (sharp key)
    assert transpose_chord("Am", 1, key="B Minor") == "A#m"
    assert transpose_chord("C", 1, key="B Minor") == "C#"
    # G Major (sharp key)
    assert transpose_chord("Dm7", 7, key="G Major") == "Am7"


def test_neutral_key_defaults():
    # Flat chord in neutral key preserves flat spelling
    assert transpose_chord("Bb", 2, key="C Major") == "C"
    assert transpose_chord("Eb", 1, key="C Major") == "E"
    assert transpose_chord("Bb", 1, key=None) == "B"
    # Sharp or natural chord in neutral key uses sharp spelling
    assert transpose_chord("C", 1, key="C Major") == "C#"
    assert transpose_chord("F", 1, key=None) == "F#"


def test_slash_chords():
    assert transpose_chord("C/G", 2, key="D Major") == "D/A"
    assert transpose_chord("Am7/F#", -2, key="F Major") == "Gm7/E"


def test_no_chord_tokens():
    for token in ["N", "NC", "N.C.", "NO-CHORD", "NONE", ""]:
        assert transpose_chord(token, 5) == "N"


def test_progression_transposition():
    chords = [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 2.0, "end": 4.0, "chord": "Am"},
        {"start": 4.0, "end": 6.0, "chord": "F"},
        {"start": 6.0, "end": 8.0, "chord": "G7"},
    ]
    transposed = transpose_chord_progression(chords, 2, key="D Major")
    assert [c["chord"] for c in transposed] == ["D", "Bm", "G", "A7"]
    # Verify non-destructive copy
    assert chords[0]["chord"] == "C"


def test_out_of_bounds_raises_value_error():
    with pytest.raises(ValueError, match=r"semitones must be in range"):
        transpose_chord("C", 13)
    with pytest.raises(ValueError, match=r"semitones must be in range"):
        transpose_chord("C", -13)
    with pytest.raises(ValueError, match=r"semitones must be in range"):
        transpose_chord_progression([], 15)


def test_project_key_signature():
    assert project_key_signature("C Major", 0) == "C Major"
    assert project_key_signature("C Major", 1) == "Db Major"
    assert project_key_signature("C Major", 2) == "D Major"
    assert project_key_signature("F Major", -2) == "Eb Major"
    assert project_key_signature("A Minor", 1) == "Bb Minor"
    assert project_key_signature("A Minor", 2) == "B Minor"
    assert project_key_signature("Unknown", 2) == "Unknown"
    assert project_key_signature(None, 2) == "C Major"


@pytest.mark.parametrize("semitones", SEMITONES_RANGE)
@pytest.mark.parametrize("root", ROOTS_SHARP)
@pytest.mark.parametrize("quality", QUALITIES)
def test_full_matrix_consistency(semitones, root, quality):
    chord = f"{root}{quality}"
    sharp_result = transpose_chord(chord, semitones, key="G Major")
    flat_result = transpose_chord(chord, semitones, key="F Major")

    p_sharp = parse_chord_symbol(sharp_result)
    p_flat = parse_chord_symbol(flat_result)
    assert p_sharp is not None and p_flat is not None
    assert p_sharp[1] == quality
    assert p_flat[1] == quality


def test_classify_key_spelling():
    assert classify_key_spelling("F Major") == "flat"
    assert classify_key_spelling("Bb Major") == "flat"
    assert classify_key_spelling("G Major") == "sharp"
    assert classify_key_spelling("D Major") == "sharp"
    assert classify_key_spelling("C Major", original_chord="Bb") == "flat"
    assert classify_key_spelling("C Major", original_chord="C") == "sharp"
    assert classify_key_spelling(None, original_chord="Eb") == "flat"
    assert classify_key_spelling(None, original_chord="D") == "sharp"


def test_parse_chord_symbol_edge_cases():
    assert parse_chord_symbol("") is None
    assert parse_chord_symbol("N") is None
    assert parse_chord_symbol("invalid_chord") is None
    parsed = parse_chord_symbol("F#m7/C#")
    assert parsed == ("F#", "m7", "C#")
    parsed_flat = parse_chord_symbol("Bbm")
    assert parsed_flat == ("Bb", "m", None)
