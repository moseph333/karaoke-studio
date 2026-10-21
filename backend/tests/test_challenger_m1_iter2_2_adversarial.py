"""Adversarial Verification and Fuzzing Suite for Milestone 1 Iteration 2.

Author: Challenger 2 (API & Persistence Concurrency Challenger)
Scope:
1. Interval validation fuzzing on POST /api/project/{id}/chords:
   - Inverted timestamps (start > end, start >= end)
   - Zero-duration (start == end)
   - Negative start/end (start < 0, end < 0)
   - Non-finite floats (NaN, Inf, -Inf via strings and raw IEEE JSON tokens)
   - Non-numeric types (strings, lists, dicts, null, boolean values)
   - Boundary checks (86400s max limit, sub-millisecond precision, IEEE 754 precision)
   - Overlapping / non-monotonic intervals
   - Malformed payloads and non-dict bodies
   - Verifying HTTP 422 strictly with structured error detail (never HTTP 500).
2. Multi-threaded Concurrency & Persistence Stress Testing:
   - High-concurrency operations across multiple projects and worker threads.
   - Aggressive continuous background disk reading of projects.json to detect any corruption or partial writes.
   - Verification of zero temp file leakage (.projects.json.tmp.*).
3. Auto-Backfill and Stem Edge Cases:
   - Missing stems (None, nonexistent path, directory path, 0-byte file) returning HTTP 400.
   - Fallback to audio_path when instrumental_path is missing.
   - Corrupted audio files returning HTTP 500 cleanly without server crash.
   - Nonexistent projects returning HTTP 404 across GET, POST, POST /detect.
   - Non-ready project statuses returning HTTP 400 on POST /detect.
4. Empirical Demonstration of Empty Chords Clobbering Defect:
   - Clobbering of explicitly cleared chords [] on subsequent GET due to truthy check on cached_chords.
"""

import json
import math
import os
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.main import PROJECTS_LOCK, app, projects, save_projects


def create_synthetic_wav(
    file_path: Path, duration: float = 2.0, sr: int = 22050, freq: float = 440.0
) -> Path:
    """Creates a clean synthetic WAV audio file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * freq * t).astype(np.float32)
    sf.write(str(file_path), sine, sr)
    return file_path


def create_corrupted_wav(file_path: Path, corruption_type: str = "garbage") -> Path:
    """Creates various corrupted audio files for edge-case testing."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    if corruption_type == "garbage":
        file_path.write_bytes(b"INVALID_WAV_GARBAGE_PAYLOAD_!@#$%^&*()1234567890")
    elif corruption_type == "truncated_header":
        file_path.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00")
    elif corruption_type == "broken_data_chunk":
        header = (
            b"RIFF\x24\x00\x00\x01WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
            b"\x22\x56\x00\x00\x44\xac\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x01"
        )
        file_path.write_bytes(header)
    return file_path


@pytest.fixture
def project_with_stem(tmp_path: Path):
    """Sets up a ready project with a synthetic instrumental stem."""
    pid = "adv_iter2_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    inst_file = stems_dir / "instrumental.wav"
    create_synthetic_wav(inst_file, duration=3.0, sr=22050)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "progress": 100,
            "title": "Adversarial Test Track",
            "artist": "Challenger 2",
            "instrumental_path": str(inst_file),
            "vocals_path": str(inst_file),
            "vocal_range": {"estimated_key": "C Major"},
            "chords": None,
        }
        save_projects()
    return pid, inst_file


# ==============================================================================
# 1. INTERVAL VALIDATION FUZZING ON POST /api/project/{id}/chords
# ==============================================================================


