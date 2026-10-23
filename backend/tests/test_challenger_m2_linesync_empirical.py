r"""Empirical Challenger Test Suite for Milestone M2:
Line-by-Line Lyric Synchronization Display & Backend ASS / Video Pipeline.

Challenger 1 Adversarial Stress Test Suite:
1. Zero \kf Invariant in Line Mode across diverse fuzzed text and timings.
2. Word Mode Preservation of \kf progressive sweep tags.
3. Lead-in Timing Format: {\k<cs>}{\k0} vs immediate onset (lead_in_cs == 0).
4. Boundary timing edge cases: 0-duration words, 0-duration lines, untimed lines, missing text,
   inverted timestamps, negative timestamps, non-finite values (NaN, Inf).
5. Duet multi-singer styles (Singer 1, Singer 2, Both), aliases, and custom primary/secondary color overrides.
6. Instrumental gap countdowns (Layer 1) and musical chords (Layer 2) preservation and non-interference.
7. Real-Surface Libass Rendering Verification:
   Synthesize video via FFmpeg using subtitles filter, extract frames at lead-in and sung timestamps,
   and verify pixel color illumination change from secondary (white) to primary (sung color).
8. API & Pipeline Propagation: GET /export/ass and RenderRequest schema validation.
"""

import math
import os
import re
import subprocess
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from backend.main import app, projects
from backend.schemas import RenderRequest
from backend.services.ass_generator import (
    css_to_ass_color,
    format_ass_time,
    generate_ass_content,
    generate_ass_subtitles,
    safe_time,
)
from backend.services.video_renderer import VideoRenderer

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def parse_ass_dialogues(ass_content: str) -> list[dict[str, str]]:
    """Parse [Events] Dialogue lines into structured dictionaries."""
    events = []
    lines = ass_content.splitlines()
    in_events = False
    format_fields = []
    for line in lines:
        line = line.strip()
        if line == "[Events]":
            in_events = True
            continue
        if in_events:
            if line.startswith("Format:"):
                format_fields = [f.strip() for f in line[len("Format:") :].split(",")]
            elif line.startswith("Dialogue:"):
                # Dialogue format has 9 commas separating the first 9 fields;
                # the 10th field (Text) may contain commas.
                parts = line[len("Dialogue:") :].split(",", len(format_fields) - 1)
                event = dict(
                    zip(format_fields, [p.strip() for p in parts[:-1]] + [parts[-1]], strict=False)
                )
                events.append(event)
    return events


def parse_ass_styles(ass_content: str) -> dict[str, dict[str, str]]:
    """Parse [V4+ Styles] into a dictionary keyed by style name."""
    styles = {}
    lines = ass_content.splitlines()
    in_styles = False
    format_fields = []
    for line in lines:
        line = line.strip()
        if line == "[V4+ Styles]":
            in_styles = True
            continue
        if in_styles:
            if line.startswith("[") and line.endswith("]"):
                break
            if line.startswith("Format:"):
                format_fields = [f.strip() for f in line[len("Format:") :].split(",")]
            elif line.startswith("Style:"):
                parts = [p.strip() for p in line[len("Style:") :].split(",")]
                style_dict = dict(zip(format_fields, parts, strict=False))
                styles[style_dict["Name"]] = style_dict
    return styles


# ---------------------------------------------------------------------------
# Suite 1: Zero \kf Invariant in Line Mode vs Word Mode Preservation
# ---------------------------------------------------------------------------


class TestZeroKfInvariant:
    """Adversarially verify that no \\kf progressive tags ever appear on Layer 0 in line mode."""

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
        ass_str = generate_ass_content(lines, sync_mode=sync_mode_input)
        dialogues = parse_ass_dialogues(ass_str)
        lyric_events = [d for d in dialogues if d.get("Layer") == "0"]

        assert len(lyric_events) == 1
        for ev in lyric_events:
            assert "\\kf" not in ev["Text"]
            # Must illuminate line at once
            assert "Every breath you take" in ev["Text"]

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
        ass_str = generate_ass_content(lines, sync_mode="word")
        dialogues = parse_ass_dialogues(ass_str)
        lyric_events = [d for d in dialogues if d.get("Layer") == "0"]
        assert len(lyric_events) == 1
        assert "\\kf" in lyric_events[0]["Text"]
        # All 3 words should have progressive tags
        kf_matches = re.findall(r"\\kf\d+", lyric_events[0]["Text"])
        assert len(kf_matches) == 3

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
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        ev = dialogues[0]

        # The literal { and } in user text must be escaped to \{ and \}
        # The backslash must be escaped to \\ so it cannot form an ASS tag
        assert "\\{fake tag" not in ev["Text"].lower()
        # Verify no unescaped override blocks other than lead-in {\k...}{\k0}
        override_blocks = re.findall(r"(?<!\\)\{([^}]+)\}", ev["Text"])
        for block in override_blocks:
            assert "\\kf" not in block, f"Found unescaped \\kf tag inside override block: {block}"


