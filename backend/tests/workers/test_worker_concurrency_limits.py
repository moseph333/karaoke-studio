import os
import random
import subprocess
import threading
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.main import RenderRequest

DUMMY_LYRICS = {"source": "test", "synced": True, "lines": []}


class DummySoundfileInfo:
    format = "WAV"
    duration = 60.0


def _create_test_project(
    pid: str,
    status: str = "ready",
    render_status: str = "idle",
    with_instrumental: bool = True,
):
    inst_path = main_mod.STEMS_DIR / f"{pid}_instrumental.wav"
    vocals_path = main_mod.STEMS_DIR / f"{pid}_vocals.wav"
    audio_path = main_mod.DOWNLOADS_DIR / f"{pid}.wav"

    if with_instrumental:
        inst_path.write_bytes(b"RIFFmockinstrumental")
        vocals_path.write_bytes(b"RIFFmockvocals")
        audio_path.write_bytes(b"RIFFmockaudio")

    proj = {
        "id": pid,
        "track_id": pid,
        "title": f"Test Track {pid}",
        "artist": "Test Artist",
        "duration": 60.0,
        "status": status,
        "progress": 100 if status == "ready" else 0,
        "lines": [],
        "instrumental_path": str(inst_path),
        "vocals_path": str(vocals_path),
        "audio_path": str(audio_path),
        "render_status": render_status,
        "render_progress": 0,
    }
    main_mod.projects[pid] = proj
    main_mod.save_projects()
    return proj


def _setup_concurrency_mocks(monkeypatch, delay: float = 0.05):
    """Configures deterministic fast mocks for pipeline stages with optional execution delay."""

    def mock_download(url_or_id, **kwargs):
        if delay > 0:
            time.sleep(delay)
        vid = (
            main_mod.downloader.extract_video_id(url_or_id)
            or Path(url_or_id).name.replace("?", "_").replace("=", "_").replace("&", "_")
            or "track"
        )
        p = main_mod.DOWNLOADS_DIR / f"{vid}.wav"
        p.write_bytes(b"RIFFmockwav")
        return {
            "id": vid,
            "title": f"Title {vid}",
            "artist": "Artist",
            "audio_path": str(p),
            "duration": 60.0,
        }

    def mock_separate(*args, **kwargs):
        if delay > 0:
            time.sleep(delay)
        pid = (
            kwargs.get("track_id")
            or kwargs.get("project_id")
            or (args[1] if len(args) > 1 else "proj")
        )
        voc = main_mod.STEMS_DIR / f"{pid}_vocals.wav"
        inst = main_mod.STEMS_DIR / f"{pid}_instrumental.wav"
        voc.write_bytes(b"RIFFmockvoc")
        inst.write_bytes(b"RIFFmockinst")
        return {"vocals_path": str(voc), "instrumental_path": str(inst)}

    def mock_mix(*args, **kwargs):
        if delay > 0:
            time.sleep(delay)
        out_fn = kwargs.get("output_filename") or "master.wav"
        out_path = main_mod.OUTPUT_DIR / out_fn
        out_path.write_bytes(b"RIFFmockmaster")
        return str(out_path)

    def mock_generate_ass(*args, **kwargs):
        p = kwargs.get("output_ass_path") or (args[1] if len(args) > 1 else None)
        if p:
            Path(p).write_text("[Script Info]\nTitle: Test", encoding="utf-8")

    def mock_render(audio_path, ass_subtitles_path, output_mp4_path, **kwargs):
        if delay > 0:
            time.sleep(delay)
        Path(output_mp4_path).write_bytes(b"fake_mp4_video_data")
        return str(output_mp4_path)

    def mock_subp_run(cmd, *args, **kwargs):
        for arg in cmd:
            if str(arg).endswith(".wav"):
                p = Path(arg)
                p.parent.mkdir(parents=True, exist_ok=True)
                p.write_bytes(b"RIFFmockwav")
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)
    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate)
    monkeypatch.setattr(
        main_mod.lyrics_service, "fetch_lyrics", lambda *args, **kwargs: DUMMY_LYRICS
    )
    monkeypatch.setattr(
        main_mod.lyrics_service, "process_custom_lyrics", lambda *args, **kwargs: DUMMY_LYRICS
    )
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", lambda *args: [])
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", mock_mix)
    monkeypatch.setattr(main_mod.video_renderer, "generate_ass_subtitles", mock_generate_ass)
    monkeypatch.setattr(main_mod.video_renderer, "render_video", mock_render)
    monkeypatch.setattr(main_mod.sf, "info", lambda *args, **kwargs: DummySoundfileInfo())
    monkeypatch.setattr(main_mod.subprocess, "run", mock_subp_run)


# ============================================================================
# 1. CONCURRENCY CAP ENFORCEMENT UNDER BURST LOAD
# ============================================================================


