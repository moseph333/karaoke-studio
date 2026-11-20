"""Vocal part stems on disk: which parts count as current, installing and dropping them, the
model settings, and what the capabilities endpoint says about each split."""

import json
import os
import time
from pathlib import Path

import pytest

from backend.services import capabilities, vocal_parts
from backend.tools import fetch_models

LEAD_MODEL = vocal_parts.DEFAULT_LEAD_MODEL
DUET_MODEL = vocal_parts.DEFAULT_DUET_MODEL


def _stem(path: Path, age: float = 0.0) -> Path:
    """A file that holds audio, last modified ``age`` seconds ago."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"RIFF" + b"A" * 200)
    stamp = time.time() - age
    os.utime(path, (stamp, stamp))
    return path


def _split_song(stem_dir: Path) -> None:
    """Vocals made a minute ago, split into lead and backing just now."""
    _stem(stem_dir / "vocals.wav", age=60)
    first, second = _stem(stem_dir / "work" / "a.wav"), _stem(stem_dir / "work" / "b.wav")
    plan = vocal_parts.split_plan("lead_backing")
    vocal_parts.install(
        stem_dir, "lead_backing", first, second, vocal_parts.split_record("lead_backing", plan, 12)
    )


def test_installed_parts_are_found_by_name_with_their_record(tmp_path):
    _split_song(tmp_path)

    parts = vocal_parts.current_parts(tmp_path)
    assert parts == {
        "lead": tmp_path / "vocals_lead.wav",
        "backing": tmp_path / "vocals_backing.wav",
    }
    summary = vocal_parts.splits_summary(tmp_path)
    assert list(summary) == ["lead_backing"]
    made = summary["lead_backing"]
    assert (made["model"], made["label"], made["elapsed_seconds"]) == (
        LEAD_MODEL,
        "Lead and backing vocals",
        12,
    )
    assert json.loads((tmp_path / "vocal_parts.json").read_text())["lead_backing"] == made
    # The engine's own files were moved, not copied
    assert list((tmp_path / "work").iterdir()) == []


def test_parts_older_than_their_vocals_do_not_count(tmp_path):
    _split_song(tmp_path)
    _stem(tmp_path / "vocals.wav", age=-5)  # the vocals were re-made after the split

    assert vocal_parts.current_parts(tmp_path) == {}
    assert vocal_parts.splits_summary(tmp_path) == {}


@pytest.mark.parametrize("damage", ["missing", "empty", "no vocals"])
def test_a_split_counts_only_as_a_whole_pair(tmp_path, damage):
    _split_song(tmp_path)
    if damage == "missing":
        (tmp_path / "vocals_backing.wav").unlink()
    elif damage == "empty":
        (tmp_path / "vocals_backing.wav").write_bytes(b"RIFF")
    else:
        (tmp_path / "vocals.wav").unlink()

    assert vocal_parts.current_parts(tmp_path) == {}


def test_parts_are_read_from_the_files_not_from_the_record(tmp_path):
    _split_song(tmp_path)
    (tmp_path / "vocal_parts.json").write_text("not json")

    assert set(vocal_parts.current_parts(tmp_path)) == {"lead", "backing"}
    assert vocal_parts.splits_summary(tmp_path) == {"lead_backing": {}}


def test_dropping_parts_removes_the_files_and_the_record(tmp_path):
    _split_song(tmp_path)

    removed = vocal_parts.drop_parts(tmp_path)

    assert sorted(removed) == ["vocals_backing.wav", "vocals_lead.wav"]
    assert sorted(p.name for p in tmp_path.iterdir() if p.is_file()) == ["vocals.wav"]
    assert vocal_parts.drop_parts(tmp_path) == []
    assert vocal_parts.drop_parts(None) == []
    assert vocal_parts.current_parts(None) == {}


def test_the_split_model_is_read_from_the_environment(monkeypatch):
    plan = vocal_parts.split_plan("lead_backing")
    assert (plan.engine, plan.models, plan.passes) == ("roformer", (LEAD_MODEL,), 1)
    assert plan.params["split"] == "lead_backing"
    assert plan.label == "Lead and backing vocals split"

    monkeypatch.setenv("SEPARATION_LEAD_MODEL", " mel_band_roformer_karaoke_becruily.ckpt ")
    assert vocal_parts.split_plan("lead_backing").models == (
        "mel_band_roformer_karaoke_becruily.ckpt",
    )


def test_capabilities_say_whether_each_split_can_run(monkeypatch, tmp_path):
    monkeypatch.setattr("backend.services.separation_presets.package_available", lambda name: False)
    split, voices = capabilities.get_capabilities()["separation"]["vocal_parts"]
    assert (split["id"], split["label"], split["model"]) == (
        "lead_backing",
        "Lead and backing vocals",
        LEAD_MODEL,
    )
    assert (voices["id"], voices["label"], voices["model"], voices["available"]) == (
        "male_female",
        "Male and female voices",
        DUET_MODEL,
        False,
    )
    assert split["available"] is False
    assert "audio-separator is not installed" in split["reason"]
    assert (split["runs_on"], split["weights_cached"]) == (None, False)

    # On the cloud GPU the split needs only the Modal client and credentials here
    monkeypatch.setattr("backend.services.separation_presets.package_available", lambda name: True)
    monkeypatch.setenv("SEPARATION_REMOTE", "modal")
    monkeypatch.setenv("MODAL_TOKEN_ID", "id")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "secret")
    split, voices = capabilities.get_capabilities()["separation"]["vocal_parts"]
    assert voices["available"] is True
    assert (split["available"], split["reason"]) == (True, None)
    assert (split["runs_on"], split["weights_cached"]) == ("cloud-gpu", None)
    assert vocal_parts.split_status("lead_backing") == (True, None)


def test_the_prefetch_tool_fetches_the_splitters_on_request(monkeypatch):
    assert fetch_models.vocal_part_models("none") == []
    assert fetch_models.vocal_part_models("all") == [LEAD_MODEL, DUET_MODEL]
    assert fetch_models.vocal_part_models("male_female") == [DUET_MODEL]

    jobs = fetch_models.commands("balanced", demucs=False, vocal_parts="lead_backing")
    [(label, cmd)] = jobs
    models = cmd[cmd.index("--models") + 1 : cmd.index("--model-dir")]
    assert models[-1] == LEAD_MODEL and len(models) == 2
    assert LEAD_MODEL in label

    # Without the flag, exactly the weights fetched before
    [(_, plain)] = fetch_models.commands("balanced", demucs=False)
    assert LEAD_MODEL not in plain


# --- The male and the female voice ---------------------------------------------------


def _split_voices(stem_dir: Path) -> None:
    """Splits the song's lead (or whole vocals) into a male and a female voice just now."""
    first, second = _stem(stem_dir / "work" / "m.wav"), _stem(stem_dir / "work" / "f.wav")
    plan = vocal_parts.split_plan("male_female")
    source = vocal_parts.source_name(stem_dir, "male_female")
    vocal_parts.install(
        stem_dir,
        "male_female",
        first,
        second,
        vocal_parts.split_record("male_female", plan, 20, source=source),
    )


