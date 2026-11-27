"""VocalRangeAnalyzer.pitch_contour: the pitch of a voice over time, from the same frames the
vocal range analysis reads, which it must leave exactly as it was."""

import numpy as np
import pytest
import soundfile as sf

from backend.services.vocal_analyzer import VocalRangeAnalyzer
from backend.tests.helpers.voices import one_voice_song, two_voice_song

SR = 16000


def _tone(hz: float, seconds: float, sr: int = SR, level: float = 0.4) -> np.ndarray:
    t = np.arange(int(sr * seconds)) / sr
    # A voice has overtones: the detector must still name the fundamental
    return level * (np.sin(2 * np.pi * hz * t) + 0.4 * np.sin(2 * np.pi * 2 * hz * t)) / 1.4


def _midi(hz: float) -> float:
    return 69 + 12 * np.log2(hz / 440.0)


@pytest.fixture
def analyzer():
    return VocalRangeAnalyzer()


@pytest.mark.parametrize("hz", [110.0, 220.0, 440.0, 659.26])
def test_a_held_note_reads_as_that_note_throughout(analyzer, hz):
    contour = analyzer.pitch_contour(_tone(hz, 2.0), sr=SR)

    sung = contour["midi"][~np.isnan(contour["midi"])]
    assert len(sung) == len(contour["midi"])
    assert np.allclose(sung, _midi(hz), atol=0.15)


def test_frames_are_placed_at_their_middles(analyzer):
    contour = analyzer.pitch_contour(_tone(220.0, 1.0), sr=SR)

    assert contour["hop"] == pytest.approx(512 / SR)
    assert contour["start"] == pytest.approx(1024 / SR)
    # As many frames as fit: (16000 - 2048) // 512 + 1
    assert len(contour["midi"]) == 28


def test_a_change_of_note_lands_at_its_moment(analyzer):
    audio = np.concatenate([_tone(220.0, 1.5), _tone(330.0, 1.5)])

    contour = analyzer.pitch_contour(audio, sr=SR)

    times = contour["start"] + contour["hop"] * np.arange(len(contour["midi"]))
    low = contour["midi"][times < 1.4]
    high = contour["midi"][times > 1.6]
    assert np.allclose(low, _midi(220.0), atol=0.2)
    assert np.allclose(high, _midi(330.0), atol=0.2)


def test_quiet_stretches_are_not_notes(analyzer):
    audio = np.concatenate([_tone(220.0, 1.0), np.zeros(SR), _tone(220.0, 1.0)])

    contour = analyzer.pitch_contour(audio, sr=SR)

    times = contour["start"] + contour["hop"] * np.arange(len(contour["midi"]))
    assert np.isnan(contour["midi"][(times > 1.2) & (times < 1.8)]).all()
    assert not np.isnan(contour["midi"][times < 0.9]).any()


def test_silence_has_frames_and_no_notes(analyzer):
    contour = analyzer.pitch_contour(np.zeros(SR * 2, dtype=np.float32), sr=SR)

    assert len(contour["midi"]) == (SR * 2 - 2048) // 512 + 1
    assert np.isnan(contour["midi"]).all()


@pytest.mark.parametrize("samples", [0, 1, 2047])
def test_audio_shorter_than_a_frame_has_no_frames(analyzer, samples):
    contour = analyzer.pitch_contour(np.zeros(samples, dtype=np.float32), sr=SR)

    assert len(contour["midi"]) == 0
    assert contour["hop"] == pytest.approx(0.032)


def test_a_file_is_read_at_its_own_rate(analyzer, tmp_path):
    path = tmp_path / "voice.wav"
    stereo = np.column_stack([_tone(440.0, 2.0, sr=44100)] * 2)
    sf.write(str(path), stereo, 44100)

    contour = analyzer.pitch_contour(str(path))

    assert np.nanmedian(contour["midi"]) == pytest.approx(69.0, abs=0.15)
    # Two seconds, whatever rate the file was saved at
    assert contour["start"] + contour["hop"] * len(contour["midi"]) == pytest.approx(2.0, abs=0.1)


@pytest.mark.parametrize("song", [one_voice_song, two_voice_song])
def test_the_contour_and_the_range_analysis_read_the_same_frames(analyzer, tmp_path, song):
    stem = song(str(tmp_path / "vocals.wav"))[0]

    contour = analyzer.pitch_contour(stem)
    summary = analyzer.analyze_vocals(stem)

    assert summary["total_frames_count"] == len(contour["midi"])
    assert summary["voiced_frames_count"] == int((~np.isnan(contour["midi"])).sum())


def test_the_range_analysis_still_gives_what_it_gave(analyzer):
    """The frame loop moved into a generator: a held A with a held E above it must come out
    with the same range, typical note and counts as before."""
    audio = np.concatenate([_tone(220.0, 2.0), _tone(329.63, 2.0)])

    summary = analyzer.analyze_audio(audio, sr=SR)

    assert summary["is_voiced"] is True
    assert summary["lowest_note"] == "A3"
    assert summary["highest_note"] == "E4"
    assert summary["total_frames_count"] == (SR * 4 - 2048) // 512 + 1
    assert summary["voiced_frames_count"] == summary["total_frames_count"]
    assert summary["median_hz"] is not None
