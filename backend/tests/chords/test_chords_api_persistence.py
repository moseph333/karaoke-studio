"""Empirical Adversarial Stress Test Suite for Milestone 1.

Author: Challenger 2 (API & Persistence Adversarial Verifier)
Scope:
1. Interval validation fuzzing: sub-millisecond overlaps, inverted timestamps,
   non-finite floats, huge payloads, out-of-order intervals. Verify HTTP 422 strictly.
2. Concurrency stress testing: multi-threaded concurrent requests to GET, POST,
   and POST /detect to verify atomic temp file swap and zero JSON corruption.
3. Auto-backfill edge cases: missing stem, 0-byte stem, corrupted WAV stem.
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
from backend.main import PROJECTS_LOCK, projects, save_projects
from backend.services.chord_detector import ChordDetector


def create_synthetic_wav(
    file_path: Path, duration: float = 2.0, sr: int = 22050, freq: float = 440.0
) -> Path:
    """Creates a clean synthetic WAV file with a given duration and frequency."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.5 * np.sin(2 * np.pi * freq * t).astype(np.float32)
    sf.write(str(file_path), sine, sr)
    return file_path


def create_corrupted_wav(file_path: Path, corruption_type: str = "garbage") -> Path:
    """Creates various forms of corrupted audio files."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    if corruption_type == "garbage":
        file_path.write_bytes(b"NOT_A_WAV_FILE_GARBAGE_PAYLOAD_1234567890!@#$%^&*()")
    elif corruption_type == "truncated_header":
        # Truncated RIFF header
        file_path.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00")
    elif corruption_type == "broken_data_chunk":
        # Valid header claiming 10MB of data, but truncated to 44 bytes
        header = (
            b"RIFF\x24\x00\x00\x01WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00"
            b"\x22\x56\x00\x00\x44\xac\x00\x00\x02\x00\x10\x00data\x00\x00\x00\x01"
        )
        file_path.write_bytes(header)
    return file_path


@pytest.fixture
def base_project_with_stem(tmp_path: Path):
    """Sets up a ready project with a real synthetic instrumental stem."""
    pid = "adv_test_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    inst_file = stems_dir / "instrumental.wav"
    create_synthetic_wav(inst_file, duration=4.0, sr=22050)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "progress": 100,
            "title": "Adversarial Song",
            "artist": "Empirical Verifier",
            "instrumental_path": str(inst_file),
            "vocals_path": str(inst_file),
            "vocal_range": {"estimated_key": "C Major"},
            "chords": None,
        }
        save_projects()
    return pid, inst_file


# ==============================================================================
# 1. INTERVAL VALIDATION FUZZING
# ==============================================================================


class TestIntervalValidationFuzzing:
    """Stress tests interval monotonicity, boundary conditions, and fuzzing payloads."""

    def test_submillisecond_overlaps_strictly_422(self, client: TestClient, base_project_with_stem):
        pid, _ = base_project_with_stem

        # 1. 0.1ms overlap
        payload_0_1ms = {
            "chords": [
                {"start": 0.0, "end": 1.0001, "chord": "C"},
                {"start": 1.0000, "end": 2.0, "chord": "G"},
            ]
        }
        res = client.post(f"/api/project/{pid}/chords", json=payload_0_1ms)
        assert res.status_code == 422, f"Expected 422 for 0.1ms overlap, got {res.status_code}"
        assert "Overlapping or non-monotonic" in str(res.json()["detail"])

        # 2. Microsecond overlap (1e-6)
        payload_1us = {
            "chords": [
                {"start": 0.0, "end": 1.000001, "chord": "C"},
                {"start": 1.000000, "end": 2.0, "chord": "Am"},
            ]
        }
        res = client.post(f"/api/project/{pid}/chords", json=payload_1us)
        assert res.status_code == 422, f"Expected 422 for 1us overlap, got {res.status_code}"

        # 3. Floating point precision boundary overlap: 0.1 + 0.2 = 0.30000000000000004
        val_a = 0.1 + 0.2
        val_b = 0.3
        assert val_a > val_b  # Standard IEEE 754 precision anomaly
        payload_fp = {
            "chords": [
                {"start": 0.0, "end": val_a, "chord": "C"},
                {"start": val_b, "end": 1.0, "chord": "F"},
            ]
        }
        res = client.post(f"/api/project/{pid}/chords", json=payload_fp)
        assert res.status_code == 422

    def test_touching_and_gap_intervals_accepted_200(
        self, client: TestClient, base_project_with_stem
    ):
        pid, _ = base_project_with_stem

        # Touching intervals (end_i == start_{i+1}) must be valid 200
        payload_touching = {
            "chords": [
                {"start": 0.0, "end": 1.55555, "chord": "C"},
                {"start": 1.55555, "end": 3.0, "chord": "Am"},
                {"start": 3.0, "end": 4.5, "chord": "F"},
            ]
        }
        res = client.post(f"/api/project/{pid}/chords", json=payload_touching)
        assert res.status_code == 200
        assert res.json()["chords_count"] == 3

        # Gaps between intervals (end_i < start_{i+1}) must be valid 200
        payload_gaps = {
            "chords": [
                {"start": 0.0, "end": 1.0, "chord": "C"},
                {"start": 5.0, "end": 6.0, "chord": "G"},
            ]
        }
        res = client.post(f"/api/project/{pid}/chords", json=payload_gaps)
        assert res.status_code == 200

    def test_inverted_and_zero_duration_timestamps_strictly_422(
        self, client: TestClient, base_project_with_stem
    ):
        pid, _ = base_project_with_stem

        inverted_cases = [
            # Inverted interval (start > end)
            [{"start": 2.5, "end": 1.0, "chord": "C"}],
            # Microsecond inverted
            [{"start": 1.000001, "end": 1.000000, "chord": "C"}],
            # Zero duration (start == end)
            [{"start": 0.0, "end": 0.0, "chord": "C"}],
            [{"start": 4.5, "end": 4.5, "chord": "Am"}],
            # Negative start
            [{"start": -0.0001, "end": 1.0, "chord": "C"}],
            [{"start": -1.0, "end": 2.0, "chord": "C"}],
            # Negative end
            [{"start": 0.0, "end": -0.5, "chord": "C"}],
            # Beyond 24 hour limit (86400.0)
            [{"start": 86400.1, "end": 86401.0, "chord": "C"}],
            [{"start": 0.0, "end": 86400.1, "chord": "C"}],
            # Inversion at end of multi-chord list
            [
                {"start": 0.0, "end": 1.0, "chord": "C"},
                {"start": 1.0, "end": 2.0, "chord": "G"},
                {"start": 3.0, "end": 2.5, "chord": "Am"},
            ],
        ]

        for idx, chords in enumerate(inverted_cases):
            res = client.post(f"/api/project/{pid}/chords", json={"chords": chords})
            assert res.status_code == 422, (
                f"Case {idx} ({chords}) did not return 422, got {res.status_code}"
            )

    def test_non_finite_floats_and_tokens_strictly_422(
        self, client: TestClient, base_project_with_stem
    ):
        pid, _ = base_project_with_stem

        # String representations of non-finites
        string_cases = [
            {"chords": [{"start": "NaN", "end": 2.0, "chord": "C"}]},
            {"chords": [{"start": 0.0, "end": "Infinity", "chord": "C"}]},
            {"chords": [{"start": 0.0, "end": "-Infinity", "chord": "C"}]},
            {"chords": [{"start": 0.0, "end": 2.0, "chord": "C", "confidence": "NaN"}]},
            {"chords": [{"start": 0.0, "end": 2.0, "chord": "C", "confidence": "Infinity"}]},
            {"chords": [{"start": 0.0, "end": 2.0, "chord": "C", "confidence": 1.01}]},
            {"chords": [{"start": 0.0, "end": 2.0, "chord": "C", "confidence": -0.01}]},
        ]
        for idx, payload in enumerate(string_cases):
            res = client.post(f"/api/project/{pid}/chords", json=payload)
            assert res.status_code == 422, (
                f"Case {idx} ({payload}) did not return 422, got {res.status_code}"
            )

        # Raw literal non-finite IEEE tokens in JSON
        raw_token_cases = [
            b'{"chords": [{"start": NaN, "end": 2.0, "chord": "C"}]}',
            b'{"chords": [{"start": 0.0, "end": Infinity, "chord": "C"}]}',
            b'{"chords": [{"start": 0.0, "end": -Infinity, "chord": "C"}]}',
            b'{"chords": [{"start": 0.0, "end": 2.0, "chord": "C", "confidence": NaN}]}',
        ]
        for idx, raw_bytes in enumerate(raw_token_cases):
            res = client.post(
                f"/api/project/{pid}/chords",
                content=raw_bytes,
                headers={"Content-Type": "application/json"},
            )
            assert res.status_code == 422, (
                f"Raw token case {idx} did not return 422, got {res.status_code}"
            )

        # Semitones query param non-finites on GET
        semitones_cases = ["NaN", "Infinity", "-Infinity", "13", "-13", "1.5", "abc"]
        for s in semitones_cases:
            res = client.get(f"/api/project/{pid}/chords?semitones={s}")
            assert res.status_code == 422, (
                f"GET semitones={s} did not return 422, got {res.status_code}"
            )

    def test_out_of_order_intervals_strictly_422(self, client: TestClient, base_project_with_stem):
        pid, _ = base_project_with_stem

        # Shuffled list of non-overlapping intervals
        intervals = [
            {"start": float(i * 2), "end": float(i * 2 + 1), "chord": f"C{i}"} for i in range(10)
        ]
        shuffled = list(intervals)
        random.seed(42)
        random.shuffle(shuffled)
        assert shuffled != intervals

        res = client.post(f"/api/project/{pid}/chords", json={"chords": shuffled})
        assert res.status_code == 422, (
            f"Shuffled intervals did not return 422, got {res.status_code}"
        )

        # Duplicate identical intervals
        duplicate_payload = {
            "chords": [
                {"start": 1.0, "end": 2.0, "chord": "C"},
                {"start": 1.0, "end": 2.0, "chord": "C"},
            ]
        }
        res_dup = client.post(f"/api/project/{pid}/chords", json=duplicate_payload)
        assert res_dup.status_code == 422

    def test_chord_symbol_fuzzing_and_payload_boundaries(
        self, client: TestClient, base_project_with_stem
    ):
        pid, _ = base_project_with_stem

        # 1. Empty / whitespace chord strings -> 422
        bad_symbols = ["", "   ", "\t", "\n\r", None]
        for sym in bad_symbols:
            res = client.post(
                f"/api/project/{pid}/chords",
                json={"chords": [{"start": 0.0, "end": 1.0, "chord": sym}]},
            )
            assert res.status_code == 422, f"Symbol '{sym}' did not return 422"

        # 2. Oversized chord strings -> 422 (max_length=32)
        res_33 = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 0.0, "end": 1.0, "chord": "C" * 33}]},
        )
        assert res_33.status_code == 422

        res_1000 = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 0.0, "end": 1.0, "chord": "A" * 1000}]},
        )
        assert res_1000.status_code == 422

        # 3. Unicode and special characters that are valid chords or strings
        valid_chords = [
            {"start": 0.0, "end": 1.0, "chord": "C#m7"},
            {"start": 1.0, "end": 2.0, "chord": "Bbmaj7"},
            {"start": 2.0, "end": 3.0, "chord": "C/G"},
            {"start": 3.0, "end": 4.0, "chord": "N"},
        ]
        res_valid = client.post(f"/api/project/{pid}/chords", json={"chords": valid_chords})
        assert res_valid.status_code == 200
        assert res_valid.json()["chords_count"] == 4

        # 4. Injection strings (HTML, Script, SQL) within length 32
        # Must be treated as string values safely without 500
        injection_chords = [
            {"start": 0.0, "end": 1.0, "chord": "<script>alert(1)</script>"},
            {"start": 1.0, "end": 2.0, "chord": "' OR 1=1; --"},
        ]
        res_inj = client.post(f"/api/project/{pid}/chords", json={"chords": injection_chords})
        assert res_inj.status_code in (200, 422)  # Either accepted as string or 422, NEVER 500

    def test_huge_monotonic_payload_performance(self, client: TestClient, base_project_with_stem):
        pid, _ = base_project_with_stem

        # 2,000 valid monotonic intervals
        huge_chords = [
            {"start": float(i * 2), "end": float(i * 2 + 1), "chord": "C", "confidence": 0.9}
            for i in range(2000)
        ]
        t0 = time.time()
        res = client.post(f"/api/project/{pid}/chords", json={"chords": huge_chords})
        elapsed = time.time() - t0

        assert res.status_code == 200
        assert res.json()["chords_count"] == 2000
        assert elapsed < 3.0, f"2,000 interval validation took too long: {elapsed:.2f}s"

        # Verify retrieval of huge payload
        res_get = client.get(f"/api/project/{pid}/chords")
        assert res_get.status_code == 200
        assert len(res_get.json()["chords"]) == 2000

        # Huge payload where the 1,999th interval is overlapping
        huge_chords[-1]["start"] = huge_chords[-2]["end"] - 0.1
        res_err = client.post(f"/api/project/{pid}/chords", json={"chords": huge_chords})
        assert res_err.status_code == 422


# ==============================================================================
# 2. CONCURRENCY STRESS TESTING & ATOMIC TEMP FILE SWAP
# ==============================================================================


class TestConcurrencyAndAtomicPersistence:
    """Multi-threaded stress testing verifying atomic temp file swap and zero corruption."""

    def test_multithreaded_concurrent_requests_zero_json_corruption(
        self, client: TestClient, base_project_with_stem
    ):
        pid, _ = base_project_with_stem

        # Populate initial chords
        initial_chords = [
            {"start": 0.0, "end": 1.0, "chord": "C"},
            {"start": 1.0, "end": 2.0, "chord": "G"},
        ]
        client.post(f"/api/project/{pid}/chords", json={"chords": initial_chords})

        store_file = main_mod.PROJECTS_STORE_FILE
        assert store_file.exists()

        stop_event = threading.Event()
        read_errors: list[str] = []
        read_count = [0]

        # Dedicated background disk-reader thread: continuously reads projects.json
        # and parses with json.loads to catch any partial writes or corruption
        def disk_reader():
            while not stop_event.is_set():
                try:
                    if store_file.exists():
                        raw = store_file.read_text(encoding="utf-8")
                        if raw.strip():
                            parsed = json.loads(raw)
                            assert isinstance(parsed, dict)
                            read_count[0] += 1
                except Exception as e:
                    read_errors.append(f"Disk read corruption: {type(e).__name__}: {e}")
                time.sleep(0.001)

        reader_thread = threading.Thread(target=disk_reader, daemon=True)
        reader_thread.start()

        # Concurrent request workers
        def make_get(semitones: int = 0):
            r = client.get(f"/api/project/{pid}/chords?semitones={semitones}")
            return ("GET", r.status_code, r)

        def make_post(variant: int):
            c_name = "C" if variant % 2 == 0 else "Am"
            payload = {
                "chords": [
                    {"start": 0.0, "end": 1.0, "chord": c_name},
                    {"start": 1.0, "end": 2.0, "chord": "G7"},
                ]
            }
            r = client.post(f"/api/project/{pid}/chords", json=payload)
            return ("POST", r.status_code, r)

        def make_detect():
            r = client.post(f"/api/project/{pid}/chords/detect")
            return ("DETECT", r.status_code, r)

        # Generate a batch of 80 mixed operations across 16 threads
        operations = []
        for i in range(30):
            operations.append(lambda s=i % 12 - 6: make_get(s))
        for i in range(30):
            operations.append(lambda v=i: make_post(v))
        for _ in range(20):
            operations.append(make_detect)

        random.seed(123)
        random.shuffle(operations)

        results = []
        with ThreadPoolExecutor(max_workers=16) as executor:
            futures = [executor.submit(op) for op in operations]
            for f in as_completed(futures):
                results.append(f.result())

        stop_event.set()
        reader_thread.join(timeout=2.0)

        # Verify all concurrent requests succeeded
        for op_type, status, resp in results:
            assert status == 200, f"Operation {op_type} failed with status {status}: {resp.text}"

        # Verify disk reader had zero corruption events
        assert len(read_errors) == 0, f"Detected JSON corruption during reads: {read_errors[:5]}"
        assert read_count[0] > 10, f"Disk reader only executed {read_count[0]} times"

        # Verify final projects.json state
        final_raw = store_file.read_text(encoding="utf-8")
        final_projects = json.loads(final_raw)
        assert pid in final_projects
        assert final_projects[pid].get("chords") is not None

        # Verify no orphaned temporary files in DATA_DIR
        data_dir = config.DATA_DIR
        tmp_files = list(data_dir.glob(".projects.json.tmp.*"))
        assert len(tmp_files) == 0, f"Found leaked temporary store files: {tmp_files}"

    def test_concurrent_get_backfill_and_post_update_race(
        self, client: TestClient, base_project_with_stem, monkeypatch
    ):
        """Tests race behavior when a slow auto-backfill GET coincides with a user POST."""
        pid, _ = base_project_with_stem

        # Ensure project has no chords initially
        with PROJECTS_LOCK:
            projects[pid]["chords"] = None
            save_projects()

        original_detect = main_mod.chord_detector.detect_chords

        # Add artificial delay to detection to widen the race window
        def slow_detect(*args, **kwargs):
            time.sleep(0.15)
            return original_detect(*args, **kwargs)

        monkeypatch.setattr(main_mod.chord_detector, "detect_chords", slow_detect)

        user_custom_chords = [
            {"start": 0.0, "end": 1.0, "chord": "Dm7"},
            {"start": 1.0, "end": 2.5, "chord": "G7"},
        ]

        def run_get():
            return client.get(f"/api/project/{pid}/chords")

        def run_post():
            time.sleep(0.05)  # Let GET start first
            return client.post(f"/api/project/{pid}/chords", json={"chords": user_custom_chords})

        with ThreadPoolExecutor(max_workers=2) as executor:
            fut_get = executor.submit(run_get)
            fut_post = executor.submit(run_post)
            res_get = fut_get.result()
            res_post = fut_post.result()

        assert res_get.status_code == 200
        assert res_post.status_code == 200

        # Check final stored chords
        final_chords = projects[pid].get("chords")
        assert final_chords is not None


# ==============================================================================
# 3. AUTO-BACKFILL EDGE CASES
# ==============================================================================


class TestAutoBackfillEdgeCases:
    """Stress tests missing, 0-byte, corrupted, and truncated stem files."""

    def test_missing_instrumental_stem_returns_clean_400(self, client: TestClient):
        pid = "missing_stem_proj"
        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": None,
                "audio_path": None,
                "chords": None,
            }
            save_projects()

        # 1. GET auto-backfill on missing stem -> 400
        res_get = client.get(f"/api/project/{pid}/chords")
        assert res_get.status_code == 400
        assert "stem missing or not ready" in res_get.json()["detail"].lower()

        # 2. POST /detect on missing stem -> 400
        res_detect = client.post(f"/api/project/{pid}/chords/detect")
        assert res_detect.status_code == 400
        assert "stem missing or not ready" in res_detect.json()["detail"].lower()

        # 3. Nonexistent file path -> 400
        with PROJECTS_LOCK:
            projects[pid]["instrumental_path"] = "/nonexistent/path/to/stem.wav"
            save_projects()
        res_nonexist = client.get(f"/api/project/{pid}/chords")
        assert res_nonexist.status_code == 400

        # 4. Path is a directory instead of a file -> 400
        with PROJECTS_LOCK:
            projects[pid]["instrumental_path"] = str(config.DATA_DIR)
            save_projects()
        res_dir = client.get(f"/api/project/{pid}/chords")
        assert res_dir.status_code == 400

    def test_zero_byte_stem_returns_clean_400(self, client: TestClient, tmp_path: Path):
        pid = "zero_byte_proj"
        zero_file = tmp_path / "zero.wav"
        zero_file.touch()
        assert zero_file.stat().st_size == 0

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(zero_file),
                "audio_path": None,
                "chords": None,
            }
            save_projects()

        # GET auto-backfill on 0-byte stem -> 400
        res_get = client.get(f"/api/project/{pid}/chords")
        assert res_get.status_code == 400
        assert "stem missing or not ready" in res_get.json()["detail"].lower()

        # POST /detect on 0-byte stem -> 400
        res_detect = client.post(f"/api/project/{pid}/chords/detect")
        assert res_detect.status_code == 400
        assert "stem missing or not ready" in res_detect.json()["detail"].lower()

    def test_corrupted_wav_stem_handled_cleanly_without_process_crash(
        self, client: TestClient, tmp_path: Path
    ):
        """Tests that a corrupted audio stem (>0 bytes, invalid format) returns 500 cleanly."""
        pid = "corrupt_proj"
        corrupt_file = tmp_path / "corrupt.wav"
        create_corrupted_wav(corrupt_file, "garbage")

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(corrupt_file),
                "audio_path": None,
                "chords": None,
            }
            save_projects()

        # 1. GET auto-backfill on corrupted WAV:
        # Expected: Endpoint catches audio read exception, logs error, and returns clean 500
        res_get = client.get(f"/api/project/{pid}/chords")
        assert res_get.status_code == 500
        assert "Failed to detect chords" in res_get.json()["detail"]

        # 2. POST /detect on corrupted WAV:
        res_detect = client.post(f"/api/project/{pid}/chords/detect")
        assert res_detect.status_code == 500
        assert "Failed to detect chords" in res_detect.json()["detail"]

        # 3. Process is healthy: server can still handle other valid requests
        valid_pid = "valid_after_corrupt"
        stems_dir = config.STEMS_DIR / valid_pid
        stems_dir.mkdir(parents=True, exist_ok=True)
        valid_wav = stems_dir / "instrumental.wav"
        create_synthetic_wav(valid_wav, duration=2.0)

        with PROJECTS_LOCK:
            projects[valid_pid] = {
                "id": valid_pid,
                "status": "ready",
                "instrumental_path": str(valid_wav),
                "chords": None,
            }
            save_projects()

        res_valid = client.get(f"/api/project/{valid_pid}/chords")
        assert res_valid.status_code == 200
        assert len(res_valid.json()["chords"]) > 0

    def test_truncated_wav_stem_handled_cleanly(self, client: TestClient, tmp_path: Path):
        pid = "trunc_proj"
        trunc_file = tmp_path / "truncated.wav"
        create_corrupted_wav(trunc_file, "broken_data_chunk")

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(trunc_file),
                "chords": None,
            }
            save_projects()

        res = client.get(f"/api/project/{pid}/chords")
        # Either 500 (read error) or 200 (if soundfile partially recovered), but NEVER crash
        assert res.status_code in (200, 500)

    def test_audio_samples_with_nan_and_inf_scrubbed_cleanly(self):
        """Tests that ChordDetector handles audio buffers containing NaN/Inf samples gracefully."""
        detector = ChordDetector()
        sr = 22050
        duration = 2.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        audio = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)

        # Inject NaNs, +Infs, and -Infs
        audio[100:150] = np.nan
        audio[200:250] = np.inf
        audio[300:350] = -np.inf

        # Must not crash or return NaN/Inf timestamps/confidences
        segments = detector.detect_chords(audio, sr=sr)
        assert isinstance(segments, list)
        for seg in segments:
            assert math.isfinite(seg["start"])
            assert math.isfinite(seg["end"])
            if seg.get("confidence") is not None:
                assert math.isfinite(seg["confidence"])
                assert 0.0 <= seg["confidence"] <= 1.0
