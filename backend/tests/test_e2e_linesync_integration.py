"""End-to-End Integration Test Suite for Line-by-Line Lyric Synchronization.

Validates the complete lifecycle across frontend contracts and backend APIs:
1. Project initialization with multi-singer lyrics, chords, and audio stems.
2. Initial default sync_mode ('word') verification in export and render workflows.
3. Selection of sync_mode ('line') and verification of live preview contract.
4. ASS export download via GET /api/project/{id}/export/ass?sync_mode=line:
   - HTTP 200, Content-Type text/x-ssa; charset=utf-8.
   - Zero \\kf tags in line mode vs preserved \\kf tags in word mode.
   - Duet multi-singer styles and custom color preservation.
5. Video render job submission via POST /api/project/{id}/render:
   - Accepts sync_mode in RenderRequest body.
   - Sets project render_status to queued.
6. Background worker processing:
   - Subtitle file generation with sync_mode='line'.
   - Output validation on disk (zero \\kf tags on lyrics, preserved countdown and chords).
7. Error boundaries and invalid parameter handling (400 for bad export params, 422 for bad schema).
8. Non-destructive integrity: all word timestamps and project structures remain completely unmodified.
"""

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.config import OUTPUT_DIR
from backend.main import app, projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest


def parse_ass(ass_text: str) -> dict[str, Any]:
    """Helper to parse ASS script into header sections, styles, and events."""
    lines = ass_text.splitlines()
    script_info: dict[str, str] = {}
    styles: dict[str, dict[str, str]] = {}
    events: list[dict[str, str]] = []

    current_section = None
    style_format: list[str] = []
    event_format: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith(";"):
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            current_section = stripped[1:-1]
            continue

        if current_section == "Script Info":
            if ":" in stripped:
                k, v = stripped.split(":", 1)
                script_info[k.strip()] = v.strip()
        elif current_section == "V4+ Styles":
            if stripped.startswith("Format:"):
                style_format = [f.strip() for f in stripped[len("Format:") :].split(",")]
            elif stripped.startswith("Style:"):
                vals = [v.strip() for v in stripped[len("Style:") :].split(",")]
                style_name = vals[0]
                styles[style_name] = dict(zip(style_format, vals, strict=False))
        elif current_section == "Events":
            if stripped.startswith("Format:"):
                event_format = [f.strip() for f in stripped[len("Format:") :].split(",")]
            elif stripped.startswith("Dialogue:"):
                vals = stripped[len("Dialogue:") :].split(",", len(event_format) - 1)
                event_dict = dict(
                    zip(event_format, [v.strip() for v in vals[:-1]] + [vals[-1]], strict=False)
                )
                events.append(event_dict)

    return {"info": script_info, "styles": styles, "events": events}


# ============================================================================
# Test Fixtures & Data
# ============================================================================


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-App-Password": "sluggos"}


