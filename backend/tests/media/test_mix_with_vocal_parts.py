"""POST /mix with vocal levels: what the mixer is given, how the mix is named, reused,
stored and pruned, and that a song without levels is mixed exactly as before."""

import os
import time
from pathlib import Path
from unittest.mock import patch

import pytest

import backend.main as main_mod
from backend import master_audio
from backend.services import vocal_parts
from backend.tests.helpers.split_songs import level, make_song, wav


def _age(path: Path, seconds_ago: float) -> None:
    stamp = time.time() - seconds_ago
    os.utime(path, (stamp, stamp))


@pytest.fixture
def song():
    """A finished duet whose stems were made ten minutes ago."""
    proj = make_song(main_mod, track_id="vs1")
    stems = main_mod.STEMS_DIR / "vs1"
    for name in ("vocals.wav", "instrumental.wav"):
        _age(stems / name, 600)
    return {"proj": proj, "stems": stems}


@pytest.fixture
def split(song):
    """... and whose vocals were split into lead (0.2) and backing (0.1) five minutes ago."""
    stems = song["stems"]
    vocal_parts.install(
        stems,
        "lead_backing",
        wav(stems / "work" / "a.wav", 0.2),
        wav(stems / "work" / "b.wav", 0.1),
        {"model": "m"},
    )
    for name in ("vocals_lead.wav", "vocals_backing.wav"):
        _age(stems / name, 300)
    return song


@pytest.fixture
def mixer(monkeypatch):
    """Records each mixer call with the level of the vocals it was handed."""
    calls = []

    def fake_mix(*, instrumental_path, vocals_path, semitones, guide_volume, output_filename):
        calls.append(
            {
                "vocals": Path(vocals_path).name if vocals_path else None,
                "vocals_level": round(level(vocals_path), 3) if vocals_path else None,
                "semitones": semitones,
                "guide": guide_volume,
                "name": output_filename,
            }
        )
        return str(wav(main_mod.OUTPUT_DIR / output_filename, 0.9))

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    return calls


def _mix(client, **body):
    res = client.post("/api/project/vs1/mix", json=body)
    assert res.status_code == 200, res.text
    return res.json()["master_audio_url"]


def test_a_mix_without_levels_calls_the_mixer_exactly_as_before(client, split, mixer):
    url = _mix(client, semitones=2, guide_volume=0.3)

    assert mixer == [
        {
            "vocals": "vocals.wav",
            "vocals_level": 0.3,
            "semitones": 2,
            "guide": 0.3,
            "name": "vs1_mix_2_30.wav",
        }
    ]
    assert url.startswith("/static/output/vs1_mix_2_30.wav?v=")
    proj = split["proj"]
    assert (proj["semitones"], proj["guide_volume"]) == (2, 0.3)
    assert "vocal_levels" not in proj and "master_stale" not in proj


def test_backing_vocals_stay_in_while_the_lead_is_removed(client, split, mixer):
    url = _mix(client, guide_volume=0.0, vocal_levels={"backing": 1.0})

    [call] = mixer
    # The kept vocals (the backing part alone) go in at full level
    assert call["vocals"].startswith("vs1_mix_0_0_") and ".vocals.tmp_" in call["vocals"]
    assert (call["vocals_level"], call["guide"]) == (0.1, 1.0)
    name = call["name"]
    assert name.startswith("vs1_mix_0_0_") and len(name) == len("vs1_mix_0_0_12345678.wav")
    assert url.startswith(f"/static/output/{name}?v=")
    assert split["proj"]["vocal_levels"] == {"backing": 1.0}
    assert split["proj"]["master_audio_path"].endswith(name)
    # The temporary file is gone once the mixer has read it
    assert [p.name for p in main_mod.OUTPUT_DIR.iterdir() if ".tmp_" in p.name] == []


def test_lead_and_backing_each_take_their_own_level(client, split, mixer):
    _mix(client, guide_volume=0.5, vocal_levels={"backing": 1.0})

    # lead 0.2 x 0.5 + backing 0.1 x 1.0
    assert mixer[0]["vocals_level"] == 0.2
    assert mixer[0]["name"].startswith("vs1_mix_0_50_")


def test_the_same_choice_reuses_its_mix_and_another_makes_a_new_one(client, split, mixer):
    first = _mix(client, vocal_levels={"backing": 1.0})
    again = _mix(client, vocal_levels={"backing": 1.0})
    other = _mix(client, vocal_levels={"backing": 0.5})

    assert first == again
    assert len(mixer) == 2
    assert other.split("?")[0] != first.split("?")[0]


def test_a_mix_made_before_the_parts_were_split_again_is_not_reused(client, split, mixer):
    _mix(client, vocal_levels={"backing": 1.0})
    made = Path(split["proj"]["master_audio_path"])
    _age(made, 120)
    for name in ("vocals_lead.wav", "vocals_backing.wav"):
        _age(split["stems"] / name, 60)  # split again a minute ago

    _mix(client, vocal_levels={"backing": 1.0})

    assert len(mixer) == 2


