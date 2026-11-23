"""What the song loop worker asks its models for: the lyrics it hands over, the scene it
takes back and the prompt the video model gets."""

import pytest

from backend.workers import song_loop_worker as worker

LYRICS = """Down by the river where the lanterns glow

Down by the river where the lanterns glow
We let the paper boats go
  we let the  paper boats go
Hold on, hold on
"""


def test_the_lyrics_are_handed_over_once_per_line():
    assert worker.lyrics_excerpt(LYRICS) == (
        "Down by the river where the lanterns glow\nWe let the paper boats go\nHold on, hold on"
    )


def test_long_lyrics_stop_at_a_whole_line():
    lines = [f"line number {n} of a very long song" for n in range(200)]
    excerpt = worker.lyrics_excerpt("\n".join(lines), limit=300)
    assert len(excerpt) <= 300
    assert excerpt.splitlines() == lines[: len(excerpt.splitlines())]


def test_the_chat_carries_the_rules_and_the_song():
    system, user = worker.llm_messages(LYRICS, title="Paper Boats", artist="The Lanterns")
    assert system["role"] == "system" and user["role"] == "user"
    for rule in ("No faces", "No text of any kind", "No cuts", "English"):
        assert rule in system["content"]
    assert user["content"].startswith("Title: Paper Boats\nArtist: The Lanterns\n\nLyrics:\n")
    assert user["content"].count("lanterns glow") == 1


def test_a_song_without_lyrics_goes_by_its_title():
    _, user = worker.llm_messages("", title="Moonlight Drive")
    assert user["content"] == "Title: Moonlight Drive\n\nThe song has no lyrics: go by its title."
    assert worker.scene_source("", "") == "title"
    assert worker.scene_source(LYRICS, "") == "lyrics"
    assert worker.scene_source(LYRICS, "  a field of wheat ") == "typed"


def test_a_scene_is_one_plain_line():
    raw = '<think>the song is about rivers</think>\n "Paper lanterns drift\n down a dark river."  '
    assert worker.clean_scene(raw) == "Paper lanterns drift down a dark river."


def test_a_scene_that_runs_long_ends_at_a_sentence():
    scene = "Mist rolls over the hills. " * 40
    cut = worker.clean_scene(scene, limit=100)
    assert len(cut) <= 100 and cut.endswith("hills.")
    assert len(worker.clean_scene("word " * 400, limit=101)) <= 101


def test_the_video_prompt_is_the_scene_then_how_every_loop_moves():
    prompt = worker.video_prompt("Rain on a window at night")
    assert prompt == f"Rain on a window at night. {worker.PROMPT_STYLE}"
    for unwanted in ("text", "subtitles", "faces", "camera cuts"):
        assert unwanted in worker.NEGATIVE_PROMPT


def test_every_model_draws_a_clip_its_pipeline_accepts():
    wan, ltx = worker.MODELS["wan22"], worker.MODELS["ltx"]
    assert (wan["frames"] - 1) % 4 == 0
    assert (ltx["frames"] - 1) % 8 == 0
    assert ltx["base_width"] % 32 == 0 and ltx["base_height"] % 32 == 0
    assert worker.DEFAULT_MODEL in worker.MODELS
    assert set(worker.DRAW) == set(worker.MODELS)
    for spec in worker.MODELS.values():
        assert spec["frames"] / spec["fps"] > 2 * worker.DEFAULT_FADE


def test_the_worker_needs_something_to_go_by(tmp_path, capsys):
    with pytest.raises(SystemExit) as stopped:
        worker.parse_args(["--out", str(tmp_path), "--model-dir", str(tmp_path)])
    assert stopped.value.code == worker.EXIT_USAGE
    assert "nothing to go by" in capsys.readouterr().err


def test_a_fade_must_leave_a_loop(tmp_path):
    base = ["--out", str(tmp_path), "--model-dir", str(tmp_path), "--prompt", "a quiet lake"]
    assert worker.parse_args(base).fade == worker.DEFAULT_FADE
    with pytest.raises(SystemExit):
        worker.parse_args([*base, "--fade", "4"])
    with pytest.raises(SystemExit):
        worker.parse_args([*base, "--fade", "0"])
