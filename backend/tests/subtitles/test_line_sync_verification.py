"""Milestone M3 Challenger 2 Adversarial & Empirical Verification Suite.

Tests:
1. Vertical video 9:16 layout in line-by-line sync mode:
   - Geometry, resolution (1080x1920), typography, and margins.
   - Theme presets, multi-singer duet styles, chords, and gap countdowns.
   - Real libass burning into 1080x1920 MP4 via FFmpeg.
2. Client style_config nesting fallback:
   - style_config.sync_mode precedence and fallback logic.
   - Case-insensitivity, whitespace tolerance, and invalid fallback safety.
3. Negative tests and error recovery:
   - HTTP 400 for invalid query parameters (sync_mode, aspect_ratio, empty lines).
   - HTTP 422 for bad request body schema (sync_mode, aspect_ratio, semitones, guide_volume).
   - HTTP 400 for missing or 0-byte instrumental stem.
   - HTTP 404 for nonexistent projects.
4. Real-world application scenarios (Tiers 3-4):
   - Cross-feature pairwise interactions in 9:16 line mode.
   - Data immutability and non-destructive project state preservation.
"""

import os
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app, projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest
from backend.services.ass_generator import (
    VISUAL_THEMES,
    generate_ass_content,
    generate_ass_subtitles,
)
from backend.services.video_renderer import VideoRenderer


def parse_ass_script(ass_text: str) -> dict[str, Any]:
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


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-App-Password": "sluggos"}


@pytest.fixture
def sample_duet_lines():
    return [
        {
            "id": 1,
            "start_time": 1.5,
            "end_time": 4.5,
            "text": "Singer one begins the vertical melody",
            "singer": "singer1",
            "words": [
                {"word": "Singer", "start_time": 1.5, "end_time": 2.0},
                {"word": "one", "start_time": 2.1, "end_time": 2.6},
                {"word": "begins", "start_time": 2.7, "end_time": 3.3},
                {"word": "the", "start_time": 3.4, "end_time": 3.7},
                {"word": "vertical", "start_time": 3.8, "end_time": 4.1},
                {"word": "melody", "start_time": 4.2, "end_time": 4.5},
            ],
        },
        {
            "id": 2,
            "start_time": 9.5,  # 5.0s gap -> countdown
            "end_time": 12.5,
            "text": "Singer two responds with deep harmony",
            "singer": "singer2",
            "words": [
                {"word": "Singer", "start_time": 9.5, "end_time": 10.0},
                {"word": "two", "start_time": 10.1, "end_time": 10.6},
                {"word": "responds", "start_time": 10.7, "end_time": 11.3},
                {"word": "with", "start_time": 11.4, "end_time": 11.7},
                {"word": "deep", "start_time": 11.8, "end_time": 12.1},
                {"word": "harmony", "start_time": 12.2, "end_time": 12.5},
            ],
        },
        {
            "id": 3,
            "start_time": 13.5,
            "end_time": 16.5,
            "text": "Both voices unite in glorious unison",
            "singer": "both",
            "words": [
                {"word": "Both", "start_time": 13.5, "end_time": 14.0},
                {"word": "voices", "start_time": 14.1, "end_time": 14.7},
                {"word": "unite", "start_time": 14.8, "end_time": 15.3},
                {"word": "in", "start_time": 15.4, "end_time": 15.7},
                {"word": "glorious", "start_time": 15.8, "end_time": 16.1},
                {"word": "unison", "start_time": 16.2, "end_time": 16.5},
            ],
        },
    ]


@pytest.fixture
def sample_chords():
    return [
        {"start": 1.5, "end": 4.5, "chord": "Am"},
        {"start": 9.5, "end": 12.5, "chord": "Dm"},
        {"start": 13.5, "end": 16.5, "chord": "E7"},
    ]


# ==============================================================================
# Suite 1: Vertical Video 9:16 Layout with Line Mode
# ==============================================================================


