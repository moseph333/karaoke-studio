"""A render set to the song's loop draws that file the way it draws an uploaded video, and
draws the cover art when the song has no loop."""

import subprocess

import pytest
from PIL import Image

import backend.main as main_mod
from backend.main import projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest
from backend.services import song_loops, stage_backgrounds
from backend.services import video_renderer as vr
from backend.tests.helpers.libass_frames import needs_libass
from backend.tools import look_frames

LOOP = {"background_style": "loop"}


@pytest.fixture
def song(tmp_path, monkeypatch):
    """A ready song whose subtitles, mix and YouTube kit are stand-ins, and a render that
    only notes what it was asked to draw."""
    pid = "loopsong1"
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Paper Boats",
        "status": "ready",
        "lines": [{"id": 1, "start_time": 1.0, "end_time": 2.0, "text": "Hold on", "words": []}],
        "chords": [],
        "semitones": 0,
        "guide_volume": 0.0,
        "instrumental_path": str(tmp_path / "inst.wav"),
    }
    asked: dict = {}
    monkeypatch.setattr(
        main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: kw["output_ass_path"]
    )
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kw: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(main_mod.video_renderer, "render_video", lambda **kw: asked.update(kw))
    monkeypatch.setattr(
        main_mod.youtube_service, "generate_youtube_package", lambda **kw: {"title": "t"}
    )
    yield {"pid": pid, "asked": asked, "file": main_mod.OUTPUT_DIR / f"{pid}_loop.mp4"}
    projects.pop(pid, None)


def give_loop(song) -> None:
    song["file"].write_bytes(b"a loop")
    projects[song["pid"]]["song_loop"] = {"url": f"/static/output/{song['file'].name}?v=1"}


def render(song, **request) -> dict:
    run_video_render(song["pid"], RenderRequest(**request))
    assert projects[song["pid"]]["render_status"] == "completed"
    return song["asked"]


def test_the_songs_loop_is_drawn_like_an_uploaded_video(song):
    give_loop(song)
    asked = render(song, style_config=LOOP)
    assert asked["custom_bg_path"] == str(song["file"])


def test_a_song_without_a_loop_shows_its_cover_art(song):
    asked = render(song, style_config=LOOP)
    assert asked["custom_bg_path"] is None
    # The renderer does not know the style, and draws what it draws by default
    assert stage_backgrounds.normalize_style(asked["background_style"]) == "artwork"


def test_a_loop_whose_file_is_gone_is_not_asked_for(song):
    give_loop(song)
    song["file"].unlink()
    assert render(song, style_config=LOOP)["custom_bg_path"] is None


@pytest.mark.parametrize("style", [None, "artwork", "aurora", "color"])
def test_other_styles_leave_the_loop_alone(song, style):
    give_loop(song)
    config = {"background_style": style} if style else {}
    assert render(song, style_config=config)["custom_bg_path"] is None


def test_an_upload_named_by_the_request_still_wins(song):
    give_loop(song)
    upload = main_mod.BACKGROUNDS_DIR / "ab12cd34_stage.mp4"
    upload.write_bytes(b"an upload")
    asked = render(song, style_config=LOOP, custom_bg_id=upload.name)
    assert asked["custom_bg_path"] == str(upload.resolve())


def test_the_renderer_loops_it_under_the_looks_treatment(tmp_path):
    loop = tmp_path / "song_loop.mp4"
    loop.write_bytes(b"a loop")
    background = vr.prepare_background(
        tmp_path, 1920, 1080, None, str(loop), "#000000", song_loops.STYLE, look_id="marquee"
    )
    assert background.kind == "video"
    assert background.input_args(str(loop), 1920, 1080)[:2] == ["-stream_loop", "-1"]
    assert "fps=60" in background.graph and "colorchannelmixer" in background.graph


@needs_libass
def test_the_frames_tool_draws_a_look_over_a_loop(tmp_path):
    loop = tmp_path / "loop.mp4"
    source = "color=c=red:size=320x180:rate=24:duration=1"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", source, "-pix_fmt", "yuv420p", str(loop)],
        check=True,
    )
    cover = tmp_path / "cover.png"
    look_frames.demo_cover(cover)
    script = tmp_path / "ktv.ass"
    script.write_text(
        look_frames.look_script("ktv", "16:9", look_frames.demo_lines()), encoding="utf-8"
    )
    still = tmp_path / "still.png"

    look_frames.render_still("ktv", "16:9", script, cover, 47.0, still, tmp_path, loop)

    with Image.open(still) as frame:
        assert frame.size == (1920, 1080)
        red, green, blue = frame.convert("RGB").getpixel((60, 60))
    # KTV leaves an upload as it is: the corner is the loop's red, not the cover art
    assert red > 200 and green < 60 and blue < 60