def test_adversarial_concurrency_ceiling_mixed_burst(monkeypatch, tmp_path):
    """
    Stress test concurrency ceiling under burst load:
    - Semaphore cap N = 2
    - Launch M = 9 concurrent mixed tasks (3 YouTube, 3 local upload, 3 video render)
    - Concurrently probe active workers inside the critical section
    - Assert active executing count NEVER exceeds N at any point
    - Assert all excess jobs are queued (status == 'queued' or render_status == 'queued')
    - Assert all jobs eventually complete and semaphore returns to N
    """
    N = 2
    sem = threading.Semaphore(N)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    lock = threading.Lock()
    active_count = 0
    max_observed_active = 0
    violations = []

    # Intercept semaphore acquire and release to instrument exact active execution count
    orig_acquire = sem.acquire
    orig_release = sem.release

    def instrumented_acquire(*args, **kwargs):
        res = orig_acquire(*args, **kwargs)
        if res:
            nonlocal active_count, max_observed_active
            with lock:
                active_count += 1
                if active_count > max_observed_active:
                    max_observed_active = active_count
                if active_count > N:
                    violations.append(f"Active count {active_count} exceeded cap {N}!")
        return res

    def instrumented_release(*args, **kwargs):
        nonlocal active_count
        with lock:
            active_count -= 1
        return orig_release(*args, **kwargs)

    sem.acquire = instrumented_acquire
    sem.release = instrumented_release

    _setup_concurrency_mocks(monkeypatch, delay=0.04)

    # Prepare 9 tasks
    threads = []
    # 3 YouTube pipelines
    for i in range(1, 4):
        pid = f"yt_burst_{i}"
        _create_test_project(pid, status="queued", with_instrumental=False)
        t = threading.Thread(
            target=main_mod.run_pipeline,
            args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
        )
        threads.append(t)

    # 3 Local pipelines
    for i in range(1, 4):
        pid = f"loc_burst_{i}"
        wav_file = tmp_path / f"{pid}.wav"
        wav_file.write_bytes(b"RIFFmockwav")
        _create_test_project(pid, status="queued", with_instrumental=False)
        t = threading.Thread(
            target=main_mod.run_local_pipeline,
            args=(pid, str(wav_file), f"Title {pid}", "Artist"),
        )
        threads.append(t)

    # 3 Video renders
    for i in range(1, 4):
        pid = f"render_burst_{i}"
        _create_test_project(pid, status="ready", render_status="queued", with_instrumental=True)
        t = threading.Thread(
            target=main_mod.run_video_render,
            args=(pid, RenderRequest(aspect_ratio="16:9")),
        )
        threads.append(t)

    # Check while queued
    for pid in [f"yt_burst_{i}" for i in range(1, 4)] + [f"loc_burst_{i}" for i in range(1, 4)]:
        assert main_mod.projects[pid]["status"] == "queued"
    for pid in [f"render_burst_{i}" for i in range(1, 4)]:
        assert main_mod.projects[pid]["render_status"] == "queued"

    # Launch all 9 simultaneously
    for t in threads:
        t.start()

    # Wait for all to complete
    for t in threads:
        t.join(timeout=10)
        assert not t.is_alive(), "Worker thread hung or deadlocked!"

    assert len(violations) == 0, f"Concurrency violations detected: {violations}"
    assert max_observed_active == N, f"Expected peak active {N}, observed {max_observed_active}"

    # Verify all completed successfully
    for i in range(1, 4):
        assert main_mod.projects[f"yt_burst_{i}"]["status"] == "ready"
        assert main_mod.projects[f"loc_burst_{i}"]["status"] == "ready"
        assert main_mod.projects[f"render_burst_{i}"]["render_status"] == "completed"

    assert sem._value == N, f"Permit leak: semaphore value {sem._value} != {N}"


def test_adversarial_concurrency_ceiling_strict_serialization(monkeypatch):
    """
    When N = 1, assert strict serialization across multiple pipelines.
    At no point may 2 workers run in parallel.
    """
    N = 1
    sem = threading.Semaphore(N)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    lock = threading.Lock()
    active_count = 0
    max_observed = 0

    orig_acquire = sem.acquire
    orig_release = sem.release

    def instrumented_acquire(*args, **kwargs):
        res = orig_acquire(*args, **kwargs)
        if res:
            nonlocal active_count, max_observed
            with lock:
                active_count += 1
                max_observed = max(max_observed, active_count)
        return res

    def instrumented_release(*args, **kwargs):
        nonlocal active_count
        with lock:
            active_count -= 1
        return orig_release(*args, **kwargs)

    sem.acquire = instrumented_acquire
    sem.release = instrumented_release

    _setup_concurrency_mocks(monkeypatch, delay=0.03)

    threads = []
    for i in range(5):
        pid = f"serial_{i}"
        _create_test_project(pid, status="queued")
        t = threading.Thread(
            target=main_mod.run_pipeline,
            args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
        )
        threads.append(t)

    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert max_observed == 1, f"Strict serialization failed: max observed {max_observed}"
    assert sem._value == 1


