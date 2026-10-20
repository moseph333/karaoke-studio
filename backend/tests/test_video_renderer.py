import os
import subprocess
import threading
from pathlib import Path

import pytest

from backend.services.video_renderer import VideoRenderer


def test_generate_ass_subtitles(tmp_path):
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "test_karaoke.ass"

    sample_lines = [
        {
            "id": 0,
            "text": "Sing along to this song",
            "start_time": 4.0,
            "end_time": 7.0,
            "words": [
                {"word": "Sing", "start_time": 4.0, "end_time": 4.8},
                {"word": "along", "start_time": 4.8, "end_time": 5.5},
                {"word": "to", "start_time": 5.5, "end_time": 6.0},
                {"word": "this", "start_time": 6.0, "end_time": 6.4},
                {"word": "song", "start_time": 6.4, "end_time": 7.0},
            ],
        },
        {
            "id": 1,
            "text": "Second line starts here",
            "start_time": 12.0,  # Gap > 3.5s => triggers countdown dots
            "end_time": 15.0,
            "words": [
                {"word": "Second", "start_time": 12.0, "end_time": 12.8},
                {"word": "line", "start_time": 12.8, "end_time": 13.5},
                {"word": "starts", "start_time": 13.5, "end_time": 14.2},
                {"word": "here", "start_time": 14.2, "end_time": 15.0},
            ],
        },
    ]

    ass_path = renderer.generate_ass_subtitles(sample_lines, output_ass)
    assert os.path.exists(ass_path)

    content = output_ass.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    assert "PlayResX: 1920" in content
    assert "PlayResY: 1080" in content
    assert "Style: KaraokeLine1" in content
    assert "Style: Countdown" in content

    # Check for progressive karaoke wipe tag \kf
    assert "\\kf" in content
    # Check for countdown dots
    assert "Countdown" in content
    assert "●" in content


def test_cancel_endpoints(client):
    import threading

    from backend.main import active_cancellations, projects

    # Test pipeline cancel
    proj_id = "test_cancel_proj"
    cancel_evt = threading.Event()
    active_cancellations[proj_id] = cancel_evt
    projects[proj_id] = {"id": proj_id, "status": "separating", "progress": 40, "lines": []}

    res = client.post(f"/api/project/{proj_id}/cancel")
    assert res.status_code == 200
    assert cancel_evt.is_set()
    assert projects[proj_id]["status"] == "cancelled"

    # Test render cancel
    render_key = f"{proj_id}_render"
    render_cancel_evt = threading.Event()
    active_cancellations[render_key] = render_cancel_evt
    projects[proj_id]["render_status"] = "rendering"

    res_render = client.post(f"/api/project/{proj_id}/cancel-render")
    assert res_render.status_code == 200
    assert render_cancel_evt.is_set()
    assert projects[proj_id]["render_status"] == "idle"


def test_render_video_drains_stderr_without_deadlock(tmp_path):
    import wave

    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "test.ass"
    output_mp4 = tmp_path / "test.mp4"
    audio_path = tmp_path / "test.wav"

    # Generate a short 1-second dummy audio wav
    with wave.open(str(audio_path), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        wf.writeframes(b"\x00" * (44100 * 4))

    output_ass.write_text(
        "[Script Info]\n"
        "Title: Test\n"
        "ScriptType: v4.00+\n"
        "PlayResX: 1920\n"
        "PlayResY: 1080\n\n"
        "[V4+ Styles]\n"
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n"
        "Style: Default,Montserrat,52,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,1,0,1,3,2,2,80,80,200,1\n\n"
        "[Events]\n"
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n"
        "Dialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,{\\kf100}Test\n",
        encoding="utf-8",
    )

    progress_reports = []

    def on_progress(pct, detail, eta):
        progress_reports.append((pct, detail, eta))

    rendered = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        duration=1.0,
        progress_callback=on_progress,
    )

    assert os.path.exists(rendered)
    assert len(progress_reports) > 0


