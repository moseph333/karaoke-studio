"""Rendering a song again: the new video overwrites the file at the same path, so its URL carries
the time the render finished, and a browser shows and downloads the new video instead of its
cached copy of the previous one."""

import types

import pytest

import backend.main as main_mod
import backend.render_worker as render_worker
from backend import config
from backend.main import projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest


@pytest.fixture
def song(tmp_path, monkeypatch):
    """A ready song whose subtitles, mix, FFmpeg render and YouTube kit are stand-ins."""
    pid = "encore01"
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Encore",
        "artist": "Second Take",
        "status": "ready",
        "progress": 100,
        "lines": [{"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "Once more", "words": []}],
        "chords": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "instrumental_path": str(tmp_path / "inst.wav"),
    }
    monkeypatch.setattr(
        main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: kw["output_ass_path"]
    )
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kw: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(main_mod.video_renderer, "render_video", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        main_mod.youtube_service, "generate_youtube_package", lambda **kw: {"title": "t"}
    )
    yield pid
    projects.pop(pid, None)


def _render_at(monkeypatch, pid: str, now: float) -> str:
    monkeypatch.setattr(render_worker, "time", types.SimpleNamespace(time=lambda: now))
    run_video_render(pid, RenderRequest())
    assert projects[pid]["render_status"] == "completed"
    return projects[pid]["video_url"]


def test_each_render_gives_the_video_a_new_url(song, monkeypatch):
    first = _render_at(monkeypatch, song, 1_700_000_000.0)
    again = _render_at(monkeypatch, song, 1_700_000_095.0)

    assert first == "/static/output/encore01_karaoke.mp4?v=1700000000"
    assert again == "/static/output/encore01_karaoke.mp4?v=1700000095"


def test_the_versioned_url_still_serves_the_video(client, song, monkeypatch):
    url = _render_at(monkeypatch, song, 1_700_000_000.0)
    # conftest points /static/output and config.OUTPUT_DIR at this test's own folder
    (config.OUTPUT_DIR / "encore01_karaoke.mp4").write_bytes(b"\x00\x00\x00\x18ftypmp42")

    res = client.get(url)

    assert res.status_code == 200
    assert res.content == b"\x00\x00\x00\x18ftypmp42"
