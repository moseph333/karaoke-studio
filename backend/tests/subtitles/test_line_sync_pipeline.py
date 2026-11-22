r"""Empirical Challenger Test Suite for Milestone M2:
Line-by-Line Lyric Synchronization Display & Backend ASS / Video Pipeline.

Challenger 1 Adversarial Stress Test Suite:
1. Zero \kf Invariant in Line Mode across diverse fuzzed text and timings.
2. Word Mode Preservation of \kf progressive sweep tags.
3. Lead-in Timing Format: {\k<cs>}{\k0} vs immediate onset (no lead-in).
4. Boundary timing edge cases: 0-duration words, 0-duration lines, untimed lines, missing text,
   inverted timestamps, negative timestamps, non-finite values (NaN, Inf).
5. Duet parts (Singer 1, Singer 2, Both), aliases, and custom sung/unsung color overrides.
6. Count-ins after instrumental gaps (Layer 1) and musical chords (Layer 2) preservation and
   non-interference.
7. Real-Surface Libass Rendering Verification:
   Synthesize video via FFmpeg using subtitles filter, extract frames at lead-in and sung timestamps,
   and verify pixel color illumination change from the unsung color to the sung color.
8. API & Pipeline Propagation: GET /export/ass and RenderRequest schema validation.

The lyric events are found by the role in their Name field (lyric:<line index>, one event per
row of a line). Tests about the text as written, or about when and where the two alternating
rows show, ask for the KTV look; the default look (Marquee) writes the line being sung in
capitals and keeps it in one reading place.
"""

import re
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, projects
from backend.schemas import RenderRequest
from backend.services import font_metrics
from backend.services.ass_draw import LookStyle
from backend.services.ass_generator import (
    BACKSLASH_GUARD,
    format_ass_time,
    generate_ass_content,
    instrumental_gaps,
)
from backend.services.stage_layout import line_text, place_rows_line
from backend.services.stage_looks import LOOKS
from backend.services.video_renderer import VideoRenderer
from backend.tests.helpers.ass_script import AssEvent, ass_events, parse_ass

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

KTV = LOOKS["ktv"]["palette"]


def lyric_rows(ass_content: str) -> list[AssEvent]:
    """The events that draw a line being sung: one per row of each line, in file order."""
    return [e for e in ass_events(ass_content) if e.kind == "lyric"]


def sweep(event: AssEvent) -> str:
    """An event's karaoke tags and words: its text after the first override block, which
    holds its place, size and colours."""
    return event.text[len(event.tags) + 2 :] if event.text.startswith("{") else event.text


def tag_color(css: str) -> str:
    """A CSS colour (#rrggbb) as an override tag writes it (&HBBGGRR&)."""
    return f"&H{css[5:7]}{css[3:5]}{css[1:3]}&".upper()


def font_size(event: AssEvent) -> float:
    """The \\fs of an event's first override block."""
    return float(re.search(r"\\fs([\d.]+)", event.tags).group(1))


# ---------------------------------------------------------------------------
# Suite 1: Zero \kf Invariant in Line Mode vs Word Mode Preservation
# ---------------------------------------------------------------------------


