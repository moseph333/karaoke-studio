"""Waveform overview endpoint and peak computation."""

import os
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.main import projects
from backend.services import waveform
from backend.services.waveform import MAX_BINS, MIN_BINS, WaveformUnavailable, compute_peaks

RATE = 8000


def _write(path: Path, signal: np.ndarray, stereo: bool = True) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.column_stack([signal, signal]) if stereo else signal
    sf.write(str(path), data, RATE)
    return path


def _quiet_then_loud(seconds: float = 4.0) -> np.ndarray:
    t = np.arange(int(RATE * seconds)) / RATE
    tone = np.sin(2 * np.pi * 220 * t)
    envelope = np.where(t < seconds / 2, 0.05, 0.5)
    return (tone * envelope).astype(np.float32)


@pytest.fixture(autouse=True)
def _fresh_cache():
    waveform.clear_cache()
    yield
    waveform.clear_cache()


def test_peaks_follow_loudness_and_cover_the_whole_track(tmp_path):
    path = _write(tmp_path / "song.wav", _quiet_then_loud())
    peaks, duration = compute_peaks(path, bins=100)
    assert len(peaks) == 100
    assert duration == pytest.approx(4.0, abs=0.01)
    assert max(peaks) == 1.0
    assert all(0.0 <= p <= 1.0 for p in peaks)
    quiet, loud = np.mean(peaks[:45]), np.mean(peaks[55:])
    assert loud > 0.95
    # 20 dB quieter on a 36 dB scale
    assert quiet == pytest.approx(1 - 20 / 36, abs=0.03)


def test_mono_files_and_silence(tmp_path):
    mono = _write(tmp_path / "mono.wav", _quiet_then_loud(), stereo=False)
    assert len(compute_peaks(mono, bins=60)[0]) == 60
    silent = _write(tmp_path / "silent.wav", np.zeros(RATE, dtype=np.float32))
    assert compute_peaks(silent, bins=50)[0] == [0.0] * 50


def test_bins_are_clamped(tmp_path):
    path = _write(tmp_path / "song.wav", _quiet_then_loud(1.0))
    assert len(compute_peaks(path, bins=3)[0]) == MIN_BINS
    assert len(compute_peaks(path, bins=10**6)[0]) == MAX_BINS


def test_results_are_cached_until_the_file_changes(tmp_path, monkeypatch):
    path = _write(tmp_path / "song.wav", _quiet_then_loud(1.0))
    calls = []
    real = waveform._analyze
    monkeypatch.setattr(waveform, "_analyze", lambda p, b: calls.append(b) or real(p, b))

    first = compute_peaks(path, bins=80)
    assert compute_peaks(path, bins=80) is first
    assert len(calls) == 1

    _write(path, _quiet_then_loud(2.0))
    later = time.time() + 5
    os.utime(path, (later, later))
    second = compute_peaks(path, bins=80)
    assert len(calls) == 2
    assert second[1] == pytest.approx(2.0, abs=0.01)


def test_missing_or_undecodable_files_raise(tmp_path):
    with pytest.raises(WaveformUnavailable):
        compute_peaks(tmp_path / "missing.wav")
    garbage = tmp_path / "garbage.wav"
    garbage.write_bytes(b"not really audio" * 10)
    with pytest.raises(WaveformUnavailable):
        compute_peaks(garbage)


@pytest.fixture
def wave_project(tmp_path):
    pid = "wave01"
    projects[pid] = {
        "id": pid,
        "title": "Waves",
        "status": "ready",
        "progress": 100,
        "lines": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "instrumental_path": str(_write(tmp_path / "inst.wav", _quiet_then_loud(2.0))),
    }
    yield projects[pid]
    projects.pop(pid, None)


def test_endpoint_prefers_the_master_mix(client, wave_project, tmp_path):
    wave_project["master_audio_path"] = str(_write(tmp_path / "master.wav", _quiet_then_loud(3.0)))
    res = client.get(f"/api/project/{wave_project['id']}/waveform", params={"bins": 120})
    assert res.status_code == 200
    body = res.json()
    assert body["source"] == "master"
    assert body["bins"] == 120
    assert len(body["peaks"]) == 120
    assert body["duration"] == pytest.approx(3.0, abs=0.01)


def test_endpoint_falls_back_to_the_instrumental(client, wave_project, tmp_path):
    wave_project["master_audio_path"] = str(tmp_path / "gone.wav")
    res = client.get(f"/api/project/{wave_project['id']}/waveform")
    assert res.status_code == 200
    assert res.json()["source"] == "instrumental"
    assert len(res.json()["peaks"]) == waveform.DEFAULT_BINS


def test_endpoint_reports_missing_audio_and_bad_requests(client, wave_project):
    wave_project.pop("instrumental_path")
    assert client.get(f"/api/project/{wave_project['id']}/waveform").status_code == 409
    assert (
        client.get(f"/api/project/{wave_project['id']}/waveform", params={"bins": 5}).status_code
        == 422
    )
    assert client.get("/api/project/does-not-exist/waveform").status_code == 404
