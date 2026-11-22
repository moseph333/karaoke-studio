r"""Unit and integration test suite for Milestone M2:
Line-by-line lyric synchronization display and export mode in ASS subtitles and video render pipeline.

Validates:
1. ass_generator.py sync_mode support ('word' progressive \kf sweeps vs 'line' instant highlight).
2. Lead-in unsung timing {\k...}{\k0} in line mode, and direct text when the line shows as it starts.
3. Zero \kf tags in line mode lyric events.
4. Duet parts' colours, the look's and custom ones, in line mode.
5. Count-ins (layer 1) and chords (layer 2) preservation in line mode.
6. Aspect ratios (16:9 and 9:16) in line mode.
7. video_renderer.py method wrappers forwarding sync_mode.
8. RenderRequest Pydantic schema validation for sync_mode.
9. GET /api/project/{id}/export/ass HTTP endpoint with sync_mode query parameter (200 for 'word'/'line', 400 for invalid).
10. render_worker.py subtitle generation with sync_mode='line'.
11. Dual-mode parity comparison across identical project fixtures.

The lyric events are found by the role in their Name field (lyric:<line index>, one event per
row of a line). Tests about the text as written or the two alternating rows ask for the KTV
look; the default look (Marquee) writes the line being sung in capitals.
"""

from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, projects
from backend.schemas import RenderRequest
from backend.services.ass_generator import (
    BACKSLASH_GUARD,
    generate_ass_content,
    generate_ass_subtitles,
)
from backend.services.stage_looks import DEFAULT_LOOK_ID, LOOKS
from backend.services.video_renderer import VideoRenderer
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass

# ============================================================================
# Helpers & Fixtures
# ============================================================================


def lyric_rows(ass_text: str) -> list[AssEvent]:
    """The events that draw a line being sung: one per row of each line, in file order."""
    return [e for e in ass_events(ass_text) if e.kind == "lyric"]


def sweep(event: AssEvent) -> str:
    """An event's karaoke tags and words: its text after the first override block, which
    holds its place, size and colours."""
    return event.text[len(event.tags) + 2 :] if event.text.startswith("{") else event.text


def tag_color(css: str) -> str:
    """A CSS colour (#rrggbb) as an override tag writes it (&HBBGGRR&)."""
    return f"&H{css[5:7]}{css[3:5]}{css[1:3]}&".upper()


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
    rows = lyric_rows(generate_ass_content(SAMPLE_LINES_WITH_WORDS))
    assert {row.line for row in rows} == {0, 1, 2}

    for row in rows:
        assert "\\kf" in row.text, f"Expected \\kf tag in word sweep mode, got: {row.text}"


def test_line_mode_generates_zero_kf_tags():
    """Verify that sync_mode='line' produces zero \\kf tags on all lyric lines."""
    rows = lyric_rows(generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="line"))
    assert {row.line for row in rows} == {0, 1, 2}

    for row in rows:
        assert "\\kf" not in row.text, f"Found illegal \\kf tag in line sync mode: {row.text}"


def test_line_mode_lead_in_timing_format():
    """Verify that lead-in timing produces {\\k<cs>}{\\k0} when the line shows before it starts."""
    lines = [
        {
            "id": 0,
            "start_time": 4.0,  # shows at max(0, 4.0 - 2.5) = 1.5s -> lead_in = 2.5s = 250cs
            "end_time": 7.0,
            "text": "Hello world",
        }
    ]
    ass_text = generate_ass_content(
        lines, sync_mode="line", include_countdown=False, theme_id="ktv"
    )

    (row,) = lyric_rows(ass_text)
    assert row.start == pytest.approx(1.5)
    assert sweep(row) == "{\\k250}{\\k0}Hello world"


def test_line_mode_immediate_start_without_lead_in_tag():
    """Verify that when the line shows as it starts (no lead-in), no \\k tag is prepended."""
    lines = [
        {
            "id": 0,
            "start_time": 0.0,  # shows at 0.0 -> no lead-in
            "end_time": 3.0,
            "text": "Immediate lyric line",
        }
    ]
    ass_text = generate_ass_content(
        lines, sync_mode="line", include_countdown=False, theme_id="ktv"
    )

    (row,) = lyric_rows(ass_text)
    assert row.start == 0.0
    # Without a lead-in the text is clean, with zero \k or \kf tags
    assert sweep(row) == "Immediate lyric line"


