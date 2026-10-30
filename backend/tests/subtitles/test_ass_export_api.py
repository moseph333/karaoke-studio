r"""Adversarial stress-test suite for Milestone M2:
Backend ASS Subtitle Generation, Parameter Validation, and Render Worker.

Executed by Challenger 2 to find bugs, probe boundary conditions, and verify:
1. GET /api/project/{id}/export/ass parameter validation and line-mode output.
2. RenderRequest Pydantic model validation and edge cases.
3. render_worker sync_mode extraction from request and nested style_config.
4. ass_generator line-mode subtitle formatting, escaping, lead-in timing, and edge cases.
"""

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, projects
from backend.schemas import RenderRequest
from backend.services.ass_generator import generate_ass_content, generate_ass_subtitles
from backend.services.video_renderer import VideoRenderer


def parse_ass_dialogues(ass_text: str) -> list[dict[str, str]]:
    """Parse dialogue lines into structured dictionaries."""
    events = []
    format_fields = []
    for line in ass_text.splitlines():
        line = line.strip()
        if line.startswith("Format:") and "Layer" in line and "Start" in line:
            format_fields = [f.strip() for f in line[len("Format:") :].split(",")]
        elif line.startswith("Dialogue:"):
            raw_vals = line[len("Dialogue:") :].split(",", len(format_fields) - 1)
            ev = dict(
                zip(
                    format_fields, [v.strip() for v in raw_vals[:-1]] + [raw_vals[-1]], strict=False
                )
            )
            events.append(ev)
    return events


SAMPLE_LINES = [
    {
        "id": 0,
        "start_time": 2.0,
        "end_time": 4.5,
        "text": "First line of song",
        "singer": "singer1",
        "words": [
            {"word": "First", "start_time": 2.0, "end_time": 2.5},
            {"word": "line", "start_time": 2.5, "end_time": 3.0},
            {"word": "of", "start_time": 3.0, "end_time": 3.5},
            {"word": "song", "start_time": 3.5, "end_time": 4.5},
        ],
    },
    {
        "id": 1,
        "start_time": 5.0,
        "end_time": 8.0,
        "text": "Second line answered",
        "singer": "singer2",
        "words": [
            {"word": "Second", "start_time": 5.0, "end_time": 6.0},
            {"word": "line", "start_time": 6.0, "end_time": 7.0},
            {"word": "answered", "start_time": 7.0, "end_time": 8.0},
        ],
    },
    {
        "id": 2,
        "start_time": 13.0,  # 5s instrumental gap triggers countdown
        "end_time": 16.0,
        "text": "Harmony together now",
        "singer": "both",
        "words": [
            {"word": "Harmony", "start_time": 13.0, "end_time": 14.0},
            {"word": "together", "start_time": 14.0, "end_time": 15.0},
            {"word": "now", "start_time": 15.0, "end_time": 16.0},
        ],
    },
]

SAMPLE_CHORDS = [
    {"start": 2.0, "end": 4.5, "chord": "C"},
    {"start": 5.0, "end": 8.0, "chord": "G7"},
    {"start": 13.0, "end": 16.0, "chord": "F#m"},
]


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_header():
    return {"X-App-Password": "sluggos"}


# ============================================================================
# Section 1: GET /api/project/{id}/export/ass Parameter Validation & Output
# ============================================================================