class TestIntervalValidationFuzzing:
    """Adversarially fuzzes the interval validation logic on POST /api/project/{id}/chords."""

    @pytest.mark.parametrize(
        ("case_name", "payload"),
        [
            # Inverted intervals (start > end)
            ("inverted_basic", {"chords": [{"start": 2.5, "end": 1.0, "chord": "C"}]}),
            ("inverted_micro", {"chords": [{"start": 1.000001, "end": 1.000000, "chord": "C"}]}),
            (
                "inverted_middle",
                {
                    "chords": [
                        {"start": 0.0, "end": 1.0, "chord": "C"},
                        {"start": 3.0, "end": 2.0, "chord": "G"},
                    ]
                },
            ),
            (
                "inverted_end",
                {
                    "chords": [
                        {"start": 0.0, "end": 1.0, "chord": "C"},
                        {"start": 1.0, "end": 2.0, "chord": "G"},
                        {"start": 4.0, "end": 3.0, "chord": "Am"},
                    ]
                },
            ),
            # Zero-duration intervals (start == end)
            ("zero_dur_0", {"chords": [{"start": 0.0, "end": 0.0, "chord": "C"}]}),
            ("zero_dur_5", {"chords": [{"start": 5.5, "end": 5.5, "chord": "Am"}]}),
            ("zero_dur_1000", {"chords": [{"start": 1000.0, "end": 1000.0, "chord": "F"}]}),
            # Negative start / end timestamps
            ("neg_start_tiny", {"chords": [{"start": -0.0001, "end": 1.0, "chord": "C"}]}),
            ("neg_start_large", {"chords": [{"start": -10.0, "end": 1.0, "chord": "C"}]}),
            ("neg_end", {"chords": [{"start": 0.0, "end": -1.0, "chord": "C"}]}),
            ("neg_both", {"chords": [{"start": -2.0, "end": -1.0, "chord": "C"}]}),
            # Exceeding 24-hour max limit (86400s)
            ("start_exceeds_max", {"chords": [{"start": 86400.1, "end": 86401.0, "chord": "C"}]}),
            ("end_exceeds_max", {"chords": [{"start": 0.0, "end": 86400.1, "chord": "C"}]}),
            # Non-finite float strings
            ("str_nan", {"chords": [{"start": "NaN", "end": 1.0, "chord": "C"}]}),
            ("str_inf", {"chords": [{"start": 0.0, "end": "Infinity", "chord": "C"}]}),
            ("str_neginf", {"chords": [{"start": "-Infinity", "end": 1.0, "chord": "C"}]}),
            (
                "str_nan_conf",
                {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": "NaN"}]},
            ),
            # Confidence score bounds
            (
                "conf_gt_1",
                {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": 1.01}]},
            ),
            (
                "conf_lt_0",
                {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": -0.01}]},
            ),
            # Non-numeric types for timestamps
            ("start_str", {"chords": [{"start": "invalid", "end": 1.0, "chord": "C"}]}),
            ("start_none", {"chords": [{"start": None, "end": 1.0, "chord": "C"}]}),
            ("start_list", {"chords": [{"start": [0.0], "end": 1.0, "chord": "C"}]}),
            ("start_dict", {"chords": [{"start": {"time": 0.0}, "end": 1.0, "chord": "C"}]}),
            ("end_str", {"chords": [{"start": 0.0, "end": "not_number", "chord": "C"}]}),
            ("end_none", {"chords": [{"start": 0.0, "end": None, "chord": "C"}]}),
            ("end_list", {"chords": [{"start": 0.0, "end": [1.0], "chord": "C"}]}),
            ("end_dict", {"chords": [{"start": 0.0, "end": {"v": 1.0}, "chord": "C"}]}),
            # Non-numeric or invalid chord symbols
            ("chord_none", {"chords": [{"start": 0.0, "end": 1.0, "chord": None}]}),
            ("chord_list", {"chords": [{"start": 0.0, "end": 1.0, "chord": ["C"]}]}),
            ("chord_dict", {"chords": [{"start": 0.0, "end": 1.0, "chord": {"sym": "C"}}]}),
            ("chord_int", {"chords": [{"start": 0.0, "end": 1.0, "chord": 12345}]}),
            ("chord_bool", {"chords": [{"start": 0.0, "end": 1.0, "chord": True}]}),
            ("chord_empty", {"chords": [{"start": 0.0, "end": 1.0, "chord": ""}]}),
            ("chord_whitespace", {"chords": [{"start": 0.0, "end": 1.0, "chord": "   \t\n"}]}),
            ("chord_oversized", {"chords": [{"start": 0.0, "end": 1.0, "chord": "C" * 33}]}),
            # Overlapping intervals (start_{i+1} < end_i)
            (
                "overlap_0_1ms",
                {
                    "chords": [
                        {"start": 0.0, "end": 1.0001, "chord": "C"},
                        {"start": 1.0000, "end": 2.0, "chord": "G"},
                    ]
                },
            ),
            (
                "overlap_1us",
                {
                    "chords": [
                        {"start": 0.0, "end": 1.000001, "chord": "C"},
                        {"start": 1.000000, "end": 2.0, "chord": "G"},
                    ]
                },
            ),
            (
                "overlap_identical",
                {
                    "chords": [
                        {"start": 0.0, "end": 1.0, "chord": "C"},
                        {"start": 0.0, "end": 1.0, "chord": "C"},
                    ]
                },
            ),
            (
                "overlap_contained",
                {
                    "chords": [
                        {"start": 0.0, "end": 5.0, "chord": "C"},
                        {"start": 1.0, "end": 2.0, "chord": "G"},
                    ]
                },
            ),
            (
                "overlap_out_of_order",
                {
                    "chords": [
                        {"start": 2.0, "end": 3.0, "chord": "G"},
                        {"start": 0.0, "end": 1.0, "chord": "C"},
                    ]
                },
            ),
            # Missing required fields
            ("missing_start", {"chords": [{"end": 1.0, "chord": "C"}]}),
            ("missing_end", {"chords": [{"start": 0.0, "chord": "C"}]}),
            ("missing_chord", {"chords": [{"start": 0.0, "end": 1.0}]}),
            ("empty_chord_object", {"chords": [{}]}),
            # Top-level body structure violations
            ("chords_not_list", {"chords": "not_a_list"}),
            ("chords_none", {"chords": None}),
            ("chords_int", {"chords": 123}),
        ],
    )
    def test_fuzzed_invalid_inputs_strictly_return_http_422(
        self, client: TestClient, project_with_stem, case_name: str, payload: dict
    ):
        """Verifies that all invalid interval payloads strictly return HTTP 422 with structured detail."""
        pid, _ = project_with_stem
        res = client.post(f"/api/project/{pid}/chords", json=payload)
        assert res.status_code == 422, (
            f"Case '{case_name}' did not return 422 (got {res.status_code}): {res.text}"
        )
        data = res.json()
        assert "detail" in data, f"Case '{case_name}' response missing 'detail' field: {data}"
        assert data["detail"], f"Case '{case_name}' response 'detail' must not be empty"

    @pytest.mark.parametrize(
        ("case_name", "raw_body"),
        [
            ("raw_nan", b'{"chords": [{"start": NaN, "end": 1.0, "chord": "C"}]}'),
            ("raw_inf", b'{"chords": [{"start": 0.0, "end": Infinity, "chord": "C"}]}'),
            ("raw_neginf", b'{"chords": [{"start": -Infinity, "end": 1.0, "chord": "C"}]}'),
            (
                "raw_nan_conf",
                b'{"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": NaN}]}',
            ),
            ("malformed_json_syntax", b'{"chords": [ {"start": 0.0, "end": 1.0, "chord": "C"'),
            ("raw_array_body", b"[]"),
            ("raw_string_body", b'"string_payload"'),
            ("raw_int_body", b"99999"),
            ("raw_null_body", b"null"),
        ],
    )
    def test_raw_content_and_ieee_tokens_strictly_return_http_422(
        self, client: TestClient, project_with_stem, case_name: str, raw_body: bytes
    ):
        """Verifies that unparseable raw JSON, non-object bodies, and literal IEEE tokens return HTTP 422."""
        pid, _ = project_with_stem
        res = client.post(
            f"/api/project/{pid}/chords",
            content=raw_body,
            headers={"Content-Type": "application/json"},
        )
        assert res.status_code == 422, (
            f"Raw case '{case_name}' did not return 422 (got {res.status_code}): {res.text}"
        )
        assert "detail" in res.json()

    def test_boolean_type_coercion_hazard_handled(self, client: TestClient, project_with_stem):
        """Tests boolean inputs in timestamps.

        start=True (1.0), end=False (0.0) is inverted -> 422.
        """
        pid, _ = project_with_stem
        res = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": True, "end": False, "chord": "C"}]},
        )
        assert res.status_code == 422


# ==============================================================================
# 2. CONCURRENCY & PERSISTENCE STRESS TESTING
# ==============================================================================


class TestConcurrencyAndPersistenceStress:
    """Multi-threaded stress testing verifying atomic file swap, zero JSON corruption, and lack of leaks."""

    def test_high_concurrency_multi_project_operations_zero_corruption(
        self, client: TestClient, tmp_path: Path
    ):
        """Tests 120 concurrent operations across 5 projects with simultaneous disk verification."""
        num_projects = 5
        pids = [f"stress_iter2_proj_{i}" for i in range(num_projects)]

        for pid in pids:
            stem_dir = config.STEMS_DIR / pid
            stem_dir.mkdir(parents=True, exist_ok=True)
            stem_path = stem_dir / "instrumental.wav"
            create_synthetic_wav(stem_path, duration=1.5, sr=22050)
            with PROJECTS_LOCK:
                projects[pid] = {
                    "id": pid,
                    "status": "ready",
                    "instrumental_path": str(stem_path),
                    "chords": None,
                }
                save_projects()

        store_file = main_mod.PROJECTS_STORE_FILE
        stop_event = threading.Event()
        disk_read_errors: list[str] = []
        disk_read_count = [0]

        def continuous_disk_reader():
            while not stop_event.is_set():
                try:
                    if store_file.exists():
                        raw = store_file.read_text(encoding="utf-8")
                        if raw.strip():
                            data = json.loads(raw)
                            assert isinstance(data, dict)
                            disk_read_count[0] += 1
                except Exception as e:
                    disk_read_errors.append(f"{type(e).__name__}: {e}")
                time.sleep(0.0005)

        reader_thread = threading.Thread(target=continuous_disk_reader, daemon=True)
        reader_thread.start()

        def worker_task(idx: int):
            pid = pids[idx % num_projects]
            op = idx % 3
            if op == 0:
                s = (idx % 25) - 12
                r = client.get(f"/api/project/{pid}/chords?semitones={s}")
                return ("GET", pid, r.status_code, r.text)
            elif op == 1:
                chord_name = ["C", "Dm", "Em", "F", "G", "Am"][idx % 6]
                payload = {
                    "chords": [
                        {"start": 0.0, "end": 0.5, "chord": chord_name},
                        {"start": 0.5, "end": 1.0, "chord": "G7"},
                    ]
                }
                r = client.post(f"/api/project/{pid}/chords", json=payload)
                return ("POST", pid, r.status_code, r.text)
            else:
                r = client.post(f"/api/project/{pid}/chords/detect")
                return ("DETECT", pid, r.status_code, r.text)

        total_ops = 120
        workers = 16
        results = []
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(worker_task, i) for i in range(total_ops)]
            for f in as_completed(futures):
                results.append(f.result())

        stop_event.set()
        reader_thread.join(timeout=3.0)

        # 1. Verify all concurrent operations succeeded with HTTP 200
        for op, pid, status, text in results:
            assert status == 200, f"Operation {op} on {pid} failed with status {status}: {text}"

        # 2. Verify disk reader had zero corruption / parse failures
        assert len(disk_read_errors) == 0, f"Detected JSON corruption: {disk_read_errors[:5]}"
        assert disk_read_count[0] > 20, f"Disk reader only executed {disk_read_count[0]} times"

        # 3. Verify final state of all projects
        final_data = json.loads(store_file.read_text(encoding="utf-8"))
        for pid in pids:
            assert pid in final_data, f"Project {pid} missing from final projects.json"
            assert final_data[pid].get("chords") is not None, f"Project {pid} lost chords!"

        # 4. Verify no leaked temporary store files in DATA_DIR
        data_dir = config.DATA_DIR
        leaked_tmps = list(data_dir.glob(".projects.json.tmp.*"))
        assert len(leaked_tmps) == 0, f"Found leaked temporary store files: {leaked_tmps}"


# ==============================================================================
# 3. AUTO-BACKFILL & STEM EDGE CASES
# ==============================================================================


class TestAutoBackfillAndStemEdgeCases:
    """Stress tests missing, zero-byte, corrupted stems, and edge-case project states."""

    def test_missing_and_empty_stem_handling(self, client: TestClient, tmp_path: Path):
        """Tests that missing, 0-byte, directory, or non-existent stems strictly return HTTP 400."""
        # 1. Null stems
        pid_null = "stem_null_proj"
        with PROJECTS_LOCK:
            projects[pid_null] = {
                "id": pid_null,
                "status": "ready",
                "instrumental_path": None,
                "audio_path": None,
                "chords": None,
            }
            save_projects()

        res_get = client.get(f"/api/project/{pid_null}/chords")
        assert res_get.status_code == 400
        assert "stem missing or not ready" in res_get.json()["detail"].lower()

        res_detect = client.post(f"/api/project/{pid_null}/chords/detect")
        assert res_detect.status_code == 400
        assert "stem missing or not ready" in res_detect.json()["detail"].lower()

        # 2. 0-byte stem
        pid_zero = "stem_zero_proj"
        zero_file = tmp_path / "zero.wav"
        zero_file.touch()
        with PROJECTS_LOCK:
            projects[pid_zero] = {
                "id": pid_zero,
                "status": "ready",
                "instrumental_path": str(zero_file),
                "chords": None,
            }
            save_projects()

        assert client.get(f"/api/project/{pid_zero}/chords").status_code == 400
        assert client.post(f"/api/project/{pid_zero}/chords/detect").status_code == 400

        # 3. Nonexistent file path
        pid_nonexist = "stem_nonexist_proj"
        with PROJECTS_LOCK:
            projects[pid_nonexist] = {
                "id": pid_nonexist,
                "status": "ready",
                "instrumental_path": "/nonexistent/stem/path.wav",
                "chords": None,
            }
            save_projects()

        assert client.get(f"/api/project/{pid_nonexist}/chords").status_code == 400
        assert client.post(f"/api/project/{pid_nonexist}/chords/detect").status_code == 400

        # 4. Path is a directory
        pid_dir = "stem_dir_proj"
        with PROJECTS_LOCK:
            projects[pid_dir] = {
                "id": pid_dir,
                "status": "ready",
                "instrumental_path": str(config.DATA_DIR),
                "chords": None,
            }
            save_projects()

        assert client.get(f"/api/project/{pid_dir}/chords").status_code == 400
        assert client.post(f"/api/project/{pid_dir}/chords/detect").status_code == 400

    def test_audio_path_fallback_when_instrumental_missing(
        self, client: TestClient, tmp_path: Path
    ):
        """Tests that auto-backfill successfully falls back to audio_path if instrumental_path is absent."""
        pid = "fallback_proj"
        audio_file = tmp_path / "source_audio.wav"
        create_synthetic_wav(audio_file, duration=2.0)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": None,
                "audio_path": str(audio_file),
                "chords": None,
            }
            save_projects()

        res = client.get(f"/api/project/{pid}/chords")
        assert res.status_code == 200
        assert len(res.json()["chords"]) > 0

    def test_corrupted_stem_returns_clean_500_without_process_crash(
        self, client: TestClient, tmp_path: Path
    ):
        """Tests that a corrupted audio stem returns HTTP 500 cleanly without crashing the server."""
        pid = "corrupted_stem_proj"
        corrupt_file = tmp_path / "corrupt.wav"
        create_corrupted_wav(corrupt_file, "garbage")

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(corrupt_file),
                "chords": None,
            }
            save_projects()

        res_get = client.get(f"/api/project/{pid}/chords")
        assert res_get.status_code == 500
        assert "Failed to detect chords" in res_get.json()["detail"]

        res_detect = client.post(f"/api/project/{pid}/chords/detect")
        assert res_detect.status_code == 500
        assert "Failed to detect chords" in res_detect.json()["detail"]

    def test_nonexistent_project_returns_strictly_404(self, client: TestClient):
        """Tests that nonexistent project IDs return HTTP 404 across all endpoints."""
        assert client.get("/api/project/missing_id/chords").status_code == 404
        assert client.post("/api/project/missing_id/chords", json={"chords": []}).status_code == 404
        assert client.post("/api/project/missing_id/chords/detect").status_code == 404

    @pytest.mark.parametrize("status", ["processing", "queued", "downloading", "separating"])
    def test_in_progress_project_status_rejects_detect_with_400(
        self, client: TestClient, tmp_path: Path, status: str
    ):
        """Tests that POST /detect rejects with HTTP 400 when project is still processing."""
        pid = f"status_{status}_proj"
        stem = tmp_path / "stem.wav"
        create_synthetic_wav(stem, duration=1.0)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": status,
                "instrumental_path": str(stem),
                "chords": None,
            }
            save_projects()

        res = client.post(f"/api/project/{pid}/chords/detect")
        assert res.status_code == 400
        assert "project processing is not complete" in res.json()["detail"]


