"""Separation quality through the API: intake choice, provenance, capabilities, re-separation."""

import os
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend import reseparation
from backend.pipeline import separate_project_stems
from backend.services import separation_presets as presets
from backend.services.separator import SeparationCancelled


def _wav(path: Path, value: float = 0.1) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.full((800, 2), value, dtype="float32"), 8000)
    return path


def _level(path: str | Path) -> float:
    return float(sf.read(str(path))[0].mean())


# ==============================================================================
# Capabilities
# ==============================================================================


def test_capabilities_explain_unavailable_presets(client, monkeypatch):
    monkeypatch.setenv("SEPARATION_QUALITY", "balanced")
    monkeypatch.setattr(presets, "package_available", lambda name: False)
    body = client.get("/api/capabilities").json()["separation"]

    assert body["default"] == "balanced"
    assert body["effective_default"] == "fast"
    assert body["downloads_allowed"] is False
    by_id = {p["id"]: p for p in body["presets"]}
    assert list(by_id) == ["fast", "balanced", "best"]
    assert by_id["fast"]["available"] is True
    assert by_id["fast"]["weights_cached"] is None
    assert by_id["balanced"]["available"] is False
    assert "audio-separator is not installed" in by_id["balanced"]["reason"]
    assert by_id["best"]["gpu_recommended"] is True
    assert by_id["best"]["models"] == list(presets.DEFAULT_BEST_MODELS)
    assert by_id["balanced"]["cpu_realtime_factor"] < by_id["best"]["cpu_realtime_factor"]


def test_capabilities_when_roformer_is_ready(client, monkeypatch):
    monkeypatch.setenv("SEPARATION_QUALITY", "best")
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", "1")
    monkeypatch.setattr(presets, "package_available", lambda name: True)
    body = client.get("/api/capabilities").json()["separation"]
    assert body["effective_default"] == "best"
    assert all(p["available"] for p in body["presets"])
    assert {p["id"]: p["weights_cached"] for p in body["presets"]} == {
        "fast": None,
        "balanced": False,
        "best": False,
    }


def test_capabilities_describe_the_alignment_engine(client):
    alignment = client.get("/api/capabilities").json()["alignment"]
    assert alignment["requested"] == alignment["effective"] == "dsp"  # pinned by the test env
    assert alignment["downloads_allowed"] is False
    assert "CC-BY-NC" in alignment["license_note"]


def test_capabilities_need_a_login(unauth_client):
    assert unauth_client.get("/api/capabilities").status_code == 401


# ==============================================================================
# Choosing a quality at intake
# ==============================================================================


def test_process_request_stores_the_chosen_quality(client, monkeypatch):
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *args, **kwargs: None)
    res = client.post(
        "/api/process", json={"url_or_id": "dQw4w9WgXcQ", "separation_quality": " Best "}
    )
    assert res.status_code == 200
    assert main_mod.projects["dQw4w9WgXcQ"]["separation_quality"] == "best"

    res = client.post("/api/process", json={"url_or_id": "aaaaaaaaaaa", "separation_quality": ""})
    assert res.status_code == 200
    assert "separation_quality" not in main_mod.projects["aaaaaaaaaaa"]

    res = client.post(
        "/api/process", json={"url_or_id": "bbbbbbbbbbb", "separation_quality": "ultra"}
    )
    assert res.status_code == 422


def test_upload_stores_the_chosen_quality(client, monkeypatch, tmp_path):
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
    song = _wav(tmp_path / "song.wav").read_bytes()
    res = client.post(
        "/api/upload-track",
        files={"file": ("song.wav", song, "audio/wav")},
        data={"separation_quality": "balanced"},
    )
    assert res.status_code == 200
    assert main_mod.projects[res.json()["project_id"]]["separation_quality"] == "balanced"

    res = client.post(
        "/api/upload-track",
        files={"file": ("song.wav", song, "audio/wav")},
        data={"separation_quality": "studio"},
    )
    assert res.status_code == 400
    assert "fast, balanced, best" in res.json()["detail"]


