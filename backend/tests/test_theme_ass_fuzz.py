"""Adversarial stress and fuzz tests for backend/services/ass_generator.py.

Tests extreme boundary cases, malformed payloads, injection attempts,
negative/NaN/infinite timestamps, very long words, missing fields,
and multi-theme combinations across word and line sync modes.
"""

import math

import pytest

from backend.services.ass_generator import (
    VISUAL_THEMES,
    css_to_ass_color,
    escape_ass_text,
    format_ass_time,
    generate_ass_content,
    safe_time,
)


class TestAssGeneratorFuzzing:
    """Adversarial and fuzz tests for generate_ass_content."""

    def test_empty_and_none_lines(self):
        """Fuzz testing with empty lists, None, and non-list lines."""
        # Empty lines list
        res_empty = generate_ass_content(lines=[])
        assert "[Script Info]" in res_empty
        assert "[V4+ Styles]" in res_empty
        assert "[Events]" in res_empty
        assert "Style: KaraokeLine1" in res_empty

        # None lines
        res_none = generate_ass_content(lines=None)  # type: ignore
        assert "[Script Info]" in res_none

        # Lines with None, primitives, and empty dicts
        corrupt_lines = [None, 42, "not a dict", [], {}, {"text": ""}]
        res_corrupt = generate_ass_content(lines=corrupt_lines)  # type: ignore
        assert "[Script Info]" in res_corrupt
        assert "[Events]" in res_corrupt

    def test_missing_line_fields(self):
        """Fuzz testing lines with missing start_time, end_time, words, text, singer."""
        sparse_lines = [
            {},  # completely empty line
            {"text": "Only text"},
            {"start_time": 5.0},
            {"end_time": 8.0},
            {"words": []},
            {"words": [{}, {"word": "hello"}, {"start_time": 1.0}]},
            {"singer": "unknown_singer_role"},
            {"singer": None},
        ]
        res = generate_ass_content(lines=sparse_lines, theme_id="punk_diy")
        assert "[Events]" in res
        dialogue_lines = [line for line in res.splitlines() if line.startswith("Dialogue:")]
        # Ensure all sparse lines generated dialogue without throwing exceptions
        assert len(dialogue_lines) >= len(sparse_lines)

    def test_negative_and_inverted_timestamps(self):
        """Fuzz testing negative, inverted, and zero duration timestamps."""
        weird_lines = [
            {
                "text": "Negative times",
                "start_time": -10.5,
                "end_time": -2.0,
                "words": [
                    {"word": "Negative", "start_time": -10.5, "end_time": -6.0},
                    {"word": "times", "start_time": -6.0, "end_time": -2.0},
                ],
            },
            {
                "text": "Inverted start and end",
                "start_time": 40.0,
                "end_time": 10.0,  # end < start
                "words": [
                    {"word": "Inverted", "start_time": 30.0, "end_time": 15.0},
                ],
            },
            {
                "text": "Zero duration",
                "start_time": 25.0,
                "end_time": 25.0,
                "words": [
                    {"word": "Zero", "start_time": 25.0, "end_time": 25.0},
                ],
            },
        ]
        res = generate_ass_content(
            lines=weird_lines, theme_id="clean_paper", include_countdown=False
        )
        assert "[Events]" in res
        dialogue_lines = [line for line in res.splitlines() if line.startswith("Dialogue:")]
        assert len(dialogue_lines) == 3

        # Verify timestamps in Dialogue events are formatted as valid non-negative H:MM:SS.cs
        for d in dialogue_lines:
            parts = d.split(",")
            start_str, end_str = parts[1], parts[2]
            assert "-" not in start_str
            assert "-" not in end_str

    def test_nan_and_infinite_timestamps(self):
        """Fuzz testing float('nan'), float('inf'), float('-inf') in line and word timestamps."""
        nan_lines = [
            {
                "text": "Float test line",
                "start_time": float("nan"),
                "end_time": float("inf"),
                "words": [
                    {"word": "Float", "start_time": float("nan"), "end_time": float("-inf")},
                    {"word": "test", "start_time": float("inf"), "end_time": float("nan")},
                ],
            },
            {
                "text": "NegInf line",
                "start_time": float("-inf"),
                "end_time": float("nan"),
            },
        ]
        res = generate_ass_content(lines=nan_lines, theme_id="crt_ktv")
        assert "[Events]" in res
        dialogue_lines = [line for line in res.splitlines() if line.startswith("Dialogue:")]
        assert len(dialogue_lines) == 2
        for d in dialogue_lines:
            parts = d.split(",")
            start_str, end_str = parts[1], parts[2]
            assert "nan" not in start_str.lower()
            assert "inf" not in start_str.lower()
            assert "nan" not in end_str.lower()
            assert "inf" not in end_str.lower()

    def test_very_long_words_and_large_lyrics(self):
        """Fuzz testing with 10,000+ character words, repeated unicode, and large line counts."""
        giant_word = "A" * 15000
        unicode_explosion = "🔥🎸🎤🤘⚡" * 1000
        line_with_giant_word = {
            "text": f"{giant_word} {unicode_explosion}",
            "start_time": 10.0,
            "end_time": 25.0,
            "words": [
                {"word": giant_word, "start_time": 10.0, "end_time": 18.0},
                {"word": unicode_explosion, "start_time": 18.0, "end_time": 25.0},
            ],
        }
        res = generate_ass_content(lines=[line_with_giant_word], theme_id="punk_diy")
        assert "[Events]" in res
        assert "Style: KaraokeLine1" in res
        # Ensure giant text was escaped and included without memory or buffer overflow
        assert len(res) > 20000

    def test_ass_override_injection_escaping(self):
        """Verifies that malicious or formatting ASS tags in lyric text are safely escaped."""
        injection_text = (
            "{\\b1\\i1}Malicious{\\b0\\i0} text with \\N newline and \\h space and {\\fad(500,500)}"
        )
        line = {
            "text": injection_text,
            "start_time": 5.0,
            "end_time": 10.0,
            "words": [
                {"word": "{\\b1}", "start_time": 5.0, "end_time": 6.0},
                {"word": "injection", "start_time": 6.0, "end_time": 8.0},
                {"word": "{\\b0}", "start_time": 8.0, "end_time": 10.0},
            ],
        }

        # Word sync mode
        res_word = generate_ass_content(
            lines=[line], theme_id="punk_diy", sync_mode="word", include_countdown=False
        )
        dialogue_word = next(
            line_str for line_str in res_word.splitlines() if line_str.startswith("Dialogue:")
        )
        # Verify curly braces and backslashes in lyrics are escaped as \{ and \}
        assert "\\{" in dialogue_word
        assert "\\}" in dialogue_word

        # Line sync mode
        res_line = generate_ass_content(
            lines=[line], theme_id="tape_70s", sync_mode="line", include_countdown=False
        )
        dialogue_line = next(
            line_str for line_str in res_line.splitlines() if line_str.startswith("Dialogue:")
        )
        assert "\\{" in dialogue_line
        assert "\\}" in dialogue_line

    def test_malformed_and_boundary_colors(self):
        """Fuzz testing malformed hex strings, invalid color names, and boundary color formats."""
        bad_colors = [
            "not_a_color",
            "#",
            "#1",
            "#12",
            "#1234",
            "#12345",
            "#1234567",
            "#ZZZZZZ",
            "&HZZZZZZZZ",
            "   #ff00ff   ",
            "#f0a",  # 3-digit hex
            None,
            "",
            "123456",
            "#000",
            "#ffffff",
        ]
        for color in bad_colors:
            # css_to_ass_color must never raise an unhandled exception
            ass_color = css_to_ass_color(color)
            assert isinstance(ass_color, str)
            assert ass_color.startswith("&H")

            # generate_ass_content must handle malformed color overrides gracefully
            res = generate_ass_content(
                lines=[{"text": "test", "start_time": 1.0, "end_time": 2.0}],
                theme_id="punk_diy",
                primary_color=color,
                secondary_color=color,
                singer2_color=color,
                both_color=color,
            )
            assert "[V4+ Styles]" in res

    def test_extreme_font_size_scale_values(self):
        """Fuzz testing extreme, zero, and boundary font scale values."""
        scales = [0.0, -1.0, -99.9, 0.001, 0.5, 1.0, 2.5, 10.0, 100.0, float("nan"), float("inf")]
        for s in scales:
            res = generate_ass_content(
                lines=[{"text": "Font test", "start_time": 1.0, "end_time": 3.0}],
                theme_id="punk_diy",
                font_size_scale=s,
            )
            assert "[V4+ Styles]" in res
            # Font size must be an integer >= 12
            style_line = next(
                line_str
                for line_str in res.splitlines()
                if line_str.startswith("Style: KaraokeLine1,")
            )
            parts = style_line.split(",")
            font_size = int(parts[2])
            assert font_size >= 12

    def test_malformed_and_edge_case_chords(self):
        """Fuzz testing chords array with malformed, inverted, missing, or extreme fields."""
        fuzz_chords = [
            None,
            42,
            "not a chord dict",
            {},
            {"chord": ""},
            {"chord": "N.C."},
            {"chord": "Am", "start": -5.0, "end": -1.0},
            {"chord": "G7", "start": 30.0, "end": 10.0},  # inverted
            {"chord": "F#m7b5", "start": float("nan"), "end": float("inf")},
            {"chord": "C" * 500, "start": 5.0, "end": 7.0},
        ]
        res = generate_ass_content(
            lines=[{"text": "Chord test", "start_time": 1.0, "end_time": 10.0}],
            theme_id="tape_70s",
            include_chords=True,
            chords=fuzz_chords,  # type: ignore
            semitones=3,
        )
        assert "[Events]" in res
        # Ensure Chord style is present in V4+ Styles
        assert "Style: Chord" in res

    @pytest.mark.parametrize(
        "theme_id", [*list(VISUAL_THEMES.keys()), "nonexistent_theme", None, ""]
    )
    @pytest.mark.parametrize("sync_mode", ["word", "line", "unknown_mode", None])
    @pytest.mark.parametrize("aspect_ratio", ["16:9", "9:16", "4:3", "unknown_ar"])
    def test_theme_and_mode_matrix_resilience(self, theme_id, sync_mode, aspect_ratio):
        """Matrix resilience test across all themes, sync modes, and aspect ratios."""
        test_lines = [
            {
                "text": "First line of song",
                "start_time": 1.0,
                "end_time": 5.0,
                "singer": "singer1",
                "words": [
                    {"word": "First", "start_time": 1.0, "end_time": 2.0},
                    {"word": "line", "start_time": 2.0, "end_time": 3.0},
                    {"word": "of", "start_time": 3.0, "end_time": 4.0},
                    {"word": "song", "start_time": 4.0, "end_time": 5.0},
                ],
            },
            {
                "text": "Second duet line",
                "start_time": 10.0,
                "end_time": 14.0,
                "singer": "both",
                "words": [
                    {"word": "Second", "start_time": 10.0, "end_time": 12.0},
                    {"word": "duet", "start_time": 12.0, "end_time": 13.0},
                    {"word": "line", "start_time": 13.0, "end_time": 14.0},
                ],
            },
        ]
        res = generate_ass_content(
            lines=test_lines,
            aspect_ratio=aspect_ratio,
            theme_id=theme_id,
            sync_mode=sync_mode,  # type: ignore
        )
        assert "[Script Info]" in res
        assert "[V4+ Styles]" in res
        assert "[Events]" in res
        dialogues = [line_str for line_str in res.splitlines() if line_str.startswith("Dialogue:")]
        # Countdown may add 1 dialogue line for gaps >= 4.0s
        assert len(dialogues) >= 2