class TestZeroKfInvariant:
    """Adversarially verify that no \\kf progressive tags ever appear on lyric lines in line mode."""

    @pytest.mark.parametrize(
        "sync_mode_input",
        ["line", "Line", "LINE", "  line  ", "\tline\n"],
    )
    def test_line_mode_never_emits_kf_on_lyrics(self, sync_mode_input):
        lines = [
            {
                "id": 0,
                "start_time": 2.0,
                "end_time": 6.0,
                "text": "Every breath you take",
                "words": [
                    {"word": "Every", "start_time": 2.0, "end_time": 2.8},
                    {"word": "breath", "start_time": 2.8, "end_time": 3.6},
                    {"word": "you", "start_time": 3.6, "end_time": 4.2},
                    {"word": "take", "start_time": 4.2, "end_time": 6.0},
                ],
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode=sync_mode_input, theme_id="ktv")

        (row,) = lyric_rows(ass_str)
        assert "\\kf" not in row.text
        # Must illuminate line at once, when it starts (2.0s after it shows)
        assert sweep(row) == "{\\k200}{\\k0}Every breath you take"

    def test_word_mode_strictly_preserves_kf_tags(self):
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 4.0,
                "text": "One two three",
                "words": [
                    {"word": "One", "start_time": 1.0, "end_time": 2.0},
                    {"word": "two", "start_time": 2.0, "end_time": 3.0},
                    {"word": "three", "start_time": 3.0, "end_time": 4.0},
                ],
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="word", theme_id="ktv")
        (row,) = lyric_rows(ass_str)
        # All 3 words should have progressive tags, after the 1.0s the line waits on screen
        assert sweep(row) == "{\\k100}{\\kf100}One {\\kf100}two {\\kf100}three"

    def test_adversarial_user_text_with_fake_kf_tags(self):
        """User lyric text intentionally containing ASS tags and fake \\kf."""
        adversarial_text = "Singing {\\kf100}Fake Tag\\N and \\backslash with {braces}"
        lines = [
            {
                "id": 0,
                "start_time": 2.0,
                "end_time": 5.0,
                "text": adversarial_text,
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        rows = lyric_rows(ass_str)
        assert rows

        for row in rows:
            # The only override blocks after the row's own are the lead-in {\k...}{\k0}: the
            # literal { and } in user text are escaped to \{ and \}
            override_blocks = re.findall(r"(?<!\\)\{([^}]+)\}", sweep(row))
            assert override_blocks == ["\\k200", "\\k0"]
        written = " ".join(sweep(row) for row in rows)
        # Each backslash is parted from what follows it, so it cannot form an ASS tag
        assert f"\\{{\\{BACKSLASH_GUARD}kf100\\}}Fake Tag\\{BACKSLASH_GUARD}N" in written
        assert f"\\{BACKSLASH_GUARD}backslash with \\{{braces\\}}" in written


# ---------------------------------------------------------------------------
# Suite 2: Lead-in Timing Format & Immediate Onsets
# ---------------------------------------------------------------------------


class TestLeadInTimingFormat:
    """Verify lead-in format: {\\k<cs>}{\\k0} when the line shows before it starts, or no tag when cs == 0."""

    def test_first_line_lead_in_timing(self):
        # First line displays up to 2.5s early
        lines = [{"id": 0, "start_time": 5.0, "end_time": 8.0, "text": "First line"}]
        ass_str = generate_ass_content(
            lines, sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        (row,) = lyric_rows(ass_str)

        # shows at max(0, 5.0 - 2.5) = 2.5s
        assert format_ass_time(row.start) == "0:00:02.50"
        # lead-in = round((5.0 - 2.5) * 100) = 250 cs
        assert sweep(row) == "{\\k250}{\\k0}First line"

    def test_immediate_onset_line_zero(self):
        # Line starting at 0.0s shows at 0.0s -> no lead-in
        lines = [{"id": 0, "start_time": 0.0, "end_time": 3.0, "text": "Immediate start"}]
        ass_str = generate_ass_content(
            lines, sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        (row,) = lyric_rows(ass_str)

        assert format_ass_time(row.start) == "0:00:00.00"
        # No \k tag at all when there is no lead-in
        assert sweep(row) == "Immediate start"

    def test_consecutive_lines_with_prev_end_time_constraint(self):
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Line 1"},
            {"id": 1, "start_time": 3.5, "end_time": 6.0, "text": "Line 2"},
        ]
        ass_str = generate_ass_content(
            lines, sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        (second,) = [row for row in lyric_rows(ass_str) if row.line == 1]

        # Line 2 start is 3.5s; the line before ends at 3.0s.
        # shows at max(3.0, 3.5 - 2.0) = 3.0s
        assert format_ass_time(second.start) == "0:00:03.00"
        # lead-in = round((3.5 - 3.0) * 100) = 50cs
        assert sweep(second) == "{\\k50}{\\k0}Line 2"

    def test_micro_fractional_centisecond_rounding(self):
        """Test sub-centisecond offsets rounding to 0 cs vs 1 cs."""
        # 0.004s lead-in -> 0.4 cs -> round(0.4) = 0 cs -> no \k tag
        lines_sub0 = [{"id": 0, "start_time": 0.004, "end_time": 2.0, "text": "Tiny"}]
        ass_sub0 = generate_ass_content(
            lines_sub0, sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        (row0,) = lyric_rows(ass_sub0)
        assert sweep(row0) == "Tiny"

        # 0.006s lead-in -> 0.6 cs -> round(0.6) = 1 cs -> {\k1}{\k0}
        lines_sub1 = [{"id": 0, "start_time": 0.006, "end_time": 2.0, "text": "Tiny"}]
        ass_sub1 = generate_ass_content(
            lines_sub1, sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        (row1,) = lyric_rows(ass_sub1)
        assert sweep(row1) == "{\\k1}{\\k0}Tiny"


# ---------------------------------------------------------------------------
# Suite 3: Duet Parts, Alternating Lines & Color Customization
# ---------------------------------------------------------------------------


class TestDuetStylesAndColors:
    """Verify singer role mapping, line alternation, and color overrides in line mode."""

    @pytest.mark.parametrize(
        "singer_alias,expected_sung_color",
        [
            ("singer2", "singer2"),
            ("Singer 2", "singer2"),
            ("singer_2", "singer2"),
            ("partner", "singer2"),
            ("part2", "singer2"),
            ("s2", "singer2"),
            ("both", "both"),
            ("Both", "both"),
            ("unison", "both"),
            ("duet", "both"),
            ("all", "both"),
            ("together", "both"),
            ("singer1", "sung"),
            ("Singer 1", "sung"),
            (None, "sung"),
            ("unknown_singer", "sung"),
        ],
    )
    def test_singer_aliases_map_to_correct_styles(self, singer_alias, expected_sung_color):
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": "Singer line",
                "singer": singer_alias,
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        (row,) = lyric_rows(ass_str)
        # A part is told apart by the colour its words are sung in (the look's palette names
        # them "sung" for Singer 1, "singer2" and "both"); the unsung colour is the same
        expected = f"\\1c{tag_color(KTV[expected_sung_color])}\\2c{tag_color(KTV['unsung'])}"
        assert expected in row.tags

    def test_alternating_lines_for_singers(self):
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 2.0, "text": "Line 0", "singer": "singer2"},
            {"id": 1, "start_time": 2.5, "end_time": 3.5, "text": "Line 1", "singer": "singer2"},
            {"id": 2, "start_time": 4.0, "end_time": 5.0, "text": "Line 2", "singer": "both"},
            {"id": 3, "start_time": 5.5, "end_time": 6.5, "text": "Line 3", "singer": "both"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        rows = lyric_rows(ass_str)
        assert [row.line for row in rows] == [0, 1, 2, 3]

        # Lines take the two rows in turn, whoever sings them: the upper row from the left
        # edge, the lower row from the right edge
        places = [row.numbers("pos") for row in rows]
        assert places[0] == places[2] and places[1] == places[3]
        assert places[0][1] < places[1][1]
        assert ["\\an7" in row.tags for row in rows] == [True, False, True, False]
        assert ["\\an9" in row.tags for row in rows] == [False, True, False, True]

        # And each is sung in its part's colour
        singer2, both = tag_color(KTV["singer2"]), tag_color(KTV["both"])
        assert all(f"\\1c{singer2}" in row.tags for row in rows[:2])
        assert all(f"\\1c{both}" in row.tags for row in rows[2:])

    def test_custom_color_hex_formats(self):
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Colors", "singer": "singer1"},
            {"id": 1, "start_time": 3.5, "end_time": 5.5, "text": "Colors", "singer": "singer2"},
            {"id": 2, "start_time": 6.0, "end_time": 8.0, "text": "Colors", "singer": "both"},
        ]
        # Test CSS 6-digit (#FF8800), 3-digit (#0FA), and ASS format (&H00332211)
        ass_str = generate_ass_content(
            lines,
            sync_mode="line",
            primary_color="#FF8800",  # BGR: &H0088FF&
            secondary_color="&H00332211",  # #112233, BGR: &H332211&
            singer2_color="#FF0088",  # BGR: &H8800FF&
            both_color="#0FA",  # #00FFAA, BGR: &HAAFF00&
        )
        singer1, singer2, both = lyric_rows(ass_str)
        assert "\\1c&H0088FF&\\2c&H332211&" in singer1.tags
        assert "\\1c&H8800FF&\\2c&H332211&" in singer2.tags
        assert "\\1c&HAAFF00&\\2c&H332211&" in both.tags


# ---------------------------------------------------------------------------
# Suite 4: Instrumental Gap Count-ins & Chord Layer Non-Interference
# ---------------------------------------------------------------------------


class TestCountdownsAndChordsInLineMode:
    """Verify count-ins on Layer 1 and chords on Layer 2 are intact in line mode."""

    def test_countdown_emitted_only_for_qualifying_gaps(self):
        lines = [
            {"id": 0, "start_time": 5.0, "end_time": 7.0, "text": "Gap intro (>=4s)"},
            {"id": 1, "start_time": 8.0, "end_time": 9.0, "text": "Short gap (1s)"},
            {"id": 2, "start_time": 15.0, "end_time": 17.0, "text": "Long gap (6s)"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=True)
        events = ass_events(ass_str)

        count_ins = [e for e in events if e.kind == "countin"]
        # Exactly 2 count-ins: before line 0 (start 5.0s >= 4.0s) and before line 2 (15.0 - 9.0 = 6.0s >= 4.0s)
        assert {e.line for e in count_ins} == {0, 2}
        for index, starts_at in ((0, 5.0), (2, 15.0)):
            mine = [e for e in count_ins if e.line == index]
            # "3", "2", "1": a second each, until the line starts
            assert [e.plain for e in mine] == ["3", "2", "1"]
            assert [e.end for e in mine] == [starts_at - 2.0, starts_at - 1.0, starts_at]
            assert mine[0].start == starts_at - 3.0
        # Nothing cues the short gap, and every cue is on Layer 1
        cues = [e for e in events if e.kind in ("countin", "break")]
        assert not [e for e in cues if 7.0 <= e.start < 8.0]
        assert all(e.layer == 1 for e in cues)
        assert {e.layer for e in events if e.kind == "lyric"} == {0}

    def test_layer_2_chords_transposition_and_alignment(self):
        lines = [{"id": 0, "start_time": 1.0, "end_time": 5.0, "text": "Chords line"}]
        chords = [
            {"start": 1.0, "end": 3.0, "chord": "C"},
            {"start": 3.0, "end": 5.0, "chord": "G"},
        ]
        ass_str = generate_ass_content(
            lines,
            chords=chords,
            include_chords=True,
            semitones=2,  # C -> D, G -> A
            sync_mode="line",
        )
        events = ass_events(ass_str)
        chord_events = [e for e in events if e.layer == 2]
        assert [e.role for e in chord_events] == ["chord", "chord"]
        # Top centre, by the event's tag and the style it uses
        assert chord_events[0].text == "{\\an8}D"
        assert chord_events[1].text == "{\\an8}A"
        assert {e.style for e in chord_events} == {"Chord"}
        assert parse_ass(ass_str)["styles"]["Chord"]["Alignment"] == "8"

        # Ensure the lyrics remain clean
        lyric_events = [e for e in events if e.kind == "lyric"]
        assert lyric_events
        assert all("\\kf" not in e.text for e in lyric_events)


# ---------------------------------------------------------------------------
# Suite 5: Boundary Timing Edge Cases & Malformed Inputs
# ---------------------------------------------------------------------------


class TestBoundaryTimingEdgeCases:
    """Stress-test 0-durations, untimed lines, missing text, and invalid inputs."""

    def test_zero_duration_lines(self):
        """start_time == end_time (0s duration line)."""
        lines = [
            {"id": 0, "start_time": 3.0, "end_time": 3.0, "text": "Zero duration"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        (lyric,) = lyric_rows(ass_str)
        # Should not crash, produces a valid event that lasts
        assert lyric.plain == "Zero duration"
        assert lyric.start <= 3.0 < lyric.end
        assert "\\kf" not in lyric.text

    def test_zero_duration_words(self):
        """Words array where each word has 0 duration."""
        lines = [
            {
                "id": 0,
                "start_time": 2.0,
                "end_time": 4.0,
                "words": [
                    {"word": "Fast", "start_time": 2.0, "end_time": 2.0},
                    {"word": "Speech", "start_time": 2.0, "end_time": 2.0},
                ],
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        (lyric,) = lyric_rows(ass_str)
        assert lyric.plain == "Fast Speech"
        assert "\\kf" not in lyric.text

        # Word by word, each word still gets a sweep of its own, a centisecond long at least
        word_str = generate_ass_content(lines, sync_mode="word", theme_id="ktv")
        (swept,) = lyric_rows(word_str)
        assert sweep(swept) == "{\\k200}{\\kf1}Fast {\\kf1}Speech"

    def test_inverted_timestamps(self):
        """end_time < start_time."""
        lines = [{"id": 0, "start_time": 5.0, "end_time": 2.0, "text": "Inverted Line"}]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        # The end is clamped to the start, so the line still shows around its start
        (lyric,) = lyric_rows(ass_str)
        assert lyric.plain == "Inverted Line"
        assert lyric.start <= 5.0 < lyric.end

    def test_negative_and_nan_timestamps(self):
        """Negative timestamps and NaN/Inf floats."""
        lines = [
            {"id": 0, "start_time": -5.0, "end_time": -2.0, "text": "Negative"},
            {"id": 1, "start_time": float("nan"), "end_time": float("inf"), "text": "NonFinite"},
            {"id": 2, "start_time": "corrupt_str", "end_time": None, "text": "Corrupt"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        rows = lyric_rows(ass_str)
        # safe_time coerces all to non-negative finite floats (defaulting to 0.0)
        assert [row.plain for row in rows] == ["Negative", "NonFinite", "Corrupt"]
        for row in rows:
            assert row.start == 0.0
            assert row.end > row.start
            assert "\\kf" not in row.text

    def test_completely_empty_lines_and_words(self):
        """Empty string text and empty words list."""
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "", "words": []},
            {"id": 1, "start_time": 4.0, "end_time": 6.0, "text": "   ", "words": [{"word": ""}]},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        # Should not crash, and nothing is drawn for a line with nothing to sing
        events = ass_events(ass_str)
        assert all(not e.plain.strip() for e in events)
        for e in events:
            assert "\\kf" not in e.text

    def test_line_mode_none_text_with_words_fallback(self):
        """When line['text'] is explicitly None, it should fall back to joining words array instead of stringifying 'None'."""
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": None,
                "words": [
                    {"word": "Reconstructed", "start_time": 1.0, "end_time": 2.0},
                    {"word": "Sentence", "start_time": 2.0, "end_time": 3.0},
                ],
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        (lyric,) = lyric_rows(ass_str)
        assert "None" not in lyric.text
        assert lyric.plain == "Reconstructed Sentence"

    def test_line_mode_none_text_without_words_should_not_display_none(self):
        """When line['text'] is explicitly None and words is missing, it should draw nothing rather than 'None'."""
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": None,
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        assert "[Events]" in ass_str
        for e in ass_events(ass_str):
            assert "None" not in e.text
            assert not e.plain.strip()

    def test_empty_or_none_lines_input(self):
        """Passing empty list or None."""
        assert "[Script Info]" in generate_ass_content([], sync_mode="line")
        assert "[Script Info]" in generate_ass_content(None, sync_mode="line")


# ---------------------------------------------------------------------------
# Suite 6: Real-Surface Libass FFmpeg Video Render & Pixel Verification
# ---------------------------------------------------------------------------


class TestRealSurfaceLibassRender:
    """Empirical rendering test using real FFmpeg with libass subtitles filter.

    Verifies that the generated ASS script compiles and renders without errors
    and that at lead-in time the text is unilluminated (the unsung color), and at
    line start time the text illuminates to the sung color.
    """

    def test_libass_ffmpeg_renders_solid_line_illumination(self, tmp_path: Path):
        renderer = VideoRenderer(output_dir=tmp_path)
        out_ass = tmp_path / "test_render.ass"
        out_mp4 = tmp_path / "test_render.mp4"
        audio_wav = tmp_path / "tone.wav"

        # 1. Synthesize 2.5s silent audio
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "anullsrc=r=44100:cl=stereo",
                "-t",
                "2.5",
                "-c:a",
                "pcm_s16le",
                str(audio_wav),
            ],
            check=True,
            capture_output=True,
        )

        # 2. Line starts at 1.0s, ends at 2.0s.
        # It shows at max(0, 1.0 - 2.5) = 0.0s, so the lead-in is 100cs (1.0s).
        # We choose vivid colors:
        # Sung: Bright Green #00FF00 (ASS: &H00FF00&)
        # Unsung: Bright Blue #0000FF (ASS: &HFF0000&)
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 2.0,
                "text": "ILLUMINATION_TEST",
            }
        ]

        renderer.generate_ass_subtitles(
            lines=lines,
            output_ass_path=out_ass,
            sync_mode="line",
            theme_id="ktv",
            primary_color="#00FF00",  # Green
            secondary_color="#0000FF",  # Blue
            include_countdown=False,
        )

        ass_content = out_ass.read_text(encoding="utf-8")
        assert "\\1c&H00FF00&\\2c&HFF0000&}{\\k100}{\\k0}ILLUMINATION_TEST" in ass_content
        assert "\\kf" not in ass_content

        # 3. Render MP4 video via FFmpeg using VideoRenderer
        rendered_mp4 = renderer.render_video(
            audio_path=str(audio_wav),
            ass_subtitles_path=str(out_ass),
            output_mp4_path=out_mp4,
            duration=2.5,
        )

        assert Path(rendered_mp4).exists()
        assert Path(rendered_mp4).stat().st_size > 5000

        # 4. Extract frame at t=0.5s (during lead-in: should be BLUE / unsung color)
        # and frame at t=1.5s (during singing: should be GREEN / sung color)
        frame_leadin = tmp_path / "frame_leadin.png"
        frame_sung = tmp_path / "frame_sung.png"

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                "0.5",
                "-i",
                str(rendered_mp4),
                "-vframes",
                "1",
                str(frame_leadin),
            ],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                "1.5",
                "-i",
                str(rendered_mp4),
                "-vframes",
                "1",
                str(frame_sung),
            ],
            check=True,
            capture_output=True,
        )

        assert frame_leadin.exists()
        assert frame_sung.exists()

        # 5. Analyze extracted pixel frames using Python
        # The line is the first of the song, so it takes the look's upper row: crop the
        # row's box, from the top of its letters to under their descenders, as wide as the
        # look lets a row be
        style = LookStyle.of("ktv")
        block = place_rows_line(style.look, style.spec, line_text(lines[0]), 0).block
        face = font_metrics.face(block.face)
        baseline_px = block.rows[0].baseline * style.u
        crop_left = round(block.x * style.u)
        crop_top = round(baseline_px - face["ascent"] * block.size * style.u)
        crop_width = round(style.spec["lyric"]["measure"] * style.u)
        crop_height = round((face["ascent"] + face["descent"]) * block.size * style.u)

        # Read PNG files using ffmpeg rawvideo RGB24 pipe
        def get_dominant_text_rgb(img_path: Path) -> tuple[int, int]:
            cmd = [
                "ffmpeg",
                "-i",
                str(img_path),
                "-vf",
                f"crop={crop_width}:{crop_height}:{crop_left}:{crop_top}",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ]
            raw_rgb = subprocess.run(cmd, check=True, capture_output=True).stdout
            # Find pixels with high saturation: blue-ish or green-ish (the look's dark
            # outline and shadow are neither)
            blue_scores = 0
            green_scores = 0
            for i in range(0, len(raw_rgb), 3):
                r, g, b = raw_rgb[i], raw_rgb[i + 1], raw_rgb[i + 2]
                if b > 150 and b > g + 40 and b > r + 40:
                    blue_scores += 1
                if g > 150 and g > b + 40 and g > r + 40:
                    green_scores += 1
            return blue_scores, green_scores

        leadin_blue, leadin_green = get_dominant_text_rgb(frame_leadin)
        sung_blue, sung_green = get_dominant_text_rgb(frame_sung)

        # In lead-in (t=0.5s): text must be BLUE (unsung), NOT green!
        assert leadin_blue > 100, f"Expected blue pixels in lead-in frame, found {leadin_blue}"
        assert leadin_green == 0, f"Expected 0 green pixels in lead-in frame, found {leadin_green}"

        # In sung state (t=1.5s): text must have illuminated to GREEN (sung), NOT blue!
        assert sung_green > 100, f"Expected green pixels in sung frame, found {sung_green}"
        assert sung_blue == 0, f"Expected 0 blue pixels in sung frame, found {sung_blue}"


# ---------------------------------------------------------------------------
# Suite 7: API Endpoints & Request Validation
# ---------------------------------------------------------------------------


class TestApiEndpointsAndValidation:
    """Verify HTTP export parameter validation and RenderRequest schema."""

    @pytest.fixture
    def client(self):
        return TestClient(app)

    @pytest.fixture
    def auth(self):
        return {"X-App-Password": "sluggos"}

    def test_export_ass_sync_mode_validation(self, client, auth):
        pid = "proj_api_m2_validation"
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "title": "Validation Song",
            "artist": "Challenger",
            "lines": [
                {
                    "id": 0,
                    "start_time": 1.0,
                    "end_time": 3.0,
                    "text": "API Test",
                    "words": [{"word": "API", "start_time": 1.0, "end_time": 2.0}],
                }
            ],
        }

        # Valid word
        r_word = client.get(f"/api/project/{pid}/export/ass?sync_mode=word", headers=auth)
        assert r_word.status_code == 200
        assert "\\kf" in r_word.text

        # Valid line
        r_line = client.get(f"/api/project/{pid}/export/ass?sync_mode=line", headers=auth)
        assert r_line.status_code == 200
        assert "\\kf" not in r_line.text

        # Case-insensitive line
        r_line_ci = client.get(f"/api/project/{pid}/export/ass?sync_mode=LINE", headers=auth)
        assert r_line_ci.status_code == 200
        assert "\\kf" not in r_line_ci.text

        # Invalid sync_mode should return 400
        r_inv = client.get(
            f"/api/project/{pid}/export/ass?sync_mode=unsupported_mode", headers=auth
        )
        assert r_inv.status_code == 400
        assert "Invalid sync_mode" in r_inv.json()["detail"]

    def test_render_request_pydantic_schema(self):
        # Default
        assert RenderRequest().sync_mode == "word"
        # Explicit word
        assert RenderRequest(sync_mode="word").sync_mode == "word"
        # Explicit line
        assert RenderRequest(sync_mode="line").sync_mode == "line"
        # Invalid raises ValidationError
        with pytest.raises(ValidationError):
            RenderRequest(sync_mode="invalid")


# ---------------------------------------------------------------------------
# Suite 8: Milestone M2 Iteration 2 Empirical Challenge Suite (challenger_linesync_m2_it2_1)
# ---------------------------------------------------------------------------


class TestMilestone2Iteration2EmpiricalSuite:
    """Exhaustive empirical challenge suite for M2 Iteration 2 fixes.

    Stress-tests:
    1. Zero occurrences of 'None' when fields are None across sync_mode line & word.
    2. Preservation of legitimate lyrics containing the word 'None'.
    3. Word fallback reconstruction in line mode with malformed and None word entries.
    4. Zero \\kf tags invariant fuzzing on lyric lines, with a count-in after every gap.
    5. Exact centisecond lead-in timing and when a line shows.
    6. Duet parts (Singer 1, Singer 2, Both), aliases, custom hex colors, and count-in dot cues.
    7. VideoRenderer boundary guard encapsulation (raising TypeError for invalid direct kwargs).
    8. Sub-centisecond timestamp precision, minute/hour rollover, and 1000-line scale stress.
    """

    @pytest.mark.parametrize("sync_mode", ["line", "word"])
    @pytest.mark.parametrize("line_text", [None, "", "   "])
    @pytest.mark.parametrize(
        "words_case",
        [
            ("none_words", None),
            ("empty_words", []),
            ("single_none_word", [{"word": None, "start_time": 1.0, "end_time": 2.0}]),
            ("empty_str_word", [{"word": "", "start_time": 1.0, "end_time": 2.0}]),
            ("whitespace_word", [{"word": "   ", "start_time": 1.0, "end_time": 2.0}]),
            (
                "mixed_none_and_valid",
                [
                    {"word": None, "start_time": 1.0, "end_time": 1.5},
                    {"word": "Illuminated", "start_time": 1.5, "end_time": 2.5},
                    {"word": None, "start_time": 2.5, "end_time": 3.0},
                ],
            ),
        ],
    )
    @pytest.mark.parametrize("singer", [None, "", "singer1", "singer2", "both"])
    def test_exhaustive_none_elimination_matrix(self, sync_mode, line_text, words_case, singer):
        """Matrix testing of all permutations of None/empty fields in both line and word modes."""
        case_name, words = words_case
        line = {
            "id": 0,
            "start_time": 1.0,
            "end_time": 3.0,
            "text": line_text,
            "words": words,
            "singer": singer,
        }
        ass_str = generate_ass_content(
            [line],
            sync_mode=sync_mode,
            theme_id="ktv",
            title=None,
            singer2_color=None,
            both_color=None,
            include_countdown=False,
        )
        events = ass_events(ass_str)
        # The one line takes one row at most (nothing at all when it has no words)
        rows = [e for e in events if e.kind == "lyric"]
        assert len(rows) <= 1

        # 1. Zero occurrences of literal "None" string, in the header too
        assert "None" not in ass_str, (
            f"Literal 'None' found in the file for sync_mode={sync_mode}, "
            f"line_text={line_text!r}, words_case={case_name}, singer={singer!r}"
        )

        # 2. If mixed_none_and_valid was provided, 'Illuminated' is all that is drawn
        if case_name == "mixed_none_and_valid":
            (row,) = rows
            assert row.plain.strip() == "Illuminated"
        else:
            assert all(not row.plain.strip() for row in rows)

        # 3. In line mode, no \\kf tags allowed
        if sync_mode == "line":
            assert "\\kf" not in ass_str

    def test_legitimate_lyrics_containing_none_preserved(self):
        """Ensure legitimate lyric text containing the word 'None' is NOT stripped or erased."""
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": "None of this is forgotten",
                "words": [
                    {"word": "None", "start_time": 1.0, "end_time": 1.4},
                    {"word": "of", "start_time": 1.4, "end_time": 1.8},
                    {"word": "this", "start_time": 1.8, "end_time": 2.2},
                    {"word": "is", "start_time": 2.2, "end_time": 2.6},
                    {"word": "forgotten", "start_time": 2.6, "end_time": 3.0},
                ],
            }
        ]
        # Line mode
        ass_line = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        (row_line,) = lyric_rows(ass_line)
        assert row_line.plain == "None of this is forgotten"

        # Word mode
        ass_word = generate_ass_content(lines, sync_mode="word", theme_id="ktv")
        (row_word,) = lyric_rows(ass_word)
        assert row_word.plain == "None of this is forgotten"
        assert "{\\kf40}None " in row_word.text

    def test_word_fallback_with_corrupt_entries_in_line_mode(self):
        """In line mode with line['text']=None, reconstruct words while gracefully ignoring corrupt entries."""
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 4.0,
                "text": None,
                "words": [
                    None,
                    "not_a_dict",
                    12345,
                    {"word": None},
                    {"word": "  Starlight  "},
                    {"word": ""},
                    {"word": "   "},
                    {"word": "Serenade"},
                    {"word": None},
                ],
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", theme_id="ktv")
        (row,) = lyric_rows(ass_str)
        assert "None" not in row.text
        # The two real words are drawn, in order (a word's own padding is kept as written)
        assert row.plain.split() == ["Starlight", "Serenade"]
        assert "\\kf" not in row.text

    def test_zero_kf_tags_invariant_across_fuzzed_scenarios(self):
        """Fuzzing invariant: In line mode, lyric lines NEVER have \\kf tags; every gap gets its count-in."""
        import random

        rng = random.Random(42)
        sample_words = [
            "Hello",
            "World",
            "Karaoke",
            "夜に駆ける",
            "¡Cantar!",
            "Rock & {Roll}",
            "Line\\Break",
            "Special!@#$",
            "🎶",
        ]
        singers = ["singer1", "singer2", "both", "partner", "unison"]

        cur_t = 0.5
        lines = []
        for i in range(50):
            gap = rng.choice([0.0, 0.5, 1.5, 4.5, 6.0])
            start_t = cur_t + gap
            dur = rng.uniform(0.5, 4.0)
            end_t = start_t + dur
            singer = rng.choice(singers)
            n_words = rng.randint(0, 6)
            words = []
            if n_words > 0:
                w_t = start_t
                step = dur / n_words
                for _ in range(n_words):
                    words.append(
                        {
                            "word": rng.choice(sample_words),
                            "start_time": w_t,
                            "end_time": w_t + step,
                        }
                    )
                    w_t += step
            lines.append(
                {
                    "id": i,
                    "start_time": start_t,
                    "end_time": end_t,
                    "text": " ".join(rng.choice(sample_words) for _ in range(3))
                    if rng.random() > 0.3
                    else None,
                    "words": words,
                    "singer": singer,
                }
            )
            cur_t = end_t

        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=True)
        events = ass_events(ass_str)

        # Every line has words or text to sing (with this seed), so every line is drawn
        lyric_events = [e for e in events if e.kind == "lyric"]
        assert all(line["words"] or line["text"] for line in lines)
        assert {e.line for e in lyric_events} == set(range(50))
        # Lyric events MUST NEVER contain \kf
        for e in lyric_events:
            assert e.layer == 0
            assert "\\kf" not in e.text, f"Found \\kf in lyric line: {e.text}"
            assert "None" not in e.text

        # Every line after an instrumental gap is counted in on Layer 1, over its last 3 s
        count_ins = [e for e in events if e.kind == "countin"]
        gap_lines = instrumental_gaps(lines)
        assert gap_lines
        assert {e.line for e in count_ins} == set(gap_lines)
        for index in gap_lines:
            mine = [e for e in count_ins if e.line == index]
            assert all(e.layer == 1 for e in mine)
            assert [e.plain for e in mine] == ["3", "2", "1"]
            starts_at = lines[index]["start_time"]
            assert mine[0].start == pytest.approx(starts_at - 3.0, abs=0.006)
            assert mine[-1].end == pytest.approx(starts_at, abs=0.006)

    @pytest.mark.parametrize(
        "l_start,expected_display_start,expected_lead_in_cs,expected_tag",
        [
            (0.0, 0.0, 0, "Hello"),
            (0.01, 0.0, 1, "{\\k1}{\\k0}Hello"),
            (0.50, 0.0, 50, "{\\k50}{\\k0}Hello"),
            (1.00, 0.0, 100, "{\\k100}{\\k0}Hello"),
            (2.49, 0.0, 249, "{\\k249}{\\k0}Hello"),
            (2.50, 0.0, 250, "{\\k250}{\\k0}Hello"),
            (2.51, 0.01, 250, "{\\k250}{\\k0}Hello"),
            (5.00, 2.50, 250, "{\\k250}{\\k0}Hello"),
            (10.00, 7.50, 250, "{\\k250}{\\k0}Hello"),
        ],
    )
    def test_first_line_lead_in_timing_boundary_values(
        self, l_start, expected_display_start, expected_lead_in_cs, expected_tag
    ):
        """Validate first line lead-in cs timing and when it shows across boundary values."""
        line = {"id": 0, "start_time": l_start, "end_time": l_start + 3.0, "text": "Hello"}
        ass_str = generate_ass_content(
            [line], sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        (row,) = lyric_rows(ass_str)

        assert format_ass_time(row.start) == format_ass_time(expected_display_start)
        assert sweep(row) == expected_tag
        # The line flips expected_lead_in_cs after it shows: exactly when it starts
        assert round(row.start * 100) + expected_lead_in_cs == round(l_start * 100)

    @pytest.mark.parametrize(
        "prev_end,l_start,expected_display_start,expected_lead_in_cs,expected_tag",
        [
            # gap = 0.5s < 2.0s -> shows at max(5.0, 5.5 - 2.0) = 5.0
            (5.0, 5.5, 5.0, 50, "{\\k50}{\\k0}Second"),
            # gap = 1.0s < 2.0s -> shows at max(5.0, 6.0 - 2.0) = 5.0
            (5.0, 6.0, 5.0, 100, "{\\k100}{\\k0}Second"),
            # gap = 2.0s == 2.0s -> shows at max(5.0, 7.0 - 2.0) = 5.0
            (5.0, 7.0, 5.0, 200, "{\\k200}{\\k0}Second"),
            # gap = 3.0s > 2.0s -> shows at max(5.0, 8.0 - 2.0) = 6.0
            (5.0, 8.0, 6.0, 200, "{\\k200}{\\k0}Second"),
            # gap = 0.0s (adjacent) -> not after the line before -> shows at max(0, 5.0 - 2.0) = 3.0
            (5.0, 5.0, 3.0, 200, "{\\k200}{\\k0}Second"),
        ],
    )
    def test_second_line_lead_in_timing_with_previous_end(
        self, prev_end, l_start, expected_display_start, expected_lead_in_cs, expected_tag
    ):
        """Validate second line lead-in timing based on gap to previous line end."""
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": prev_end, "text": "First"},
            {"id": 1, "start_time": l_start, "end_time": l_start + 2.0, "text": "Second"},
        ]
        ass_str = generate_ass_content(
            lines, sync_mode="line", include_countdown=False, theme_id="ktv"
        )
        rows = lyric_rows(ass_str)
        assert [row.line for row in rows] == [0, 1]
        second = rows[1]

        assert format_ass_time(second.start) == format_ass_time(expected_display_start)
        assert sweep(second) == expected_tag
        assert round(second.start * 100) + expected_lead_in_cs == round(l_start * 100)

    def test_duet_countdown_dots_color_cues(self):
        """Instrumental gap count-in cues (Layer 1) must be colored per singer role."""
        lines = [
            {"id": 0, "start_time": 5.0, "end_time": 7.0, "text": "S1 line", "singer": "singer1"},
            {"id": 1, "start_time": 15.0, "end_time": 17.0, "text": "S2 line", "singer": "singer2"},
            {"id": 2, "start_time": 25.0, "end_time": 27.0, "text": "Both line", "singer": "both"},
        ]
        ass_str = generate_ass_content(
            lines,
            sync_mode="line",
            theme_id="ktv",
            include_countdown=True,
            style_config={
                "singer2_color": "#FF0088",  # ASS: &H8800FF&
                "both_color": "#00FFAA",  # ASS: &HAAFF00&
            },
        )
        count_ins = [e for e in ass_events(ass_str) if e.kind == "countin"]
        assert {e.line for e in count_ins} == {0, 1, 2}

        expected = [
            # Count-in 0: Singer 1 -> the look's own cue colour
            (0, 5.0, tag_color(KTV["cue"])),
            # Count-in 1: Singer 2 -> its colour, \1c&H8800FF&
            (1, 15.0, "&H8800FF&"),
            # Count-in 2: Both -> its colour, \1c&HAAFF00&
            (2, 25.0, "&HAAFF00&"),
        ]
        for index, starts_at, color in expected:
            dots = [e for e in count_ins if e.line == index]
            # Three dots, drawn from 3 s before the line, that go out one a second
            assert len(dots) == 3
            assert all(e.layer == 1 and "\\p1" in e.text for e in dots)
            assert {e.start for e in dots} == {starts_at - 3.0}
            assert sorted(e.end for e in dots) == [starts_at - 2.0, starts_at - 1.0, starts_at]
            assert all(f"\\1c{color}" in e.tags for e in dots)

    def test_videorenderer_encapsulation_boundaries(self, tmp_path: Path):
        """VideoRenderer's wrappers take the duet colours and font scale of the module
        functions they wrap, and still raise TypeError for keywords those don't have."""
        renderer = VideoRenderer(output_dir=tmp_path)
        out_ass = tmp_path / "test_encapsulation.ass"
        duet = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Second", "singer": "singer2"},
            {"id": 1, "start_time": 3.5, "end_time": 5.5, "text": "Both", "singer": "both"},
        ]

        # 1. generate_ass_subtitles passes singer2_color, both_color and font_size_scale on
        renderer.generate_ass_subtitles(duet, out_ass, theme_id="ktv")
        plain_second, plain_both = lyric_rows(out_ass.read_text(encoding="utf-8"))
        renderer.generate_ass_subtitles(
            duet,
            out_ass,
            theme_id="ktv",
            singer2_color="#ff0080",
            both_color="#00ff80",
            font_size_scale=1.5,
        )
        second, both = lyric_rows(out_ass.read_text(encoding="utf-8"))
        assert "\\1c&H8000FF&" in second.tags
        assert "\\1c&H80FF00&" in both.tags
        assert font_size(second) == pytest.approx(1.5 * font_size(plain_second), rel=0.01)
        assert font_size(both) == pytest.approx(1.5 * font_size(plain_both), rel=0.01)

        with pytest.raises(TypeError):
            renderer.generate_ass_subtitles([], out_ass, not_a_style_option=1)

        # 2. So does generate_ass_content, for the duet colours
        content = renderer.generate_ass_content(duet, singer2_color="#ff0080", both_color="#00ff80")
        assert "\\1c&H8000FF&" in content
        assert "\\1c&H80FF00&" in content

        with pytest.raises(TypeError):
            renderer.generate_ass_content([], not_a_style_option=1)

        # 3. generate_ass_content must accept font_size_scale and sync_mode cleanly
        content = renderer.generate_ass_content(
            [{"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Valid call"}],
            theme_id="ktv",
            font_size_scale=1.2,
            sync_mode="line",
        )
        assert "[Script Info]" in content
        assert "Valid call" in content
        assert "\\kf" not in content

        # 4. generate_ass_subtitles must accept sync_mode and style_config cleanly
        path = renderer.generate_ass_subtitles(
            lines=[{"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "File call"}],
            output_ass_path=out_ass,
            theme_id="ktv",
            sync_mode="line",
            style_config={"singer2_color": "#ff0080"},
        )
        assert Path(path).exists()
        file_content = Path(path).read_text(encoding="utf-8")
        assert "File call" in file_content
        assert "\\kf" not in file_content

    def test_sub_centisecond_precision_and_scale_stress(self):
        """Covers sub-centisecond timestamp rounding, minute/hour rollover, and 1000-line performance."""
        import time

        # Timestamp precision and rollover
        assert format_ass_time(59.996) == "0:01:00.00"
        assert format_ass_time(3599.996) == "1:00:00.00"
        assert format_ass_time(0.004) == "0:00:00.00"
        assert format_ass_time(0.006) == "0:00:00.01"

        # 1000 lines scale stress in line mode
        massive_lines = [
            {
                "id": i,
                "start_time": i * 3.0,
                "end_time": i * 3.0 + 2.5,
                "text": f"Line {i} in large karaoke performance",
                "singer": "singer2" if (i % 3 == 1) else ("both" if (i % 3 == 2) else "singer1"),
                "words": [
                    {
                        "word": f"Word{j}",
                        "start_time": i * 3.0 + j * 0.5,
                        "end_time": i * 3.0 + (j + 1) * 0.5,
                    }
                    for j in range(5)
                ],
            }
            for i in range(1000)
        ]

        t0 = time.perf_counter()
        ass_str = generate_ass_content(massive_lines, sync_mode="line", include_countdown=True)
        elapsed = time.perf_counter() - t0

        # Must execute within 1.0 second on CPU
        assert elapsed < 1.0, f"Generating 1000 lines took {elapsed:.2f}s, expected < 1.0s"
        rows = lyric_rows(ass_str)
        assert {row.line for row in rows} == set(range(1000))
        for row in rows:
            assert "\\kf" not in row.text
            assert "None" not in row.text