def test_generate_ass_subtitles_vertical_9_16(tmp_path):
    """9:16 vertical aspect ratio generates 1080x1920 canvas with adjusted vertical margins."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "vertical.ass"

    sample_lines = [
        {
            "id": 0,
            "text": "Vertical video line",
            "start_time": 1.0,
            "end_time": 4.0,
            "words": [
                {"word": "Vertical", "start_time": 1.0, "end_time": 2.0},
                {"word": "video", "start_time": 2.0, "end_time": 3.0},
                {"word": "line", "start_time": 3.0, "end_time": 4.0},
            ],
        }
    ]

    ass_path = renderer.generate_ass_subtitles(sample_lines, output_ass, aspect_ratio="9:16")
    assert os.path.exists(ass_path)
    content = output_ass.read_text(encoding="utf-8")

    assert "PlayResX: 1080" in content
    assert "PlayResY: 1920" in content
    assert "PlayResX: 1920" not in content

    # Verify elevated vertical margins for mobile UI clearance
    assert "Style: KaraokeLine1" in content
    assert ",60,60,640,1" in content
    assert "Style: KaraokeLine2" in content
    assert ",60,60,500,1" in content
    assert "Style: Countdown" in content
    assert ",60,60,780,1" in content


def test_generate_ass_subtitles_escapes_special_characters(tmp_path):
    """Special ASS characters ({, }, \\) inside lyrics are escaped to prevent tag corruption."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "escaped.ass"

    adversarial_lines = [
        {
            "id": 0,
            "text": "Testing {override} \\N and AC\\DC",
            "start_time": 1.0,
            "end_time": 4.0,
            "words": [
                {"word": "Testing", "start_time": 1.0, "end_time": 2.0},
                {"word": "{override}", "start_time": 2.0, "end_time": 2.5},
                {"word": "\\N", "start_time": 2.5, "end_time": 3.0},
                {"word": "AC\\DC", "start_time": 3.0, "end_time": 4.0},
            ],
        }
    ]

    renderer.generate_ass_subtitles(adversarial_lines, output_ass)
    content = output_ass.read_text(encoding="utf-8")

    # Curly braces must be escaped so libass does not treat them as override tags
    assert "\\{override\\}" in content
    # Backslashes must be escaped so libass does not interpret \\N as a newline
    assert "\\\\N" in content
    assert "AC\\\\DC" in content
    # Standard karaoke sweep tag must still be valid unescaped braces
    assert "{\\kf" in content


def test_generate_ass_subtitles_overlapping_lines_timing(tmp_path):
    """Overlapping lyric lines maintain non-negative lead-in duration and valid display intervals."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "overlap.ass"

    overlapping_lines = [
        {
            "id": 0,
            "text": "First line",
            "start_time": 2.0,
            "end_time": 5.0,
            "words": [
                {"word": "First", "start_time": 2.0, "end_time": 3.5},
                {"word": "line", "start_time": 3.5, "end_time": 5.0},
            ],
        },
        {
            "id": 1,
            "text": "Second overlapping line",
            "start_time": 4.0,  # Starts before line 0 finishes
            "end_time": 7.0,
            "words": [
                {"word": "Second", "start_time": 4.0, "end_time": 5.5},
                {"word": "overlapping", "start_time": 5.5, "end_time": 6.5},
                {"word": "line", "start_time": 6.5, "end_time": 7.0},
            ],
        },
    ]

    renderer.generate_ass_subtitles(overlapping_lines, output_ass)
    content = output_ass.read_text(encoding="utf-8")

    dialogue_events = [line for line in content.splitlines() if line.startswith("Dialogue: 0,")]
    assert len(dialogue_events) == 2

    # Second line dialogue format: Dialogue: 0,Start,End,Style,...
    line2_parts = dialogue_events[1].split(",")
    start_time_str = line2_parts[1]
    # display_start must not be later than line start (4.0s = 0:00:04.00)
    assert start_time_str <= "0:00:04.00"

    # Confirm no negative delay tags exist anywhere in output
    assert "{\\k-" not in content
    assert "\\k-" not in content


def test_generate_ass_subtitles_empty_words_fallback(tmp_path):
    """Line with text but no word breakdowns generates valid line-level sweep without crashing."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "fallback.ass"

    lines = [
        {
            "id": 0,
            "text": "Full line without words",
            "start_time": 1.0,
            "end_time": 3.0,
            "words": [],
        }
    ]

    renderer.generate_ass_subtitles(lines, output_ass)
    content = output_ass.read_text(encoding="utf-8")
    assert "Full line without words" in content
    assert "{\\kf200}" in content


