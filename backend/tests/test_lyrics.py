import re

import pytest

from backend.services.lyrics import LyricsService

SAMPLE_LRC = """[00:04.20]First line of the song
[00:08.50]Second line with more words
[00:14.00]Final chorus line
"""


def test_parse_lrc():
    lines = LyricsService.parse_lrc(SAMPLE_LRC)
    assert len(lines) == 3

    # First line checks
    assert lines[0]["text"] == "First line of the song"
    assert lines[0]["start_time"] == 4.2
    assert lines[0]["end_time"] == 8.5
    assert len(lines[0]["words"]) == 5
    assert lines[0]["words"][0]["word"] == "First"
    assert lines[0]["words"][0]["start_time"] == 4.2

    # Second line checks
    assert lines[1]["text"] == "Second line with more words"
    assert lines[1]["start_time"] == 8.5
    assert lines[1]["end_time"] == 14.0

    # Ensure each word has start_time <= end_time
    for line in lines:
        for w in line["words"]:
            assert w["start_time"] <= w["end_time"]


def test_parse_plain_text():
    text = "Hello world\nThis is a karaoke test"
    lines = LyricsService.parse_plain_text(text)
    assert len(lines) == 2
    assert lines[0]["text"] == "Hello world"
    assert len(lines[0]["words"]) == 2
    assert lines[1]["text"] == "This is a karaoke test"


def test_update_lyrics_endpoint_validation(client):
    from backend.main import projects

    proj_id = "test_lyric_schema"
    projects[proj_id] = {"id": proj_id, "lines": []}

    # Valid schema payload
    valid_payload = {
        "lines": [
            {
                "id": 1,
                "text": "Hello world",
                "start_time": 1.0,
                "end_time": 3.0,
                "words": [
                    {"word": "Hello", "start_time": 1.0, "end_time": 1.8},
                    {"word": "world", "start_time": 2.0, "end_time": 3.0},
                ],
            }
        ]
    }
    res = client.post(f"/api/project/{proj_id}/lyrics", json=valid_payload)
    assert res.status_code == 200
    assert res.json()["lines_count"] == 1
    assert projects[proj_id]["lines"][0]["text"] == "Hello world"

    # Invalid schema payload (missing required start_time and text)
    invalid_payload = {"lines": [{"id": 1}]}
    bad_res = client.post(f"/api/project/{proj_id}/lyrics", json=invalid_payload)
    assert bad_res.status_code == 422  # Pydantic validation failure


def test_is_lrc_standard_and_variations():
    """is_lrc auto-detects presence of various LRC timestamp formats."""
    # Standard 2-digit fraction
    assert LyricsService.is_lrc("[00:04.20] First line") is True
    # 3-digit millisecond fraction
    assert LyricsService.is_lrc("[01:23.456] Second line") is True
    # 1-digit minute
    assert LyricsService.is_lrc("[1:05.12] Third line") is True
    # Integer second without fraction
    assert LyricsService.is_lrc("[02:15] Fourth line") is True
    # Repeated timestamps on one line
    assert LyricsService.is_lrc("[00:04.20][00:15.50] Refrain text") is True
    # Mixed content with surrounding text
    assert LyricsService.is_lrc("Intro notes...\n[00:05.00] First sung words") is True


def test_is_lrc_negative_cases():
    """is_lrc does not misclassify bracketed section headings, metadata, or plain text."""
    # Common section headings
    assert LyricsService.is_lrc("[Verse 1]\nFirst line") is False
    assert LyricsService.is_lrc("[Chorus]\nSing along") is False
    assert LyricsService.is_lrc("[Bridge]\nSlow down") is False
    assert LyricsService.is_lrc("[Intro]\n[Outro]") is False
    assert LyricsService.is_lrc("[Hook]\nCatchy line") is False

    # Metadata headers
    assert LyricsService.is_lrc("[ti:Song Title]\n[ar:Artist Name]\n[al:Album Name]") is False
    assert LyricsService.is_lrc("[by:Creator]\n[offset:0]") is False

    # Other non-timestamp brackets
    assert LyricsService.is_lrc("[123] Numbered line") is False
    assert LyricsService.is_lrc("[Track 1] Audio track") is False
    assert LyricsService.is_lrc("[12:345] Invalid seconds") is False

    # Plain text without brackets
    assert LyricsService.is_lrc("Just some plain lyrics\nWithout any brackets") is False

    # Empty, whitespace, None, non-string
    assert LyricsService.is_lrc("") is False
    assert LyricsService.is_lrc("   \n\t  ") is False
    assert LyricsService.is_lrc(None) is False  # type: ignore[arg-type]
    assert LyricsService.is_lrc(12345) is False  # type: ignore[arg-type]