# ============================================================================
# 2. PERMIT LEAK PREVENTION & ACCOUNTING (50-JOB STRESS MATRIX)
# ============================================================================


def test_adversarial_zero_permit_leak_50_job_stress_matrix(monkeypatch, tmp_path):
    """
    Stress test permit leak prevention across 50 simulated jobs:
    - 15 normal completions (YouTube, local, render)
    - 10 cancelled while queued
    - 10 cancelled while active
    - 5 deleted while queued
    - 5 deleted while active
    - 5 unexpected unhandled exceptions (RuntimeError, MemoryError, OSError, ValueError, KeyError)
    Assert exactly zero permit leaks: sem._value == initial_N after all 50 finish.
    """
    initial_N = 3
    sem = threading.Semaphore(initial_N)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.02)

    active_del_events = {}
    active_cancel_events = {}

    def custom_separate(*args, **kwargs):
        pid = kwargs.get("track_id") or kwargs.get("project_id") or "proj"
        # Check if this pid is supposed to be cancelled while active
        if pid in active_cancel_events:
            ev = main_mod.active_cancellations.get(pid)
            if ev:
                ev.set()
            time.sleep(0.01)
            raise RuntimeError("Processing cancelled by user")

        # Check if this pid is supposed to be deleted while active
        if pid in active_del_events:
            main_mod.delete_project(pid)
            time.sleep(0.01)
            raise RuntimeError("Project deleted during separation")

        voc = main_mod.STEMS_DIR / f"{pid}_vocals.wav"
        inst = main_mod.STEMS_DIR / f"{pid}_instrumental.wav"
        voc.write_bytes(b"RIFFvoc")
        inst.write_bytes(b"RIFFinst")
        return {"vocals_path": str(voc), "instrumental_path": str(inst)}

    def custom_download(url_or_id, **kwargs):
        if "crash_runtime" in url_or_id:
            raise RuntimeError("Injected Demucs runtime crash")
        if "crash_memory" in url_or_id:
            raise MemoryError("Injected GPU Out of Memory")
        if "crash_os" in url_or_id:
            raise OSError("Injected disk I/O failure")
        if "crash_value" in url_or_id:
            raise ValueError("Injected invalid sample rate")
        if "crash_key" in url_or_id:
            raise KeyError("Injected missing metadata key")

        vid = (
            main_mod.downloader.extract_video_id(url_or_id)
            or Path(url_or_id).name.replace("?", "_").replace("=", "_").replace("&", "_")
            or "track"
        )
        p = main_mod.DOWNLOADS_DIR / f"{vid}.wav"
        p.write_bytes(b"RIFFwav")
        return {
            "id": vid,
            "title": "Title",
            "artist": "Artist",
            "audio_path": str(p),
            "duration": 30.0,
        }

    monkeypatch.setattr(main_mod.separator, "separate_stems", custom_separate)
    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", custom_download)

    threads = []

    # Category 1: 15 normal jobs (5 YouTube, 5 Local, 5 Render)
    for i in range(5):
        pid = f"norm_yt_{i}"
        _create_test_project(pid, status="queued")
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )

    for i in range(5):
        pid = f"norm_loc_{i}"
        wav_file = tmp_path / f"{pid}.wav"
        wav_file.write_bytes(b"RIFFwav")
        _create_test_project(pid, status="queued")
        threads.append(
            threading.Thread(
                target=main_mod.run_local_pipeline,
                args=(pid, str(wav_file), "Title", "Artist"),
            )
        )

    for i in range(5):
        pid = f"norm_rnd_{i}"
        _create_test_project(pid, status="ready", render_status="queued")
        threads.append(
            threading.Thread(
                target=main_mod.run_video_render,
                args=(pid, RenderRequest(aspect_ratio="16:9")),
            )
        )

    # Category 2: 10 cancelled while queued
    for i in range(5):
        pid = f"queued_cancel_yt_{i}"
        _create_test_project(pid, status="queued")
        # Pre-set cancellation
        ev = main_mod.active_cancellations.setdefault(pid, threading.Event())
        ev.set()
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )

    for i in range(5):
        pid = f"queued_cancel_rnd_{i}"
        _create_test_project(pid, status="ready", render_status="queued")
        ev = main_mod.active_cancellations.setdefault(f"{pid}_render", threading.Event())
        ev.set()
        threads.append(
            threading.Thread(
                target=main_mod.run_video_render,
                args=(pid, RenderRequest(aspect_ratio="16:9")),
            )
        )

    # Category 3: 10 cancelled while active
    for i in range(10):
        pid = f"active_cancel_{i}"
        _create_test_project(pid, status="queued")
        active_cancel_events[pid] = True
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )

    # Category 4: 5 deleted while queued
    for i in range(5):
        pid = f"queued_del_{i}"
        _create_test_project(pid, status="queued")
        main_mod.delete_project(pid)
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )

    # Category 5: 5 deleted while active
    for i in range(5):
        pid = f"active_del_{i}"
        _create_test_project(pid, status="queued")
        active_del_events[pid] = True
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )

    # Category 6: 5 injected catastrophic exceptions
    crash_types = ["crash_runtime", "crash_memory", "crash_os", "crash_value", "crash_key"]
    for i, c_type in enumerate(crash_types):
        pid = f"crash_job_{i}"
        _create_test_project(pid, status="queued")
        threads.append(threading.Thread(target=main_mod.run_pipeline, args=(pid, c_type)))

    assert len(threads) == 50, f"Expected 50 threads, got {len(threads)}"

    # Shuffle execution order to simulate random production scheduling
    random.seed(42)
    random.shuffle(threads)

    # Launch all 50 threads
    for t in threads:
        t.start()

    # Join all threads with timeout
    for t in threads:
        t.join(timeout=15)
        assert not t.is_alive(), "Worker thread hung during 50-job stress test!"

    # Strict permit accounting check
    assert sem._value == initial_N, (
        f"Permit leak detected! Initial {initial_N}, final {sem._value} (drift={sem._value - initial_N})"
    )


