"""Preview/export parity: the stage look chosen in the studio (duet colors, preset backdrop,
background style) reaches the .ass subtitle export and the rendered video, and the stage is
served the very cover-art still the export draws."""

import shutil
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest
from backend.services.ass_generator import css_to_ass_color
from backend.services.video_renderer import (
    DEFAULT_BACKGROUND_COLOR,
    VideoRenderer,
    ffmpeg_color,
    prepare_background,
)

DUET_LINES = [
    {
        "id": 1,
        "start_time": 1.0,
        "end_time": 3.0,
        "text": "Lead line",
        "singer": "singer1",
        "words": [
            {"word": "Lead", "start": 1.0, "end": 2.0},
            {"word": "line", "start": 2.0, "end": 3.0},
        ],
    },
    {
        "id": 2,
        "start_time": 3.5,
        "end_time": 5.0,
        "text": "Partner line",
        "singer": "singer2",
        "words": [
            {"word": "Partner", "start": 3.5, "end": 4.2},
            {"word": "line", "start": 4.2, "end": 5.0},
        ],
    },
]


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("#0B0B12", "0x0b0b12"),
        ("0b0b12", "0x0b0b12"),
        ("  #f4f4f0 ", "0xf4f4f0"),
        ("#12345", DEFAULT_BACKGROUND_COLOR),
        ("red", DEFAULT_BACKGROUND_COLOR),
        ("#0b0b12:s=1x1", DEFAULT_BACKGROUND_COLOR),
        (None, DEFAULT_BACKGROUND_COLOR),
        (123, DEFAULT_BACKGROUND_COLOR),
    ],
)
def test_ffmpeg_color_accepts_only_plain_hex(value, expected):
    assert ffmpeg_color(value) == expected


def _capture_render_cmd(tmp_path, **render_kwargs) -> list[str]:
    renderer = VideoRenderer(output_dir=tmp_path / "out")
    audio = tmp_path / "audio.wav"
    t = np.linspace(0, 0.3, int(44100 * 0.3), endpoint=False)
    sf.write(str(audio), 0.1 * np.sin(2 * np.pi * 440 * t), 44100)
    subs = tmp_path / "subs.ass"
    subs.write_text("[Script Info]\nTitle: Test\n", encoding="utf-8")
    captured: list[str] = []

    def fake_popen(cmd, *args, **kwargs):
        captured.extend(cmd)
        proc = MagicMock()
        proc.stdout = iter(["progress=end\n"])
        proc.stderr = iter([])
        proc.poll.return_value = 0
        proc.returncode = 0
        proc.wait.return_value = 0
        return proc

    with patch("subprocess.Popen", side_effect=fake_popen):
        renderer.render_video(
            audio_path=str(audio),
            ass_subtitles_path=str(subs),
            output_mp4_path=tmp_path / "out" / "video.mp4",
            thumbnail_path=None,
            custom_bg_path=None,
            **render_kwargs,
        )
    return captured


def test_render_uses_preset_backdrop_when_there_is_no_artwork(tmp_path):
    cmd = _capture_render_cmd(tmp_path, background_color="#0B0B12")
    assert any("color=c=0x0b0b12:" in arg for arg in cmd)


def test_render_ignores_unsafe_backdrop_values(tmp_path):
    cmd = _capture_render_cmd(tmp_path, background_color="#000000[x];movie=/etc/passwd")
    assert any(f"color=c={DEFAULT_BACKGROUND_COLOR}:" in arg for arg in cmd)
    assert not any("passwd" in arg for arg in cmd)


@pytest.fixture
def duet_project():
    pid = "parity01"
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Duet",
        "artist": "Pair",
        "status": "ready",
        "progress": 100,
        "lines": DUET_LINES,
        "chords": [],
        "semitones": 0,
        "guide_volume": 0.0,
    }
    yield projects[pid]
    projects.pop(pid, None)


def test_ass_export_applies_duet_colors_from_the_look_panel(client, duet_project):
    res = client.get(
        f"/api/project/{duet_project['id']}/export/ass",
        params={"theme_id": "modern_gold", "singer2_color": "#123456", "both_color": "#abcdef"},
    )
    assert res.status_code == 200
    body = res.text
    singer2_style = next(
        line for line in body.splitlines() if line.startswith("Style: KaraokeLine1_Singer2,")
    )
    both_style = next(
        line for line in body.splitlines() if line.startswith("Style: KaraokeLine1_Both,")
    )
    assert css_to_ass_color("#123456") in singer2_style
    assert css_to_ass_color("#abcdef") in both_style


