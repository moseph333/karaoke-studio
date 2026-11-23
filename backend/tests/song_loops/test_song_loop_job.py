"""Making a finished song's loop through the API: the background job, what refuses it,
cancelling it, removing the loop, and what the song has afterwards."""

import json
import threading
import time

import pytest

import backend.main as main_mod
from backend import config, song_loop, update_drain
from backend.services import remote_song_loop, song_loops
from backend.tests.helpers.song_loops import LOOP_VIDEO, SCENE, fake_maker, stand_in_cloud
from backend.tests.helpers.split_songs import make_song


@pytest.fixture
def song(monkeypatch):
    """A finished song on a server that can make loops, with the cloud stood in for."""
    proj = make_song(main_mod, "sl1", artist="The Lanterns")
    log = stand_in_cloud(monkeypatch)
    return {"proj": proj, "log": log, "file": main_mod.OUTPUT_DIR / "sl1_loop.mp4"}


def test_a_loop_is_made_from_the_lyrics_and_kept_beside_the_renders(client, song):
    res = client.post("/api/project/sl1/song-loop", json={})
    assert res.status_code == 202
    queued = res.json()["job"]
    assert (queued["status"], queued["prompt"]) == ("queued", None)

    proj = client.get("/api/project/sl1").json()
    job = proj["song_loop_job"]
    assert (job["status"], job["progress"], job["id"]) == ("done", 100, queued["id"])
    assert job["detail"] == "The song loop is ready"
    # The cloud got the song, and no scene: it writes one
    assert song["log"] == [
        {
            "title": "Song",
            "artist": "The Lanterns",
            "model": "wan22",
            "lyrics": "hello world\nhello you",
        }
    ]

    assert song["file"].read_bytes() == LOOP_VIDEO
    assert not (main_mod.OUTPUT_DIR / "sl1_loop.part.mp4").exists()
    loop = proj["song_loop"]
    assert loop["url"].startswith("/static/output/sl1_loop.mp4?v=")
    assert (loop["prompt"], loop["written_from"]) == (SCENE, "lyrics")
    assert (loop["model"], loop["model_label"], loop["seed"]) == ("wan22", "Wan 2.2 (5B)", 7)
    assert (loop["width"], loop["height"], loop["duration"]) == (1280, 704, 4.04)
    assert song_loops.current_file(main_mod.projects["sl1"]) == song["file"]
    assert "sl1_song_loop" not in main_mod.active_cancellations
    # The status the studio polls carries the job and the loop
    status = client.get("/api/project/sl1/status").json()
    assert status["song_loop_job"]["status"] == "done"
    assert status["song_loop"]["prompt"] == SCENE


def test_a_typed_scene_is_sent_instead_of_the_lyrics(client, song):
    res = client.post(
        "/api/project/sl1/song-loop", json={"prompt": "  A field of wheat\n under slow clouds "}
    )
    assert res.status_code == 202
    assert res.json()["job"]["prompt"] == "A field of wheat under slow clouds"
    [request] = song["log"]
    assert request["prompt"] == "A field of wheat under slow clouds"
    assert "lyrics" not in request
    loop = main_mod.projects["sl1"]["song_loop"]
    assert (loop["prompt"], loop["written_from"]) == ("A field of wheat under slow clouds", "typed")


def test_the_model_is_the_servers_setting(client, song, monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "LTX")
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    assert song["log"][0]["model"] == "ltx"
    monkeypatch.setenv("SONG_LOOP_MODEL", "sora")
    assert song_loops.configured_model() == "wan22"


def test_making_it_again_replaces_the_loop(client, song, monkeypatch):
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    monkeypatch.setattr(remote_song_loop, "make", fake_maker(song["log"], video=b"second loop"))

    assert client.post("/api/project/sl1/song-loop", json={"prompt": "Rain"}).status_code == 202

    assert song["file"].read_bytes() == b"second loop"
    assert main_mod.projects["sl1"]["song_loop"]["prompt"] == "Rain"


def test_a_failed_run_keeps_the_loop_the_song_had(client, song, monkeypatch):
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    before = dict(main_mod.projects["sl1"]["song_loop"])

    def fails(request, output_path, on_progress, cancel_event):
        output_path.write_bytes(b"half a loop")
        raise RuntimeError("The cloud GPU could not make the loop (exit 5): out of video memory")

    monkeypatch.setattr(remote_song_loop, "make", fails)
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202

    proj = client.get("/api/project/sl1").json()
    job = proj["song_loop_job"]
    assert (job["status"], job["detail"]) == (
        "error",
        "Could not make the song loop; the song is unchanged",
    )
    assert "out of video memory" in job["error"]
    assert proj["song_loop"] == before
    assert song["file"].read_bytes() == LOOP_VIDEO
    assert not (main_mod.OUTPUT_DIR / "sl1_loop.part.mp4").exists()
    assert "sl1_song_loop" not in main_mod.active_cancellations


