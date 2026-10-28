import re
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf
from pydantic import ValidationError

from backend.schemas import LyricLineSchema
from backend.services.aligner import AudioAligner
from backend.services.lyrics import LyricsNormalizer, LyricsService

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


@pytest.mark.parametrize(
    "heading",
    [
        "[Verse 1]",
        "[Verse 2: Kendrick Lamar]",
        "(Chorus x2)",
        "[Pre-Chorus]",
        "{Bridge}",
        "[Instrumental]",
        "[Guitar Solo]",
        "Chorus:",
        "Verse 3",
        "  OUTRO  ",
        "[Hook 2x]",
        "[Intro – Spoken]",
    ],
)
def test_plain_text_drops_section_labels(heading):
    lines = LyricsService.parse_plain_text(f"{heading}\nSing this line")
    assert [line["text"] for line in lines] == ["Sing this line"]


@pytest.mark.parametrize(
    "lyric",
    [
        "(Ooh, baby)",
        "Bridge over troubled water",
        "Drop",
        "Chorus of angels singing",
        "[Woah oh oh]",
        "Verse after verse I sing",
        "(Hey!)",
    ],
)
def test_plain_text_keeps_sung_lines_that_look_like_labels(lyric):
    assert [line["text"] for line in LyricsService.parse_plain_text(lyric)] == [lyric]


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

    # 3. Plain text with section headings: the labels are not sung, so they are dropped
    section_input = "[Verse 1]\nLine one\n[Chorus]\nLine two"
    res_section = service.process_custom_lyrics(section_input)
    assert res_section["source"] == "custom"
    assert res_section["synced"] is False
    assert [line["text"] for line in res_section["lines"]] == ["Line one", "Line two"]
    assert [line["id"] for line in res_section["lines"]] == [0, 1]
    assert res_section["plain_lyrics"] == section_input

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


def test_is_lrc_multi_digit_minutes_and_extended_tracks():
    """is_lrc auto-detects LRC timestamps with 3 and 4 minute digits (100+ minutes)."""
    # 100+ minutes (operas, DJ sets, long live performances)
    assert LyricsService.is_lrc("[100:00.00] Century mark") is True
    assert LyricsService.is_lrc("[120:45.678] Two hours in") is True
    assert LyricsService.is_lrc("[9999:59.99] Upper 4-digit minute boundary") is True

    # 1-digit and 2-digit minutes remain fully supported
    assert LyricsService.is_lrc("[1:05.12] Single digit minute") is True
    assert LyricsService.is_lrc("[04:20.00] Standard 2-digit minute") is True

    # Invalid patterns remain rejected
    assert LyricsService.is_lrc("[12:345] Invalid 3-digit seconds") is False
    assert LyricsService.is_lrc("[123] Missing colon and seconds") is False
    assert LyricsService.is_lrc("[Verse 1]\nLine") is False
    assert LyricsService.is_lrc("[ti:Song Title]") is False


def test_parse_lrc_multi_digit_minutes():
    """parse_lrc accurately extracts lines and computes seconds for 100+ minute tracks."""
    lrc = (
        "[99:58.00] Approaching century\n"
        "[100:00.00] Exactly 100 minutes\n"
        "[125:30.50] Two hours five minutes thirty seconds\n"
    )
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 3

    assert lines[0]["start_time"] == 5998.0  # 99 * 60 + 58
    assert lines[0]["text"] == "Approaching century"

    assert lines[1]["start_time"] == 6000.0  # 100 * 60 + 0
    assert lines[1]["text"] == "Exactly 100 minutes"
    assert lines[1]["words"][0]["start_time"] == 6000.0

    assert lines[2]["start_time"] == 7530.5  # 125 * 60 + 30.5
    assert lines[2]["text"] == "Two hours five minutes thirty seconds"


def test_parse_lrc_strips_multi_digit_word_tags():
    """parse_lrc removes multi-digit word timing tags from lyric text."""
    lrc = "[100:10.00] Line with <100:11.50> inline word <100:13.00> tags\n"
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 1
    assert lines[0]["text"] == "Line with inline word tags"
    assert "<" not in lines[0]["text"]
    assert ">" not in lines[0]["text"]


def test_generate_lrc_multi_digit_minutes():
    """generate_lrc outputs correct [100:xx.xx] tags and passes is_lrc validation."""
    lines = [
        {"id": 1, "text": "Century mark", "start_time": 6000.0},
        {"id": 2, "text": "Two hours plus", "start_time": 7530.5},
    ]
    out = LyricsService.generate_lrc(lines, title="Epic Concert", artist="Symphony")
    assert "[100:00.00]Century mark" in out
    assert "[125:30.50]Two hours plus" in out
    # Must pass is_lrc check
    assert LyricsService.is_lrc(out) is True


def test_generate_lrc_strips_existing_multi_digit_tags():
    """generate_lrc strips existing 100+ minute tags to prevent duplicate tags."""
    dirty_lines = [{"id": 0, "text": "[100:00.00]<100:02.00> Cleaned text", "start_time": 6000.0}]
    out = LyricsService.generate_lrc(dirty_lines)
    assert out.strip() == "[100:00.00]Cleaned text"


def test_process_custom_lyrics_auto_detects_100_min_lrc():
    """process_custom_lyrics correctly classifies and parses 100+ minute LRC text."""
    custom = "[100:00.00] First sung line\n[101:30.00] Second sung line\n"
    res = LyricsService().process_custom_lyrics(custom)
    assert res["synced"] is True
    assert res["source"] == "custom"
    assert len(res["lines"]) == 2
    assert res["lines"][0]["start_time"] == 6000.0
    assert res["lines"][1]["start_time"] == 6090.0


