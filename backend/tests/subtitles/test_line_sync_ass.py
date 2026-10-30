r"""Comprehensive unit and integration test suite for Milestone M2:
Line-by-line lyric synchronization display and export mode in ASS subtitles and video render pipeline.

Validates:
1. ass_generator.py sync_mode support ('word' progressive \kf sweeps vs 'line' instant highlight).
2. Lead-in unsung timing {\k...}{\k0} in line mode, and direct text when display_start == line_start.
3. Zero \kf tags in line mode lyric dialogues.
4. Duet multi-singer styles and custom colors preservation in line mode.
5. Instrumental gap countdowns and Layer 2 chords preservation in line mode.
6. Aspect ratios (16:9 and 9:16) and typography scaling in line mode.
7. video_renderer.py method wrappers forwarding sync_mode.
8. RenderRequest Pydantic schema validation for sync_mode.
9. GET /api/project/{id}/export/ass HTTP endpoint with sync_mode query parameter (200 for 'word'/'line', 400 for invalid).
10. render_worker.py subtitle generation with sync_mode='line'.
11. Dual-mode parity comparison across identical project fixtures.
"""

from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, projects
from backend.schemas import RenderRequest
from backend.services.ass_generator import (
    generate_ass_content,
    generate_ass_subtitles,
)
from backend.services.video_renderer import VideoRenderer

# ============================================================================
# Helpers & Fixtures
# ============================================================================


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


SAMPLE_LINES_WITH_WORDS = [
    {
        "id": 0,
        "start_time": 2.5,
        "end_time": 5.0,
        "text": "Never gonna give you up",
        "singer": "singer1",
        "words": [
            {"word": "Never", "start_time": 2.5, "end_time": 3.0},
            {"word": "gonna", "start_time": 3.0, "end_time": 3.5},
            {"word": "give", "start_time": 3.5, "end_time": 4.0},
            {"word": "you", "start_time": 4.0, "end_time": 4.5},
            {"word": "up", "start_time": 4.5, "end_time": 5.0},
        ],
    },
    {
        "id": 1,
        "start_time": 5.5,
        "end_time": 8.0,
        "text": "Never gonna let you down",
        "singer": "singer2",
        "words": [
            {"word": "Never", "start_time": 5.5, "end_time": 6.0},
            {"word": "gonna", "start_time": 6.0, "end_time": 6.5},
            {"word": "let", "start_time": 6.5, "end_time": 7.0},
            {"word": "you", "start_time": 7.0, "end_time": 7.5},
            {"word": "down", "start_time": 7.5, "end_time": 8.0},
        ],
    },
    {
        "id": 2,
        "start_time": 13.0,  # 5-second gap: triggers countdown
        "end_time": 16.0,
        "text": "Together we make harmony",
        "singer": "both",
        "words": [
            {"word": "Together", "start_time": 13.0, "end_time": 14.0},
            {"word": "we", "start_time": 14.0, "end_time": 14.5},
            {"word": "make", "start_time": 14.5, "end_time": 15.0},
            {"word": "harmony", "start_time": 15.0, "end_time": 16.0},
        ],
    },
]

SAMPLE_CHORDS = [
    {"start": 2.5, "end": 5.0, "chord": "C"},
    {"start": 5.5, "end": 8.0, "chord": "G"},
    {"start": 13.0, "end": 16.0, "chord": "Am"},
]


@pytest.fixture
def test_client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-App-Password": "sluggos"}


# ============================================================================
# Tier 1: Core ASS Generator Unit Tests (Word vs Line Mode)
# ============================================================================


def test_word_mode_generates_kf_tags_by_default():
    """Verify that default sync_mode='word' emits progressive \\kf tags for words."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS)
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3

    for ev in lyric_events:
        text = ev["Text"]
        assert "\\kf" in text, f"Expected \\kf tag in word sweep mode, got: {text}"


def test_line_mode_generates_zero_kf_tags():
    """Verify that sync_mode='line' produces zero \\kf tags on all lyric lines."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="line")
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3

    for ev in lyric_events:
        text = ev["Text"]
        assert "\\kf" not in text, f"Found illegal \\kf tag in line sync mode: {text}"


