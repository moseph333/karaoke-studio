"""Splitting a finished song's vocals into parts through the API: the background job, what
refuses it, cancelling it, and what the song has afterwards."""

import json
import os
import threading
import time

import pytest

import backend.main as main_mod
from backend import config, realignment, reseparation, update_drain, vocal_split
from backend.services import vocal_parts
from backend.services.separator import SeparationCancelled
from backend.tests.helpers.split_songs import fake_splitter, level, make_song

LEAD_MODEL = vocal_parts.DEFAULT_LEAD_MODEL


@pytest.fixture
def song(monkeypatch):
    """A finished song on a server that can split vocals, with a stand-in for the model."""
    proj = make_song(main_mod)
    log: list = []
    monkeypatch.setattr(vocal_parts, "split_status", lambda kind: (True, None))
    monkeypatch.setattr(main_mod.separator, "split_vocals", fake_splitter(main_mod, log))
    return {"proj": proj, "log": log, "stems": main_mod.STEMS_DIR / "vs1"}


def test_a_split_leaves_lead_and_backing_stems_beside_the_vocals(client, song):
    res = client.post("/api/project/vs1/vocal-split", json={"kind": "lead_backing"})
    assert res.status_code == 202
    queued = res.json()["job"]
    assert (queued["status"], queued["kind"], queued["label"]) == (
        "queued",
        "lead_backing",
        "Lead and backing vocals",
    )

    proj = client.get("/api/project/vs1").json()
    job = proj["vocal_split_job"]
    assert (job["status"], job["progress"], job["id"]) == ("done", 100, queued["id"])
    assert job["detail"] == "Lead and backing vocals are split"
    assert song["log"] == [("vocals.wav", f".staging/vs1/{queued['id']}", LEAD_MODEL)]

    assert level(song["stems"] / "vocals_lead.wav") == pytest.approx(0.2, abs=1e-3)
    assert level(song["stems"] / "vocals_backing.wav") == pytest.approx(0.1, abs=1e-3)
    # The song's own stems are untouched, and nothing is left staged
    assert level(song["stems"] / "vocals.wav") == pytest.approx(0.3, abs=1e-3)
    assert not (main_mod.STEMS_DIR / ".staging").exists()
    made = proj["vocal_splits"]["lead_backing"]
    assert (made["model"], made["label"]) == (LEAD_MODEL, "Lead and backing vocals")
    assert "vs1_vocal_split" not in main_mod.active_cancellations
    # The status the studio polls carries the job and the parts
    status = client.get("/api/project/vs1/status").json()
    assert status["vocal_split_job"]["status"] == "done"
    assert list(status["vocal_splits"]) == ["lead_backing"]


def test_the_kind_defaults_to_lead_and_backing(client, song):
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    assert song["log"][0][2] == LEAD_MODEL


def test_the_voices_of_a_song_without_a_lead_are_split_from_its_whole_vocals(client, song):
    res = client.post("/api/project/vs1/vocal-split", json={"kind": "male_female"})
    assert res.status_code == 202
    assert res.json()["job"]["label"] == "Male and female voices"

    proj = client.get("/api/project/vs1").json()
    assert proj["vocal_split_job"]["detail"] == "Male and female voices are split"
    [(source, _, model)] = song["log"]
    assert (source, model) == ("vocals.wav", vocal_parts.DEFAULT_DUET_MODEL)
    assert level(song["stems"] / "vocals_male.wav") == pytest.approx(0.2, abs=1e-3)
    assert level(song["stems"] / "vocals_female.wav") == pytest.approx(0.1, abs=1e-3)
    assert proj["vocal_splits"]["male_female"]["source"] == "vocals"


def test_the_voices_are_split_from_the_lead_once_the_song_has_one(client, song):
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    res = client.post("/api/project/vs1/vocal-split", json={"kind": "male_female"})
    assert res.status_code == 202

    assert [entry[0] for entry in song["log"]] == ["vocals.wav", "vocals_lead.wav"]
    proj = client.get("/api/project/vs1").json()
    assert list(proj["vocal_splits"]) == ["lead_backing", "male_female"]
    assert proj["vocal_splits"]["male_female"]["source"] == "lead"