def test_lyric_line_schema_singer_default_and_aliases():
    """LyricLineSchema defaults to 'singer1' and normalizes aliases cleanly."""
    # 1. Default fallback
    line_default = LyricLineSchema(text="Hello", start_time=1.0, end_time=2.0)
    assert line_default.singer == "singer1"

    # 2. None and whitespace fallback to singer1
    line_none = LyricLineSchema(text="Hello", start_time=1.0, end_time=2.0, singer=None)
    assert line_none.singer == "singer1"
    line_empty = LyricLineSchema(text="Hello", start_time=1.0, end_time=2.0, singer="   ")
    assert line_empty.singer == "singer1"

    # 3. Canonical roles
    assert (
        LyricLineSchema(text="A", start_time=1.0, end_time=2.0, singer="singer1").singer
        == "singer1"
    )
    assert (
        LyricLineSchema(text="B", start_time=1.0, end_time=2.0, singer="singer2").singer
        == "singer2"
    )
    assert LyricLineSchema(text="C", start_time=1.0, end_time=2.0, singer="both").singer == "both"

    # 4. Singer 1 aliases
    for alias in ["lead", "LEAD", "singer 1", "Singer 1", "singer_1", "part1", "part 1", "s1"]:
        line = LyricLineSchema(text="Line", start_time=1.0, end_time=2.0, singer=alias)
        assert line.singer == "singer1", f"Alias '{alias}' failed to map to 'singer1'"

    # 5. Singer 2 aliases
    for alias in [
        "partner",
        "PARTNER",
        "singer 2",
        "Singer 2",
        "singer_2",
        "part2",
        "part 2",
        "s2",
    ]:
        line = LyricLineSchema(text="Line", start_time=1.0, end_time=2.0, singer=alias)
        assert line.singer == "singer2", f"Alias '{alias}' failed to map to 'singer2'"

    # 6. Both / Unison aliases
    for alias in ["both", "BOTH", "unison", "Unison", "duet", "DUET", "all", "together"]:
        line = LyricLineSchema(text="Line", start_time=1.0, end_time=2.0, singer=alias)
        assert line.singer == "both", f"Alias '{alias}' failed to map to 'both'"

    # 7. Invalid role rejection
    with pytest.raises(ValidationError):
        LyricLineSchema(text="Bad", start_time=1.0, end_time=2.0, singer="singer3")
    with pytest.raises(ValidationError):
        LyricLineSchema(text="Bad", start_time=1.0, end_time=2.0, singer="alien")


def test_update_lyrics_endpoint_multi_singer_persistence(client):
    """POST /api/project/{id}/lyrics persists multi-singer assignments cleanly into project store."""
    from backend.main import projects

    proj_id = "test_duet_persistence"
    projects[proj_id] = {"id": proj_id, "lines": []}

    payload = {
        "lines": [
            {"id": 0, "text": "Lead verse", "start_time": 1.0, "end_time": 3.0, "singer": "lead"},
            {
                "id": 1,
                "text": "Partner response",
                "start_time": 3.5,
                "end_time": 5.5,
                "singer": "partner",
            },
            {
                "id": 2,
                "text": "Unison chorus",
                "start_time": 6.0,
                "end_time": 8.0,
                "singer": "unison",
            },
            {"id": 3, "text": "Default line", "start_time": 8.5, "end_time": 10.0},
        ]
    }

    res = client.post(f"/api/project/{proj_id}/lyrics", json=payload)
    assert res.status_code == 200
    assert res.json()["lines_count"] == 4

    saved_lines = projects[proj_id]["lines"]
    assert saved_lines[0]["singer"] == "singer1"
    assert saved_lines[1]["singer"] == "singer2"
    assert saved_lines[2]["singer"] == "both"
    assert saved_lines[3]["singer"] == "singer1"


# ==============================================================================
# Milestone 1: Requirement R1 (Normalization, Ranking, Enhanced LRC, and Offsets)
# ==============================================================================


def test_lyrics_normalizer_bracketed_noise():
    """LyricsNormalizer removes diverse bracketed media suffixes while preserving title content."""
    assert (
        LyricsNormalizer.clean_title("Bohemian Rhapsody (Official Music Video)")
        == "Bohemian Rhapsody"
    )
    assert LyricsNormalizer.clean_title("Song Name [Official Video]") == "Song Name"
    assert LyricsNormalizer.clean_title("Another Track (Official Audio)") == "Another Track"
    assert LyricsNormalizer.clean_title("Visual Track {Official Visualizer}") == "Visual Track"
    assert LyricsNormalizer.clean_title("Lyric Song (Lyric Video)") == "Lyric Song"
    assert LyricsNormalizer.clean_title("Remastered Hit [Remastered 2021]") == "Remastered Hit"
    assert LyricsNormalizer.clean_title("High Res Track (Official 4K Video)") == "High Res Track"
    assert LyricsNormalizer.clean_title("Live Track (Live from Wembley)") == "Live Track"
    assert LyricsNormalizer.clean_title("French Track (Clip Officiel)") == "French Track"
    assert LyricsNormalizer.clean_title("Spanish Track (Video Oficial)") == "Spanish Track"
    assert LyricsNormalizer.clean_title("Music Video [MV]") == "Music Video"
    assert LyricsNormalizer.clean_title("Clean Title (Audio)") == "Clean Title"
    assert (
        LyricsNormalizer.clean_title("Track With Multiple [HD] (Official Audio) [2024]")
        == "Track With Multiple [2024]"
    )