def test_pipeline_separates_at_the_project_quality_and_records_provenance(monkeypatch, tmp_path):
    main_mod.projects["p1"] = {"id": "p1", "status": "separating", "separation_quality": "best"}
    calls, statuses = [], []
    provenance = {"preset": "balanced", "requested": "best", "fallback_reason": "Best: no GPU"}

    def fake_separate(audio_path, track_id, model_name="htdemucs", **kwargs):
        calls.append((track_id, model_name, kwargs["duration"]))
        kwargs["progress_callback"](50.0, "Mel-Band RoFormer: chunk 5/10 (50%)", 20)
        return {"vocals_path": "/v.wav", "instrumental_path": "/i.wav", "separation": provenance}

    monkeypatch.setattr(main_mod.separator, "separate_stems", fake_separate)
    stems = separate_project_stems(
        main_mod, "p1", "/song.wav", "p1", 100.0, lambda *a, **k: statuses.append(a), None
    )

    assert calls == [("p1", "best", 100.0)]
    assert statuses[0] == (
        "separating",
        35,
        "Preparing Best · RoFormer ensemble stem separation...",
        640,
    )
    assert statuses[1][:3] == ("separating", 52, "Mel-Band RoFormer: chunk 5/10 (50%)")
    proj = main_mod.projects["p1"]
    assert proj["separation"] == provenance
    assert proj["vocals_url"] == "/static/stems/p1/vocals.wav"
    assert stems["vocals_path"] == "/v.wav"


def test_pipeline_uses_the_server_default_and_shares_cached_provenance(monkeypatch):
    shared = {"preset": "fast", "engine": "demucs", "label": "Fast · Demucs"}
    main_mod.projects["old"] = {"id": "old", "track_id": "yt1", "separation": shared}
    main_mod.projects["new"] = {"id": "new", "track_id": "yt1", "status": "separating"}
    seen = []

    def cached(audio_path, track_id, model_name="htdemucs", **kwargs):
        seen.append(model_name)
        return {"vocals_path": "/v.wav", "instrumental_path": "/i.wav"}

    monkeypatch.setattr(main_mod.separator, "separate_stems", cached)
    monkeypatch.setenv("SEPARATION_QUALITY", "balanced")
    separate_project_stems(main_mod, "new", "/s.wav", "yt1", 60.0, lambda *a, **k: None, None)

    assert seen == ["balanced"]
    assert main_mod.projects["new"]["separation"] == shared
    assert main_mod.projects["new"]["separation"] is not shared


# ==============================================================================
# Re-separation
# ==============================================================================


@pytest.fixture
def song(tmp_path, monkeypatch):
    """A finished song with stems, lyrics, chords and a master mix, plus fake engines."""
    stems = main_mod.STEMS_DIR / "rs1"
    proj = {
        "id": "rs1",
        "title": "Song",
        "status": "ready",
        "progress": 100,
        "duration": 30.0,
        "audio_path": str(_wav(main_mod.DOWNLOADS_DIR / "rs1.wav", 0.5)),
        "vocals_path": str(_wav(stems / "vocals.wav", 0.1)),
        "instrumental_path": str(_wav(stems / "instrumental.wav", 0.1)),
        "vocals_url": "/static/stems/rs1/vocals.wav",
        "instrumental_url": "/static/stems/rs1/instrumental.wav",
        "lines": [{"id": 1, "text": "hello world", "start_time": 1.0, "end_time": 2.0}],
        "chords": [{"chord": "C", "start_time": 0.0, "end_time": 2.0}],
        "semitones": 2,
        "guide_volume": 0.3,
        "separation": {"preset": "fast", "label": "Fast · Demucs"},
    }
    main_mod.projects["rs1"] = proj
    log: dict[str, list] = {"separate": [], "mix": [], "align": [], "chords": []}

    def fake_separate(
        audio_path,
        track_id,
        model_name="htdemucs",
        duration=None,
        progress_callback=None,
        cancel_event=None,
    ):
        log["separate"].append((track_id, model_name))
        progress_callback(50.0, "BS-RoFormer: chunk 5/10 (model 2 of 2) (50%)", 12)
        target = main_mod.STEMS_DIR / track_id
        return {
            "vocals_path": str(_wav(target / "vocals.wav", 0.7)),
            "instrumental_path": str(_wav(target / "instrumental.wav", 0.6)),
            "separation": {"preset": model_name, "label": presets.PRESET_LABELS[model_name]},
        }

    def fake_mix(*, instrumental_path, vocals_path, semitones, guide_volume, output_filename):
        log["mix"].append((instrumental_path, vocals_path, semitones, guide_volume))
        return str(_wav(main_mod.OUTPUT_DIR / output_filename))

    def fake_align(vocals_path, lines):
        log["align"].append(vocals_path)
        return [{**line, "realigned": True} for line in lines]

    def fake_chords(path):
        log["chords"].append(path)
        return [{"chord": "G", "start_time": 0.0, "end_time": 2.0}]

    monkeypatch.setattr(main_mod.separator, "separate_stems", fake_separate)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", fake_align)
    monkeypatch.setattr(main_mod.chord_detector, "detect_chords", fake_chords)
    monkeypatch.setattr(
        main_mod.vocal_analyzer, "analyze_vocals", lambda path: {"lowest_note": "C3"}
    )
    return {"proj": proj, "log": log, "stems": stems}


