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
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass


def parse_ass_dialogues(ass_text: str) -> list[dict[str, str]]:
    """Parse dialogue lines into structured dictionaries."""
    return parse_ass(ass_text)["events"]


def lyric_rows(ass_text: str) -> list[AssEvent]:
    """The events of the lines being sung: one per row of a line, its role ``lyric:<line>``."""
    return [e for e in ass_events(ass_text) if e.kind == "lyric"]


def row_text(row: AssEvent) -> str:
    """A row's text after the block that places and colours it: the sweep tags and words."""
    return row.text.removeprefix(f"{{{row.tags}}}")


# The two-row look writes a line as it is written (the default look writes it in capitals)
AS_WRITTEN = "ktv"


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
        assert {row.line for row in lyric_rows(resp.text)} == {0, 1, 2}
        for event in ass_events(resp.text):
            assert "\\kf" not in event.text, f"Illegal \\kf found in line mode: {event.text}"
        # Each line changes colour whole, when it starts
        for row in lyric_rows(resp.text):
            lead = round((SAMPLE_LINES[row.line]["start_time"] - row.start) * 100)
            assert row_text(row).startswith(f"{{\\k{lead}}}{{\\k0}}")

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
        assert {row.line for row in lyric_rows(resp.text)} == {0, 1, 2}
        for row in lyric_rows(resp.text):
            assert "\\kf" in row.text, f"Missing \\kf in word mode: {row.text}"
        swept = sum(row.text.count("\\kf") for row in lyric_rows(resp.text))
        assert swept == sum(len(line["words"]) for line in SAMPLE_LINES)

    def test_export_default_sync_mode_is_word(self, client, auth_header):
        """Omitting sync_mode query parameter must default to 'word' mode."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass",
            headers=auth_header,
        )
        assert resp.status_code == 200
        assert {row.line for row in lyric_rows(resp.text)} == {0, 1, 2}
        assert all("\\kf" in row.text for row in lyric_rows(resp.text))

    def test_export_empty_sync_mode_defaults_to_word(self, client, auth_header):
        """Empty sync_mode string (?sync_mode=) falls back to default 'word' mode."""
        resp = client.get(
            f"/api/project/{self.pid}/export/ass?sync_mode=",
            headers=auth_header,
        )
        assert resp.status_code == 200
        assert {row.line for row in lyric_rows(resp.text)} == {0, 1, 2}
        assert all("\\kf" in row.text for row in lyric_rows(resp.text))

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
        assert {row.line for row in lyric_rows(resp.text)} == {0, 1, 2}
        assert "\\kf" not in resp.text


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
        ass = generate_ass_content(
            [line], theme_id=AS_WRITTEN, sync_mode="line", include_countdown=False
        )
        (row,) = lyric_rows(ass)
        assert row.start == 2.75
        assert row_text(row) == "{\\k250}{\\k0}Lead in test"

    def test_immediate_start_has_no_k_tags(self):
        """When display_start == l_start, no lead-in tag should be generated."""
        line = {"id": 0, "start_time": 0.0, "end_time": 3.0, "text": "Immediate start"}
        ass = generate_ass_content(
            [line], theme_id=AS_WRITTEN, sync_mode="line", include_countdown=False
        )
        (row,) = lyric_rows(ass)
        assert row.start == 0.0
        assert row_text(row) == "Immediate start"
        assert "{\\k" not in row.text

    def test_line_mode_escaping_special_ass_characters(self):
        """Ensure braces and backslashes in line text are escaped so they don't corrupt ASS markup."""
        line = {
            "id": 0,
            "start_time": 0.0,
            "end_time": 2.0,
            "text": r"Rock & {Roll} \N C:\Music\rock.mp3",
        }
        ass = generate_ass_content(
            [line], theme_id=AS_WRITTEN, sync_mode="line", include_countdown=False
        )
        txt = " ".join(row_text(row) for row in lyric_rows(ass))
        # The backslash is parted from the N, so \N is drawn rather than breaking the line
        assert txt == "Rock & \\{Roll\\} \\\u2060N C:\\\u2060Music\\\u2060rock.mp3"
        assert "\\N" not in txt
        assert "\\kf" not in txt

    def test_line_mode_multilingual_unicode(self):
        """Ensure UTF-8 characters (CJK, Cyrillic, emojis) survive line mode intact."""
        line = {
            "id": 0,
            "start_time": 0.0,
            "end_time": 3.0,
            "text": "夜に駆ける 🎶 Привет мир!",
        }
        ass = generate_ass_content(
            [line], theme_id=AS_WRITTEN, sync_mode="line", include_countdown=False
        )
        assert " ".join(row.plain for row in lyric_rows(ass)) == "夜に駆ける 🎶 Привет мир!"

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
        ass = generate_ass_content(
            [line], theme_id=AS_WRITTEN, sync_mode="line", include_countdown=False
        )
        (row,) = lyric_rows(ass)
        # If buggy, the text is "None" because str(line.get("text", "")) is "None"
        assert "None" not in ass, "Subtitle output emitted literal string 'None' instead of words"
        assert row.plain == "Sing Free"

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