# ============================================================================
# 3. CANCELLATION WHILE QUEUED (MULTI-JOB QUEUE HANDOFF)
# ============================================================================


def test_adversarial_cancellation_while_queued_pipeline_fast_abort(monkeypatch):
    """
    Queue multiple jobs behind a blocking job.
    Cancel queued jobs before they acquire the semaphore.
    Verify queued jobs wake up, detect cancellation, set status to 'cancelled',
    exit immediately without running heavy pipeline steps, and release the permit.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    blocker_started = threading.Event()
    blocker_release = threading.Event()
    downstream_compute_called = threading.Event()

    def mock_download(url_or_id, **kwargs):
        if url_or_id == "blocker_track":
            blocker_started.set()
            blocker_release.wait(timeout=5)
            p = main_mod.DOWNLOADS_DIR / "blocker_track.wav"
            p.write_bytes(b"RIFFblocker")
            return {
                "id": "blocker_track",
                "title": "Blocker",
                "artist": "Artist",
                "audio_path": str(p),
                "duration": 30.0,
            }
        downstream_compute_called.set()
        raise RuntimeError(f"Downstream compute called for cancelled job {url_or_id}!")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)

    # 1 Blocker job
    _create_test_project("blocker_track", status="queued")
    t_blocker = threading.Thread(
        target=main_mod.run_pipeline, args=("blocker_track", "blocker_track")
    )
    t_blocker.start()

    assert blocker_started.wait(timeout=5), "Blocker failed to start"

    # Queue 3 YouTube pipeline jobs behind the blocker
    queued_pids = ["q_yt_1", "q_yt_2", "q_yt_3"]
    q_threads = []
    for pid in queued_pids:
        _create_test_project(pid, status="queued")
        t = threading.Thread(target=main_mod.run_pipeline, args=(pid, pid))
        q_threads.append(t)
        t.start()

    time.sleep(0.1)
    # Assert all 3 are currently queued
    for pid in queued_pids:
        assert main_mod.projects[pid]["status"] == "queued"

    # Cancel all 3 queued jobs via cancel_project
    for pid in queued_pids:
        res = main_mod.cancel_project(pid)
        assert res["status"] == "ok"
        assert main_mod.projects[pid]["status"] == "cancelled"

    # Release the blocker
    blocker_release.set()
    t_blocker.join(timeout=5)
    for t in q_threads:
        t.join(timeout=5)

    assert not downstream_compute_called.is_set(), "Cancelled queued jobs must not execute compute!"
    for pid in queued_pids:
        assert main_mod.projects[pid]["status"] == "cancelled"
    assert sem._value == 1, "Permit was not restored to 1!"


def test_adversarial_cancellation_while_queued_render_fast_abort(monkeypatch):
    """
    Queue multiple render jobs behind a blocking render.
    Cancel queued renders before they acquire the semaphore.
    Verify they exit immediately with render_status 'idle' without executing FFmpeg.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    blocker_started = threading.Event()
    blocker_release = threading.Event()
    ffmpeg_called_for_cancelled = threading.Event()

    def mock_render(audio_path, ass_subtitles_path, output_mp4_path, **kwargs):
        if "r_blocker" in str(output_mp4_path):
            blocker_started.set()
            blocker_release.wait(timeout=5)
            Path(output_mp4_path).write_bytes(b"mp4")
            return str(output_mp4_path)
        ffmpeg_called_for_cancelled.set()
        raise RuntimeError("FFmpeg called for cancelled render!")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", mock_render)

    _create_test_project("r_blocker", status="ready", render_status="queued")
    t_blocker = threading.Thread(
        target=main_mod.run_video_render,
        args=("r_blocker", RenderRequest(aspect_ratio="16:9")),
    )
    t_blocker.start()
    assert blocker_started.wait(timeout=5)

    queued_rids = ["r_queued_1", "r_queued_2"]
    q_threads = []
    for rid in queued_rids:
        _create_test_project(rid, status="ready", render_status="queued")
        t = threading.Thread(
            target=main_mod.run_video_render,
            args=(rid, RenderRequest(aspect_ratio="16:9")),
        )
        q_threads.append(t)
        t.start()

    time.sleep(0.1)
    for rid in queued_rids:
        assert main_mod.projects[rid]["render_status"] == "queued"

    # Cancel both renders while queued
    for rid in queued_rids:
        res = main_mod.cancel_render(rid)
        assert res["status"] == "ok"
        assert main_mod.projects[rid]["render_status"] == "idle"

    # Unblock blocker
    blocker_release.set()
    t_blocker.join(timeout=5)
    for t in q_threads:
        t.join(timeout=5)

    assert not ffmpeg_called_for_cancelled.is_set(), "FFmpeg called for cancelled render!"
    for rid in queued_rids:
        assert main_mod.projects[rid]["render_status"] == "idle"
    assert sem._value == 1


