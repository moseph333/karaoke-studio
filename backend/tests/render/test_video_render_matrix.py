import os
import subprocess
from pathlib import Path

import pytest

from backend.services.video_renderer import VideoRenderer


@pytest.mark.parametrize(
    "aspect_ratio,include_visualizer,expected_width,expected_height",
    [
        ("16:9", False, 1920, 1080),
        ("16:9", True, 1920, 1080),
        ("9:16", False, 1080, 1920),
        ("9:16", True, 1080, 1920),
    ],
)
def test_video_render_matrix_visualizer_and_aspect_ratios(
    tmp_path, aspect_ratio, include_visualizer, expected_width, expected_height
):
    """
    Challenger 2 Empirical Verification:
    Verify video rendering across full matrix of (16:9, 9:16) x (visualizer=True, False).
    Probes rendered MP4 with ffprobe to verify valid H.264 video, AAC audio, and exact dimensions.
    """
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / f"test_{aspect_ratio.replace(':', '_')}_viz_{include_visualizer}.ass"
    output_mp4 = tmp_path / f"test_{aspect_ratio.replace(':', '_')}_viz_{include_visualizer}.mp4"
    audio_path = tmp_path / f"audio_{aspect_ratio.replace(':', '_')}_viz_{include_visualizer}.wav"

    # Synthesize 1.0s audio WAV with a test tone
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

    sample_lines = [
        {
            "id": 0,
            "text": "Challenger Video Test",
            "start_time": 0.0,
            "end_time": 1.0,
            "words": [
                {"word": "Challenger", "start_time": 0.0, "end_time": 0.5},
                {"word": "Video", "start_time": 0.5, "end_time": 1.0},
            ],
            "singer": "singer1",
        }
    ]

    renderer.generate_ass_subtitles(
        sample_lines,
        output_ass,
        aspect_ratio=aspect_ratio,
        include_countdown=True,
    )

    rendered_path = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        aspect_ratio=aspect_ratio,
        duration=1.0,
        include_visualizer=include_visualizer,
    )

    assert os.path.exists(rendered_path), f"Rendered file {rendered_path} does not exist"
    assert os.path.getsize(rendered_path) > 1000, f"Rendered file {rendered_path} is too small"

    # Probe video stream via ffprobe
    probe_v = (
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name",
                "-of",
                "csv=p=0",
                str(rendered_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .split(",")
    )
    v_codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
    assert v_codec == "h264", f"Expected h264 video codec, got {v_codec}"
    assert width == expected_width, f"Expected width {expected_width}, got {width}"
    assert height == expected_height, f"Expected height {expected_height}, got {height}"

    # Probe audio stream via ffprobe
    probe_a = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "a:0",
            "-show_entries",
            "stream=codec_name",
            "-of",
            "csv=p=0",
            str(rendered_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert probe_a == "aac", f"Expected aac audio codec, got {probe_a}"

    # Probe format_name
    format_name = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=format_name",
            "-of",
            "csv=p=0",
            str(rendered_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert "mp4" in format_name, f"Expected mp4 format, got {format_name}"

    # Probe duration
    duration = float(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                str(rendered_path),
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    )
    assert 0.8 <= duration <= 1.5, f"Expected duration near 1.0s, got {duration}"