def test_parse_lrc_multi_timestamps_and_tag_stripping():
    """parse_lrc handles multi-timestamp lines and strips all tags from text and words."""
    lrc = (
        "[00:04.20][00:16.00] Chorus line repeats\n"
        "[00:08.50] Middle line with <00:09.50> inline [00:10.00] tags\n"
    )
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 3

    # Check chronological ordering: 4.20, 8.50, 16.00
    assert lines[0]["start_time"] == 4.2
    assert lines[0]["text"] == "Chorus line repeats"
    assert lines[1]["start_time"] == 8.5
    assert lines[1]["text"] == "Middle line with inline tags"
    assert lines[2]["start_time"] == 16.0
    assert lines[2]["text"] == "Chorus line repeats"

    # Verify no raw timestamp tags leak into any line text or word tokens
    for line in lines:
        assert not re.search(r"\[\d{1,2}:\d{2}", line["text"])
        assert not re.search(r"<\d{1,2}:\d{2}", line["text"])
        for w in line["words"]:
            assert not re.search(r"\[\d{1,2}:\d{2}", w["word"])
            assert not re.search(r"<\d{1,2}:\d{2}", w["word"])
            assert w["start_time"] <= w["end_time"]


def test_parse_lrc_out_of_order_sorting():
    """parse_lrc sorts lines chronologically regardless of original line order."""
    lrc = "[00:20.00] Outro line\n[00:02.00] Intro line\n[00:10.00] Chorus line\n"
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 3
    assert lines[0]["start_time"] == 2.0
    assert lines[0]["text"] == "Intro line"
    assert lines[1]["start_time"] == 10.0
    assert lines[1]["text"] == "Chorus line"
    assert lines[2]["start_time"] == 20.0
    assert lines[2]["text"] == "Outro line"


def test_parse_lrc_empty_and_tag_only_lines():
    """parse_lrc skips empty lines and lines consisting solely of timestamp tags."""
    lrc = "[00:01.00]\n\n[00:05.00] Real lyrics line\n[00:10.00]   \n"
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 1
    assert lines[0]["start_time"] == 5.0
    assert lines[0]["text"] == "Real lyrics line"

    # Non-string or empty input
    assert LyricsService.parse_lrc("") == []
    assert LyricsService.parse_lrc(None) == []  # type: ignore[arg-type]


def test_process_custom_lyrics():
    """process_custom_lyrics properly differentiates LRC from plain text."""
    service = LyricsService()

    # 1. Valid LRC
    lrc_input = "[00:04.20] First line\n[00:08.50] Second line"
    res_lrc = service.process_custom_lyrics(lrc_input)
    assert res_lrc["source"] == "custom"
    assert res_lrc["synced"] is True
    assert len(res_lrc["lines"]) == 2
    assert res_lrc["lines"][0]["start_time"] == 4.2
    assert res_lrc["plain_lyrics"] == "First line\nSecond line"
    assert res_lrc["lrc"] == lrc_input

    # 2. Plain text without timestamps
    plain_input = "First line\nSecond line"
    res_plain = service.process_custom_lyrics(plain_input)
    assert res_plain["source"] == "custom"
    assert res_plain["synced"] is False
    assert len(res_plain["lines"]) == 2
    assert res_plain["lines"][0]["start_time"] == 0.0
    assert res_plain["plain_lyrics"] == plain_input

    # 3. Plain text with section headings
    section_input = "[Verse 1]\nLine one\n[Chorus]\nLine two"
    res_section = service.process_custom_lyrics(section_input)
    assert res_section["source"] == "custom"
    assert res_section["synced"] is False
    assert len(res_section["lines"]) == 4

    # 4. Empty or whitespace input
    res_empty = service.process_custom_lyrics("")
    assert res_empty["source"] == "none"
    assert res_empty["synced"] is False
    assert res_empty["lines"] == []

    # 5. LRC tags without text falls back to plain text
    res_empty_lrc = service.process_custom_lyrics("[00:01.00]\n[00:02.00]")
    assert res_empty_lrc["source"] == "custom"
    assert res_empty_lrc["synced"] is False


def test_format_lrc_timestamp_standard_and_fractions():
    """format_lrc_timestamp correctly formats zero, whole seconds, and fractional centiseconds."""
    assert LyricsService.format_lrc_timestamp(0.0) == "[00:00.00]"
    assert LyricsService.format_lrc_timestamp(4.2) == "[00:04.20]"
    assert LyricsService.format_lrc_timestamp(8.5) == "[00:08.50]"
    assert LyricsService.format_lrc_timestamp(14.0) == "[00:14.00]"
    assert LyricsService.format_lrc_timestamp(63.456) == "[01:03.46]"
    assert LyricsService.format_lrc_timestamp(120.0) == "[02:00.00]"


