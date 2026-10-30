"""
E2E Test Configuration and Deterministic Fixtures
Provides synthetic offline media assets, mock external networks (yt-dlp, LRCLIB),
and project factories for rapid, hermetic testing of all 4 tiers.
"""

import io
import os
import shutil
import time
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf
from PIL import Image

import backend.main as main_mod
from backend import config
from backend.tests.helpers.media import generate_sine_wave_wav, generate_test_image


@pytest.fixture
def sample_wav(tmp_path: Path) -> Path:
    """Fixture providing a 1.0s valid test WAV."""
    wav_path = tmp_path / "fixtures" / "sample.wav"
    return generate_sine_wave_wav(wav_path, duration=1.0)


@pytest.fixture
def sample_image(tmp_path: Path) -> Path:
    """Fixture providing a valid test JPEG image."""
    img_path = tmp_path / "fixtures" / "sample.jpg"
    return generate_test_image(img_path)


@pytest.fixture(autouse=True)
def mock_external_network_services(monkeypatch, tmp_path: Path):
    """
    Autouse fixture that intercepts network calls across yt-dlp and LRCLIB,
    updates static mount directories to point to the isolated test folder,
    and isolates heavy AI Demucs subprocess calls by creating instant valid synthetic stems.
    Guarantees 100% offline, hermetic, sub-second test execution.
    """
    mock_audio_dir = tmp_path / "mock_media"
    mock_audio_dir.mkdir(parents=True, exist_ok=True)
    default_source_wav = generate_sine_wave_wav(mock_audio_dir / "default_source.wav", duration=1.5)
    default_thumb_jpg = generate_test_image(mock_audio_dir / "default_thumb.jpg")

    # Update mounted StaticFiles apps to point to isolated test dirs
    for route in main_mod.app.routes:
        rname = getattr(route, "name", None)
        target_dir = None
        if rname == "downloads":
            target_dir = main_mod.DOWNLOADS_DIR
        elif rname == "stems":
            target_dir = main_mod.STEMS_DIR
        elif rname == "output":
            target_dir = main_mod.OUTPUT_DIR
        elif rname == "backgrounds":
            target_dir = main_mod.BACKGROUNDS_DIR

        if target_dir and hasattr(route, "app"):
            monkeypatch.setattr(route.app, "directory", str(target_dir))
            if hasattr(route.app, "all_directories"):
                monkeypatch.setattr(route.app, "all_directories", [str(target_dir)])

    # Sync service singleton output directories
    monkeypatch.setattr(main_mod.downloader, "output_dir", main_mod.DOWNLOADS_DIR)
    monkeypatch.setattr(main_mod.separator, "output_base_dir", main_mod.STEMS_DIR)
    monkeypatch.setattr(main_mod.audio_mixer, "output_dir", main_mod.OUTPUT_DIR)
    monkeypatch.setattr(main_mod.video_renderer, "output_dir", main_mod.OUTPUT_DIR)

    # 1. Mock TrackDownloader search_tracks
    def mock_search_tracks(query: str, limit: int = 5):
        clean_q = query.strip()
        if not clean_q:
            return []
        count = min(max(1, limit), 10)
        return [
            {
                "id": f"track_{i}_{abs(hash(clean_q)) % 10000}",
                "title": f"Result {i} for {clean_q}",
                "artist": "Mock Artist",
                "duration": 180,
                "url": f"https://www.youtube.com/watch?v=mock_{i}",
                "thumbnail": f"https://img.youtube.com/vi/mock_{i}/hqdefault.jpg",
            }
            for i in range(count)
        ]

    monkeypatch.setattr(main_mod.downloader, "search_tracks", mock_search_tracks)

    # 2. Mock TrackDownloader extract_info_and_download
    def mock_extract_info_and_download(url_or_id: str, progress_hook=None):
        vid_id = main_mod.downloader.extract_video_id(url_or_id) or "test_track"
        target_wav = main_mod.DOWNLOADS_DIR / f"{vid_id}.wav"
        target_thumb = main_mod.DOWNLOADS_DIR / f"{vid_id}.jpg"

        if not target_wav.exists():
            shutil.copyfile(default_source_wav, target_wav)
        if not target_thumb.exists():
            shutil.copyfile(default_thumb_jpg, target_thumb)

        if progress_hook:
            progress_hook(
                {
                    "status": "downloading",
                    "total_bytes": 1000000,
                    "downloaded_bytes": 1000000,
                    "speed": 5000000,
                    "eta": 0,
                }
            )
            progress_hook({"status": "finished"})

        return {
            "id": vid_id,
            "title": f"Mock Title for {vid_id}",
            "artist": "Mock Artist",
            "duration": 1.5,
            "audio_path": str(target_wav),
            "thumbnail_path": str(target_thumb),
        }

    monkeypatch.setattr(
        main_mod.downloader, "extract_info_and_download", mock_extract_info_and_download
    )

    # 3. Mock AudioSeparator separate_stems
    def mock_separate_stems(
        audio_path: str,
        track_id: str,
        model_name: str = "htdemucs",
        duration=None,
        progress_callback=None,
        cancel_event=None,
    ):
        if not Path(audio_path).exists():
            raise FileNotFoundError(f"Input audio file not found: {audio_path}")

        stems_dir = main_mod.STEMS_DIR / track_id
        stems_dir.mkdir(parents=True, exist_ok=True)
        vocals_file = stems_dir / "vocals.wav"
        inst_file = stems_dir / "instrumental.wav"

        if not vocals_file.exists():
            generate_sine_wave_wav(vocals_file, duration=1.5, freq=880.0)
        if not inst_file.exists():
            generate_sine_wave_wav(inst_file, duration=1.5, freq=440.0)

        if progress_callback:
            progress_callback(50.0, "Separating stems...", 2)
            progress_callback(100.0, "Stems isolated", 0)

        return {
            "vocals_path": str(vocals_file),
            "instrumental_path": str(inst_file),
        }

    monkeypatch.setattr(main_mod.separator, "separate_stems", mock_separate_stems)

    # 4. Mock LyricsService fetch_lyrics
    def mock_fetch_lyrics(track_title: str, artist_name: str, duration=None):
        return {
            "source": "lrclib_mock",
            "synced": True,
            "plain_lyrics": "First line of the song\nSecond line singing strong",
            "lrc": "[00:00.50] First line of the song\n[00:02.00] Second line singing strong",
            "lines": [
                {
                    "id": 0,
                    "text": "First line of the song",
                    "start_time": 0.50,
                    "end_time": 1.80,
                    "words": [
                        {"word": "First", "start_time": 0.50, "end_time": 0.70},
                        {"word": "line", "start_time": 0.70, "end_time": 1.00},
                        {"word": "of", "start_time": 1.00, "end_time": 1.20},
                        {"word": "the", "start_time": 1.20, "end_time": 1.40},
                        {"word": "song", "start_time": 1.40, "end_time": 1.80},
                    ],
                },
                {
                    "id": 1,
                    "text": "Second line singing strong",
                    "start_time": 2.00,
                    "end_time": 3.20,
                    "words": [
                        {"word": "Second", "start_time": 2.00, "end_time": 2.30},
                        {"word": "line", "start_time": 2.30, "end_time": 2.60},
                        {"word": "singing", "start_time": 2.60, "end_time": 2.90},
                        {"word": "strong", "start_time": 2.90, "end_time": 3.20},
                    ],
                },
            ],
        }

    monkeypatch.setattr(main_mod.lyrics_service, "fetch_lyrics", mock_fetch_lyrics)