class TestExportAssEndpointAdversarial:
    """Adversarial testing of export ASS HTTP endpoint."""

    @pytest.fixture(autouse=True)
    def setup_project(self):
        self.pid = "proj_adversarial_m2"
        projects[self.pid] = {
            "id": self.pid,
            "status": "ready",
            "title": "Adversarial Anthem",
            "artist": "Test Artist",
            "lines": SAMPLE_LINES,
            "chords": SAMPLE_CHORDS,
        }
        yield
        projects.pop(self.pid, None)

    @pytest.mark.parametrize(
        "sync_mode_val",
        ["line", "LINE", "Line", "LiNe", "  line  ", "  LINE  "],
    )
    def test_export_line_mode_case_insensitivity_and_whitespace(
        self, client, auth_header, sync_mode_val
    ):
        """Line mode must be accepted case-insensitively with leading/trailing whitespace."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            params={"sync_mode": sync_mode_val},
            headers=auth_header,
        )
        assert resp.status_code == 200, f"Failed for sync_mode={sync_mode_val}: {resp.text}"
        assert "text/x-ssa" in resp.headers["content-type"]
        dialogues = parse_ass_dialogues(resp.text)
        lyric_dialogues = [d for d in dialogues if d.get("Layer") == "0"]
        assert len(lyric_dialogues) == 3
        for d in lyric_dialogues:
            assert "\\kf" not in d["Text"], f"Illegal \\kf found in line mode: {d['Text']}"

    @pytest.mark.parametrize(
        "sync_mode_val",
        ["word", "WORD", "Word", "WoRd", "  word  "],
    )
    def test_export_word_mode_case_insensitivity(self, client, auth_header, sync_mode_val):
        """Word mode must be accepted case-insensitively and emit \\kf tags."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            params={"sync_mode": sync_mode_val},
            headers=auth_header,
        )
        assert resp.status_code == 200
        dialogues = parse_ass_dialogues(resp.text)
        lyric_dialogues = [d for d in dialogues if d.get("Layer") == "0"]
        assert len(lyric_dialogues) == 3
        for d in lyric_dialogues:
            assert "\\kf" in d["Text"], f"Missing \\kf in word mode: {d['Text']}"

    def test_export_default_sync_mode_is_word(self, client, auth_header):
        """Omitting sync_mode query parameter must default to 'word' mode."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            headers=auth_header,
        )
        assert resp.status_code == 200
        dialogues = parse_ass_dialogues(resp.text)
        lyric_dialogues = [d for d in dialogues if d.get("Layer") == "0"]
        assert all("\\kf" in d["Text"] for d in lyric_dialogues)

    def test_export_empty_sync_mode_defaults_to_word(self, client, auth_header):
        """Empty sync_mode string (?sync_mode=) falls back to default 'word' mode."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass?sync_mode=",
            headers=auth_header,
        )
        assert resp.status_code == 200
        dialogues = parse_ass_dialogues(resp.text)
        lyric_dialogues = [d for d in dialogues if d.get("Layer") == "0"]
        assert all("\\kf" in d["Text"] for d in lyric_dialogues)

    @pytest.mark.parametrize(
        "invalid_mode",
        [
            "foo",
            "123",
            "null",
            "undefined",
            "lines",
            "words",
            "line-by-line",
            "word_by_word",
            "karaoke",
            "true",
            "false",
            "None",
            "__proto__",
            "<script>",
        ],
    )
    def test_export_invalid_sync_mode_returns_400(self, client, auth_header, invalid_mode):
        """Any invalid sync_mode string must return HTTP 400 Bad Request."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            params={"sync_mode": invalid_mode},
            headers=auth_header,
        )
        assert resp.status_code == 400, f"Expected 400 for '{invalid_mode}', got {resp.status_code}"
        assert "Invalid sync_mode" in resp.json()["detail"]

    def test_export_line_mode_with_chords_and_no_countdown(self, client, auth_header):
        """Line mode with chords enabled and countdown disabled must have zero \\kf in entire file."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            params={
                "sync_mode": "line",
                "include_countdown": "false",
                "include_chords": "true",
                "semitones": "1",  # C -> C#, G7 -> G#7, F#m -> Gm
            },
            headers=auth_header,
        )
        assert resp.status_code == 200
        body = resp.text
        # Entire document must have zero \kf
        assert "\\kf" not in body
        # Chords present on Layer 2
        dialogues = parse_ass_dialogues(body)
        chord_dialogues = [d for d in dialogues if d.get("Layer") == "2"]
        assert len(chord_dialogues) == 3
        assert "C#" in chord_dialogues[0]["Text"]
        assert "G#7" in chord_dialogues[1]["Text"]

    def test_export_line_mode_vertical_9_16(self, client, auth_header):
        """Export in 9:16 layout in line mode sets vertical PlayRes and zero \\kf."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            params={"sync_mode": "line", "aspect_ratio": "9:16"},
            headers=auth_header,
        )
        assert resp.status_code == 200
        assert "PlayResX: 1080" in resp.text
        assert "PlayResY: 1920" in resp.text
        dialogues = parse_ass_dialogues(resp.text)
        lyric_dialogues = [d for d in dialogues if d.get("Layer") == "0"]
        for d in lyric_dialogues:
            assert "\\kf" not in d["Text"]


# ============================================================================
# Section 2: RenderRequest Pydantic Model Validation
# ============================================================================


class TestRenderRequestValidationAdversarial:
    """Adversarial validation of the RenderRequest Pydantic model."""

    def test_default_sync_mode_is_word(self):
        req = RenderRequest()
        assert req.sync_mode == "word"

    def test_valid_sync_modes(self):
        req_w = RenderRequest(sync_mode="word")
        assert req_w.sync_mode == "word"

        req_l = RenderRequest(sync_mode="line")
        assert req_l.sync_mode == "line"

    @pytest.mark.parametrize(
        "invalid_val",
        [
            "Line",
            "LINE",
            "WORD",
            "Word",
            "foo",
            "123",
            123,
            True,
            False,
            None,
            "",
            "  line  ",
            ["line"],
            {"sync_mode": "line"},
        ],
    )
    def test_invalid_sync_modes_raise_validation_error(self, invalid_val):
        with pytest.raises(ValidationError):
            RenderRequest(sync_mode=invalid_val)

    def test_json_roundtrip_serialization(self):
        """Validate JSON serialization and deserialization."""
        req = RenderRequest(sync_mode="line", aspect_ratio="9:16")
        data = req.model_dump()
        assert data["sync_mode"] == "line"
        assert data["aspect_ratio"] == "9:16"

        restored = RenderRequest.model_validate(data)
        assert restored.sync_mode == "line"
        assert restored.aspect_ratio == "9:16"


# ============================================================================
# Section 3: render_worker sync_mode Extraction
# ============================================================================


class TestRenderWorkerSyncModeExtraction:
    """Adversarial testing of sync_mode extraction logic in render_worker."""

    @pytest.fixture
    def setup_render_proj(self, tmp_path):
        pid = "proj_render_worker_adv"
        dummy_wav = tmp_path / "audio.wav"
        dummy_wav.write_bytes(b"RIFF" + b"\x00" * 36)
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "title": "Worker Song",
            "artist": "Worker Artist",
            "lines": SAMPLE_LINES,
            "instrumental_path": str(dummy_wav),
        }
        yield pid
        projects.pop(pid, None)

    def test_worker_extracts_top_level_sync_mode_line(self, setup_render_proj, tmp_path):
        from backend.render_worker import run_video_render

        pid = setup_render_proj
        req = RenderRequest(sync_mode="line")

        with (
            patch("backend.main.WORKER_SEMAPHORE"),
            patch("backend.main.video_renderer.generate_ass_subtitles") as mock_sub,
            patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
            patch("backend.main.video_renderer.render_video") as mock_render,
            patch("backend.main.youtube_service.generate_youtube_package"),
        ):
            mock_mix.return_value = str(tmp_path / "mix.wav")
            mock_render.return_value = tmp_path / "out.mp4"

            run_video_render(pid, req)

            assert mock_sub.called
            assert mock_sub.call_args.kwargs.get("sync_mode") == "line"

    def test_worker_extracts_nested_style_config_sync_mode(self, setup_render_proj, tmp_path):
        from backend.render_worker import run_video_render

        pid = setup_render_proj
        # top level defaults to 'word', style_config has 'line'
        req = RenderRequest(sync_mode="word", style_config={"sync_mode": "line"})

        with (
            patch("backend.main.WORKER_SEMAPHORE"),
            patch("backend.main.video_renderer.generate_ass_subtitles") as mock_sub,
            patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
            patch("backend.main.video_renderer.render_video") as mock_render,
            patch("backend.main.youtube_service.generate_youtube_package"),
        ):
            mock_mix.return_value = str(tmp_path / "mix.wav")
            mock_render.return_value = tmp_path / "out.mp4"

            run_video_render(pid, req)

            assert mock_sub.called
            assert mock_sub.call_args.kwargs.get("sync_mode") == "line"

    def test_worker_top_level_line_overrides_nested_style_config_word(
        self, setup_render_proj, tmp_path
    ):
        from backend.render_worker import run_video_render

        pid = setup_render_proj
        # top level 'line' should take precedence over nested 'word'
        req = RenderRequest(sync_mode="line", style_config={"sync_mode": "word"})

        with (
            patch("backend.main.WORKER_SEMAPHORE"),
            patch("backend.main.video_renderer.generate_ass_subtitles") as mock_sub,
            patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
            patch("backend.main.video_renderer.render_video") as mock_render,
            patch("backend.main.youtube_service.generate_youtube_package"),
        ):
            mock_mix.return_value = str(tmp_path / "mix.wav")
            mock_render.return_value = tmp_path / "out.mp4"

            run_video_render(pid, req)

            assert mock_sub.called
            assert mock_sub.call_args.kwargs.get("sync_mode") == "line"

    def test_worker_null_style_config_does_not_crash(self, setup_render_proj, tmp_path):
        from backend.render_worker import run_video_render

        pid = setup_render_proj
        req = RenderRequest(sync_mode="line", style_config=None)

        with (
            patch("backend.main.WORKER_SEMAPHORE"),
            patch("backend.main.video_renderer.generate_ass_subtitles") as mock_sub,
            patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
            patch("backend.main.video_renderer.render_video") as mock_render,
            patch("backend.main.youtube_service.generate_youtube_package"),
        ):
            mock_mix.return_value = str(tmp_path / "mix.wav")
            mock_render.return_value = tmp_path / "out.mp4"

            run_video_render(pid, req)

            assert mock_sub.called
            assert mock_sub.call_args.kwargs.get("sync_mode") == "line"


# ============================================================================
# Section 4: ass_generator Line Mode Subtitle Formatting & Edge Cases
# ============================================================================


class TestAssGeneratorLineModeAdversarial:
    """Deep edge-case analysis of ASS subtitle generator in line mode."""

    def test_lead_in_timing_calculation(self):
        """Lead in cs should match exact centisecond difference between display_start and l_start."""
        line = {"id": 0, "start_time": 5.25, "end_time": 8.0, "text": "Lead in test"}
        # i=0 -> display_start = max(0, 5.25 - 2.5) = 2.75s -> lead_in = 2.50s = 250cs
        ass = generate_ass_content([line], sync_mode="line", include_countdown=False)
        dialogues = parse_ass_dialogues(ass)
        assert len(dialogues) == 1
        assert dialogues[0]["Start"] == "0:00:02.75"
        assert dialogues[0]["Text"] == "{\\k250}{\\k0}Lead in test"

    def test_immediate_start_has_no_k_tags(self):
        """When display_start == l_start, no lead-in tag should be generated."""
        line = {"id": 0, "start_time": 0.0, "end_time": 3.0, "text": "Immediate start"}
        ass = generate_ass_content([line], sync_mode="line", include_countdown=False)
        dialogues = parse_ass_dialogues(ass)
        assert len(dialogues) == 1
        assert dialogues[0]["Start"] == "0:00:00.00"
        assert dialogues[0]["Text"] == "Immediate start"
        assert "{\\k" not in dialogues[0]["Text"]

    def test_line_mode_escaping_special_ass_characters(self):
        """Ensure braces and backslashes in line text are escaped so they don't corrupt ASS markup."""
        line = {
            "id": 0,
            "start_time": 0.0,
            "end_time": 2.0,
            "text": r"Rock & {Roll} \N C:\Music\rock.mp3",
        }
        ass = generate_ass_content([line], sync_mode="line", include_countdown=False)
        dialogues = parse_ass_dialogues(ass)
        txt = dialogues[0]["Text"]
        # Backslash is escaped, so \N becomes \\N
        assert "\\{Roll\\}" in txt
        assert "\\\\N" in txt  # Literal \N must have backslash escaped
        assert "\\kf" not in txt

    def test_line_mode_multilingual_unicode(self):
        """Ensure UTF-8 characters (CJK, Cyrillic, emojis) survive line mode intact."""
        line = {
            "id": 0,
            "start_time": 0.0,
            "end_time": 3.0,
            "text": "夜に駆ける 🎶 Привет мир!",
        }
        ass = generate_ass_content([line], sync_mode="line", include_countdown=False)
        assert "夜に駆ける 🎶 Привет мир!" in ass

    def test_bug_investigation_line_text_none_with_words(self):
        """BUG INVESTIGATION: When line['text'] is None but line['words'] has valid words,

        what does line mode output?
        """
        line = {
            "id": 0,
            "start_time": 1.0,
            "end_time": 3.0,
            "text": None,  # Explicit None
            "words": [
                {"word": "Sing", "start_time": 1.0, "end_time": 2.0},
                {"word": "Free", "start_time": 2.0, "end_time": 3.0},
            ],
        }
        ass = generate_ass_content([line], sync_mode="line", include_countdown=False)
        dialogues = parse_ass_dialogues(ass)
        txt = dialogues[0]["Text"]
        # If buggy, txt contains "None" because str(line.get("text", "")) is "None"
        # If correct, txt contains "Sing Free"
        print(f"DEBUG text=None output: {txt!r}")
        assert "None" not in txt, (
            f"BUG FOUND: Subtitle output emitted literal string 'None' instead of words! Output: {txt}"
        )

    def test_real_video_render_with_line_mode_ass(self, tmp_path):
        """End-to-end integration: VideoRenderer.render_video produces valid MP4 with line mode ASS."""
        import os
        import wave

        renderer = VideoRenderer(output_dir=tmp_path)
        audio_path = tmp_path / "test_audio.wav"
        output_mp4 = tmp_path / "rendered_line_mode.mp4"
        ass_path = tmp_path / "subtitles_line.ass"

        with wave.open(str(audio_path), "wb") as wf:
            wf.setnchannels(2)
            wf.setsampwidth(2)
            wf.setframerate(44100)
            wf.writeframes(b"\x00" * (44100 * 4))  # 1 second of stereo silence

        renderer.generate_ass_subtitles(
            lines=SAMPLE_LINES,
            output_ass_path=ass_path,
            sync_mode="line",
            include_countdown=False,
        )
        assert ass_path.exists()
        assert "\\kf" not in ass_path.read_text(encoding="utf-8")

        rendered = renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=output_mp4,
            duration=1.0,
        )

        assert os.path.exists(rendered)
        assert Path(rendered).stat().st_size > 1000
