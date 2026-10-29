"""The cloud GPU client: spawning the Modal job, following its queue, giving up and cancelling.

A stand-in `modal` module replaces the real client, so nothing leaves the machine.
"""

import ast
import queue
import sys
import threading
import types
from contextlib import contextmanager

import pytest

from backend.services import remote_separation as remote
from backend.services import separation_presets as presets
from backend.services.process_watchdog import PROJECT_ROOT


class FakeQueue:
    def __init__(self, items):
        self.items = list(items)

    def get_many(self, n_values, block=True, timeout=None):
        if not self.items:
            if block:
                raise queue.Empty
            return []
        taken, self.items = self.items[:n_values], self.items[n_values:]
        return taken


class FakeCall:
    def __init__(self, result=None, polls_before_done=1, error=None):
        self.result = result
        self.polls_left = polls_before_done
        self.error = error
        self.cancelled = False

    def get(self, timeout=None):
        if self.polls_left > 0:
            self.polls_left -= 1
            raise TimeoutError
        if self.error is not None:
            raise self.error
        return self.result

    def cancel(self):
        self.cancelled = True


@pytest.fixture
def fake_modal(monkeypatch):
    """Installs a stand-in modal client; set .call, .items and .spawn_error before running."""
    errors = types.ModuleType("modal.exception")
    for name in ("NotFoundError", "AuthError", "ConnectionError", "InternalFailure"):
        setattr(errors, name, type(name, (Exception,), {}))
    errors.FunctionTimeoutError = type("FunctionTimeoutError", (TimeoutError,), {})
    state = types.SimpleNamespace(errors=errors, call=FakeCall(), items=[], spawn_error=None)

    def from_name(app_name, name):
        state.target = (app_name, name)

        def spawn(**kwargs):
            if state.spawn_error is not None:
                raise state.spawn_error
            state.kwargs = kwargs
            return state.call

        return types.SimpleNamespace(spawn=spawn)

    @contextmanager
    def ephemeral():
        state.queue = FakeQueue(state.items)
        yield state.queue

    module = types.ModuleType("modal")
    module.Function = types.SimpleNamespace(from_name=from_name)
    module.Queue = types.SimpleNamespace(ephemeral=ephemeral)
    module.exception = errors
    monkeypatch.setitem(sys.modules, "modal", module)
    monkeypatch.setitem(sys.modules, "modal.exception", errors)
    return state


def _run(tmp_path, plan=None, cancel_event=None, **limits):
    song = tmp_path / "song.wav"
    song.write_bytes(b"RIFF-song")
    lines: list[str] = []
    started: list[bool] = []
    settings = {"timeout_s": 60.0, "stall_s": 60.0, "queue_s": 60.0, **limits}
    outcome = remote.run_remote(
        plan or presets.preset_plan("balanced"),
        song,
        tmp_path / "out",
        lines.append,
        cancel_event,
        on_started=lambda: started.append(True),
        **settings,
    )
    return outcome, lines, started


def test_a_job_streams_worker_lines_and_saves_both_stems(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED, "Loading model 1\n", '{"event": "stage"}\n']
    fake_modal.call = FakeCall({"returncode": 0, "vocals": b"RIFFv", "no_vocals": b"RIFFn"})

    outcome, lines, started = _run(tmp_path, plan=presets.preset_plan("best"))

    assert outcome == remote.RemoteOutcome(0)
    assert lines == ["Loading model 1\n", '{"event": "stage"}\n']
    assert started == [True]
    assert (tmp_path / "out" / "vocals.wav").read_bytes() == b"RIFFv"
    assert (tmp_path / "out" / "no_vocals.wav").read_bytes() == b"RIFFn"
    assert fake_modal.target == ("karaoke-studio-gpu", "separate")
    kwargs = fake_modal.kwargs
    assert kwargs["audio"] == b"RIFF-song"
    assert kwargs["filename"] == "song.wav"
    assert kwargs["models"] == list(presets.DEFAULT_BEST_MODELS)
    assert (kwargs["overlap"], kwargs["ensemble"]) == (4, "avg_wave")
    assert kwargs["lines"] is fake_modal.queue


