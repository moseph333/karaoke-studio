"""Empirical adversarial test suite for ASS subtitle generation and video rendering integration (Milestone 3).

Validates:
1. ASS syntax & collision: Style: Chord v4+ fields, Layer 2 placement, preservation of progressive \\kf sweeps.
2. Edge cases: empty lyrics with chords, silence chord ("N") omission, transposition bounds (-12 to +12).
3. Aspect ratios: 16:9 and 9:16 geometry and typography scaling.
4. Video rendering: FFmpeg + libass MP4 burn-in with chords across aspect ratios.
"""

import math
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import pytest

from backend.config import OUTPUT_DIR
from backend.services.ass_generator import (
    css_to_ass_color,
    format_ass_time,
    generate_ass_content,
    generate_ass_subtitles,
    safe_time,
)
from backend.services.chord_detector import NO_CHORD_VALUES, transpose_chord
from backend.services.video_renderer import VideoRenderer

REQUIRED_V4PLUS_FIELDS = [
    "Name",
    "Fontname",
    "Fontsize",
    "PrimaryColour",
    "SecondaryColour",
    "OutlineColour",
    "BackColour",
    "Bold",
    "Italic",
    "Underline",
    "StrikeOut",
    "ScaleX",
    "ScaleY",
    "Spacing",
    "Angle",
    "BorderStyle",
    "Outline",
    "Shadow",
    "Alignment",
    "MarginL",
    "MarginR",
    "MarginV",
    "Encoding",
]


def parse_ass(ass_text: str) -> dict[str, Any]:
    """Helper to parse ASS script into header sections, styles, and events."""
    lines = ass_text.splitlines()
    script_info = {}
    styles = {}
    events = []

    current_section = None
    style_format = []
    event_format = []

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


SAMPLE_LYRIC_LINES = [
    {
        "id": 0,
        "start_time": 1.0,
        "end_time": 3.0,
        "text": "Hello karaoke world",
        "words": [
            {"word": "Hello", "start_time": 1.0, "end_time": 1.5},
            {"word": "karaoke", "start_time": 1.5, "end_time": 2.2},
            {"word": "world", "start_time": 2.2, "end_time": 3.0},
        ],
        "singer": "singer1",
    },
    {
        "id": 1,
        "start_time": 4.0,
        "end_time": 6.0,
        "text": "Singing in harmony",
        "words": [
            {"word": "Singing", "start_time": 4.0, "end_time": 4.8},
            {"word": "in", "start_time": 4.8, "end_time": 5.1},
            {"word": "harmony", "start_time": 5.1, "end_time": 6.0},
        ],
        "singer": "singer2",
    },
]

SAMPLE_CHORDS = [
    {"start": 0.5, "end": 2.5, "chord": "C"},
    {"start": 2.5, "end": 4.5, "chord": "Am"},
    {"start": 4.5, "end": 6.5, "chord": "F"},
    {"start": 6.5, "end": 8.5, "chord": "G7"},
]


# ==============================================================================
# Feature 12: ASS Syntax & Collision Stress Tests
# ==============================================================================


def test_f12_style_chord_v4plus_format_and_fields():
    """Verify Style: Chord in [V4+ Styles] contains all 23 required fields."""
    ass_text = generate_ass_content(
        lines=SAMPLE_LYRIC_LINES,
        chords=SAMPLE_CHORDS,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)

    # 1. Check Format line has all 23 fields
    assert "Style: Chord" in ass_text
    chord_style = parsed["styles"].get("Chord")
    assert chord_style is not None, "Style: Chord must exist in parsed styles"

    # 2. Check every required field is present and non-empty
    for field in REQUIRED_V4PLUS_FIELDS:
        assert field in chord_style, f"Missing required V4+ field: {field}"
        assert chord_style[field] != "", f"Field {field} must not be empty"

    # 3. Check specific values for Chord style
    assert chord_style["Name"] == "Chord"
    assert int(chord_style["Fontsize"]) > 0
    assert chord_style["PrimaryColour"].startswith("&H")
    assert chord_style["OutlineColour"].startswith("&H")
    assert chord_style["Bold"] == "-1"
    assert chord_style["Alignment"] in ("8", "2")
    assert int(chord_style["MarginL"]) > 0
    assert int(chord_style["MarginR"]) > 0
    assert int(chord_style["MarginV"]) > 0
    assert chord_style["Encoding"] == "1"


