"""backend/tests/test_challenger2_stress.py

Adversarial stress testing and boundary condition suite for Milestone 1:
1. High concurrency requests to GET and POST endpoints under PROJECTS_LOCK with concurrent mutations.
2. Projects with corrupted, missing, 0-byte, or unvoiced vocal stem files.
3. Auto-backfill verification on legacy project fixtures lacking vocal_range.
"""

from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient

from backend import config
from backend.main import PROJECTS_LOCK, projects, save_projects


def generate_sine_stem(
    file_path: Path,
    duration: float = 1.0,
    sr: int = 44100,
    freq: float = 440.0,
) -> Path:
    """Generate a clean sine wave audio stem on disk."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.6 * np.sin(2 * np.pi * freq * t)
    sf.write(str(file_path), sine, sr)
    return file_path


def generate_silent_stem(file_path: Path, duration: float = 0.5, sr: int = 44100) -> Path:
    """Generate a pure silence audio stem on disk."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    silence = np.zeros(int(sr * duration), dtype=np.float32)
    sf.write(str(file_path), silence, sr)
    return file_path


# ==============================================================================
# 1. HIGH CONCURRENCY UNDER PROJECTS_LOCK
# ==============================================================================


def test_high_concurrency_cold_start_auto_backfill(client: TestClient):
    """Stress test: 30 concurrent threads simultaneously requesting GET /vocal-range

    on a project that has NOT yet computed vocal_range (cold start).
    Verifies that all 30 threads succeed (status 200), compute consistent results,
    and do not cause data corruption or race conditions in projects.json.
    """
    pid = "cold_start_concurrent_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = stems_dir / "vocals.wav"
    generate_sine_stem(vocals_file, duration=0.8, freq=261.63)  # C4

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "title": "Concurrent Cold Start Test",
            "artist": "Stress Tester",
            "vocals_path": str(vocals_file),
            "instrumental_path": str(vocals_file),
            # Explicitly omitting vocal_range
        }
        save_projects()

    results = []

    def fetch_vocal_range(idx: int):
        resp = client.get(f"/api/project/{pid}/vocal-range")
        return idx, resp.status_code, resp.json()

    with ThreadPoolExecutor(max_workers=16) as executor:
        futures = [executor.submit(fetch_vocal_range, i) for i in range(30)]
        for f in as_completed(futures):
            results.append(f.result())

    assert len(results) == 30
    for idx, status, body in results:
        assert status == 200, f"Thread {idx} failed with {status}: {body}"
        assert body["is_voiced"] is True
        assert body["lowest_note"] is not None
        assert body["highest_note"] is not None

    # Verify project store persisted vocal_range
    with PROJECTS_LOCK:
        persisted = projects[pid].get("vocal_range")
        assert persisted is not None
        assert persisted["is_voiced"] is True


def test_high_concurrency_mixed_read_write_lock_contention(client: TestClient):
    """Stress test: 40 concurrent workers mixing GET vocal-range, POST reanalyze,

    POST recommend-key, and PATCH project metadata to heavily stress PROJECTS_LOCK.
    """
    pid = "mixed_stress_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = stems_dir / "vocals.wav"
    generate_sine_stem(vocals_file, duration=0.6, freq=329.63)  # E4

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "title": "Initial Title",
            "artist": "Initial Artist",
            "vocals_path": str(vocals_file),
            "instrumental_path": str(vocals_file),
        }
        save_projects()

    def worker_action(op_id: int):
        op_type = op_id % 4
        if op_type == 0:
            # GET vocal-range
            r = client.get(f"/api/project/{pid}/vocal-range")
            return op_id, "GET_VR", r.status_code
        elif op_type == 1:
            # POST vocal-range (force re-analyze)
            r = client.post(f"/api/project/{pid}/vocal-range")
            return op_id, "POST_VR", r.status_code
        elif op_type == 2:
            # POST recommend-key
            r = client.post(
                f"/api/project/{pid}/recommend-key",
                json={"target_voice_preset": "Tenor"},
            )
            return op_id, "RECOMMEND", r.status_code
        else:
            # PATCH metadata
            r = client.patch(
                f"/api/project/{pid}",
                json={"title": f"Mutated Title {op_id}", "artist": "Mutated Artist"},
            )
            return op_id, "PATCH_META", r.status_code

    with ThreadPoolExecutor(max_workers=20) as executor:
        futures = [executor.submit(worker_action, i) for i in range(40)]
        results = [f.result() for f in as_completed(futures)]

    assert len(results) == 40
    for op_id, op_name, status in results:
        assert status == 200, f"Op {op_id} ({op_name}) failed with status {status}"

    # Verify project integrity after 40 concurrent mixed mutations
    with PROJECTS_LOCK:
        final_proj = projects[pid]
        assert final_proj["id"] == pid
        assert "vocal_range" in final_proj
        assert final_proj["vocal_range"]["is_voiced"] is True