def test_ass_export_ignores_duet_colors_that_are_not_colors(client, duet_project):
    res = client.get(
        f"/api/project/{duet_project['id']}/export/ass",
        params={
            "theme_id": "afterglow",
            "singer2_color": "&H00FFFFFF\nDialogue: 0,0:00:00.00,0:09:00.00,Default,,0,0,0,,hi",
            "both_color": "&H00FFFFFF,Comic Sans",
        },
    )
    assert res.status_code == 200
    assert "Comic Sans" not in res.text
    assert "0:09:00.00" not in res.text
    singer2_style = next(
        line for line in res.text.splitlines() if line.startswith("Style: KaraokeLine1_Singer2,")
    )
    assert css_to_ass_color("#f472b6") in singer2_style


def test_ass_export_without_duet_colors_keeps_preset_defaults(client, duet_project):
    res = client.get(
        f"/api/project/{duet_project['id']}/export/ass", params={"theme_id": "afterglow"}
    )
    assert res.status_code == 200
    singer2_style = next(
        line for line in res.text.splitlines() if line.startswith("Style: KaraokeLine1_Singer2,")
    )
    # Afterglow's own duet color (#f472b6)
    assert css_to_ass_color("#f472b6") in singer2_style


def test_render_worker_forwards_the_stage_backdrop(tmp_path, duet_project, monkeypatch):
    duet_project["instrumental_path"] = str(tmp_path / "inst.wav")
    render_calls: list[dict] = []
    monkeypatch.setattr(main_mod, "OUTPUT_DIR", tmp_path, raising=False)
    monkeypatch.setattr(
        main_mod.video_renderer,
        "generate_ass_subtitles",
        lambda **kwargs: kwargs["output_ass_path"],
    )
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kwargs: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(
        main_mod.video_renderer,
        "render_video",
        lambda audio_path, ass_subtitles_path, output_mp4_path, **kwargs: render_calls.append(
            kwargs
        ),
    )
    monkeypatch.setattr(
        main_mod.youtube_service, "generate_youtube_package", lambda **kwargs: {"title": "t"}
    )

    run_video_render(
        duet_project["id"],
        RenderRequest(style_config={"theme_id": "afterglow", "background_color": "#0b0b12"}),
    )

    assert render_calls, "render_video was not called"
    assert render_calls[0]["background_color"] == "#0b0b12"
    assert projects[duet_project["id"]]["render_status"] == "completed"


def test_render_worker_forwards_the_background_style(tmp_path, duet_project, monkeypatch):
    duet_project["instrumental_path"] = str(tmp_path / "inst.wav")
    render_calls: list[dict] = []
    monkeypatch.setattr(main_mod, "OUTPUT_DIR", tmp_path, raising=False)
    monkeypatch.setattr(
        main_mod.video_renderer,
        "generate_ass_subtitles",
        lambda **kwargs: kwargs["output_ass_path"],
    )
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kwargs: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(
        main_mod.video_renderer,
        "render_video",
        lambda audio_path, ass_subtitles_path, output_mp4_path, **kwargs: render_calls.append(
            kwargs
        ),
    )
    monkeypatch.setattr(
        main_mod.youtube_service, "generate_youtube_package", lambda **kwargs: {"title": "t"}
    )
    palette = ["#dc2626", "#f59e0b", "#1f2937"]

    run_video_render(
        duet_project["id"],
        RenderRequest(
            style_config={
                "theme_id": "clean_paper",
                "background_color": "#f4f4f0",
                "background_style": "aurora",
                "background_palette": palette,
                "background_tone": "light",
            }
        ),
    )

    assert render_calls, "render_video was not called"
    kwargs = render_calls[0]
    assert kwargs["background_style"] == "aurora"
    assert kwargs["background_palette"] == palette
    assert kwargs["background_tone"] == "light"


def _pixels(path_or_bytes, tmp_path: Path) -> np.ndarray:
    """Decoded RGB pixels of a PNG file or PNG bytes."""
    source = path_or_bytes
    if isinstance(path_or_bytes, bytes):
        source = tmp_path / "served.png"
        source.write_bytes(path_or_bytes)
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(source), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True,
        check=True,
    ).stdout
    return np.frombuffer(raw, np.uint8)


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed")
@pytest.mark.parametrize("drift", [False, True])
def test_the_stage_is_served_the_still_the_export_draws(client, tmp_path, drift):
    thumbnail = main_mod.DOWNLOADS_DIR / "parity.jpg"
    ffmpeg = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-f", "lavfi"]
    subprocess.run(
        [*ffmpeg, "-i", "testsrc2=s=640x360", "-frames:v", "1", str(thumbnail)], check=True
    )
    projects["parity01"] = {"id": "parity01", "title": "P", "thumbnail_path": str(thumbnail)}
    try:
        res = client.get("/api/project/parity01/backdrop", params={"drift": int(drift)})
    finally:
        projects.pop("parity01", None)
    assert res.status_code == 200

    work_dir = tmp_path / "work"
    work_dir.mkdir()
    background = prepare_background(
        work_dir, 1920, 1080, str(thumbnail), None, background_style="drift" if drift else None
    )

    assert background.kind == ("drift" if drift else "image")
    assert np.array_equal(_pixels(res.content, tmp_path), _pixels(background.path, tmp_path))
