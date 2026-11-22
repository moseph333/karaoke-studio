"""Adversarial stress and fuzz tests for backend/services/ass_generator.py.

Tests extreme boundary cases, malformed payloads, injection attempts,
negative/NaN/infinite timestamps, very long words, missing fields,
and multi-theme combinations across word and line sync modes.
"""

import math
import re

import pytest

from backend.services.ass_draw import ass_color
from backend.services.ass_generator import (
    css_to_ass_color,
    escape_ass_text,
    format_ass_time,
    generate_ass_content,
    safe_time,
    to_css_color,
)
from backend.services.stage_looks import LEGACY_IDS, LOOKS
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass

# Every id a request may name: the five looks, and the nine presets they replaced
THEME_IDS = [*LOOKS, *LEGACY_IDS]
ASS_TIMESTAMP = re.compile(r"^\d+:[0-5]\d:[0-5]\d\.\d{2}$")
# A block libass would read as override tags: one whose brace no backslash escapes
OVERRIDE_BLOCK = re.compile(r"(?<!\\)\{([^}]*)\}")
# The only blocks a lyric row has after the one that places it: karaoke times, and the
# tags that start and end an ad-lib
KARAOKE_OR_ADLIB = re.compile(
    r"\\kf?\d+|\\fscx[\d.]+\\fscy[\d.]+(\\[123]a&H[0-9A-F]{2}&){3}(\\i[01])?"
)


def lyric_rows(ass: str) -> list[AssEvent]:
    """The events of the lines being sung (role ``lyric:<line>``), one per row of a line."""
    return [e for e in ass_events(ass) if e.kind == "lyric"]


def drawn_lines(ass: str) -> set[int | None]:
    """The indexes of the lines a file draws, sung or waiting."""
    return {e.line for e in ass_events(ass) if e.kind in ("lyric", "next", "sung")}


def lyric_sizes(ass: str) -> set[float]:
    """The font sizes (\\fs) the lines being sung are drawn at."""
    return {float(re.search(r"\\fs([\d.]+)", row.tags).group(1)) for row in lyric_rows(ass)}


def assert_times_are_well_formed(ass: str) -> None:
    for event in parse_ass(ass)["events"]:
        assert ASS_TIMESTAMP.match(event["Start"]), event
        assert ASS_TIMESTAMP.match(event["End"]), event
    assert all(event.end >= event.start for event in ass_events(ass))


