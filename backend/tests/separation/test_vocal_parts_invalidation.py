"""Vocal parts follow the vocals they were split from: re-made stems retire them, and a song
that finds current parts beside its stems takes them as its own."""

import os
import time
from pathlib import Path

import pytest

import backend.main as main_mod
from backend.pipeline import separate_project_stems
from backend.services import separation_presets as presets
from backend.services import vocal_parts
from backend.services.separator import AudioSeparator
from backend.tests.helpers.split_songs import fake_splitter, level, make_song, wav


@pytest.fixture
def split_song(client, monkeypatch):
    """A finished song whose vocals have been split into lead and backing."""
    proj = make_song(main_mod)
    monkeypatch.setattr(vocal_parts, "split_status", lambda kind: (True, None))
    monkeypatch.setattr(main_mod.separator, "split_vocals", fake_splitter(main_mod, []))
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    assert list(proj["vocal_splits"]) == ["lead_backing"]
    return {"proj": proj, "stems": main_mod.STEMS_DIR / "vs1"}


def test_reseparation_drops_the_parts_and_says_so(client, split_song, monkeypatch):
    def fake_separate(audio_path, track_id, model_name="htdemucs", **kwargs):
        target = main_mod.STEMS_DIR / track_id
        return {
            "vocals_path": str(wav(target / "vocals.wav", 0.7)),
            "instrumental_path": str(wav(target / "instrumental.wav", 0.6)),
            "separation": {"preset": model_name, "label": presets.PRESET_LABELS[model_name]},
        }

    def fake_mix(*, instrumental_path, vocals_path, semitones, guide_volume, output_filename):
        return str(wav(main_mod.OUTPUT_DIR / output_filename))

    monkeypatch.setattr(main_mod.separator, "separate_stems", fake_separate)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    monkeypatch.setattr(
        main_mod.vocal_analyzer, "analyze_vocals", lambda path: {"lowest_note": "C3"}
    )
    monkeypatch.setattr(main_mod.chord_detector, "detect_chords", lambda path: [])

    assert client.post("/api/project/vs1/reseparate", json={"quality": "best"}).status_code == 202

    proj = client.get("/api/project/vs1").json()
    job = proj["separation_job"]
    assert job["status"] == "done"
    assert job["detail"] == (
        "Stems re-made with Best · RoFormer ensemble. "
        "The vocal parts were split from the old vocals, so split them again"
    )
    assert "vocal_splits" not in proj
    assert level(split_song["stems"] / "vocals.wav") == pytest.approx(0.7, abs=1e-3)
    assert sorted(p.name for p in split_song["stems"].iterdir()) == [
        "instrumental.wav",
        "separation.json",
        "vocals.wav",
    ]


def test_a_reseparation_of_a_song_without_parts_warns_about_nothing(client, monkeypatch):
    make_song(main_mod)

    def fake_separate(audio_path, track_id, model_name="htdemucs", **kwargs):
        target = main_mod.STEMS_DIR / track_id
        return {
            "vocals_path": str(wav(target / "vocals.wav", 0.7)),
            "instrumental_path": str(wav(target / "instrumental.wav", 0.6)),
            "separation": {"preset": model_name, "label": presets.PRESET_LABELS[model_name]},
        }

    def fake_mix(*, instrumental_path, vocals_path, semitones, guide_volume, output_filename):
        return str(wav(main_mod.OUTPUT_DIR / output_filename))

    monkeypatch.setattr(main_mod.separator, "separate_stems", fake_separate)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    monkeypatch.setattr(main_mod.vocal_analyzer, "analyze_vocals", lambda path: {})
    monkeypatch.setattr(main_mod.chord_detector, "detect_chords", lambda path: [])

    assert client.post("/api/project/vs1/reseparate", json={"quality": "best"}).status_code == 202

    job = client.get("/api/project/vs1").json()["separation_job"]
    assert job["detail"] == "Stems re-made with Best · RoFormer ensemble"
    assert "warnings" not in job


def test_separating_in_place_at_a_better_quality_drops_the_parts(tmp_path, monkeypatch):
    """An intake retried at a better preset replaces vocals.wav where the parts are."""
    stems = tmp_path / "stems"
    target = stems / "trk"
    wav(target / "vocals.wav")
    wav(target / "instrumental.wav")
    for name in ("vocals_lead.wav", "vocals_backing.wav"):
        wav(target / name)
    (target / "vocal_parts.json").write_text('{"lead_backing": {"model": "m"}}')
    assert set(vocal_parts.current_parts(target)) == {"lead", "backing"}

    separator = AudioSeparator(output_base_dir=stems)

    def fake_run(plan, audio_file, target_dir, report, cancel_event):
        wav(target_dir / "htdemucs" / "song" / "vocals.wav", 0.5)
        wav(target_dir / "htdemucs" / "song" / "no_vocals.wav", 0.5)

    monkeypatch.setattr(separator, "_run_plan", fake_run)
    separator.separate_stems(str(wav(tmp_path / "song.wav")), "trk", model_name="fast")
    # Cached at Fast: nothing ran, and the parts are still there
    assert set(vocal_parts.current_parts(target)) == {"lead", "backing"}

    monkeypatch.setattr(
        "backend.services.separator.plan_status", lambda plan: (plan.preset == "fast", "no")
    )
    (target / "separation.json").unlink(missing_ok=True)
    (target / "vocals.wav").write_bytes(b"RIFF")  # corrupt: the stems are made again
    separator.separate_stems(str(tmp_path / "song.wav"), "trk", model_name="fast")

    assert vocal_parts.current_parts(target) == {}
    assert not (target / "vocals_lead.wav").exists()
    assert not (target / "vocal_parts.json").exists()


def test_an_intake_adopts_current_parts_found_beside_its_stems(split_song, monkeypatch):
    """The same link processed again: its project is new, the stems and parts are not."""
    stems = split_song["stems"]
    main_mod.projects["vs1"] = {"id": "vs1", "status": "separating", "vocal_splits": {"x": {}}}

    def cached(**kwargs):
        return {
            "vocals_path": str(stems / "vocals.wav"),
            "instrumental_path": str(stems / "instrumental.wav"),
        }

    monkeypatch.setattr(main_mod.separator, "separate_stems", cached)
    separate_project_stems(main_mod, "vs1", "song.wav", "vs1", 30.0, lambda *a, **k: None, None)

    assert list(main_mod.projects["vs1"]["vocal_splits"]) == ["lead_backing"]

    # ... and forgets parts that are no longer current
    stale = time.time() - 3600
    os.utime(stems / "vocals_lead.wav", (stale, stale))
    separate_project_stems(main_mod, "vs1", "song.wav", "vs1", 30.0, lambda *a, **k: None, None)
    assert "vocal_splits" not in main_mod.projects["vs1"]


def test_deleting_one_of_two_songs_that_share_stems_keeps_the_parts(client, split_song):
    other = dict(split_song["proj"], id="vs2", track_id="vs1")
    main_mod.projects["vs2"] = other
    split_song["proj"]["track_id"] = "vs1"

    assert client.delete("/api/project/vs2").status_code == 200

    assert set(vocal_parts.current_parts(Path(split_song["stems"]))) == {"lead", "backing"}
