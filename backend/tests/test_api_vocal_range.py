"""backend/tests/test_api_vocal_range.py

Comprehensive API integration test suite for Vocal Range & Key Recommendation (R1).
Validates GET /vocal-range with cached returns and on-demand auto-backfill from disk,
POST /vocal-range forced re-analysis, POST /recommend-key with presets and custom ranges,
404/400/422 error states, unvoiced audio safeguards, and thread-safety under PROJECTS_LOCK.
"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.main import projects, save_projects


def create_synthetic_vocal_stem(
    file_path: Path,
    duration: float = 1.0,
    sr: int = 44100,
    freq: float = 440.0,
) -> Path:
    """Generate a valid mono sine-wave WAV file on disk for hermetic testing."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * freq * t)
    sf.write(str(file_path), sine, sr)
    return file_path


def create_silent_vocal_stem(file_path: Path, duration: float = 0.5, sr: int = 44100) -> Path:
    """Generate a pure silent WAV file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    silence = np.zeros(int(sr * duration), dtype=np.float32)
    sf.write(str(file_path), silence, sr)
    return file_path


@pytest.fixture
def mock_vocal_analyzer(monkeypatch):
    """Hermetic mock or real instance fallback for VocalRangeAnalyzer."""

    class FakeVocalAnalyzer:
        def analyze_vocals(self, audio_path: str | Path) -> dict[str, Any]:
            p = Path(audio_path)
            if not p.exists() or p.stat().st_size == 0:
                raise ValueError("Invalid stem file")
            data, _sr = sf.read(str(p))
            if np.max(np.abs(data)) < 1e-4:
                return {
                    "is_voiced": False,
                    "lowest_note": None,
                    "highest_note": None,
                    "lowest_hz": None,
                    "highest_hz": None,
                    "tessitura_low_note": None,
                    "tessitura_high_note": None,
                    "tessitura_low_hz": None,
                    "tessitura_high_hz": None,
                    "median_note": None,
                    "median_hz": None,
                    "estimated_key": "Unknown",
                    "key_confidence": 0.0,
                    "voiced_frames_count": 0,
                    "total_frames_count": len(data),
                }
            return {
                "is_voiced": True,
                "lowest_note": "A3",
                "highest_note": "A4",
                "lowest_hz": 220.0,
                "highest_hz": 440.0,
                "tessitura_low_note": "C4",
                "tessitura_high_note": "G4",
                "tessitura_low_hz": 261.63,
                "tessitura_high_hz": 392.0,
                "median_note": "E4",
                "median_hz": 329.63,
                "estimated_key": "A Minor",
                "key_confidence": 0.91,
                "voiced_frames_count": 500,
                "total_frames_count": 600,
            }

        def recommend_key(
            self,
            song_range: dict[str, Any] | None = None,
            target_preset: str | None = None,
            custom_low_note: str | None = None,
            custom_high_note: str | None = None,
            *,
            song_vocal_range: dict[str, Any] | None = None,
            target_voice_preset: str | None = None,
        ) -> dict[str, Any]:
            actual_song = song_range if song_range is not None else song_vocal_range
            actual_preset = target_preset if target_preset is not None else target_voice_preset
            preset = actual_preset or "Custom"
            return {
                "recommended_semitones": -2 if "Baritone" in preset or "Bass" in preset else 0,
                "projected_key": "G Minor"
                if ("Baritone" in preset or "Bass" in preset)
                else (actual_song or {}).get("estimated_key", "A Minor"),
                "projected_low_note": "G3" if ("Baritone" in preset or "Bass" in preset) else "A3",
                "projected_high_note": "G4" if ("Baritone" in preset or "Bass" in preset) else "A4",
                "cost": 5.0,
                "is_in_range": True,
                "target_preset": actual_preset,
                "original_key": (actual_song or {}).get("estimated_key", "A Minor"),
            }

    fake = FakeVocalAnalyzer()
    monkeypatch.setattr(main_mod, "vocal_analyzer", fake, raising=False)
    return fake


@pytest.fixture
def project_with_stem(tmp_path: Path):
    """Creates a project in store with a valid synthetic vocals.wav stem on disk."""
    pid = "test_vr_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = stems_dir / "vocals.wav"
    create_synthetic_vocal_stem(vocals_file, duration=0.5, freq=440.0)

    proj_data = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "progress": 100,
        "title": "Acoustic Melody",
        "artist": "Vocalist",
        "vocals_path": str(vocals_file),
        "vocals_url": f"/static/stems/{pid}/vocals.wav",
        "instrumental_path": str(vocals_file),
        "vocal_range": None,
    }
    projects[pid] = proj_data
    save_projects()
    return pid, vocals_file


# ==============================================================================
# Test Cases
# ==============================================================================


def test_get_vocal_range_cached(client: TestClient, mock_vocal_analyzer):
    """Cached vocal range returns immediately without disk re-reading."""
    pid = "cached_vr_proj"
    cached = {
        "is_voiced": True,
        "lowest_note": "C3",
        "highest_note": "C5",
        "lowest_hz": 130.81,
        "highest_hz": 523.25,
        "tessitura_low_note": "G3",
        "tessitura_high_note": "G4",
        "tessitura_low_hz": 196.0,
        "tessitura_high_hz": 392.0,
        "median_note": "C4",
        "median_hz": 261.63,
        "estimated_key": "C Major",
        "key_confidence": 0.95,
        "voiced_frames_count": 800,
        "total_frames_count": 1000,
    }
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "vocal_range": cached,
        "vocals_path": "/invalid/nonexistent/path.wav",  # Should not be accessed
    }
    save_projects()

    res = client.get(f"/api/project/{pid}/vocal-range")
    assert res.status_code == 200
    data = res.json()
    assert data["is_voiced"] is True
    assert data["lowest_note"] == "C3"
    assert data["highest_note"] == "C5"
    assert data["estimated_key"] == "C Major"


def test_get_vocal_range_auto_backfill(client: TestClient, project_with_stem, mock_vocal_analyzer):
    """Project with missing vocal_range automatically computes and caches from vocals.wav."""
    pid, _vocals_file = project_with_stem
    assert projects[pid].get("vocal_range") is None

    res = client.get(f"/api/project/{pid}/vocal-range")
    assert res.status_code == 200
    data = res.json()
    assert data["is_voiced"] is True
    assert data["lowest_note"] == "A3"
    assert data["highest_note"] == "A4"
    assert data["estimated_key"] == "A Minor"

    # Confirm cached in store
    assert projects[pid]["vocal_range"] is not None
    assert projects[pid]["vocal_range"]["estimated_key"] == "A Minor"


def test_get_vocal_range_404_missing_project(client: TestClient):
    """Non-existent project returns 404."""
    res = client.get("/api/project/missing_project_id/vocal-range")
    assert res.status_code == 404
    assert "Project not found" in res.json()["detail"]


def test_get_vocal_range_400_missing_stem(client: TestClient):
    """Project without vocal stem returns 400."""
    pid = "no_stem_proj"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "vocals_path": None,
        "vocal_range": None,
    }
    save_projects()

    res = client.get(f"/api/project/{pid}/vocal-range")
    assert res.status_code == 400
    assert "stem missing or not ready" in res.json()["detail"].lower()


def test_get_vocal_range_400_empty_file(client: TestClient, tmp_path: Path):
    """Project pointing to 0-byte stem file returns 400."""
    pid = "empty_stem_proj"
    empty_file = tmp_path / "empty_vocals.wav"
    empty_file.touch()

    projects[pid] = {
        "id": pid,
        "status": "ready",
        "vocals_path": str(empty_file),
        "vocal_range": None,
    }
    save_projects()

    res = client.get(f"/api/project/{pid}/vocal-range")
    assert res.status_code == 400
    assert "stem missing or not ready" in res.json()["detail"].lower()


def test_post_vocal_range_forced_reanalysis(
    client: TestClient, project_with_stem, mock_vocal_analyzer
):
    """POST /vocal-range forces recalculation and overwrites existing cached range."""
    pid, _vocals_file = project_with_stem
    # Seed with outdated vocal_range
    projects[pid]["vocal_range"] = {
        "is_voiced": False,
        "lowest_note": "F2",
        "highest_note": "F3",
        "lowest_hz": 87.31,
        "highest_hz": 174.61,
        "tessitura_low_note": None,
        "tessitura_high_note": None,
        "tessitura_low_hz": None,
        "tessitura_high_hz": None,
        "median_note": None,
        "median_hz": None,
        "estimated_key": "F Major",
        "key_confidence": 0.5,
        "voiced_frames_count": 10,
        "total_frames_count": 20,
    }
    save_projects()

    res = client.post(f"/api/project/{pid}/vocal-range")
    assert res.status_code == 200
    data = res.json()
    assert data["is_voiced"] is True
    assert data["lowest_note"] == "A3"  # Fresh result from mock
    assert projects[pid]["vocal_range"]["lowest_note"] == "A3"


def test_post_vocal_range_404_and_400(client: TestClient):
    """POST /vocal-range handles 404 missing project and 400 missing stem."""
    res_404 = client.post("/api/project/missing_id/vocal-range")
    assert res_404.status_code == 404

    pid = "bad_stem_proj"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "vocals_path": "/nonexistent.wav",
    }
    save_projects()
    res_400 = client.post(f"/api/project/{pid}/vocal-range")
    assert res_400.status_code == 400


def test_recommend_key_preset_happy_path(
    client: TestClient, project_with_stem, mock_vocal_analyzer
):
    """POST /recommend-key calculates integer semitones for voice presets."""
    pid, _ = project_with_stem

    # Test Baritone preset
    res = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Baritone"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["recommended_semitones"] == -2
    assert -12 <= data["recommended_semitones"] <= 12
    assert data["projected_key"] == "G Minor"
    assert data["is_in_range"] is True
    assert data["target_preset"] == "Baritone"


def test_recommend_key_all_voice_presets(
    client: TestClient, project_with_stem, mock_vocal_analyzer
):
    """All 6 voice presets and lowercase aliases validate and return 200."""
    pid, _ = project_with_stem
    presets = [
        "Bass",
        "Baritone",
        "Tenor",
        "Alto",
        "Mezzo-Soprano",
        "Soprano",
        "bass",
        "baritone",
        "tenor",
        "alto",
        "mezzo-soprano",
        "soprano",
    ]
    for p in presets:
        res = client.post(
            f"/api/project/{pid}/recommend-key",
            json={"target_voice_preset": p},
        )
        assert res.status_code == 200
        assert -12 <= res.json()["recommended_semitones"] <= 12


def test_recommend_key_custom_range(client: TestClient, project_with_stem, mock_vocal_analyzer):
    """POST /recommend-key with custom low and high note range."""
    pid, _ = project_with_stem
    res = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"custom_low_note": "A2", "custom_high_note": "E4"},
    )
    assert res.status_code == 200
    data = res.json()
    assert -12 <= data["recommended_semitones"] <= 12
    assert data["projected_low_note"] is not None
    assert data["projected_high_note"] is not None


def test_recommend_key_unvoiced_audio(client: TestClient, tmp_path: Path, mock_vocal_analyzer):
    """Silent or unvoiced vocal track returns 0 semitones safely without 500 error."""
    pid = "unvoiced_proj"
    silent_file = tmp_path / "silent_vocals.wav"
    create_silent_vocal_stem(silent_file, duration=0.2)

    projects[pid] = {
        "id": pid,
        "status": "ready",
        "vocals_path": str(silent_file),
        "vocal_range": None,
    }
    save_projects()

    res = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Tenor"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["recommended_semitones"] == 0
    assert data["projected_key"] == "Unknown"
    assert data["projected_low_note"] is None
    assert data["projected_high_note"] is None


def test_recommend_key_auto_backfill(client: TestClient, project_with_stem, mock_vocal_analyzer):
    """Calling /recommend-key when vocal_range is None automatically triggers auto-backfill."""
    pid, _ = project_with_stem
    assert projects[pid].get("vocal_range") is None

    res = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Tenor"},
    )
    assert res.status_code == 200
    assert projects[pid]["vocal_range"] is not None


def test_recommend_key_validation_errors(client: TestClient, project_with_stem):
    """Invalid requests return 422 Unprocessable Entity."""
    pid, _ = project_with_stem

    # Missing both preset and custom range
    res_empty = client.post(f"/api/project/{pid}/recommend-key", json={})
    assert res_empty.status_code == 422

    # Invalid preset name
    res_bad_preset = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Castrato"},
    )
    assert res_bad_preset.status_code == 422

    # Invalid note formatting (non-SPN)
    res_bad_note = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"custom_low_note": "InvalidNote", "custom_high_note": "C5"},
    )
    assert res_bad_note.status_code == 422

    # Missing one custom boundary
    res_missing_high = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"custom_low_note": "C3"},
    )
    assert res_missing_high.status_code == 422


def test_recommend_key_404_and_400(client: TestClient):
    """404 on missing project and 400 on missing vocal stem."""
    res_404 = client.post(
        "/api/project/missing_id/recommend-key",
        json={"target_voice_preset": "Tenor"},
    )
    assert res_404.status_code == 404

    pid = "no_stem_rec_proj"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "vocals_path": None,
        "vocal_range": None,
    }
    save_projects()

    res_400 = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Tenor"},
    )
    assert res_400.status_code == 400


def test_vocal_range_thread_safety(client: TestClient, project_with_stem, mock_vocal_analyzer):
    """Concurrent requests execute safely under PROJECTS_LOCK without race conditions."""
    pid, _ = project_with_stem

    def call_get():
        return client.get(f"/api/project/{pid}/vocal-range")

    def call_recommend():
        return client.post(
            f"/api/project/{pid}/recommend-key",
            json={"target_voice_preset": "Baritone"},
        )

    tasks = [call_get, call_recommend] * 5
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(lambda fn: fn(), tasks))

    for r in results:
        assert r.status_code == 200

    # Verify project store is healthy and not corrupted
    assert projects[pid]["vocal_range"] is not None