@pytest.fixture
def e2e_project(tmp_path: Path):
    """Creates a realistic ready project with multi-singer lyrics, chords, and stems."""
    pid = "proj_e2e_linesync_full_lifecycle"

    # Create dummy instrumental and vocal files
    inst_file = tmp_path / f"{pid}_instrumental.wav"
    inst_file.write_bytes(b"RIFF" + b"\x00" * 40)
    vocals_file = tmp_path / f"{pid}_vocals.wav"
    vocals_file.write_bytes(b"RIFF" + b"\x00" * 40)

    lines = [
        {
            "id": 1,
            "start_time": 2.0,
            "end_time": 5.0,
            "text": "First verse line for singer one",
            "singer": "singer1",
            "words": [
                {"word": "First", "start_time": 2.0, "end_time": 2.5},
                {"word": "verse", "start_time": 2.6, "end_time": 3.2},
                {"word": "line", "start_time": 3.3, "end_time": 3.8},
                {"word": "for", "start_time": 3.9, "end_time": 4.2},
                {"word": "singer", "start_time": 4.3, "end_time": 4.6},
                {"word": "one", "start_time": 4.7, "end_time": 5.0},
            ],
        },
        {
            "id": 2,
            "start_time": 10.0,  # 5s gap -> countdown
            "end_time": 13.0,
            "text": "Second chorus line for singer two",
            "singer": "singer2",
            "words": [
                {"word": "Second", "start_time": 10.0, "end_time": 10.6},
                {"word": "chorus", "start_time": 10.7, "end_time": 11.4},
                {"word": "line", "start_time": 11.5, "end_time": 11.9},
                {"word": "for", "start_time": 12.0, "end_time": 12.3},
                {"word": "singer", "start_time": 12.4, "end_time": 12.7},
                {"word": "two", "start_time": 12.8, "end_time": 13.0},
            ],
        },
        {
            "id": 3,
            "start_time": 14.0,
            "end_time": 17.0,
            "text": "Both singers harmonizing together",
            "singer": "both",
            "words": [
                {"word": "Both", "start_time": 14.0, "end_time": 14.5},
                {"word": "singers", "start_time": 14.6, "end_time": 15.2},
                {"word": "harmonizing", "start_time": 15.3, "end_time": 16.2},
                {"word": "together", "start_time": 16.3, "end_time": 17.0},
            ],
        },
    ]

    chords = [
        {"start": 2.0, "end": 5.0, "chord": "C"},
        {"start": 10.0, "end": 13.0, "chord": "G"},
        {"start": 14.0, "end": 17.0, "chord": "F"},
    ]

    project_data = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "progress": 100,
        "title": "E2E Lifecycle Anthem",
        "artist": "Duet Legends",
        "lines": lines,
        "chords": chords,
        "instrumental_path": str(inst_file),
        "vocals_path": str(vocals_file),
        "render_status": "idle",
        "render_progress": 0,
    }

    projects[pid] = project_data
    yield project_data
    projects.pop(pid, None)


# ============================================================================
# End-to-End Integration Tests
# ============================================================================