# ---------------------------------------------------------------------------
# Suite 2: Lead-in Timing Format & Immediate Onsets
# ---------------------------------------------------------------------------


class TestLeadInTimingFormat:
    """Verify lead-in format: {\\k<cs>}{\\k0} when display_start < l_start, or no tag when cs == 0."""

    def test_first_line_lead_in_timing(self):
        # First line displays up to 2.5s early
        lines = [{"id": 0, "start_time": 5.0, "end_time": 8.0, "text": "First line"}]
        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=False)
        d = parse_ass_dialogues(ass_str)[0]

        # display_start = max(0, 5.0 - 2.5) = 2.5s
        assert d["Start"] == "0:00:02.50"
        # lead_in_cs = round((5.0 - 2.5) * 100) = 250 cs
        assert d["Text"].startswith("{\\k250}{\\k0}First line")

    def test_immediate_onset_line_zero(self):
        # Line starting at 0.0s has display_start = 0.0s -> lead_in_cs = 0
        lines = [{"id": 0, "start_time": 0.0, "end_time": 3.0, "text": "Immediate start"}]
        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=False)
        d = parse_ass_dialogues(ass_str)[0]

        assert d["Start"] == "0:00:00.00"
        # No \k tag at all when lead_in_cs == 0
        assert d["Text"] == "Immediate start"
        assert "{\\k" not in d["Text"]

    def test_consecutive_lines_with_prev_end_time_constraint(self):
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Line 1"},
            {"id": 1, "start_time": 3.5, "end_time": 6.0, "text": "Line 2"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=False)
        dialogues = parse_ass_dialogues(ass_str)
        d1 = dialogues[1]

        # Line 2 start is 3.5s; prev_end_time is 3.0s.
        # display_start = max(3.0, 3.5 - 2.0) = 3.0s
        assert d1["Start"] == "0:00:03.00"
        # lead_in_cs = round((3.5 - 3.0) * 100) = 50cs
        assert d1["Text"].startswith("{\\k50}{\\k0}Line 2")

    def test_micro_fractional_centisecond_rounding(self):
        """Test sub-centisecond offsets rounding to 0 cs vs 1 cs."""
        # 0.004s lead-in -> 0.4 cs -> round(0.4) = 0 cs -> no \k tag
        lines_sub0 = [{"id": 0, "start_time": 0.004, "end_time": 2.0, "text": "Tiny"}]
        ass_sub0 = generate_ass_content(lines_sub0, sync_mode="line", include_countdown=False)
        d0 = parse_ass_dialogues(ass_sub0)[0]
        assert "{\\k" not in d0["Text"]

        # 0.006s lead-in -> 0.6 cs -> round(0.6) = 1 cs -> {\k1}{\k0}
        lines_sub1 = [{"id": 0, "start_time": 0.006, "end_time": 2.0, "text": "Tiny"}]
        ass_sub1 = generate_ass_content(lines_sub1, sync_mode="line", include_countdown=False)
        d1 = parse_ass_dialogues(ass_sub1)[0]
        assert d1["Text"].startswith("{\\k1}{\\k0}")


# ---------------------------------------------------------------------------
# Suite 3: Duet Styles, Alternating Lines & Color Customization
# ---------------------------------------------------------------------------


