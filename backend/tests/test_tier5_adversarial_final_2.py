"""
Tier 5 Adversarial Coverage Hardening Suite 2 (Milestone Final).

Comprehensive adversarial stress tests verifying:
1. Full project integration and API routes (/api/project/{id}/realign-lyrics and /api/project/{id}/lyrics).
2. Multi-track batch alignment under concurrent CPU load.
3. Worst-case performance budget: 4-minute full song alignment stays under 2.0s CPU even under noisy multi-syllable singing.
4. Resilience to non-standard audio sample rates (8kHz, 16kHz, 44.1kHz, 48kHz, 96kHz, 192kHz) and bit depths (16/24/32-bit PCM, 32/64-bit float).
"""

import concurrent.futures
import time
import uuid
from pathlib import Path
from typing import Any
from unittest.mock import patch

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.main import projects, save_projects
from backend.services.aligner import (
    AudioAligner,
    align_words_spectral,
    estimate_global_offset,
    refine_line_boundaries,
)
from backend.tests.test_e2e_lyrics_aligner_sync import create_synthetic_vocal_signal


@pytest.fixture(autouse=True)
def prevent_network_leakage(monkeypatch):
    """Hermetic execution guard ensuring zero external network access."""
    monkeypatch.setattr(
        "backend.services.lyrics.syncedlyrics.search",
        lambda *args, **kwargs: None,
    )