def test_what_comes_back_must_be_a_video(client, song, monkeypatch):
    def not_a_video(path):
        raise RuntimeError("The loop that came back is not a video")

    monkeypatch.setattr(song_loops, "probe_video", not_a_video)
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202

    proj = client.get("/api/project/sl1").json()
    assert proj["song_loop_job"]["error"] == "The loop that came back is not a video"
    assert proj.get("song_loop") is None
    assert not song["file"].exists()


@pytest.mark.parametrize(
    ("probed", "size"),
    [
        ({"width": 8, "height": 8, "duration": 4.0}, 100),
        ({"width": 1280, "height": 704, "duration": 0.2}, 100),
        ({"width": 1280, "height": 704, "duration": 4.0}, song_loops.MAX_LOOP_BYTES + 1),
        ({"width": 1280, "height": 704, "duration": 4.0}, 0),
    ],
)
def test_a_loop_no_render_could_take_is_refused(tmp_path, monkeypatch, probed, size):
    video = tmp_path / "loop.mp4"
    with video.open("wb") as handle:
        handle.truncate(size)
    monkeypatch.setattr(song_loops, "probe_video", lambda path: dict(probed))
    with pytest.raises(RuntimeError, match="The loop that came back"):
        song_loops.check_video(video)


def test_cancelling_a_running_loop(client, song, monkeypatch):
    started = threading.Event()

    def waits_for_cancel(request, output_path, on_progress, cancel_event):
        started.set()
        assert cancel_event.wait(5)
        raise remote_song_loop.SongLoopCancelled("The song loop was cancelled")

    monkeypatch.setattr(remote_song_loop, "make", waits_for_cancel)
    job = song_loop.create_job(song["proj"], None)
    main_mod.active_cancellations[song_loop.cancel_key("sl1")] = threading.Event()
    worker = threading.Thread(target=song_loop.run_song_loop, args=("sl1", job["id"]))
    worker.start()
    assert started.wait(5)

    res = client.post("/api/project/sl1/song-loop/cancel")
    assert res.json()["status"] == "cancelling"
    worker.join(5)
    assert not worker.is_alive()

    job = client.get("/api/project/sl1").json()["song_loop_job"]
    assert (job["status"], job["error"]) == ("cancelled", None)
    assert job["detail"] == "Cancelled; the song is unchanged"
    assert not song["file"].exists()
    assert client.post("/api/project/sl1/song-loop/cancel").json()["status"] == "idle"


def test_a_queued_loop_can_be_cancelled_before_it_starts(song, monkeypatch):
    monkeypatch.setattr(song_loop, "SONG_LOOP_SEMAPHORE", threading.Semaphore(0))
    job = song_loop.create_job(song["proj"], None)
    cancel = threading.Event()
    main_mod.active_cancellations[song_loop.cancel_key("sl1")] = cancel
    threading.Timer(0.2, cancel.set).start()

    started = time.monotonic()
    song_loop.run_song_loop("sl1", job["id"])

    assert time.monotonic() - started < 3
    assert song["proj"]["song_loop_job"]["status"] == "cancelled"
    assert song["log"] == []


def test_a_loop_takes_none_of_the_job_slots(client, song, monkeypatch):
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(0))
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    assert main_mod.projects["sl1"]["song_loop_job"]["status"] == "done"


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"status": "separating"}, "still being processed"),
        ({"status": "error"}, "Only a finished song"),
        ({"status": "album"}, "Only a finished song"),
        ({"song_loop_job": {"id": "j0", "status": "running"}}, "already being made"),
    ],
)
def test_a_loop_is_refused_for_a_song_that_cannot_take_one(client, song, change, message):
    song["proj"].update(change)
    main_mod.active_cancellations[song_loop.cancel_key("sl1")] = threading.Event()

    res = client.post("/api/project/sl1/song-loop", json={})

    assert res.status_code == 409
    assert message in res.json()["detail"]
    assert song["log"] == []


@pytest.mark.parametrize(
    "busy",
    [
        {"render_status": "rendering"},
        {"separation_job": {"id": "j0", "status": "running"}},
        {"sync_job": {"id": "j0", "status": "queued"}},
        {"vocal_split_job": {"id": "j0", "status": "running"}},
    ],
)
def test_a_loop_runs_beside_the_songs_other_jobs(client, song, busy):
    song["proj"].update(busy)
    for key in ("sl1_render", "sl1_reseparate", "sl1_sync", "sl1_vocal_split"):
        main_mod.active_cancellations[key] = threading.Event()

    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    assert song["file"].is_file()