def test_reseparation_swaps_in_new_stems_and_refreshes_the_song(client, song):
    res = client.post(
        "/api/project/rs1/reseparate", json={"quality": "Best", "realign_lyrics": True}
    )
    assert res.status_code == 202
    queued = res.json()["job"]
    assert (queued["status"], queued["quality"], queued["label"]) == (
        "queued",
        "best",
        "Best · RoFormer ensemble",
    )

    proj = client.get("/api/project/rs1").json()
    job = proj["separation_job"]
    assert (job["status"], job["progress"], job["id"]) == ("done", 100, queued["id"])
    assert job["detail"] == "Stems re-made with Best · RoFormer ensemble"
    assert song["log"]["separate"] == [(f".staging/rs1/{queued['id']}", "best")]

    assert _level(song["stems"] / "vocals.wav") == pytest.approx(0.7, abs=1e-3)
    assert _level(song["stems"] / "instrumental.wav") == pytest.approx(0.6, abs=1e-3)
    assert not (main_mod.STEMS_DIR / ".staging").exists()
    assert proj["vocals_url"].startswith("/static/stems/rs1/vocals.wav?v=")
    assert proj["instrumental_url"].startswith("/static/stems/rs1/instrumental.wav?v=")
    assert proj["separation"]["preset"] == "best"
    assert proj["separation_quality"] == "best"
    assert proj["vocal_range"] == {"lowest_note": "C3"}
    assert proj["lines"][0]["realigned"] is True
    assert proj["chords"][0]["chord"] == "C"  # kept: not asked to re-detect
    assert song["log"]["mix"] == [
        (str(song["stems"] / "instrumental.wav"), str(song["stems"] / "vocals.wav"), 2, 0.3)
    ]
    assert proj["master_audio_url"].startswith("/static/output/rs1_mix_2_30.wav?v=")
    assert "rs1_reseparate" not in main_mod.active_cancellations


def test_reseparation_streams_the_aac_preview_when_enabled(client, song, monkeypatch):
    from backend import config, master_audio

    monkeypatch.setattr(config, "PREVIEW_AUDIO_FORMAT", "aac")
    monkeypatch.setattr(master_audio, "ffmpeg_has_encoder", lambda name: True)

    def fake_encode(wav_path, timeout=120):
        preview = Path(wav_path).with_suffix(".m4a")
        preview.write_bytes(b"fake aac")
        return str(preview)

    monkeypatch.setattr(main_mod.audio_mixer, "encode_preview", fake_encode)
    assert client.post("/api/project/rs1/reseparate", json={"quality": "fast"}).status_code == 202

    proj = client.get("/api/project/rs1").json()
    assert proj["separation_job"]["status"] == "done"
    assert proj["master_audio_url"].startswith("/static/output/rs1_mix_2_30.m4a?v=")
    assert proj["master_audio_path"] == str(main_mod.OUTPUT_DIR / "rs1_mix_2_30.wav")