def test_adversarial_cancellation_handoff_to_subsequent_valid_job(monkeypatch):
    """
    Queue: Job 1 (active) -> Job 2 (queued, cancelled) -> Job 3 (queued, valid).
    When Job 1 finishes, Job 2 wakes up, cancels cleanly, and hands permit to Job 3.
    Job 3 must run to completion ('ready') without deadlocking.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    j1_started = threading.Event()
    j1_release = threading.Event()
    j3_completed = threading.Event()

    def mock_download(url_or_id, **kwargs):
        if url_or_id == "j1":
            j1_started.set()
            j1_release.wait(timeout=5)
        elif url_or_id == "j2":
            raise RuntimeError("Job 2 should not download!")
        elif url_or_id == "j3":
            j3_completed.set()
        p = main_mod.DOWNLOADS_DIR / f"{url_or_id}.wav"
        p.write_bytes(b"RIFFwav")
        return {
            "id": url_or_id,
            "title": url_or_id,
            "artist": "Artist",
            "audio_path": str(p),
            "duration": 30.0,
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)

    _create_test_project("j1", status="queued")
    _create_test_project("j2", status="queued")
    _create_test_project("j3", status="queued")

    t1 = threading.Thread(target=main_mod.run_pipeline, args=("j1", "j1"))
    t2 = threading.Thread(target=main_mod.run_pipeline, args=("j2", "j2"))
    t3 = threading.Thread(target=main_mod.run_pipeline, args=("j3", "j3"))

    t1.start()
    assert j1_started.wait(timeout=5)

    t2.start()
    t3.start()
    time.sleep(0.1)

    assert main_mod.projects["j2"]["status"] == "queued"
    assert main_mod.projects["j3"]["status"] == "queued"

    # Cancel j2 while queued
    main_mod.cancel_project("j2")
    assert main_mod.projects["j2"]["status"] == "cancelled"

    # Release j1
    j1_release.set()

    t1.join(timeout=5)
    t2.join(timeout=5)
    t3.join(timeout=5)

    assert j3_completed.is_set(), "Job 3 failed to acquire semaphore after Job 2 cancelled!"
    assert main_mod.projects["j1"]["status"] == "ready"
    assert main_mod.projects["j2"]["status"] == "cancelled"
    assert main_mod.projects["j3"]["status"] == "ready"
    assert sem._value == 1


# ============================================================================
# 4. DELETION WHILE QUEUED (CLEAN ABORT & NO GHOST RESURRECTION)
# ============================================================================


def test_adversarial_project_deletion_while_queued_pipeline(monkeypatch):
    """
    Queue a project behind a blocking job.
    Delete the project (DELETE /api/project/{id}) while it is waiting in the queue.
    When the semaphore frees, the worker must wake up, observe project deletion,
    abort cleanly without re-creating project entries, and release the permit.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    b_started = threading.Event()
    b_release = threading.Event()
    download_called_for_deleted = threading.Event()

    def mock_download(url_or_id, **kwargs):
        if url_or_id == "b_proj":
            b_started.set()
            b_release.wait(timeout=5)
            p = main_mod.DOWNLOADS_DIR / "b_proj.wav"
            p.write_bytes(b"RIFFwav")
            return {
                "id": url_or_id,
                "title": "B",
                "artist": "A",
                "audio_path": str(p),
                "duration": 30.0,
            }
        download_called_for_deleted.set()
        raise RuntimeError("Download called for deleted project!")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)

    _create_test_project("b_proj", status="queued")
    _create_test_project("del_queued_proj", status="queued")

    tb = threading.Thread(target=main_mod.run_pipeline, args=("b_proj", "b_proj"))
    td = threading.Thread(target=main_mod.run_pipeline, args=("del_queued_proj", "del_queued_proj"))

    tb.start()
    assert b_started.wait(timeout=5)

    td.start()
    time.sleep(0.1)
    assert main_mod.projects["del_queued_proj"]["status"] == "queued"

    # Delete project via API while queued
    del_res = main_mod.delete_project("del_queued_proj")
    assert del_res["status"] == "deleted"
    assert "del_queued_proj" not in main_mod.projects

    # Release blocker
    b_release.set()
    tb.join(timeout=5)
    td.join(timeout=5)

    assert not download_called_for_deleted.is_set()
    # Critical: ghost resurrection check
    assert "del_queued_proj" not in main_mod.projects, (
        "Project was resurrected in memory after deletion!"
    )
    disk_store = main_mod.load_projects()
    assert "del_queued_proj" not in disk_store, (
        "Project was resurrected in projects.json after deletion!"
    )
    assert sem._value == 1