def test_lyrics_normalizer_featured_artists():
    """LyricsNormalizer strips featured artist clauses and extracts guest artists."""
    clean_t = LyricsNormalizer.clean_title("Song Name ft. Guest Artist")
    feat = LyricsNormalizer.extract_featured("Song Name ft. Guest Artist")
    assert clean_t == "Song Name"
    assert feat == "Guest Artist"

    assert LyricsNormalizer.clean_title("Song Name feat. Co-Singer") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name featuring Famous Star") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name with Guest Artist") == "Song Name"

    # Bracketed variations
    assert LyricsNormalizer.clean_title("Song Name (feat. Guest Artist)") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name [ft. Guest Artist]") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name (with Guest Artist)") == "Song Name"

    # Titles with standard 'with' + pronoun should be preserved
    assert LyricsNormalizer.clean_title("Stay With Me") == "Stay With Me"
    assert LyricsNormalizer.clean_title("Dancing with Myself") == "Dancing with Myself"

    # Artist string featuring clause removal
    assert LyricsNormalizer.clean_artist("Primary Artist feat. Guest") == "Primary Artist"
    assert LyricsNormalizer.clean_artist("Primary Artist ft. Second Singer") == "Primary Artist"


def test_lyrics_normalizer_topic_and_vevo():
    """LyricsNormalizer cleans YouTube Topic channels and VEVO suffixes from artist names."""
    assert LyricsNormalizer.clean_artist("Coldplay - Topic") == "Coldplay"
    assert LyricsNormalizer.clean_artist("Daft Punk - topic") == "Daft Punk"
    assert LyricsNormalizer.clean_artist("QueenVEVO") == "Queen"
    assert LyricsNormalizer.clean_artist("Queen VEVO") == "Queen"
    assert LyricsNormalizer.clean_artist("TaylorSwiftVEVO") == "TaylorSwift"
    assert LyricsNormalizer.clean_artist("Artist - Official Channel") == "Artist"
    assert LyricsNormalizer.clean_artist("Artist Official") == "Artist"


def test_lyrics_normalizer_delimiter_noise():
    """LyricsNormalizer cleans unbracketed delimiter noise (| // - :) from titles."""
    assert (
        LyricsNormalizer.clean_title("Bohemian Rhapsody | Official Music Video")
        == "Bohemian Rhapsody"
    )
    assert LyricsNormalizer.clean_title("Song Name // Official Audio") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name - Lyric Video") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name : Visualizer") == "Song Name"
    assert LyricsNormalizer.clean_title("Song Name | HD") == "Song Name"


def test_lyrics_normalizer_canonical_split_and_edge_cases():
    """LyricsNormalizer handles combined Artist - Title titles and edge inputs safely."""
    # When title contains ' - ' and artist is unknown/empty
    title, artist = LyricsNormalizer.normalize_track_metadata(
        "Queen - Bohemian Rhapsody (Official Video)", "Unknown Artist"
    )
    assert title == "Bohemian Rhapsody"
    assert artist == "Queen"

    title2, artist2 = LyricsNormalizer.normalize_track_metadata("Coldplay - Yellow [HD]", "")
    assert title2 == "Yellow"
    assert artist2 == "Coldplay"

    # Robustness against None, empty, whitespace
    assert LyricsNormalizer.clean_title("") == ""
    assert LyricsNormalizer.clean_title("   ") == ""
    assert LyricsNormalizer.clean_title(None) == ""
    assert LyricsNormalizer.clean_artist("") == "Unknown Artist"
    assert LyricsNormalizer.clean_artist("   ") == "Unknown Artist"
    assert LyricsNormalizer.clean_artist(None) == "Unknown Artist"


def test_candidate_ranking_synced_priority_over_plain():
    """rank_candidates prefers candidates with syncedLyrics over plainLyrics even if plain is first."""
    candidates = [
        {
            "id": 1,
            "trackName": "Song",
            "artistName": "Artist",
            "duration": 200,
            "plainLyrics": "Just plain text lyrics",
            "syncedLyrics": "",
        },
        {
            "id": 2,
            "trackName": "Song",
            "artistName": "Artist",
            "duration": 202,
            "plainLyrics": "Plain text lyrics",
            "syncedLyrics": "[00:02.00] Synced line\n[00:05.00] Second synced line",
        },
    ]
    best = LyricsService.rank_candidates(
        candidates, target_title="Song", target_artist="Artist", target_duration=200.0
    )
    assert best is not None
    assert best["id"] == 2
    assert best["syncedLyrics"] != ""


def test_candidate_ranking_duration_proximity_and_penalty():
    """rank_candidates prefers duration-matched candidates over long extended or preview cuts."""
    candidates = [
        {
            "id": 10,
            "trackName": "My Song",
            "artistName": "My Artist",
            "duration": 480,  # 8 minute extended/live cut (diff = 270s)
            "syncedLyrics": "[00:01.00] Synced line",
        },
        {
            "id": 20,
            "trackName": "My Song",
            "artistName": "My Artist",
            "duration": 211,  # Exact 3.5-minute album cut (diff = 1s)
            "syncedLyrics": "[00:01.00] Synced line",
        },
    ]
    best = LyricsService.rank_candidates(
        candidates, target_title="My Song", target_artist="My Artist", target_duration=210.0
    )
    assert best is not None
    assert best["id"] == 20


def test_candidate_ranking_string_similarity():
    """rank_candidates uses difflib sequence matching to select closest title and artist matches."""
    candidates = [
        {
            "id": 100,
            "trackName": "Bohemian Rhapsody Tribute",
            "artistName": "Various Artists",
            "duration": 355,
            "syncedLyrics": "[00:01.00] Is this the real life",
        },
        {
            "id": 200,
            "trackName": "Bohemian Rhapsody",
            "artistName": "Queen",
            "duration": 354,
            "syncedLyrics": "[00:01.00] Is this the real life",
        },
    ]
    best = LyricsService.rank_candidates(
        candidates, target_title="Bohemian Rhapsody", target_artist="Queen", target_duration=354.0
    )
    assert best is not None
    assert best["id"] == 200


