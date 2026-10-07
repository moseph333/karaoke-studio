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