# ==============================================================================
# 2. CORRUPTED, MISSING, EMPTY, AND UNVOICED VOCAL STEMS
# ==============================================================================


def test_boundary_missing_vocals_path_field(client: TestClient):
    """Project exists but vocals_path field is None or missing."""
    pid = "missing_vocals_field_proj"
    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "title": "No Stem Field",
            # No vocals_path
        }
        save_projects()

    r1 = client.get(f"/api/project/{pid}/vocal-range")
    assert r1.status_code == 400
    assert "missing or not ready" in r1.json()["detail"]

    r2 = client.post(f"/api/project/{pid}/vocal-range")
    assert r2.status_code == 400
    assert "missing or not ready" in r2.json()["detail"]

    r3 = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Baritone"},
    )
    assert r3.status_code == 400
    assert "vocal stem missing" in r3.json()["detail"]


def test_boundary_nonexistent_vocals_file_on_disk(client: TestClient):
    """Project specifies a vocals_path that does not exist on disk."""
    pid = "nonexistent_file_proj"
    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": "/path/to/definitely/nonexistent/vocals.wav",
        }
        save_projects()

    r = client.get(f"/api/project/{pid}/vocal-range")
    assert r.status_code == 400
    assert "missing or not ready" in r.json()["detail"]


def test_boundary_zero_byte_vocals_file(client: TestClient, tmp_path: Path):
    """Project vocals_path points to an empty (0 byte) file."""
    pid = "empty_stem_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    empty_file = stems_dir / "vocals.wav"
    empty_file.write_bytes(b"")  # 0 bytes

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": str(empty_file),
        }
        save_projects()

    r = client.get(f"/api/project/{pid}/vocal-range")
    assert r.status_code == 400
    assert "missing or not ready" in r.json()["detail"]

    r_rec = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Alto"},
    )
    assert r_rec.status_code == 400


def test_boundary_corrupted_audio_file(client: TestClient):
    """Project vocals_path points to a corrupted non-audio file (> 0 bytes, invalid WAV header).

    Server must catch the decode failure and return a clean 500 without crashing the process.
    """
    pid = "corrupt_stem_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    corrupt_file = stems_dir / "vocals.wav"
    # Write garbage bytes that look like a broken file
    corrupt_file.write_bytes(
        b"RIFF\x00\x00\x00\x00WAVEfmt \x10\x00\x00\x00corrupted_payload_junk_data"
    )

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": str(corrupt_file),
        }
        save_projects()

    r = client.get(f"/api/project/{pid}/vocal-range")
    assert r.status_code == 500
    assert "Failed to analyze vocal range" in r.json()["detail"]


def test_boundary_silent_audio_returns_unvoiced_cleanly(client: TestClient):
    """Vocal stem is valid audio but completely silent.

    Must return is_voiced=False with all pitch fields None, no NaN or crash.
    """
    pid = "silent_stem_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    silent_file = stems_dir / "vocals.wav"
    generate_silent_stem(silent_file, duration=1.0)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": str(silent_file),
        }
        save_projects()

    r = client.get(f"/api/project/{pid}/vocal-range")
    assert r.status_code == 200
    data = r.json()
    assert data["is_voiced"] is False
    assert data["lowest_note"] is None
    assert data["highest_note"] is None
    assert data["lowest_hz"] is None
    assert data["highest_hz"] is None
    assert data["estimated_key"] == "Unknown"

    # Now test recommend-key on the silent audio project
    r_rec = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Soprano"},
    )
    assert r_rec.status_code == 200
    rec_data = r_rec.json()
    assert rec_data["recommended_semitones"] == 0
    assert rec_data["projected_low_note"] is None
    assert rec_data["projected_high_note"] is None
    assert rec_data["cost"] == 0.0