def test_candidate_ranking_empty_and_invalid_inputs():
    """rank_candidates handles empty, non-dict, or lyrics-free candidate items safely."""
    assert LyricsService.rank_candidates([], "Title", "Artist") is None
    assert LyricsService.rank_candidates(None, "Title", "Artist") is None
    assert LyricsService.rank_candidates([{"trackName": "No lyrics"}], "Title", "Artist") is None
    assert LyricsService.rank_candidates(["not a dict"], "Title", "Artist") is None


def test_parse_lrc_enhanced_word_timestamps():
    """parse_lrc extracts explicit <mm:ss.xx> word-level timestamps and sets has_word_sync."""
    enhanced_lrc = (
        "[00:10.00] <00:10.04> When <00:10.16> the <00:10.82> truth <00:11.29> is <00:11.63> found <00:12.50>\n"
        "[00:14.00] <00:14.20> And <00:14.50> all <00:15.00> hope\n"
    )
    lines = LyricsService.parse_lrc(enhanced_lrc)
    assert len(lines) == 2

    # Line 0 assertions
    assert lines[0]["has_word_sync"] is True
    assert lines[0]["text"] == "When the truth is found"
    assert lines[0]["start_time"] == 10.0
    assert lines[0]["end_time"] == 14.0

    words0 = lines[0]["words"]
    assert len(words0) == 5
    assert words0[0] == {"word": "When", "start_time": 10.04, "end_time": 10.16}
    assert words0[1] == {"word": "the", "start_time": 10.16, "end_time": 10.82}
    assert words0[2] == {"word": "truth", "start_time": 10.82, "end_time": 11.29}
    assert words0[3] == {"word": "is", "start_time": 11.29, "end_time": 11.63}
    assert words0[4] == {"word": "found", "start_time": 11.63, "end_time": 12.50}

    # Verify monotonicity: start_time < end_time and non-decreasing
    for w in words0:
        assert w["start_time"] <= w["end_time"]
    for i in range(1, len(words0)):
        assert words0[i]["start_time"] >= words0[i - 1]["start_time"]

    # Line 1 assertions
    assert lines[1]["has_word_sync"] is True
    assert lines[1]["text"] == "And all hope"
    assert len(lines[1]["words"]) == 3
    assert lines[1]["words"][0]["word"] == "And"
    assert lines[1]["words"][0]["start_time"] == 14.20


def test_parse_lrc_enhanced_word_timestamps_tag_free_text_and_words():
    """parse_lrc guarantees raw <...> and [...] tags are purged from both line and word texts."""
    lrc = "[00:05.00] <00:05.10> Hello <00:05.50> [chorus] world <00:06.00>\n"
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 1
    assert lines[0]["has_word_sync"] is True
    assert "<" not in lines[0]["text"]
    assert ">" not in lines[0]["text"]
    assert "[" not in lines[0]["text"]
    assert "]" not in lines[0]["text"]
    for w in lines[0]["words"]:
        assert "<" not in w["word"]
        assert ">" not in w["word"]
        assert "[" not in w["word"]
        assert "]" not in w["word"]


def test_parse_lrc_offset_header_positive_and_negative():
    """[offset:+/-ms] follows the LRC convention: positive shows lyrics sooner, negative later."""
    # Positive offset: +500ms -> everything 0.5s earlier
    pos_lrc = "[offset:500]\n[00:04.00] Line one\n[00:10.00] <00:10.20> First <00:10.80> Second\n"
    pos_lines = LyricsService.parse_lrc(pos_lrc)
    assert len(pos_lines) == 2
    assert pos_lines[0]["start_time"] == 3.5  # 4.0 - 0.5
    assert pos_lines[1]["start_time"] == 9.5  # 10.0 - 0.5
    assert pos_lines[1]["words"][0]["word"] == "First"
    assert pos_lines[1]["words"][0]["start_time"] == 9.7  # 10.2 - 0.5
    assert pos_lines[1]["words"][1]["word"] == "Second"
    assert pos_lines[1]["words"][1]["start_time"] == 10.3  # 10.8 - 0.5

    # Negative offset: -500ms -> everything 0.5s later
    neg_lrc = "[offset:-500]\n[00:04.00] Line one\n[00:10.00] <00:10.20> First <00:10.80> Second\n"
    neg_lines = LyricsService.parse_lrc(neg_lrc)
    assert len(neg_lines) == 2
    assert neg_lines[0]["start_time"] == 4.5  # 4.0 + 0.5
    assert neg_lines[1]["start_time"] == 10.5  # 10.0 + 0.5
    assert neg_lines[1]["words"][0]["word"] == "First"
    assert neg_lines[1]["words"][0]["start_time"] == 10.7  # 10.2 + 0.5
    assert neg_lines[1]["words"][1]["word"] == "Second"
    assert neg_lines[1]["words"][1]["start_time"] == 11.3  # 10.8 + 0.5


def test_parse_lrc_offset_clamping_at_zero():
    """parse_lrc clamps shifted timestamps at 0.0 when a positive offset exceeds them."""
    lrc = (
        "[offset:10000]\n"  # 10 seconds sooner
        "[00:04.00] <00:04.20> Word one <00:04.80> Word two\n"
    )
    lines = LyricsService.parse_lrc(lrc)
    assert len(lines) == 1
    assert lines[0]["start_time"] == 0.0  # max(0.0, 4.0 - 10.0)
    for w in lines[0]["words"]:
        assert w["start_time"] >= 0.0
        assert w["end_time"] >= 0.0


