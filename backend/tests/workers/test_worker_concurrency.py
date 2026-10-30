import os
import subprocess
import threading
import time
from pathlib import Path

import pytest

import backend.main as main_mod
from backend.main import RenderRequest

DUMMY_LYRICS = {"source": "test", "synced": True, "lines": []}


class DummySoundfileInfo:
    format = "WAV"
    duration = 60.0


def _make_dummy_project(
    pid: str,
    status: str = "ready",
    render_status: str = "idle",
    with_instrumental: bool = True,
):
    inst_path = main_mod.STEMS_DIR / f"{pid}_instrumental.wav"
    if with_instrumental:
        inst_path.write_bytes(b"RIFFdummyinstrumentaldata")
    proj = {
        "id": pid,
        "track_id": pid,
        "title": f"Song {pid}",
        "artist": "Artist",
        "duration": 60.0,
        "status": status,
        "progress": 100 if status == "ready" else 0,
        "lines": [],
        "instrumental_path": str(inst_path),
        "vocals_path": str(main_mod.STEMS_DIR / f"{pid}_vocals.wav"),
        "render_status": render_status,
        "render_progress": 0,
    }
    main_mod.projects[pid] = proj
    main_mod.save_projects()
    return proj


def mock_generate_ass(*args, **kwargs):
    p = kwargs.get("output_ass_path") or (args[1] if len(args) > 1 else None)
    if p:
        Path(p).write_text("[Script Info]", encoding="utf-8")


def mock_separate_stems(*args, **kwargs):
    pid = kwargs.get("project_id") or (args[1] if len(args) > 1 else "proj")
    return {
        "vocals_path": str(main_mod.STEMS_DIR / f"{pid}_vocals.wav"),
        "instrumental_path": str(main_mod.STEMS_DIR / f"{pid}_instrumental.wav"),
    }


def test_config_max_concurrent_jobs_parsing(monkeypatch):
    # Valid positive integer
    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "4")
    val = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2").strip()))
    assert val == 4

    # Clamped to 1 if negative or 0
    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "0")
    val = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2").strip()))
    assert val == 1

    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "-3")
    val = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2").strip()))
    assert val == 1

    # Fallback to default 2 if non-numeric
    monkeypatch.setenv("MAX_CONCURRENT_JOBS", "invalid_value")
    try:
        val = max(1, int(os.getenv("MAX_CONCURRENT_JOBS", "2").strip()))
    except (ValueError, TypeError):
        val = 2
    assert val == 2