def test_reseparation_keeps_a_custom_instrumental_and_redetects_chords_on_request(client, song):
    custom = _wav(song["stems"] / "custom_inst.wav", 0.3)
    song["proj"]["instrumental_path"] = str(custom)
    song["proj"]["instrumental_url"] = "/static/stems/rs1/custom_inst.wav"

    res = client.post(
        "/api/project/rs1/reseparate", json={"quality": "balanced", "redetect_chords": True}
    )
    assert res.status_code == 202
    proj = client.get("/api/project/rs1").json()
    assert proj["separation_job"]["status"] == "done"
    assert proj["instrumental_path"] == str(custom)
    assert proj["instrumental_url"] == "/static/stems/rs1/custom_inst.wav"
    assert song["log"]["mix"][0][0] == str(custom)
    assert song["log"]["chords"] == [str(song["stems"] / "instrumental.wav")]
    assert proj["chords"][0]["chord"] == "G"
    assert song["log"]["align"] == []  # lyrics untouched unless asked


def test_lyrics_saved_while_the_words_are_retimed_are_kept(client, song, monkeypatch):
    edited = [{"id": 1, "text": "hello there", "start_time": 1.2, "end_time": 2.4}]

    def user_saves_meanwhile(vocals_path, lines):
        main_mod.projects["rs1"]["lines"] = edited
        return [{**line, "realigned": True} for line in lines]

    monkeypatch.setattr(main_mod.aligner, "align_lyrics", user_saves_meanwhile)
    res = client.post(
        "/api/project/rs1/reseparate", json={"quality": "balanced", "realign_lyrics": True}
    )
    assert res.status_code == 202

    proj = client.get("/api/project/rs1").json()
    job = proj["separation_job"]
    assert job["status"] == "done"
    assert job["detail"] == (
        "Stems re-made with Balanced · Mel-Band RoFormer. "
        "The lyrics were edited while re-timing, so your edits were kept"
    )
    assert [(line["text"], line["start_time"]) for line in proj["lines"]] == [("hello there", 1.2)]
    assert "realigned" not in proj["lines"][0]
    assert "sync_report" not in proj
    assert proj["separation"]["preset"] == "balanced"


def test_swapped_in_stems_are_newer_than_mixes_of_the_old_ones(client, song, monkeypatch):
    fake_separate = main_mod.separator.separate_stems

    def written_a_while_ago(**kwargs):
        result = fake_separate(**kwargs)
        # The engine finished writing before the user's last mix of the old stems
        _wav(main_mod.OUTPUT_DIR / "rs1_mix_0_0.wav")
        for key in ("vocals_path", "instrumental_path"):
            stamp = time.time() - 60
            os.utime(result[key], (stamp, stamp))
        return result

    monkeypatch.setattr(main_mod.separator, "separate_stems", written_a_while_ago)
    assert client.post("/api/project/rs1/reseparate", json={"quality": "fast"}).status_code == 202
    assert client.get("/api/project/rs1").json()["separation_job"]["status"] == "done"

    mix_of_old_stems = os.path.getmtime(main_mod.OUTPUT_DIR / "rs1_mix_0_0.wav")
    for name in ("vocals.wav", "instrumental.wav"):
        assert os.path.getmtime(song["stems"] / name) >= mix_of_old_stems


