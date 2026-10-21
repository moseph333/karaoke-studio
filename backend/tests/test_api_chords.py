"""Comprehensive API integration and validation test suite for Harmonic Chord Progression

Detection, Auto-Backfill, Persistence, and Interval Monotonicity (Milestone 1).
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
from backend.main import projects, save_projects, update_project_chords


def create_synthetic_wav(file_path: Path, duration: float = 1.0, sr: int = 44100) -> Path:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * 440.0 * t)
    sf.write(str(file_path), sine, sr)
    return file_path


@pytest.fixture
def mock_chord_detector(monkeypatch):
    """Hermetic mock for ChordDetector."""

    class FakeChordDetector:
        def detect_chords(
            self, audio_path: str | Path | np.ndarray, **kwargs
        ) -> list[dict[str, Any]]:
            if isinstance(audio_path, (str, Path)):
                p = Path(audio_path)
                if not p.exists() or p.stat().st_size == 0:
                    raise ValueError("Invalid stem file")
            return [
                {"id": "chord-0", "start": 0.0, "end": 2.0, "chord": "C", "confidence": 0.95},
                {"id": "chord-1", "start": 2.0, "end": 4.0, "chord": "Am", "confidence": 0.92},
                {"id": "chord-2", "start": 4.0, "end": 6.0, "chord": "F", "confidence": 0.88},
                {"id": "chord-3", "start": 6.0, "end": 8.0, "chord": "G7", "confidence": 0.94},
            ]

    fake = FakeChordDetector()
    monkeypatch.setattr(main_mod, "chord_detector", fake, raising=False)
    return fake


@pytest.fixture
def project_with_inst_stem():
    pid = "test_chord_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    inst_file = stems_dir / "instrumental.wav"
    create_synthetic_wav(inst_file, duration=8.0)

    proj_data = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "progress": 100,
        "title": "Harmonic Song",
        "artist": "Chord Master",
        "instrumental_path": str(inst_file),
        "vocals_path": str(inst_file),
        "vocal_range": {"estimated_key": "C Major"},
        "chords": None,
    }
    projects[pid] = proj_data
    save_projects()
    return pid, inst_file


# ------------------------------------------------------------------------------
# GET /api/project/{id}/chords Tests
# ------------------------------------------------------------------------------


def test_get_chords_cached(client: TestClient):
    pid = "cached_chord_proj"
    cached = [
        {"id": "chord-0", "start": 0.0, "end": 2.0, "chord": "C", "confidence": 0.9},
        {"id": "chord-1", "start": 2.0, "end": 4.0, "chord": "G", "confidence": 0.9},
    ]
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "chords": cached,
        "instrumental_path": "/nonexistent/stem.wav",
    }
    save_projects()

    res = client.get(f"/api/project/{pid}/chords")
    assert res.status_code == 200
    data = res.json()
    assert data["project_id"] == pid
    assert len(data["chords"]) == 2
    assert data["chords"][0]["chord"] == "C"
    assert data["chords"][1]["chord"] == "G"


def test_get_chords_auto_backfill(client: TestClient, project_with_inst_stem, mock_chord_detector):
    pid, _ = project_with_inst_stem
    assert projects[pid].get("chords") is None

    res = client.get(f"/api/project/{pid}/chords")
    assert res.status_code == 200
    data = res.json()
    assert data["project_id"] == pid
    assert len(data["chords"]) == 4
    assert data["chords"][0]["chord"] == "C"
    assert data["chords"][3]["chord"] == "G7"

    # Verify persisted in store
    assert projects[pid]["chords"] is not None
    assert len(projects[pid]["chords"]) == 4


def test_get_chords_transposed(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    cached = [
        {"id": "chord-0", "start": 0.0, "end": 2.0, "chord": "C"},
        {"id": "chord-1", "start": 2.0, "end": 4.0, "chord": "Am"},
    ]
    projects[pid]["chords"] = cached
    projects[pid]["vocal_range"] = {"estimated_key": "C Major"}
    save_projects()

    res = client.get(f"/api/project/{pid}/chords?semitones=2")
    assert res.status_code == 200
    data = res.json()
    assert data["chords"][0]["chord"] == "D"
    assert data["chords"][1]["chord"] == "Bm"

    # Verify base store remains untransposed
    assert projects[pid]["chords"][0]["chord"] == "C"


def test_get_chords_invalid_semitones_422(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    res = client.get(f"/api/project/{pid}/chords?semitones=15")
    assert res.status_code == 422


def test_get_chords_404_missing_project(client: TestClient):
    res = client.get("/api/project/nonexistent_id/chords")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_get_chords_400_missing_stem(client: TestClient):
    pid = "no_stem_proj"
    projects[pid] = {"id": pid, "status": "ready", "chords": None}
    save_projects()

    res = client.get(f"/api/project/{pid}/chords")
    assert res.status_code == 400
    assert "stem missing or not ready" in res.json()["detail"].lower()


def test_get_chords_400_empty_stem(client: TestClient, tmp_path: Path):
    pid = "empty_stem_proj"
    empty_file = tmp_path / "empty_inst.wav"
    empty_file.touch()

    projects[pid] = {
        "id": pid,
        "status": "ready",
        "instrumental_path": str(empty_file),
        "chords": None,
    }
    save_projects()

    res = client.get(f"/api/project/{pid}/chords")
    assert res.status_code == 400
    assert "stem missing or not ready" in res.json()["detail"].lower()


# ------------------------------------------------------------------------------
# POST /api/project/{id}/chords Tests (Monotonicity & Overlap Validation)
# ------------------------------------------------------------------------------


def test_post_chords_valid_monotonic_intervals(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    payload = {
        "chords": [
            {"start": 0.0, "end": 2.0, "chord": "C"},
            {"start": 2.0, "end": 4.0, "chord": "Am"},
            {"start": 5.0, "end": 7.0, "chord": "F"},  # Gap allowed
            {"start": 7.0, "end": 9.0, "chord": "G7"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["chords_count"] == 4
    assert projects[pid]["chords"][0]["chord"] == "C"


def test_post_chords_empty_list_accepted(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    res = client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert res.status_code == 200
    assert res.json()["chords_count"] == 0
    assert projects[pid]["chords"] == []


def test_post_chords_reject_inverted_interval(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    # start >= end
    payload = {"chords": [{"start": 3.0, "end": 1.0, "chord": "C"}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 422
    assert "strictly less than end" in str(res.json()["detail"])


def test_post_chords_reject_zero_duration(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    # start == end
    payload = {"chords": [{"start": 2.0, "end": 2.0, "chord": "C"}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 422


def test_post_chords_reject_overlapping_intervals(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    # end_0 (2.5) > start_1 (2.0)
    payload = {
        "chords": [
            {"start": 0.0, "end": 2.5, "chord": "C"},
            {"start": 2.0, "end": 4.0, "chord": "Am"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 422
    assert "Overlapping or non-monotonic" in str(res.json()["detail"])


def test_post_chords_reject_out_of_order_intervals(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    payload = {
        "chords": [
            {"start": 4.0, "end": 6.0, "chord": "Am"},
            {"start": 1.0, "end": 3.0, "chord": "C"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 422


def test_post_chords_reject_negative_start(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    payload = {"chords": [{"start": -1.0, "end": 2.0, "chord": "C"}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 422


def test_post_chords_reject_nan_inf(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    # Test string Infinity rejection via API
    res = client.post(
        f"/api/project/{pid}/chords",
        json={"chords": [{"start": 1.0, "end": "Infinity", "chord": "C"}]},
    )
    assert res.status_code == 422

    # Test raw NaN token rejection via HTTP content
    res_raw = client.post(
        f"/api/project/{pid}/chords",
        content=b'{"chords": [{"start": NaN, "end": 2.0, "chord": "C"}]}',
        headers={"Content-Type": "application/json"},
    )
    assert res_raw.status_code == 422

    # Verify Pydantic schema rejects NaN/Inf directly
    from pydantic import ValidationError

    from backend.schemas import ChordSegmentSchema

    with pytest.raises(ValidationError):
        ChordSegmentSchema(start=float("nan"), end=2.0, chord="C")

    with pytest.raises(ValidationError):
        ChordSegmentSchema(start=0.0, end=float("inf"), chord="C")


def test_post_chords_reject_empty_chord_string(client: TestClient, project_with_inst_stem):
    pid, _ = project_with_inst_stem
    payload = {"chords": [{"start": 0.0, "end": 2.0, "chord": "   "}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 422


def test_post_chords_404_missing_project(client: TestClient):
    res = client.post("/api/project/missing_id/chords", json={"chords": []})
    assert res.status_code == 404


# ------------------------------------------------------------------------------
# POST /api/project/{id}/chords/detect Tests
# ------------------------------------------------------------------------------


def test_post_chords_detect_forced(client: TestClient, project_with_inst_stem, mock_chord_detector):
    pid, _ = project_with_inst_stem
    projects[pid]["chords"] = [{"start": 0.0, "end": 1.0, "chord": "Old"}]
    save_projects()

    res = client.post(f"/api/project/{pid}/chords/detect")
    assert res.status_code == 200
    data = res.json()
    assert len(data["chords"]) == 4
    assert data["chords"][0]["chord"] == "C"
    assert projects[pid]["chords"][0]["chord"] == "C"


def test_post_chords_detect_404_and_400(client: TestClient):
    res_404 = client.post("/api/project/missing_id/chords/detect")
    assert res_404.status_code == 404

    pid = "bad_inst_proj"
    projects[pid] = {"id": pid, "status": "ready", "instrumental_path": "/bad.wav"}
    save_projects()
    res_400 = client.post(f"/api/project/{pid}/chords/detect")
    assert res_400.status_code == 400


# ------------------------------------------------------------------------------
# Thread-Safety & Helper Tests
# ------------------------------------------------------------------------------


def test_update_project_chords_helper(project_with_inst_stem):
    pid, _ = project_with_inst_stem
    new_chords = [{"start": 0.0, "end": 2.0, "chord": "G"}]
    updated = update_project_chords(pid, new_chords)
    assert updated["chords"] == new_chords
    assert projects[pid]["chords"] == new_chords


def test_update_project_chords_empty_list(project_with_inst_stem):
    """update_project_chords atomically persists empty list without truthiness hazard."""
    pid, _ = project_with_inst_stem
    updated = update_project_chords(pid, [])
    assert updated["chords"] == []
    assert projects[pid]["chords"] == []


def test_karaoke_project_chords_none_and_empty_handling():
    """KaraokeProject schema handles None, empty list, missing key, and populated chords."""
    from backend.schemas import KaraokeProject

    # 1. Missing chords field defaults to None (un-backfilled / pending detection)
    p_missing = KaraokeProject(id="p1")
    assert p_missing.chords is None

    # 2. Explicit chords=None parses cleanly without ValidationError
    p_none = KaraokeProject(id="p2", chords=None)
    assert p_none.chords is None

    # 3. Explicit empty chords list preserves empty list
    p_empty = KaraokeProject(id="p3", chords=[])
    assert p_empty.chords == []

    # 4. Populated chords list parses and validates segment items
    p_pop = KaraokeProject(id="p4", chords=[{"start": 0.0, "end": 1.0, "chord": "C"}])
    assert len(p_pop.chords) == 1
    assert p_pop.chords[0].chord == "C"


def test_chords_concurrency_thread_safety(
    client: TestClient, project_with_inst_stem, mock_chord_detector
):
    pid, _ = project_with_inst_stem

    def call_get():
        return client.get(f"/api/project/{pid}/chords")

    def call_post():
        return client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 0.0, "end": 2.0, "chord": "C"}]},
        )

    tasks = [call_get, call_post] * 5
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(lambda fn: fn(), tasks))

    for r in results:
        assert r.status_code == 200

    assert projects[pid]["chords"] is not None