class TestHelperFunctionsFuzzing:
    """Fuzz testing safe_time, format_ass_time, and escape_ass_text."""

    def test_safe_time_fuzzing(self):
        assert safe_time(0) == 0.0
        assert safe_time(-5.5) == 0.0
        assert safe_time(-5.5, default=10.0) == 10.0
        assert safe_time(float("nan"), default=3.0) == 3.0
        assert safe_time(float("inf"), default=4.0) == 4.0
        assert safe_time(float("-inf"), default=5.0) == 5.0
        assert safe_time("not a number", default=2.5) == 2.5
        assert safe_time(None, default=1.0) == 1.0
        assert safe_time([1, 2], default=0.0) == 0.0
        assert safe_time(1e12) == 1e12

    def test_format_ass_time_fuzzing(self):
        assert format_ass_time(0.0) == "0:00:00.00"
        assert format_ass_time(-10.0) == "0:00:00.00"
        assert format_ass_time(float("nan")) == "0:00:00.00"
        assert format_ass_time(float("inf")) == "0:00:00.00"
        assert format_ass_time(float("-inf")) == "0:00:00.00"
        assert format_ass_time(None) == "0:00:00.00"  # type: ignore
        assert format_ass_time("bad") == "0:00:00.00"  # type: ignore
        # Centisecond rounding check: 59.996 -> 1:00.00
        assert format_ass_time(59.996) == "0:01:00.00"
        # Large timestamp check: 3661.50 -> 1:01:01.50
        assert format_ass_time(3661.50) == "1:01:01.50"

    def test_escape_ass_text_fuzzing(self):
        assert escape_ass_text("") == ""
        assert escape_ass_text(None) == ""  # type: ignore
        assert escape_ass_text(123) == "123"  # type: ignore
        assert escape_ass_text("Normal lyrics") == "Normal lyrics"
        assert escape_ass_text("Slash \\ and {curly}") == "Slash \\\\ and \\{curly\\}"
        assert escape_ass_text("Multi\r\nline\rtext\n") == "Multi line text "