def test_pipeline_concurrency_bounding_excess_queued(monkeypatch):
    """
    When MAX_CONCURRENT_JOBS is 1, a second pipeline job remains in 'queued' status
    until the first finishes, then runs to completion without deadlock.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    job1_started = threading.Event()
    job1_release = threading.Event()
    job2_started = threading.Event()

    def mock_download(url_or_id, output_dir=None, progress_hook=None):
        if url_or_id == "url1":
            job1_started.set()
            job1_release.wait(timeout=5)
        elif url_or_id == "url2":
            job2_started.set()
        return {
            "id": url_or_id,
            "title": f"Title {url_or_id}",
            "artist": "Artist",
            "audio_path": str(main_mod.DOWNLOADS_DIR / f"{url_or_id}.wav"),
            "duration": 60,
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)
    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate_stems)
    monkeypatch.setattr(
        main_mod.lyrics_service, "fetch_lyrics", lambda *args, **kwargs: DUMMY_LYRICS
    )
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", lambda audio_path, lyrics: [])
    monkeypatch.setattr(
        main_mod.audio_mixer,
        "mix_and_shift",
        lambda instrumental_path, vocals_path, semitones=0, guide_volume=0.0, output_filename=None: (
            str(main_mod.OUTPUT_DIR / (output_filename or "master.wav"))
        ),
    )

    _make_dummy_project("p1", status="queued", with_instrumental=False)
    _make_dummy_project("p2", status="queued", with_instrumental=False)

    t1 = threading.Thread(target=main_mod.run_pipeline, args=("p1", "url1"))
    t2 = threading.Thread(target=main_mod.run_pipeline, args=("p2", "url2"))

    t1.start()
    assert job1_started.wait(timeout=5), "Job 1 failed to start"
    assert main_mod.projects["p1"]["status"] == "downloading"
    assert sem._value == 0

    t2.start()
    time.sleep(0.1)
    # Job 2 must remain queued while Job 1 holds the permit
    assert main_mod.projects["p2"]["status"] == "queued"
    assert not job2_started.is_set()

    # Unblock Job 1
    job1_release.set()
    t1.join(timeout=5)
    assert main_mod.projects["p1"]["status"] == "ready"

    # Job 2 should now acquire and finish
    assert job2_started.wait(timeout=5), "Job 2 failed to acquire worker slot"
    t2.join(timeout=5)
    assert main_mod.projects["p2"]["status"] == "ready"
    assert sem._value == 1


def test_render_concurrency_bounding_excess_queued(monkeypatch):
    """
    Video render tasks are guarded by WORKER_SEMAPHORE. Excess jobs remain in
    render_status 'queued' until active render releases the permit.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    render1_started = threading.Event()
    render1_release = threading.Event()
    render2_started = threading.Event()

    def mock_render(audio_path, ass_subtitles_path, output_mp4_path, **kwargs):
        if "r1" in str(output_mp4_path):
            render1_started.set()
            render1_release.wait(timeout=5)
        elif "r2" in str(output_mp4_path):
            render2_started.set()
        Path(output_mp4_path).write_bytes(b"dummy_mp4")
        return str(output_mp4_path)

    monkeypatch.setattr(main_mod.video_renderer, "generate_ass_subtitles", mock_generate_ass)
    monkeypatch.setattr(
        main_mod.audio_mixer,
        "mix_and_shift",
        lambda instrumental_path, vocals_path=None, semitones=0, guide_volume=0.0, output_filename=None: (
            str(main_mod.OUTPUT_DIR / (output_filename or "mixed.wav"))
        ),
    )
    monkeypatch.setattr(main_mod.video_renderer, "render_video", mock_render)

    _make_dummy_project("r1", status="ready", render_status="queued", with_instrumental=True)
    _make_dummy_project("r2", status="ready", render_status="queued", with_instrumental=True)

    req = RenderRequest()
    t1 = threading.Thread(target=main_mod.run_video_render, args=("r1", req))
    t2 = threading.Thread(target=main_mod.run_video_render, args=("r2", req))

    t1.start()
    assert render1_started.wait(timeout=5)
    assert main_mod.projects["r1"]["render_status"] == "rendering"
    assert sem._value == 0

    t2.start()
    time.sleep(0.1)
    # Render 2 must wait in queue
    assert main_mod.projects["r2"]["render_status"] == "queued"
    assert not render2_started.is_set()

    # Release Render 1
    render1_release.set()
    t1.join(timeout=5)
    assert main_mod.projects["r1"]["render_status"] == "completed"

    # Render 2 acquires permit and completes
    assert render2_started.wait(timeout=5)
    t2.join(timeout=5)
    assert main_mod.projects["r2"]["render_status"] == "completed"
    assert sem._value == 1


