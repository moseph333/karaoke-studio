"""A mix whose vocals follow the lyric lines is marked stale when the lines move under it,
so the studio asks for it again; the next mix clears the mark."""

from pathlib import Path

import pytest

import backend.main as main_mod
from backend import master_audio, realignment
from backend.services import vocal_parts
from backend.tests.helpers.split_songs import fake_splitter, make_song, wav

BY_LINES = {"by": "lines", "singer1": 0.0, "singer2": 1.0}


@pytest.fixture
def song(monkeypatch):
    proj = make_song(main_mod)

    def fake_mix(*, instrumental_path, vocals_path, semitones, guide_volume, output_filename):
        return str(wav(main_mod.OUTPUT_DIR / output_filename, 0.9))

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    return proj


def _mix(client, **body) -> str:
    res = client.post("/api/project/vs1/mix", json=body)
    assert res.status_code == 200, res.text
    return res.json()["master_audio_url"].split("?")[0]


def _save_lines(client, lines):
    res = client.post("/api/project/vs1/lyrics", json={"lines": lines})
    assert res.status_code == 200, res.text
    return res.json()


def _moved(song, seconds: float) -> list[dict]:
    """The song's lines with Singer 2's line starting later."""
    first, second = song["lines"]
    return [first, {**second, "start_time": second["start_time"] + seconds}]


def test_moving_a_kept_singers_line_marks_the_mix_stale_until_it_is_made_again(client, song):
    before = _mix(client, vocal_levels=BY_LINES)
    assert "master_stale" not in song

    body = _save_lines(client, _moved(song, 0.4))

    assert body["master_stale"] is True
    assert song["master_stale"] is True
    assert client.get("/api/project/vs1").json()["master_stale"] is True

    after = _mix(client, vocal_levels=BY_LINES)
    assert after != before
    assert "master_stale" not in song


def test_editing_words_without_moving_them_leaves_the_mix_current(client, song):
    _mix(client, vocal_levels=BY_LINES)

    body = _save_lines(client, [dict(line, text="new words") for line in song["lines"]])

    assert body["master_stale"] is False
    assert "master_stale" not in song


def test_a_song_whose_vocals_do_not_follow_its_lines_is_never_stale(client, song):
    _mix(client, guide_volume=0.3)
    assert _save_lines(client, _moved(song, 0.4))["master_stale"] is False

    # The intake's first master is not a cached mix at all
    song["master_audio_path"] = str(main_mod.OUTPUT_DIR / "vs1_master.wav")
    assert _save_lines(client, _moved(song, 0.2))["master_stale"] is False
    assert master_audio.master_is_stale({"vocal_levels": BY_LINES}) is False


def test_moving_the_lines_back_makes_the_mix_current_again(client, song):
    original = [dict(line) for line in song["lines"]]
    _mix(client, vocal_levels=BY_LINES)
    assert _save_lines(client, _moved(song, 0.4))["master_stale"] is True

    assert _save_lines(client, original)["master_stale"] is False


def test_a_failed_lyric_save_does_not_leave_the_mark(client, song, monkeypatch):
    from unittest.mock import patch

    _mix(client, vocal_levels=BY_LINES)
    with patch("backend.project_store.os.replace", side_effect=OSError(28, "No space left")):
        res = client.post("/api/project/vs1/lyrics", json={"lines": _moved(song, 0.4)})

    assert res.status_code == 507
    assert "master_stale" not in song


def test_lines_retimed_in_the_background_mark_the_mix_stale(client, song):
    _mix(client, vocal_levels=BY_LINES)

    with main_mod.PROJECTS_LOCK:
        realignment.store_aligned_lines(song, _moved(song, 0.4))

    assert song["master_stale"] is True


def test_a_split_that_gives_stored_levels_their_parts_mixes_the_master_again(
    client, song, monkeypatch
):
    """A backing level kept from before the stems were re-made applies again once the vocals
    are split again."""
    _mix(client, guide_volume=0.0, vocal_levels={"backing": 1.0})
    plain = Path(song["master_audio_path"]).name
    assert plain == "vs1_mix_0_0.wav"  # no parts yet: nothing to keep
    monkeypatch.setattr(vocal_parts, "split_status", lambda kind: (True, None))
    monkeypatch.setattr(main_mod.separator, "split_vocals", fake_splitter(main_mod, []))

    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202

    proj = client.get("/api/project/vs1").json()
    assert proj["vocal_split_job"]["status"] == "done"
    name = Path(proj["master_audio_path"]).name
    assert name.startswith("vs1_mix_0_0_") and name != plain
    assert proj["master_audio_url"].startswith(f"/static/output/{name}")
    assert "master_stale" not in proj


def test_a_mix_that_fails_after_a_split_leaves_the_mark_for_the_studio(client, song, monkeypatch):
    _mix(client, guide_volume=0.0, vocal_levels={"backing": 1.0})
    monkeypatch.setattr(vocal_parts, "split_status", lambda kind: (True, None))
    monkeypatch.setattr(main_mod.separator, "split_vocals", fake_splitter(main_mod, []))

    def broken(**kwargs):
        raise RuntimeError("FFmpeg mixing failed")

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", broken)
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202

    proj = client.get("/api/project/vs1").json()
    assert proj["vocal_split_job"]["status"] == "done"
    assert proj["master_stale"] is True
    assert Path(proj["master_audio_path"]).name == "vs1_mix_0_0.wav"