def test_render_video_subprocess_cleanup_on_exception(tmp_path, monkeypatch):
    """FFmpeg subprocess is terminated in finally block even when cancel_event is unset."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "test.ass"
    output_mp4 = tmp_path / "test.mp4"
    audio_path = tmp_path / "test.wav"
    output_ass.write_text("[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n", encoding="utf-8")
    audio_path.write_bytes(
        b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    )

    class MockProcess:
        def __init__(self):
            self.stdout = ["progress=continue\n"]
            self.stderr = []
            self.returncode = None
            self.terminated = False
            self.killed = False

        def poll(self):
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.returncode = -15

        def kill(self):
            self.killed = True
            self.returncode = -9

        def wait(self, timeout=None):
            return self.returncode

    mock_proc = MockProcess()
    monkeypatch.setattr("subprocess.Popen", lambda *args, **kwargs: mock_proc)

    def crashing_callback(pct, detail, eta):
        raise ValueError("Simulated callback crash during rendering")

    with pytest.raises(ValueError, match="Simulated callback crash"):
        renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(output_ass),
            output_mp4_path=output_mp4,
            duration=1.0,
            progress_callback=crashing_callback,
        )

    # Process must have been terminated despite cancel_event being None
    assert mock_proc.terminated is True


def test_render_video_subprocess_cleanup_on_cancellation(tmp_path, monkeypatch):
    """When cancel_event is flagged, FFmpeg subprocess is promptly terminated."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "test.ass"
    output_mp4 = tmp_path / "test.mp4"
    audio_path = tmp_path / "test.wav"
    output_ass.write_text("[Script Info]\nPlayResX: 1920\nPlayResY: 1080\n", encoding="utf-8")
    audio_path.write_bytes(
        b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    )

    cancel_evt = threading.Event()
    cancel_evt.set()

    class MockProcess:
        def __init__(self):
            self.stdout = ["frame=1\n"]
            self.stderr = []
            self.returncode = None
            self.terminated = False

        def poll(self):
            return self.returncode

        def terminate(self):
            self.terminated = True
            self.returncode = -15

        def kill(self):
            self.returncode = -9

        def wait(self, timeout=None):
            return self.returncode

    mock_proc = MockProcess()
    monkeypatch.setattr("subprocess.Popen", lambda *args, **kwargs: mock_proc)

    with pytest.raises(RuntimeError, match="Video rendering was cancelled by user"):
        renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(output_ass),
            output_mp4_path=output_mp4,
            duration=1.0,
            cancel_event=cancel_evt,
        )

    assert mock_proc.terminated is True


def test_escape_ass_text_sanitizes_literal_newlines():
    """Verifies VideoRenderer._escape_ass_text sanitizes \\r\\n, \\n, and \\r into single spaces."""
    escaped = VideoRenderer._escape_ass_text("Line 1\r\nLine 2\nLine 3\rLine 4")
    assert escaped == "Line 1 Line 2 Line 3 Line 4"
    assert "\n" not in escaped
    assert "\r" not in escaped


