"""Adversarial stress tests for ASS subtitle countdown and multi-singer generation (Milestone 3 Challenge)."""

import re
from typing import Any

import pytest

from backend.services.ass_draw import LookStyle, ass_color
from backend.services.ass_generator import (
    format_ass_time,
    generate_ass_content,
    generate_ass_subtitles,
    instrumental_gaps,
)
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass

ASS_TIMESTAMP_REGEX = re.compile(r"^\d+:[0-5]\d:[0-5]\d\.\d{2}$")
# What a count-in is drawn with: numerals in the default look, dots in the two-row look
COUNT_IN_LOOKS = ("marquee", "ktv")


def count_in(ass_text: str) -> list[AssEvent]:
    """The count-in's events (role ``countin:<line>``), first to last."""
    events = [e for e in ass_events(ass_text) if e.kind == "countin"]
    return sorted(events, key=lambda e: (e.start, e.end))


def cues(ass_text: str) -> list[AssEvent]:
    """Everything the countdown option draws: the count-in and the break marker."""
    return [e for e in ass_events(ass_text) if e.kind in ("countin", "break")]


def assert_timestamps_are_well_formed(ass_text: str) -> None:
    for event in parse_ass(ass_text)["events"]:
        assert ASS_TIMESTAMP_REGEX.match(event["Start"]), event
        assert ASS_TIMESTAMP_REGEX.match(event["End"]), event


class TestAdversarialAssCountdownNoGaps:
    """Stress tests subtitle generation on songs with 0 qualifying gaps (all < 4.0s)."""

    def test_empty_lyric_lines_array(self):
        ass = generate_ass_content([])
        assert "[Script Info]" in ass
        assert "[V4+ Styles]" in ass
        assert "[Events]" in ass
        assert ass_events(ass) == []

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
        # Should contain 1 dialogue event for the line, 0 for countdown
        assert cues(ass) == []
        assert [e.role for e in ass_events(ass)] == ["lyric:0"]

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
        assert cues(ass) == []
        assert {e.line for e in ass_events(ass) if e.kind == "lyric"} == {0, 1}


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
        assert cues(ass) == []

        # Both dialogue lines must be well-formed with valid timestamps
        assert {e.line for e in ass_events(ass) if e.kind == "lyric"} == {0, 1}
        assert_timestamps_are_well_formed(ass)

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
        assert [e for e in ass_events(ass) if e.kind == "lyric"]
        assert_timestamps_are_well_formed(ass)
        assert all(e.end >= e.start for e in ass_events(ass))

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
        # Must not raise exception, must produce valid timestamps
        assert_timestamps_are_well_formed(ass)
        # The entries that are not lines are skipped and keep their index
        assert {e.line for e in ass_events(ass) if e.kind == "lyric"} == {2, 3, 4, 5}


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
        # The break marker before it is an event a second, so the day-long gap is tried in
        # one look only
        for look_id in COUNT_IN_LOOKS if gap_seconds <= 3600 else COUNT_IN_LOOKS[:1]:
            ass = generate_ass_content(lines, theme_id=look_id, include_countdown=True)
            cue = count_in(ass)
            assert {e.role for e in cue} == {"countin:0"}
            stamps = [
                (event["Start"], event["End"])
                for event in parse_ass(ass)["events"]
                if event["Name"] == "countin:0"
            ]

            # Countdown end must match the line's start_time exactly
            assert max(e.end for e in cue) == gap_seconds
            assert expected_h_format in [end for _, end in stamps]

            # Countdown start must be exactly 3.0 seconds prior
            assert min(e.start for e in cue) == gap_seconds - 3.0
            assert format_ass_time(gap_seconds - 3.0) in [start for start, _ in stamps]

            # Check timestamp format
            assert all(ASS_TIMESTAMP_REGEX.match(stamp) for pair in stamps for stamp in pair)

            # One step a second: a numeral for each second, or three dots that go out in turn
            seconds = [gap_seconds - 3.0, gap_seconds - 2.0, gap_seconds - 1.0, gap_seconds]
            if look_id == "ktv":
                assert [(e.start, e.end) for e in cue] == [
                    (seconds[0], seconds[1]),
                    (seconds[0], seconds[2]),
                    (seconds[0], seconds[3]),
                ]
                assert all("\\p1" in e.text for e in cue)
            else:
                assert [(e.start, e.end, e.plain) for e in cue] == [
                    (seconds[0], seconds[1], "3"),
                    (seconds[1], seconds[2], "2"),
                    (seconds[2], seconds[3], "1"),
                ]

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
        cue = count_in(ass)
        assert {e.role for e in cue} == {"countin:0"}
        assert (cue[0].start, cue[-1].end) == (1.0, 4.0)
        assert [e.plain for e in cue] == ["3", "2", "1"]

    def test_just_under_four_seconds_gets_no_countdown(self):
        lines = [{"id": 1, "text": "Intro at 3.99s", "start_time": 3.99, "end_time": 7.0}]
        assert cues(generate_ass_content(lines, include_countdown=True)) == []