def test_line_mode_style_config_sync_mode_fallback():
    """Verify that style_config={'sync_mode': 'line'} is honored when sync_mode param is omitted."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, style_config={"sync_mode": "line"})

    rows = lyric_rows(ass_text)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text


def test_invalid_sync_mode_falls_back_to_word_mode():
    """Verify that invalid sync_mode string gracefully falls back to 'word' mode."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="invalid_mode")

    # Every row has \kf tags because it fell back to word mode
    rows = lyric_rows(ass_text)
    assert rows and all("\\kf" in row.text for row in rows)


def test_case_insensitive_sync_mode():
    """Verify that 'LINE', 'Line', and whitespace are handled cleanly."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="  LINE  ")

    rows = lyric_rows(ass_text)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text


# ============================================================================
# Tier 2: Boundary, Duet & Feature Preservation in Line Mode
# ============================================================================


def test_line_mode_preserves_duet_styles():
    """Verify that singer1, singer2, and both lines are drawn in their parts' colours in line mode."""
    ass_text = generate_ass_content(SAMPLE_LINES_WITH_WORDS, sync_mode="line")
    palette = LOOKS[DEFAULT_LOOK_ID]["palette"]

    rows = lyric_rows(ass_text)
    sung_as = {"sung": 0, "singer2": 1, "both": 2}  # the palette colour each line is sung in
    for color, index in sung_as.items():
        mine = [row for row in rows if row.line == index]
        assert mine
        for row in mine:
            assert f"\\1c{tag_color(palette[color])}" in row.tags
            assert f"\\2c{tag_color(palette['unsung'])}" in row.tags

    # Each line is by another part than the one before, so each carries its part's name
    named = {e.line: e for e in ass_events(ass_text) if e.kind == "part"}
    assert sorted(named) == [0, 1, 2]
    assert f"\\1c{tag_color(palette['singer2'])}" in named[1].tags
    assert f"\\1c{tag_color(palette['both'])}" in named[2].tags


def test_line_mode_with_custom_duet_colors():
    """Verify that custom singer2_color and both_color overrides propagate in line mode."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS,
        sync_mode="line",
        singer2_color="#FF0088",  # ASS: &H8800FF&
        both_color="#00FFAA",  # ASS: &HAAFF00&
    )
    rows = lyric_rows(ass_text)

    assert all("\\1c&H8800FF&" in row.tags for row in rows if row.line == 1)
    assert all("\\1c&HAAFF00&" in row.tags for row in rows if row.line == 2)
    # Singer 1 keeps the look's own sung colour
    sung = tag_color(LOOKS[DEFAULT_LOOK_ID]["palette"]["sung"])
    assert all(f"\\1c{sung}" in row.tags for row in rows if row.line == 0)


def test_line_mode_preserves_instrumental_gap_countdown():
    """Verify that the count-in after an instrumental gap is preserved on Layer 1 in line mode."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS, sync_mode="line", include_countdown=True
    )

    # Only line 2 follows a gap (8.0s -> 13.0s): three numerals, one a second, until it starts
    count_in = [e for e in ass_events(ass_text) if e.kind == "countin"]
    assert {e.line for e in count_in} == {2}
    assert all(e.layer == 1 for e in count_in)
    assert [e.plain for e in count_in] == ["3", "2", "1"]
    assert [(e.start, e.end) for e in count_in] == [(10.0, 11.0), (11.0, 12.0), (12.0, 13.0)]

    without = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS, sync_mode="line", include_countdown=False
    )
    assert not [e for e in ass_events(without) if e.kind in ("countin", "break")]