def test_generate_ass_subtitles_embedded_newlines_stay_on_single_dialogue_line(tmp_path):
    """Verifies lyric lines with embedded newlines (\\r\\n, \\n, \\r) are sanitized and stay on a single Dialogue line."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "newlines.ass"

    multiline_lyrics = [
        {
            "id": 0,
            "text": "Verse Line 1\r\nVerse Line 2\nVerse Line 3\rVerse Line 4",
            "start_time": 1.0,
            "end_time": 5.0,
            "words": [
                {"word": "Verse\r\nLine 1", "start_time": 1.0, "end_time": 2.0},
                {"word": "Verse\nLine 2", "start_time": 2.0, "end_time": 3.0},
                {"word": "Verse\rLine 3", "start_time": 3.0, "end_time": 4.0},
                {"word": "Verse 4", "start_time": 4.0, "end_time": 5.0},
            ],
        },
        {
            "id": 1,
            "text": "Plain line\r\nwith embedded\nnewlines",
            "start_time": 6.0,
            "end_time": 9.0,
            "words": [],
        },
    ]

    renderer.generate_ass_subtitles(multiline_lyrics, output_ass)
    content = output_ass.read_text(encoding="utf-8")
    lines = content.splitlines()

    dialogue_lines = [line for line in lines if line.startswith("Dialogue:")]
    assert len(dialogue_lines) == 2

    for d_line in dialogue_lines:
        assert "\r" not in d_line
        assert "\n" not in d_line

    # Word-level: verified individual words sanitized without splitting lines
    assert "Verse Line 1" in dialogue_lines[0]
    assert "Verse Line 2" in dialogue_lines[0]
    assert "Verse Line 3" in dialogue_lines[0]

    # Line-level fallback: verified entire text sanitized into single line
    assert "Plain line with embedded newlines" in dialogue_lines[1]

    events_section = False
    for line in lines:
        if line.strip() == "[Events]":
            events_section = True
            continue
        if (
            events_section
            and line.strip()
            and not line.startswith("Format:")
            and not line.startswith("Comment:")
        ):
            assert line.startswith("Dialogue:"), (
                f"Invalid un-prefixed line found in ASS [Events]: {line!r}"
            )


def test_aspect_ratio_fallback_consistency(tmp_path, monkeypatch):
    """Verifies non-standard aspect ratios consistently fall back to 1920x1080 across subtitles and video render."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "ar_test.ass"
    output_mp4 = tmp_path / "ar_test.mp4"
    audio_path = tmp_path / "ar_test.wav"
    audio_path.write_bytes(
        b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00\x88X\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00"
    )

    recorded_cmds = []

    class MockProcess:
        def __init__(self, cmd):
            self.cmd = cmd
            recorded_cmds.append(cmd)
            self.stdout = []
            self.stderr = []
            self.returncode = 0

        def poll(self):
            return 0

        def terminate(self):
            pass

        def kill(self):
            pass

        def wait(self, timeout=None):
            return 0

    monkeypatch.setattr("subprocess.Popen", lambda cmd, *args, **kwargs: MockProcess(cmd))

    test_ratios = ["4:3", "1:1", "", "unsupported", "custom"]

    for ratio in test_ratios:
        # Check generate_ass_subtitles dimensions
        renderer.generate_ass_subtitles([], output_ass, aspect_ratio=ratio)
        content = output_ass.read_text(encoding="utf-8")
        assert "PlayResX: 1920" in content, f"Failed for aspect_ratio={ratio!r}"
        assert "PlayResY: 1080" in content, f"Failed for aspect_ratio={ratio!r}"

        # Check render_video dimensions
        renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(output_ass),
            output_mp4_path=output_mp4,
            aspect_ratio=ratio,
            duration=1.0,
        )

        last_cmd = recorded_cmds[-1]
        filter_str = " ".join(last_cmd)
        assert "s=1920x1080" in filter_str, (
            f"render_video did not use 1920x1080 canvas for aspect_ratio={ratio!r}"
        )

    # In contrast, aspect_ratio="9:16" uses 1080x1920 in both
    renderer.generate_ass_subtitles([], output_ass, aspect_ratio="9:16")
    v_content = output_ass.read_text(encoding="utf-8")
    assert "PlayResX: 1080" in v_content
    assert "PlayResY: 1920" in v_content

    renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        aspect_ratio="9:16",
        duration=1.0,
    )
    v_cmd = recorded_cmds[-1]
    assert "s=1080x1920" in " ".join(v_cmd)


