"""A practice vocal is kept as one of the song's cached mixes: its name is a mix name, so it
is pruned with them, made again after the vocals change, and deleted with the song."""

import os
import re
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend import config
from backend.main import projects
from backend.master_audio import (
    MIX_CACHE_MARKER,
    PRACTICE_VOCAL_KEY,
    find_practice_vocal,
    mix_cache_epoch,
    practice_vocal_filename,
    prune_mix_cache,
)
from backend.project_store import cleanup_project_disk_artifacts

PID = "practicecache"


def _write_wav(path: Path, seconds: float = 0.1) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tone = 0.2 * np.sin(2 * np.pi * 440.0 * np.arange(int(44100 * seconds)) / 44100)
    sf.write(str(path), tone, 44100)
    return path


def _age(path: Path, seconds_ago: float) -> None:
    stamp = time.time() - seconds_ago
    os.utime(path, (stamp, stamp))


@pytest.fixture(autouse=True)
def mixer_in_use_for_an_hour():
    mix_cache_epoch(main_mod.OUTPUT_DIR)
    _age(main_mod.OUTPUT_DIR / MIX_CACHE_MARKER, 3600)


@pytest.fixture
def song():
    stems = main_mod.STEMS_DIR / PID
    inst = _write_wav(stems / "instrumental.wav")
    vocals = _write_wav(stems / "vocals.wav")
    _age(inst, 1200)
    _age(vocals, 1200)
    projects[PID] = {
        "id": PID,
        "track_id": PID,
        "status": "ready",
        "lines": [],
        "instrumental_path": str(inst),
        "vocals_path": str(vocals),
    }
    return projects[PID]


def _practice_vocal(semitones: int, seconds_ago: float) -> Path:
    """A practice vocal last used ``seconds_ago``. Never read one before a prune: with
    relatime the read would mark it as just used."""
    wav = _write_wav(main_mod.OUTPUT_DIR / practice_vocal_filename(PID, semitones))
    _age(wav, seconds_ago)
    return wav


def _mix(semitones: int, seconds_ago: float) -> Path:
    wav = _write_wav(main_mod.OUTPUT_DIR / f"{PID}_mix_{semitones}_0.wav")
    _age(wav, seconds_ago)
    return wav


def _prune(song: dict, keep: str | None = None) -> list[str]:
    return sorted(
        prune_mix_cache(
            main_mod.OUTPUT_DIR, PID, song["instrumental_path"], song["vocals_path"], keep=keep
        )
    )


def _left() -> list[str]:
    return sorted(p.name for p in main_mod.OUTPUT_DIR.iterdir() if p.name.startswith(f"{PID}_"))


def test_the_name_is_a_mix_name_with_a_vocal_key():
    name = practice_vocal_filename(PID, -4)

    assert name == f"{PID}_mix_-4_100_{PRACTICE_VOCAL_KEY}.wav"
    # The pattern prune_mix_cache and the startup prune match a song's mixes with
    assert re.fullmatch(re.escape(PID) + r"_mix_-?\d+_(\d+)(_[0-9a-f]{8})?\.wav", name)
    assert re.fullmatch(r"[0-9a-f]{8}", PRACTICE_VOCAL_KEY)


def test_practice_vocals_count_toward_the_songs_mix_limit(song, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 3)
    _mix(0, 500)
    _mix(2, 400)
    _practice_vocal(2, 300)
    _practice_vocal(-1, 200)
    newest = _mix(5, 100)

    removed = _prune(song)

    # The two least recently used go, whichever kind they are
    assert removed == [f"{PID}_mix_0_0.wav", f"{PID}_mix_2_0.wav"]
    assert _left() == sorted(
        [practice_vocal_filename(PID, 2), practice_vocal_filename(PID, -1), newest.name]
    )


def test_the_least_recently_used_practice_vocal_goes_first(song, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    _practice_vocal(2, 400)
    _practice_vocal(3, 200)

    assert _prune(song) == [practice_vocal_filename(PID, 2)]


def test_one_made_before_the_vocals_changed_is_deleted_and_not_reused(song):
    _practice_vocal(2, 600)
    # The vocals were replaced five minutes ago
    _age(Path(song["vocals_path"]), 300)

    assert find_practice_vocal(song, 2) is None
    assert _prune(song) == [practice_vocal_filename(PID, 2)]


def test_one_made_before_a_vocal_split_changed_the_parts_is_deleted(song):
    _practice_vocal(2, 600)
    lead = _write_wav(Path(song["vocals_path"]).with_name("vocals_lead.wav"))
    _age(lead, 300)

    assert _prune(song) == [practice_vocal_filename(PID, 2)]


def test_one_made_by_an_older_mixer_is_not_reused(song):
    _practice_vocal(2, 7200)

    assert find_practice_vocal(song, 2) is None


def test_a_current_one_is_found_and_counts_as_used(song):
    wav = _practice_vocal(2, 300)
    before = wav.stat()

    assert find_practice_vocal(song, 2) == str(wav)
    after = wav.stat()
    assert after.st_mtime == before.st_mtime  # its link's version stays
    assert after.st_atime > before.st_atime


def test_the_one_just_made_is_kept_whatever_the_limit(song, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    kept = _practice_vocal(2, 400)
    _mix(0, 200)

    assert _prune(song, keep=str(kept)) == []


def test_deleting_the_song_deletes_its_practice_vocals(song):
    wav = _practice_vocal(2, 300)
    preview = wav.with_suffix(".m4a")
    preview.write_bytes(b"fake aac")
    proj = projects.pop(PID)

    cleanup_project_disk_artifacts(PID, proj=proj)

    assert _left() == []
