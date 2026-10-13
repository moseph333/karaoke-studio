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