def test_render_video_with_custom_mp4_background_16_9(tmp_path):
    """
    Renders 16:9 MP4 video with looped custom MP4 background and burned-in subtitles.
    Probes output with ffprobe to verify 1920x1080 dimensions, h264/aac codecs, and duration.
    """
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "test_16_9.ass"
    output_mp4 = tmp_path / "test_16_9.mp4"
    audio_path = tmp_path / "test_16_9.wav"
    custom_bg = tmp_path / "bg.mp4"

    # Create 1.0s background MP4 video with an audio stream (verifies bg audio is ignored)
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=640x360:rate=10",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=1000:duration=1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            str(custom_bg),
        ],
        check=True,
        capture_output=True,
    )

    # Create 2.0s audio WAV
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
    )

    renderer.generate_ass_subtitles(
        [
            {
                "id": 0,
                "text": "16:9 Looped MP4 Background",
                "start_time": 0.0,
                "end_time": 2.0,
                "words": [{"word": "16:9", "start_time": 0.0, "end_time": 1.0}],
            }
        ],
        output_ass,
        aspect_ratio="16:9",
    )

    rendered_path = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        custom_bg_path=str(custom_bg),
        aspect_ratio="16:9",
        duration=2.0,
    )

    assert os.path.exists(rendered_path)

    # Probe video stream
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
                rendered_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .split(",")
    )
    codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
    assert codec == "h264"
    assert width == 1920
    assert height == 1080

    # Probe audio stream
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
            rendered_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert probe_a == "aac"

    # Probe duration (should be ~2.0s, showing loop of 1s video)
    probe_d = float(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                rendered_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    )
    assert 1.8 <= probe_d <= 2.2


def test_render_video_with_custom_webm_background_9_16(tmp_path):
    """
    Renders 9:16 vertical video with looped custom WebM background.
    Probes output with ffprobe to verify 1080x1920 dimensions, h264/aac codecs, and duration.
    """
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "test_9_16.ass"
    output_mp4 = tmp_path / "test_9_16.mp4"
    audio_path = tmp_path / "test_9_16.wav"
    custom_bg = tmp_path / "bg.webm"

    # Create 1.0s background WebM video
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=360x640:rate=10",
            "-c:v",
            "libvpx",
            "-b:v",
            "500k",
            str(custom_bg),
        ],
        check=True,
        capture_output=True,
    )

    # Create 2.0s audio WAV
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=2",
            str(audio_path),
        ],
        check=True,
        capture_output=True,
    )

    renderer.generate_ass_subtitles(
        [
            {
                "id": 0,
                "text": "9:16 Looped WebM Background",
                "start_time": 0.0,
                "end_time": 2.0,
                "words": [{"word": "9:16", "start_time": 0.0, "end_time": 1.0}],
            }
        ],
        output_ass,
        aspect_ratio="9:16",
    )

    rendered_path = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        custom_bg_path=str(custom_bg),
        aspect_ratio="9:16",
        duration=2.0,
    )

    assert os.path.exists(rendered_path)

    # Probe video stream
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
                rendered_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .split(",")
    )
    codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
    assert codec == "h264"
    assert width == 1080
    assert height == 1920

    # Probe audio stream
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
            rendered_path,
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.strip()
    assert probe_a == "aac"

    # Probe duration
    probe_d = float(
        subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                rendered_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    )
    assert 1.8 <= probe_d <= 2.2


def test_visual_themes_centralization():
    """VISUAL_THEMES dictionary contains all 4 supported themes with correct BGR hex colors."""
    from backend.services.video_renderer import VISUAL_THEMES

    assert "modern_gold" in VISUAL_THEMES
    assert "cyber_cyan" in VISUAL_THEMES
    assert "neon_pink" in VISUAL_THEMES
    assert "classic_ktv" in VISUAL_THEMES

    assert VISUAL_THEMES["modern_gold"]["primary_color"] == "&H0000D7FF"
    assert VISUAL_THEMES["cyber_cyan"]["primary_color"] == "&H00FFFF00"
    assert VISUAL_THEMES["neon_pink"]["primary_color"] == "&H00B300FF"
    assert VISUAL_THEMES["classic_ktv"]["primary_color"] == "&H0000FFFF"


