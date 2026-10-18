"""
Unit and integration tests for in-studio lyric realignment and re-import endpoint.
Tests POST /api/project/{project_id}/realign-lyrics.
"""

import uuid
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.main import projects, save_projects


def create_synthetic_wav(
    file_path: Path, duration: float = 1.0, sr: int = 44100, freq: float = 440.0
) -> Path:
    """Generate a valid stereo sine-wave WAV file on disk for offline testing."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.3 * np.sin(2 * np.pi * freq * t)
    stereo = np.column_stack((sine, sine))
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), stereo, sr)
    return file_path


@pytest.fixture
def test_project_factory():
    """Factory creating isolated test projects with optional synthetic stems and metadata."""

    def _create_project(
        project_id: str | None = None,
        title: str = "Test Anthem",
        artist: str = "Studio Artist",
        status: str = "ready",
        with_stems: bool = True,
        with_master: bool = True,
        created_by: str = "StudioTester",
        lines: list | None = None,
    ) -> dict:
        pid = project_id or f"proj_{uuid.uuid4().hex[:8]}"

        proj_data = {
            "id": pid,
            "track_id": pid,
            "title": title,
            "artist": artist,
            "duration": 120.0,
            "status": status,
            "progress": 100 if status == "ready" else 50,
            "created_by": created_by,
            "lines": (
                lines
                if lines is not None
                else [
                    {
                        "id": 1,
                        "text": "Initial lyric line",
                        "start_time": 1.0,
                        "end_time": 4.0,
                        "words": [
                            {"word": "Initial", "start_time": 1.0, "end_time": 2.0},
                            {"word": "lyric", "start_time": 2.0, "end_time": 3.0},
                            {"word": "line", "start_time": 3.0, "end_time": 4.0},
                        ],
                    }
                ]
            ),
            "semitones": 0,
            "guide_volume": 0.0,
        }

        if with_stems:
            stem_dir = main_mod.STEMS_DIR / pid
            stem_dir.mkdir(parents=True, exist_ok=True)
            vocal_path = stem_dir / "vocals.wav"
            inst_path = stem_dir / "instrumental.wav"
            create_synthetic_wav(vocal_path, duration=1.0, freq=880.0)
            create_synthetic_wav(inst_path, duration=1.0, freq=440.0)
            proj_data["vocals_path"] = str(vocal_path)
            proj_data["instrumental_path"] = str(inst_path)
            proj_data["vocals_url"] = f"/static/stems/{pid}/vocals.wav"
            proj_data["instrumental_url"] = f"/static/stems/{pid}/instrumental.wav"

        if with_master:
            master_file = main_mod.OUTPUT_DIR / f"{pid}_master.wav"
            create_synthetic_wav(master_file, duration=1.0, freq=440.0)
            proj_data["master_audio_path"] = str(master_file)
            proj_data["master_audio_url"] = f"/static/output/{pid}_master.wav"

        projects[pid] = proj_data
        save_projects()
        return proj_data

    return _create_project


def test_realign_lyrics_project_not_found(client: TestClient):
    """Returns 404 when project does not exist."""
    res = client.post(
        "/api/project/nonexistent_proj_id/realign-lyrics",
        json={"custom_lyrics": "Some lyrics", "fetch_lrclib": False},
    )
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_realign_lyrics_missing_vocals(client: TestClient, test_project_factory):
    """Returns 400 when vocal stem is missing or not ready."""
    proj = test_project_factory(with_stems=False)
    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"custom_lyrics": "Some lyrics here"},
    )
    assert res.status_code == 400
    assert "vocal stem missing" in res.json()["detail"].lower()


def test_realign_lyrics_empty_request(client: TestClient, test_project_factory):
    """Returns 400 when neither custom_lyrics nor fetch_lrclib is provided."""
    proj = test_project_factory(with_stems=True)
    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"custom_lyrics": "   ", "fetch_lrclib": False},
    )
    assert res.status_code == 400
    assert "either custom_lyrics or fetch_lrclib" in res.json()["detail"]


def test_realign_lyrics_with_custom_lrc(client: TestClient, test_project_factory):
    """Processes LRC lyrics, aligns with vocal stem, and updates project."""
    proj = test_project_factory(with_stems=True)
    lrc_content = "[00:01.50] First synced line\n[00:05.20] Second synced line\n"

    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"custom_lyrics": lrc_content, "fetch_lrclib": False},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["is_synced"] is True
    assert len(data["lines"]) == 2
    assert "First synced line" in data["lines"][0]["text"]
    assert "Second synced line" in data["lines"][1]["text"]

    # Verify project in store was updated
    updated_proj = main_mod.projects[proj["id"]]
    assert len(updated_proj["lines"]) == 2
    assert updated_proj["is_synced"] is True


def test_realign_lyrics_with_plain_text(client: TestClient, test_project_factory):
    """Processes plain text lyrics, distributes lines, and aligns words."""
    proj = test_project_factory(with_stems=True)
    plain_text = "Hello world from studio\nSinging a new verse tonight"

    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"custom_lyrics": plain_text, "fetch_lrclib": False},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert len(data["lines"]) == 2
    assert data["lines"][0]["text"] == "Hello world from studio"
    assert data["lines"][1]["text"] == "Singing a new verse tonight"
    assert len(data["lines"][0]["words"]) > 0


def test_realign_lyrics_fetch_lrclib_success(client: TestClient, test_project_factory, monkeypatch):
    """Re-queries LRCLIB and realigns lyrics against vocal stem."""
    proj = test_project_factory(title="Bohemian Rhapsody", artist="Queen", with_stems=True)

    mock_lrclib_lines = [
        {
            "id": 1,
            "text": "Mama, just killed a man",
            "start_time": 2.0,
            "end_time": 6.0,
            "words": [
                {"word": "Mama,", "start_time": 2.0, "end_time": 3.0},
                {"word": "just", "start_time": 3.0, "end_time": 3.8},
                {"word": "killed", "start_time": 3.8, "end_time": 4.5},
                {"word": "a", "start_time": 4.5, "end_time": 5.0},
                {"word": "man", "start_time": 5.0, "end_time": 6.0},
            ],
        }
    ]

    monkeypatch.setattr(
        main_mod.lyrics_service,
        "fetch_lyrics",
        MagicMock(return_value={"source": "lrclib", "synced": True, "lines": mock_lrclib_lines}),
    )

    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"fetch_lrclib": True},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["source"] == "lrclib"
    assert len(data["lines"]) == 1
    assert data["lines"][0]["text"] == "Mama, just killed a man"


def test_realign_lyrics_no_lines_found(client: TestClient, test_project_factory, monkeypatch):
    """Returns 400 when LRCLIB returns no lines."""
    proj = test_project_factory(with_stems=True)

    monkeypatch.setattr(
        main_mod.lyrics_service,
        "fetch_lyrics",
        MagicMock(return_value={"source": "lrclib", "synced": False, "lines": []}),
    )

    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"fetch_lrclib": True},
    )
    assert res.status_code == 400
    assert "no lyric lines found" in res.json()["detail"].lower()


def test_realign_lyrics_updates_duration_and_youtube_package(
    client: TestClient, test_project_factory, monkeypatch
):
    """Expands project duration if aligned lines exceed existing duration, and regenerates youtube_package."""
    proj = test_project_factory(with_stems=True)
    proj["youtube_package"] = {"chapters": []}
    proj["duration"] = 5.0

    lrc_content = "[00:15.00] Late outro line fading away\n"

    res = client.post(
        f"/api/project/{proj['id']}/realign-lyrics",
        json={"custom_lyrics": lrc_content},
    )
    assert res.status_code == 200
    updated_proj = main_mod.projects[proj["id"]]
    assert updated_proj["duration"] >= 15.0
    assert "youtube_package" in updated_proj