def test_splitting_lead_and_backing_afterwards_retires_the_voices(client, song):
    assert (
        client.post("/api/project/vs1/vocal-split", json={"kind": "male_female"}).status_code == 202
    )
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202

    proj = client.get("/api/project/vs1").json()
    assert list(proj["vocal_splits"]) == ["lead_backing"]
    assert not (song["stems"] / "vocals_male.wav").exists()


def test_parts_that_are_already_current_are_not_split_again(client, song):
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    # A second song sharing the stems, or the same one after an intake retry
    song["proj"].pop("vocal_splits")

    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202

    assert len(song["log"]) == 1
    proj = client.get("/api/project/vs1").json()
    assert proj["vocal_split_job"]["status"] == "done"
    assert list(proj["vocal_splits"]) == ["lead_backing"]


def test_a_failed_split_leaves_the_song_as_it_was(client, song, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("RoFormer separation failed (exit 5): out of ideas")

    monkeypatch.setattr(main_mod.separator, "split_vocals", broken)
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202

    proj = client.get("/api/project/vs1").json()
    job = proj["vocal_split_job"]
    assert job["status"] == "error"
    assert job["error"] == "RoFormer separation failed (exit 5): out of ideas"
    assert job["detail"] == "Could not split the vocals; the song is unchanged"
    assert "vocal_splits" not in proj
    assert sorted(p.name for p in song["stems"].iterdir()) == ["instrumental.wav", "vocals.wav"]
    assert not (main_mod.STEMS_DIR / ".staging").exists()


def test_a_failed_second_split_keeps_the_parts_of_the_first(client, song, monkeypatch):
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    # Re-made vocals retire the parts, so the next request runs the model again
    stale = time.time() - 3600
    for name in ("vocals_lead.wav", "vocals_backing.wav"):
        os.utime(song["stems"] / name, (stale, stale))

    def broken(*args, **kwargs):
        raise RuntimeError("no GPU")

    monkeypatch.setattr(main_mod.separator, "split_vocals", broken)
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202

    assert client.get("/api/project/vs1").json()["vocal_split_job"]["status"] == "error"
    assert level(song["stems"] / "vocals_lead.wav") == pytest.approx(0.2, abs=1e-3)


def test_cancelling_a_running_split(client, song, monkeypatch):
    started = threading.Event()

    def waits_for_cancel(source_path, work_id, plan, progress_callback=None, cancel_event=None):
        started.set()
        assert cancel_event.wait(5)
        raise SeparationCancelled("RoFormer separation cancelled by user")

    monkeypatch.setattr(main_mod.separator, "split_vocals", waits_for_cancel)
    job = vocal_split.create_job(song["proj"], "lead_backing")
    main_mod.active_cancellations[vocal_split.cancel_key("vs1")] = threading.Event()
    worker = threading.Thread(target=vocal_split.run_vocal_split, args=("vs1", job["id"]))
    worker.start()
    assert started.wait(5)

    res = client.post("/api/project/vs1/vocal-split/cancel")
    assert res.json()["status"] == "cancelling"
    worker.join(5)
    assert not worker.is_alive()

    job = client.get("/api/project/vs1").json()["vocal_split_job"]
    assert (job["status"], job["error"]) == ("cancelled", None)
    assert job["detail"] == "Cancelled; the song is unchanged"
    assert vocal_parts.current_parts(song["stems"]) == {}
    assert client.post("/api/project/vs1/vocal-split/cancel").json()["status"] == "idle"


def test_a_queued_split_can_be_cancelled_before_it_starts(song, monkeypatch):
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(0))
    job = vocal_split.create_job(song["proj"], "lead_backing")
    cancel = threading.Event()
    main_mod.active_cancellations[vocal_split.cancel_key("vs1")] = cancel
    threading.Timer(0.2, cancel.set).start()

    started = time.monotonic()
    vocal_split.run_vocal_split("vs1", job["id"])

    assert time.monotonic() - started < 3
    assert song["proj"]["vocal_split_job"]["status"] == "cancelled"
    assert song["log"] == []


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"status": "separating"}, "still being processed"),
        ({"render_status": "rendering"}, "video render"),
        ({"separation_job": {"id": "j0", "status": "running"}}, "stems to finish re-making"),
        ({"sync_job": {"id": "j0", "status": "queued"}}, "lyric re-alignment to finish"),
        ({"vocal_split_job": {"id": "j0", "status": "running"}}, "already being split"),
    ],
)
def test_a_split_refuses_to_overlap_other_jobs(client, song, change, message):
    song["proj"].update(change)
    # Each job is one this server process runs, not one a restart cut off
    for job in (vocal_split, reseparation, realignment):
        main_mod.active_cancellations[job.cancel_key("vs1")] = threading.Event()

    res = client.post("/api/project/vs1/vocal-split", json={})

    assert res.status_code == 409
    assert message in res.json()["detail"]
    assert song["log"] == []