def test_no_gpu_in_time_cancels_the_job_and_reports_unavailable(tmp_path, fake_modal):
    fake_modal.call = FakeCall(polls_before_done=10**9)

    with pytest.raises(remote.RemoteUnavailable, match="no cloud GPU started the job"):
        _run(tmp_path, queue_s=0.01)
    assert fake_modal.call.cancelled


def test_a_job_that_goes_silent_is_stopped(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED]
    fake_modal.call = FakeCall(polls_before_done=10**9)

    outcome, _, started = _run(tmp_path, stall_s=0.01)

    assert outcome == remote.RemoteOutcome(None, "stalled")
    assert started == [True]
    assert fake_modal.call.cancelled


def test_the_overall_time_limit_stops_the_job(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED]
    fake_modal.call = FakeCall(polls_before_done=10**9)

    outcome, _, _ = _run(tmp_path, timeout_s=0.01)

    assert outcome == remote.RemoteOutcome(None, "timeout")
    assert fake_modal.call.cancelled


def test_cancel_stops_the_job(tmp_path, fake_modal):
    fake_modal.call = FakeCall(polls_before_done=10**9)
    cancel = threading.Event()
    cancel.set()

    outcome, _, _ = _run(tmp_path, cancel_event=cancel)

    assert outcome == remote.RemoteOutcome(None, "cancelled")
    assert fake_modal.call.cancelled


def test_a_missing_app_or_bad_credentials_mean_unavailable(tmp_path, fake_modal):
    fake_modal.spawn_error = fake_modal.errors.NotFoundError("App 'karaoke-studio-gpu' not found")

    with pytest.raises(remote.RemoteUnavailable, match="NotFoundError"):
        _run(tmp_path)


def test_a_job_that_raises_counts_as_a_failure(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED]
    fake_modal.call = FakeCall(polls_before_done=0, error=RuntimeError("boom"))

    outcome, lines, _ = _run(tmp_path)

    assert outcome == remote.RemoteOutcome(1)
    assert lines == ["The cloud GPU job failed: RuntimeError: boom"]


def test_the_gpu_functions_own_time_limit_is_a_timeout(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED]
    fake_modal.call = FakeCall(polls_before_done=0, error=fake_modal.errors.FunctionTimeoutError())

    outcome, _, _ = _run(tmp_path)

    assert outcome == remote.RemoteOutcome(None, "timeout")


def test_a_failed_worker_returns_its_exit_code_without_stems(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED, '{"event": "error", "code": "failed"}\n']
    fake_modal.call = FakeCall({"returncode": 5})

    outcome, lines, _ = _run(tmp_path)

    assert outcome == remote.RemoteOutcome(5)
    assert lines == ['{"event": "error", "code": "failed"}\n']
    assert not (tmp_path / "out").exists()


def test_without_the_modal_package_the_gpu_is_unavailable(tmp_path, monkeypatch):
    monkeypatch.setitem(sys.modules, "modal", None)

    with pytest.raises(remote.RemoteUnavailable, match="modal package is not installed"):
        _run(tmp_path)


def test_the_gpu_app_uses_the_same_start_marker():
    tree = ast.parse((PROJECT_ROOT / "gpu" / "modal_app.py").read_text())
    markers = [
        ast.literal_eval(node.value)
        for node in ast.walk(tree)
        if isinstance(node, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "STARTED" for t in node.targets)
    ]
    assert markers == [remote.STARTED]


def test_an_aborting_progress_callback_cancels_the_cloud_job(tmp_path, fake_modal):
    fake_modal.items = [remote.STARTED, "Loading model 1\n"]
    fake_modal.call = FakeCall(polls_before_done=10**9)
    song = tmp_path / "song.wav"
    song.write_bytes(b"RIFF-song")

    def abort(line):
        raise RuntimeError("Separation was cancelled by the job")

    with pytest.raises(RuntimeError, match="cancelled by the job"):
        remote.run_remote(
            presets.preset_plan("balanced"),
            song,
            tmp_path / "out",
            abort,
            None,
            timeout_s=60.0,
            stall_s=60.0,
            queue_s=60.0,
        )
    assert fake_modal.call.cancelled
