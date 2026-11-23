"""Stand-ins for making a song loop: the cloud GPU client, the video probe, and a `modal`
module whose function answers what a test sets."""

import queue
import sys
import types
from contextlib import contextmanager
from pathlib import Path

from backend.services import remote_song_loop, song_loops

LOOP_VIDEO = b"\x00\x00\x00\x18ftypisom-a-loop"
PROBED = {"width": 1280, "height": 704, "duration": 4.04}
SCENE = "Paper lanterns drift down a dark river under a violet sky."


def fake_maker(log: list, video: bytes = LOOP_VIDEO, **said):
    """A stand-in for remote_song_loop.make: notes the request in ``log``, reports progress
    the way the worker's lines would, writes ``video`` and answers what the worker says."""

    def make(request, output_path, on_progress, cancel_event):
        log.append(dict(request))
        on_progress(None, "Waiting for a cloud GPU…", None)
        on_progress(50.0, "Wan 2.2 (5B) drawing the loop (step 25 of 50)", None)
        Path(output_path).write_bytes(video)
        typed = request.get("prompt")
        return {
            "prompt": typed or SCENE,
            "written_from": "typed" if typed else "lyrics",
            "model": request.get("model", "wan22"),
            "model_label": "Wan 2.2 (5B)",
            "seed": 7,
            "gpu": "NVIDIA L40S",
            "seconds": {"text": 20.0, "video": 300.0, "loop": 4.0},
            **said,
        }

    return make


def stand_in_cloud(monkeypatch, log: list | None = None) -> list:
    """A server that can make song loops, with the cloud and ffprobe stood in for. Returns
    the log of requests the stand-in cloud received."""
    log = [] if log is None else log
    monkeypatch.setattr(remote_song_loop, "status", lambda: (True, None))
    monkeypatch.setattr(remote_song_loop, "make", fake_maker(log))
    monkeypatch.setattr(song_loops, "probe_video", lambda path: dict(PROBED))
    return log


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
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.polls_left = 1
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


def install_fake_modal(monkeypatch) -> types.SimpleNamespace:
    """A stand-in modal client. Set .call (a FakeCall), .items (what the function puts on
    its queue) and .lookup_error before running; .target and .kwargs say what was called."""
    errors = types.ModuleType("modal.exception")
    errors.Error = type("Error", (Exception,), {})
    for name in ("NotFoundError", "AuthError", "ConnectionError", "InternalFailure"):
        setattr(errors, name, type(name, (errors.Error,), {}))
    errors.FunctionTimeoutError = type("FunctionTimeoutError", (errors.Error,), {})
    state = types.SimpleNamespace(errors=errors, call=FakeCall(), items=[], lookup_error=None)

    def from_name(app_name, name):
        if state.lookup_error is not None:
            raise state.lookup_error
        state.target = (app_name, name)

        def spawn(**kwargs):
            state.kwargs = kwargs
            return state.call

        return types.SimpleNamespace(spawn=spawn)

    @contextmanager
    def ephemeral():
        yield FakeQueue(state.items)

    module = types.ModuleType("modal")
    module.Function = types.SimpleNamespace(from_name=from_name)
    module.Queue = types.SimpleNamespace(ephemeral=ephemeral)
    module.exception = errors
    monkeypatch.setitem(sys.modules, "modal", module)
    monkeypatch.setitem(sys.modules, "modal.exception", errors)
    return state
