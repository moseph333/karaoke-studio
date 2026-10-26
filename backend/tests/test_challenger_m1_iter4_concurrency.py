"""Milestone 1 Iteration 4: Concurrency & Check-Then-Act Race Challenger Suite.

Adversarial stress harness targeting:
1. High-concurrency race stress: multiple threads requesting GET /api/project/{id}/chords
   while other threads execute POST /api/project/{id}/chords with custom chords or empty chords.
2. Barrier-synchronized simultaneous release of GET and POST operations.
3. Rapid succession of POST updates (custom -> empty -> custom) during delayed STFT backfill.
4. Transposition parameter interaction during concurrent backfill and POST.
5. Disk persistence integrity and zero file corruption under continuous JSON validation.
6. Project deletion race during in-flight backfill.
"""

from __future__ import annotations

import json
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
from backend.schemas import ChordsUpdateRequest
from backend.services.chord_detector import ChordDetector, transpose_chord_progression


def create_test_wav(file_path: Path, signal: np.ndarray, sr: int = 22050) -> Path:
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), signal, sr)
    return file_path


def generate_harmonic_sine(
    duration: float = 1.0, freq: float = 440.0, sr: int = 22050
) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    # Fundamental + harmonic
    signal = 0.4 * np.sin(2 * np.pi * freq * t) + 0.2 * np.sin(2 * np.pi * (freq * 1.5) * t)
    return signal.astype(np.float32)


