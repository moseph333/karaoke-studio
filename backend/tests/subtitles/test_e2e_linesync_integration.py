"""End-to-End Integration Test Suite for Line-by-Line Lyric Synchronization.

Validates the complete lifecycle across frontend contracts and backend APIs:
1. Project initialization with multi-singer lyrics, chords, and audio stems.
2. Initial default sync_mode ('word') verification in export and render workflows.
3. Selection of sync_mode ('line') and verification of live preview contract.
4. ASS export download via GET /api/project/{id}/export/ass?sync_mode=line:
   - HTTP 200, Content-Type text/x-ssa; charset=utf-8.
   - Zero \\kf tags in line mode vs preserved \\kf tags in word mode.
   - Duet parts' colours, the look's and custom ones.
5. Video render job submission via POST /api/project/{id}/render:
   - Accepts sync_mode in RenderRequest body.
   - Sets project render_status to queued.
6. Background worker processing:
   - Subtitle file generation with sync_mode='line'.
   - Output validation on disk (zero \\kf tags on lyrics, preserved count-in and chords).
7. Error boundaries and invalid parameter handling (400 for bad export params, 422 for bad schema).
8. Non-destructive integrity: all word timestamps and project structures remain completely unmodified.
"""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app, projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass


def lyric_rows(ass_text: str) -> list[AssEvent]:
    """The events that draw a line being sung: one per row of each line, in file order."""
    return [e for e in ass_events(ass_text) if e.kind == "lyric"]


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

    word_lyric_events = lyric_rows(ass_word_content)
    assert {event.line for event in word_lyric_events} == {0, 1, 2}

    # In word mode, every lyric line must have \kf progressive sweep tags
    for event in word_lyric_events:
        assert "\\kf" in event.text, f"Expected \\kf in word mode: {event.text}"

    # -------------------------------------------------------------------------
    # Step 2: Line sync mode ASS export (in the KTV look, which writes the words as they are
    # in the lyrics)
    # -------------------------------------------------------------------------
    resp_line = client.get(
        f"/api/project/{pid}/export/ass?sync_mode=line&theme_id=ktv", headers=auth_headers
    )
    assert resp_line.status_code == 200
    assert "text/x-ssa" in resp_line.headers["content-type"]
    ass_line_content = resp_line.text

    line_lyric_events = lyric_rows(ass_line_content)
    assert [event.line for event in line_lyric_events] == [0, 1, 2]

    # In line mode, lyric events must contain ZERO \kf tags: each line waits unsung
    # ({\k<lead-in>}{\k0}), then changes colour at once when it starts
    for event, line in zip(line_lyric_events, e2e_project["lines"], strict=True):
        assert "\\kf" not in event.text, f"Lyric event contains \\kf in line mode: {event.text}"
        lead_in = round((line["start_time"] - event.start) * 100)
        assert lead_in > 0
        assert event.text.endswith(f"}}{{\\k{lead_in}}}{{\\k0}}{line['text']}")

    # Verify song lyrics are completely preserved in line mode
    assert [event.plain for event in line_lyric_events] == [
        "First verse line for singer one",
        "Second chorus line for singer two",
        "Both singers harmonizing together",
    ]

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

    disk_events = ass_events(disk_ass_content)
    disk_lyric_events = [e for e in disk_events if e.kind == "lyric"]
    assert {e.line for e in disk_lyric_events} == {0, 1, 2}

    # Verify zero \kf tags in the lyric lines, and the request's duet colours on them
    for event in disk_lyric_events:
        assert event.layer == 0
        assert "\\kf" not in event.text
        if event.line == 1:
            assert "\\1c&HB469FF&" in event.tags  # #FF69B4 in BGR
        if event.line == 2:
            assert "\\1c&HFFFF00&" in event.tags  # #00FFFF in BGR

    # Verify the count-in (Layer 1) is preserved in the gap before line 2: its last 3 s
    countdown_events = [e for e in disk_events if e.kind == "countin"]
    assert {(e.layer, e.line) for e in countdown_events} == {(1, 1)}
    assert min(e.start for e in countdown_events) == 7.0
    assert max(e.end for e in countdown_events) == 10.0

    # Verify chords (Layer 2) are preserved
    chord_events = [e for e in disk_events if e.kind == "chord"]
    assert [(e.layer, e.plain) for e in chord_events] == [(2, "C"), (2, "G"), (2, "F")]

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
    disk_lyric_events = lyric_rows(disk_ass_content)
    assert {event.line for event in disk_lyric_events} == {0, 1, 2}
    for event in disk_lyric_events:
        assert "\\kf" not in event.text
        # The sung colour of the nested style_config applies to Singer 1's line
        if event.line == 0:
            assert "\\1c&H00AAFF&" in event.tags  # #FFAA00 in BGR


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

    lyric_events = lyric_rows(resp.text)
    assert {event.line for event in lyric_events} == {0, 1, 2}
    for event in lyric_events:
        assert "\\kf" not in event.text

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
    disk_lyric_events = lyric_rows(disk_ass_content)
    assert {event.line for event in disk_lyric_events} == {0, 1, 2}
    for event in disk_lyric_events:
        assert "\\kf" not in event.text


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
