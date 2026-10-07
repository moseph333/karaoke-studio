import os
from pathlib import Path
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
            ]
        },
        {
            "id": 1,
            "text": "Second line starts here",
            "start_time": 12.0, # Gap > 3.5s => triggers countdown dots
            "end_time": 15.0,
            "words": [
                {"word": "Second", "start_time": 12.0, "end_time": 12.8},
                {"word": "line", "start_time": 12.8, "end_time": 13.5},
                {"word": "starts", "start_time": 13.5, "end_time": 14.2},
                {"word": "here", "start_time": 14.2, "end_time": 15.0},
            ]
        }
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
    from backend.main import projects, active_cancellations

    # Test pipeline cancel
    proj_id = "test_cancel_proj"
    cancel_evt = threading.Event()
    active_cancellations[proj_id] = cancel_evt
    projects[proj_id] = {
        "id": proj_id,
        "status": "separating",
        "progress": 40,
        "lines": []
    }

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
        encoding="utf-8"
    )

    progress_reports = []
    def on_progress(pct, detail, eta):
        progress_reports.append((pct, detail, eta))

    rendered = renderer.render_video(
        audio_path=str(audio_path),
        ass_subtitles_path=str(output_ass),
        output_mp4_path=output_mp4,
        duration=1.0,
        progress_callback=on_progress
    )

    assert os.path.exists(rendered)
    assert len(progress_reports) > 0