class TestInstrumentalGapRule:
    """instrumental_gaps is the countdown's rule, shared with the YouTube kit's chapters."""

    def test_a_gap_of_exactly_4_s_counts_and_3_99_s_does_not(self):
        lines = [
            {"start_time": 4.0, "end_time": 6.0},
            {"start_time": 9.99, "end_time": 11.0},
            {"start_time": 15.0, "end_time": 16.0},
        ]

        assert instrumental_gaps(lines) == [0, 2]

    def test_a_gap_is_measured_from_the_latest_end_so_far(self):
        # The 0-20 line hides the 5-6 line, so the line at 22 is only 2 s after the vocals.
        lines = [
            {"start_time": 0.0, "end_time": 20.0},
            {"start_time": 5.0, "end_time": 6.0},
            {"start_time": 22.0, "end_time": 25.0},
        ]

        assert instrumental_gaps(lines) == []

    def test_entries_that_are_not_lines_keep_their_index(self):
        assert instrumental_gaps([None, {"start_time": 5.0, "end_time": 7.0}]) == [1]
        assert instrumental_gaps("not a list") == []
        assert instrumental_gaps(None) == []

    def test_the_countdown_follows_the_rule(self):
        lines: list[Any] = [
            "not a line",
            {"text": "Intro", "start_time": 4.0, "end_time": 6.0},
            {"text": "Close", "start_time": 9.99, "end_time": 11.0},
            {"text": "Gap", "start_time": 15.0, "end_time": 16.0},
        ]

        cue = count_in(generate_ass_content(lines, include_countdown=True))

        countdown_ends = {e.line: e.end for e in cue}
        assert countdown_ends == {1: 4.0, 3: 15.0}
        assert instrumental_gaps(lines) == list(countdown_ends)


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
        if expected_countdown:
            assert {e.role for e in count_in(ass)} == {"countin:0"}
        else:
            assert cues(ass) == []
        assert [e for e in ass_events(ass) if e.kind == "lyric"]

    @pytest.mark.parametrize(
        "singer_val, expected_part",
        [
            ("singer1", "singer1"),
            ("lead", "singer1"),
            ("SINGER 1", "singer1"),
            ("singer2", "singer2"),
            ("partner", "singer2"),
            ("singer 2", "singer2"),
            ("s2", "singer2"),
            ("both", "both"),
            ("unison", "both"),
            ("duet", "both"),
            ("all", "both"),
            ("unknown_singer", "singer1"),
            ("", "singer1"),
            (None, "singer1"),
        ],
    )
    def test_multi_singer_countdown_dots_styling(self, singer_val, expected_part):
        """The count-in is in the look's cue colour, or the colour of the part it counts in."""
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
        for look_id in COUNT_IN_LOOKS:
            look = LookStyle.of(look_id)
            expected = {
                "singer1": look.color("cue"),
                "singer2": look.color("singer2"),
                "both": look.color("both"),
            }
            assert len(set(expected.values())) == 3
            cue = count_in(generate_ass_content(lines, theme_id=look_id, include_countdown=True))
            assert len(cue) == 3
            for event in cue:
                assert f"\\1c{ass_color(expected[expected_part])}" in event.tags, look_id

    def test_every_dialogue_style_reference_is_defined_in_styles_section(self):
        """Verifies zero unreferenced styles across complex multi-singer song."""
        lines = [
            {"id": 1, "start_time": 6.0, "end_time": 9.0, "singer": "singer1", "text": "L1"},
            {"id": 2, "start_time": 15.0, "end_time": 18.0, "singer": "singer2", "text": "L2"},
            {"id": 3, "start_time": 25.0, "end_time": 28.0, "singer": "both", "text": "L3"},
            {"id": 4, "start_time": 30.0, "end_time": 33.0, "singer": "lead", "text": "L4"},
        ]
        ass = generate_ass_content(lines, include_countdown=True)
        defined_styles = set(parse_ass(ass)["styles"])
        events = ass_events(ass)
        assert {e.line for e in events if e.kind == "countin"} == {0, 1, 2}
        assert {e.line for e in events if e.kind == "part"} == {0, 1, 2, 3}

        # Every event's style MUST be defined in defined_styles
        for e in events:
            assert e.style in defined_styles, f"Style '{e.style}' was referenced but not defined!"

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
        assert content == generate_ass_content(lines, include_countdown=True)
        cue = count_in(content)
        assert {(e.layer, e.role) for e in cue} == {(1, "countin:0")}
        assert (cue[0].start, cue[-1].end) == (2.0, 5.0)
        assert "Dialogue: 1,0:00:02.00,0:00:03.00," in content