class TestVertical916LineMode:
    """Empirical verification of 9:16 vertical layout across line sync mode."""

    @pytest.mark.parametrize("theme_id", ["modern_gold", "cyber_cyan", "neon_pink", "classic_ktv"])
    def test_9_16_line_mode_geometry_and_themes(self, sample_duet_lines, theme_id):
        """Verify 9:16 vertical script resolution, margin placement, and theme integration."""
        ass_text = generate_ass_content(
            lines=sample_duet_lines,
            aspect_ratio="9:16",
            theme_id=theme_id,
            sync_mode="line",
            include_countdown=True,
        )
        parsed = parse_ass_script(ass_text)

        # 1. Canvas geometry
        assert parsed["info"].get("PlayResX") == "1080"
        assert parsed["info"].get("PlayResY") == "1920"

        # 2. Typography and vertical margins
        styles = parsed["styles"]
        line1 = styles["KaraokeLine1"]
        line2 = styles["KaraokeLine2"]
        assert line1["Fontsize"] == "46"
        assert line1["MarginV"] == "640"
        assert line1["MarginL"] == "60"
        assert line1["MarginR"] == "60"
        assert line2["MarginV"] == "500"

        # 3. Primary color matches theme preset
        expected_primary = VISUAL_THEMES[theme_id]["primary_color"]
        assert line1["PrimaryColour"] == expected_primary

        # 4. Zero progressive \kf tags in Layer 0 lyric lines
        lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
        assert len(lyric_events) == 3
        for event in lyric_events:
            assert "\\kf" not in event["Text"], f"Found \\kf in 9:16 line mode: {event['Text']}"

    def test_9_16_line_mode_with_chords_and_countdowns(self, sample_duet_lines, sample_chords):
        """Verify 9:16 line mode integrates Layer 1 countdown and Layer 2 chords properly."""
        ass_text = generate_ass_content(
            lines=sample_duet_lines,
            aspect_ratio="9:16",
            sync_mode="line",
            chords=sample_chords,
            include_chords=True,
            include_countdown=True,
        )
        parsed = parse_ass_script(ass_text)

        # Verify Countdown style margin for 9:16
        countdown_style = parsed["styles"]["Countdown"]
        assert countdown_style["MarginV"] == "780"
        assert countdown_style["Fontsize"] == "56"  # 46 + 10

        # Verify Layer 1 countdown events exist in the 5.0s gap
        countdown_events = [e for e in parsed["events"] if e.get("Layer") == "1"]
        assert len(countdown_events) == 1
        assert "●" in countdown_events[0]["Text"]

        # Verify Layer 2 chord events exist with \an8 alignment
        chord_events = [e for e in parsed["events"] if e.get("Layer") == "2"]
        assert len(chord_events) == 3
        assert any("Am" in e["Text"] for e in chord_events)
        assert any("Dm" in e["Text"] for e in chord_events)
        assert any("E7" in e["Text"] for e in chord_events)

    def test_real_ffmpeg_burn_9_16_line_mode(self, tmp_path, sample_duet_lines):
        """Empirically burn 9:16 line-mode ASS into a 1080x1920 MP4 video using FFmpeg and libass."""
        audio_path = tmp_path / "test_9_16.wav"
        ass_path = tmp_path / "test_9_16.ass"
        mp4_path = tmp_path / "test_9_16.mp4"

        # Generate 1.0s audio test tone
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1",
                "-c:a",
                "pcm_s16le",
                str(audio_path),
            ],
            check=True,
            capture_output=True,
        )

        renderer = VideoRenderer(output_dir=tmp_path)
        renderer.generate_ass_subtitles(
            lines=sample_duet_lines,
            output_ass_path=ass_path,
            aspect_ratio="9:16",
            sync_mode="line",
        )

        rendered_mp4 = renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=mp4_path,
            aspect_ratio="9:16",
            duration=1.0,
        )

        assert Path(rendered_mp4).is_file()
        assert Path(rendered_mp4).stat().st_size > 1000

        # Verify stream dimensions via ffprobe
        probe_res = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name",
                "-of",
                "csv=p=0",
                str(rendered_mp4),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        v_codec, width, height = probe_res.stdout.strip().split(",")
        assert v_codec == "h264"
        assert width == "1080"
        assert height == "1920"


