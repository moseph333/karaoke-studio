"""Adversarial stress tests for ASS subtitle countdown and multi-singer generation (Milestone 3 Challenge)."""

import re
from typing import Any

import pytest

from backend.services.ass_generator import (
    format_ass_time,
    generate_ass_content,
    generate_ass_subtitles,
)

ASS_TIMESTAMP_REGEX = re.compile(r"^\d+:[0-5]\d:[0-5]\d\.\d{2}$")
KF_TAG_REGEX = re.compile(r"\\kf(\d+)")


def parse_ass_styles_and_events(ass_text: str):
    """Helper to extract defined styles and dialogue events from ASS document."""
    lines = ass_text.splitlines()
    styles = set()
    events = []

    in_styles = False
    in_events = False

    for line in lines:
        stripped = line.strip()
        if stripped == "[V4+ Styles]":
            in_styles = True
            in_events = False
            continue
        elif stripped == "[Events]":
            in_styles = False
            in_events = True
            continue
        elif stripped.startswith("["):
            in_styles = False
            in_events = False
            continue

        if in_styles and stripped.startswith("Style:"):
            parts = stripped[len("Style:") :].split(",")
            if parts:
                styles.add(parts[0].strip())
        elif in_events and stripped.startswith("Dialogue:"):
            parts = stripped[len("Dialogue:") :].split(",", 9)
            if len(parts) >= 10:
                events.append(
                    {
                        "layer": parts[0].strip(),
                        "start": parts[1].strip(),
                        "end": parts[2].strip(),
                        "style": parts[3].strip(),
                        "name": parts[4].strip(),
                        "marginL": parts[5].strip(),
                        "marginR": parts[6].strip(),
                        "marginV": parts[7].strip(),
                        "effect": parts[8].strip(),
                        "text": parts[9],
                    }
                )

    return styles, events