def test_adversarial_project_deletion_while_queued_render(monkeypatch):
    """
    Queue a render job behind a blocker, delete the project, verify clean render abort
    with zero ghost resurrection.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    b_started = threading.Event()
    b_release = threading.Event()

    def mock_render(audio_path, ass_subtitles_path, output_mp4_path, **kwargs):
        b_started.set()
        b_release.wait(timeout=5)
        Path(output_mp4_path).write_bytes(b"mp4")
        return str(output_mp4_path)

    monkeypatch.setattr(main_mod.video_renderer, "render_video", mock_render)

    _create_test_project("r_blocker2", status="ready", render_status="queued")
    _create_test_project("r_del_queued", status="ready", render_status="queued")

    tb = threading.Thread(
        target=main_mod.run_video_render,
        args=("r_blocker2", RenderRequest(aspect_ratio="16:9")),
    )
    td = threading.Thread(
        target=main_mod.run_video_render,
        args=("r_del_queued", RenderRequest(aspect_ratio="16:9")),
    )

    tb.start()
    assert b_started.wait(timeout=5)

    td.start()
    time.sleep(0.1)

    # Delete project r_del_queued
    main_mod.delete_project("r_del_queued")
    assert "r_del_queued" not in main_mod.projects

    b_release.set()
    tb.join(timeout=5)
    td.join(timeout=5)

    assert "r_del_queued" not in main_mod.projects
    assert sem._value == 1


# ============================================================================
# 5. EXCEPTION SAFETY & DEADLOCK RESISTANCE UNDER INJECTED FAULTS
# ============================================================================


@pytest.mark.parametrize(
    "injected_exception,expected_msg",
    [
        (OSError("Disk full: no space left on device [Errno 28]"), "Disk full"),
        (MemoryError("CUDA out of memory: tried to allocate 2.00 GiB"), "CUDA out of memory"),
        (RuntimeError("Demucs subprocess segfaulted with exit status -11"), "Demucs subprocess"),
        (ConnectionResetError("Peer closed TCP connection unexpectedly"), "Peer closed"),
    ],
)
def test_adversarial_injected_catastrophic_exceptions_in_pipeline(
    monkeypatch, injected_exception, expected_msg
):
    """
    Inject severe system exceptions into the heavy compute section.
    Assert:
    - Status is cleanly marked as 'error'
    - Error message is preserved in status_detail
    - Permit is 100% recovered in finally block
    - Waiting queued jobs can immediately acquire and run without deadlock
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    def mock_failing_download(*args, **kwargs):
        raise injected_exception

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_failing_download)

    pid_fail = "fault_job"
    pid_next = "next_job"
    _create_test_project(pid_fail, status="queued")
    _create_test_project(pid_next, status="queued")

    # Run failing job
    main_mod.run_pipeline(pid_fail, "fault_track")

    assert main_mod.projects[pid_fail]["status"] == "error"
    assert expected_msg in main_mod.projects[pid_fail]["status_detail"]
    assert sem._value == 1, "Permit must be released on catastrophic exception!"

    # Now verify next job runs to completion without deadlock
    def mock_good_download(url_or_id, **kwargs):
        p = main_mod.DOWNLOADS_DIR / f"{url_or_id}.wav"
        p.write_bytes(b"RIFFwav")
        return {
            "id": url_or_id,
            "title": "Good",
            "artist": "Artist",
            "audio_path": str(p),
            "duration": 30.0,
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_good_download)
    main_mod.run_pipeline(pid_next, "good_track")

    assert main_mod.projects[pid_next]["status"] == "ready"
    assert sem._value == 1