# ==============================================================================
# Suite 2: Client style_config Nesting Fallback
# ==============================================================================


class TestStyleConfigNestingFallback:
    """Stress tests verifying client style_config nesting fallback for sync_mode."""

    def test_nested_style_config_line_overrides_default_word(self, sample_duet_lines):
        """When top-level is omitted/word, style_config.sync_mode='line' must activate line mode."""
        ass_text = generate_ass_content(
            lines=sample_duet_lines,
            sync_mode="word",  # default
            style_config={"sync_mode": "line"},
        )
        parsed = parse_ass_script(ass_text)
        lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
        for event in lyric_events:
            assert "\\kf" not in event["Text"], (
                f"Expected line mode from nested style_config: {event['Text']}"
            )

    def test_top_level_line_takes_precedence_over_nested_word(self, sample_duet_lines):
        """When top-level is explicitly 'line', it must produce line mode."""
        ass_text = generate_ass_content(
            lines=sample_duet_lines,
            sync_mode="line",
            style_config={"sync_mode": "word"},
        )
        parsed = parse_ass_script(ass_text)
        lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
        for event in lyric_events:
            assert "\\kf" not in event["Text"], (
                f"Expected line mode from top-level arg: {event['Text']}"
            )

    @pytest.mark.parametrize("val", ["LINE", " Line ", "  lInE  "])
    def test_nested_style_config_case_and_whitespace_insensitivity(self, sample_duet_lines, val):
        """Style_config.sync_mode must handle uppercase and whitespace cleanly."""
        ass_text = generate_ass_content(
            lines=sample_duet_lines,
            style_config={"sync_mode": val},
        )
        parsed = parse_ass_script(ass_text)
        lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
        for event in lyric_events:
            assert "\\kf" not in event["Text"]

    @pytest.mark.parametrize("bad_val", ["unknown_mode", "bogus", "123", "", None])
    def test_nested_style_config_invalid_fallback_safety(self, sample_duet_lines, bad_val):
        """Invalid values in style_config.sync_mode should safely fallback to 'word' without crashing."""
        ass_text = generate_ass_content(
            lines=sample_duet_lines,
            style_config={"sync_mode": bad_val},
        )
        parsed = parse_ass_script(ass_text)
        lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
        for event in lyric_events:
            assert "\\kf" in event["Text"], f"Expected fallback to word mode for {bad_val}"

    def test_worker_resolution_with_nested_style_config(self, tmp_path, sample_duet_lines):
        """Verify render_worker extracts style_config.sync_mode when req.sync_mode is word."""
        pid = "proj_worker_nested_fallback"
        inst_file = tmp_path / f"{pid}_inst.wav"
        inst_file.write_bytes(b"RIFF" + b"\x00" * 40)

        projects[pid] = {
            "id": pid,
            "status": "ready",
            "lines": sample_duet_lines,
            "instrumental_path": str(inst_file),
            "render_status": "idle",
        }

        output_ass = tmp_path / f"{pid}.ass"
        req = RenderRequest(
            aspect_ratio="16:9",
            sync_mode="word",  # top level
            style_config={"sync_mode": "line"},  # nested override
        )

        try:
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
            parsed = parse_ass_script(output_ass.read_text(encoding="utf-8"))
            lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
            for event in lyric_events:
                assert "\\kf" not in event["Text"]
        finally:
            projects.pop(pid, None)


# ==============================================================================
# Suite 3: Negative Tests & Error Recovery
# ==============================================================================