@pytest.fixture
def project_factory():
    """
    Factory fixture to build test projects in arbitrary states
    with genuine synthetic audio files on disk and persisted in projects.json.
    """

    def _create_project(
        project_id: str | None = None,
        status: str = "ready",
        title: str = "Test Anthem",
        artist: str = "Star Singer",
        created_by: str = "TestUser",
        duration: float = 2.0,
        custom_lines=None,
        with_stems: bool = True,
        with_master: bool = True,
    ):
        pid = project_id or f"proj_{uuid.uuid4().hex[:8]}"

        # Audio & Stems
        track_dir = main_mod.STEMS_DIR / pid
        track_dir.mkdir(parents=True, exist_ok=True)
        vocals_path = track_dir / "vocals.wav"
        instrumental_path = track_dir / "instrumental.wav"

        if with_stems:
            generate_sine_wave_wav(vocals_path, duration=duration, freq=880.0)
            generate_sine_wave_wav(instrumental_path, duration=duration, freq=440.0)

        # Downloaded audio
        dl_wav = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
        generate_sine_wave_wav(dl_wav, duration=duration, freq=440.0)

        # Output master
        master_path = main_mod.OUTPUT_DIR / f"{pid}_master.wav"
        if with_master:
            generate_sine_wave_wav(master_path, duration=duration, freq=440.0)

        lines = (
            custom_lines
            if custom_lines is not None
            else [
                {
                    "id": 0,
                    "text": "Singing in the studio",
                    "start_time": 0.2,
                    "end_time": 1.2,
                    "words": [
                        {"word": "Singing", "start_time": 0.2, "end_time": 0.5},
                        {"word": "in", "start_time": 0.5, "end_time": 0.7},
                        {"word": "the", "start_time": 0.7, "end_time": 0.9},
                        {"word": "studio", "start_time": 0.9, "end_time": 1.2},
                    ],
                }
            ]
        )

        proj_record = {
            "id": pid,
            "track_id": pid,
            "title": title,
            "artist": artist,
            "status": status,
            "progress": 100 if status == "ready" else 10,
            "status_detail": "Ready for karaoke" if status == "ready" else "In progress",
            "duration": duration,
            "created_by": created_by,
            "created_at": int(time.time()),
            "lines": lines,
            "semitones": 0,
            "guide_volume": 0.0,
            "audio_url": f"/static/downloads/{pid}.wav",
            "thumbnail_path": str(generate_test_image(main_mod.DOWNLOADS_DIR / f"{pid}.jpg")),
        }

        if with_stems:
            proj_record["vocals_url"] = f"/static/stems/{pid}/vocals.wav"
            proj_record["instrumental_url"] = f"/static/stems/{pid}/instrumental.wav"
            proj_record["vocals_path"] = str(vocals_path)
            proj_record["instrumental_path"] = str(instrumental_path)

        if with_master:
            proj_record["master_audio_path"] = str(master_path)
            proj_record["master_audio_url"] = f"/static/output/{pid}_master.wav"

        with main_mod.PROJECTS_LOCK:
            main_mod.projects[pid] = proj_record
            main_mod.save_projects()

        return proj_record

    return _create_project