class TestAdversarialAssCountdownNoGaps:
    """Stress tests subtitle generation on songs with 0 qualifying gaps (all < 4.0s)."""

    def test_empty_lyric_lines_array(self):
        ass = generate_ass_content([])
        assert "[Script Info]" in ass
        assert "[V4+ Styles]" in ass
        assert "[Events]" in ass
        styles, events = parse_ass_styles_and_events(ass)
        assert len(events) == 0
        assert "Countdown" in styles

    def test_single_line_at_zero_no_intro_gap(self):
        lines = [
            {
                "id": 1,
                "text": "Singing starts right at zero",
                "start_time": 0.0,
                "end_time": 3.5,
                "words": [{"word": "Singing", "start_time": 0.0, "end_time": 1.0}],
            }
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        _, events = parse_ass_styles_and_events(ass)
        # Should contain 1 dialogue event for the line, 0 for countdown
        countdown_events = [e for e in events if e["style"] == "Countdown"]
        assert len(countdown_events) == 0
        assert len(events) == 1
        assert events[0]["style"] == "KaraokeLine1"

    def test_song_with_only_sub_threshold_gaps(self):
        # Intro: 3.99s, Inter-line: 3.99s
        lines = [
            {
                "id": 1,
                "text": "First line after 3.99s intro",
                "start_time": 3.99,
                "end_time": 7.0,
                "words": [{"word": "First", "start_time": 3.99, "end_time": 5.0}],
            },
            {
                "id": 2,
                "text": "Second line after 3.99s gap",
                "start_time": 10.99,  # 10.99 - 7.00 = 3.99s
                "end_time": 14.0,
                "words": [{"word": "Second", "start_time": 10.99, "end_time": 12.0}],
            },
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        _, events = parse_ass_styles_and_events(ass)
        countdown_events = [e for e in events if e["style"] == "Countdown"]
        assert len(countdown_events) == 0
        assert len(events) == 2


class TestAdversarialAssCountdownPathologicalTimings:
    """Stress tests overlapping, negative, inverted, out-of-order, and corrupt inputs."""

    def test_overlapping_lines_negative_intervals(self):
        # Line 1 ends at 8.0, Line 2 starts at 4.0 (overlap of 4.0s, gap = -4.0s)
        lines = [
            {
                "id": 1,
                "text": "Line 1 long sustain",
                "start_time": 1.0,
                "end_time": 8.0,
                "words": [{"word": "Line", "start_time": 1.0, "end_time": 8.0}],
            },
            {
                "id": 2,
                "text": "Line 2 entering early",
                "start_time": 4.0,
                "end_time": 9.0,
                "words": [{"word": "Line2", "start_time": 4.0, "end_time": 9.0}],
            },
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        _, events = parse_ass_styles_and_events(ass)
        countdown_events = [e for e in events if e["style"] == "Countdown"]
        assert len(countdown_events) == 0

        # Both dialogue lines must be well-formed with valid timestamps
        for e in events:
            assert ASS_TIMESTAMP_REGEX.match(e["start"])
            assert ASS_TIMESTAMP_REGEX.match(e["end"])

    def test_inverted_line_timestamps(self):
        # Line end_time before start_time
        lines = [
            {
                "id": 1,
                "text": "Inverted line",
                "start_time": 10.0,
                "end_time": 5.0,
                "words": [],
            }
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        assert "[Events]" in ass
        _, events = parse_ass_styles_and_events(ass)
        for e in events:
            assert ASS_TIMESTAMP_REGEX.match(e["start"])
            assert ASS_TIMESTAMP_REGEX.match(e["end"])

    def test_non_finite_and_corrupted_data_types(self):
        # NaNs, Infinities, None values, non-dicts
        lines: list[Any] = [
            None,
            "not a dict",
            {"start_time": float("nan"), "end_time": 5.0, "text": "NaN line"},
            {"start_time": float("inf"), "end_time": float("inf"), "text": "Inf line"},
            {"start_time": -10.0, "end_time": -5.0, "text": "Negative line"},
            {
                "start_time": 6.0,
                "end_time": 9.0,
                "text": "Valid line",
                "words": [
                    {"word": "Valid", "start_time": float("nan"), "end_time": float("nan")},
                    {"word": "Clean", "start_time": 7.0, "end_time": 8.0},
                ],
            },
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        assert "[Events]" in ass
        _, events = parse_ass_styles_and_events(ass)
        # Must not raise exception, must produce valid timestamps
        for e in events:
            assert ASS_TIMESTAMP_REGEX.match(e["start"])
            assert ASS_TIMESTAMP_REGEX.match(e["end"])


class TestAdversarialAssCountdownExtremeDurations:
    """Stress tests extreme gaps: 300s (5min), 3600s (1 hour), 86400s (24 hours)."""

    @pytest.mark.parametrize(
        "gap_seconds, expected_h_format",
        [
            (300.0, "0:05:00.00"),  # 5 minutes
            (3600.0, "1:00:00.00"),  # 1 hour
            (86400.0, "24:00:00.00"),  # 24 hours
        ],
    )
    def test_extreme_gap_dialogue_event_timing(self, gap_seconds, expected_h_format):
        lines = [
            {
                "id": 1,
                "text": "Song intro starts after massive pause",
                "start_time": gap_seconds,
                "end_time": gap_seconds + 5.0,
                "words": [
                    {
                        "word": "Intro",
                        "start_time": gap_seconds,
                        "end_time": gap_seconds + 2.0,
                    }
                ],
            }
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        _, events = parse_ass_styles_and_events(ass)

        countdown_events = [e for e in events if e["style"] == "Countdown"]
        assert len(countdown_events) == 1
        cd_event = countdown_events[0]

        # Countdown end must match the line's start_time exactly
        assert cd_event["end"] == expected_h_format

        # Countdown start must be exactly 3.0 seconds prior
        expected_start = format_ass_time(gap_seconds - 3.0)
        assert cd_event["start"] == expected_start

        # Check timestamp format
        assert ASS_TIMESTAMP_REGEX.match(cd_event["start"])
        assert ASS_TIMESTAMP_REGEX.match(cd_event["end"])

        # Check \kf tags
        kf_matches = KF_TAG_REGEX.findall(cd_event["text"])
        assert kf_matches == ["100", "100", "100"]

    def test_exact_boundary_at_four_seconds(self):
        # 4.00s gap exactly
        lines = [
            {
                "id": 1,
                "text": "Intro at 4.00s",
                "start_time": 4.0,
                "end_time": 7.0,
                "words": [{"word": "Intro", "start_time": 4.0, "end_time": 5.0}],
            }
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        _, events = parse_ass_styles_and_events(ass)
        countdown_events = [e for e in events if e["style"] == "Countdown"]
        assert len(countdown_events) == 1
        assert countdown_events[0]["start"] == "0:00:01.00"
        assert countdown_events[0]["end"] == "0:00:04.00"


class TestAdversarialAssCountdownMultiSingerAndFlagsMatrix:
    """Stress tests combinations of include_countdown and multi-singer style references."""

    @pytest.mark.parametrize(
        "include_countdown_arg, style_config_flag, expected_countdown",
        [
            (True, None, True),
            (False, None, False),
            (True, {"include_countdown": True}, True),
            (True, {"include_countdown": False}, False),
            (True, {"enable_gap_countdown": True}, True),
            (True, {"enable_gap_countdown": False}, False),
            (False, {"include_countdown": True}, True),  # style_config takes precedence
        ],
    )
    def test_countdown_flag_resolution_matrix(
        self, include_countdown_arg, style_config_flag, expected_countdown
    ):
        lines = [
            {
                "id": 1,
                "text": "Intro line",
                "start_time": 6.0,
                "end_time": 9.0,
                "words": [{"word": "Intro", "start_time": 6.0, "end_time": 7.0}],
            }
        ]
        ass = generate_ass_content(
            lines,
            include_countdown=include_countdown_arg,
            style_config=style_config_flag,
        )
        _, events = parse_ass_styles_and_events(ass)
        countdown_events = [e for e in events if e["style"] == "Countdown"]

        if expected_countdown:
            assert len(countdown_events) == 1
        else:
            assert len(countdown_events) == 0

    @pytest.mark.parametrize(
        "singer_val, expected_color_tag_prefix",
        [
            ("singer1", ""),
            ("lead", ""),
            ("SINGER 1", ""),
            ("singer2", r"{\c&H00B300FF&}"),
            ("partner", r"{\c&H00B300FF&}"),
            ("singer 2", r"{\c&H00B300FF&}"),
            ("s2", r"{\c&H00B300FF&}"),
            ("both", r"{\c&H0050FA7B&}"),
            ("unison", r"{\c&H0050FA7B&}"),
            ("duet", r"{\c&H0050FA7B&}"),
            ("all", r"{\c&H0050FA7B&}"),
            ("unknown_singer", ""),
            ("", ""),
            (None, ""),
        ],
    )
    def test_multi_singer_countdown_dots_styling(self, singer_val, expected_color_tag_prefix):
        lines = [
            {
                "id": 1,
                "text": "Singer line after intro",
                "start_time": 8.0,
                "end_time": 11.0,
                "singer": singer_val,
                "words": [{"word": "Singer", "start_time": 8.0, "end_time": 9.0}],
            }
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        _, events = parse_ass_styles_and_events(ass)
        countdown_events = [e for e in events if e["style"] == "Countdown"]
        assert len(countdown_events) == 1
        cd_text = countdown_events[0]["text"]

        if expected_color_tag_prefix:
            assert cd_text.startswith(expected_color_tag_prefix)
        else:
            assert cd_text.startswith(r"{\kf100}")

    def test_every_dialogue_style_reference_is_defined_in_styles_section(self):
        """Verifies zero unreferenced styles across complex multi-singer song."""
        lines = [
            {"id": 1, "start_time": 6.0, "end_time": 9.0, "singer": "singer1", "text": "L1"},
            {"id": 2, "start_time": 15.0, "end_time": 18.0, "singer": "singer2", "text": "L2"},
            {"id": 3, "start_time": 25.0, "end_time": 28.0, "singer": "both", "text": "L3"},
            {"id": 4, "start_time": 30.0, "end_time": 33.0, "singer": "lead", "text": "L4"},
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        defined_styles, events = parse_ass_styles_and_events(ass)

        # Every event's style MUST be defined in defined_styles
        for e in events:
            assert e["style"] in defined_styles, (
                f"Style '{e['style']}' was referenced but not defined!"
            )

    def test_generate_ass_subtitles_disk_file_integrity(self, tmp_path):
        """Verifies generate_ass_subtitles writes valid UTF-8 and returns existing file path."""
        out_file = tmp_path / "test_countdown.ass"
        lines = [
            {
                "id": 1,
                "text": "Disk test",
                "start_time": 5.0,
                "end_time": 8.0,
                "singer": "singer2",
                "words": [{"word": "Disk", "start_time": 5.0, "end_time": 6.0}],
            }
        ]
        ret_path = generate_ass_subtitles(lines, output_ass_path=out_file, include_countdown=True)
        assert ret_path == str(out_file)
        assert out_file.exists()
        content = out_file.read_text(encoding="utf-8")
        assert "Style: Countdown," in content
        assert "Dialogue: 1,0:00:02.00,0:00:05.00,Countdown," in content