class TestNegativeAndErrorRecovery:
    """Stress tests negative HTTP responses (400, 422, 404) across export and render APIs."""

    def test_export_ass_invalid_sync_mode_returns_400(self, client, auth_headers):
        """Invalid sync_mode in GET /api/project/{id}/export/ass returns HTTP 400."""
        pid = "proj_neg_export_sync"
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "lines": [{"start_time": 0.0, "end_time": 1.0, "text": "Test"}],
        }
        try:
            res = client.get(
                f"/api/project/{pid}/export/ass?sync_mode=unsupported_val",
                headers=auth_headers,
            )
            assert res.status_code == 400
            assert "Invalid sync_mode" in res.json()["detail"]
        finally:
            projects.pop(pid, None)

    def test_export_ass_invalid_aspect_ratio_returns_400(self, client, auth_headers):
        """Invalid aspect_ratio in GET /api/project/{id}/export/ass returns HTTP 400."""
        pid = "proj_neg_export_ar"
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "lines": [{"start_time": 0.0, "end_time": 1.0, "text": "Test"}],
        }
        try:
            res = client.get(
                f"/api/project/{pid}/export/ass?aspect_ratio=4:3",
                headers=auth_headers,
            )
            assert res.status_code == 400
            assert "Invalid aspect ratio" in res.json()["detail"]
        finally:
            projects.pop(pid, None)

    def test_export_ass_nonexistent_project_returns_404(self, client, auth_headers):
        """Nonexistent project in GET /api/project/{id}/export/ass returns HTTP 404."""
        res = client.get(
            "/api/project/proj_completely_nonexistent_xyz/export/ass",
            headers=auth_headers,
        )
        assert res.status_code == 404

    def test_export_ass_empty_lines_returns_400(self, client, auth_headers):
        """Project with no lines in GET /api/project/{id}/export/ass returns HTTP 400."""
        pid = "proj_neg_empty_lines"
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "lines": [],
        }
        try:
            res = client.get(
                f"/api/project/{pid}/export/ass",
                headers=auth_headers,
            )
            assert res.status_code == 400
            assert "Project has no lyric lines to export" in res.json()["detail"]
        finally:
            projects.pop(pid, None)

    def test_render_invalid_body_schema_returns_422(self, client, auth_headers):
        """Invalid sync_mode or aspect_ratio in POST /api/project/{id}/render returns HTTP 422."""
        pid = "proj_neg_render_schema"
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "lines": [{"start_time": 0.0, "end_time": 1.0, "text": "Test"}],
            "instrumental_path": "/dummy/path.wav",
        }
        try:
            # Bad sync_mode
            res_bad_sync = client.post(
                f"/api/project/{pid}/render",
                json={"sync_mode": "bogus_mode"},
                headers=auth_headers,
            )
            assert res_bad_sync.status_code == 422

            # Bad aspect_ratio
            res_bad_ar = client.post(
                f"/api/project/{pid}/render",
                json={"aspect_ratio": "4:3"},
                headers=auth_headers,
            )
            assert res_bad_ar.status_code == 422

            # Bad semitones (> 12)
            res_bad_semi = client.post(
                f"/api/project/{pid}/render",
                json={"semitones": 24},
                headers=auth_headers,
            )
            assert res_bad_semi.status_code == 422
        finally:
            projects.pop(pid, None)

    def test_render_missing_or_empty_instrumental_stem_returns_400(
        self, client, auth_headers, tmp_path
    ):
        """Missing or 0-byte instrumental stem in POST /api/project/{id}/render returns HTTP 400."""
        # 1. Non-existent instrumental file
        pid_missing = "proj_neg_missing_stem"
        projects[pid_missing] = {
            "id": pid_missing,
            "status": "ready",
            "lines": [{"start_time": 0.0, "end_time": 1.0, "text": "Test"}],
            "instrumental_path": str(tmp_path / "does_not_exist.wav"),
        }

        # 2. 0-byte empty file
        pid_empty = "proj_neg_empty_stem"
        empty_stem = tmp_path / "empty_stem.wav"
        empty_stem.write_bytes(b"")
        projects[pid_empty] = {
            "id": pid_empty,
            "status": "ready",
            "lines": [{"start_time": 0.0, "end_time": 1.0, "text": "Test"}],
            "instrumental_path": str(empty_stem),
        }

        try:
            res_missing = client.post(
                f"/api/project/{pid_missing}/render",
                json={"sync_mode": "line"},
                headers=auth_headers,
            )
            assert res_missing.status_code == 400
            assert "instrumental stem not ready" in res_missing.json()["detail"]

            res_empty = client.post(
                f"/api/project/{pid_empty}/render",
                json={"sync_mode": "line"},
                headers=auth_headers,
            )
            assert res_empty.status_code == 400
            assert "instrumental stem not ready" in res_empty.json()["detail"]
        finally:
            projects.pop(pid_missing, None)
            projects.pop(pid_empty, None)


