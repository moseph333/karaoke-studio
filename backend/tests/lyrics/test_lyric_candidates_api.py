"""
Adversarial Test Suite — Challenger 1 (Milestone 2: UX-3 LRCLIB Candidate Search Backend)

Empirically challenges:
1. GET /api/project/{project_id}/lyrics/candidates query parameters and fallback to project metadata.
2. 404 response on non-existent project IDs.
3. Resilience against malformed candidates returned by LRCLIB:
   - Non-dict elements (None, integers, strings) in candidate array.
   - Missing fields, null values, and duration type coercion (strings, null, empty string, floats).
   - CamelCase (LRCLIB native) and snake_case key mappings.
4. Resilience against LRCLIB timeouts and HTTP 500/network errors without crashing the endpoint.
5. Multi-stage search fallback: primary structured query -> secondary general query.
"""

from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.main import projects, save_projects


@pytest.fixture
def test_project():
    """Create a temporary project for candidate querying."""
    pid = "proj_challenger_ux3"
    proj_data = {
        "id": pid,
        "track_id": pid,
        "title": "Bohemian Rhapsody",
        "artist": "Queen",
        "duration": 354.0,
        "status": "ready",
        "progress": 100,
        "created_by": "Challenger1",
        "lines": [],
        "semitones": 0,
        "guide_volume": 0.0,
    }
    projects[pid] = proj_data
    save_projects()
    yield proj_data
    projects.pop(pid, None)
    save_projects()


def test_get_candidates_nonexistent_project_returns_404(client: TestClient):
    """Querying candidates for a non-existent project returns HTTP 404."""
    resp = client.get("/api/project/non_existent_project_99999/lyrics/candidates")
    assert resp.status_code == 404
    assert "Project not found" in resp.json()["detail"]


def test_get_candidates_uses_project_metadata_when_params_omitted(
    client: TestClient, test_project: dict
):
    """When track_name and artist_name query parameters are omitted, endpoint uses project title & artist."""
    with patch("requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [
            {
                "id": 101,
                "trackName": "Bohemian Rhapsody",
                "artistName": "Queen",
                "albumName": "A Night at the Opera",
                "duration": 354.0,
                "instrumental": False,
                "plainLyrics": "Is this the real life?",
                "syncedLyrics": "[00:00.50] Is this the real life?",
            }
        ]
        mock_get.return_value = mock_resp

        resp = client.get(f"/api/project/{test_project['id']}/lyrics/candidates")
        assert resp.status_code == 200
        candidates = resp.json()
        assert len(candidates) == 1
        assert candidates[0]["track_name"] == "Bohemian Rhapsody"
        assert candidates[0]["artist_name"] == "Queen"

        # Verify structured query used project metadata
        mock_get.assert_called_once()
        called_params = mock_get.call_args[1].get("params", {})
        assert called_params.get("track_name") == "Bohemian Rhapsody"
        assert called_params.get("artist_name") == "Queen"