def test_line_mode_lead_in_timing_format():
    """Verify that lead-in timing produces {\\k<cs>}{\\k0} when display_start < l_start."""
    lines = [
        {
            "id": 0,
            "start_time": 4.0,  # display_start = max(0, 4.0 - 2.5) = 1.5s -> lead_in = 2.5s = 250cs
            "end_time": 7.0,
            "text": "Hello world",
        }
    ]
    ass_text = generate_ass_content(lines, sync_mode="line", include_countdown=False)
    parsed = parse_ass(ass_text)

    ev = parsed["events"][0]
    assert ev["Start"] == "0:00:01.50"
    assert ev["Text"].startswith("{\\k250}{\\k0}")
    assert "Hello world" in ev["Text"]
    assert "\\kf" not in ev["Text"]


def test_line_mode_immediate_start_without_lead_in_tag():
    """Verify that when display_start == l_start (lead_in_cs == 0), no \\k tag is prepended."""
    lines = [
        {
            "id": 0,
            "start_time": 0.0,  # display_start = 0.0 -> lead_in_cs = 0
            "end_time": 3.0,
            "text": "Immediate lyric line",
        }
    ]
    ass_text = generate_ass_content(lines, sync_mode="line", include_countdown=False)
    parsed = parse_ass(ass_text)

    ev = parsed["events"][0]
    assert ev["Start"] == "0:00:00.00"
    # When lead_in_cs == 0, text is clean with zero \k or \kf tags
    assert ev["Text"] == "Immediate lyric line"
    assert "\\k" not in ev["Text"]


def test_line_mode_style_config_sync_mode_fallback():
    """Verify that style_config={'sync_mode': 'line'} is honored when sync_mode param is omitted."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, style_config={"sync_mode": "line"})
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]


def test_invalid_sync_mode_falls_back_to_word_mode():
    """Verify that invalid sync_mode string gracefully falls back to 'word' mode."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="invalid_mode")
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    # Should have \kf tags because it fell back to word mode
    assert any("\\kf" in ev["Text"] for ev in lyric_events)


def test_case_insensitive_sync_mode():
    """Verify that 'LINE', 'Line', and whitespace are handled cleanly."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="  LINE  ")
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]


# ============================================================================
# Tier 2: Boundary, Duet & Feature Preservation in Line Mode
# ============================================================================


def test_line_mode_preserves_duet_styles():
    """Verify that singer1, singer2, and both styles are correctly assigned in line mode."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="line")
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert lyric_events[0]["Style"] == "KaraokeLine1"  # singer 1, line 0
    assert lyric_events[1]["Style"] == "KaraokeLine2_Singer2"  # singer 2, line 1
    assert lyric_events[2]["Style"] == "KaraokeLine1_Both"  # both, line 2

    # Verify style headers exist with respective PrimaryColour values
    styles = parsed["styles"]
    assert "KaraokeLine1" in styles
    assert "KaraokeLine2_Singer2" in styles
    assert "KaraokeLine1_Both" in styles
    assert styles["KaraokeLine2_Singer2"]["PrimaryColour"] == "&H00B300FF"
    assert styles["KaraokeLine1_Both"]["PrimaryColour"] == "&H0050FA7B"


def test_line_mode_with_custom_duet_colors():
    """Verify that custom singer2_color and both_color overrides propagate in line mode."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS,
        sync_mode="line",
        singer2_color="#FF0088",  # ASS: &H008800FF
        both_color="#00FFAA",  # ASS: &H00AAFF00
    )
    parsed = parse_ass(ass_text)
    styles = parsed["styles"]

    assert styles["KaraokeLine2_Singer2"]["PrimaryColour"] == "&H008800FF"
    assert styles["KaraokeLine1_Both"]["PrimaryColour"] == "&H00AAFF00"


def test_line_mode_preserves_instrumental_gap_countdown():
    """Verify that instrumental gap countdown dots are preserved on Layer 1 in line mode."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS, sync_mode="line", include_countdown=True
    )
    parsed = parse_ass(ass_text)

    countdown_events = [e for e in parsed["events"] if e.get("Layer") == "1"]
    assert len(countdown_events) == 1
    assert countdown_events[0]["Style"] == "Countdown"
    assert "●" in countdown_events[0]["Text"]
    assert countdown_events[0]["End"] == "0:00:13.00"