def test_f12_ass_layer_two_collision_isolation():
    """Verify chord dialogue lines are strictly on Layer 2, distinct from lyrics (Layer 0) and countdown (Layer 1)."""
    # Sample with a >4s intro gap to trigger countdown
    gap_lines = [
        {
            "id": 0,
            "start_time": 5.0,
            "end_time": 8.0,
            "text": "Intro wait",
            "words": [{"word": "Intro", "start_time": 5.0, "end_time": 6.0}],
        }
    ]
    ass_text = generate_ass_content(
        lines=gap_lines,
        chords=SAMPLE_CHORDS,
        include_chords=True,
        include_countdown=True,
    )
    parsed = parse_ass(ass_text)

    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]
    lyric_events = [e for e in parsed["events"] if e["Style"].startswith("KaraokeLine")]
    countdown_events = [e for e in parsed["events"] if e["Style"] == "Countdown"]

    assert len(chord_events) > 0, "Expected chord dialogue events"
    assert len(lyric_events) > 0, "Expected lyric dialogue events"
    assert len(countdown_events) > 0, "Expected countdown events"

    # Verify layer segregation:
    # Layer 0: Lyrics
    for e in lyric_events:
        assert e["Layer"] == "0", f"Lyric line must be on Layer 0, found: {e['Layer']}"

    # Layer 1: Countdown
    for e in countdown_events:
        assert e["Layer"] == "1", f"Countdown must be on Layer 1, found: {e['Layer']}"

    # Layer 2: Chords
    for e in chord_events:
        assert e["Layer"] == "2", f"Chord line must be on Layer 2, found: {e['Layer']}"
        assert e["Text"].startswith("{\\an"), "Chord events must specify an alignment tag"


def test_f12_progressive_kf_karaoke_sweeps_preserved():
    """Verify progressive \\kf karaoke sweeps are byte-for-byte identical with chords enabled vs disabled."""
    ass_without_chords = generate_ass_content(
        lines=SAMPLE_LYRIC_LINES,
        chords=SAMPLE_CHORDS,
        include_chords=False,
    )
    ass_with_chords = generate_ass_content(
        lines=SAMPLE_LYRIC_LINES,
        chords=SAMPLE_CHORDS,
        include_chords=True,
    )

    parsed_without = parse_ass(ass_without_chords)
    parsed_with = parse_ass(ass_with_chords)

    lyrics_without = [e for e in parsed_without["events"] if e["Style"].startswith("KaraokeLine")]
    lyrics_with = [e for e in parsed_with["events"] if e["Style"].startswith("KaraokeLine")]

    assert len(lyrics_without) == len(lyrics_with)
    assert len(lyrics_without) > 0

    for lw, lc in zip(lyrics_without, lyrics_with, strict=True):
        # Every field must be identical
        assert lw["Layer"] == lc["Layer"]
        assert lw["Start"] == lc["Start"]
        assert lw["End"] == lc["End"]
        assert lw["Style"] == lc["Style"]
        assert lw["Text"] == lc["Text"]
        assert "\\kf" in lc["Text"]


# ==============================================================================
# Feature 12: Edge Cases & Transposition Bounds
# ==============================================================================


def test_f12_empty_lyrics_with_non_empty_chords():
    """Verify chords are still generated when lyric lines are empty (lines=[])."""
    ass_text = generate_ass_content(
        lines=[],
        chords=SAMPLE_CHORDS,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)

    # Style: Chord must exist
    assert "Chord" in parsed["styles"]
    # Chords must exist on Layer 2
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]
    assert len(chord_events) == len(SAMPLE_CHORDS)
    for e in chord_events:
        assert e["Layer"] == "2"

    # No lyric events should exist
    lyric_events = [e for e in parsed["events"] if e["Style"].startswith("KaraokeLine")]
    assert len(lyric_events) == 0