def test_aligner_preserves_explicit_word_sync(tmp_path):
    """AudioAligner preserves pre-existing explicit word timings when line has has_word_sync=True."""
    sr = 44100
    duration = 5.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = 0.5 * np.sin(2 * np.pi * 440 * t)
    wav_file = tmp_path / "vocals_align.wav"
    sf.write(str(wav_file), vocals, sr)

    aligner = AudioAligner()
    explicit_words = [
        {"word": "Explicit", "start_time": 1.123, "end_time": 1.850},
        {"word": "Timings", "start_time": 1.850, "end_time": 2.650},
    ]
    raw_lines = [
        {
            "id": 0,
            "text": "Explicit Timings",
            "start_time": 1.0,
            "end_time": 3.0,
            "words": explicit_words,
            "has_word_sync": True,
        }
    ]

    aligned = aligner.align_lyrics(str(wav_file), raw_lines)
    assert len(aligned) == 1
    assert aligned[0]["has_word_sync"] is True
    assert len(aligned[0]["words"]) == 2
    # Timings should be preserved verbatim rather than overwritten by energy envelope
    assert aligned[0]["words"][0]["word"] == "Explicit"
    assert aligned[0]["words"][0]["start_time"] == 1.123
    assert aligned[0]["words"][0]["end_time"] == 1.850
    assert aligned[0]["words"][1]["word"] == "Timings"
    assert aligned[0]["words"][1]["start_time"] == 1.850
    assert aligned[0]["words"][1]["end_time"] == 2.650


def test_fetch_lyrics_lrclib_candidate_ranking_integration():
    """LyricsService.fetch_lyrics invokes candidate ranking when search results are returned."""
    svc = LyricsService()

    def mock_requests_get(url, params=None, timeout=5):
        mock_r = MagicMock()
        if "/get" in url:
            mock_r.status_code = 404
        elif "/search" in url:
            mock_r.status_code = 200
            mock_r.json.return_value = [
                {
                    "id": 1,
                    "trackName": "Yellow",
                    "artistName": "Coldplay",
                    "duration": 480,  # 8 min live cut
                    "syncedLyrics": "[00:01.00] Look at the stars",
                },
                {
                    "id": 2,
                    "trackName": "Yellow",
                    "artistName": "Coldplay",
                    "duration": 269,  # 4.5 min studio cut matching 268s
                    "syncedLyrics": "[00:02.00] Look at the stars\n[00:06.00] Look how they shine",
                },
            ]
        return mock_r

    with patch("requests.get", side_effect=mock_requests_get):
        res = svc.fetch_lyrics("Yellow (Official Video) [HD]", "Coldplay - Topic", duration=268.0)
        assert res["source"] == "lrclib_search"
        assert res["synced"] is True
        assert len(res["lines"]) == 2
        # Selected candidate 2 based on duration matching
        assert res["lines"][0]["start_time"] == 2.0


def test_lyrics_normalizer_ost_and_soundtrack_tags():
    """LyricsNormalizer strips OST, soundtrack, and motion picture clauses."""
    assert (
        LyricsNormalizer.clean_title('A Million Dreams (From "The Greatest Showman" Soundtrack)')
        == "A Million Dreams"
    )
    assert (
        LyricsNormalizer.clean_title("Ghostbusters (Original Motion Picture Soundtrack)")
        == "Ghostbusters"
    )
    assert LyricsNormalizer.clean_title("Into the Unknown [OST]") == "Into the Unknown"
    assert LyricsNormalizer.clean_title("Barbie World (From Barbie The Album)") == "Barbie World"
    assert LyricsNormalizer.clean_title('Sing (From "Sing 2")') == "Sing"
    assert LyricsNormalizer.clean_title("Hero (Official Soundtrack)") == "Hero"
    assert LyricsNormalizer.clean_title("Theme Song - OST") == "Theme Song"
    assert (
        LyricsNormalizer.clean_title("Main Titles - Original Motion Picture Soundtrack")
        == "Main Titles"
    )


def test_lyrics_normalizer_delimiter_remaster_and_version_tags():
    """LyricsNormalizer strips unbracketed delimiter version and remaster tags."""
    assert LyricsNormalizer.clean_title("Hotel California - 2011 Remaster") == "Hotel California"
    assert LyricsNormalizer.clean_title("Song Name - 2020 Remastered") == "Song Name"
    assert (
        LyricsNormalizer.clean_title("Bohemian Rhapsody - Live at Wembley '86")
        == "Bohemian Rhapsody"
    )
    assert LyricsNormalizer.clean_title("Track Title - Live") == "Track Title"
    assert LyricsNormalizer.clean_title("Stayin Alive - Radio Edit") == "Stayin Alive"
    assert LyricsNormalizer.clean_title("Album Cut - Deluxe Edition") == "Album Cut"
    assert LyricsNormalizer.clean_title("Acoustic Song - Acoustic Version") == "Acoustic Song"
    assert LyricsNormalizer.clean_title("Single Cut - Single Version") == "Single Cut"


def test_lyrics_normalizer_extract_primary_artist():
    """LyricsNormalizer.extract_primary_artist parses collaboration conjunctions correctly."""
    assert LyricsNormalizer.extract_primary_artist("Queen & David Bowie") == "Queen"
    assert LyricsNormalizer.extract_primary_artist("David Guetta feat. Sia") == "David Guetta"
    assert LyricsNormalizer.extract_primary_artist("Calvin Harris ft. Rihanna") == "Calvin Harris"
    assert LyricsNormalizer.extract_primary_artist("Marshmello x Khalid") == "Marshmello"
    assert LyricsNormalizer.extract_primary_artist("Lady Gaga, Bradley Cooper") == "Lady Gaga"
    assert LyricsNormalizer.extract_primary_artist("Artist A vs. Artist B") == "Artist A"
    assert LyricsNormalizer.extract_primary_artist("Artist A / Artist B") == "Artist A"
    assert LyricsNormalizer.extract_primary_artist("The xx") == "The xx"
    assert LyricsNormalizer.extract_primary_artist("Lil Nas X feat. Billy Ray Cyrus") == "Lil Nas X"
    assert LyricsNormalizer.extract_primary_artist("") == "Unknown Artist"
    assert LyricsNormalizer.extract_primary_artist(None) == "Unknown Artist"