class TestConcurrencyCheckThenActRaces:
    """Adversarial stress test harness for check-then-act race conditions."""

    def test_barrier_synchronized_concurrent_get_and_post_races(
        self, client: TestClient, tmp_path: Path
    ):
        """20 threads (10 GET, 5 POST custom, 5 POST empty) released simultaneously via Barrier.

        Verifies that:
        - 0 unhandled exceptions.
        - Once a POST commits, no late-arriving GET clobbers it with auto-detected chords.
        - Final saved state in projects.json matches one of the user-submitted POSTs.
        """
        pid = "m1_iter4_barrier_race"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        create_test_wav(stem_path, generate_harmonic_sine(1.5, 440.0), sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        num_get_threads = 10
        num_post_custom_threads = 5
        num_post_empty_threads = 5
        total_threads = num_get_threads + num_post_custom_threads + num_post_empty_threads

        barrier = threading.Barrier(total_threads)
        results: list[dict[str, Any]] = []
        results_lock = threading.Lock()

        # Custom chord payloads with unique markers
        custom_payloads = [
            [{"start": 0.0, "end": 0.5, "chord": "C"}, {"start": 0.5, "end": 1.0, "chord": "G"}],
            [{"start": 0.0, "end": 0.7, "chord": "Dm"}, {"start": 0.7, "end": 1.4, "chord": "A7"}],
            [{"start": 0.0, "end": 0.4, "chord": "F"}, {"start": 0.4, "end": 1.2, "chord": "Bb"}],
            [{"start": 0.0, "end": 0.6, "chord": "Am"}, {"start": 0.6, "end": 1.3, "chord": "E7"}],
            [{"start": 0.0, "end": 0.5, "chord": "Em"}, {"start": 0.5, "end": 1.5, "chord": "B7"}],
        ]

        # Artificially add small jitter in detect_chords to broaden the collision window
        detector = getattr(main_mod, "chord_detector", None)
        assert detector is not None
        orig_detect = detector.detect_chords

        def jittery_detect(*args, **kwargs):
            time.sleep(random.uniform(0.02, 0.08))
            return orig_detect(*args, **kwargs)

        detector.detect_chords = jittery_detect

        def worker_get(idx: int):
            barrier.wait()
            resp = client.get(f"/api/project/{pid}/chords")
            with results_lock:
                results.append(
                    {"type": "GET", "idx": idx, "status": resp.status_code, "data": resp.json()}
                )

        def worker_post_custom(idx: int, payload: list[dict]):
            barrier.wait()
            time.sleep(random.uniform(0.01, 0.05))
            resp = client.post(f"/api/project/{pid}/chords", json={"chords": payload})
            with results_lock:
                results.append(
                    {
                        "type": "POST_CUSTOM",
                        "idx": idx,
                        "status": resp.status_code,
                        "data": resp.json(),
                    }
                )

        def worker_post_empty(idx: int):
            barrier.wait()
            time.sleep(random.uniform(0.01, 0.05))
            resp = client.post(f"/api/project/{pid}/chords", json={"chords": []})
            with results_lock:
                results.append(
                    {
                        "type": "POST_EMPTY",
                        "idx": idx,
                        "status": resp.status_code,
                        "data": resp.json(),
                    }
                )

        threads: list[threading.Thread] = []
        for i in range(num_get_threads):
            threads.append(threading.Thread(target=worker_get, args=(i,)))
        for i in range(num_post_custom_threads):
            threads.append(
                threading.Thread(target=worker_post_custom, args=(i, custom_payloads[i]))
            )
        for i in range(num_post_empty_threads):
            threads.append(threading.Thread(target=worker_post_empty, args=(i,)))

        try:
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=10.0)
                assert not t.is_alive(), "Worker thread hung during concurrency test"
        finally:
            detector.detect_chords = orig_detect

        assert len(results) == total_threads
        for r in results:
            assert r["status"] == 200, f"Thread {r} failed with non-200 status"

        with PROJECTS_LOCK:
            final_saved_chords = projects[pid]["chords"]

        # Final saved chords must NOT be None
        assert final_saved_chords is not None

        # Verify that final saved chords match one of the POST operations (or empty),
        # and NEVER the raw auto-detected chords from before the POSTs
        # Build set of all valid POST outcomes
        valid_post_serialized = [[]]
        for p in custom_payloads:
            valid_post_serialized.append(
                [
                    {
                        "start": float(c["start"]),
                        "end": float(c["end"]),
                        "chord": c["chord"],
                        "id": None,
                        "confidence": None,
                    }
                    for c in p
                ]
            )

        matches_a_post = any(final_saved_chords == val for val in valid_post_serialized)
        assert matches_a_post, (
            f"Check-then-act race clobbered POST data! Final saved chords {final_saved_chords} "
            f"did not match any of the POST payloads: {valid_post_serialized}"
        )

    def test_rapid_alternating_posts_during_slow_backfill(self, client: TestClient, tmp_path: Path):
        """GET begins slow backfill. Meanwhile, POST sequence: Custom A -> [] -> Custom B.

        When GET completes, Custom B must be preserved, not overwritten by detected chords or previous POST.
        """
        pid = "m1_iter4_rapid_posts"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        create_test_wav(stem_path, generate_harmonic_sine(1.0, 523.25), sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        detector = getattr(main_mod, "chord_detector", None)
        assert detector is not None
        orig_detect = detector.detect_chords

        def slow_detect(*args, **kwargs):
            time.sleep(0.50)
            return orig_detect(*args, **kwargs)

        detector.detect_chords = slow_detect

        get_resp: dict[str, Any] = {}

        def bg_get():
            res = client.get(f"/api/project/{pid}/chords")
            get_resp["status"] = res.status_code
            get_resp["body"] = res.json()

        try:
            t_get = threading.Thread(target=bg_get)
            t_get.start()

            time.sleep(0.03)

            # Step 1: POST Custom A
            resp_a = client.post(
                f"/api/project/{pid}/chords",
                json={"chords": [{"start": 0.0, "end": 0.3, "chord": "C"}]},
            )
            assert resp_a.status_code == 200

            time.sleep(0.02)

            # Step 2: POST Empty []
            resp_empty = client.post(f"/api/project/{pid}/chords", json={"chords": []})
            assert resp_empty.status_code == 200

            time.sleep(0.02)

            # Step 3: POST Custom B
            expected_b = [
                {"start": 0.0, "end": 0.5, "chord": "D"},
                {"start": 0.5, "end": 1.0, "chord": "G7"},
            ]
            resp_b = client.post(f"/api/project/{pid}/chords", json={"chords": expected_b})
            assert resp_b.status_code == 200

            t_get.join(timeout=5.0)
            assert not t_get.is_alive()
        finally:
            detector.detect_chords = orig_detect

        assert get_resp["status"] == 200

        with PROJECTS_LOCK:
            final_chords = projects[pid]["chords"]

        # Final chords must strictly equal Custom B
        assert final_chords == resp_b.json()["chords"], (
            f"Check-then-act race clobbered latest POST! Expected {resp_b.json()['chords']}, got {final_chords}"
        )
        # In-flight GET response should also have returned Custom B
        assert get_resp["body"]["chords"] == resp_b.json()["chords"]

    def test_transposition_parameter_during_concurrent_post_race(
        self, client: TestClient, tmp_path: Path
    ):
        """GET /api/project/{id}/chords?semitones=2 races with concurrent POST of chord 'C'.

        The GET must return transposed chord 'D', but the project store MUST retain untransposed 'C'.
        """
        pid = "m1_iter4_transposition_race"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        create_test_wav(stem_path, generate_harmonic_sine(1.0, 440.0), sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
                "vocal_range": {"estimated_key": "C"},
            }
            save_projects()

        detector = getattr(main_mod, "chord_detector", None)
        assert detector is not None
        orig_detect = detector.detect_chords

        def slow_detect(*args, **kwargs):
            time.sleep(0.12)
            return orig_detect(*args, **kwargs)

        detector.detect_chords = slow_detect

        get_resp: dict[str, Any] = {}

        def bg_get():
            res = client.get(f"/api/project/{pid}/chords?semitones=2")
            get_resp["status"] = res.status_code
            get_resp["body"] = res.json()

        try:
            t_get = threading.Thread(target=bg_get)
            t_get.start()

            time.sleep(0.03)

            # Concurrent POST sets untransposed 'C'
            post_payload = [{"start": 0.0, "end": 1.0, "chord": "C"}]
            resp_post = client.post(f"/api/project/{pid}/chords", json={"chords": post_payload})
            assert resp_post.status_code == 200

            t_get.join(timeout=5.0)
            assert not t_get.is_alive()
        finally:
            detector.detect_chords = orig_detect

        assert get_resp["status"] == 200
        # GET returned chords should be transposed by +2: 'C' + 2 semitones -> 'D'
        returned_chords = get_resp["body"]["chords"]
        assert len(returned_chords) == 1
        assert returned_chords[0]["chord"] == "D"

        # But project storage must still hold the untransposed 'C'
        with PROJECTS_LOCK:
            stored_chords = projects[pid]["chords"]
        assert stored_chords[0]["chord"] == "C"

    def test_multi_project_high_concurrency_stress_with_continuous_disk_auditor(
        self, client: TestClient, tmp_path: Path
    ):
        """Stress test: 5 projects, 40 concurrent workers mixing GET, POST custom, POST empty,

        and POST detect, while a continuous disk auditor verifies projects.json integrity every 2ms.
        """
        pids = [f"m1_iter4_multiproj_{i}" for i in range(5)]
        for pid in pids:
            stem_dir = config.STEMS_DIR / pid
            stem_dir.mkdir(parents=True, exist_ok=True)
            stem_path = stem_dir / "instrumental.wav"
            create_test_wav(
                stem_path, generate_harmonic_sine(1.0, 300.0 + random.randint(0, 300)), sr=22050
            )

            with PROJECTS_LOCK:
                projects[pid] = {
                    "id": pid,
                    "status": "ready",
                    "instrumental_path": str(stem_path),
                    "chords": None,
                }
        with PROJECTS_LOCK:
            save_projects()

        stop_auditor = threading.Event()
        auditor_errors: list[str] = []

        def disk_auditor():
            projects_file = config.DATA_DIR / "projects.json"
            while not stop_auditor.is_set():
                try:
                    if projects_file.exists():
                        with open(projects_file, encoding="utf-8") as f:
                            raw = f.read()
                        if raw:
                            data = json.loads(raw)
                            assert isinstance(data, dict)
                            for p in pids:
                                if p in data:
                                    chords = data[p].get("chords")
                                    if chords is not None:
                                        assert isinstance(chords, list)
                                        for c in chords:
                                            assert "start" in c and "end" in c and "chord" in c
                                            assert c["start"] < c["end"]
                except Exception as e:
                    auditor_errors.append(f"Audit failure: {e}")
                time.sleep(0.002)

        auditor_thread = threading.Thread(target=disk_auditor, daemon=True)
        auditor_thread.start()

        num_tasks = 40

        def worker_task(idx: int):
            chosen_pid = random.choice(pids)
            op = random.choice(["get", "post_custom", "post_empty"])
            if op == "get":
                r = client.get(f"/api/project/{chosen_pid}/chords")
                assert r.status_code == 200
            elif op == "post_custom":
                payload = [
                    {"start": 0.0, "end": 0.4, "chord": "Am"},
                    {"start": 0.4, "end": 0.9, "chord": "Em"},
                ]
                r = client.post(f"/api/project/{chosen_pid}/chords", json={"chords": payload})
                assert r.status_code == 200
            else:
                r = client.post(f"/api/project/{chosen_pid}/chords", json={"chords": []})
                assert r.status_code == 200

        try:
            with ThreadPoolExecutor(max_workers=12) as executor:
                futures = [executor.submit(worker_task, i) for i in range(num_tasks)]
                for f in as_completed(futures):
                    f.result()
        finally:
            stop_auditor.set()
            auditor_thread.join(timeout=2.0)

        assert not auditor_errors, f"Disk auditor observed JSON corruption: {auditor_errors}"

        # Ensure no temp file leakage in data dir
        tmp_files = list(config.DATA_DIR.glob(".projects.json.tmp.*"))
        assert len(tmp_files) == 0, f"Found leaked temp files: {tmp_files}"

        # Final read check
        for pid in pids:
            with PROJECTS_LOCK:
                assert projects[pid]["chords"] is not None

    def test_project_deletion_race_during_inflight_backfill(
        self, client: TestClient, tmp_path: Path
    ):
        """If a project is deleted while GET auto-backfill is calculating,

        re-acquiring PROJECTS_LOCK must raise 404 cleanly without reviving the deleted project.
        """
        pid = "m1_iter4_delete_race"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        create_test_wav(stem_path, generate_harmonic_sine(1.0, 440.0), sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        detector = getattr(main_mod, "chord_detector", None)
        assert detector is not None
        orig_detect = detector.detect_chords

        def slow_detect(*args, **kwargs):
            # Compute detection first (so audio file is already read)
            res = orig_detect(*args, **kwargs)
            # Then pause right before returning to get_project_chords lock acquisition
            time.sleep(0.12)
            return res

        detector.detect_chords = slow_detect

        get_result: dict[str, Any] = {}

        def bg_get():
            res = client.get(f"/api/project/{pid}/chords")
            get_result["status"] = res.status_code

        try:
            t_get = threading.Thread(target=bg_get)
            t_get.start()

            # Wait until detection is underway and in the sleep pause
            time.sleep(0.04)

            # Delete project during the pause before lock acquisition
            del_resp = client.delete(f"/api/project/{pid}")
            assert del_resp.status_code == 200

            t_get.join(timeout=5.0)
            assert not t_get.is_alive()
        finally:
            detector.detect_chords = orig_detect

        # GET should have returned 404 (or 500 if file unlinked, but here 404)
        assert get_result["status"] == 404

        # Project must remain deleted
        with PROJECTS_LOCK:
            assert pid not in projects

    @pytest.mark.parametrize("trial", range(3))
    def test_heavy_multi_iteration_race_matrix_zero_clobber(self, client: TestClient, trial: int):
        """Heavy stress across multiple trials: 40 threads (20 GET, 10 POST custom, 10 POST empty).

        Verifies that in 100% of trials, check-then-act race never clobbers any committed POST.
        """
        pid = f"m1_iter4_heavy_race_trial_{trial}"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        create_test_wav(stem_path, generate_harmonic_sine(1.0, 440.0 + trial * 20), sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        barrier = threading.Barrier(40)
        results: list[dict[str, Any]] = []
        lock = threading.Lock()

        # Custom payloads with distinct markers
        custom_payloads = [
            [{"start": 0.0, "end": 0.5, "chord": "C"}, {"start": 0.5, "end": 1.0, "chord": "G"}],
            [{"start": 0.0, "end": 0.4, "chord": "Am"}, {"start": 0.4, "end": 1.0, "chord": "F"}],
            [{"start": 0.0, "end": 0.6, "chord": "Dm"}, {"start": 0.6, "end": 1.0, "chord": "A7"}],
            [{"start": 0.0, "end": 0.5, "chord": "Em"}, {"start": 0.5, "end": 1.0, "chord": "B7"}],
            [{"start": 0.0, "end": 0.7, "chord": "Bb"}, {"start": 0.7, "end": 1.0, "chord": "F7"}],
        ]

        def get_worker():
            barrier.wait()
            res = client.get(f"/api/project/{pid}/chords")
            with lock:
                results.append(
                    {"op": "GET", "status": res.status_code, "chords": res.json()["chords"]}
                )

        def post_custom_worker(payload: list[dict]):
            barrier.wait()
            time.sleep(random.uniform(0.005, 0.03))
            res = client.post(f"/api/project/{pid}/chords", json={"chords": payload})
            with lock:
                results.append(
                    {
                        "op": "POST_CUSTOM",
                        "status": res.status_code,
                        "chords": res.json().get("chords"),
                    }
                )

        def post_empty_worker():
            barrier.wait()
            time.sleep(random.uniform(0.005, 0.03))
            res = client.post(f"/api/project/{pid}/chords", json={"chords": []})
            with lock:
                results.append(
                    {
                        "op": "POST_EMPTY",
                        "status": res.status_code,
                        "chords": res.json().get("chords"),
                    }
                )

        threads: list[threading.Thread] = []
        for _ in range(20):
            threads.append(threading.Thread(target=get_worker))
        for i in range(10):
            threads.append(
                threading.Thread(
                    target=post_custom_worker, args=(custom_payloads[i % len(custom_payloads)],)
                )
            )
        for _ in range(10):
            threads.append(threading.Thread(target=post_empty_worker))

        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10.0)
            assert not t.is_alive()

        assert len(results) == 40
        for r in results:
            assert r["status"] == 200

        with PROJECTS_LOCK:
            final_chords = projects[pid]["chords"]

        # Valid final chord options: either [] or one of custom_payloads (with pydantic schema fields)
        valid_options = [[]]
        for cp in custom_payloads:
            valid_options.append(
                [
                    {
                        "start": float(c["start"]),
                        "end": float(c["end"]),
                        "chord": c["chord"],
                        "id": None,
                        "confidence": None,
                    }
                    for c in cp
                ]
            )

        assert final_chords in valid_options, (
            f"Trial {trial}: Final saved chords were clobbered by backfill! Got: {final_chords}"
        )

    def test_concurrent_invalid_post_422_does_not_corrupt_or_block_backfill(
        self, client: TestClient, tmp_path: Path
    ):
        """Concurrent POST with invalid overlapping chords returns 422 and does NOT affect in-flight backfill."""
        pid = "m1_iter4_invalid_post_race"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        create_test_wav(stem_path, generate_harmonic_sine(1.0, 440.0), sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        detector = getattr(main_mod, "chord_detector", None)
        assert detector is not None
        orig_detect = detector.detect_chords

        def slow_detect(*args, **kwargs):
            time.sleep(0.10)
            return orig_detect(*args, **kwargs)

        detector.detect_chords = slow_detect

        get_res: dict[str, Any] = {}
        post_res: dict[str, Any] = {}

        def run_get():
            r = client.get(f"/api/project/{pid}/chords")
            get_res["status"] = r.status_code
            get_res["data"] = r.json()

        def run_post_invalid():
            time.sleep(0.03)
            # Inverted interval: start 0.8 > end 0.2
            r = client.post(
                f"/api/project/{pid}/chords",
                json={"chords": [{"start": 0.8, "end": 0.2, "chord": "C"}]},
            )
            post_res["status"] = r.status_code
            post_res["data"] = r.json()

        try:
            t1 = threading.Thread(target=run_get)
            t2 = threading.Thread(target=run_post_invalid)
            t1.start()
            t2.start()
            t1.join(timeout=5.0)
            t2.join(timeout=5.0)
        finally:
            detector.detect_chords = orig_detect

        assert post_res["status"] == 422
        assert get_res["status"] == 200
        # Since invalid POST was rejected, GET backfill must have succeeded and persisted
        with PROJECTS_LOCK:
            assert projects[pid]["chords"] is not None
            assert len(projects[pid]["chords"]) > 0

    def test_fast_path_when_chords_is_empty_list_bypasses_detection(
        self, client: TestClient, tmp_path: Path
    ):
        """When chords is explicitly [], 20 concurrent GETs must hit the fast path without calling detect_chords."""
        pid = "m1_iter4_empty_fast_path"
        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": "/path/does/not/exist.wav",
                "chords": [],
            }
            save_projects()

        detector = getattr(main_mod, "chord_detector", None)
        assert detector is not None
        orig_detect = detector.detect_chords

        detection_call_count = [0]
        count_lock = threading.Lock()

        def counted_detect(*args, **kwargs):
            with count_lock:
                detection_call_count[0] += 1
            return orig_detect(*args, **kwargs)

        detector.detect_chords = counted_detect

        def do_get():
            r = client.get(f"/api/project/{pid}/chords")
            assert r.status_code == 200
            assert r.json()["chords"] == []

        try:
            threads = [threading.Thread(target=do_get) for _ in range(20)]
            for t in threads:
                t.start()
            for t in threads:
                t.join(timeout=5.0)
        finally:
            detector.detect_chords = orig_detect

        # detect_chords must NOT have been called even once
        assert detection_call_count[0] == 0, (
            f"Expected 0 detect_chords calls for empty chords fast-path, got {detection_call_count[0]}"
        )
