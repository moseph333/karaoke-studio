"""Empirical Challenger Test Suite for Milestone 1 Iteration 3.

Adversarial Verification of:
1. POST empty chords {"chords": []} -> GET returns [] without triggering re-detection.
2. POST empty chords {"chords": []} -> GET with transposition ?semitones=X returns [].
3. POST non-empty chords -> POST empty chords -> GET returns [].
4. POST /detect on a project with empty chords -> triggers re-detection and returns fresh chords.
5. Strict interval monotonicity and HTTP 422 validation.
6. Disk serialization and concurrency stress.

Layout compliance: located in backend/tests/ (hermetic offline execution).
"""

import json
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.main import PROJECTS_LOCK, projects, save_projects


def create_synthetic_audio(file_path: Path, duration: float = 2.0, sr: int = 22050) -> Path:
    """Creates a valid synthetic WAV file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
    sf.write(str(file_path), sine, sr)
    return file_path


@pytest.fixture
def project_with_audio_stem():
    """Sets up a clean ready project with a synthetic instrumental audio stem."""
    pid = "m1_iter3_adv_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    inst_file = stems_dir / "instrumental.wav"
    create_synthetic_audio(inst_file, duration=3.0, sr=22050)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "progress": 100,
            "title": "Iteration 3 Adversarial Track",
            "artist": "Challenger 1",
            "instrumental_path": str(inst_file),
            "vocals_path": str(inst_file),
            "vocal_range": {"estimated_key": "C Major"},
            "chords": None,
        }
        save_projects()

    return pid, inst_file


class SpyDetector:
    """Mock detector that records invocations and returns deterministic chord segments."""

    def __init__(self, return_chords: list[dict[str, Any]] | None = None):
        self.call_count = 0
        self.last_audio_path = None
        self.return_chords = (
            return_chords
            if return_chords is not None
            else [
                {"id": "det-0", "start": 0.0, "end": 1.5, "chord": "C", "confidence": 0.95},
                {"id": "det-1", "start": 1.5, "end": 3.0, "chord": "G", "confidence": 0.91},
            ]
        )

    def detect_chords(self, audio_path: str | Path | np.ndarray, **kwargs) -> list[dict[str, Any]]:
        self.call_count += 1
        self.last_audio_path = audio_path
        return [dict(c) for c in self.return_chords]


# ==============================================================================
# EDGE CASE 1: POST [] -> GET returns [] without triggering re-detection
# ==============================================================================


def test_post_empty_chords_get_returns_empty_without_redetection(
    client: TestClient, project_with_audio_stem, monkeypatch
):
    """Saving empty chords {"chords": []} must persist [] and subsequent GET requests

    must return [] immediately without triggering auto-backfill detector.
    """
    pid, _ = project_with_audio_stem
    spy = SpyDetector()
    monkeypatch.setattr(main_mod, "chord_detector", spy, raising=False)

    # 1. POST empty chords
    res_post = client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert res_post.status_code == 200, res_post.text
    post_data = res_post.json()
    assert post_data["status"] == "ok"
    assert post_data["chords_count"] == 0
    assert post_data["chords"] == []
    assert spy.call_count == 0, "Detector should not be called during POST"

    # In-memory store must reflect empty list
    assert projects[pid]["chords"] == []

    # 2. GET chords
    res_get = client.get(f"/api/project/{pid}/chords")
    assert res_get.status_code == 200, res_get.text
    get_data = res_get.json()
    assert get_data["project_id"] == pid
    assert get_data["chords"] == []
    assert get_data["detected"] is True

    # Critical check: detector was NOT invoked during GET!
    assert spy.call_count == 0, (
        f"Auto-backfill detector was invoked {spy.call_count} times on GET! "
        "Truthiness bug clobbering empty chords is still present."
    )

    # 3. Multiple consecutive GET requests must all return [] and never call detector
    for _i in range(10):
        r = client.get(f"/api/project/{pid}/chords")
        assert r.status_code == 200
        assert r.json()["chords"] == []
    assert spy.call_count == 0, "Repeated GET requests must use cached empty list"


# ==============================================================================
# EDGE CASE 2: POST [] -> GET with transposition ?semitones=X returns []
# ==============================================================================


@pytest.mark.parametrize("semitones", [-12, -7, -5, -1, 0, 1, 5, 7, 12])
def test_post_empty_chords_get_transposed_returns_empty(
    client: TestClient, project_with_audio_stem, monkeypatch, semitones: int
):
    """GET /api/project/{id}/chords?semitones=X on a project with empty chords

    must safely return [] across the entire valid transposition range [-12, 12].
    """
    pid, _ = project_with_audio_stem
    spy = SpyDetector()
    monkeypatch.setattr(main_mod, "chord_detector", spy, raising=False)

    # Save empty progression
    res_post = client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert res_post.status_code == 200

    # Query with transposition
    res_get = client.get(f"/api/project/{pid}/chords?semitones={semitones}")
    assert res_get.status_code == 200, res_get.text
    data = res_get.json()
    assert data["chords"] == [], f"Expected [], got {data['chords']} for semitones={semitones}"
    assert data["detected"] is True
    assert spy.call_count == 0, f"Detector was unexpectedly called for semitones={semitones}"


@pytest.mark.parametrize("invalid_semitones", [-100, -13, 13, 100])
def test_transposition_out_of_range_returns_422(
    client: TestClient, project_with_audio_stem, invalid_semitones: int
):
    """GET /api/project/{id}/chords?semitones=X must reject out-of-range semitones with HTTP 422."""
    pid, _ = project_with_audio_stem
    client.post(f"/api/project/{pid}/chords", json={"chords": []})

    res = client.get(f"/api/project/{pid}/chords?semitones={invalid_semitones}")
    assert res.status_code == 422


# ==============================================================================
# EDGE CASE 3: POST non-empty -> POST empty -> GET returns []
# ==============================================================================


def test_post_non_empty_then_empty_then_persistence(
    client: TestClient, project_with_audio_stem, monkeypatch
):
    """Transition cycle: non-empty -> empty -> non-empty -> empty.

    Must correctly update in-memory store and projects.json on disk.
    """
    pid, _ = project_with_audio_stem
    spy = SpyDetector()
    monkeypatch.setattr(main_mod, "chord_detector", spy, raising=False)

    chord_progression_1 = [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 2.0, "end": 4.0, "chord": "Am"},
    ]
    chord_progression_2 = [
        {"start": 1.0, "end": 3.0, "chord": "F"},
    ]

    # Step 1: Save non-empty chords
    res1 = client.post(f"/api/project/{pid}/chords", json={"chords": chord_progression_1})
    assert res1.status_code == 200
    assert res1.json()["chords_count"] == 2

    # Step 2: GET returns the 2 chords
    get1 = client.get(f"/api/project/{pid}/chords")
    assert get1.status_code == 200
    assert len(get1.json()["chords"]) == 2
    assert get1.json()["chords"][0]["chord"] == "C"

    # Step 3: User deletes / clears chords -> POST []
    res_empty1 = client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert res_empty1.status_code == 200
    assert res_empty1.json()["chords_count"] == 0

    # Step 4: GET returns []
    get_empty1 = client.get(f"/api/project/{pid}/chords")
    assert get_empty1.status_code == 200
    assert get_empty1.json()["chords"] == []

    # Step 5: Verify disk persistence (projects.json on disk)
    store_file = main_mod.PROJECTS_STORE_FILE
    disk_data = json.loads(store_file.read_text(encoding="utf-8"))
    assert disk_data[pid]["chords"] == [], "Disk state must be [] after saving empty chords"

    # Step 6: Save another non-empty set
    res2 = client.post(f"/api/project/{pid}/chords", json={"chords": chord_progression_2})
    assert res2.status_code == 200
    assert res2.json()["chords_count"] == 1

    get2 = client.get(f"/api/project/{pid}/chords")
    assert len(get2.json()["chords"]) == 1
    assert get2.json()["chords"][0]["chord"] == "F"

    # Step 7: Clear again -> POST []
    res_empty2 = client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert res_empty2.status_code == 200
    assert res_empty2.json()["chords_count"] == 0

    get_empty2 = client.get(f"/api/project/{pid}/chords")
    assert get_empty2.status_code == 200
    assert get_empty2.json()["chords"] == []

    disk_data_final = json.loads(store_file.read_text(encoding="utf-8"))
    assert disk_data_final[pid]["chords"] == []

    # All of these operations must NOT have triggered the auto-backfill detector
    assert spy.call_count == 0


# ==============================================================================
# EDGE CASE 4: POST /detect on a project with empty chords -> triggers re-detection
# ==============================================================================


def test_force_detect_on_empty_chords_triggers_redetection(
    client: TestClient, project_with_audio_stem, monkeypatch
):
    """Explicit POST /api/project/{id}/chords/detect MUST run detector even if

    the project currently has cached empty chords [].
    """
    pid, _ = project_with_audio_stem

    custom_detected = [
        {"id": "re-0", "start": 0.0, "end": 2.0, "chord": "Dm7", "confidence": 0.89},
        {"id": "re-1", "start": 2.0, "end": 4.0, "chord": "G7", "confidence": 0.93},
    ]
    spy = SpyDetector(return_chords=custom_detected)
    monkeypatch.setattr(main_mod, "chord_detector", spy, raising=False)

    # 1. Project has empty chords saved
    client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert projects[pid]["chords"] == []
    assert spy.call_count == 0

    # 2. Call POST /api/project/{id}/chords/detect
    res_detect = client.post(f"/api/project/{pid}/chords/detect")
    assert res_detect.status_code == 200, res_detect.text
    detect_data = res_detect.json()
    assert detect_data["project_id"] == pid
    assert detect_data["detected"] is True
    assert len(detect_data["chords"]) == 2
    assert detect_data["chords"][0]["chord"] == "Dm7"
    assert detect_data["chords"][1]["chord"] == "G7"

    # Detector MUST have been invoked exactly once
    assert spy.call_count == 1, "POST /detect must invoke detector"

    # In-memory store and disk must be updated
    assert len(projects[pid]["chords"]) == 2

    # 3. Subsequent GET returns the newly detected chords WITHOUT calling detector again
    res_get = client.get(f"/api/project/{pid}/chords")
    assert res_get.status_code == 200
    assert len(res_get.json()["chords"]) == 2
    assert spy.call_count == 1, "Subsequent GET must use newly cached chords"


def test_force_detect_rejects_non_ready_project(client: TestClient, project_with_audio_stem):
    """POST /detect on project with status != 'ready' must return HTTP 400."""
    pid, _ = project_with_audio_stem
    with PROJECTS_LOCK:
        projects[pid]["status"] = "processing"
        save_projects()

    res = client.post(f"/api/project/{pid}/chords/detect")
    assert res.status_code == 400
    assert "not complete" in res.json()["detail"]


def test_force_detect_rejects_missing_stem(client: TestClient, project_with_audio_stem):
    """POST /detect on project with missing instrumental stem must return HTTP 400."""
    pid, _ = project_with_audio_stem
    with PROJECTS_LOCK:
        projects[pid]["instrumental_path"] = "/nonexistent/path.wav"
        projects[pid]["audio_path"] = "/nonexistent/path2.wav"
        save_projects()

    res = client.post(f"/api/project/{pid}/chords/detect")
    assert res.status_code == 400
    assert "missing or not ready" in res.json()["detail"]


# ==============================================================================
# EDGE CASE 5: Interval monotonicity and HTTP 422 validation
# ==============================================================================


@pytest.mark.parametrize(
    "invalid_payload,case_desc",
    [
        # Zero duration
        ({"chords": [{"start": 1.0, "end": 1.0, "chord": "C"}]}, "zero_duration"),
        # Inverted timestamps
        ({"chords": [{"start": 2.0, "end": 1.0, "chord": "C"}]}, "inverted_timestamps"),
        # Negative start
        ({"chords": [{"start": -0.1, "end": 1.0, "chord": "C"}]}, "negative_start"),
        # Negative end
        ({"chords": [{"start": -2.0, "end": -1.0, "chord": "C"}]}, "negative_end"),
        # Overlapping consecutive intervals
        (
            {
                "chords": [
                    {"start": 0.0, "end": 2.0, "chord": "C"},
                    {"start": 1.9, "end": 3.0, "chord": "G"},
                ]
            },
            "overlapping_consecutive",
        ),
        # Microscopic overlap (0.1ms)
        (
            {
                "chords": [
                    {"start": 0.0, "end": 2.0, "chord": "C"},
                    {"start": 1.9999, "end": 3.0, "chord": "G"},
                ]
            },
            "microscopic_overlap",
        ),
        # Out of order intervals
        (
            {
                "chords": [
                    {"start": 3.0, "end": 4.0, "chord": "C"},
                    {"start": 1.0, "end": 2.0, "chord": "G"},
                ]
            },
            "out_of_order",
        ),
        # Excessive timestamp (> 86400s)
        (
            {"chords": [{"start": 86401.0, "end": 86405.0, "chord": "C"}]},
            "excessive_start_timestamp",
        ),
        ({"chords": [{"start": 0.0, "end": 90000.0, "chord": "C"}]}, "excessive_end_timestamp"),
        # Empty chord symbol
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": ""}]}, "empty_chord_symbol"),
        # Whitespace-only chord symbol
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": "   "}]}, "whitespace_chord_symbol"),
        # Oversized chord symbol (> 32 chars)
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": "C" * 33}]}, "oversized_chord_symbol"),
        # Invalid confidence
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": 1.5}]},
            "confidence_too_high",
        ),
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": -0.1}]},
            "confidence_negative",
        ),
        # Missing required fields
        ({"chords": [{"start": 0.0, "chord": "C"}]}, "missing_end"),
        ({"chords": [{"end": 1.0, "chord": "C"}]}, "missing_start"),
        ({"chords": [{"start": 0.0, "end": 1.0}]}, "missing_chord"),
        # Non-list chords field
        ({"chords": "not_a_list"}, "chords_is_string"),
        ({"chords": None}, "chords_is_none"),
        ({"chords": 12345}, "chords_is_int"),
    ],
)
def test_interval_validation_strictly_returns_422(
    client: TestClient, project_with_audio_stem, invalid_payload: dict, case_desc: str
):
    """All invalid, overlapping, inverted, and malformed chord payloads must return HTTP 422."""
    pid, _ = project_with_audio_stem
    res = client.post(f"/api/project/{pid}/chords", json=invalid_payload)
    assert res.status_code == 422, (
        f"Expected 422 for {case_desc}, got {res.status_code}: {res.text}"
    )


@pytest.mark.parametrize(
    "valid_payload,expected_count,case_desc",
    [
        ({"chords": []}, 0, "empty_list"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": "C"}]}, 1, "single_chord"),
        (
            {
                "chords": [
                    {"start": 0.0, "end": 1.0, "chord": "C"},
                    {"start": 1.0, "end": 2.0, "chord": "G"},
                ]
            },
            2,
            "strictly_abutting",
        ),
        (
            {
                "chords": [
                    {"start": 0.0, "end": 1.0, "chord": "C"},
                    {"start": 1.5, "end": 2.5, "chord": "Am"},
                    {"start": 3.0, "end": 4.0, "chord": "F"},
                ]
            },
            3,
            "monotonic_with_gaps",
        ),
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "N", "confidence": 0.0}]},
            1,
            "no_chord_symbol_zero_confidence",
        ),
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "Cmaj7", "confidence": 1.0}]},
            1,
            "maj7_max_confidence",
        ),
    ],
)
def test_valid_payloads_accepted_with_200(
    client: TestClient,
    project_with_audio_stem,
    valid_payload: dict,
    expected_count: int,
    case_desc: str,
):
    """Valid monotonic chord payloads must be accepted with HTTP 200."""
    pid, _ = project_with_audio_stem
    res = client.post(f"/api/project/{pid}/chords", json=valid_payload)
    assert res.status_code == 200, (
        f"Expected 200 for {case_desc}, got {res.status_code}: {res.text}"
    )
    assert res.json()["chords_count"] == expected_count


# ==============================================================================
# EDGE CASE 6: Concurrency and Race Condition Stress
# ==============================================================================


def test_concurrent_empty_and_populated_operations_no_race(
    client: TestClient, project_with_audio_stem, monkeypatch
):
    """Aggressive multi-threaded execution of GET, POST [], and POST populated chords

    on the same project must never crash, deadlock, or corrupt state.
    """
    pid, _ = project_with_audio_stem
    spy = SpyDetector()
    monkeypatch.setattr(main_mod, "chord_detector", spy, raising=False)

    # Initial save: empty
    client.post(f"/api/project/{pid}/chords", json={"chords": []})

    def op_get():
        r = client.get(f"/api/project/{pid}/chords")
        assert r.status_code == 200
        # Result chords must be either [] or the 1-chord list
        assert len(r.json()["chords"]) in (0, 1)

    def op_post_empty():
        r = client.post(f"/api/project/{pid}/chords", json={"chords": []})
        assert r.status_code == 200

    def op_post_populated():
        r = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 0.0, "end": 1.0, "chord": "C"}]},
        )
        assert r.status_code == 200

    tasks = [op_get, op_post_empty, op_get, op_post_populated, op_get] * 8

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(t) for t in tasks]
        for f in futures:
            f.result()

    # After concurrent operations, final state must be clean and valid
    final_res = client.get(f"/api/project/{pid}/chords")
    assert final_res.status_code == 200
    assert len(final_res.json()["chords"]) in (0, 1)
    # Detector must never have been called during these operations because chords was never None
    assert spy.call_count == 0