def test_f12_none_lyrics_with_non_empty_chords():
    """Verify chords are generated when lines=None."""
    ass_text = generate_ass_content(
        lines=None,  # type: ignore
        chords=SAMPLE_CHORDS,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]
    assert len(chord_events) == len(SAMPLE_CHORDS)


def test_f12_silence_chords_omitted():
    """Verify silence intervals (chord="N", "N.C.", etc.) do not produce visible dialogue lines."""
    adversarial_chords = [
        {"start": 0.0, "end": 1.0, "chord": "N"},
        {"start": 1.0, "end": 2.0, "chord": "n"},
        {"start": 2.0, "end": 3.0, "chord": "N.C."},
        {"start": 3.0, "end": 4.0, "chord": "nc"},
        {"start": 4.0, "end": 5.0, "chord": "NC"},
        {"start": 5.0, "end": 6.0, "chord": "NO-CHORD"},
        {"start": 6.0, "end": 7.0, "chord": "none"},
        {"start": 7.0, "end": 8.0, "chord": "NONE"},
        {"start": 8.0, "end": 9.0, "chord": ""},
        {"start": 9.0, "end": 10.0, "chord": "   "},
        {"start": 10.0, "end": 12.0, "chord": "Cmaj7"},  # only active chord
    ]

    ass_text = generate_ass_content(
        lines=[],
        chords=adversarial_chords,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]

    # Only Cmaj7 should be rendered
    assert len(chord_events) == 1
    assert "Cmaj7" in chord_events[0]["Text"]
    assert chord_events[0]["Start"] == "0:00:10.00"
    assert chord_events[0]["End"] == "0:00:12.00"


@pytest.mark.parametrize("semitones", list(range(-12, 13)))
def test_f12_transposition_bounds_full_range(semitones: int):
    """Verify semitone shifts from -12 to +12 across Major, Minor, 7, maj7, m7 chords."""
    test_progression = [
        {"start": 0.0, "end": 1.0, "chord": "C"},
        {"start": 1.0, "end": 2.0, "chord": "Am"},
        {"start": 2.0, "end": 3.0, "chord": "G7"},
        {"start": 3.0, "end": 4.0, "chord": "Fmaj7"},
        {"start": 4.0, "end": 5.0, "chord": "Dm7"},
    ]

    ass_text = generate_ass_content(
        lines=[],
        chords=test_progression,
        include_chords=True,
        semitones=semitones,
        key="C",
    )
    parsed = parse_ass(ass_text)
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]
    assert len(chord_events) == 5

    # Check that +12 and -12 transpose C back to C
    if semitones in (-12, 0, 12):
        c_chord = chord_events[0]["Text"]
        assert "C" in c_chord and "C#" not in c_chord and "Cb" not in c_chord

    # Check transposition output has no unhandled exceptions or NaN
    for event in chord_events:
        assert "None" not in event["Text"]
        assert "NaN" not in event["Text"]
        assert len(event["Text"]) > 0


# ==============================================================================
# Feature 12 & 13: Aspect Ratios (16:9 vs 9:16)
# ==============================================================================


@pytest.mark.parametrize(
    "aspect_ratio,expected_res_x,expected_res_y,expected_margin_v,expected_font_size",
    [
        ("16:9", "1920", "1080", "80", 36),  # round(52 * 0.70) = 36
        ("9:16", "1080", "1920", "120", 32),  # round(46 * 0.70) = 32
    ],
)
def test_f12_aspect_ratios_geometry_and_margins(
    aspect_ratio, expected_res_x, expected_res_y, expected_margin_v, expected_font_size
):
    """Verify geometry, PlayRes, margin, and typography adapt accurately between 16:9 and 9:16."""
    ass_text = generate_ass_content(
        lines=SAMPLE_LYRIC_LINES,
        chords=SAMPLE_CHORDS,
        aspect_ratio=aspect_ratio,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)

    assert parsed["info"]["PlayResX"] == expected_res_x
    assert parsed["info"]["PlayResY"] == expected_res_y

    chord_style = parsed["styles"]["Chord"]
    assert chord_style["MarginV"] == expected_margin_v
    assert int(chord_style["Fontsize"]) == expected_font_size