def create_mock_project(
    project_id: str | None = None,
    title: str = "Adversarial Anthem",
    artist: str = "Stress Artist",
    duration: float = 60.0,
    with_vocals: bool = True,
    vocal_sr: int = 44100,
    vocal_events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Helper creating an isolated test project with an optional synthetic vocal stem."""
    pid = project_id or f"proj_adv_{uuid.uuid4().hex[:8]}"
    proj_dir = main_mod.STEMS_DIR / pid
    proj_dir.mkdir(parents=True, exist_ok=True)

    proj_data: dict[str, Any] = {
        "id": pid,
        "track_id": pid,
        "title": title,
        "artist": artist,
        "duration": duration,
        "status": "ready",
        "progress": 100,
        "lines": [
            {
                "id": 1,
                "text": "Initial baseline line",
                "start_time": 1.0,
                "end_time": 4.0,
                "words": [
                    {"word": "Initial", "start_time": 1.0, "end_time": 2.0},
                    {"word": "baseline", "start_time": 2.0, "end_time": 3.0},
                    {"word": "line", "start_time": 3.0, "end_time": 4.0},
                ],
            }
        ],
        "semitones": 0,
        "guide_volume": 0.0,
    }

    if with_vocals:
        vocal_path = proj_dir / "vocals.wav"
        events = vocal_events or [
            {"start": 1.0, "end": 4.0, "freq": 330.0},
            {"start": 6.0, "end": 9.5, "freq": 440.0},
        ]
        audio = create_synthetic_vocal_signal(
            duration=max(duration, 10.0),
            vocal_events=events,
            noise_level=0.001,
            sr=vocal_sr,
        )
        sf.write(str(vocal_path), audio, vocal_sr)
        proj_data["vocals_path"] = str(vocal_path)
        proj_data["vocals_url"] = f"/static/stems/{pid}/vocals.wav"

    projects[pid] = proj_data
    save_projects()
    return proj_data


# ==============================================================================
# SECTION 1: ADVERSARIAL API ROUTE TESTING
# ==============================================================================


class TestTier5ApiLyricsAdversarial:
    """Adversarial stress-testing of /api/project/{id}/lyrics and /realign-lyrics routes."""

    def test_lyrics_routes_404_on_nonexistent_project(self, client: TestClient):
        """Both endpoints return 404 when project ID does not exist."""
        ghost_id = f"nonexistent_{uuid.uuid4().hex}"

        res_update = client.post(
            f"/api/project/{ghost_id}/lyrics",
            json={"lines": []},
        )
        assert res_update.status_code == 404
        assert "not found" in res_update.json()["detail"].lower()

        res_realign = client.post(
            f"/api/project/{ghost_id}/realign-lyrics",
            json={"custom_lyrics": "Sample line", "fetch_lrclib": False},
        )
        assert res_realign.status_code == 404
        assert "not found" in res_realign.json()["detail"].lower()

    def test_update_lyrics_timestamp_invariants_rejected(self, client: TestClient):
        """POST /api/project/{id}/lyrics rejects non-monotonic timestamps with 422."""
        proj = create_mock_project()
        pid = proj["id"]

        # Negative start_time
        res = client.post(
            f"/api/project/{pid}/lyrics",
            json={
                "lines": [
                    {
                        "id": 1,
                        "text": "Negative timestamp",
                        "start_time": -1.5,
                        "end_time": 2.0,
                    }
                ]
            },
        )
        assert res.status_code == 422

        # Inverted line timestamps (start > end)
        res = client.post(
            f"/api/project/{pid}/lyrics",
            json={
                "lines": [
                    {
                        "id": 1,
                        "text": "Inverted interval",
                        "start_time": 5.0,
                        "end_time": 3.0,
                    }
                ]
            },
        )
        assert res.status_code == 422

        # Non-monotonic word timings within line
        res = client.post(
            f"/api/project/{pid}/lyrics",
            json={
                "lines": [
                    {
                        "id": 1,
                        "text": "Out of order words",
                        "start_time": 1.0,
                        "end_time": 4.0,
                        "words": [
                            {"word": "Out", "start_time": 2.5, "end_time": 3.0},
                            {"word": "of", "start_time": 1.5, "end_time": 2.0},
                        ],
                    }
                ]
            },
        )
        assert res.status_code == 422

    def test_update_lyrics_empty_and_massive_boundary(self, client: TestClient):
        """POST /api/project/{id}/lyrics safely handles empty lists and massive line counts."""
        proj = create_mock_project()
        pid = proj["id"]

        # Empty lines list
        res_empty = client.post(f"/api/project/{pid}/lyrics", json={"lines": []})
        assert res_empty.status_code == 200
        assert res_empty.json()["lines_count"] == 0
        assert projects[pid]["lines"] == []

        # Massive line list (200 lines) with duration expansion
        massive_lines = []
        for i in range(200):
            st = i * 2.0
            et = st + 1.8
            massive_lines.append(
                {
                    "id": i + 1,
                    "text": f"Line {i + 1} stress testing lyric scalability and throughput",
                    "start_time": st,
                    "end_time": et,
                    "words": [
                        {"word": "Line", "start_time": st, "end_time": st + 0.3},
                        {"word": str(i + 1), "start_time": st + 0.3, "end_time": et},
                    ],
                }
            )

        res_massive = client.post(
            f"/api/project/{pid}/lyrics",
            json={"lines": massive_lines},
        )
        assert res_massive.status_code == 200
        assert res_massive.json()["lines_count"] == 200
        # Project duration should expand to at least the max line end_time (around 399.8s)
        assert projects[pid]["duration"] >= 399.8

    def test_update_lyrics_multilingual_unicode_and_emojis(self, client: TestClient):
        """POST /api/project/{id}/lyrics preserves Unicode, Japanese, Cyrillic, and emojis."""
        proj = create_mock_project()
        pid = proj["id"]

        unicode_lines = [
            {
                "id": 1,
                "text": "夜に駆ける 🎶 (Racing into the night)",
                "start_time": 0.5,
                "end_time": 3.0,
                "singer": "singer1",
            },
            {
                "id": 2,
                "text": "Привет мир! Das schöne Lied, café crème & naïve",
                "start_time": 3.5,
                "end_time": 7.0,
                "singer": "singer2",
            },
        ]

        res = client.post(f"/api/project/{pid}/lyrics", json={"lines": unicode_lines})
        assert res.status_code == 200
        stored = projects[pid]["lines"]
        assert stored[0]["text"] == "夜に駆ける 🎶 (Racing into the night)"
        assert stored[0]["singer"] == "singer1"
        assert stored[1]["text"] == "Привет мир! Das schöne Lied, café crème & naïve"
        assert stored[1]["singer"] == "singer2"

    def test_realign_lyrics_stems_preconditions(self, client: TestClient):
        """POST /api/project/{id}/realign-lyrics rejects missing or empty vocal stems."""
        # 1. Project without vocal stem
        proj_no_stem = create_mock_project(with_vocals=False)
        res = client.post(
            f"/api/project/{proj_no_stem['id']}/realign-lyrics",
            json={"custom_lyrics": "Some lyrics to align"},
        )
        assert res.status_code == 400
        assert "vocal stem missing" in res.json()["detail"].lower()

        # 2. Project with 0-byte vocal stem file
        proj_zero_byte = create_mock_project(with_vocals=True)
        vocal_p = Path(proj_zero_byte["vocals_path"])
        vocal_p.write_bytes(b"")  # Truncate to 0 bytes
        res2 = client.post(
            f"/api/project/{proj_zero_byte['id']}/realign-lyrics",
            json={"custom_lyrics": "Some lyrics to align"},
        )
        assert res2.status_code == 400
        assert "vocal stem missing or not ready" in res2.json()["detail"].lower()

    def test_realign_lyrics_invalid_payloads(self, client: TestClient):
        """POST /api/project/{id}/realign-lyrics rejects missing/whitespace-only/empty lyrics."""
        proj = create_mock_project(with_vocals=True)
        pid = proj["id"]

        # Neither custom_lyrics nor fetch_lrclib
        res = client.post(
            f"/api/project/{pid}/realign-lyrics",
            json={"fetch_lrclib": False},
        )
        assert res.status_code == 400
        assert "either custom_lyrics or fetch_lrclib" in res.json()["detail"].lower()

        # Whitespace-only custom_lyrics
        res_ws = client.post(
            f"/api/project/{pid}/realign-lyrics",
            json={"custom_lyrics": "   \n\t  ", "fetch_lrclib": False},
        )
        assert res_ws.status_code == 400
        assert "either custom_lyrics or fetch_lrclib" in res_ws.json()["detail"].lower()

        # LRCLIB fetch returns no lyrics
        with patch.object(main_mod.lyrics_service, "fetch_lyrics", return_value={"lines": []}):
            res_no_lyrics = client.post(
                f"/api/project/{pid}/realign-lyrics",
                json={"fetch_lrclib": True},
            )
            assert res_no_lyrics.status_code == 400
            assert "no lyric lines found" in res_no_lyrics.json()["detail"].lower()

    def test_realign_lyrics_with_custom_lrc_success(self, client: TestClient):
        """POST /api/project/{id}/realign-lyrics accurately aligns custom LRC and updates store."""
        proj = create_mock_project(with_vocals=True)
        pid = proj["id"]

        lrc_text = "[00:01.00] First test stanza phrase\n[00:06.00] Second melodic vocal response\n"

        res = client.post(
            f"/api/project/{pid}/realign-lyrics",
            json={"custom_lyrics": lrc_text, "fetch_lrclib": False},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["source"] == "custom"
        assert data["is_synced"] is True
        assert len(data["lines"]) == 2

        # Check word timings are populated and monotonic
        for line in data["lines"]:
            assert len(line["words"]) > 0
            words = line["words"]
            for i in range(len(words) - 1):
                assert words[i]["end_time"] <= words[i + 1]["start_time"]

        # Check project was saved in-memory
        assert projects[pid]["lyric_source"] == "custom"
        assert projects[pid]["is_synced"] is True
        assert len(projects[pid]["lines"]) == 2

    def test_realign_lyrics_with_plain_text_success(self, client: TestClient):
        """POST /api/project/{id}/realign-lyrics partitions untimed plain text across phrases."""
        proj = create_mock_project(with_vocals=True)
        pid = proj["id"]

        plain_text = "First untimed line of lyrics\nSecond untimed line of song\n"

        res = client.post(
            f"/api/project/{pid}/realign-lyrics",
            json={"custom_lyrics": plain_text, "fetch_lrclib": False},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["source"] == "custom"
        assert data["is_synced"] is False
        assert len(data["lines"]) == 2
        assert data["lines"][0]["start_time"] < data["lines"][0]["end_time"]
        assert data["lines"][1]["start_time"] < data["lines"][1]["end_time"]

    def test_realign_lyrics_with_mocked_lrclib(self, client: TestClient):
        """POST /api/project/{id}/realign-lyrics with fetch_lrclib=True aligns fetched lyrics."""
        proj = create_mock_project(with_vocals=True)
        pid = proj["id"]

        mock_payload = {
            "trackName": "Adversarial Anthem",
            "artistName": "Stress Artist",
            "syncedLyrics": "[00:01.00] Stanza from LRCLIB\n[00:06.00] Chorus from LRCLIB\n",
            "plainLyrics": "Stanza from LRCLIB\nChorus from LRCLIB\n",
        }

        with patch("backend.services.lyrics.requests.get") as mock_get:
            mock_resp = mock_get.return_value
            mock_resp.status_code = 200
            mock_resp.json.return_value = mock_payload

            res = client.post(
                f"/api/project/{pid}/realign-lyrics",
                json={"fetch_lrclib": True},
            )
            assert res.status_code == 200
            data = res.json()
            assert data["status"] == "ok"
            assert data["source"] == "lrclib"
            assert data["is_synced"] is True
            assert len(data["lines"]) == 2
            assert "Stanza from LRCLIB" in data["lines"][0]["text"]

    def test_realign_and_update_concurrent_requests(self, client: TestClient):
        """Concurrent calls to /lyrics and /realign-lyrics on the same project maintain data integrity."""
        proj = create_mock_project(with_vocals=True)
        pid = proj["id"]

        def do_update(idx: int):
            return client.post(
                f"/api/project/{pid}/lyrics",
                json={
                    "lines": [
                        {
                            "id": 1,
                            "text": f"Concurrent update {idx}",
                            "start_time": 1.0,
                            "end_time": 3.0,
                        }
                    ]
                },
            )

        def do_realign(idx: int):
            lrc = f"[00:01.00] Realigned text {idx}\n[00:06.00] Second line {idx}\n"
            return client.post(
                f"/api/project/{pid}/realign-lyrics",
                json={"custom_lyrics": lrc, "fetch_lrclib": False},
            )

        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            tasks = []
            for i in range(4):
                tasks.append(executor.submit(do_update, i))
                tasks.append(executor.submit(do_realign, i))
            results = [t.result() for t in tasks]

        # Every call should return 200 OK without deadlocks or 500 errors
        for r in results:
            assert r.status_code == 200
        # Final project state in store should be valid and well-formed
        assert pid in projects
        assert len(projects[pid]["lines"]) in (1, 2)


# ==============================================================================
# SECTION 2: NON-STANDARD SAMPLE RATES & BIT DEPTHS
# ==============================================================================


class TestTier5SampleRatesAndBitDepths:
    """Stress testing forced alignment across non-standard sample rates and bit depths."""

    SAMPLE_RATES = (8000, 16000, 44100, 48000, 96000, 192000)
    SUBTYPES = ("PCM_16", "PCM_24", "PCM_32", "FLOAT")

    @pytest.mark.parametrize("sr", SAMPLE_RATES)
    def test_align_lyrics_sample_rate_resilience(self, tmp_path: Path, sr: int):
        """AudioAligner accurately aligns lyrics across 8kHz to 192kHz sample rates."""
        dur = 8.0
        vocal_events = [
            {"start": 1.0, "end": 3.5, "freq": 350.0},
            {"start": 4.5, "end": 7.0, "freq": 440.0},
        ]
        audio = create_synthetic_vocal_signal(dur, vocal_events, noise_level=0.001, sr=sr)
        wav_file = tmp_path / f"test_sr_{sr}.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"id": 1, "text": "First sample rate test phrase", "start_time": 1.0, "end_time": 3.5},
            {
                "id": 2,
                "text": "Second high fidelity vocal phrase",
                "start_time": 4.5,
                "end_time": 7.0,
            },
        ]

        # Verify DSP primitives directly across sample rates
        offset, _conf = estimate_global_offset(audio, sr, lines)
        assert abs(offset) <= 0.15
        assert _conf >= 0.0
        snapped = refine_line_boundaries(audio, sr, lines)
        assert len(snapped) == 2

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)

        assert len(aligned) == 2
        for line in aligned:
            words = line["words"]
            assert len(words) > 0
            for i in range(len(words) - 1):
                assert words[i]["end_time"] <= words[i + 1]["start_time"]
                assert words[i]["start_time"] < words[i]["end_time"]
                assert words[i]["start_time"] >= 0.0

    @pytest.mark.parametrize("subtype", SUBTYPES)
    def test_align_lyrics_bit_depth_resilience(self, tmp_path: Path, subtype: str):
        """AudioAligner handles 16-bit, 24-bit, 32-bit integer PCM and 32-bit float audio."""
        sr = 44100
        dur = 6.0
        vocal_events = [{"start": 1.0, "end": 4.5, "freq": 300.0}]
        audio = create_synthetic_vocal_signal(dur, vocal_events, noise_level=0.001, sr=sr)

        wav_file = tmp_path / f"test_bitdepth_{subtype}.wav"
        sf.write(str(wav_file), audio, sr, subtype=subtype)

        lines = [
            {
                "id": 1,
                "text": "Bit depth precision test words for karaoke aligner",
                "start_time": 1.0,
                "end_time": 4.5,
            }
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)

        assert len(aligned) == 1
        words = aligned[0]["words"]
        assert len(words) == 8
        for i in range(len(words) - 1):
            assert words[i]["end_time"] <= words[i + 1]["start_time"]

    def test_align_lyrics_double_precision_float(self, tmp_path: Path):
        """AudioAligner handles 64-bit double precision float WAV files cleanly."""
        sr = 48000
        dur = 5.0
        vocal_events = [{"start": 1.0, "end": 4.0, "freq": 400.0}]
        audio = create_synthetic_vocal_signal(dur, vocal_events, noise_level=0.001, sr=sr).astype(
            np.float64
        )

        wav_file = tmp_path / "test_double_precision.wav"
        sf.write(str(wav_file), audio, sr, subtype="DOUBLE")

        lines = [
            {
                "id": 1,
                "text": "Double precision floating point verification",
                "start_time": 1.0,
                "end_time": 4.0,
            }
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 1
        assert len(aligned[0]["words"]) == 5

    def test_audio_format_extreme_dynamics(self, tmp_path: Path):
        """AudioAligner remains stable under near-clipping audio and extremely quiet audio."""
        sr = 44100
        dur = 5.0
        t = np.linspace(0, dur, int(sr * dur), endpoint=False)

        lines = [{"id": 1, "text": "Dynamic range stress test", "start_time": 1.0, "end_time": 4.0}]
        aligner = AudioAligner()

        # Near-clipping audio (+0.999 amplitude)
        loud_audio = 0.999 * np.sin(2 * np.pi * 440.0 * t)
        loud_file = tmp_path / "loud.wav"
        sf.write(str(loud_file), loud_audio, sr)
        res_loud = aligner.align_lyrics(str(loud_file), lines)
        assert len(res_loud) == 1
        assert len(res_loud[0]["words"]) == 4

        # Very quiet audio (-60 dB, 0.001 amplitude)
        quiet_audio = 0.001 * np.sin(2 * np.pi * 440.0 * t)
        quiet_file = tmp_path / "quiet.wav"
        sf.write(str(quiet_file), quiet_audio, sr)
        res_quiet = aligner.align_lyrics(str(quiet_file), lines)
        assert len(res_quiet) == 1
        assert len(res_quiet[0]["words"]) == 4

    def test_audio_multichannel_surround_downmix(self, tmp_path: Path):
        """AudioAligner cleanly downmixes 6-channel 5.1 surround audio to mono."""
        sr = 44100
        dur = 5.0
        num_samples = int(sr * dur)
        t = np.linspace(0, dur, num_samples, endpoint=False)
        center_channel = 0.5 * np.sin(2 * np.pi * 350.0 * t)
        noise_chan = 0.01 * np.random.randn(num_samples)

        # 6-channel surround layout: L, R, C, LFE, Ls, Rs
        surround_audio = np.column_stack(
            (noise_chan, noise_chan, center_channel, noise_chan, noise_chan, noise_chan)
        )
        wav_file = tmp_path / "surround_5_1.wav"
        sf.write(str(wav_file), surround_audio, sr)

        lines = [
            {"id": 1, "text": "Surround sound downmix test", "start_time": 1.0, "end_time": 4.0}
        ]
        aligner = AudioAligner()
        res = aligner.align_lyrics(str(wav_file), lines)
        assert len(res) == 1
        assert len(res[0]["words"]) == 4


# ==============================================================================
# SECTION 3: MULTI-TRACK BATCH ALIGNMENT UNDER CONCURRENT CPU LOAD
# ==============================================================================


class TestTier5ConcurrentBatchAlignment:
    """Stress testing parallel multi-track alignment under heavy concurrent CPU load."""

    def test_concurrent_batch_multi_track_alignment(self, tmp_path: Path):
        """Batch-aligns 8 independent vocal tracks concurrently across 4 worker threads."""
        sr = 44100
        dur = 25.0
        num_tracks = 8

        # Synthesize 8 distinct audio tracks with unique frequencies and timing
        track_files = []
        track_lines = []
        for i in range(num_tracks):
            v_events = [
                {"start": 2.0, "end": 5.5, "freq": 220.0 + i * 25.0},
                {"start": 7.0, "end": 11.0, "freq": 330.0 + i * 15.0},
                {"start": 13.0, "end": 17.5, "freq": 260.0 + i * 20.0},
                {"start": 19.0, "end": 23.0, "freq": 380.0 + i * 10.0},
            ]
            audio = create_synthetic_vocal_signal(dur, v_events, noise_level=0.002, sr=sr)
            w_path = tmp_path / f"batch_track_{i}.wav"
            sf.write(str(w_path), audio, sr)
            track_files.append(str(w_path))

            lines = [
                {
                    "id": 1,
                    "text": f"Track {i} stanza one vocal text",
                    "start_time": 2.0,
                    "end_time": 5.5,
                },
                {
                    "id": 2,
                    "text": f"Track {i} stanza two vocal melody",
                    "start_time": 7.0,
                    "end_time": 11.0,
                },
                {
                    "id": 3,
                    "text": f"Track {i} chorus main vocal theme",
                    "start_time": 13.0,
                    "end_time": 17.5,
                },
                {
                    "id": 4,
                    "text": f"Track {i} outro closing vocal section",
                    "start_time": 19.0,
                    "end_time": 23.0,
                },
            ]
            track_lines.append(lines)

        aligner = AudioAligner()

        def _align_worker(idx: int):
            t_s = time.perf_counter()
            aligned = aligner.align_lyrics(track_files[idx], track_lines[idx])
            t_dur = time.perf_counter() - t_s
            return idx, aligned, t_dur

        t_wall_start = time.perf_counter()
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
            futures = [executor.submit(_align_worker, i) for i in range(num_tracks)]
            results = [f.result() for f in futures]
        t_wall_total = time.perf_counter() - t_wall_start

        assert len(results) == num_tracks
        # Verify throughput: 8 tracks (200 total audio seconds) aligned in under 6.0s wall time
        assert t_wall_total < 6.0, (
            f"Concurrent alignment took {t_wall_total:.2f}s, exceeding 6.0s limit"
        )

        for idx, lines, _dur_sec in results:
            assert len(lines) == 4, f"Track {idx} missing lines"
            for line in lines:
                words = line["words"]
                assert len(words) == 6, (
                    f"Track {idx} line {line['id']} expected 6 words, got {len(words)}"
                )
                for w_idx in range(len(words) - 1):
                    assert words[w_idx]["end_time"] <= words[w_idx + 1]["start_time"]
                    assert words[w_idx]["start_time"] < words[w_idx]["end_time"]

    def test_rapid_overlapping_alignment_tasks(self, tmp_path: Path):
        """Stress tests 16 rapid overlapping alignment tasks verifying thread isolation."""
        sr = 44100
        dur = 8.0
        v_events = [{"start": 1.0, "end": 6.0, "freq": 350.0}]
        audio = create_synthetic_vocal_signal(dur, v_events, noise_level=0.001, sr=sr)
        wav_path = tmp_path / "shared_audio.wav"
        sf.write(str(wav_path), audio, sr)

        lines = [
            {
                "id": 1,
                "text": "Rapid burst multi-threaded alignment stability check",
                "start_time": 1.0,
                "end_time": 6.0,
            }
        ]

        aligner = AudioAligner()

        def _align_task(task_id: int):
            return aligner.align_lyrics(str(wav_path), lines)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(_align_task, i) for i in range(16)]
            results = [f.result() for f in futures]

        assert len(results) == 16
        for r in results:
            assert len(r) == 1
            assert len(r[0]["words"]) == 6


# ==============================================================================
# SECTION 4: WORST-CASE PERFORMANCE BUDGET (<2.0s CPU FOR 4-MINUTE FULL SONG)
# ==============================================================================


class TestTier5PerformanceBudgetWorstCase:
    """Rigorous empirical verification of the CPU performance budget under worst-case acoustic stress."""

    def test_four_minute_full_song_under_two_seconds_cpu(self, tmp_path: Path):
        """
        Worst-case budget verification:
        4-minute (240.0s) full track, 40 vocal lines, ~320 multi-syllabic words,
        dense pink noise, pre-phrase breath intakes, and 120 BPM drum bleed transients.
        Must execute forced alignment in < 2.0s CPU time.
        """
        sr = 44100
        dur = 240.0  # 4 minutes
        num_lines = 40
        vocal_events = []
        lines = []

        complex_words = [
            "supercalifragilisticexpialidocious",
            "incomprehensibility",
            "counterrevolutionary",
            "uncharacteristically",
            "electrophysiological",
            "pseudopseudohypoparathyroidism",
            "antidisestablishmentarianism",
            "uncompromisingly",
        ]

        for i in range(num_lines):
            l_start = 4.0 + i * 5.8
            l_end = l_start + 4.2
            if l_end > dur - 2.0:
                break

            # 8-word complex line
            words_in_line = [complex_words[(i * 3 + j) % len(complex_words)] for j in range(8)]
            lines.append(
                {
                    "id": i + 1,
                    "text": " ".join(words_in_line),
                    "start_time": l_start,
                    "end_time": l_end,
                }
            )

            # Voiced vocal harmonic tone
            vocal_events.append({"start": l_start, "end": l_end, "freq": 280.0 + (i % 6) * 30.0})
            # Breath noise preceding onset
            vocal_events.append({"start": l_start - 0.25, "end": l_start - 0.05, "is_breath": True})
            # Snare/hi-hat transients during singing
            vocal_events.append(
                {"start": l_start + 1.2, "end": l_start + 1.25, "is_transient": True}
            )
            vocal_events.append(
                {"start": l_start + 2.8, "end": l_start + 2.85, "is_transient": True}
            )

        audio = create_synthetic_vocal_signal(
            duration=dur,
            vocal_events=vocal_events,
            noise_level=0.005,
            sr=sr,
        )

        wav_path = tmp_path / "four_minute_worst_case.wav"
        sf.write(str(wav_path), audio, sr)

        aligner = AudioAligner()

        t_cpu_start = time.process_time()
        t_wall_start = time.perf_counter()
        aligned = aligner.align_lyrics(str(wav_path), lines)
        cpu_time = time.process_time() - t_cpu_start
        wall_time = time.perf_counter() - t_wall_start

        # Check line count and performance budget
        assert len(aligned) == num_lines
        assert cpu_time < 2.0, (
            f"CPU budget exceeded: {cpu_time:.4f}s >= 2.0s (wall time: {wall_time:.4f}s)"
        )

        # Check strict monotonicity across all 40 lines and 320 words
        for line in aligned:
            words = line["words"]
            assert len(words) == 8
            for w_idx in range(len(words) - 1):
                assert words[w_idx]["end_time"] <= words[w_idx + 1]["start_time"]
                assert words[w_idx]["start_time"] < words[w_idx]["end_time"]
                assert words[w_idx]["start_time"] >= 0.0

    def test_word_dense_rapid_polysyllabic_line_efficiency(self):
        """Single line with 25 rapid words in 5 seconds completes in < 0.08s CPU."""
        sr = 44100
        dur = 6.0
        vocal_events = [{"start": 0.5, "end": 5.5, "freq": 320.0}]
        audio = create_synthetic_vocal_signal(dur, vocal_events, noise_level=0.001, sr=sr)

        dense_words = [
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "ten",
            "rapid",
            "syllable",
            "rhythm",
            "metric",
            "tempo",
            "lyric",
            "melody",
            "phrase",
            "accent",
            "cadence",
            "harmony",
            "vocal",
            "speech",
            "timing",
            "finish",
        ]
        assert len(dense_words) == 25

        t_cpu_start = time.process_time()
        words = align_words_spectral(
            audio_segment=audio,
            sample_rate=sr,
            words=dense_words,
            line_start=0.5,
            line_end=5.5,
        )
        cpu_time = time.process_time() - t_cpu_start

        assert len(words) == 25
        assert cpu_time < 0.08, f"Word-dense DP alignment took {cpu_time:.4f}s >= 0.08s"
        for i in range(len(words) - 1):
            assert words[i]["end_time"] <= words[i + 1]["start_time"]
            assert words[i]["start_time"] < words[i]["end_time"]