def test_adversarial_injected_exception_in_video_render(monkeypatch):
    """
    Inject exception in video_renderer.render_video.
    Assert render_status is 'error' and permit is released.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    def mock_bad_render(*args, **kwargs):
        raise RuntimeError("FFmpeg encoding crashed with exit code 1")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", mock_bad_render)

    pid = "rnd_crash"
    _create_test_project(pid, status="ready", render_status="queued")

    main_mod.run_video_render(pid, RenderRequest(aspect_ratio="16:9"))

    assert main_mod.projects[pid]["render_status"] == "error"
    assert "FFmpeg encoding crashed" in main_mod.projects[pid]["render_detail"]
    assert sem._value == 1


# ============================================================================
# 6. FASTAPI TESTCLIENT FULL API INTEGRATION (QUEUE & CANCEL OVER HTTP)
# ============================================================================


def test_adversarial_api_concurrency_and_cancellation_flow(client: TestClient, monkeypatch):
    """
    Verify end-to-end HTTP route behavior:
    1. POST /api/process returns 200 with status='queued'
    2. Concurrent POST /api/process for second URL stays queued
    3. POST /api/project/{id}/cancel marks project cancelled immediately
    4. Permit is cleanly freed and remaining jobs finish
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    job1_active = threading.Event()
    job1_proceed = threading.Event()

    def mock_download(url_or_id, **kwargs):
        vid = main_mod.downloader.extract_video_id(url_or_id) or "vid"
        if "12345678901" in vid:
            job1_active.set()
            job1_proceed.wait(timeout=5)
        p = main_mod.DOWNLOADS_DIR / f"{vid}.wav"
        p.write_bytes(b"RIFFwav")
        return {
            "id": vid,
            "title": f"Title {vid}",
            "artist": "Artist",
            "audio_path": str(p),
            "duration": 30.0,
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)

    # Submit Job 1 in background thread because Starlette TestClient awaits BackgroundTasks synchronously
    t1 = threading.Thread(
        target=lambda: client.post(
            "/api/process",
            json={"url_or_id": "https://www.youtube.com/watch?v=12345678901"},
        )
    )
    t1.start()

    assert job1_active.wait(timeout=5), "Job 1 failed to become active"
    assert sem._value == 0, "Job 1 must hold the semaphore permit"

    # Submit Job 2 in second background thread; it will enter queue and block on semaphore
    t2 = threading.Thread(
        target=lambda: client.post(
            "/api/process",
            json={"url_or_id": "https://www.youtube.com/watch?v=12345678902"},
        )
    )
    t2.start()

    # Poll Job 2 status via GET /api/project/{id} - must be 'queued'
    p2_id = "12345678902"
    poll_start = time.time()
    while time.time() - poll_start < 3.0:
        get2 = client.get(f"/api/project/{p2_id}")
        if get2.status_code == 200 and get2.json().get("status") == "queued":
            break
        time.sleep(0.05)

    assert get2.status_code == 200
    assert get2.json()["status"] == "queued"

    # Cancel Job 2 via API while it is queued
    cancel_res = client.post(f"/api/project/{p2_id}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "ok"

    get2_after = client.get(f"/api/project/{p2_id}")
    assert get2_after.json()["status"] == "cancelled"

    # Unblock Job 1
    job1_proceed.set()

    t1.join(timeout=5)
    t2.join(timeout=5)

    get1 = client.get("/api/project/12345678901")
    assert get1.json()["status"] == "ready"
    get2_final = client.get("/api/project/12345678902")
    assert get2_final.json()["status"] == "cancelled"
    assert sem._value == 1


# ============================================================================
# 7. ADDITIONAL ADVERSARIAL STRESS: LOCAL PIPELINE & MEMORY LEAK PREVENTION
# ============================================================================


def test_adversarial_cancellation_while_queued_local_pipeline(monkeypatch, tmp_path):
    """
    Queue multiple local audio upload tasks behind a blocking job.
    Cancel the queued local jobs before they acquire the semaphore.
    Verify clean cancellation, zero heavy processing (transcode/Demucs), and permit restoration.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    blocker_started = threading.Event()
    blocker_release = threading.Event()
    local_demucs_called = threading.Event()

    def mock_download(url_or_id, **kwargs):
        blocker_started.set()
        blocker_release.wait(timeout=5)
        p = main_mod.DOWNLOADS_DIR / "blocker.wav"
        p.write_bytes(b"RIFFblocker")
        return {
            "id": "blocker",
            "title": "Blocker",
            "artist": "Artist",
            "audio_path": str(p),
            "duration": 30.0,
        }

    def mock_separate(*args, **kwargs):
        pid = kwargs.get("track_id") or kwargs.get("project_id") or ""
        if "loc_q_" in pid:
            local_demucs_called.set()
            raise RuntimeError("Demucs must not run for cancelled local job!")
        return {
            "vocals_path": str(main_mod.STEMS_DIR / "v.wav"),
            "instrumental_path": str(main_mod.STEMS_DIR / "i.wav"),
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)
    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate)

    _create_test_project("loc_blocker", status="queued")
    t_blocker = threading.Thread(target=main_mod.run_pipeline, args=("loc_blocker", "loc_blocker"))
    t_blocker.start()
    assert blocker_started.wait(timeout=5)

    q_threads = []
    queued_pids = ["loc_q_1", "loc_q_2"]
    for pid in queued_pids:
        wav_file = tmp_path / f"{pid}.wav"
        wav_file.write_bytes(b"RIFFwav")
        _create_test_project(pid, status="queued")
        t = threading.Thread(
            target=main_mod.run_local_pipeline,
            args=(pid, str(wav_file), f"Title {pid}", "Artist"),
        )
        q_threads.append(t)
        t.start()

    time.sleep(0.1)
    for pid in queued_pids:
        assert main_mod.projects[pid]["status"] == "queued"

    # Cancel queued local jobs
    for pid in queued_pids:
        res = main_mod.cancel_project(pid)
        assert res["status"] == "ok"
        assert main_mod.projects[pid]["status"] == "cancelled"

    # Unblock blocker
    blocker_release.set()
    t_blocker.join(timeout=5)
    for t in q_threads:
        t.join(timeout=5)

    assert not local_demucs_called.is_set(), "Demucs was called for cancelled local job!"
    for pid in queued_pids:
        assert main_mod.projects[pid]["status"] == "cancelled"
    assert sem._value == 1


def test_adversarial_project_deletion_while_queued_local_pipeline(monkeypatch, tmp_path):
    """
    Queue local audio job behind blocker, delete project, verify clean abort and no ghost entry.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.0)

    b_started = threading.Event()
    b_release = threading.Event()

    def mock_download(url_or_id, **kwargs):
        b_started.set()
        b_release.wait(timeout=5)
        p = main_mod.DOWNLOADS_DIR / "b.wav"
        p.write_bytes(b"RIFFb")
        return {"id": "b", "title": "B", "artist": "A", "audio_path": str(p), "duration": 30.0}

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)

    _create_test_project("b_local", status="queued")
    _create_test_project("del_queued_local", status="queued")

    wav_file = tmp_path / "del_queued_local.wav"
    wav_file.write_bytes(b"RIFFwav")

    tb = threading.Thread(target=main_mod.run_pipeline, args=("b_local", "b_local"))
    td = threading.Thread(
        target=main_mod.run_local_pipeline,
        args=("del_queued_local", str(wav_file), "Title", "Artist"),
    )

    tb.start()
    assert b_started.wait(timeout=5)

    td.start()
    time.sleep(0.1)
    assert main_mod.projects["del_queued_local"]["status"] == "queued"

    main_mod.delete_project("del_queued_local")
    assert "del_queued_local" not in main_mod.projects

    b_release.set()
    tb.join(timeout=5)
    td.join(timeout=5)

    assert "del_queued_local" not in main_mod.projects
    assert sem._value == 1