def test_a_duet_partner_stays_in_during_their_lines(client, song, mixer, monkeypatch):
    seen = {}
    real = master_audio.vocal_mix.write_kept_vocals

    def spy(plan, target):
        seen["parts"] = plan.parts
        return real(plan, target)

    monkeypatch.setattr(master_audio.vocal_mix, "write_kept_vocals", spy)

    _mix(client, vocal_levels={"by": "lines", "singer1": 0.0, "singer2": 1.0})

    [part] = seen["parts"]
    assert Path(part.path).name == "vocals.wav" and part.gate is not None
    assert mixer[0]["guide"] == 1.0
    assert song["proj"]["vocal_levels"] == {"singer1": 0.0, "singer2": 1.0, "by": "lines"}


def test_levels_that_come_to_one_level_use_the_plain_mix_but_are_still_stored(client, split, mixer):
    _mix(client, guide_volume=0.4, vocal_levels={"backing": 0.4})

    assert mixer[0]["name"] == "vs1_mix_0_40.wav"
    assert mixer[0]["vocals"] == "vocals.wav"
    assert split["proj"]["vocal_levels"] == {"backing": 0.4}


def test_sending_no_levels_clears_the_stored_ones(client, split, mixer):
    _mix(client, vocal_levels={"backing": 1.0})
    _mix(client, guide_volume=0.0)

    assert "vocal_levels" not in split["proj"]
    assert mixer[-1]["name"] == "vs1_mix_0_0.wav"
    _mix(client, vocal_levels={"backing": 1.0})
    _mix(client, vocal_levels={})
    assert "vocal_levels" not in split["proj"]


def test_levels_out_of_range_are_rejected(client, split, mixer):
    for bad in ({"backing": 1.5}, {"singer1": -0.1}, {"by": "voices"}, {"backing": "loud"}):
        res = client.post("/api/project/vs1/mix", json={"vocal_levels": bad})
        assert res.status_code == 422, bad
    assert mixer == []


def test_a_failed_save_puts_the_levels_back(client, split, mixer):
    _mix(client, vocal_levels={"backing": 1.0})
    before = dict(split["proj"])

    with patch("backend.project_store.os.replace", side_effect=OSError(28, "No space left")):
        res = client.post(
            "/api/project/vs1/mix", json={"guide_volume": 0.2, "vocal_levels": {"backing": 0.3}}
        )

    assert res.status_code == 507
    for key in ("vocal_levels", "guide_volume", "master_audio_path", "master_audio_url"):
        assert split["proj"][key] == before[key]


def test_a_failed_mixer_leaves_no_kept_vocals_behind(client, split, monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("FFmpeg mixing failed")

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", broken)

    with pytest.raises(RuntimeError):
        client.post("/api/project/vs1/mix", json={"vocal_levels": {"backing": 1.0}})

    assert list(main_mod.OUTPUT_DIR.glob("*.tmp_*")) == []


# --- Pruning ---------------------------------------------------------------------------


def _cached(name: str, seconds_ago: float) -> Path:
    path = wav(main_mod.OUTPUT_DIR / name)
    _age(path, seconds_ago)
    return path


def _prune(song) -> list[str]:
    proj = song["proj"]
    return sorted(
        master_audio.prune_mix_cache(
            main_mod.OUTPUT_DIR, "vs1", proj["instrumental_path"], proj["vocals_path"]
        )
    )


def test_mixes_with_a_vocal_key_count_towards_the_songs_limit(split, monkeypatch):
    monkeypatch.setattr(master_audio.config, "MIX_CACHE_PER_SONG", 2)
    master_audio.mix_cache_epoch(main_mod.OUTPUT_DIR)
    _age(main_mod.OUTPUT_DIR / master_audio.MIX_CACHE_MARKER, 3600)
    _cached("vs1_mix_0_0_aaaaaaaa.wav", 200)
    _cached("vs1_mix_0_0_bbbbbbbb.wav", 150)
    _cached("vs1_mix_0_0.wav", 100)

    assert _prune(split) == ["vs1_mix_0_0_aaaaaaaa.wav"]


def test_a_keyed_mix_older_than_a_vocal_part_is_deleted_and_plain_ones_are_not(split):
    master_audio.mix_cache_epoch(main_mod.OUTPUT_DIR)
    _age(main_mod.OUTPUT_DIR / master_audio.MIX_CACHE_MARKER, 3600)
    # Made after the stems (10 min) but before the parts were split (5 min)
    _cached("vs1_mix_0_0_aaaaaaaa.wav", 400)
    _cached("vs1_mix_0_0.wav", 400)
    _cached("vs1_mix_0_30.wav", 400)
    _cached("vs1_mix_0_0_bbbbbbbb.wav", 100)

    assert _prune(split) == ["vs1_mix_0_0_aaaaaaaa.wav"]


def test_names_that_only_look_like_a_keyed_mix_are_never_pruned(split):
    master_audio.mix_cache_epoch(main_mod.OUTPUT_DIR)
    _age(main_mod.OUTPUT_DIR / master_audio.MIX_CACHE_MARKER, 3600)
    for name in (
        "vs1_mix_0_0_zzzzzzzz.wav",
        "vs1_mix_0_0_abc.wav",
        "vs1_mix_0_0_aaaaaaaa.vocals.tmp_1.wav",
    ):
        _cached(name, 7200)

    assert _prune(split) == []


def test_the_file_name_of_a_keyed_mix():
    assert master_audio.mix_filename("t1", -2, 0.29) == "t1_mix_-2_29.wav"
    assert master_audio.mix_filename("t1", -2, 0.29, "0a1b2c3d") == "t1_mix_-2_29_0a1b2c3d.wav"