def test_lyrics_normalizer_extract_base_title():
    """LyricsNormalizer.extract_base_title strips subtitle clauses and delimiters."""
    assert LyricsNormalizer.extract_base_title("Star Wars - Main Theme") == "Star Wars"
    assert (
        LyricsNormalizer.extract_base_title("Mission: Impossible - Fallout")
        == "Mission: Impossible"
    )
    assert LyricsNormalizer.extract_base_title("Bohemian Rhapsody") == "Bohemian Rhapsody"
    assert LyricsNormalizer.extract_base_title("Under Pressure (2011 Remaster)") == "Under Pressure"
    assert (
        LyricsNormalizer.extract_base_title('A Million Dreams (From "The Greatest Showman")')
        == "A Million Dreams"
    )
    assert LyricsNormalizer.extract_base_title("Track : Subtitle Clause") == "Track"
    assert LyricsNormalizer.extract_base_title("") == ""
    assert LyricsNormalizer.extract_base_title(None) == ""


def test_lyrics_normalizer_swapped_canonical_splits():
    """extract_canonical handles inverted Title - Artist and Artist - Title correctly."""
    # When title contains Title - Artist and artist matches second part
    t1, a1 = LyricsNormalizer.extract_canonical("Bohemian Rhapsody - Queen", "Queen")
    assert t1 == "Bohemian Rhapsody"
    assert a1 == "Queen"

    # When title contains Artist - Title and artist is unknown
    t2, a2 = LyricsNormalizer.extract_canonical("Queen - Bohemian Rhapsody", "Unknown Artist")
    assert t2 == "Bohemian Rhapsody"
    assert a2 == "Queen"


def test_generate_query_ladder_order_and_filtering():
    """generate_query_ladder constructs all 7 sequential fallback stages properly."""
    ladder = LyricsService.generate_query_ladder(
        "Star Wars - Main Theme - From The Album",
        "John Williams & London Symphony Orchestra",
        duration=320.0,
    )
    # Must produce sequential stages
    stages = [s["stage"] for s in ladder]
    assert stages == [1, 2, 3, 4, 5, 6, 7]

    # Verify stage types and endpoints
    assert ladder[0]["type"] == "get"
    assert ladder[0]["params"]["duration"] == 320
    assert ladder[1]["type"] == "get"
    assert "duration" not in ladder[1]["params"]

    # Verify search queries
    assert (
        ladder[2]["params"]["q"]
        == "Star Wars - Main Theme John Williams & London Symphony Orchestra"
    )
    assert ladder[3]["params"]["q"] == "Star Wars - Main Theme John Williams"
    assert ladder[4]["params"]["q"] == "Star Wars John Williams"
    assert (
        ladder[5]["params"]["q"]
        == "John Williams & London Symphony Orchestra Star Wars - Main Theme"
    )
    assert ladder[6]["params"]["q"] == "Star Wars"

    # When duration is omitted, Stage 1 with duration should not appear
    ladder_no_dur = LyricsService.generate_query_ladder("Yellow", "Coldplay", duration=None)
    assert all("duration" not in s["params"] for s in ladder_no_dur if s["type"] == "get")


def test_candidate_ranking_line_count_completeness_and_penalties():
    """Candidate ranking awards line count points and penalizes stubs with <6 lines on long songs."""
    # Complete 30-line plain text candidate
    plain_30 = "\n".join([f"Line {i} of the complete lyrics" for i in range(30)])
    cand_complete_plain = {
        "id": "complete_plain",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 200,
        "plainLyrics": plain_30,
        "syncedLyrics": "",
    }
    # 2-line synced stub candidate
    cand_synced_stub = {
        "id": "synced_stub",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 200,
        "plainLyrics": "Line 1\nLine 2",
        "syncedLyrics": "[00:01.00] Line 1\n[00:05.00] Line 2",
    }
    # Complete plain lyrics must defeat 2-line synced stub
    winner = LyricsService.rank_candidates(
        [cand_synced_stub, cand_complete_plain],
        target_title="Song",
        target_artist="Artist",
        target_duration=200.0,
    )
    assert winner["id"] == "complete_plain"


def test_candidate_ranking_truncated_snippet_penalty():
    """Candidate ranking penalizes synced candidates whose timestamp span cuts off before 0.5 * duration."""
    # Candidate lasting only 20s on a 240s song (latest ts < 120s)
    truncated_cand = {
        "id": "truncated",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 240,
        "syncedLyrics": "\n".join(
            [f"[00:{i:02d}.00] Line {i}" for i in range(1, 10)]
        ),  # max ts = 9.0s
    }
    # Full candidate with 10 lines spanning up to 200s on a 240s song
    full_cand = {
        "id": "full",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 240,
        "syncedLyrics": "\n".join(
            [f"[{i * 20 // 60:02d}:{i * 20 % 60:02d}.00] Line {i}" for i in range(1, 11)]
        ),  # max ts = 200s (03:20)
    }
    score_trunc = LyricsService.score_candidate(truncated_cand, "Song", "Artist", 240.0)
    score_full = LyricsService.score_candidate(full_cand, "Song", "Artist", 240.0)
    assert score_full > score_trunc + 60.0  # At least 60 points higher due to truncated penalty