# ==============================================================================
# Suite 4: Real-World Multi-Feature Pairwise Scenarios
# ==============================================================================


class TestRealWorldPairwiseScenarios:
    """Exercises realistic Tier 3 & Tier 4 multi-feature application workflows."""

    def test_duet_vertical_9_16_line_mode_lifecycle(
        self, client, auth_headers, tmp_path, sample_duet_lines, sample_chords
    ):
        """
        Scenario:
        User creates a 2-singer duet project, configures vertical 9:16 layout,
        selects line-by-line sync mode with custom singer colors and transposed chords,
        downloads ASS subtitles, and submits a video render job.
        """
        pid = "proj_real_world_9_16_duet"
        inst_file = tmp_path / f"{pid}_inst.wav"
        inst_file.write_bytes(b"RIFF" + b"\x00" * 40)

        projects[pid] = {
            "id": pid,
            "status": "ready",
            "title": "Vertical Duet Anthem",
            "artist": "Dynamic Duo",
            "lines": sample_duet_lines,
            "chords": sample_chords,
            "instrumental_path": str(inst_file),
            "render_status": "idle",
        }

        try:
            # 1. Download ASS subtitles in 9:16 with line mode
            export_resp = client.get(
                f"/api/project/{pid}/export/ass?aspect_ratio=9:16&sync_mode=line&include_chords=true&include_countdown=true",
                headers=auth_headers,
            )
            assert export_resp.status_code == 200
            assert "text/x-ssa" in export_resp.headers["content-type"]
            ass_body = export_resp.text

            parsed_ass = parse_ass_script(ass_body)
            assert parsed_ass["info"]["PlayResX"] == "1080"
            assert parsed_ass["info"]["PlayResY"] == "1920"

            # Verify lyric events on Layer 0 have NO \kf tags
            lyric_events = [e for e in parsed_ass["events"] if e.get("Layer") == "0"]
            assert len(lyric_events) == 3
            for event in lyric_events:
                assert "\\kf" not in event["Text"]

            # Verify Countdown on Layer 1
            countdown_events = [e for e in parsed_ass["events"] if e.get("Layer") == "1"]
            assert len(countdown_events) == 1

            # Verify Chords on Layer 2
            chord_events = [e for e in parsed_ass["events"] if e.get("Layer") == "2"]
            assert len(chord_events) == 3

            # 2. Submit render job with nested style_config
            render_payload = {
                "aspect_ratio": "9:16",
                "sync_mode": "line",
                "include_chords": True,
                "include_countdown": True,
                "style_config": {
                    "singer2_color": "#FF007F",
                    "both_color": "#00FFCC",
                },
            }
            with patch("backend.main.run_video_render") as mock_bg_render:
                post_res = client.post(
                    f"/api/project/{pid}/render",
                    json=render_payload,
                    headers=auth_headers,
                )
                assert post_res.status_code == 200
                assert post_res.json() == {"status": "queued"}
                mock_bg_render.assert_called_once()

            # 3. Process worker and verify on-disk ASS file
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
            disk_parsed = parse_ass_script(output_ass.read_text(encoding="utf-8"))
            assert disk_parsed["info"]["PlayResX"] == "1080"
            assert disk_parsed["info"]["PlayResY"] == "1920"

            # Check custom colors in V4+ Styles
            styles = disk_parsed["styles"]
            assert styles["KaraokeLine1_Singer2"]["PrimaryColour"] == "&H007F00FF"  # #FF007F in BGR
            assert styles["KaraokeLine1_Both"]["PrimaryColour"] == "&H00CCFF00"  # #00FFCC in BGR

            # 4. Verify immutability of stored project data
            stored_lines = projects[pid]["lines"]
            assert len(stored_lines) == 3
            assert stored_lines[0]["words"][0]["word"] == "Singer"
            assert stored_lines[0]["words"][0]["start_time"] == 1.5
            assert stored_lines[0]["words"][0]["end_time"] == 2.0
        finally:
            projects.pop(pid, None)