def test_cancellation_while_queued_pipeline(monkeypatch):
    """
    A pipeline job cancelled while queued aborts without running Demucs/Whisper,
    updates status to 'cancelled', and cleanly releases its semaphore permit.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    job1_started = threading.Event()
    job1_release = threading.Event()
    job2_download_called = threading.Event()

    def mock_download(url_or_id, **kwargs):
        if url_or_id == "url1":
            job1_started.set()
            job1_release.wait(timeout=5)
            return {
                "id": url_or_id,
                "title": "Song 1",
                "artist": "Artist",
                "audio_path": str(main_mod.DOWNLOADS_DIR / "url1.wav"),
                "duration": 60,
            }
        job2_download_called.set()
        raise RuntimeError("Job 2 should not execute heavy compute!")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)
    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate_stems)
    monkeypatch.setattr(
        main_mod.lyrics_service, "fetch_lyrics", lambda *args, **kwargs: DUMMY_LYRICS
    )
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", lambda *args: [])
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda *args, **kwargs: "m.wav")

    _make_dummy_project("p1", status="queued")
    _make_dummy_project("p2", status="queued")

    t1 = threading.Thread(target=main_mod.run_pipeline, args=("p1", "url1"))
    t2 = threading.Thread(target=main_mod.run_pipeline, args=("p2", "url2"))

    t1.start()
    assert job1_started.wait(timeout=5)

    t2.start()
    time.sleep(0.1)
    assert main_mod.projects["p2"]["status"] == "queued"

    # Cancel p2 while queued
    main_mod.cancel_project("p2")

    # Release Job 1
    job1_release.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert not job2_download_called.is_set(), "Cancelled queued job must not execute compute"
    assert main_mod.projects["p2"]["status"] == "cancelled"
    assert sem._value == 1


def test_cancellation_while_queued_render(monkeypatch):
    """
    A video render cancelled while queued exits cleanly, sets render_status to 'idle',
    and releases the semaphore permit without executing FFmpeg.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    render1_started = threading.Event()
    render1_release = threading.Event()
    render2_ffmpeg_called = threading.Event()

    def mock_render(audio_path, ass_subtitles_path, output_mp4_path, **kwargs):
        if "r1" in str(output_mp4_path):
            render1_started.set()
            render1_release.wait(timeout=5)
            Path(output_mp4_path).write_bytes(b"dummy")
            return str(output_mp4_path)
        render2_ffmpeg_called.set()
        raise RuntimeError("Render 2 should not execute FFmpeg!")

    monkeypatch.setattr(main_mod.video_renderer, "generate_ass_subtitles", mock_generate_ass)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda *args, **kwargs: "m.wav")
    monkeypatch.setattr(main_mod.video_renderer, "render_video", mock_render)

    _make_dummy_project("r1", status="ready", render_status="queued")
    _make_dummy_project("r2", status="ready", render_status="queued")

    req = RenderRequest()
    t1 = threading.Thread(target=main_mod.run_video_render, args=("r1", req))
    t2 = threading.Thread(target=main_mod.run_video_render, args=("r2", req))

    t1.start()
    assert render1_started.wait(timeout=5)

    t2.start()
    time.sleep(0.1)
    assert main_mod.projects["r2"]["render_status"] == "queued"

    # Cancel render 2 while queued
    main_mod.cancel_render("r2")

    # Release Render 1
    render1_release.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert not render2_ffmpeg_called.is_set()
    assert main_mod.projects["r2"]["render_status"] == "idle"
    assert sem._value == 1


