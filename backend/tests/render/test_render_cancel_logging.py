"""A cancelled render is logged as a cancel (INFO, no traceback); a failed one as an error
with its traceback."""

import logging

import pytest

import backend.main as main_mod
from backend.main import projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest


@pytest.fixture
def song(tmp_path, monkeypatch):
    pid = "cancellog01"
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Quiet Exit",
        "artist": "Log Level",
        "status": "ready",
        "lines": [{"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "Bye", "words": []}],
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
    yield pid
    projects.pop(pid, None)


@pytest.mark.parametrize("cancelled", [True, False], ids=["cancelled", "failed"])
def test_cancel_is_info_and_failure_is_error(song, monkeypatch, caplog, cancelled):
    def render(**kwargs):
        if cancelled:
            main_mod.active_cancellations[f"{song}_render"].set()
            raise RuntimeError("Video rendering was cancelled by user")
        raise RuntimeError("FFmpeg video render error")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", render)
    caplog.set_level(logging.INFO, logger="karaoke_backend")

    run_video_render(song, RenderRequest())

    errors = [r for r in caplog.records if r.levelno >= logging.ERROR]
    if cancelled:
        assert errors == []
        assert f"Render for {song} stopped after a cancel" in caplog.text
    else:
        assert len(errors) == 1 and errors[0].exc_info is not None