def test_line_mode_preserves_layer_2_chords():
    """Verify that musical chord cues are preserved on Layer 2 in line mode."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS,
        chords=SAMPLE_CHORDS,
        include_chords=True,
        semitones=2,  # C -> D, G -> A, Am -> Bm
        sync_mode="line",
    )

    chord_events = [e for e in ass_events(ass_text) if e.kind == "chord"]
    assert [e.plain for e in chord_events] == ["D", "A", "Bm"]
    assert all(e.layer == 2 for e in chord_events)
    assert [(e.start, e.end) for e in chord_events] == [(2.5, 5.0), (5.5, 8.0), (13.0, 16.0)]


def test_line_mode_untimed_lines_without_words():
    """Verify line mode handles lines without 'words' array (plain text only)."""
    lines = [
        {"id": 0, "start_time": 2.0, "end_time": 5.0, "text": "Untimed line one"},
        {"id": 1, "start_time": 6.0, "end_time": 9.0, "text": "Untimed line two"},
    ]
    ass_text = generate_ass_content(lines, sync_mode="line", theme_id="ktv")

    first, second = lyric_rows(ass_text)
    assert (first.line, first.plain) == (0, "Untimed line one")
    assert "\\kf" not in first.text
    assert (second.line, second.plain) == (1, "Untimed line two")
    assert "\\kf" not in second.text


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
    ass_text = generate_ass_content(lines, sync_mode="line", theme_id="ktv")

    (row,) = lyric_rows(ass_text)
    assert row.plain == "Reconstructed Sentence"
    assert "\\kf" not in row.text


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
    ass_text = generate_ass_content(lines, sync_mode="line", theme_id="ktv")

    # A line this long takes two rows: one event each
    rows = lyric_rows(ass_text)
    written = " ".join(sweep(row) for row in rows)
    # In ASS, escaped braces are \{ and \}
    assert "\\{bracket\\}" in written
    # A backslash is parted from the letter after it, so it starts no tag
    assert f"\\{BACKSLASH_GUARD}backslash" in written
    # The line break is gone, and the words around it are still there
    assert "\n" not in written
    assert written.endswith("and newline")
    assert "\\kf" not in written


def test_line_mode_vertical_9_16_aspect_ratio():
    """Verify line mode correctly sets PlayRes and keeps the rows inside the frame for 9:16 layout."""
    ass_text = generate_ass_content(
        SAMPLE_LINES_WITH_WORDS, aspect_ratio="9:16", sync_mode="line", theme_id="ktv"
    )
    parsed = parse_ass(ass_text)

    assert parsed["info"]["PlayResX"] == "1080"
    assert parsed["info"]["PlayResY"] == "1920"
    rows = lyric_rows(ass_text)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        x, y = row.numbers("pos")
        assert 0 <= x <= 1080
        assert 0 <= y <= 1920
        assert "\\kf" not in row.text


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
    rows = lyric_rows(content)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text

    # No \kf exists anywhere in the entire document, with the count-in or without
    assert "\\kf" not in content
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

    rows = lyric_rows(ass_text)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text


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
    rows = lyric_rows(out_file.read_text(encoding="utf-8"))
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text


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

    # The KTV look writes the words as they are in the lyrics
    resp = test_client.get(
        f"/api/project/{pid}/export/ass?sync_mode=line&theme_id=ktv",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert "text/x-ssa" in resp.headers["content-type"]
    rows = lyric_rows(resp.text)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text
    assert "Never gonna give you up" in [row.plain for row in rows]

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
    rows = lyric_rows(resp.text)
    assert {row.line for row in rows} == {0, 1, 2}
    for row in rows:
        assert "\\kf" not in row.text


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

    and Line-by-Line modes yields identical events, timing intervals, part
    colours, count-ins, and chords, differing only in the presence vs
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

    word_events = ass_events(word_ass)
    line_events = ass_events(line_ass)

    # 1. The same events, in the same order, at the same times
    def outline(events: list[AssEvent]) -> list[tuple]:
        return [(e.layer, e.role, e.style, e.start, e.end) for e in events]

    assert outline(word_events) == outline(line_events)

    # 2. Lyric rows: the same place, size, colours and words; only the sweep differs
    word_lyrics = [e for e in word_events if e.kind == "lyric"]
    line_lyrics = [e for e in line_events if e.kind == "lyric"]
    assert {e.line for e in word_lyrics} == {0, 1, 2}

    for w_ev, l_ev in zip(word_lyrics, line_lyrics, strict=True):
        assert w_ev.tags == l_ev.tags
        assert w_ev.plain == l_ev.plain

        # Word mode must have \kf tags
        assert "\\kf" in w_ev.text
        # Line mode must have zero \kf tags
        assert "\\kf" not in l_ev.text

    # 3. Everything else is written the same: the count-in (layer 1), the chords (layer 2),
    # the part names and the lines waiting their turn
    word_rest = [e for e in word_events if e.kind != "lyric"]
    line_rest = [e for e in line_events if e.kind != "lyric"]
    assert [e.text for e in word_rest] == [e.text for e in line_rest]
    assert len([e for e in word_rest if e.kind == "countin" and e.layer == 1]) == 3
    assert [e.plain for e in word_rest if e.kind == "chord" and e.layer == 2] == ["C", "G", "Am"]