class TestDuetStylesAndColors:
    """Verify singer role mapping, line alternation, and color overrides in line mode."""

    @pytest.mark.parametrize(
        "singer_alias,expected_style_suffix",
        [
            ("singer2", "_Singer2"),
            ("Singer 2", "_Singer2"),
            ("singer_2", "_Singer2"),
            ("partner", "_Singer2"),
            ("part2", "_Singer2"),
            ("s2", "_Singer2"),
            ("both", "_Both"),
            ("Both", "_Both"),
            ("unison", "_Both"),
            ("duet", "_Both"),
            ("all", "_Both"),
            ("together", "_Both"),
            ("singer1", ""),
            ("Singer 1", ""),
            (None, ""),
            ("unknown_singer", ""),
        ],
    )
    def test_singer_aliases_map_to_correct_styles(self, singer_alias, expected_style_suffix):
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": "Singer line",
                "singer": singer_alias,
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line")
        d = parse_ass_dialogues(ass_str)[0]
        expected_style = f"KaraokeLine1{expected_style_suffix}"
        assert d["Style"] == expected_style

    def test_alternating_lines_for_singers(self):
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 2.0, "text": "Line 0", "singer": "singer2"},
            {"id": 1, "start_time": 2.5, "end_time": 3.5, "text": "Line 1", "singer": "singer2"},
            {"id": 2, "start_time": 4.0, "end_time": 5.0, "text": "Line 2", "singer": "both"},
            {"id": 3, "start_time": 5.5, "end_time": 6.5, "text": "Line 3", "singer": "both"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert dialogues[0]["Style"] == "KaraokeLine1_Singer2"
        assert dialogues[1]["Style"] == "KaraokeLine2_Singer2"
        assert dialogues[2]["Style"] == "KaraokeLine1_Both"
        assert dialogues[3]["Style"] == "KaraokeLine2_Both"

    def test_custom_color_hex_formats(self):
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Colors", "singer": "singer2"}
        ]
        # Test CSS 6-digit (#112233), 3-digit (#F0A), and ASS format (&H00332211)
        ass_str = generate_ass_content(
            lines,
            sync_mode="line",
            primary_color="#FF8800",  # BGR: &H000088FF
            secondary_color="#112233",  # BGR: &H00332211
            singer2_color="#FF0088",  # BGR: &H008800FF
            both_color="#00FFAA",  # BGR: &H00AAFF00
        )
        styles = parse_ass_styles(ass_str)
        assert styles["KaraokeLine1"]["PrimaryColour"] == "&H000088FF"
        assert styles["KaraokeLine1"]["SecondaryColour"] == "&H00332211"
        assert styles["KaraokeLine1_Singer2"]["PrimaryColour"] == "&H008800FF"
        assert styles["KaraokeLine1_Both"]["PrimaryColour"] == "&H00AAFF00"


# ---------------------------------------------------------------------------
# Suite 4: Instrumental Gap Countdowns & Chord Layer Non-Interference
# ---------------------------------------------------------------------------