def test_line_mode_preserves_layer_2_chords():
    """Verify that musical chord cues are preserved on Layer 2 in line mode."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS,
        chords=SAMPLE_CHORDS,
        include_chords=True,
        semitones=2,  # C -> D, G -> A, Am -> Bm
        sync_mode="line",
    )
    parsed = parse_ass(ass_text)

    chord_events = [e for e in parsed["events"] if e.get("Layer") == "2"]
    assert len(chord_events) == 3
    assert "D" in chord_events[0]["Text"]
    assert "A" in chord_events[1]["Text"]
    assert "Bm" in chord_events[2]["Text"]


def test_line_mode_untimed_lines_without_words():
    """Verify line mode handles lines without 'words' array (plain text only)."""
    lines = [
        {"id": 0, "start_time": 2.0, "end_time": 5.0, "text": "Untimed line one"},
        {"id": 1, "start_time": 6.0, "end_time": 9.0, "text": "Untimed line two"},
    ]
    ass_text = generate_ass_content(lines, sync_mode="line")
    parsed = parse_ass(ass_text)

    events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(events) == 2
    assert "Untimed line one" in events[0]["Text"]
    assert "\\kf" not in events[0]["Text"]
    assert "Untimed line two" in events[1]["Text"]
    assert "\\kf" not in events[1]["Text"]


def test_line_mode_words_without_line_text_fallback():
    """Verify line mode reconstructs text from words array if line['text'] is empty or missing."""
    lines = [
        {
            "id": 0,
            "start_time": 1.0,
            "end_time": 3.0,
            "words": [
                {"word": "Reconstructed", "start_time": 1.0, "end_time": 2.0},
                {"word": "Sentence", "start_time": 2.0, "end_time": 3.0},
            ],
        }
    ]
    ass_text = generate_ass_content(lines, sync_mode="line")
    parsed = parse_ass(ass_text)

    ev = parsed["events"][0]
    assert "Reconstructed Sentence" in ev["Text"]
    assert "\\kf" not in ev["Text"]


def test_line_mode_special_character_escaping():
    """Verify line mode escapes braces, backslashes, and strips literal newlines."""
    lines = [
        {
            "id": 0,
            "start_time": 1.0,
            "end_time": 4.0,
            "text": "Special {bracket} & \\backslash \n and newline",
        }
    ]
    ass_text = generate_ass_content(lines, sync_mode="line")
    parsed = parse_ass(ass_text)

    ev = parsed["events"][0]
    # In ASS, escaped braces are \{ and \}
    assert "\\{bracket\\}" in ev["Text"]
    # Newlines replaced with spaces
    assert "\n" not in ev["Text"]
    assert "\\kf" not in ev["Text"]


def test_line_mode_vertical_9_16_aspect_ratio():
    """Verify line mode correctly sets PlayRes and vertical margins for 9:16 layout."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, aspect_ratio="9:16", sync_mode="line")
    parsed = parse_ass(ass_text)

    assert parsed["info"]["PlayResX"] == "1080"
    assert parsed["info"]["PlayResY"] == "1920"
    # Vertical line margins in 9:16
    assert parsed["styles"]["KaraokeLine1"]["MarginV"] == "640"
    assert parsed["styles"]["KaraokeLine2"]["MarginV"] == "500"


def test_generate_ass_subtitles_file_writing(tmp_path: Path):
    """Verify generate_ass_subtitles writes valid ASS content with sync_mode='line' to disk."""
    out_file = tmp_path / "test_line.ass"
    result_path = generate_ass_subtitles(
        lines=SAMPLE_LINES_WITH_WORDS,
        output_ass_path=out_file,
        sync_mode="line",
    )
    assert Path(result_path).exists()
    content = out_file.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    parsed = parse_ass(content)
    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]

    # When countdown is disabled, no \kf exists anywhere in the entire document
    out_no_cd = tmp_path / "test_line_no_cd.ass"
    generate_ass_subtitles(
        lines=SAMPLE_LINES_WITH_WORDS,
        output_ass_path=out_no_cd,
        sync_mode="line",
        include_countdown=False,
    )
    assert "\\kf" not in out_no_cd.read_text(encoding="utf-8")


# ============================================================================
# Tier 3: VideoRenderer Wrapper Delegation
# ============================================================================


def test_video_renderer_generate_ass_content_forwards_sync_mode():
    """Verify VideoRenderer.generate_ass_content forwards sync_mode='line'."""
    renderer = VideoRenderer()
    ass_text = renderer.generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="line")
    parsed = parse_ass(ass_text)

    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]


def test_video_renderer_generate_ass_subtitles_forwards_sync_mode(tmp_path: Path):
    """Verify VideoRenderer.generate_ass_subtitles forwards sync_mode='line' to written file."""
    renderer = VideoRenderer()
    out_file = tmp_path / "renderer_test.ass"
    renderer.generate_ass_subtitles(
        lines=SAMPLE_LINES_WITH_WORDS,
        output_ass_path=out_file,
        sync_mode="line",
    )
    assert out_file.exists()
    content = out_file.read_text(encoding="utf-8")
    parsed = parse_ass(content)
    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]