# ==============================================================================
# 4. EMPIRICAL DEMONSTRATION OF EMPTY CHORDS CLOBBERING DEFECT
# ==============================================================================


class TestEmptyChordsPersistenceDefect:
    """Empirically reproduces the defect where an explicitly saved empty chord progression

    is clobbered by GET /api/project/{id}/chords due to a truthy check on cached_chords.
    """

    def test_reproduce_empty_chords_persistence_clobbered_by_get(
        self, client: TestClient, project_with_stem
    ):
        """User saves [] -> GET must return [] and NOT trigger auto-backfill over user edit."""
        pid, _ = project_with_stem

        # 1. User explicitly saves an empty chord list (clearing all chords)
        res_post = client.post(f"/api/project/{pid}/chords", json={"chords": []})
        assert res_post.status_code == 200
        assert res_post.json()["chords_count"] == 0
        assert projects[pid]["chords"] == []

        # 2. User or frontend fetches the chords
        res_get = client.get(f"/api/project/{pid}/chords")
        assert res_get.status_code == 200

        # EXPECTED: Chords should remain empty [] as persisted by the user.
        # ACTUAL (DEFECT): cached_chords evaluates to False, auto-backfill runs on instrumental stem,
        # and overwrites projects[pid]["chords"] with newly detected chord segments.
        assert res_get.json()["chords"] == [], (
            f"Expected empty chords list [], but GET returned {len(res_get.json()['chords'])} chords "
            f"and clobbered user store: {res_get.json()['chords']}"
        )
