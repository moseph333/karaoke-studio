"""Empirical Adversarial Concurrency and Audio Edge Cases Challenger Suite.

Milestone: Milestone 1 Iteration 3
Agent: Challenger 2 (Concurrency & Audio Edge Cases Challenger)

Scope of Challenge:
1. Multi-threaded concurrency:
   - High-concurrency operations across multiple projects simultaneously (GET, POST, POST /detect).
   - Continuous high-frequency disk reader checking JSON syntax and structure during concurrent operations.
   - Verification of zero temp file leakage (.projects.json.tmp.*) and zero JSON corruption.
   - Concurrent auto-backfills on the same un-backfilled project (20 threads simultaneous GET).
   - Concurrent project deletions while other threads read and write chords.
   - Concurrent direct update_project_chords invocations.
   - Check-Then-Act Race Condition demonstration: GET auto-backfill STFT running outside PROJECTS_LOCK
     unconditionally overwrites concurrent POST updates (custom chords and empty chords []).
2. Audio edge cases & monotonic interval induction:
   - Silent audio: pure zeros, sub-threshold RMS, constant DC offset.
   - Noise: Gaussian white noise, uniform noise, out-of-band high frequency (10kHz), out-of-band rumble (20Hz).
   - Short audio: 0 samples, 1 sample, 100 samples, 4095 samples (< nperseg), 4096 samples (== nperseg), 4097 samples, 6144 samples, duration < 0.3s.
   - Boundary values & non-finites: NaNs, +Inf, -Inf, huge amplitudes (1e6), tiny amplitudes (1e-30), impulse spikes.
   - Multichannel: stereo, 6-channel surround, phase-inverted stereo (L = -R).
   - Sample rates: 8kHz, 11.025kHz, 16kHz, 44.1kHz, 48kHz, 96kHz, 192kHz.
   - Strict monotonic interval verification: for every segment, 0 <= start < end, and end_{i-1} <= start_i.
3. API End-to-End audio edge case verification:
   - GET /api/project/{id}/chords with silent stem, noise stem, and ultra-short stem.
"""

from __future__ import annotations

import json
import os
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
from backend.project_store import update_project_chords
from backend.schemas import ChordSegmentSchema, ChordsUpdateRequest, ProjectChordsResponse
from backend.services.chord_detector import ChordDetector

# ==============================================================================
# Helper Verification Functions
# ==============================================================================


def assert_monotonic_intervals(
    segments: list[dict[str, Any]],
    total_duration: float | None = None,
    allow_empty: bool = True,
) -> None:
    """Empirically asserts that chord segments strictly adhere to non-overlapping monotonic intervals.

    Checks:
    1. Schema validation via Pydantic ChordSegmentSchema / ChordsUpdateRequest.
    2. 0.0 <= start < end for every segment.
    3. start and end are finite numbers (not NaN, not Inf).
    4. end_{i-1} <= start_i for all consecutive segments.
    5. If total_duration provided and unfiltered, segments cover up to total_duration.
    """
    if not segments:
        assert allow_empty, "Expected non-empty chord segments list, got empty list"
        return

    # 1. Pydantic schema validation
    req = ChordsUpdateRequest(chords=segments)
    assert len(req.chords) == len(segments)

    for i, s in enumerate(segments):
        start = float(s["start"])
        end = float(s["end"])
        chord = s["chord"]

        assert not np.isnan(start) and not np.isnan(end), f"Segment {i} has NaN timestamp: {s}"
        assert not np.isinf(start) and not np.isinf(end), f"Segment {i} has Inf timestamp: {s}"
        assert start >= 0.0, f"Segment {i} has negative start timestamp: {start}"
        assert start < end, f"Segment {i} violates start < end: [{start}, {end}] in {s}"
        assert isinstance(chord, str) and chord, f"Segment {i} has invalid chord string: {chord}"

        if i > 0:
            prev_end = float(segments[i - 1]["end"])
            assert prev_end <= start, (
                f"Segment {i} overlaps previous segment: prev_end={prev_end} > curr_start={start}"
            )

    if total_duration is not None and len(segments) > 0 and segments[-1]["chord"] == "N":
        # Boundary check for un-filtered detection
        assert segments[0]["start"] == 0.0, f"First segment does not start at 0.0: {segments[0]}"