# ============================================================================
# Tier 4: Schemas & API Integration (HTTP GET /export/ass and POST /render)
# ============================================================================


def test_render_request_schema_sync_mode_validation():
    """Verify RenderRequest schema accepts 'word' and 'line', rejects invalid values."""
    req_default = RenderRequest()
    assert req_default.sync_mode == "word"

    req_word = RenderRequest(sync_mode="word")
    assert req_word.sync_mode == "word"

    req_line = RenderRequest(sync_mode="line")
    assert req_line.sync_mode == "line"

    with pytest.raises(ValidationError):
        RenderRequest(sync_mode="invalid_sync_mode")


def test_http_export_ass_default_is_word_mode(test_client, auth_headers):
    """Verify GET /api/project/{id}/export/ass defaults to word sweep with \\kf tags."""
    pid = "proj_test_export_default"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "title": "Default Export Song",
        "artist": "Artist",
        "lines": SAMPLE_LINES_WITH_WORDS,
    }

    resp = test_client.get(f"/api/project/{pid}/export/ass", headers=auth_headers)
    assert resp.status_code == 200
    assert "text/x-ssa" in resp.headers["content-type"]
    assert "\\kf" in resp.text


def test_http_export_ass_explicit_line_mode(test_client, auth_headers):
    """Verify GET /api/project/{id}/export/ass?sync_mode=line produces zero \\kf tags on lyrics."""
    pid = "proj_test_export_line"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "title": "Line Mode Song",
        "artist": "Singer",
        "lines": SAMPLE_LINES_WITH_WORDS,
    }

    resp = test_client.get(
        f"/api/project/{pid}/export/ass?sync_mode=line",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "text/x-ssa" in resp.headers["content-type"]
    parsed = parse_ass(resp.text)
    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]
    assert "Never gonna give you up" in resp.text

    # With include_countdown=false, entire response text is free of \kf
    resp_no_cd = test_client.get(
        f"/api/project/{pid}/export/ass?sync_mode=line&include_countdown=false",
        headers=auth_headers,
    )
    assert resp_no_cd.status_code == 200
    assert "\\kf" not in resp_no_cd.text


def test_http_export_ass_case_insensitive_line_mode(test_client, auth_headers):
    """Verify GET /api/project/{id}/export/ass?sync_mode=LINE works case-insensitively."""
    pid = "proj_test_export_case"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "title": "Case Song",
        "artist": "Singer",
        "lines": SAMPLE_LINES_WITH_WORDS,
    }

    resp = test_client.get(
        f"/api/project/{pid}/export/ass?sync_mode=LINE",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    parsed = parse_ass(resp.text)
    lyric_events = [e for e in parsed["events"] if e.get("Layer") == "0"]
    assert len(lyric_events) == 3
    for ev in lyric_events:
        assert "\\kf" not in ev["Text"]


def test_http_export_ass_invalid_sync_mode_returns_400(test_client, auth_headers):
    """Verify GET /api/project/{id}/export/ass?sync_mode=invalid returns HTTP 400."""
    pid = "proj_test_export_err"
    projects[pid] = {
        "id": pid,
        "status": "ready",
        "title": "Error Song",
        "artist": "Singer",
        "lines": SAMPLE_LINES_WITH_WORDS,
    }

    resp = test_client.get(
        f"/api/project/{pid}/export/ass?sync_mode=bogus",
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert "Invalid sync_mode" in resp.json()["detail"]


# ============================================================================
# Tier 5: Background Render Worker Integration
# ============================================================================


def test_render_worker_subtitle_generation_with_line_sync(tmp_path: Path):
    """Verify render_worker extracts sync_mode and forwards to generate_ass_subtitles."""
    from backend.render_worker import run_video_render

    pid = "proj_render_worker_test"
    dummy_wav = tmp_path / "inst.wav"
    dummy_wav.write_bytes(b"RIFF" + b"\x00" * 36)

    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "title": "Render Track",
        "artist": "Render Artist",
        "lines": SAMPLE_LINES_WITH_WORDS,
        "instrumental_path": str(dummy_wav),
        "vocals_path": str(dummy_wav),
    }

    req = RenderRequest(sync_mode="line")

    with (
        patch("backend.main.WORKER_SEMAPHORE"),
        patch("backend.main.video_renderer.generate_ass_subtitles") as mock_sub,
        patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
        patch("backend.main.video_renderer.render_video") as mock_render,
        patch("backend.main.youtube_service.generate_youtube_package"),
    ):
        mock_mix.return_value = str(dummy_wav)
        mock_render.return_value = tmp_path / f"{pid}_karaoke.mp4"

        run_video_render(pid, req)

        assert mock_sub.called
        kwargs = mock_sub.call_args.kwargs
        assert kwargs.get("sync_mode") == "line"


def test_render_worker_extracts_nested_style_config_sync_mode(tmp_path: Path):
    """Verify render_worker falls back to style_config.sync_mode if req.sync_mode is default."""
    from backend.render_worker import run_video_render

    pid = "proj_render_nested_test"
    dummy_wav = tmp_path / "inst2.wav"
    dummy_wav.write_bytes(b"RIFF" + b"\x00" * 36)

    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "title": "Nested Style Track",
        "artist": "Artist",
        "lines": SAMPLE_LINES_WITH_WORDS,
        "instrumental_path": str(dummy_wav),
    }

    req = RenderRequest(style_config={"sync_mode": "line"})

    with (
        patch("backend.main.WORKER_SEMAPHORE"),
        patch("backend.main.video_renderer.generate_ass_subtitles") as mock_sub,
        patch("backend.main.audio_mixer.mix_and_shift") as mock_mix,
        patch("backend.main.video_renderer.render_video") as mock_render,
        patch("backend.main.youtube_service.generate_youtube_package"),
    ):
        mock_mix.return_value = str(dummy_wav)
        mock_render.return_value = tmp_path / f"{pid}_karaoke.mp4"

        run_video_render(pid, req)

        assert mock_sub.called
        kwargs = mock_sub.call_args.kwargs
        assert kwargs.get("sync_mode") == "line"