def test_other_jobs_do_not_wait_for_a_loop(client, song):
    song["proj"]["song_loop_job"] = {"id": "j0", "status": "running"}
    main_mod.active_cancellations[song_loop.cancel_key("sl1")] = threading.Event()

    res = client.post("/api/project/sl1/reseparate", json={"quality": "fast"})

    assert res.status_code == 202


def test_a_loop_left_running_by_a_restart_is_settled(client, song):
    song["proj"]["song_loop_job"] = {"id": "j0", "status": "running", "progress": 40}

    job = client.get("/api/project/sl1").json()["song_loop_job"]

    assert (job["status"], job["error"]) == ("error", "Interrupted by a server restart")
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202


def test_a_loop_rejects_bad_requests(client, song, monkeypatch):
    assert client.post("/api/project/nope/song-loop", json={}).status_code == 404
    too_long = {"prompt": "x" * (song_loops.MAX_PROMPT_CHARS + 1)}
    assert client.post("/api/project/sl1/song-loop", json=too_long).status_code == 422

    song["proj"].update(lines=[], title="")
    res = client.post("/api/project/sl1/song-loop", json={})
    assert res.status_code == 400
    assert "describe the loop yourself" in res.json()["detail"]
    # A typed scene is enough
    assert client.post("/api/project/sl1/song-loop", json={"prompt": "Rain"}).status_code == 202

    monkeypatch.setattr(
        remote_song_loop, "status", lambda: (False, "the modal package is not installed")
    )
    res = client.post("/api/project/sl1/song-loop", json={})
    assert res.status_code == 400
    assert res.json()["detail"] == (
        "This server cannot make song loops: the modal package is not installed"
    )


def test_a_song_without_lyrics_goes_by_its_title(client, song):
    song["proj"]["lines"] = []
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    assert song["log"][0]["lyrics"] == ""
    assert song["log"][0]["title"] == "Song"


def test_a_loop_is_refused_on_a_full_disk_after_its_other_checks(client, song, monkeypatch):
    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 10_000_000_000)

    assert client.post("/api/project/nope/song-loop", json={}).status_code == 404
    res = client.post("/api/project/sl1/song-loop", json={})

    assert res.status_code == 507
    assert "song_loop_job" not in song["proj"]
    assert "sl1_song_loop" not in main_mod.active_cancellations


def test_a_loop_waits_for_a_pending_update(client, song):
    update_drain.drain_file().write_text(json.dumps({"requested_at": time.time()}))

    res = client.post("/api/project/sl1/song-loop", json={})

    assert res.status_code == 503
    assert "song_loop_job" not in song["proj"]


def test_removing_the_loop_deletes_its_file(client, song):
    assert client.delete("/api/project/sl1/song-loop").json() == {"status": "none"}
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202

    assert client.delete("/api/project/sl1/song-loop").json() == {"status": "removed"}

    assert not song["file"].exists()
    proj = client.get("/api/project/sl1").json()
    assert proj.get("song_loop") is None
    assert client.get("/api/project/sl1/status").json()["song_loop"] is None
    assert client.delete("/api/project/nope/song-loop").status_code == 404


def test_the_loop_is_not_removed_while_another_is_being_made(client, song):
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    song["proj"]["song_loop_job"] = {"id": "j1", "status": "running"}
    main_mod.active_cancellations[song_loop.cancel_key("sl1")] = threading.Event()

    res = client.delete("/api/project/sl1/song-loop")

    assert res.status_code == 409
    assert song["file"].is_file()


def test_a_record_whose_file_is_gone_is_no_loop(client, song):
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    song["file"].unlink()
    assert song_loops.current_file(main_mod.projects["sl1"]) is None


def test_deleting_a_song_cancels_its_loop_job_and_removes_the_loop(client, song):
    assert client.post("/api/project/sl1/song-loop", json={}).status_code == 202
    cancel = threading.Event()
    main_mod.active_cancellations[song_loop.cancel_key("sl1")] = cancel

    assert client.delete("/api/project/sl1").status_code == 200

    assert cancel.is_set()
    assert not song["file"].exists()


def test_the_job_count_names_song_loops():
    main_mod.active_cancellations["a_song_loop"] = threading.Event()
    update_drain.write_jobs_active()
    written = json.loads(update_drain.jobs_file().read_text(encoding="utf-8"))
    assert written["kinds"] == {"song loop": 1}