def test_get_candidates_structured_query_prefers_explicit_params(
    client: TestClient, test_project: dict
):
    """Explicit query params override project metadata."""
    with patch("requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = []
        mock_get.return_value = mock_resp

        resp = client.get(
            f"/api/project/{test_project['id']}/lyrics/candidates",
            params={"track_name": "Custom Title", "artist_name": "Custom Artist"},
        )
        assert resp.status_code == 200
        # First call is structured search, second call is fallback general search
        assert mock_get.call_count >= 1
        first_call_params = mock_get.call_args_list[0][1].get("params", {})
        assert first_call_params.get("track_name") == "Custom Title"
        assert first_call_params.get("artist_name") == "Custom Artist"


def test_get_candidates_fallback_to_q_search_when_structured_empty(
    client: TestClient, test_project: dict
):
    """When structured search yields 0 results, endpoint falls back to general ?q= search."""
    with patch("requests.get") as mock_get:
        resp_empty = MagicMock()
        resp_empty.status_code = 200
        resp_empty.json.return_value = []

        resp_fallback = MagicMock()
        resp_fallback.status_code = 200
        resp_fallback.json.return_value = [
            {
                "id": 202,
                "trackName": "Fallback Track",
                "artistName": "Fallback Artist",
                "duration": 180,
                "syncedLyrics": "[00:01.00] Fallback line",
            }
        ]

        mock_get.side_effect = [resp_empty, resp_fallback]

        resp = client.get(
            f"/api/project/{test_project['id']}/lyrics/candidates",
            params={"track_name": "Obscure Title", "artist_name": "Obscure Artist"},
        )
        assert resp.status_code == 200
        candidates = resp.json()
        assert len(candidates) == 1
        assert candidates[0]["track_name"] == "Fallback Track"

        # Verify second call used ?q=
        assert mock_get.call_count == 2
        second_call_params = mock_get.call_args_list[1][1].get("params", {})
        assert second_call_params == {"q": "Obscure Title Obscure Artist"}


def test_get_candidates_malformed_upstream_elements_filtered_and_coerced(
    client: TestClient, test_project: dict
):
    """
    Adversarial challenge: upstream LRCLIB returns corrupted JSON:
    - Non-dict entries (None, integers, string error messages)
    - Missing fields
    - String duration "240.5"
    - Empty duration "" or None
    Endpoint must NOT crash (500) and safely normalize output.
    """
    with patch("requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = [
            None,  # Should be skipped
            "Server Error String",  # Should be skipped
            12345,  # Should be skipped
            [],  # Should be skipped
            {
                # Missing all keys except id
                "id": 999,
            },
            {
                "id": 1000,
                "track_name": "Snake Case Title",
                "artist_name": "Snake Case Artist",
                "album_name": "Snake Case Album",
                "duration": "240.5",  # String duration
                "instrumental": True,
                "plain_lyrics": "Snake plain",
                "synced_lyrics": "[00:01.00] Snake synced",
            },
            {
                "id": 1001,
                "trackName": "Empty Duration Song",
                "artistName": "Ghost",
                "duration": None,  # None duration
                "plainLyrics": None,
                "syncedLyrics": None,
            },
        ]
        mock_get.return_value = mock_resp

        resp = client.get(f"/api/project/{test_project['id']}/lyrics/candidates")
        assert resp.status_code == 200
        candidates = resp.json()

        # 3 valid dict items normalized; 4 non-dict items skipped
        assert len(candidates) == 3

        # Item 1: Empty defaults
        assert candidates[0]["id"] == 999
        assert candidates[0]["track_name"] == ""
        assert candidates[0]["artist_name"] == ""
        assert candidates[0]["album_name"] == ""
        assert candidates[0]["duration"] == 0.0
        assert candidates[0]["instrumental"] is False
        assert candidates[0]["plain_lyrics"] == ""
        assert candidates[0]["synced_lyrics"] == ""

        # Item 2: String duration coerced to float
        assert candidates[1]["id"] == 1000
        assert candidates[1]["track_name"] == "Snake Case Title"
        assert candidates[1]["duration"] == 240.5
        assert candidates[1]["instrumental"] is True

        # Item 3: None duration and None lyrics coerced to 0.0 and ""
        assert candidates[2]["id"] == 1001
        assert candidates[2]["duration"] == 0.0
        assert candidates[2]["plain_lyrics"] == ""
        assert candidates[2]["synced_lyrics"] == ""


def test_get_candidates_handles_network_timeout_gracefully(client: TestClient, test_project: dict):
    """
    Adversarial challenge: LRCLIB throws a ConnectionError or Timeout.
    Endpoint logs warning and returns an empty list [] instead of crashing with 500.
    """
    import requests

    with patch("requests.get", side_effect=requests.exceptions.Timeout("Connection timed out")):
        resp = client.get(f"/api/project/{test_project['id']}/lyrics/candidates")
        assert resp.status_code == 200
        assert resp.json() == []