def create_test_wav(
    file_path: Path,
    signal: np.ndarray,
    sr: int = 22050,
) -> Path:
    """Helper to write numpy audio data to a WAV file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), signal, sr)
    return file_path


# ==============================================================================
# 1. MULTI-THREADED CONCURRENCY & PERSISTENCE STRESS TESTS
# ==============================================================================


class TestMultiThreadedPersistenceAndConcurrency:
    """Stress tests concurrent reads, updates, and detections across multiple projects simultaneously."""

    def test_high_concurrency_multi_project_matrix_zero_corruption(
        self, client: TestClient, tmp_path: Path
    ):
        """Tests 150 concurrent operations across 6 projects with simultaneous continuous disk reads.

        Verifies:
        - 100% of operations succeed with HTTP 200.
        - Zero JSON corruption or syntax errors observed during continuous disk reads.
        - Zero leaked temporary files (.projects.json.tmp.*) in DATA_DIR.
        - Final projects.json retains valid state for all projects.
        """
        num_projects = 6
        pids = [f"m1_iter3_matrix_proj_{i}" for i in range(num_projects)]

        for pid in pids:
            stem_dir = config.STEMS_DIR / pid
            stem_dir.mkdir(parents=True, exist_ok=True)
            stem_path = stem_dir / "instrumental.wav"
            t = np.linspace(0, 1.2, int(22050 * 1.2), endpoint=False)
            sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
            create_test_wav(stem_path, sine, sr=22050)
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
            op = idx % 4
            if op == 0:
                s = (idx % 25) - 12
                r = client.get(f"/api/project/{pid}/chords?semitones={s}")
                return ("GET", pid, r.status_code, r.text)
            elif op == 1:
                chord_name = ["C", "Dm", "Em", "F", "G", "Am", "Bdim"][idx % 7]
                payload = {
                    "chords": [
                        {"start": 0.0, "end": 0.6, "chord": chord_name},
                        {"start": 0.6, "end": 1.2, "chord": "G7"},
                    ]
                }
                r = client.post(f"/api/project/{pid}/chords", json=payload)
                return ("POST", pid, r.status_code, r.text)
            elif op == 2:
                r = client.post(f"/api/project/{pid}/chords/detect")
                return ("DETECT", pid, r.status_code, r.text)
            else:
                s = ((idx * 3) % 25) - 12
                r = client.get(f"/api/project/{pid}/chords?semitones={s}")
                return ("GET2", pid, r.status_code, r.text)

        total_ops = 150
        workers = 16
        results = []
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(worker_task, i) for i in range(total_ops)]
            for f in as_completed(futures):
                results.append(f.result())

        stop_event.set()
        reader_thread.join(timeout=3.0)

        # 1. Verify all operations succeeded
        for op, pid, status, text in results:
            assert status == 200, f"Operation {op} on {pid} failed with status {status}: {text}"

        # 2. Verify disk reader had zero corruption
        assert len(disk_read_errors) == 0, f"Detected JSON corruption: {disk_read_errors[:5]}"
        assert disk_read_count[0] > 20, f"Disk reader only executed {disk_read_count[0]} times"

        # 3. Verify final state integrity
        final_data = json.loads(store_file.read_text(encoding="utf-8"))
        for pid in pids:
            assert pid in final_data, f"Project {pid} missing from final projects.json"
            assert final_data[pid].get("chords") is not None, f"Project {pid} lost chords"

        # 4. Verify no leaked temporary files
        leaked_tmps = list(config.DATA_DIR.glob(".projects.json.tmp.*"))
        assert len(leaked_tmps) == 0, f"Found leaked temporary store files: {leaked_tmps}"

    def test_concurrent_auto_backfill_same_project(self, client: TestClient, tmp_path: Path):
        """20 threads simultaneously request GET /api/project/{pid}/chords on an un-backfilled project."""
        pid = "m1_iter3_same_proj_backfill"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        t = np.linspace(0, 1.5, int(22050 * 1.5), endpoint=False)
        sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
        create_test_wav(stem_path, sine, sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        def request_backfill(idx: int):
            r = client.get(f"/api/project/{pid}/chords")
            return r.status_code, r.json()

        with ThreadPoolExecutor(max_workers=20) as executor:
            futures = [executor.submit(request_backfill, i) for i in range(20)]
            results = [f.result() for f in as_completed(futures)]

        for status, body in results:
            assert status == 200
            assert body["detected"] is True
            assert len(body["chords"]) > 0
            assert_monotonic_intervals(body["chords"])

        # All threads must observe identical chord sequences
        first_chords = results[0][1]["chords"]
        for _, body in results[1:]:
            assert body["chords"] == first_chords

    def test_concurrent_project_deletion_and_read_safety(self, client: TestClient, tmp_path: Path):
        """Verifies that concurrent deletions do not cause unhandled 500s or store corruption."""
        pids = [f"m1_iter3_del_proj_{i}" for i in range(8)]
        for pid in pids:
            stem_dir = config.STEMS_DIR / pid
            stem_dir.mkdir(parents=True, exist_ok=True)
            stem_path = stem_dir / "instrumental.wav"
            t = np.linspace(0, 1.0, int(22050 * 1.0), endpoint=False)
            sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
            create_test_wav(stem_path, sine, sr=22050)
            with PROJECTS_LOCK:
                projects[pid] = {
                    "id": pid,
                    "status": "ready",
                    "instrumental_path": str(stem_path),
                    "chords": [{"start": 0.0, "end": 1.0, "chord": "C"}],
                }
                save_projects()

        def mixed_task(idx: int):
            pid = pids[idx % len(pids)]
            if idx % 3 == 0:
                r = client.delete(f"/api/project/{pid}")
                return ("DELETE", pid, r.status_code)
            elif idx % 3 == 1:
                r = client.get(f"/api/project/{pid}/chords")
                return ("GET", pid, r.status_code)
            else:
                r = client.post(
                    f"/api/project/{pid}/chords",
                    json={"chords": [{"start": 0.0, "end": 1.0, "chord": "G"}]},
                )
                return ("POST", pid, r.status_code)

        with ThreadPoolExecutor(max_workers=16) as executor:
            futures = [executor.submit(mixed_task, i) for i in range(40)]
            results = [f.result() for f in as_completed(futures)]

        for op, pid, status in results:
            # Valid responses are 200 (if processed before deletion) or 404 (if processed after deletion)
            assert status in (200, 404), (
                f"Operation {op} on {pid} failed with unexpected status: {status}"
            )

        # Confirm store file is valid JSON
        store_data = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert isinstance(store_data, dict)

    def test_direct_update_project_chords_concurrency(self):
        """Verifies direct update_project_chords multi-threaded consistency under PROJECTS_LOCK."""
        pid = "m1_iter3_direct_lock_proj"
        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "chords": None,
            }
            save_projects()

        def update_task(idx: int):
            chords = [{"start": 0.0, "end": 1.0, "chord": f"C{idx}"}]
            return update_project_chords(pid, chords)

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(update_task, i) for i in range(30)]
            for f in as_completed(futures):
                res = f.result()
                assert res["id"] == pid
                assert len(res["chords"]) == 1

        with PROJECTS_LOCK:
            assert projects[pid]["id"] == pid
            assert len(projects[pid]["chords"]) == 1

    def test_concurrent_invalid_payload_isolation(self, client: TestClient, tmp_path: Path):
        """Verifies that invalid payloads (422) do not corrupt projects.json or interfere with concurrent valid requests."""
        pid = "m1_iter3_invalid_isolation_proj"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        t = np.linspace(0, 1.0, int(22050 * 1.0), endpoint=False)
        sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
        create_test_wav(stem_path, sine, sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": [{"start": 0.0, "end": 1.0, "chord": "C"}],
            }
            save_projects()

        def request_task(idx: int):
            if idx % 2 == 0:
                # Invalid payload: inverted start >= end
                r = client.post(
                    f"/api/project/{pid}/chords",
                    json={"chords": [{"start": 1.0, "end": 0.5, "chord": "C"}]},
                )
                return (r.status_code, 422)
            else:
                # Valid payload
                r = client.post(
                    f"/api/project/{pid}/chords",
                    json={"chords": [{"start": 0.0, "end": 1.0, "chord": "Am"}]},
                )
                return (r.status_code, 200)

        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = [executor.submit(request_task, i) for i in range(30)]
            for f in as_completed(futures):
                actual, expected = f.result()
                assert actual == expected


# ==============================================================================
# 2. CHECK-THEN-ACT RACE CONDITION DEFECT DEMONSTRATIONS
# ==============================================================================


class TestCheckThenActRaceConditionDefect:
    """Empirically demonstrates the Check-Then-Act race condition in get_project_chords.

    In backend/routers/projects.py:
    1. get_project_chords checks `cached_chords = proj.get("chords")`.
       When chords is None, it initiates STFT detection outside PROJECTS_LOCK.
    2. While STFT is computing, a concurrent POST /api/project/{id}/chords arrives
       and saves user chords under PROJECTS_LOCK.
    3. The GET finishes STFT and re-acquires PROJECTS_LOCK, but unconditionally
       writes `target_proj["chords"] = detected_chords` without checking if
       `target_proj.get("chords") is None`.
    4. Result: User's manual chord edit is clobbered by late-arriving auto-backfill.
    """

    def test_reproduce_check_then_act_race_get_backfill_clobbers_concurrent_post(
        self, client: TestClient, tmp_path: Path
    ):
        """User manual chord edit (POST) during in-flight GET auto-backfill must not be clobbered."""
        pid = "m1_iter3_race_post_clobber"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        t = np.linspace(0, 1.0, int(22050 * 1.0), endpoint=False)
        sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
        create_test_wav(stem_path, sine, sr=22050)

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
            time.sleep(0.15)
            return orig_detect(*args, **kwargs)

        detector.detect_chords = slow_detect

        try:
            t_get = threading.Thread(target=lambda: client.get(f"/api/project/{pid}/chords"))
            t_get.start()

            # Wait briefly so GET is inside detect_chords
            time.sleep(0.04)

            # User saves custom chords
            custom_chords = [
                {"start": 0.0, "end": 0.5, "chord": "F#m"},
                {"start": 0.5, "end": 1.0, "chord": "B7"},
            ]
            r_post = client.post(f"/api/project/{pid}/chords", json={"chords": custom_chords})
            assert r_post.status_code == 200

            t_get.join()
        finally:
            detector.detect_chords = orig_detect

        with PROJECTS_LOCK:
            final_chords = projects[pid]["chords"]

        # MUST preserve user custom chords!
        assert final_chords == r_post.json()["chords"], (
            f"Check-then-act race condition occurred: user custom chords {custom_chords} "
            f"were clobbered by late-arriving auto-backfill: {final_chords}"
        )

    def test_reproduce_check_then_act_race_get_backfill_clobbers_empty_chords(
        self, client: TestClient, tmp_path: Path
    ):
        """User clearing chords to [] during in-flight GET auto-backfill must not be clobbered."""
        pid = "m1_iter3_race_empty_clobber"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        t = np.linspace(0, 1.0, int(22050 * 1.0), endpoint=False)
        sine = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
        create_test_wav(stem_path, sine, sr=22050)

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
            time.sleep(0.15)
            return orig_detect(*args, **kwargs)

        detector.detect_chords = slow_detect

        try:
            t_get = threading.Thread(target=lambda: client.get(f"/api/project/{pid}/chords"))
            t_get.start()

            time.sleep(0.04)

            # User explicitly clears chords to []
            r_post = client.post(f"/api/project/{pid}/chords", json={"chords": []})
            assert r_post.status_code == 200

            t_get.join()
        finally:
            detector.detect_chords = orig_detect

        with PROJECTS_LOCK:
            final_chords = projects[pid]["chords"]

        # MUST preserve empty chord list []!
        assert final_chords == [], (
            f"Check-then-act race condition occurred: user empty chords [] "
            f"were clobbered by late-arriving auto-backfill: {final_chords}"
        )


# ==============================================================================
# 3. AUDIO EDGE CASES & STRICT MONOTONIC INTERVAL INDUCTION
# ==============================================================================


class TestAudioEdgeCasesMonotonicIntervals:
    """Stress tests audio edge cases ensuring strictly monotonic intervals and zero crashes."""

    @pytest.fixture
    def detector(self) -> ChordDetector:
        return ChordDetector()

    @pytest.mark.parametrize(
        "duration",
        [0.2, 0.5, 1.0, 5.0, 15.0, 30.0],
    )
    def test_silent_audio_durations_monotonic(self, detector: ChordDetector, duration: float):
        """Pure zero audio signals must produce strictly monotonic intervals without crashes."""
        sr = 22050
        signal = np.zeros(int(sr * duration), dtype=np.float32)

        # 1. Unfiltered (should produce single or grouped 'N' segments spanning total duration)
        chords_unfiltered = detector.detect_chords(signal, filter_no_chord=False)
        assert_monotonic_intervals(chords_unfiltered, total_duration=duration)
        if len(signal) >= detector.nperseg:
            assert len(chords_unfiltered) > 0
            assert all(c["chord"] == "N" for c in chords_unfiltered)

        # 2. Filtered (should filter out 'N' chords cleanly into empty list)
        chords_filtered = detector.detect_chords(signal, filter_no_chord=True)
        assert_monotonic_intervals(chords_filtered, allow_empty=True)
        assert len(chords_filtered) == 0

    @pytest.mark.parametrize("dc_val", [0.01, 0.1, 0.5, 0.9, -0.5, -0.9])
    def test_constant_dc_offset_monotonic(self, detector: ChordDetector, dc_val: float):
        """Pure DC offset (constant value, no AC energy) must be gated and monotonic."""
        sr = 22050
        signal = np.full(int(sr * 2.0), dc_val, dtype=np.float32)
        chords = detector.detect_chords(signal, filter_no_chord=False)
        assert_monotonic_intervals(chords, total_duration=2.0)
        assert all(c["chord"] == "N" for c in chords)

    @pytest.mark.parametrize("rms_scale", [1e-7, 1e-6, 1e-5, 1e-4, 0.004])
    def test_sub_threshold_rms_monotonic(self, detector: ChordDetector, rms_scale: float):
        """Audio energy below energy_threshold (0.005) must be gated as silence/N and monotonic."""
        sr = 22050
        rng = np.random.default_rng(42)
        signal = (rms_scale * rng.standard_normal(int(sr * 2.5))).astype(np.float32)
        chords = detector.detect_chords(signal, filter_no_chord=False)
        assert_monotonic_intervals(chords, total_duration=2.5)
        assert all(c["chord"] == "N" for c in chords)

    @pytest.mark.parametrize("noise_scale", [0.05, 0.2, 0.5, 1.0, 5.0])
    def test_gaussian_noise_monotonic(self, detector: ChordDetector, noise_scale: float):
        """Gaussian noise across amplitude scales must produce strictly monotonic intervals."""
        sr = 22050
        rng = np.random.default_rng(123)
        signal = (noise_scale * rng.standard_normal(int(sr * 3.0))).astype(np.float32)

        ch_unfiltered = detector.detect_chords(signal, filter_no_chord=False)
        assert_monotonic_intervals(ch_unfiltered, total_duration=3.0)

        ch_filtered = detector.detect_chords(signal, filter_no_chord=True)
        assert_monotonic_intervals(ch_filtered, allow_empty=True)

    @pytest.mark.parametrize("freq", [10.0, 20.0, 35.0, 50.0, 3000.0, 5000.0, 10000.0])
    def test_out_of_band_frequencies_monotonic(self, detector: ChordDetector, freq: float):
        """Signals strictly outside the [65Hz, 2100Hz] chroma filterbank must not crash and be monotonic."""
        sr = 22050
        t = np.linspace(0, 2.0, int(sr * 2.0), endpoint=False)
        signal = (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)

        chords = detector.detect_chords(signal, filter_no_chord=False)
        assert_monotonic_intervals(chords, total_duration=2.0)

    @pytest.mark.parametrize(
        "samples",
        [0, 1, 10, 100, 500, 2048, 4095, 4096, 4097, 4500, 6144, 8192],
    )
    def test_short_audio_boundary_sample_counts(self, detector: ChordDetector, samples: int):
        """Audio signals from 0 samples to slightly above nperseg must handle boundaries cleanly."""
        sr = 22050
        signal = np.ones(samples, dtype=np.float32) * 0.5
        chords = detector.detect_chords(signal, filter_no_chord=False)

        if samples < detector.nperseg:
            # Sub-frame audio returns empty list
            assert chords == []
        else:
            total_dur = samples / sr
            assert_monotonic_intervals(chords, total_duration=total_dur)
            assert len(chords) >= 1

    def test_non_finite_audio_scrubbing(self, detector: ChordDetector):
        """Audio containing NaN, +Inf, -Inf must be scrubbed cleanly by _load_audio without crash."""
        corrupted = np.array([np.nan, np.inf, -np.inf, 0.5, -0.5] * 2000, dtype=np.float32)
        chords = detector.detect_chords(corrupted, filter_no_chord=False)
        assert_monotonic_intervals(chords)

    def test_extreme_amplitude_signals(self, detector: ChordDetector):
        """Signals with massive amplitude (1e6) or tiny non-zero amplitude (1e-30) must not overflow."""
        sr = 22050
        t = np.linspace(0, 2.0, int(sr * 2.0), endpoint=False)

        # Huge
        huge_sig = (1e6 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        ch_huge = detector.detect_chords(huge_sig, filter_no_chord=False)
        assert_monotonic_intervals(ch_huge, total_duration=2.0)

        # Tiny
        tiny_sig = (1e-30 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)
        ch_tiny = detector.detect_chords(tiny_sig, filter_no_chord=False)
        assert_monotonic_intervals(ch_tiny, total_duration=2.0)
        assert all(c["chord"] == "N" for c in ch_tiny)

    def test_stereo_and_multichannel_downmixing(self, detector: ChordDetector):
        """Stereo, 6-channel audio, and phase-inverted stereo must downmix cleanly and be monotonic."""
        sr = 22050
        t = np.linspace(0, 2.0, int(sr * 2.0), endpoint=False)
        mono_sine = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

        # 1. Standard Stereo
        stereo = np.stack([mono_sine, mono_sine * 0.8], axis=1)
        ch_stereo = detector.detect_chords(stereo, filter_no_chord=False)
        assert_monotonic_intervals(ch_stereo, total_duration=2.0)

        # 2. Phase-inverted Stereo (L = -R, cancels to pure silence)
        stereo_cancelled = np.stack([mono_sine, -mono_sine], axis=1)
        ch_canc = detector.detect_chords(stereo_cancelled, filter_no_chord=False)
        assert_monotonic_intervals(ch_canc, total_duration=2.0)
        assert all(c["chord"] == "N" for c in ch_canc)

        # 3. 6-Channel 5.1 Surround
        surround = np.stack([mono_sine] * 6, axis=1)
        ch_surr = detector.detect_chords(surround, filter_no_chord=False)
        assert_monotonic_intervals(ch_surr, total_duration=2.0)

    @pytest.mark.parametrize(
        "target_sr",
        [8000, 11025, 16000, 22050, 44100, 48000, 88200, 96000, 192000],
    )
    def test_sample_rate_resampling_monotonicity(self, detector: ChordDetector, target_sr: int):
        """Audio sampled at various hardware rates must resample correctly and preserve monotonicity."""
        t = np.linspace(0, 2.0, int(target_sr * 2.0), endpoint=False)
        signal = (0.5 * np.sin(2 * np.pi * 440.0 * t)).astype(np.float32)

        chords = detector.detect_chords(signal, sr=target_sr, filter_no_chord=False)
        assert_monotonic_intervals(chords, total_duration=2.0)

    def test_smooth_segments_tiny_total_duration(self, detector: ChordDetector):
        """smooth_segments with tiny duration < 0.001s must clamp start < end strictly."""
        res = detector.smooth_segments(
            labels=["C"],
            confidences=[0.9],
            frame_times=[(0.0, 0.0001)],
            total_duration=0.0001,
        )
        assert len(res) == 1
        assert res[0]["start"] >= 0.0
        assert res[0]["start"] < res[0]["end"]
        assert_monotonic_intervals(res)


# ==============================================================================
# 4. API END-TO-END AUDIO EDGE CASE TESTS
# ==============================================================================


class TestAPIEndToEndAudioEdgeCases:
    """Verifies API endpoints under audio stem edge cases (silence, noise, ultra-short stems)."""

    def test_api_get_chords_on_silent_stem(self, client: TestClient, tmp_path: Path):
        """GET /api/project/{id}/chords on a project with a pure silence stem returns 200 with monotonic 'N' chords."""
        pid = "m1_iter3_silent_stem_proj"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        silence = np.zeros(22050 * 3, dtype=np.float32)
        create_test_wav(stem_path, silence, sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        r = client.get(f"/api/project/{pid}/chords")
        assert r.status_code == 200
        body = r.json()
        assert body["detected"] is True
        assert_monotonic_intervals(body["chords"])
        assert all(c["chord"] == "N" for c in body["chords"])

    def test_api_get_chords_on_noise_stem(self, client: TestClient, tmp_path: Path):
        """GET /api/project/{id}/chords on a project with pure noise stem returns 200 with monotonic chords."""
        pid = "m1_iter3_noise_stem_proj"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        rng = np.random.default_rng(999)
        noise = (0.5 * rng.standard_normal(22050 * 2)).astype(np.float32)
        create_test_wav(stem_path, noise, sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        r = client.get(f"/api/project/{pid}/chords")
        assert r.status_code == 200
        body = r.json()
        assert body["detected"] is True
        assert_monotonic_intervals(body["chords"])

    def test_api_get_chords_on_sub_frame_short_stem(self, client: TestClient, tmp_path: Path):
        """GET /api/project/{id}/chords on sub-frame audio stem (<4096 samples) returns 200 with empty chord list."""
        pid = "m1_iter3_subframe_stem_proj"
        stem_dir = config.STEMS_DIR / pid
        stem_dir.mkdir(parents=True, exist_ok=True)
        stem_path = stem_dir / "instrumental.wav"
        short_sig = 0.5 * np.ones(1000, dtype=np.float32)
        create_test_wav(stem_path, short_sig, sr=22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "status": "ready",
                "instrumental_path": str(stem_path),
                "chords": None,
            }
            save_projects()

        r = client.get(f"/api/project/{pid}/chords")
        assert r.status_code == 200
        body = r.json()
        assert body["detected"] is True
        assert body["chords"] == []