# ============================================================================
# Tier 6: Dual-Mode Parity Comparison (Real-World Application Scenario)
# ============================================================================


def test_dual_mode_export_parity_comparison():
    """Verify dual-mode export parity: same project exported in both Word Sweep

    and Line-by-Line modes yields identical event counts, timing intervals,
    duet styles, countdowns, and chords, differing only in the presence vs
    absence of progressive \\kf sweep tags.
    """
    word_ass = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS,
        chords=SAMPLE_CHORDS,
        include_chords=True,
        include_countdown=True,
        sync_mode="word",
    )
    line_ass = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS,
        chords=SAMPLE_CHORDS,
        include_chords=True,
        include_countdown=True,
        sync_mode="line",
    )

    parsed_word = parse_ass(word_ass)
    parsed_line = parse_ass(line_ass)

    # 1. Total event count parity
    assert len(parsed_word["events"]) == len(parsed_line["events"])

    # 2. Layer 0 (lyric) event timing and style parity
    word_lyrics = [e for e in parsed_word["events"] if e.get("Layer") == "0"]
    line_lyrics = [e for e in parsed_line["events"] if e.get("Layer") == "0"]
    assert len(word_lyrics) == len(line_lyrics) == 3

    for w_ev, l_ev in zip(word_lyrics, line_lyrics, strict=True):
        assert w_ev["Start"] == l_ev["Start"]
        assert w_ev["End"] == l_ev["End"]
        assert w_ev["Style"] == l_ev["Style"]

        # Word mode must have \kf tags
        assert "\\kf" in w_ev["Text"]
        # Line mode must have zero \kf tags
        assert "\\kf" not in l_ev["Text"]

    # 3. Layer 1 (countdown) parity
    word_countdowns = [e for e in parsed_word["events"] if e.get("Layer") == "1"]
    line_countdowns = [e for e in parsed_line["events"] if e.get("Layer") == "1"]
    assert len(word_countdowns) == len(line_countdowns) == 1
    assert word_countdowns[0]["Start"] == line_countdowns[0]["Start"]
    assert word_countdowns[0]["End"] == line_countdowns[0]["End"]

    # 4. Layer 2 (chords) parity
    word_chords = [e for e in parsed_word["events"] if e.get("Layer") == "2"]
    line_chords = [e for e in parsed_line["events"] if e.get("Layer") == "2"]
    assert len(word_chords) == len(line_chords) == 3
    for wc, lc in zip(word_chords, line_chords, strict=True):
        assert wc["Start"] == lc["Start"]
        assert wc["End"] == lc["End"]
        assert wc["Text"] == lc["Text"]
