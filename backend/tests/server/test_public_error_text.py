"""Error text stored on a song (and shown in the studio) keeps what went wrong but not where
the server keeps its files, and stays short."""

from backend import config
from backend.errors import PUBLIC_ERROR_LIMIT, public_error


def test_data_folder_and_checkout_paths_become_relative():
    stem = config.DATA_DIR / "stems" / "abc" / "vocals.wav"
    code = config.BASE_DIR / "backend" / "pipeline.py"
    text = public_error(RuntimeError(f"Error opening {stem} from {code}"))
    assert str(config.DATA_DIR) not in text
    assert str(config.BASE_DIR) not in text
    assert text == "Error opening stems/abc/vocals.wav from backend/pipeline.py"


def test_long_ffmpeg_output_is_collapsed_and_cut():
    noise = "ffmpeg version 6.1\n  built with gcc\n" * 200
    text = public_error(RuntimeError(f"FFmpeg audio transcoding failed: {noise}"))
    assert "\n" not in text
    assert len(text) == PUBLIC_ERROR_LIMIT
    assert text.startswith("FFmpeg audio transcoding failed: ffmpeg version 6.1 built with")
    assert text.endswith("…")


def test_an_exception_without_a_message_gives_its_type():
    assert public_error(TimeoutError()) == "TimeoutError"


def test_plain_text_passes_through():
    assert public_error("Video unavailable") == "Video unavailable"


def test_a_failed_render_stores_the_cleaned_text(monkeypatch, tmp_path):
    import backend.main as main_mod
    from backend.main import projects
    from backend.render_worker import run_video_render
    from backend.schemas import RenderRequest

    pid = "pubtxt01"
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "T",
        "artist": "A",
        "status": "ready",
        "lines": [{"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "x", "words": []}],
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

    def fail(**kwargs):
        raise RuntimeError(f"FFmpeg failed on {config.OUTPUT_DIR / 'pubtxt01.part.mp4'}")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", fail)
    try:
        run_video_render(pid, RenderRequest())
        assert projects[pid]["render_error"] == "FFmpeg failed on output/pubtxt01.part.mp4"
    finally:
        projects.pop(pid, None)