def test_candidate_ranking_escalated_duration_penalty():
    """Duration mismatch differences > 30s incur escalating penalties preventing live cuts from winning."""
    studio_cut = {
        "id": "studio",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 210,
        "syncedLyrics": "\n".join([f"[{i:02d}:00.00] Line {i}" for i in range(1, 4)]),
    }
    live_cut_60s_off = {
        "id": "live",
        "trackName": "Song",
        "artistName": "Artist",
        "duration": 280,  # 70s mismatch
        "syncedLyrics": "\n".join([f"[{i:02d}:00.00] Line {i}" for i in range(1, 4)]),
    }
    winner = LyricsService.rank_candidates(
        [live_cut_60s_off, studio_cut],
        target_title="Song",
        target_artist="Artist",
        target_duration=210.0,
    )
    assert winner["id"] == "studio"


def test_candidate_ranking_token_set_and_swapped_similarity():
    """Candidate ranking handles reordered tokens and swapped metadata."""
    cand_reordered = {
        "id": "reordered",
        "trackName": "Imagine Dragons - Radioactive",
        "artistName": "Imagine Dragons",
        "duration": 180,
        "syncedLyrics": "\n".join([f"[{i:02d}:00.00] Line {i}" for i in range(1, 4)]),
    }
    cand_irrelevant = {
        "id": "irrelevant",
        "trackName": "Completely Different Song",
        "artistName": "Someone Else",
        "duration": 180,
        "syncedLyrics": "\n".join([f"[{i:02d}:00.00] Line {i}" for i in range(1, 4)]),
    }
    winner = LyricsService.rank_candidates(
        [cand_irrelevant, cand_reordered],
        target_title="Radioactive",
        target_artist="Imagine Dragons",
        target_duration=180.0,
    )
    assert winner["id"] == "reordered"

    # Swapped metadata recovery: target has artist in title and title in artist
    cand_standard = {
        "id": "canonical_queen",
        "trackName": "Bohemian Rhapsody",
        "artistName": "Queen",
        "duration": 354,
        "syncedLyrics": "\n".join([f"[{i:02d}:00.00] Line {i}" for i in range(1, 6)]),
    }
    swapped_winner = LyricsService.rank_candidates(
        [cand_irrelevant, cand_standard],
        target_title="Queen",
        target_artist="Bohemian Rhapsody",
        target_duration=354.0,
    )
    assert swapped_winner["id"] == "canonical_queen"


def test_module_level_interface_contracts():
    """Module-level functions match the PROJECT.md interface contract."""
    from backend.services.lyrics import (
        extract_base_title,
        extract_canonical,
        extract_primary_artist,
        generate_query_ladder,
    )

    t, a = extract_canonical("Queen - Bohemian Rhapsody", "Unknown")
    assert t == "Bohemian Rhapsody"
    assert a == "Queen"

    primary = extract_primary_artist("David Guetta feat. Sia")
    assert primary == "David Guetta"

    base = extract_base_title("Star Wars - Main Theme")
    assert base == "Star Wars"

    ladder = generate_query_ladder("Song", "Artist", duration=200.0)
    assert len(ladder) >= 2
    assert ladder[0]["type"] == "get"


def test_lyrics_normalizer_nested_brackets_and_smart_quotes():
    """Verify clean_title resolves nested brackets, dangling orphaned brackets, and unicode smart quotes."""
    # Nested brackets stripping
    assert LyricsNormalizer.clean_title("Numb [Official Video (HD)]") == "Numb"
    assert (
        LyricsNormalizer.clean_title("Bohemian Rhapsody ((Official Video))") == "Bohemian Rhapsody"
    )
    assert LyricsNormalizer.clean_title("Title [Remastered (2020)]") == "Title"
    assert LyricsNormalizer.clean_title("Track (Official Video [HD])") == "Track"

    # Unicode smart quotes
    assert LyricsNormalizer.clean_title("“Hello”") == "Hello"
    assert LyricsNormalizer.clean_title("‘Yesterday’") == "Yesterday"
    assert LyricsNormalizer.clean_title("«Track»") == "Track"

    # Residual unbalanced edge brackets
    assert LyricsNormalizer.clean_title("Song )") == "Song"
    assert LyricsNormalizer.clean_title("Song ]") == "Song"
    assert LyricsNormalizer.clean_title("Song }") == "Song"
    assert LyricsNormalizer.clean_title("( Song") == "Song"

    # Balanced non-noise brackets preserved
    assert LyricsNormalizer.clean_title("Track (Part 1)") == "Track (Part 1)"
    assert (
        LyricsNormalizer.clean_title("(I Can't Get No) Satisfaction")
        == "(I Can't Get No) Satisfaction"
    )


def test_generate_query_ladder_safe_duration_anomalies():
    """Verify generate_query_ladder safely handles non-finite or non-positive durations."""
    # Infinite duration
    ladder_inf = LyricsService.generate_query_ladder("Track", "Artist", float("inf"))
    assert 1 not in [s["stage"] for s in ladder_inf]
    assert 2 in [s["stage"] for s in ladder_inf]

    # NaN duration
    ladder_nan = LyricsService.generate_query_ladder("Track", "Artist", float("nan"))
    assert 1 not in [s["stage"] for s in ladder_nan]
    assert 2 in [s["stage"] for s in ladder_nan]

    # None duration
    ladder_none = LyricsService.generate_query_ladder("Track", "Artist", None)
    assert 1 not in [s["stage"] for s in ladder_none]
    assert 2 in [s["stage"] for s in ladder_none]

    # Zero & negative duration
    assert 1 not in [
        s["stage"] for s in LyricsService.generate_query_ladder("Track", "Artist", 0.0)
    ]
    assert 1 not in [
        s["stage"] for s in LyricsService.generate_query_ladder("Track", "Artist", -10.0)
    ]

    # Valid duration
    ladder_valid = LyricsService.generate_query_ladder("Track", "Artist", 210.6)
    assert ladder_valid[0]["stage"] == 1
    assert ladder_valid[0]["duration"] == 210


