"""The cloud client for song loops: what it sends, the progress it reads from the worker's
lines, what it saves, and how each way of failing is told. A stand-in `modal` module
replaces the real client, so nothing leaves the machine."""

import json
import shutil
import subprocess
import threading

import pytest

from backend.services import capabilities, remote_song_loop, song_loops
from backend.services import separation_presets as presets
from backend.services.modal_jobs import STARTED
from backend.tests.helpers.song_loops import FakeCall, install_fake_modal

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")

MADE = {
    "returncode": 0,
    "video": b"a loop",
    "prompt": "Rain on a window",
    "written_from": "lyrics",
    "model": "wan22",
    "model_label": "Wan 2.2 (5B)",
    "seed": 3,
    "gpu": "NVIDIA L40S",
    "seconds": {"text": 12.0, "video": 240.0, "loop": 3.0},
    "total_seconds": 260.0,
}


@pytest.fixture
def cloud(monkeypatch):
    monkeypatch.setenv("SONG_LOOP_REMOTE", "modal")
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")
    return install_fake_modal(monkeypatch)


def make(tmp_path, request=None, cancel_event=None):
    seen: list[tuple] = []
    request = request or {"lyrics": "hello", "title": "Song", "artist": "", "model": "wan22"}
    made = remote_song_loop.make(
        request, tmp_path / "out" / "loop.part.mp4", lambda *args: seen.append(args), cancel_event
    )
    return made, seen


def event(**fields) -> str:
    return json.dumps({"event": "stage", **fields}) + "\n"


def test_a_loop_is_saved_with_what_it_was_made_from(tmp_path, cloud):
    cloud.items = [
        STARTED,
        event(detail="Loading Qwen3 4B to read the lyrics…", pct=2),
        event(detail="Wan 2.2 (5B) drawing the loop (step 25 of 50)", pct=52.5),
        event(detail="Song loop ready", pct=100),
    ]
    cloud.call = FakeCall(dict(MADE))

    made, seen = make(tmp_path)

    assert (tmp_path / "out" / "loop.part.mp4").read_bytes() == b"a loop"
    assert made == {key: MADE[key] for key in remote_song_loop.RESULT_KEYS}
    assert cloud.target == ("karaoke-studio-gpu", "song_loop")
    # Empty values are left out, so the function's own defaults stand
    sent = {key: value for key, value in cloud.kwargs.items() if key != "lines"}
    assert sent == {"lyrics": "hello", "title": "Song", "model": "wan22"}
    assert seen[0] == (None, "Waiting for a cloud GPU…", None)
    assert (None, "A cloud GPU is making the loop…", None) in seen
    assert (52.5, "Wan 2.2 (5B) drawing the loop (step 25 of 50)", None) in seen
    assert seen[-1] == (100.0, "Song loop ready", None)


def test_the_workers_own_error_is_the_reason(tmp_path, cloud):
    failure = {"event": "error", "code": "failed", "detail": "RuntimeError: out of video memory"}
    cloud.items = [STARTED, json.dumps(failure) + "\n"]
    cloud.call = FakeCall({"returncode": 5, "gpu": "NVIDIA A10G"})

    with pytest.raises(RuntimeError) as failed:
        make(tmp_path)

    assert str(failed.value) == (
        "The cloud GPU could not make the loop (exit 5): RuntimeError: out of video memory"
    )
    assert not (tmp_path / "out").exists()


def test_a_deployment_without_the_function_is_unavailable(tmp_path, cloud):
    cloud.lookup_error = cloud.errors.NotFoundError("Function 'song_loop' not found")
    with pytest.raises(remote_song_loop.RemoteUnavailable, match="song_loop"):
        make(tmp_path)


def test_no_gpu_in_time_is_unavailable(tmp_path, cloud, monkeypatch):
    monkeypatch.setenv("SONG_LOOP_REMOTE_QUEUE_SEC", "0.01")
    cloud.call = FakeCall(dict(MADE))
    cloud.call.polls_left = 10**9
    with pytest.raises(remote_song_loop.RemoteUnavailable):
        make(tmp_path)
    assert cloud.call.cancelled


def test_a_cancel_stops_the_cloud_job(tmp_path, cloud):
    cancel = threading.Event()
    cancel.set()
    cloud.items = [STARTED]
    cloud.call = FakeCall(dict(MADE))
    cloud.call.polls_left = 10**9
    with pytest.raises(remote_song_loop.SongLoopCancelled):
        make(tmp_path, cancel_event=cancel)
    assert cloud.call.cancelled


def test_the_functions_own_time_limit_names_the_deploy_setting(tmp_path, cloud):
    cloud.items = [STARTED]
    cloud.call = FakeCall(error=cloud.errors.FunctionTimeoutError("timed out"))
    with pytest.raises(RuntimeError, match="SONG_LOOP_REMOTE_TIMEOUT_SEC"):
        make(tmp_path)


def test_song_loops_are_off_until_the_server_is_given_a_cloud_gpu(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))  # no ~/.modal.toml either
    assert remote_song_loop.backend() is None
    said = capabilities.get_capabilities()["song_loop"]
    assert (said["available"], said["runs_on"]) == (False, None)
    assert said["reason"] == "it has no cloud GPU set up for them (SONG_LOOP_REMOTE)"
    assert (said["model"], said["model_label"]) == ("wan22", "Wan 2.2 (5B)")
    assert [choice["id"] for choice in said["models"]] == ["wan22", "ltx"]
    assert said["max_prompt_chars"] == song_loops.MAX_PROMPT_CHARS

    monkeypatch.setenv("SONG_LOOP_REMOTE", "modal")
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")
    said = capabilities.get_capabilities()["song_loop"]
    assert said["available"] is False and "MODAL_TOKEN" in said["reason"]

    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    said = capabilities.get_capabilities()["song_loop"]
    assert (said["available"], said["reason"], said["runs_on"]) == (True, None, "cloud-gpu")


def test_the_capabilities_route_carries_song_loops(client):
    assert client.get("/api/capabilities").json()["song_loop"]["available"] is False


def test_the_client_and_the_function_agree_on_the_result_keys():
    from backend.services.process_watchdog import PROJECT_ROOT

    function = (PROJECT_ROOT / "gpu" / "modal_app.py").read_text(encoding="utf-8")
    worker = (PROJECT_ROOT / "backend" / "workers" / "song_loop_worker.py").read_text()
    assert f'FUNCTION_NAME = "{remote_song_loop.FUNCTION_NAME}"' and "def song_loop(" in function
    for key in remote_song_loop.RESULT_KEYS:
        assert f'"{key}"' in function or f'"{key}"' in worker


@needs_ffmpeg
def test_a_real_video_is_probed(tmp_path):
    video = tmp_path / "loop.mp4"
    source = "testsrc=size=320x180:rate=24:duration=2"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", source, "-pix_fmt", "yuv420p", str(video)],
        check=True,
    )
    info = song_loops.check_video(video)
    assert (info["width"], info["height"]) == (320, 180)
    assert info["duration"] == pytest.approx(2.0, abs=0.1)

    (tmp_path / "words.mp4").write_text("not a video at all")
    with pytest.raises(RuntimeError, match="is not a video"):
        song_loops.check_video(tmp_path / "words.mp4")