def test_generate_ass_content_direct_string_return():
    """generate_ass_content returns valid ASS document string in memory without writing to disk."""
    renderer = VideoRenderer()
    sample_lines = [
        {
            "id": 0,
            "text": "Singing direct in memory",
            "start_time": 1.0,
            "end_time": 4.0,
            "words": [
                {"word": "Singing", "start_time": 1.0, "end_time": 2.0},
                {"word": "direct", "start_time": 2.0, "end_time": 3.0},
                {"word": "in", "start_time": 3.0, "end_time": 3.5},
                {"word": "memory", "start_time": 3.5, "end_time": 4.0},
            ],
        }
    ]

    content = renderer.generate_ass_content(sample_lines, title="Memory Anthem")
    assert isinstance(content, str)
    assert "[Script Info]" in content
    assert "Title: Memory Anthem" in content
    assert "PlayResX: 1920" in content
    assert "PlayResY: 1080" in content
    assert "Style: KaraokeLine1" in content
    assert "\\kf" in content
    assert "Singing" in content


@pytest.mark.parametrize(
    "aspect_ratio,expected_res_x,expected_res_y,expected_margin_v1",
    [
        ("16:9", "PlayResX: 1920", "PlayResY: 1080", ",80,80,200,1"),
        ("9:16", "PlayResX: 1080", "PlayResY: 1920", ",60,60,640,1"),
    ],
)
def test_generate_ass_content_aspect_ratios(
    aspect_ratio, expected_res_x, expected_res_y, expected_margin_v1
):
    """generate_ass_content applies correct canvas resolution and margins for 16:9 and 9:16."""
    renderer = VideoRenderer()
    content = renderer.generate_ass_content([], aspect_ratio=aspect_ratio)
    assert expected_res_x in content
    assert expected_res_y in content
    assert expected_margin_v1 in content


@pytest.mark.parametrize(
    "theme_id,expected_sung_color",
    [
        ("modern_gold", "&H0000D7FF"),
        ("cyber_cyan", "&H00FFFF00"),
        ("neon_pink", "&H00B300FF"),
        ("classic_ktv", "&H0000FFFF"),
    ],
)
def test_generate_ass_content_visual_themes(theme_id, expected_sung_color):
    """generate_ass_content propagates theme preset colors to KaraokeLine1 and KaraokeLine2 styles."""
    renderer = VideoRenderer()
    content = renderer.generate_ass_content([], theme_id=theme_id)
    assert f",{expected_sung_color},&H00FFFFFF," in content


def test_generate_ass_content_color_overrides():
    """Explicit primary_color and secondary_color override preset theme colors."""
    renderer = VideoRenderer()
    content = renderer.generate_ass_content(
        [],
        theme_id="modern_gold",
        primary_color="&H00123456",
        secondary_color="&H00654321",
    )
    assert ",&H00123456,&H00654321," in content
    assert "&H0000D7FF" not in content


def test_generate_ass_subtitles_delegation_to_generate_ass_content(tmp_path):
    """generate_ass_subtitles delegates to generate_ass_content and writes output to file."""
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "delegated.ass"
    sample_lines = [{"id": 0, "text": "Test line", "start_time": 1.0, "end_time": 2.0, "words": []}]

    res_path = renderer.generate_ass_subtitles(sample_lines, output_ass, theme_id="cyber_cyan")
    assert res_path == str(output_ass)
    assert output_ass.is_file()
    assert "&H00FFFF00" in output_ass.read_text(encoding="utf-8")


def test_format_ass_time_centisecond_rollover_precision():
    """_format_ass_time rolls 100 centiseconds into seconds and minutes without clamping to .99."""
    # 59.996s -> 100 centiseconds -> 0:01:00.00 (NOT 0:00:59.99)
    assert VideoRenderer._format_ass_time(59.996) == "0:01:00.00"
    # 119.996s -> 0:02:00.00
    assert VideoRenderer._format_ass_time(119.996) == "0:02:00.00"
    # 3599.996s -> 1:00:00.00
    assert VideoRenderer._format_ass_time(3599.996) == "1:00:00.00"
    # 0.999s -> 0:00:01.00
    assert VideoRenderer._format_ass_time(0.999) == "0:00:01.00"
    # 0.994s -> 0:00:00.99
    assert VideoRenderer._format_ass_time(0.994) == "0:00:00.99"