class TestAssGeneratorFuzzing:
    """Adversarial and fuzz tests for generate_ass_content."""

    @pytest.mark.parametrize("theme_id", THEME_IDS)
    def test_empty_and_none_lines(self, theme_id):
        """Fuzz testing with empty lists, None, and non-list lines."""
        # Empty lines list
        res_empty = generate_ass_content(lines=[], theme_id=theme_id)
        assert "[Script Info]" in res_empty
        assert "[V4+ Styles]" in res_empty
        assert "[Events]" in res_empty
        assert ass_events(res_empty) == []
        assert parse_ass(res_empty)["styles"]

        # None lines
        res_none = generate_ass_content(lines=None, theme_id=theme_id)  # type: ignore
        assert res_none == res_empty

        # Lines with None, primitives, and empty dicts
        corrupt_lines = [None, 42, "not a dict", [], {}, {"text": ""}]
        res_corrupt = generate_ass_content(lines=corrupt_lines, theme_id=theme_id)  # type: ignore
        assert "[Script Info]" in res_corrupt
        assert "[Events]" in res_corrupt
        assert drawn_lines(res_corrupt) == set()

    @pytest.mark.parametrize("theme_id", THEME_IDS)
    def test_missing_line_fields(self, theme_id):
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
        res = generate_ass_content(lines=sparse_lines, theme_id=theme_id)
        assert "[Events]" in res
        # The two lines that have words are drawn, without throwing exceptions
        assert drawn_lines(res) == {1, 5}
        drawn = {row.line: row.plain.strip().casefold() for row in lyric_rows(res)}
        assert drawn == {1: "only text", 5: "hello"}
        assert_times_are_well_formed(res)

    @pytest.mark.parametrize("theme_id", THEME_IDS)
    def test_negative_and_inverted_timestamps(self, theme_id):
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
        res = generate_ass_content(lines=weird_lines, theme_id=theme_id, include_countdown=False)
        assert "[Events]" in res
        assert {row.line for row in lyric_rows(res)} == {0, 1, 2}

        # Verify timestamps in Dialogue events are formatted as valid non-negative H:MM:SS.cs
        for event in parse_ass(res)["events"]:
            assert "-" not in event["Start"]
            assert "-" not in event["End"]
        assert_times_are_well_formed(res)
        # No karaoke time is negative either
        assert "\\k-" not in res and "\\kf-" not in res

    @pytest.mark.parametrize("theme_id", THEME_IDS)
    def test_nan_and_infinite_timestamps(self, theme_id):
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
        res = generate_ass_content(lines=nan_lines, theme_id=theme_id)
        assert "[Events]" in res
        assert {row.line for row in lyric_rows(res)} == {0, 1}
        for event in parse_ass(res)["events"]:
            start_str, end_str = event["Start"], event["End"]
            assert "nan" not in start_str.lower()
            assert "inf" not in start_str.lower()
            assert "nan" not in end_str.lower()
            assert "inf" not in end_str.lower()
        assert_times_are_well_formed(res)

    @pytest.mark.parametrize("theme_id", list(LOOKS))
    def test_very_long_words_and_large_lyrics(self, theme_id):
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
        res = generate_ass_content(lines=[line_with_giant_word], theme_id=theme_id)
        assert "[Events]" in res
        # Ensure giant text was escaped and included without memory or buffer overflow
        assert len(res) > 20000
        sung = "".join(row.plain for row in lyric_rows(res))
        assert sung.replace(" ", "") == giant_word + unicode_explosion
        assert sum(row.text.count("\\kf") for row in lyric_rows(res)) == 2

    @pytest.mark.parametrize("theme_id", THEME_IDS)
    @pytest.mark.parametrize("sync_mode", ["word", "line"])
    def test_ass_override_injection_escaping(self, theme_id, sync_mode):
        """Verifies that malicious or formatting ASS tags in lyric text are safely escaped."""
        injection_text = (
            "{\\b1\\i1}Malicious{\\b0\\i0} text with \\N newline and \\h space and {\\fad(500,500)}"
        )
        timed = {
            "text": injection_text,
            "start_time": 5.0,
            "end_time": 10.0,
            "words": [
                {"word": "{\\b1}", "start_time": 5.0, "end_time": 6.0},
                {"word": "injection", "start_time": 6.0, "end_time": 8.0},
                {"word": "{\\b0}", "start_time": 8.0, "end_time": 10.0},
            ],
        }
        # The same text without word times, so the line's own text is what is drawn
        untimed = {"text": injection_text, "start_time": 12.0, "end_time": 15.0}

        res = generate_ass_content(
            lines=[timed, untimed],
            theme_id=theme_id,
            sync_mode=sync_mode,
            include_countdown=False,
        )
        events = ass_events(res)
        assert {e.line for e in events if e.kind == "lyric"} == {0, 1}
        for event in events:
            if event.kind == "caret":
                continue
            # Verify curly braces and backslashes in lyrics are escaped as \{ and \}: after
            # the block that places an event, the only blocks left are the generator's own
            text = event.text.removeprefix(f"{{{event.tags}}}")
            for block in OVERRIDE_BLOCK.findall(text):
                assert KARAOKE_OR_ADLIB.fullmatch(block), (event.role, block)
            # No backslash of the lyrics starts a tag, a line break or a hard space
            assert not re.search(r"\\[Nnh]", OVERRIDE_BLOCK.sub("", text)), event.role

        def drawn(role: str) -> str:
            """A line's rows as libass draws them, read as one line."""
            rows = [OVERRIDE_BLOCK.sub("", e.text) for e in events if e.role == role]
            return " ".join(rows).casefold()

        assert drawn("lyric:0") == "\\{\\\u2060b1\\} injection \\{\\\u2060b0\\}"
        assert drawn("lyric:1") == escape_ass_text(injection_text).casefold()

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
        lines = [{"text": "test", "start_time": 1.0, "end_time": 2.0}]
        for theme_id in THEME_IDS:
            untouched = generate_ass_content(lines=lines, theme_id=theme_id)
            for color in bad_colors:
                # css_to_ass_color must never raise an unhandled exception
                converted = css_to_ass_color(color)
                assert isinstance(converted, str)
                assert converted.startswith("&H")

                # generate_ass_content must handle malformed color overrides gracefully
                res = generate_ass_content(
                    lines=lines,
                    theme_id=theme_id,
                    primary_color=color,
                    secondary_color=color,
                    singer2_color=color,
                    both_color=color,
                )
                assert "[V4+ Styles]" in res
                chosen = to_css_color(color)
                if chosen is None:
                    # What is not a colour is ignored: the look's colours apply
                    assert res == untouched, (theme_id, color)
                else:
                    tags = f"\\1c{ass_color(chosen)}\\2c{ass_color(chosen)}"
                    assert all(tags in row.tags for row in lyric_rows(res)), (theme_id, color)

    @pytest.mark.parametrize("via", ["argument", "style_config"])
    @pytest.mark.parametrize(
        "scale",
        [0.0, -1.0, -99.9, 0.001, 0.5, 1.0, 2.5, 10.0, 100.0, float("nan"), float("inf")],
    )
    def test_extreme_font_size_scale_values(self, via, scale):
        """Fuzz testing extreme, zero, and boundary font scale values."""
        lines = [{"text": "Font test", "start_time": 1.0, "end_time": 3.0}]

        def sizes(**given) -> set[float]:
            return lyric_sizes(generate_ass_content(lines=lines, theme_id="ktv", **given))

        (smallest,) = sizes(font_size_scale=0.1)
        (largest,) = sizes(font_size_scale=5.0)
        (plain,) = sizes()
        assert 0 < smallest < plain < largest

        if via == "argument":
            res = generate_ass_content(lines=lines, theme_id="ktv", font_size_scale=scale)
        else:
            res = generate_ass_content(
                lines=lines, theme_id="ktv", style_config={"font_size_scale": scale}
            )
        assert "[V4+ Styles]" in res
        # The lyrics are never drawn smaller than the smallest size a request can ask for (a
        # tenth of the look's own), and a request's own value stops at five times it
        (size,) = lyric_sizes(res)
        assert math.isfinite(size)
        assert size >= smallest
        if via == "style_config":
            assert size <= largest
        if not math.isfinite(scale):
            assert size == plain
        elif 0.1 <= scale <= 5.0:
            assert size == pytest.approx(plain * scale, rel=0.01)

    @pytest.mark.parametrize("theme_id", THEME_IDS)
    def test_malformed_and_edge_case_chords(self, theme_id):
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
            theme_id=theme_id,
            include_chords=True,
            chords=fuzz_chords,  # type: ignore
            semitones=3,
        )
        assert "[Events]" in res
        # Ensure Chord style is present in V4+ Styles
        assert "Style: Chord" in res
        # The four entries that name a chord are drawn, the rest left out
        chords = [e for e in ass_events(res) if e.kind == "chord"]
        assert len(chords) == 4
        assert all(e.layer == 2 and e.plain and e.end > e.start for e in chords)
        assert_times_are_well_formed(res)

    @pytest.mark.parametrize("theme_id", [*THEME_IDS, "nonexistent_theme", None, ""])
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
        parsed = parse_ass(res)
        events = ass_events(res)

        # Both lines are sung, and the second is counted in after its gap of 5 s
        rows = lyric_rows(res)
        assert {row.line for row in rows} == {0, 1}
        assert {e.role for e in events if e.kind == "countin"} == {"countin:1"}
        assert {e.style for e in events} <= set(parsed["styles"])
        assert_times_are_well_formed(res)

        # Only 9:16 is the tall frame; anything else is 16:9
        tall = aspect_ratio == "9:16"
        assert (parsed["info"]["PlayResX"], parsed["info"]["PlayResY"]) == (
            ("1080", "1920") if tall else ("1920", "1080")
        )

        # Only "line" fills a line all at once; anything else fills word by word
        swept = sum(row.text.count("\\kf") for row in rows)
        assert swept == (0 if sync_mode == "line" else 7)

        # An id that names no look gives the default look
        if theme_id not in THEME_IDS:
            assert res == generate_ass_content(
                lines=test_lines,
                aspect_ratio=aspect_ratio,
                sync_mode=sync_mode,  # type: ignore
            )


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
        assert escape_ass_text("Slash \\ and {curly}") == "Slash \\\u2060 and \\{curly\\}"
        assert escape_ass_text("Multi\r\nline\rtext\n") == "Multi line text "