def test_adversarial_active_cancellations_zero_leak(monkeypatch, tmp_path):
    """
    Assert active_cancellations dictionary has ZERO memory leaks across
    completions, cancellations, deletions, and exceptions.
    """
    sem = threading.Semaphore(2)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.01)

    threads = []
    # 5 normal
    for i in range(5):
        pid = f"mem_norm_{i}"
        _create_test_project(pid, status="queued")
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )
    # 5 cancelled while queued
    for i in range(5):
        pid = f"mem_cancel_{i}"
        _create_test_project(pid, status="queued")
        ev = main_mod.active_cancellations.setdefault(pid, threading.Event())
        ev.set()
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )
    # 5 deleted while queued
    for i in range(5):
        pid = f"mem_del_{i}"
        _create_test_project(pid, status="queued")
        main_mod.delete_project(pid)
        threads.append(
            threading.Thread(
                target=main_mod.run_pipeline,
                args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
            )
        )

    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    # Assert active_cancellations has cleaned up all finished projects
    assert len(main_mod.active_cancellations) == 0, (
        f"active_cancellations leaked entries: {list(main_mod.active_cancellations.keys())}"
    )
    assert sem._value == 2


def test_adversarial_multi_round_burst_stability(monkeypatch, tmp_path):
    """
    Stress test multi-round bursts (3 waves of 10 concurrent jobs).
    Verify semaphore stability and zero permit drift across consecutive waves.
    """
    N = 2
    sem = threading.Semaphore(N)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    _setup_concurrency_mocks(monkeypatch, delay=0.01)

    for round_idx in range(3):
        threads = []
        for i in range(10):
            pid = f"burst_r{round_idx}_{i}"
            _create_test_project(pid, status="queued")
            threads.append(
                threading.Thread(
                    target=main_mod.run_pipeline,
                    args=(pid, f"https://www.youtube.com/watch?v=1234567890{i}"),
                )
            )
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=10)

        assert sem._value == N, (
            f"Permit drift in wave {round_idx}: semaphore value {sem._value} != {N}"
        )
        assert len(main_mod.active_cancellations) == 0