def test_format_ass_time_boundary_and_negative_clamping():
    """_format_ass_time safely handles negative, NaN, Inf, and non-numeric inputs."""
    assert VideoRenderer._format_ass_time(-0.5) == "0:00:00.00"
    assert VideoRenderer._format_ass_time(-100.0) == "0:00:00.00"
    assert VideoRenderer._format_ass_time(float("nan")) == "0:00:00.00"
    assert VideoRenderer._format_ass_time(float("inf")) == "0:00:00.00"
    assert VideoRenderer._format_ass_time(float("-inf")) == "0:00:00.00"
    assert VideoRenderer._format_ass_time(None) == "0:00:00.00"  # type: ignore[arg-type]
    assert VideoRenderer._format_ass_time("invalid") == "0:00:00.00"  # type: ignore[arg-type]


def test_format_ass_time_100_plus_minute_tracks():
    """_format_ass_time formats long durations into correct H:MM:SS.cs."""
    # 6000.0s = 100 minutes = 1h 40m 00s
    assert VideoRenderer._format_ass_time(6000.0) == "1:40:00.00"
    # 7530.5s = 125m 30.5s = 2h 05m 30.5s
    assert VideoRenderer._format_ass_time(7530.5) == "2:05:30.50"


def test_generate_ass_content_timestamp_resilience():
    """generate_ass_content safely handles None, NaN, Inf, and negative timestamps without crashing."""
    vr = VideoRenderer()
    corrupted_lines = [
        {
            "id": 0,
            "text": "Line with None start",
            "start_time": None,
            "end_time": 2.0,
            "words": [{"word": "None", "start_time": None, "end_time": 1.0}],
        },
        {
            "id": 1,
            "text": "Line with NaN and Inf",
            "start_time": float("nan"),
            "end_time": float("inf"),
            "words": [{"word": "NaN", "start_time": float("nan"), "end_time": float("nan")}],
        },
        {
            "id": 2,
            "text": "Line with negative times",
            "start_time": -5.0,
            "end_time": -2.0,
            "words": [],
        },
        {
            "id": 3,
            "text": "Line with string invalid times",
            "start_time": "invalid",
            "end_time": "corrupt",
            "words": [],
        },
    ]
    # Must not raise TypeError or ValueError
    ass = vr.generate_ass_content(corrupted_lines)
    assert "[Script Info]" in ass
    assert "[Events]" in ass
    assert "Dialogue: 0," in ass
    assert "None" in ass
    assert "NaN" in ass
    assert "Line with negative times" in ass
    assert "Line with string invalid times" in ass


def test_generate_ass_content_100_plus_minute_track():
    """generate_ass_content generates valid dialogue event timestamps for 100+ minute tracks."""
    vr = VideoRenderer()
    sample_lines = [
        {
            "id": 0,
            "text": "Century mark chorus",
            "start_time": 6000.0,
            "end_time": 6005.0,
            "words": [
                {"word": "Century", "start_time": 6000.0, "end_time": 6002.5},
                {"word": "mark", "start_time": 6002.5, "end_time": 6005.0},
            ],
        }
    ]
    ass = vr.generate_ass_content(sample_lines)
    # Start time displayed early: 6000 - 2.5 = 5997.5s = 1h 39m 57.50s
    assert "1:39:57.50" in ass
    assert "Century" in ass
    assert "mark" in ass


def test_generate_ass_subtitles_multi_singer_file_output(tmp_path):
    """VideoRenderer.generate_ass_subtitles writes multi-singer styles and progressive kf tags."""
    renderer = VideoRenderer(output_dir=tmp_path)
    out_ass = tmp_path / "duet.ass"

    lines = [
        {
            "id": 0,
            "text": "Part one",
            "start_time": 1.0,
            "end_time": 3.0,
            "singer": "lead",
            "words": [{"word": "Part", "start_time": 1.0, "end_time": 2.0}],
        },
        {
            "id": 1,
            "text": "Part two",
            "start_time": 4.0,
            "end_time": 6.0,
            "singer": "partner",
            "words": [{"word": "Part", "start_time": 4.0, "end_time": 5.0}],
        },
        {
            "id": 2,
            "text": "Part three",
            "start_time": 7.0,
            "end_time": 9.0,
            "singer": "both",
            "words": [{"word": "Part", "start_time": 7.0, "end_time": 8.0}],
        },
    ]

    res = renderer.generate_ass_subtitles(lines, out_ass)
    assert os.path.exists(res)
    content = out_ass.read_text(encoding="utf-8")

    assert "Style: KaraokeLine1_Singer2" in content
    assert "Style: KaraokeLine1_Both" in content
    assert ",KaraokeLine1," in content
    assert ",KaraokeLine2_Singer2," in content
    assert ",KaraokeLine1_Both," in content
    assert "{\\kf" in content