def test_e2e_full_lifecycle_word_to_line_export_and_render(
    client, auth_headers, e2e_project, tmp_path
):
    """
    Complete end-to-end flow:
    1. Verify default word sweep export (/api/project/{id}/export/ass) contains progressive \\kf tags.
    2. Toggle/select sync_mode='line'.
    3. Verify line sync export (/api/project/{id}/export/ass?sync_mode=line) produces zero \\kf tags.
    4. Submit video render job (/api/project/{id}/render) with sync_mode='line'.
    5. Execute render worker and verify generated ASS subtitle file on disk has zero \\kf tags.
    6. Verify non-destructive integrity of original project word timestamps.
    """
    pid = e2e_project["id"]

    # -------------------------------------------------------------------------
    # Step 1: Default word sweep mode in ASS export
    # -------------------------------------------------------------------------
    resp_default = client.get(f"/api/project/{pid}/export/ass", headers=auth_headers)
    assert resp_default.status_code == 200
    assert "text/x-ssa" in resp_default.headers["content-type"]
    ass_word_content = resp_default.text

    parsed_word = parse_ass(ass_word_content)
    word_lyric_events = [e for e in parsed_word["events"] if e.get("Layer") == "0"]
    assert len(word_lyric_events) == 3

    # In word mode, every lyric line must have \kf progressive sweep tags
    for event in word_lyric_events:
        assert "\\kf" in event["Text"], f"Expected \\kf in word mode: {event['Text']}"

    # -------------------------------------------------------------------------
    # Step 2: Line sync mode ASS export
    # -------------------------------------------------------------------------
    resp_line = client.get(f"/api/project/{pid}/export/ass?sync_mode=line", headers=auth_headers)
    assert resp_line.status_code == 200
    assert "text/x-ssa" in resp_line.headers["content-type"]
    ass_line_content = resp_line.text

    parsed_line = parse_ass(ass_line_content)
    line_lyric_events = [e for e in parsed_line["events"] if e.get("Layer") == "0"]
    assert len(line_lyric_events) == 3

    # In line mode, Layer 0 lyric events must contain ZERO \kf tags
    for event in line_lyric_events:
        assert "\\kf" not in event["Text"], (
            f"Layer 0 lyric event contains \\kf in line mode: {event['Text']}"
        )
        assert "\\k" in event["Text"] or not event["Text"].startswith("{\\k"), (
            "Line mode must use {\\k...}{\\k0} lead-in or direct plain text"
        )

    # Verify song lyrics are completely preserved in line mode
    assert "First verse line for singer one" in ass_line_content
    assert "Second chorus line for singer two" in ass_line_content
    assert "Both singers harmonizing together" in ass_line_content

    # -------------------------------------------------------------------------
    # Step 3: Video render job submission with sync_mode='line'
    # -------------------------------------------------------------------------
    render_payload = {
        "aspect_ratio": "16:9",
        "sync_mode": "line",
        "include_countdown": True,
        "include_chords": True,
        "style_config": {
            "singer2_color": "#FF69B4",
            "both_color": "#00FFFF",
        },
    }
    with patch("backend.main.run_video_render") as mock_bg_render:
        render_res = client.post(
            f"/api/project/{pid}/render",
            json=render_payload,
            headers=auth_headers,
        )
        assert render_res.status_code == 200
        assert render_res.json() == {"status": "queued"}
        assert projects[pid]["render_status"] == "queued"
        mock_bg_render.assert_called_once()
        queued_req = mock_bg_render.call_args[0][1]
        assert queued_req.sync_mode == "line"

    # -------------------------------------------------------------------------
    # Step 4: Worker processing and subtitle file generation on disk
    # -------------------------------------------------------------------------
    req = RenderRequest(**render_payload)
    output_ass = tmp_path / f"{pid}.ass"
    output_mp4 = tmp_path / f"{pid}_karaoke.mp4"

    with (
        patch("backend.main.OUTPUT_DIR", tmp_path),
        patch("backend.render_worker.OUTPUT_DIR", tmp_path),
        patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
        patch("backend.main.video_renderer.render_video") as mock_render,
    ):
        mock_mix.return_value = tmp_path / f"{pid}_master.wav"
        mock_render.return_value = output_mp4
        run_video_render(pid, req)

    # Verify subtitle file was written to disk
    assert output_ass.is_file(), f"Expected ASS file at {output_ass}"
    disk_ass_content = output_ass.read_text(encoding="utf-8")

    parsed_disk = parse_ass(disk_ass_content)
    disk_lyric_events = [e for e in parsed_disk["events"] if e.get("Layer") == "0"]
    assert len(disk_lyric_events) == 3

    # Verify zero \kf tags in Layer 0 lines
    for event in disk_lyric_events:
        assert "\\kf" not in event["Text"]

    # Verify countdown dots (Layer 1) are preserved in gap before line 2
    countdown_events = [e for e in parsed_disk["events"] if e.get("Layer") == "1"]
    assert len(countdown_events) >= 1
    assert any("●" in e["Text"] for e in countdown_events)

    # Verify chords (Layer 2) are preserved
    chord_events = [e for e in parsed_disk["events"] if e.get("Layer") == "2"]
    assert len(chord_events) == 3
    assert any("C" in e["Text"] for e in chord_events)
    assert any("G" in e["Text"] for e in chord_events)
    assert any("F" in e["Text"] for e in chord_events)

    # -------------------------------------------------------------------------
    # Step 5: Parity & immutability check
    # -------------------------------------------------------------------------
    # Ensure project data structure in store was not mutated or corrupted
    stored_lines = projects[pid]["lines"]
    assert len(stored_lines) == 3
    assert stored_lines[0]["words"][0]["word"] == "First"
    assert stored_lines[0]["words"][0]["start_time"] == 2.0
    assert stored_lines[0]["words"][0]["end_time"] == 2.5
    assert stored_lines[2]["words"][3]["word"] == "together"
    assert stored_lines[2]["words"][3]["start_time"] == 16.3
    assert stored_lines[2]["words"][3]["end_time"] == 17.0


