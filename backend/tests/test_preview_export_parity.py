"""Preview/export parity: the stage look chosen in the studio (duet colors, preset backdrop)
reaches the .ass subtitle export and the rendered video."""

from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest
from backend.services.ass_generator import css_to_ass_color
from backend.services.video_renderer import DEFAULT_BACKGROUND_COLOR, VideoRenderer, ffmpeg_color

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
