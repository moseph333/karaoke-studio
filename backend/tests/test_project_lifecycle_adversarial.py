"""
Adversarial Verification Suite for Milestone 1:
Project Library Lifecycle Management, Deletion Isolation, Task Cancellation,
Ghost Resurrection Guards, and Metadata Resilience.

Author: Milestone 1 Challenger 1 (Backend Adversarial)
"""

import concurrent.futures
import json
import threading
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.main import (
    cleanup_project_disk_artifacts,
    run_local_pipeline,
)


def create_synthetic_wav(
    file_path: Path, duration: float = 0.5, sr: int = 44100, freq: float = 440.0
) -> Path:
    """Generate a valid stereo sine-wave WAV file on disk for fast, offline media testing."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.3 * np.sin(2 * np.pi * freq * t)
    stereo = np.column_stack((sine, sine))
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), stereo, sr)
    return file_path


# ==============================================================================
# Challenge 1: Path Traversal and Malicious IDs in DELETE /api/project/{id}
# ==============================================================================
class TestAdversarialPathTraversalAndMaliciousIDs:
    """Verifies that malicious or path-traversal project IDs cannot escape boundaries,

    delete unintended files, or cause unhandled 500 exceptions.
    """

    def test_delete_with_path_traversal_ids(self, client: TestClient, tmp_path: Path):
        """Attempts to delete using path traversal sequences (encoded or unencoded)

        must return safe rejections (404/405/400/422) and never delete files outside the project data scope.
        """
        canary = tmp_path / "canary.txt"
        canary.write_text("DO_NOT_DELETE")

        malicious_ids = [
            "../../etc",
            "../downloads",
            "..%2F..%2Fetc",
            "..%2Fdownloads",
            "....//....//etc",
            "etc/passwd",
            "%2e%2e%2f%2e%2e%2fcanary.txt",
            "/absolute/path/to/nothing",
            "project; rm -rf /",
            "' OR '1'='1",
            "<script>alert(1)</script>",
        ]

        for mal_id in malicious_ids:
            res = client.delete(f"/api/project/{mal_id}")
            # Route rejections return 405 (Method Not Allowed) or 404 (Not Found), never 500
            assert res.status_code in (404, 405, 400, 422), (
                f"Expected rejection status (404/405/400/422) for ID '{mal_id}', got {res.status_code}: {res.text}"
            )

        assert canary.exists(), "Canary file outside project directories was unexpectedly deleted!"


# ==============================================================================
# Challenge 2: Deletion Collision Isolation (Exact Prefix Collision p1 vs p10)
# ==============================================================================
class TestAdversarialDeletionIsolationPrefixCollisions:
    """Rigorous boundary collision tests: deleting prefix 'p1' or 'test_proj_1'

    must NEVER affect 'p10', 'p100', 'p11', 'test_proj_10', etc.
    """

    def test_prefix_collision_p1_vs_p10_complete_isolation(self, client: TestClient):
        """Verify deleting 'test_proj_1' leaves 'test_proj_10', 'test_proj_100',

        and 'test_proj_11' completely untouched across all directories and state.
        """
        project_ids = ["test_proj_1", "test_proj_10", "test_proj_100", "test_proj_11"]

        for pid in project_ids:
            p = {
                "id": pid,
                "title": f"Title for {pid}",
                "artist": f"Artist for {pid}",
                "status": "ready",
                "audio_path": str(main_mod.DOWNLOADS_DIR / f"{pid}.wav"),
                "vocals_path": str(main_mod.STEMS_DIR / pid / "vocals.wav"),
                "instrumental_path": str(main_mod.STEMS_DIR / pid / "instrumental.wav"),
                "master_audio_path": str(main_mod.OUTPUT_DIR / f"{pid}_master.wav"),
                "video_path": str(main_mod.OUTPUT_DIR / f"{pid}_karaoke.mp4"),
            }
            with main_mod.PROJECTS_LOCK:
                main_mod.projects[pid] = p

            create_synthetic_wav(main_mod.DOWNLOADS_DIR / f"{pid}.wav")
            create_synthetic_wav(main_mod.STEMS_DIR / pid / "vocals.wav")
            create_synthetic_wav(main_mod.STEMS_DIR / pid / "instrumental.wav")
            create_synthetic_wav(main_mod.OUTPUT_DIR / f"{pid}_master.wav")
            (main_mod.OUTPUT_DIR / f"{pid}_karaoke.mp4").write_bytes(b"dummy mp4 video bytes")

        main_mod.save_projects()

        for pid in project_ids:
            assert (main_mod.DOWNLOADS_DIR / f"{pid}.wav").exists()
            assert (main_mod.STEMS_DIR / pid / "vocals.wav").exists()
            assert (main_mod.OUTPUT_DIR / f"{pid}_master.wav").exists()
            assert (main_mod.OUTPUT_DIR / f"{pid}_karaoke.mp4").exists()

        # Action: Delete 'test_proj_1'
        res = client.delete("/api/project/test_proj_1")
        assert res.status_code == 200
        assert res.json()["status"] == "deleted"

        # Verify test_proj_1 is completely gone
        assert not (main_mod.DOWNLOADS_DIR / "test_proj_1.wav").exists()
        assert not (main_mod.STEMS_DIR / "test_proj_1").exists()
        assert not (main_mod.OUTPUT_DIR / "test_proj_1_master.wav").exists()
        assert not (main_mod.OUTPUT_DIR / "test_proj_1_karaoke.mp4").exists()
        assert "test_proj_1" not in main_mod.projects

        # Verify test_proj_10, test_proj_100, test_proj_11 are 100% UNTOUCHED
        for sibling_id in ["test_proj_10", "test_proj_100", "test_proj_11"]:
            assert (main_mod.DOWNLOADS_DIR / f"{sibling_id}.wav").exists(), (
                f"{sibling_id}.wav was deleted by prefix collision!"
            )
            assert (main_mod.STEMS_DIR / sibling_id / "vocals.wav").exists(), (
                f"{sibling_id} stems were deleted by prefix collision!"
            )
            assert (main_mod.STEMS_DIR / sibling_id / "instrumental.wav").exists(), (
                f"{sibling_id} stems were deleted by prefix collision!"
            )
            assert (main_mod.OUTPUT_DIR / f"{sibling_id}_master.wav").exists(), (
                f"{sibling_id}_master.wav was deleted by prefix collision!"
            )
            assert (main_mod.OUTPUT_DIR / f"{sibling_id}_karaoke.mp4").exists(), (
                f"{sibling_id}_karaoke.mp4 was deleted by prefix collision!"
            )
            assert sibling_id in main_mod.projects

        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert "test_proj_1" not in disk_projects
        assert "test_proj_10" in disk_projects
        assert "test_proj_100" in disk_projects
        assert "test_proj_11" in disk_projects


# ==============================================================================
# Challenge 3: Concurrent & Double Deletion Races
# ==============================================================================
class TestAdversarialConcurrentAndDoubleDeletion:
    """Stress tests concurrent and sequential double deletion for race conditions,

    deadlocks, and consistent status codes.
    """

    def test_sequential_double_delete(self, client: TestClient):
        """First delete returns 200, second delete on same ID returns 404."""
        pid = "seq_delete_test"
        p = {"id": pid, "title": "Sequential Test", "artist": "Singer", "status": "ready"}
        with main_mod.PROJECTS_LOCK:
            main_mod.projects[pid] = p
            main_mod.save_projects()

        res1 = client.delete(f"/api/project/{pid}")
        assert res1.status_code == 200
        assert res1.json()["status"] == "deleted"

        res2 = client.delete(f"/api/project/{pid}")
        assert res2.status_code == 404
        assert "not found" in res2.json()["detail"].lower()

    def test_concurrent_double_delete_race(self, client: TestClient):
        """10 concurrent threads issuing DELETE /api/project/{id} at the exact same moment.

        Must produce zero 500 errors, zero deadlocks, and cleanly delete the project.
        """
        pid = "concurrent_race_test"
        p = {"id": pid, "title": "Race Test", "artist": "Runner", "status": "ready"}
        with main_mod.PROJECTS_LOCK:
            main_mod.projects[pid] = p
            main_mod.save_projects()

        create_synthetic_wav(main_mod.DOWNLOADS_DIR / f"{pid}.wav")

        num_threads = 10
        barrier = threading.Barrier(num_threads)
        results = []

        def worker():
            barrier.wait()
            res = client.delete(f"/api/project/{pid}")
            return res.status_code, res.json()

        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(worker) for _ in range(num_threads)]
            for f in concurrent.futures.as_completed(futures):
                results.append(f.result())

        status_codes = [status for status, _ in results]

        assert all(code in (200, 404) for code in status_codes), (
            f"Encountered unexpected status codes in concurrent delete: {status_codes}"
        )
        assert 200 in status_codes, "At least one concurrent delete must succeed with 200"

        # Final state check
        assert pid not in main_mod.projects
        assert not (main_mod.DOWNLOADS_DIR / f"{pid}.wav").exists()


# ==============================================================================
# Challenge 4: Ghost Resurrection Races
# ==============================================================================
class TestAdversarialGhostResurrectionRaces:
    """Verifies that an in-flight background job (pipeline or render) does NOT

    resurrect a project in state or on disk if the project is deleted while in flight.
    """

    def test_run_pipeline_ghost_resurrection_guard(self, monkeypatch):
        """Simulate deletion of a project while run_pipeline is executing.

        When pipeline encounters an error or finishes, it must NOT re-insert into projects
        or save to projects.json.
        """
        pid = "ghost_pipe_proj"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Ghost Track",
            "artist": "Phantom",
            "status": "downloading",
        }
        main_mod.save_projects()

        def mock_extract(*args, **kwargs):
            with main_mod.PROJECTS_LOCK:
                main_mod.projects.pop(pid, None)
                main_mod.save_projects()
            if pid in main_mod.active_cancellations:
                main_mod.active_cancellations[pid].set()
            return {"id": "fake_yt_id", "title": "Ghost", "duration": 10.0}

        monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_extract)

        main_mod.run_pipeline(pid, "https://www.youtube.com/watch?v=mockghost1")

        assert pid not in main_mod.projects, "Pipeline resurrected deleted project in memory!"
        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert pid not in disk_projects, "Pipeline resurrected deleted project in projects.json!"

    def test_run_local_pipeline_ghost_resurrection_guard(self, monkeypatch):
        """Simulate deletion while local audio pipeline is executing."""
        pid = "ghost_local_proj"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Local Ghost",
            "artist": "Phantom",
            "status": "separating",
        }
        main_mod.save_projects()

        def mock_separate(*args, **kwargs):
            with main_mod.PROJECTS_LOCK:
                main_mod.projects.pop(pid, None)
                main_mod.save_projects()
            if pid in main_mod.active_cancellations:
                main_mod.active_cancellations[pid].set()
            return {"vocals_path": "/fake/voc.wav", "instrumental_path": "/fake/inst.wav"}

        monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate)

        dummy_audio = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
        create_synthetic_wav(dummy_audio)

        run_local_pipeline(pid, dummy_audio, title="Local Ghost", artist="Phantom")

        assert pid not in main_mod.projects, "Local pipeline resurrected deleted project in memory!"
        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert pid not in disk_projects, (
            "Local pipeline resurrected deleted project in projects.json!"
        )

    def test_run_video_render_ghost_resurrection_guard(self):
        """Simulate deletion while video rendering is in-flight."""
        pid = "ghost_render_proj"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Render Ghost",
            "artist": "Phantom",
            "status": "ready",
            "render_status": "rendering",
            "instrumental_path": str(main_mod.OUTPUT_DIR / "inst.wav"),
            "lines": [],
        }
        main_mod.save_projects()

        def mock_mix(*args, **kwargs):
            return "/fake/mixed.wav"

        def mock_render(*args, **kwargs):
            with main_mod.PROJECTS_LOCK:
                main_mod.projects.pop(pid, None)
                main_mod.save_projects()
            render_key = f"{pid}_render"
            if render_key in main_mod.active_cancellations:
                main_mod.active_cancellations[render_key].set()
            return "/fake/out.mp4"

        with (
            patch.object(main_mod.audio_mixer, "mix_and_shift", mock_mix),
            patch.object(main_mod.video_renderer, "render_video", mock_render),
            patch.object(main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: None),
        ):
            req = main_mod.RenderRequest(aspect_ratio="16:9")
            main_mod.run_video_render(pid, req)

        assert pid not in main_mod.projects, "Video render resurrected deleted project in memory!"
        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert pid not in disk_projects, (
            "Video render resurrected deleted project in projects.json!"
        )


# ==============================================================================
# Challenge 5: Metadata Stress, Input Limits & YouTube Package Updates
# ==============================================================================
class TestAdversarialMetadataStressAndLimits:
    """Comprehensive boundary testing for title and artist inputs."""

    def test_metadata_empty_and_whitespace_rejections(self, client: TestClient):
        """Empty, whitespace-only, and null-only payloads must be rejected with HTTP 400."""
        pid = "meta_empty_test"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Stable Title",
            "artist": "Stable Artist",
            "status": "ready",
        }
        main_mod.save_projects()

        invalid_payloads = [
            {},
            {"title": None, "artist": None},
            {"title": ""},
            {"title": "   "},
            {"title": "\t\n  \r\n"},
            {"artist": ""},
            {"artist": "   "},
            {"artist": " \t\t "},
            {"title": "", "artist": ""},
            {"title": "   ", "artist": "   "},
        ]

        for payload in invalid_payloads:
            res = client.patch(f"/api/project/{pid}", json=payload)
            assert res.status_code == 400, (
                f"Expected 400 for payload {payload}, got {res.status_code}: {res.text}"
            )

        proj = main_mod.projects[pid]
        assert proj["title"] == "Stable Title"
        assert proj["artist"] == "Stable Artist"

    def test_metadata_length_limits(self, client: TestClient):
        """Strings > 300 characters must be rejected by Pydantic schema (422).

        Strings <= 300 characters must succeed (200).
        """
        pid = "meta_len_test"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Original",
            "artist": "Original",
            "status": "ready",
        }
        main_mod.save_projects()

        # 301 characters -> must fail with 422
        long_title = "A" * 301
        res_fail = client.patch(f"/api/project/{pid}", json={"title": long_title})
        assert res_fail.status_code == 422, (
            f"Expected 422 for 301 chars, got {res_fail.status_code}: {res_fail.text}"
        )

        long_artist = "B" * 301
        res_fail2 = client.patch(f"/api/project/{pid}", json={"artist": long_artist})
        assert res_fail2.status_code == 422

        # Exactly 300 characters -> must succeed with 200
        boundary_title = "T" * 300
        boundary_artist = "A" * 300
        res_ok = client.patch(
            f"/api/project/{pid}", json={"title": boundary_title, "artist": boundary_artist}
        )
        assert res_ok.status_code == 200
        data = res_ok.json()
        assert data["title"] == boundary_title
        assert data["artist"] == boundary_artist

    def test_metadata_special_characters_emojis_cjk(self, client: TestClient):
        """Ensures Unicode, emojis, CJK, Cyrillic, and quotes persist cleanly without escaping errors."""
        pid = "meta_unicode_test"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Initial",
            "artist": "Initial",
            "status": "ready",
        }
        main_mod.save_projects()

        test_cases = [
            ("🎤 Karaoke Party 👑 🔥", "Dua Lipa & Elton John ✨"),
            ("夜に駆ける (Racing into the Night)", "YOASOBI (ヨアソビ)"),
            ("Группа крови на рукаве", "Кино (Виктор Цой)"),
            ("Café des Délices (Édition Spéciale)", "Patrick Bruel / Noël"),
            (
                'Heavy Metal "Quotes" & <Ampersands> \\ Backslashes',
                "AC/DC & Guns N' Roses",
            ),
        ]

        for title, artist in test_cases:
            res = client.patch(f"/api/project/{pid}", json={"title": title, "artist": artist})
            assert res.status_code == 200
            data = res.json()
            assert data["title"] == title
            assert data["artist"] == artist

            disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
            assert disk_projects[pid]["title"] == title
            assert disk_projects[pid]["artist"] == artist

    def test_metadata_dynamic_youtube_package_reflection(self, client: TestClient):
        """Updating title and artist dynamically updates YouTube package title, description, and tags."""
        pid = "yt_pkg_test"
        main_mod.projects[pid] = {
            "id": pid,
            "title": "Original Title",
            "artist": "Original Artist",
            "status": "ready",
            "lines": [
                {
                    "text": "Hello world karaoke",
                    "start_time": 0.0,
                    "end_time": 3.0,
                    "words": [{"word": "Hello", "start_time": 0.0, "end_time": 1.0}],
                }
            ],
        }
        main_mod.save_projects()

        pkg1 = client.get(f"/api/project/{pid}/youtube-package").json()
        assert "Original Title" in pkg1["title"]
        assert "Original Artist" in pkg1["title"]

        patch_res = client.patch(
            f"/api/project/{pid}",
            json={"title": "Modern Anthem", "artist": "Electra"},
        )
        assert patch_res.status_code == 200

        pkg2 = client.get(f"/api/project/{pid}/youtube-package").json()
        assert "Modern Anthem" in pkg2["title"]
        assert "Electra" in pkg2["title"]
        assert "Modern Anthem" in pkg2["description"]
        assert "electra" in pkg2["tags"]