def test_other_jobs_wait_for_a_running_split(client, song):
    song["proj"]["vocal_split_job"] = {"id": "j0", "status": "running"}
    main_mod.active_cancellations[vocal_split.cancel_key("vs1")] = threading.Event()

    res = client.post("/api/project/vs1/reseparate", json={"quality": "fast"})
    assert res.status_code == 409
    assert "vocal split to finish" in res.json()["detail"]

    res = client.post(
        "/api/project/vs1/realign-lyrics", json={"fetch_lrclib": True, "background": True}
    )
    assert res.status_code == 409
    assert "vocal split to finish" in res.json()["detail"]


def test_a_split_left_running_by_a_restart_is_settled(client, song):
    song["proj"]["vocal_split_job"] = {"id": "old", "status": "running", "progress": 40}

    job = client.get("/api/project/vs1").json()["vocal_split_job"]

    assert job["status"] == "error"
    assert "server restart" in job["detail"]
    # ... and no longer blocks a new request, of this kind or another
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    song["proj"]["vocal_split_job"] = {"id": "old", "status": "running", "progress": 40}
    assert client.post("/api/project/vs1/reseparate", json={"quality": "fast"}).status_code == 202


def test_a_split_rejects_bad_requests(client, song, monkeypatch):
    assert client.post("/api/project/nope/vocal-split", json={}).status_code == 404
    assert client.post("/api/project/vs1/vocal-split", json={"kind": "choir"}).status_code == 422

    monkeypatch.setattr(
        vocal_parts, "split_status", lambda kind: (False, "audio-separator is not installed")
    )
    res = client.post("/api/project/vs1/vocal-split", json={})
    assert res.status_code == 400
    assert res.json()["detail"] == (
        "This server cannot split the vocals: audio-separator is not installed"
    )

    monkeypatch.setattr(vocal_parts, "split_status", lambda kind: (True, None))
    (song["stems"] / "vocals.wav").unlink()
    res = client.post("/api/project/vs1/vocal-split", json={})
    assert res.status_code == 400
    assert "vocal stem is missing" in res.json()["detail"]
    assert "vocal_split_job" not in song["proj"]
    assert "vs1_vocal_split" not in main_mod.active_cancellations


def test_a_split_is_refused_on_a_full_disk_after_its_other_checks(client, song, monkeypatch):
    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 10_000_000_000)

    assert client.post("/api/project/nope/vocal-split", json={}).status_code == 404
    res = client.post("/api/project/vs1/vocal-split", json={})

    assert res.status_code == 507
    assert "vocal_split_job" not in song["proj"]
    assert "vs1_vocal_split" not in main_mod.active_cancellations


def test_a_split_waits_for_a_pending_update(client, song):
    update_drain.drain_file().write_text(json.dumps({"requested_at": time.time()}))

    res = client.post("/api/project/vs1/vocal-split", json={})

    assert res.status_code == 503
    assert "vocal_split_job" not in song["proj"]


def test_deleting_a_song_cancels_its_split_and_removes_its_parts(client, song):
    assert client.post("/api/project/vs1/vocal-split", json={}).status_code == 202
    cancel = threading.Event()
    main_mod.active_cancellations[vocal_split.cancel_key("vs1")] = cancel

    assert client.delete("/api/project/vs1").status_code == 200

    assert cancel.is_set()
    assert not song["stems"].exists()