def test_delete_project_while_queued(monkeypatch):
    """
    Deleting a project while queued unblocks gracefully, removes it from state,
    and restores available semaphore permits.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    job1_started = threading.Event()
    job1_release = threading.Event()

    def mock_download(url_or_id, **kwargs):
        job1_started.set()
        job1_release.wait(timeout=5)
        return {
            "id": url_or_id,
            "title": "Song 1",
            "artist": "Artist",
            "audio_path": str(main_mod.DOWNLOADS_DIR / "url1.wav"),
            "duration": 60,
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)
    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate_stems)
    monkeypatch.setattr(
        main_mod.lyrics_service, "fetch_lyrics", lambda *args, **kwargs: DUMMY_LYRICS
    )
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", lambda *args: [])
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda *args, **kwargs: "m.wav")

    _make_dummy_project("p1", status="queued")
    _make_dummy_project("p2", status="queued")

    t1 = threading.Thread(target=main_mod.run_pipeline, args=("p1", "url1"))
    t2 = threading.Thread(target=main_mod.run_pipeline, args=("p2", "url2"))

    t1.start()
    assert job1_started.wait(timeout=5)

    t2.start()
    time.sleep(0.1)
    assert main_mod.projects["p2"]["status"] == "queued"

    # Delete p2 while queued
    main_mod.delete_project("p2")
    assert "p2" not in main_mod.projects

    # Release Job 1
    job1_release.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert "p2" not in main_mod.projects
    assert sem._value == 1


def test_unhandled_exception_releases_semaphore(monkeypatch):
    """
    If an unexpected exception occurs inside a worker task, the semaphore permit
    is guaranteed released in the finally block.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    def mock_crash(*args, **kwargs):
        raise RuntimeError("Unexpected internal crash")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_crash)

    _make_dummy_project("p_crash", status="queued")

    main_mod.run_pipeline("p_crash", "url_crash")

    assert main_mod.projects["p_crash"]["status"] == "error"
    assert sem._value == 1, "Permit must be released on unhandled exception"


def test_local_pipeline_concurrency_and_cancellation(monkeypatch, tmp_path):
    """
    Local audio pipeline tasks transition to 'processing' upon semaphore acquisition,
    and cleanly cancel when cancelled while queued.
    """
    sem = threading.Semaphore(1)
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", sem)

    local1_started = threading.Event()
    local1_release = threading.Event()

    def mock_separate(*args, **kwargs):
        pid = (
            kwargs.get("track_id")
            or kwargs.get("project_id")
            or (args[1] if len(args) > 1 else "loc")
        )
        if pid == "loc1":
            local1_started.set()
            local1_release.wait(timeout=5)
        return {
            "vocals_path": str(main_mod.STEMS_DIR / f"{pid}_vocals.wav"),
            "instrumental_path": str(main_mod.STEMS_DIR / f"{pid}_instrumental.wav"),
        }

    def mock_subp_run(cmd, *args, **kwargs):
        for arg in cmd:
            if str(arg).endswith(".wav"):
                Path(arg).parent.mkdir(parents=True, exist_ok=True)
                Path(arg).write_bytes(b"RIFFmockwavcontent")
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(main_mod.subprocess, "run", mock_subp_run)
    monkeypatch.setattr(main_mod.sf, "info", lambda *args, **kwargs: DummySoundfileInfo())
    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate)
    monkeypatch.setattr(
        main_mod.lyrics_service, "fetch_lyrics", lambda *args, **kwargs: DUMMY_LYRICS
    )
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", lambda *args: [])
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda *args, **kwargs: "m.wav")

    # Create dummy uploaded WAV file
    wav1 = tmp_path / "track1.wav"
    wav1.write_bytes(b"RIFFdummydata")
    wav2 = tmp_path / "track2.wav"
    wav2.write_bytes(b"RIFFdummydata")

    _make_dummy_project("loc1", status="queued")
    _make_dummy_project("loc2", status="queued")

    t1 = threading.Thread(
        target=main_mod.run_local_pipeline,
        args=("loc1", str(wav1), "Title 1", "Artist 1"),
    )
    t2 = threading.Thread(
        target=main_mod.run_local_pipeline,
        args=("loc2", str(wav2), "Title 2", "Artist 2"),
    )

    t1.start()
    assert local1_started.wait(timeout=5)
    assert main_mod.projects["loc1"]["status"] in ("processing", "separating")
    assert sem._value == 0

    t2.start()
    time.sleep(0.1)
    assert main_mod.projects["loc2"]["status"] == "queued"

    # Cancel loc2 while queued
    main_mod.cancel_project("loc2")

    # Release Job 1
    local1_release.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert main_mod.projects["loc1"]["status"] == "ready"
    assert main_mod.projects["loc2"]["status"] == "cancelled"
    assert sem._value == 1