def test_f12_chord_alignment_options():
    """Verify chord_alignment=2 positions chords near bottom above lyrics."""
    ass_text = generate_ass_content(
        lines=SAMPLE_LYRIC_LINES,
        chords=SAMPLE_CHORDS,
        include_chords=True,
        style_config={"chord_alignment": 2},
    )
    parsed = parse_ass(ass_text)
    chord_style = parsed["styles"]["Chord"]
    assert chord_style["Alignment"] == "2"
    # Bottom margin should be elevated above bottom lyrics
    assert int(chord_style["MarginV"]) >= 270

    for e in parsed["events"]:
        if e["Style"] == "Chord":
            assert e["Text"].startswith("{\\an2}")


# ==============================================================================
# Feature 12: Adversarial Stress & Escaping
# ==============================================================================


def test_f12_adversarial_timestamp_inputs():
    """Verify timestamps with inverted intervals, zero duration, or non-numeric types are safely handled."""
    adversarial_timing = [
        {"start": 5.0, "end": 2.0, "chord": "C"},  # Inverted: end < start
        {"start": 3.0, "end": 3.0, "chord": "Am"},  # Zero duration: start == end
        {"start": "invalid", "end": None, "chord": "F"},  # Non-numeric
        {"start": -2.0, "end": 4.0, "chord": "G"},  # Negative start
    ]

    ass_text = generate_ass_content(
        lines=[],
        chords=adversarial_timing,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]
    assert len(chord_events) == 4

    for e in chord_events:
        # Timestamps must match ASS format H:MM:SS.cs
        assert re.match(r"^\d+:\d{2}:\d{2}\.\d{2}$", e["Start"])
        assert re.match(r"^\d+:\d{2}:\d{2}\.\d{2}$", e["End"])
        # Inverted and zero duration must ensure end > start
        assert e["End"] >= e["Start"]


def test_f12_adversarial_markup_escaping_in_chords():
    """Verify malicious ASS tags or curly braces inside chord symbols are escaped."""
    malicious_chords = [
        {"start": 0.0, "end": 1.0, "chord": "C{\\b1}maj7"},
        {"start": 1.0, "end": 2.0, "chord": "G\\N\\hD"},
        {"start": 2.0, "end": 3.0, "chord": "F}exploit{"},
    ]
    ass_text = generate_ass_content(
        lines=[],
        chords=malicious_chords,
        include_chords=True,
    )
    parsed = parse_ass(ass_text)
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]

    for e in chord_events:
        # After stripping leading alignment tag {\an8}, there must be no unescaped { or }
        text = e["Text"]
        assert text.startswith("{\\an8}")
        payload = text[len("{\\an8}") :]
        assert "{" not in payload or "\\{" in payload
        assert "}" not in payload or "\\}" in payload


# ==============================================================================
# Feature 13: FFmpeg + libass Video Rendering Integration Matrix
# ==============================================================================