def test_the_voices_plan_tells_the_worker_which_stem_tags_to_take(monkeypatch):
    plan = vocal_parts.split_plan("male_female")

    assert plan.models == (DUET_MODEL,)
    assert (plan.params["first_tags"], plan.params["second_tags"]) == (("male",), ("female",))
    assert plan.label == "Male and female voices split"
    # The lead/backing model's outputs carry the usual tags
    assert "first_tags" not in vocal_parts.split_plan("lead_backing").params

    monkeypatch.setenv("SEPARATION_DUET_MODEL", "model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt")
    assert vocal_parts.split_plan("male_female").models == (
        "model_chorus_bs_roformer_ep_267_sdr_24.1275.ckpt",
    )


def test_voices_are_split_from_the_whole_vocals_of_a_song_without_a_lead(tmp_path):
    _stem(tmp_path / "vocals.wav", age=60)
    assert vocal_parts.source_path(tmp_path, "male_female") == tmp_path / "vocals.wav"

    _split_voices(tmp_path)

    assert set(vocal_parts.current_parts(tmp_path)) == {"male", "female"}
    assert vocal_parts.splits_summary(tmp_path)["male_female"]["source"] == "vocals"


def test_voices_are_split_from_the_lead_once_there_is_one(tmp_path):
    _split_song(tmp_path)
    assert vocal_parts.source_name(tmp_path, "male_female") == "lead"
    assert vocal_parts.source_path(tmp_path, "male_female") == tmp_path / "vocals_lead.wav"

    _split_voices(tmp_path)

    assert set(vocal_parts.current_parts(tmp_path)) == {"lead", "backing", "male", "female"}
    summary = vocal_parts.splits_summary(tmp_path)
    assert list(summary) == ["lead_backing", "male_female"]
    assert summary["male_female"]["source"] == "lead"


def test_a_new_lead_retires_the_voices_split_before_it(tmp_path):
    _stem(tmp_path / "vocals.wav", age=60)
    _split_voices(tmp_path)

    _split_song(tmp_path)  # lead and backing, made afterwards

    assert set(vocal_parts.current_parts(tmp_path)) == {"lead", "backing"}
    assert not (tmp_path / "vocals_male.wav").exists()
    assert not (tmp_path / "vocals_female.wav").exists()
    assert list(json.loads((tmp_path / "vocal_parts.json").read_text())) == ["lead_backing"]


def test_voices_split_from_a_lead_that_is_gone_do_not_count(tmp_path):
    _split_song(tmp_path)
    _split_voices(tmp_path)
    (tmp_path / "vocals_lead.wav").unlink()  # the lead/backing pair is no longer whole

    assert vocal_parts.current_parts(tmp_path) == {}


def test_voices_older_than_the_lead_they_were_split_from_do_not_count(tmp_path):
    _split_song(tmp_path)
    _split_voices(tmp_path)
    for name in ("vocals_male.wav", "vocals_female.wav"):
        _stem(tmp_path / name, age=30)
    for name in ("vocals_lead.wav", "vocals_backing.wav"):
        _stem(tmp_path / name, age=0)

    assert set(vocal_parts.current_parts(tmp_path)) == {"lead", "backing"}


def test_dropping_parts_removes_the_voices_too(tmp_path):
    _split_song(tmp_path)
    _split_voices(tmp_path)

    assert len(vocal_parts.drop_parts(tmp_path)) == 4
    assert sorted(p.name for p in tmp_path.iterdir() if p.is_file()) == ["vocals.wav"]