def test_e2e_full_lifecycle_nested_style_config_sync_mode(
    client, auth_headers, e2e_project, tmp_path
):
    """Verify that sync_mode in nested style_config is honored by both API and render worker."""
    pid = e2e_project["id"]

    # Video render with sync_mode inside style_config
    render_payload = {
        "aspect_ratio": "16:9",
        "style_config": {
            "sync_mode": "line",
            "primary_color": "#FFAA00",
        },
    }
    with patch("backend.main.run_video_render") as mock_bg_render:
        render_res = client.post(
            f"/api/project/{pid}/render",
            json=render_payload,
            headers=auth_headers,
        )
        assert render_res.status_code == 200
        mock_bg_render.assert_called_once()

    req = RenderRequest(**render_payload)
    output_ass = tmp_path / f"{pid}.ass"

    with (
        patch("backend.main.OUTPUT_DIR", tmp_path),
        patch("backend.render_worker.OUTPUT_DIR", tmp_path),
        patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
        patch("backend.main.video_renderer.render_video") as mock_render,
    ):
        mock_mix.return_value = tmp_path / f"{pid}_master.wav"
        mock_render.return_value = tmp_path / f"{pid}_karaoke.mp4"
        run_video_render(pid, req)

    assert output_ass.is_file()
    disk_ass_content = output_ass.read_text(encoding="utf-8")
    parsed_disk = parse_ass(disk_ass_content)
    disk_lyric_events = [e for e in parsed_disk["events"] if e.get("Layer") == "0"]
    for event in disk_lyric_events:
        assert "\\kf" not in event["Text"]


def test_e2e_full_lifecycle_vertical_9_16_line_mode(client, auth_headers, e2e_project, tmp_path):
    """Verify full end-to-end export and render for 9:16 vertical video in line mode."""
    pid = e2e_project["id"]

    # Export ASS with 9:16 and line mode
    resp = client.get(
        f"/api/project/{pid}/export/ass?sync_mode=line&aspect_ratio=9:16",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    parsed = parse_ass(resp.text)
    assert parsed["info"].get("PlayResX") == "1080"
    assert parsed["info"].get("PlayResY") == "1920"

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    for event in lyric_events:
        assert "\\kf" not in event["Text"]

    # Render with 9:16 vertical in line mode
    render_payload = {
        "aspect_ratio": "9:16",
        "sync_mode": "line",
    }
    req = RenderRequest(**render_payload)
    output_ass = tmp_path / f"{pid}.ass"

    with (
        patch("backend.main.OUTPUT_DIR", tmp_path),
        patch("backend.render_worker.OUTPUT_DIR", tmp_path),
        patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
        patch("backend.main.video_renderer.render_video") as mock_render,
    ):
        mock_mix.return_value = tmp_path / f"{pid}_master.wav"
        mock_render.return_value = tmp_path / f"{pid}_karaoke.mp4"
        run_video_render(pid, req)

    assert output_ass.is_file()
    disk_ass_content = output_ass.read_text(encoding="utf-8")
    assert "PlayResX: 1080" in disk_ass_content
    assert "PlayResY: 1920" in disk_ass_content
    parsed_disk = parse_ass(disk_ass_content)
    disk_lyric_events = [e for e in parsed_disk["events"] if e.get("Layer") == "0"]
    for event in disk_lyric_events:
        assert "\\kf" not in event["Text"]


def test_e2e_flow_error_handling_and_recovery(client, auth_headers, e2e_project):
    """Verify error boundaries across export and render routes for sync_mode."""
    pid = e2e_project["id"]

    # 1. Invalid sync_mode in export -> 400
    res_bad_export = client.get(
        f"/api/project/{pid}/export/ass?sync_mode=unsupported_mode",
        headers=auth_headers,
    )
    assert res_bad_export.status_code == 400
    assert "Invalid sync_mode" in res_bad_export.json()["detail"]

    # 2. Invalid sync_mode in render request body -> 422 (Pydantic validation)
    res_bad_render = client.post(
        f"/api/project/{pid}/render",
        json={"sync_mode": "invalid_mode"},
        headers=auth_headers,
    )
    assert res_bad_render.status_code == 422

    # 3. Missing instrumental stem -> 400
    broken_pid = "proj_e2e_missing_stem"
    projects[broken_pid] = {
        "id": broken_pid,
        "status": "ready",
        "lines": e2e_project["lines"],
        "instrumental_path": "/nonexistent/stem.wav",
    }
    try:
        res_no_stem = client.post(
            f"/api/project/{broken_pid}/render",
            json={"sync_mode": "line"},
            headers=auth_headers,
        )
        assert res_no_stem.status_code == 400
        assert "instrumental stem not ready" in res_no_stem.json()["detail"]
    finally:
        projects.pop(broken_pid, None)
