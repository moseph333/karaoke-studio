"""With real FFmpeg: a practice vocal goes through the very chain the backing takes in a
master at the same key, so the two files carry the same delay and stay in step when the
browser plays them side by side."""

import shutil
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects
from backend.master_audio import make_master_mix, make_practice_vocal

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")

PID = "instep"
SR = 44100


def _clicks(seconds: float = 6.0, every: float = 0.5) -> np.ndarray:
    """A click twice a second over a quiet tone: something a pitch shifter has to place."""
    t = np.arange(int(SR * seconds)) / SR
    audio = 0.05 * np.sin(2 * np.pi * 220.0 * t)
    for start in np.arange(0.25, seconds - 0.1, every):
        at = int(start * SR)
        audio[at : at + 64] = 0.8
    return audio


def _click_times(path: str) -> np.ndarray:
    audio, sr = sf.read(path)
    mono = audio if audio.ndim == 1 else audio.mean(axis=1)
    loud = np.flatnonzero(np.abs(mono) > 0.4)
    starts = loud[np.insert(np.diff(loud) > sr * 0.1, 0, True)]
    return starts / sr


@pytest.fixture
def song(tmp_path):
    """A song whose backing and vocals are the same recording, so their files can be compared
    sample for sample."""
    stems = main_mod.STEMS_DIR / PID
    stems.mkdir(parents=True)
    audio = _clicks()
    for name in ("instrumental.wav", "vocals.wav"):
        sf.write(str(stems / name), np.column_stack([audio, audio]), SR)
    projects[PID] = {
        "id": PID,
        "track_id": PID,
        "status": "ready",
        "lines": [],
        "instrumental_path": str(stems / "instrumental.wav"),
        "vocals_path": str(stems / "vocals.wav"),
    }
    return projects[PID]


@pytest.mark.parametrize("semitones", [2, -3])
def test_the_vocal_takes_the_backings_chain(song, semitones):
    master = make_master_mix(song, semitones, 0.0)
    vocal = make_practice_vocal(song, semitones)

    assert Path(vocal).name != Path(master).name
    backing, _ = sf.read(master)
    alone, _ = sf.read(vocal)
    # Same input, same filters: the same samples, so whatever delay the limiter adds to the
    # master it adds to the vocal
    assert alone.shape == backing.shape
    assert np.array_equal(alone, backing)


def test_a_shifted_vocal_keeps_the_songs_timing(song):
    vocal = make_practice_vocal(song, 2)

    shifted = _click_times(vocal)
    original = _click_times(song["vocals_path"])
    assert len(shifted) == len(original)
    # The preview shifter moves a click by a few hundredths of a second at most, and never
    # more as the song goes on
    assert np.max(np.abs(shifted - original)) < 0.06
    assert abs((shifted[-1] - shifted[0]) - (original[-1] - original[0])) < 0.03


def test_the_file_is_as_long_as_the_song(song):
    vocal = make_practice_vocal(song, 2)

    assert sf.info(vocal).duration == pytest.approx(6.0, abs=0.05)
    assert sf.info(vocal).samplerate == SR