def test_candidate_ranking_spread_stubs_vs_complete_plain():
    """Candidate ranking guarantees complete plain lyrics defeat 1-line to 5-line synced stubs."""
    target_dur = 210.0
    full_plain = "\n".join([f"Verse line {i} of full song text" for i in range(40)])
    cand_plain = {
        "id": "complete_plain",
        "trackName": "Song Title",
        "artistName": "Artist Name",
        "duration": target_dur,
        "plainLyrics": full_plain,
        "syncedLyrics": "",
    }
    cand_2line = {
        "id": "stub_2line",
        "trackName": "Song Title",
        "artistName": "Artist Name",
        "duration": target_dur,
        "syncedLyrics": "[00:05.00] Hello\n[03:20.00] Goodbye",
        "plainLyrics": "Hello\nGoodbye",
    }
    winner = LyricsService.rank_candidates(
        [cand_2line, cand_plain], "Song Title", "Artist Name", target_dur
    )
    assert winner["id"] == "complete_plain"


def test_candidate_ranking_truncated_snippets_vs_complete_plain():
    """Candidate ranking guarantees complete plain lyrics defeat preview snippets cutting off < 50% of track."""
    target_dur = 240.0
    full_plain = "\n".join([f"Verse line {i} of full song text" for i in range(40)])
    cand_plain = {
        "id": "complete_plain",
        "trackName": "Song Title",
        "artistName": "Artist Name",
        "duration": target_dur,
        "plainLyrics": full_plain,
        "syncedLyrics": "",
    }
    cand_snippet = {
        "id": "snippet_6line",
        "trackName": "Song Title",
        "artistName": "Artist Name",
        "duration": target_dur,
        "syncedLyrics": "\n".join([f"[00:{i * 5:02d}.00] Preview line {i}" for i in range(1, 7)]),
        "plainLyrics": "\n".join([f"Preview line {i}" for i in range(1, 7)]),
    }
    winner = LyricsService.rank_candidates(
        [cand_snippet, cand_plain], "Song Title", "Artist Name", target_dur
    )
    assert winner["id"] == "complete_plain"


def test_candidate_ranking_unrelated_synced_candidate_gating():
    """Candidate ranking gates synced bonus so an unrelated song cannot beat an exact match plain lyrics."""
    cand_correct_plain = {
        "id": "correct_plain",
        "trackName": "Bohemian Rhapsody",
        "artistName": "Queen",
        "duration": 354,
        "plainLyrics": "\n".join([f"Line {i} of bohemian rhapsody" for i in range(40)]),
        "syncedLyrics": "",
    }
    cand_wrong_synced = {
        "id": "wrong_synced",
        "trackName": "Hotel California",
        "artistName": "Eagles",
        "duration": 354,
        "syncedLyrics": "\n".join(
            [f"[{i * 8 // 60:02d}:{i * 8 % 60:02d}.00] Line {i}" for i in range(40)]
        ),
        "plainLyrics": "\n".join([f"Line {i}" for i in range(40)]),
    }
    winner = LyricsService.rank_candidates(
        [cand_wrong_synced, cand_correct_plain], "Bohemian Rhapsody", "Queen", target_duration=354.0
    )
    assert winner["id"] == "correct_plain"


def test_candidate_ranking_target_duration_none_fallback():
    """Candidate ranking evaluates completeness using candidate duration when target_duration is None."""
    cand_plain = {
        "id": "complete_plain",
        "trackName": "Song Title",
        "artistName": "Artist Name",
        "duration": 210,
        "plainLyrics": "\n".join([f"Verse line {i} of full song text" for i in range(40)]),
        "syncedLyrics": "",
    }
    cand_stub = {
        "id": "stub_1line",
        "trackName": "Song Title",
        "artistName": "Artist Name",
        "duration": 210,
        "syncedLyrics": "[00:01.00] (Instrumental)",
        "plainLyrics": "(Instrumental)",
    }
    winner = LyricsService.rank_candidates(
        [cand_stub, cand_plain], "Song Title", "Artist Name", target_duration=None
    )
    assert winner["id"] == "complete_plain"


def test_syncedlyrics_timeout_does_not_wait_for_a_slow_search(monkeypatch):
    import time

    import backend.services.lyrics as lyrics_mod

    release = __import__("threading").Event()
    monkeypatch.setattr(lyrics_mod, "SYNCEDLYRICS_TIMEOUT_SEC", 0.2)
    monkeypatch.setattr(LyricsService, "_fetch_from_lrclib", lambda *args, **kwargs: None)
    monkeypatch.setattr(lyrics_mod.syncedlyrics, "search", lambda query: release.wait(5))
    started = time.monotonic()
    try:
        res = LyricsService().fetch_lyrics("Slow Song", "Slow Artist")
    finally:
        release.set()
    assert time.monotonic() - started < 2
    assert res["source"] == "none"


def test_syncedlyrics_untimed_results_are_plain_lyrics(monkeypatch):
    import backend.services.lyrics as lyrics_mod

    monkeypatch.setattr(LyricsService, "_fetch_from_lrclib", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        lyrics_mod.syncedlyrics, "search", lambda query: "[Chorus]\nFirst line\nSecond line\n"
    )
    res = LyricsService().fetch_lyrics("Song", "Artist")
    assert (res["source"], res["synced"], res["lrc"]) == ("syncedlyrics", False, "")
    assert [line["text"] for line in res["lines"]] == ["First line", "Second line"]
    assert all(line["start_time"] == 0.0 for line in res["lines"])

    monkeypatch.setattr(
        lyrics_mod.syncedlyrics, "search", lambda query: "[00:01.00] One\n[00:03.00] Two\n"
    )
    res = LyricsService().fetch_lyrics("Song", "Artist")
    assert (res["source"], res["synced"]) == ("syncedlyrics", True)
    assert [line["start_time"] for line in res["lines"]] == [1.0, 3.0]