def test_format_lrc_timestamp_edge_cases_and_clamping():
    """format_lrc_timestamp handles rollover rounding, negative values, non-finites, and long durations."""
    # Rollover case: 59.996s rounds to 60.00s -> must advance minute to [01:00.00]
    assert LyricsService.format_lrc_timestamp(59.996) == "[01:00.00]"
    # Negative seconds clamped to 0.0
    assert LyricsService.format_lrc_timestamp(-3.5) == "[00:00.00]"
    # NaN and infinite timestamps clamped to 0.0
    assert LyricsService.format_lrc_timestamp(float("nan")) == "[00:00.00]"
    assert LyricsService.format_lrc_timestamp(float("inf")) == "[00:00.00]"
    assert LyricsService.format_lrc_timestamp(float("-inf")) == "[00:00.00]"
    # Large timestamps exceeding 60 minutes accumulate in minutes field
    assert LyricsService.format_lrc_timestamp(3665.50) == "[61:05.50]"
    # Non-numeric inputs handled safely
    assert LyricsService.format_lrc_timestamp("invalid") == "[00:00.00]"  # type: ignore[arg-type]
    assert LyricsService.format_lrc_timestamp(None) == "[00:00.00]"  # type: ignore[arg-type]


def test_generate_lrc_chronological_ordering():
    """generate_lrc sorts out-of-order lines chronologically by start_time."""
    out_of_order = [
        {"id": 3, "text": "Third line", "start_time": 20.0},
        {"id": 1, "text": "First line", "start_time": 2.0},
        {"id": 2, "text": "Second line", "start_time": 10.0},
    ]
    lrc = LyricsService.generate_lrc(out_of_order)
    expected = [
        "[00:02.00]First line",
        "[00:10.00]Second line",
        "[00:20.00]Third line",
    ]
    assert lrc.strip().split("\n") == expected


def test_generate_lrc_strips_embedded_tags_and_whitespace():
    """generate_lrc strips existing inline or leading timestamp tags and normalizes spaces."""
    dirty_lines = [
        {"id": 0, "text": "  [00:04.20] Clean text <00:05.00> line  ", "start_time": 4.2},
        {"id": 1, "text": "Line with\t extra   spaces   ", "start_time": 8.0},
    ]
    lrc = LyricsService.generate_lrc(dirty_lines)
    assert "[00:04.20]Clean text line" in lrc
    assert "[00:08.00]Line with extra spaces" in lrc


def test_generate_lrc_metadata_headers():
    """generate_lrc emits [ti:...] and [ar:...] tags when metadata is provided."""
    lines = [{"id": 0, "text": "Sing along", "start_time": 5.0}]
    # With title and artist
    lrc_with_meta = LyricsService.generate_lrc(lines, title="Bohemian Rhapsody", artist="Queen")
    assert lrc_with_meta.startswith("[ti:Bohemian Rhapsody]\n[ar:Queen]\n")
    assert "[00:05.00]Sing along" in lrc_with_meta

    # Without metadata
    lrc_no_meta = LyricsService.generate_lrc(lines)
    assert not lrc_no_meta.startswith("[ti:")
    assert not lrc_no_meta.startswith("[ar:")
    assert lrc_no_meta.startswith("[00:05.00]Sing along")


def test_generate_lrc_roundtrip_with_parse_lrc():
    """parse_lrc(generate_lrc(lines)) produces identical line text and start_times."""
    sample = (
        "[00:04.20]First line of the song\n"
        "[00:08.50]Second line with more words\n"
        "[00:14.00]Final chorus line\n"
    )
    parsed = LyricsService.parse_lrc(sample)
    regenerated = LyricsService.generate_lrc(parsed)
    assert regenerated == sample
    reparsed = LyricsService.parse_lrc(regenerated)
    assert len(reparsed) == len(parsed)
    for orig, rep in zip(parsed, reparsed, strict=True):
        assert orig["text"] == rep["text"]
        assert orig["start_time"] == rep["start_time"]


def test_generate_lrc_empty_and_edge_cases():
    """generate_lrc safely handles empty line lists, whitespace-only text, and non-list inputs."""
    assert LyricsService.generate_lrc([]) == ""
    assert (
        LyricsService.generate_lrc([], title="Song", artist="Artist") == "[ti:Song]\n[ar:Artist]\n"
    )
    empty_lines = [{"id": 0, "text": "   ", "start_time": 1.0}]
    assert LyricsService.generate_lrc(empty_lines) == ""
    assert LyricsService.generate_lrc(None) == ""  # type: ignore[arg-type]