def test_boundary_ultra_short_stem(client: TestClient):
    """Vocal stem has fewer samples than one FFT frame (< 2048 samples)."""
    pid = "tiny_stem_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    tiny_file = stems_dir / "vocals.wav"
    # Write only 100 samples of audio at 16000Hz (0.00625s)
    sf.write(str(tiny_file), np.ones(100, dtype=np.float32) * 0.1, 16000)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": str(tiny_file),
        }
        save_projects()

    r = client.get(f"/api/project/{pid}/vocal-range")
    assert r.status_code == 200
    data = r.json()
    assert data["is_voiced"] is False
    assert data["lowest_note"] is None


# ==============================================================================
# 3. AUTO-BACKFILL ON LEGACY FIXTURES WITHOUT VOCAL_RANGE
# ==============================================================================


def test_legacy_project_auto_backfill_end_to_end(client: TestClient):
    """Simulate a legacy project created before Milestone 1.

    It has no 'vocal_range' key in the store, but has a ready vocals.wav stem.
    1. GET /api/project/{id} shows no vocal_range initially.
    2. GET /api/project/{id}/vocal-range calculates and backfills it.
    3. GET /api/project/{id} now contains the backfilled vocal_range in the project model.
    4. Second call to GET /api/project/{id}/vocal-range uses the cached data.
    """
    pid = "legacy_m0_project"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = stems_dir / "vocals.wav"
    # A4 note (440 Hz)
    generate_sine_stem(vocals_file, duration=1.0, freq=440.0)

    # Legacy project dictionary strictly without vocal_range key
    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "progress": 100,
            "title": "Legacy 80s Rock",
            "artist": "Classic Band",
            "vocals_path": str(vocals_file),
            "vocals_url": f"/static/stems/{pid}/vocals.wav",
            "instrumental_path": str(vocals_file),
            "lyrics": [
                {
                    "text": "Living on a prayer",
                    "start": 1.0,
                    "end": 4.0,
                    "words": [{"word": "Living", "start": 1.0, "end": 2.0}],
                }
            ],
        }
        save_projects()

    # Step 1: Project model before backfill
    p_init = client.get(f"/api/project/{pid}").json()
    assert p_init.get("vocal_range") is None

    # Step 2: Auto-backfill via GET vocal-range
    resp_vr = client.get(f"/api/project/{pid}/vocal-range")
    assert resp_vr.status_code == 200
    vr_data = resp_vr.json()
    assert vr_data["is_voiced"] is True
    assert vr_data["lowest_note"] is not None

    # Step 3: Project model after backfill has vocal_range persisted
    p_after = client.get(f"/api/project/{pid}").json()
    assert p_after.get("vocal_range") is not None
    assert p_after["vocal_range"]["is_voiced"] is True
    assert p_after["vocal_range"]["lowest_note"] == vr_data["lowest_note"]

    # Step 4: Recommend key directly works on this backfilled project
    rec_resp = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Bass"},
    )
    assert rec_resp.status_code == 200
    rec_body = rec_resp.json()
    assert -12 <= rec_body["recommended_semitones"] <= 12
    assert rec_body["target_preset"] == "Bass"


def test_legacy_project_recommend_key_direct_auto_backfill(client: TestClient):
    """Calling POST /recommend-key on a legacy project without vocal_range

    directly triggers the auto-backfill without requiring an explicit GET first.
    """
    pid = "legacy_recommend_first_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    vocals_file = stems_dir / "vocals.wav"
    generate_sine_stem(vocals_file, duration=0.8, freq=349.23)  # F4

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": str(vocals_file),
            "instrumental_path": str(vocals_file),
        }
        save_projects()

    # Call recommend-key directly
    rec_resp = client.post(
        f"/api/project/{pid}/recommend-key",
        json={"target_voice_preset": "Baritone"},
    )
    assert rec_resp.status_code == 200
    rec = rec_resp.json()
    assert rec["target_preset"] == "Baritone"
    assert "recommended_semitones" in rec

    # Check that projects store was auto-backfilled
    with PROJECTS_LOCK:
        assert projects[pid].get("vocal_range") is not None
        assert projects[pid]["vocal_range"]["is_voiced"] is True
