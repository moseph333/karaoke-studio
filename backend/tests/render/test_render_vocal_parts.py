"""A video's audio keeps the vocals its render request asks for."""

from pathlib import Path

import pytest

import backend.main as main_mod
from backend import config
from backend.project_analysis import youtube_package
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest
from backend.services import vocal_parts
from backend.services.audio_mixer import MIX_QUALITY
from backend.tests.helpers.split_songs import level, make_song, wav


@pytest.fixture
def song(monkeypatch):
    """A ready song with lead and backing parts, whose subtitles, FFmpeg render and YouTube
    kit are stand-ins; the mixer records what it was given."""
    proj = make_song(main_mod, track_id="vs1", chords=[])
    stems = main_mod.STEMS_DIR / "vs1"
    vocal_parts.install(
        stems,
        "lead_backing",
        wav(stems / "work" / "a.wav", 0.2),
        wav(stems / "work" / "b.wav", 0.1),
        {"model": "m"},
    )
    calls = []

    def fake_mix(*, instrumental_path, vocals_path, semitones, guide_volume, output_filename):
        calls.append(
            {
                "vocals": Path(vocals_path).name if vocals_path else None,
                "vocals_level": round(level(vocals_path), 3) if vocals_path else None,
                "guide": guide_volume,
                "name": output_filename,
                "quality": MIX_QUALITY.get(),
            }
        )
        return str(wav(config.OUTPUT_DIR / output_filename))

    kits = []

    def kit(**kwargs):
        kits.append(kwargs["has_guide_vocal"])
        return {"title": "t"}

    monkeypatch.setattr(
        main_mod.video_renderer, "generate_ass_subtitles", lambda **kw: kw["output_ass_path"]
    )
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    monkeypatch.setattr(main_mod.video_renderer, "render_video", lambda *args, **kwargs: None)
    monkeypatch.setattr(main_mod.youtube_service, "generate_youtube_package", kit)
    return {"proj": proj, "calls": calls, "kits": kits}


def test_a_render_keeps_the_backing_vocals_it_was_asked_for(song):
    run_video_render("vs1", RenderRequest(guide_volume=0.0, vocal_levels={"backing": 1.0}))

    proj = song["proj"]
    assert proj["render_status"] == "completed"
    [call] = song["calls"]
    # The kept vocals at full level, mixed at final quality into the render's scratch mix
    assert ".vocals.tmp_" in call["vocals"]
    assert (call["vocals_level"], call["guide"]) == (0.1, 1.0)
    assert (call["name"], call["quality"]) == ("vs1_final_audio.wav", "final")
    assert proj["render_settings"] == {
        "semitones": 0,
        "guide_volume": 0.0,
        "vocal_levels": {"backing": 1.0},
    }
    assert song["kits"] == [True]  # the video has vocals in it
    assert list(config.OUTPUT_DIR.glob("*final_audio*")) == []


def test_a_render_without_levels_mixes_as_before(song):
    run_video_render("vs1", RenderRequest(semitones=1, guide_volume=0.2))

    [call] = song["calls"]
    assert (call["vocals"], call["guide"], call["name"]) == (
        "vocals.wav",
        0.2,
        "vs1_final_audio.wav",
    )
    assert song["proj"]["render_settings"] == {"semitones": 1, "guide_volume": 0.2}


def test_a_render_never_reuses_a_cached_preview_mix(song):
    wav(config.OUTPUT_DIR / "vs1_final_audio.wav")

    run_video_render("vs1", RenderRequest())

    assert len(song["calls"]) == 1


def test_the_youtube_kit_describes_the_vocals_of_the_last_render(song):
    proj = song["proj"]
    proj["vocal_levels"] = {"backing": 1.0}
    youtube_package(proj)  # never rendered: the song's current levels
    proj["render_settings"] = {"semitones": 0, "guide_volume": 0.0}
    youtube_package(proj)  # rendered without vocals, levels set afterwards
    proj["render_settings"] = {"semitones": 0, "guide_volume": 0.0, "vocal_levels": {"singer2": 1}}
    youtube_package(proj)

    assert song["kits"] == [True, False, True]
