"""Integration and unit tests for direct audio stem exports (Requirement R2).

Tests GET /api/project/{project_id}/export/audio/{stem_type} for:
- instrumental, vocals, and master mix stem exports
- RFC 6266 and RFC 5987 Content-Disposition attachment headers
- File format and MIME detection (WAV, MP3, FLAC)
- Validation: 404 for missing project, 400 for unready project, 400 for invalid stem, 400 for missing file
- Non-Latin-1 international characters and emoji title handling
"""

import re
import urllib.parse
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app, projects


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-App-Password": "sluggos"}


@pytest.fixture
def temp_audio_project(tmp_path: Path):
    """Sets up a ready project with sample audio stem files on disk."""
    pid = "test_audio_stem_proj"
    inst_file = tmp_path / "instrumental.wav"
    vocals_file = tmp_path / "vocals.wav"
    master_file = tmp_path / "master.wav"

    inst_file.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00inst_sample_audio_data")
    vocals_file.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00vocal_sample_audio_data")
    master_file.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00master_mix_audio_data")

    project_data = {
        "id": pid,
        "title": "Starlight Melodies",
        "artist": "Luna & The Stars",
        "status": "ready",
        "instrumental_path": str(inst_file),
        "vocals_path": str(vocals_file),
        "master_audio_path": str(master_file),
        "instrumental_url": f"/static/stems/{pid}/instrumental.wav",
        "vocals_url": f"/static/stems/{pid}/vocals.wav",
        "master_audio_url": f"/static/output/{pid}_master.wav",
        "lines": [{"start": 1.0, "end": 4.0, "text": "Shining bright"}],
    }

    projects[pid] = project_data
    yield project_data
    projects.pop(pid, None)


def test_export_audio_instrumental_stem(client, auth_headers, temp_audio_project):
    """Verify exporting instrumental stem returns 200, audio/wav, and RFC 6266 header."""
    pid = temp_audio_project["id"]
    response = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert b"inst_sample_audio_data" in response.content

    cd = response.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert 'filename="' in cd
    assert "filename*=UTF-8''" in cd
    assert "Instrumental" in cd
    assert cd.endswith(".wav") or ".wav" in cd


def test_export_audio_vocals_stem(client, auth_headers, temp_audio_project):
    """Verify exporting vocal stem returns 200, audio/wav, and vocal data."""
    pid = temp_audio_project["id"]
    response = client.get(f"/api/project/{pid}/export/audio/vocals", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert b"vocal_sample_audio_data" in response.content

    cd = response.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert "Vocals" in cd


def test_export_audio_master_mix(client, auth_headers, temp_audio_project):
    """Verify exporting master mix returns 200, audio/wav, and master mix data."""
    pid = temp_audio_project["id"]
    response = client.get(f"/api/project/{pid}/export/audio/master", headers=auth_headers)

    assert response.status_code == 200
    assert response.headers["content-type"] == "audio/wav"
    assert b"master_mix_audio_data" in response.content

    cd = response.headers.get("content-disposition", "")
    assert "attachment" in cd
    assert "Master Mix" in cd


def test_export_audio_missing_project_returns_404(client, auth_headers):
    """Verify requesting audio stem for non-existent project returns 404."""
    response = client.get(
        "/api/project/non_existent_project_999/export/audio/instrumental",
        headers=auth_headers,
    )
    assert response.status_code == 404


def test_export_audio_unready_project_returns_400(client, auth_headers, tmp_path):
    """Verify requesting audio stem for unready project (e.g. downloading/separating) returns 400."""
    pid = "unready_audio_proj"
    projects[pid] = {
        "id": pid,
        "title": "In Progress Song",
        "artist": "Artist",
        "status": "downloading",
    }
    try:
        response = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)
        assert response.status_code == 400
        assert "not ready" in response.json()["detail"].lower()
    finally:
        projects.pop(pid, None)


def test_export_audio_invalid_stem_type_returns_400(client, auth_headers, temp_audio_project):
    """Verify requesting an unsupported stem type returns 400."""
    pid = temp_audio_project["id"]
    for invalid_stem in ["drums", "bass", "synth", "piano", "unknown"]:
        response = client.get(
            f"/api/project/{pid}/export/audio/{invalid_stem}",
            headers=auth_headers,
        )
        assert response.status_code == 400
        assert "invalid stem type" in response.json()["detail"].lower()


def test_export_audio_missing_file_on_disk_returns_400(client, auth_headers, tmp_path):
    """Verify requesting an audio stem whose file is deleted/missing returns 400."""
    pid = "missing_file_proj"
    projects[pid] = {
        "id": pid,
        "title": "Missing File Song",
        "artist": "Ghost",
        "status": "ready",
        "instrumental_path": str(tmp_path / "does_not_exist.wav"),
    }
    try:
        response = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)
        assert response.status_code == 400
        assert "not found on disk" in response.json()["detail"].lower()
    finally:
        projects.pop(pid, None)


def test_export_audio_custom_mp3_instrumental(client, auth_headers, tmp_path):
    """Verify custom uploaded MP3 instrumental exports with audio/mpeg content type and .mp3 ext."""
    pid = "custom_mp3_proj"
    mp3_file = tmp_path / "custom_inst.mp3"
    mp3_file.write_bytes(b"ID3\x04\x00\x00\x00\x00\x00\x20mp3_sample_frame_data")

    projects[pid] = {
        "id": pid,
        "title": "Acoustic Sunset",
        "artist": "Guitarist",
        "status": "ready",
        "instrumental_path": str(mp3_file),
    }
    try:
        response = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        assert b"mp3_sample_frame_data" in response.content

        cd = response.headers.get("content-disposition", "")
        assert ".mp3" in cd
    finally:
        projects.pop(pid, None)


def test_export_audio_international_and_emoji_titles(client, auth_headers, tmp_path):
    """Verify international and emoji titles in stem exports produce valid RFC 5987 / 6266 headers."""
    pid = "international_audio_proj"
    inst_file = tmp_path / "inst_intl.wav"
    inst_file.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00intl_audio_data")

    projects[pid] = {
        "id": pid,
        "title": "夜に駆ける 🚀 🌟",
        "artist": "YOASOBI 🎵",
        "status": "ready",
        "instrumental_path": str(inst_file),
    }
    try:
        response = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)
        assert response.status_code == 200

        cd = response.headers.get("content-disposition", "")
        # ASCII encodability check
        cd.encode("ascii")

        # RFC 5987 UTF-8 encoding check
        m_utf8 = re.search(r"filename\*=UTF-8''([^;\s]+)", cd)
        assert m_utf8 is not None
        decoded = urllib.parse.unquote(m_utf8.group(1))
        assert "夜に駆ける" in decoded
        assert "Instrumental" in decoded
    finally:
        projects.pop(pid, None)