def test_failed_reseparation_leaves_the_song_as_it_was(client, song, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("RoFormer separation failed (exit 5): out of ideas")

    monkeypatch.setattr(main_mod.separator, "separate_stems", broken)
    assert client.post("/api/project/rs1/reseparate", json={"quality": "best"}).status_code == 202

    proj = client.get("/api/project/rs1").json()
    job = proj["separation_job"]
    assert job["status"] == "error"
    assert job["error"] == "RoFormer separation failed (exit 5): out of ideas"
    assert job["detail"] == "Could not re-make the stems; the song keeps its previous stems"
    assert proj["vocals_url"] == "/static/stems/rs1/vocals.wav"
    assert proj["separation"]["preset"] == "fast"
    assert _level(song["stems"] / "vocals.wav") == pytest.approx(0.1, abs=1e-3)
    assert not (main_mod.STEMS_DIR / ".staging").exists()


def test_cancelling_a_running_reseparation(client, song, monkeypatch):
    started = threading.Event()

    def waits_for_cancel(audio_path, track_id, cancel_event=None, **kwargs):
        target = main_mod.STEMS_DIR / track_id
        _wav(target / "vocals.wav", 0.9)  # half-made output that must be discarded
        started.set()
        assert cancel_event.wait(5)
        raise SeparationCancelled("RoFormer separation cancelled by user")

    monkeypatch.setattr(main_mod.separator, "separate_stems", waits_for_cancel)
    proj = song["proj"]
    job = reseparation.create_job(proj, "best", False, False)
    main_mod.active_cancellations[reseparation.cancel_key("rs1")] = threading.Event()
    worker = threading.Thread(target=reseparation.run_reseparation, args=("rs1", job["id"]))
    worker.start()
    assert started.wait(5)

    res = client.post("/api/project/rs1/reseparate/cancel")
    assert res.json()["status"] == "cancelling"
    worker.join(5)
    assert not worker.is_alive()

    job = client.get("/api/project/rs1").json()["separation_job"]
    assert job["status"] == "cancelled"
    assert job["error"] is None
    assert _level(song["stems"] / "vocals.wav") == pytest.approx(0.1, abs=1e-3)
    assert not (main_mod.STEMS_DIR / ".staging").exists()
    assert client.post("/api/project/rs1/reseparate/cancel").json()["status"] == "idle"


def test_a_queued_job_can_be_cancelled_before_it_starts(song, monkeypatch):
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(0))
    job = reseparation.create_job(song["proj"], "balanced", False, False)
    cancel = threading.Event()
    main_mod.active_cancellations[reseparation.cancel_key("rs1")] = cancel
    threading.Timer(0.2, cancel.set).start()

    started = time.monotonic()
    reseparation.run_reseparation("rs1", job["id"])
    assert time.monotonic() - started < 3
    assert song["proj"]["separation_job"]["status"] == "cancelled"
    assert song["log"]["separate"] == []


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"status": "separating"}, "still being processed"),
        ({"render_status": "rendering"}, "video render"),
        ({"separation_job": {"id": "j0", "status": "running"}}, "already being re-made"),
    ],
)
def test_reseparation_refuses_to_overlap_other_jobs(client, song, change, message):
    song["proj"].update(change)
    main_mod.active_cancellations[reseparation.cancel_key("rs1")] = threading.Event()
    res = client.post("/api/project/rs1/reseparate", json={"quality": "best"})
    assert res.status_code == 409
    assert message in res.json()["detail"]


def test_a_job_left_running_by_a_restart_is_settled(client, song):
    song["proj"]["separation_job"] = {"id": "old", "status": "running", "progress": 40}
    job = client.get("/api/project/rs1").json()["separation_job"]
    assert job["status"] == "error"
    assert "server restart" in job["detail"]
    # ... and no longer blocks a new request
    assert client.post("/api/project/rs1/reseparate", json={"quality": "fast"}).status_code == 202


def test_reseparation_rejects_bad_requests(client, song):
    assert client.post("/api/project/nope/reseparate", json={"quality": "best"}).status_code == 404
    assert client.post("/api/project/rs1/reseparate", json={"quality": "max"}).status_code == 422
    assert client.post("/api/project/rs1/reseparate", json={}).status_code == 422
    Path(song["proj"]["audio_path"]).unlink()
    res = client.post("/api/project/rs1/reseparate", json={"quality": "best"})
    assert res.status_code == 400
    assert "original song audio is missing" in res.json()["detail"]


def test_deleting_a_song_cancels_its_reseparation_and_staging(client, song):
    cancel = threading.Event()
    main_mod.active_cancellations[reseparation.cancel_key("rs1")] = cancel
    staged = _wav(main_mod.STEMS_DIR / ".staging" / "rs1" / "job" / "vocals.wav")
    assert client.delete("/api/project/rs1").status_code == 200
    assert cancel.is_set()
    assert not staged.exists()