class TestCountdownsAndChordsInLineMode:
    """Verify gap countdowns on Layer 1 and chords on Layer 2 are intact in line mode."""

    def test_countdown_emitted_only_for_qualifying_gaps(self):
        lines = [
            {"id": 0, "start_time": 5.0, "end_time": 7.0, "text": "Gap intro (>=4s)"},
            {"id": 1, "start_time": 8.0, "end_time": 9.0, "text": "Short gap (1s)"},
            {"id": 2, "start_time": 15.0, "end_time": 17.0, "text": "Long gap (6s)"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=True)
        dialogues = parse_ass_dialogues(ass_str)

        countdown_events = [d for d in dialogues if d.get("Layer") == "1"]
        # Exactly 2 countdowns: before line 0 (start 5.0s >= 4.0s) and before line 2 (15.0 - 9.0 = 6.0s >= 4.0s)
        assert len(countdown_events) == 2
        assert countdown_events[0]["End"] == "0:00:05.00"
        assert countdown_events[1]["End"] == "0:00:15.00"
        for cd in countdown_events:
            assert "●" in cd["Text"]
            assert cd["Style"] == "Countdown"

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
            style_config={"chord_alignment": 8},
            sync_mode="line",
        )
        dialogues = parse_ass_dialogues(ass_str)
        chord_events = [d for d in dialogues if d.get("Layer") == "2"]
        assert len(chord_events) == 2
        assert "{\\an8}D" in chord_events[0]["Text"]
        assert "{\\an8}A" in chord_events[1]["Text"]

        # Ensure Layer 0 lyrics remain clean
        lyric_event = next(d for d in dialogues if d.get("Layer") == "0")
        assert "\\kf" not in lyric_event["Text"]


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
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) >= 1
        lyric = dialogues[0]
        # Should not crash, produces valid dialogue
        assert "Zero duration" in lyric["Text"]
        assert "\\kf" not in lyric["Text"]

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
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 1
        assert "Fast Speech" in dialogues[0]["Text"]
        assert "\\kf" not in dialogues[0]["Text"]

    def test_inverted_timestamps(self):
        """end_time < start_time."""
        lines = [{"id": 0, "start_time": 5.0, "end_time": 2.0, "text": "Inverted Line"}]
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        lyric_events = [d for d in dialogues if d.get("Layer") == "0"]
        # ass_generator clamps l_end = max(l_start, l_end)
        assert len(lyric_events) == 1
        assert "Inverted Line" in lyric_events[0]["Text"]

    def test_negative_and_nan_timestamps(self):
        """Negative timestamps and NaN/Inf floats."""
        lines = [
            {"id": 0, "start_time": -5.0, "end_time": -2.0, "text": "Negative"},
            {"id": 1, "start_time": float("nan"), "end_time": float("inf"), "text": "NonFinite"},
            {"id": 2, "start_time": "corrupt_str", "end_time": None, "text": "Corrupt"},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        # safe_time coerces all to non-negative finite floats (defaulting to 0.0)
        assert len(dialogues) == 3
        for d in dialogues:
            assert "\\kf" not in d["Text"]

    def test_completely_empty_lines_and_words(self):
        """Empty string text and empty words list."""
        lines = [
            {"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "", "words": []},
            {"id": 1, "start_time": 4.0, "end_time": 6.0, "text": "   ", "words": [{"word": ""}]},
        ]
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 2
        for d in dialogues:
            assert "\\kf" not in d["Text"]

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
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 1
        assert "None" not in dialogues[0]["Text"]
        assert "Reconstructed Sentence" in dialogues[0]["Text"]

    def test_line_mode_none_text_without_words_should_not_display_none(self):
        """When line['text'] is explicitly None and words is missing, it should emit empty string rather than 'None'."""
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": None,
            }
        ]
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 1
        assert "None" not in dialogues[0]["Text"]

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
    and that at lead-in time the text is unilluminated (secondary/white), and at
    line start time the text illuminates to the sung primary color.
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
        # display_start = max(0, 1.0 - 2.5) = 0.0s.
        # lead_in_cs = 100cs (1.0s).
        # We choose vivid colors:
        # Primary (sung): Bright Green #00FF00 (ASS: &H0000FF00)
        # Secondary (unsung): Bright Blue #0000FF (ASS: &H00FF0000)
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
            primary_color="#00FF00",  # Green
            secondary_color="#0000FF",  # Blue
            include_countdown=False,
        )

        ass_content = out_ass.read_text(encoding="utf-8")
        assert "{\\k100}{\\k0}ILLUMINATION_TEST" in ass_content
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

        # 4. Extract frame at t=0.5s (during lead-in: should be BLUE / secondary color)
        # and frame at t=1.5s (during singing: should be GREEN / primary color)
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
        # Read PNG files using ffmpeg rawvideo RGB24 pipe
        def get_dominant_text_rgb(img_path: Path) -> tuple[int, int, int]:
            # Crop subtitle region: bottom center (Y ~ 800 to 1000 of 1080p, X ~ 400 to 1500)
            cmd = [
                "ffmpeg",
                "-i",
                str(img_path),
                "-vf",
                "crop=800:150:560:850",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ]
            raw_rgb = subprocess.run(cmd, check=True, capture_output=True).stdout
            # Find non-black pixels (text and outline)
            # Find pixels with high saturation: blue-ish or green-ish
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

        # In lead-in (t=0.5s): text must be BLUE (secondary unsung), NOT green!
        assert leadin_blue > 100, f"Expected blue pixels in lead-in frame, found {leadin_blue}"
        assert leadin_green == 0, f"Expected 0 green pixels in lead-in frame, found {leadin_green}"

        # In sung state (t=1.5s): text must have illuminated to GREEN (primary sung), NOT blue!
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
    4. Zero \\kf tags invariant fuzzing on Layer 0 while preserving \\kf on Layer 1 gap countdowns.
    5. Exact centisecond lead-in timing and line display_start alignment.
    6. Duet singer styles (Singer 1, Singer 2, Both), aliases, custom hex colors, and countdown dot cues.
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
            title=None,
            singer2_color=None,
            both_color=None,
            include_countdown=False,
        )
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 1
        d_text = dialogues[0]["Text"]

        # 1. Zero occurrences of literal "None" string
        assert "None" not in d_text, (
            f"Literal 'None' found in dialogue text for sync_mode={sync_mode}, "
            f"line_text={line_text!r}, words_case={case_name}, singer={singer!r}: {d_text!r}"
        )

        # 2. In line mode, if mixed_none_and_valid was provided, 'Illuminated' must be present
        if sync_mode == "line" and case_name == "mixed_none_and_valid":
            assert "Illuminated" in d_text

        # 3. In line mode, no \\kf tags allowed
        if sync_mode == "line":
            assert "\\kf" not in d_text

    def test_legitimate_lyrics_containing_none_preserved(self):
        """Ensure legitimate lyric text containing the word 'None' is NOT stripped or erased."""
        lines = [
            {
                "id": 0,
                "start_time": 1.0,
                "end_time": 3.0,
                "text": "None of this is forgotten",
                "words": [
                    {"word": "None", "start_time": 1.0, "end_time": 1.5},
                    {"word": "of", "start_time": 1.5, "end_time": 2.0},
                    {"word": "this", "start_time": 2.0, "end_time": 2.5},
                    {"word": "remains", "start_time": 2.5, "end_time": 3.0},
                ],
            }
        ]
        # Line mode
        ass_line = generate_ass_content(lines, sync_mode="line")
        d_line = parse_ass_dialogues(ass_line)[0]
        assert "None of this is forgotten" in d_line["Text"]

        # Word mode
        ass_word = generate_ass_content(lines, sync_mode="word")
        d_word = parse_ass_dialogues(ass_word)[0]
        assert "None" in d_word["Text"]

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
        ass_str = generate_ass_content(lines, sync_mode="line")
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 1
        d_text = dialogues[0]["Text"]
        assert "None" not in d_text
        assert "Starlight Serenade" in d_text
        assert "\\kf" not in d_text

    def test_zero_kf_tags_invariant_across_fuzzed_scenarios(self):
        """Fuzzing invariant: In line mode, Layer 0 lyrics NEVER have \\kf tags; Layer 1 countdowns DO."""
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
        dialogues = parse_ass_dialogues(ass_str)

        layer_0_events = [d for d in dialogues if d.get("Layer") == "0"]
        layer_1_events = [d for d in dialogues if d.get("Layer") == "1"]

        assert len(layer_0_events) == 50
        # Layer 0 dialogue events MUST NEVER contain \kf
        for d in layer_0_events:
            assert "\\kf" not in d["Text"], f"Found \\kf in Layer 0 line: {d['Text']}"
            assert "None" not in d["Text"]

        # Layer 1 countdown events MUST contain \kf100
        assert len(layer_1_events) > 0
        for d in layer_1_events:
            assert "\\kf100" in d["Text"]
            assert "●" in d["Text"]

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
        """Validate first line lead-in cs timing and display_start across boundary values."""
        line = {"id": 0, "start_time": l_start, "end_time": l_start + 3.0, "text": "Hello"}
        ass_str = generate_ass_content([line], sync_mode="line", include_countdown=False)
        d = parse_ass_dialogues(ass_str)[0]

        assert d["Start"] == format_ass_time(expected_display_start)
        assert d["Text"] == expected_tag

    @pytest.mark.parametrize(
        "prev_end,l_start,expected_display_start,expected_lead_in_cs,expected_tag",
        [
            # gap = 0.5s < 2.0s -> display_start = max(5.0, 5.5 - 2.0) = 5.0
            (5.0, 5.5, 5.0, 50, "{\\k50}{\\k0}Second"),
            # gap = 1.0s < 2.0s -> display_start = max(5.0, 6.0 - 2.0) = 5.0
            (5.0, 6.0, 5.0, 100, "{\\k100}{\\k0}Second"),
            # gap = 2.0s == 2.0s -> display_start = max(5.0, 7.0 - 2.0) = 5.0
            (5.0, 7.0, 5.0, 200, "{\\k200}{\\k0}Second"),
            # gap = 3.0s > 2.0s -> display_start = max(5.0, 8.0 - 2.0) = 6.0
            (5.0, 8.0, 6.0, 200, "{\\k200}{\\k0}Second"),
            # gap = 0.0s (adjacent) -> l_start > prev_end is False -> display_start = max(0, 5.0 - 2.0) = 3.0
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
        ass_str = generate_ass_content(lines, sync_mode="line", include_countdown=False)
        dialogues = parse_ass_dialogues(ass_str)
        assert len(dialogues) == 2
        d1 = dialogues[1]

        assert d1["Start"] == format_ass_time(expected_display_start)
        assert d1["Text"] == expected_tag

    def test_duet_countdown_dots_color_cues(self):
        """Instrumental gap countdown cues (Layer 1) must be colored per singer role."""
        lines = [
            {"id": 0, "start_time": 5.0, "end_time": 7.0, "text": "S1 line", "singer": "singer1"},
            {"id": 1, "start_time": 15.0, "end_time": 17.0, "text": "S2 line", "singer": "singer2"},
            {"id": 2, "start_time": 25.0, "end_time": 27.0, "text": "Both line", "singer": "both"},
        ]
        ass_str = generate_ass_content(
            lines,
            sync_mode="line",
            include_countdown=True,
            style_config={
                "singer2_color": "#FF0088",  # ASS: &H008800FF
                "both_color": "#00FFAA",  # ASS: &H00AAFF00
            },
        )
        dialogues = parse_ass_dialogues(ass_str)
        cds = [d for d in dialogues if d.get("Layer") == "1"]
        assert len(cds) == 3

        # Countdown 0: Singer 1 -> no extra color override tag
        assert "{\\c" not in cds[0]["Text"]
        assert "{\\kf100}● {\\kf100}● {\\kf100}●" in cds[0]["Text"]

        # Countdown 1: Singer 2 -> includes {\c&H008800FF&}
        assert "{\\c&H008800FF&}" in cds[1]["Text"]
        assert "{\\kf100}● {\\kf100}● {\\kf100}●" in cds[1]["Text"]

        # Countdown 2: Both -> includes {\c&H00AAFF00&}
        assert "{\\c&H00AAFF00&}" in cds[2]["Text"]
        assert "{\\kf100}● {\\kf100}● {\\kf100}●" in cds[2]["Text"]

    def test_videorenderer_encapsulation_boundaries(self, tmp_path: Path):
        """VideoRenderer method signatures must strictly raise TypeError for invalid direct kwargs."""
        renderer = VideoRenderer(output_dir=tmp_path)
        out_ass = tmp_path / "test_encapsulation.ass"

        # 1. generate_ass_subtitles must reject singer2_color, both_color, font_size_scale
        with pytest.raises(TypeError):
            renderer.generate_ass_subtitles([], out_ass, singer2_color="#ff0080")

        with pytest.raises(TypeError):
            renderer.generate_ass_subtitles([], out_ass, both_color="#00ff80")

        with pytest.raises(TypeError):
            renderer.generate_ass_subtitles([], out_ass, font_size_scale=1.5)

        # 2. generate_ass_content must reject singer2_color, both_color
        with pytest.raises(TypeError):
            renderer.generate_ass_content([], singer2_color="#ff0080")

        with pytest.raises(TypeError):
            renderer.generate_ass_content([], both_color="#00ff80")

        # 3. generate_ass_content must accept font_size_scale and sync_mode cleanly
        content = renderer.generate_ass_content(
            [{"id": 0, "start_time": 1.0, "end_time": 3.0, "text": "Valid call"}],
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
        dialogues = parse_ass_dialogues(ass_str)
        layer_0 = [d for d in dialogues if d.get("Layer") == "0"]
        assert len(layer_0) == 1000
        for d in layer_0:
            assert "\\kf" not in d["Text"]
            assert "None" not in d["Text"]