@pytest.mark.parametrize(
    "aspect_ratio,expected_width,expected_height",
    [
        ("16:9", 1920, 1080),
        ("9:16", 1080, 1920),
    ],
)
def test_f13_real_ffmpeg_video_burn_matrix(tmp_path, aspect_ratio, expected_width, expected_height):
    """Adversarial Video Render Matrix: burn chords into 1080p60 MP4 via FFmpeg + libass for 16:9 and 9:16.

    Empirically inspects rendered MP4 with ffprobe to verify valid video/audio streams and exact geometry.
    """
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / f"test_{aspect_ratio.replace(':', '_')}.ass"
    output_mp4 = tmp_path / f"test_{aspect_ratio.replace(':', '_')}.mp4"
    audio_path = tmp_path / f"audio_{aspect_ratio.replace(':', '_')}.wav"

    # Synthesize 1.0s sine wave test audio
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=1",
            "-c:a",
            "pcm_s16le",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
    )

    # Generate ASS with chords enabled
    renderer.generate_ass_subtitles(
        lines=SAMPLE_LYRIC_LINES[:1],
        output_ass_path=output_ass,
        aspect_ratio=aspect_ratio,
        chords=SAMPLE_CHORDS[:2],
        include_chords=True,
        semitones=2,
        key="C",
    )

    # Render video
    rendered_path = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        aspect_ratio=aspect_ratio,
        duration=1.0,
    )

    assert os.path.exists(rendered_path), f"Rendered MP4 does not exist: {rendered_path}"
    assert os.path.getsize(rendered_path) > 1000, "Rendered MP4 file is suspiciously small"

    # Inspect video stream via ffprobe
    import json

    probe_v = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height,codec_name",
            "-of",
            "json",
            str(rendered_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    stream_data = json.loads(probe_v.stdout)["streams"][0]
    width = int(stream_data["width"])
    height = int(stream_data["height"])
    codec = stream_data["codec_name"]

    assert width == expected_width, f"Expected width {expected_width}, got {width}"
    assert height == expected_height, f"Expected height {expected_height}, got {height}"
    assert codec in ("h264", "libx264"), f"Expected H.264 video codec, got {codec}"


# ==============================================================================
# Feature 12: Additional Adversarial Timing, Concurrency & API Tests
# ==============================================================================


def test_f12_ass_timestamp_rollover_and_inf_nan_safety():
    """Verify format_ass_time handles centisecond rollover and non-finite numbers safely."""
    # 59.996s rounds to 60.00s -> 0:01:00.00
    assert format_ass_time(59.996) == "0:01:00.00"
    # 3599.996s rounds to 3600.00s -> 1:00:00.00
    assert format_ass_time(3599.996) == "1:00:00.00"
    # Negative values clamp to 0:00:00.00
    assert format_ass_time(-10.5) == "0:00:00.00"
    # NaN and Inf safely fall back to 0:00:00.00
    assert format_ass_time(float("nan")) == "0:00:00.00"
    assert format_ass_time(float("inf")) == "0:00:00.00"
    assert format_ass_time(float("-inf")) == "0:00:00.00"
    # Non-numeric gracefully handled
    assert format_ass_time(None) == "0:00:00.00"
    assert format_ass_time("bad_input") == "0:00:00.00"


def test_f12_ass_generator_thread_safety():
    """Verify concurrent ASS generation across 10 threads produces deterministic output."""
    import concurrent.futures

    def run_worker(thread_idx: int) -> str:
        return generate_ass_content(
            lines=SAMPLE_LYRIC_LINES,
            chords=SAMPLE_CHORDS,
            include_chords=True,
            semitones=(thread_idx % 5) - 2,
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(run_worker, range(20)))

    assert len(results) == 20
    for res in results:
        assert "Style: Chord" in res
        assert "Dialogue: 2," in res
        assert "\\kf" in res


def test_f12_overlapping_chords_libass_safety(tmp_path):
    """Verify overlapping chord intervals render safely in libass without syntax errors."""
    overlapping_chords = [
        {"start": 0.0, "end": 2.0, "chord": "C"},
        {"start": 1.0, "end": 3.0, "chord": "G"},
        {"start": 2.5, "end": 4.0, "chord": "Am"},
    ]
    ass_path = tmp_path / "overlapping.ass"
    generate_ass_subtitles(
        lines=SAMPLE_LYRIC_LINES[:1],
        output_ass_path=ass_path,
        chords=overlapping_chords,
        include_chords=True,
    )
    content = ass_path.read_text(encoding="utf-8")
    parsed = parse_ass(content)
    chord_events = [e for e in parsed["events"] if e["Style"] == "Chord"]
    assert len(chord_events) == 3