def test_render_video_with_audio_visualizer_16_9(tmp_path):
    """Renders 16:9 MP4 video with beat-reactive visualizer and burnt-in subtitles.

    Verifies output exists with 1920x1080 dimensions, h264/aac codecs via ffprobe.
    """
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "vis_16_9.ass"
    output_mp4 = tmp_path / "vis_16_9.mp4"
    audio_path = tmp_path / "vis_16_9.wav"

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

    renderer.generate_ass_subtitles(
        [
            {
                "id": 0,
                "text": "Visualizer 16:9 Test",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": [{"word": "Visualizer", "start_time": 0.0, "end_time": 0.8}],
            }
        ],
        output_ass,
        aspect_ratio="16:9",
    )

    rendered_path = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        aspect_ratio="16:9",
        duration=1.0,
        include_visualizer=True,
    )

    assert os.path.exists(rendered_path)

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
                rendered_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .split(",")
    )
    codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
    assert codec == "h264"
    assert width == 1920
    assert height == 1080


def test_render_video_with_audio_visualizer_9_16(tmp_path):
    """Renders 9:16 vertical MP4 video with beat-reactive visualizer and burnt-in subtitles.

    Verifies output exists with 1080x1920 dimensions, h264/aac codecs via ffprobe.
    """
    renderer = VideoRenderer(output_dir=tmp_path)
    output_ass = tmp_path / "vis_9_16.ass"
    output_mp4 = tmp_path / "vis_9_16.mp4"
    audio_path = tmp_path / "vis_9_16.wav"

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

    renderer.generate_ass_subtitles(
        [
            {
                "id": 0,
                "text": "Visualizer 9:16 Test",
                "start_time": 0.0,
                "end_time": 1.0,
                "words": [{"word": "Visualizer", "start_time": 0.0, "end_time": 0.8}],
            }
        ],
        output_ass,
        aspect_ratio="9:16",
    )

    rendered_path = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        aspect_ratio="9:16",
        duration=1.0,
        include_visualizer=True,
    )

    assert os.path.exists(rendered_path)

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
                rendered_path,
            ],
            capture_output=True,
            text=True,
            check=True,
        )
        .stdout.strip()
        .split(",")
    )
    codec, width, height = probe_v[0], int(probe_v[1]), int(probe_v[2])
    assert codec == "h264"
    assert width == 1080
    assert height == 1920


def test_generate_ass_subtitles_include_countdown_flag(tmp_path):
    """VideoRenderer.generate_ass_subtitles respects include_countdown flag."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_enabled = tmp_path / "countdown_enabled.ass"
    ass_disabled = tmp_path / "countdown_disabled.ass"

    sample_lines = [
        {
            "id": 0,
            "text": "First line after long intro",
            "start_time": 5.0,
            "end_time": 8.0,
            "words": [{"word": "First", "start_time": 5.0, "end_time": 6.0}],
        }
    ]

    renderer.generate_ass_subtitles(sample_lines, ass_enabled, include_countdown=True)
    content_enabled = ass_enabled.read_text(encoding="utf-8")
    assert ",Countdown,,0,0,0,," in content_enabled

    renderer.generate_ass_subtitles(sample_lines, ass_disabled, include_countdown=False)
    content_disabled = ass_disabled.read_text(encoding="utf-8")
    assert ",Countdown,,0,0,0,," not in content_disabled


def test_render_request_schema_visualizer_and_countdown():
    """RenderRequest schema provides default values and accepts overrides."""
    from backend.schemas import RenderRequest

    # Default values
    req_default = RenderRequest()
    assert req_default.include_visualizer is False
    assert req_default.include_countdown is True

    # Custom overrides
    req_custom = RenderRequest(include_visualizer=True, include_countdown=False)
    assert req_custom.include_visualizer is True
    assert req_custom.include_countdown is False
