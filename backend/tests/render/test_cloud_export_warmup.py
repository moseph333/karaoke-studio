"""Shorter waits for a cloud export: starting a cloud CPU when the Export dialog opens,
reporting the wait while Modal finds one, and logging the app's own info lines.

A stand-in `modal` module replaces the real client, so nothing leaves the machine.
"""

import ast
import logging
import queue
import sys
import types

import pytest

from backend import logging_setup
from backend.services import modal_jobs, remote_render
from backend.services import separation_presets as presets
from backend.services.process_watchdog import PROJECT_ROOT


@pytest.fixture
def clock(monkeypatch):
    """A monotonic clock the test moves by hand."""
    state = types.SimpleNamespace(now=1000.0)
    monkeypatch.setattr(modal_jobs.time, "monotonic", lambda: state.now)
    return state


@pytest.fixture
def spawned(monkeypatch):
    """A stand-in modal client that records Function.from_name(...).spawn(...) calls."""
    state = types.SimpleNamespace(calls=[], error=None)

    def from_name(app_name, name):
        def spawn(**kwargs):
            if state.error is not None:
                raise state.error
            state.calls.append((app_name, name, kwargs))

        return types.SimpleNamespace(spawn=spawn)

    module = types.ModuleType("modal")
    module.Function = types.SimpleNamespace(from_name=from_name)
    monkeypatch.setitem(sys.modules, "modal", module)
    return state


@pytest.fixture
def cloud_export(monkeypatch):
    """Cloud export configured, with a fresh warm-up throttle."""
    monkeypatch.setenv("RENDER_REMOTE", "modal")
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    monkeypatch.delenv("RENDER_REMOTE_PREWARM", raising=False)
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")
    monkeypatch.setattr(remote_render, "_last_warmup", None)


# ==============================================================================
# Warm-up
# ==============================================================================


def test_a_warm_up_starts_the_render_function_once_a_minute(
    cloud_export, spawned, clock, monkeypatch
):
    monkeypatch.setattr(remote_render.time, "monotonic", lambda: clock.now)

    assert remote_render.warm_up() == "warming"
    assert spawned.calls == [("karaoke-studio-gpu", "render", {"warmup": True})]

    clock.now += 30
    assert remote_render.warm_up() == "recent"
    clock.now += 31
    assert remote_render.warm_up() == "warming"
    assert len(spawned.calls) == 2


def test_warm_ups_can_be_turned_off(cloud_export, spawned, monkeypatch):
    monkeypatch.setenv("RENDER_REMOTE_PREWARM", "0")
    assert remote_render.warm_up() == "off"

    monkeypatch.setenv("RENDER_REMOTE_PREWARM", "1")
    monkeypatch.delenv("RENDER_REMOTE")
    assert remote_render.warm_up() == "off"
    assert spawned.calls == []


def test_a_failed_warm_up_is_logged_and_retried_on_the_next_open(cloud_export, spawned, caplog):
    spawned.error = ConnectionError("Modal is unreachable")
    with caplog.at_level(logging.WARNING, logger="backend.services.remote_render"):
        assert remote_render.warm_up() == "failed"
    assert "Could not start a cloud CPU ahead of the export" in caplog.text

    spawned.error = None
    assert remote_render.warm_up() == "warming"


def test_the_export_dialog_endpoint_warms_up_only_for_cloud_exports(
    client, cloud_export, monkeypatch
):
    started: list[bool] = []
    monkeypatch.setattr(remote_render, "warm_up", lambda: started.append(True) or "warming")

    res = client.post("/api/render/warmup")
    assert (res.status_code, res.json()) == (202, {"status": "warming"})
    assert started == [True]

    monkeypatch.delenv("RENDER_REMOTE")
    res = client.post("/api/render/warmup")
    assert (res.status_code, res.json()) == (202, {"status": "local"})
    assert started == [True]


def test_the_warm_up_endpoint_needs_a_login(unauth_client):
    assert unauth_client.post("/api/render/warmup").status_code == 401


def test_the_modal_render_function_accepts_a_warm_up_call():
    tree = ast.parse((PROJECT_ROOT / "gpu" / "modal_app.py").read_text())
    render = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "render"
    )
    names = [a.arg for a in render.args.args]
    defaults = dict(zip(names[-len(render.args.defaults) :], render.args.defaults, strict=True))
    assert "warmup" in names
    assert ast.literal_eval(defaults["warmup"]) is False
    decorator = render.decorator_list[0]
    keywords = {kw.arg: kw.value for kw in decorator.keywords}
    assert ast.unparse(keywords["scaledown_window"]) == "RENDER_SCALEDOWN_SECONDS"


# ==============================================================================
# Waiting for a cloud CPU
# ==============================================================================


class _StartsLater:
    """A job queue that stays empty for `wait_polls` one-second polls, then starts the job."""

    def __init__(self, clock, wait_polls):
        self.clock, self.wait_polls, self.polls = clock, wait_polls, 0

    def get_many(self, n_values, block=True, timeout=None):
        if not block:
            return []
        self.polls += 1
        self.clock.now += 1.0
        if self.polls == self.wait_polls:
            return [modal_jobs.STARTED]
        raise queue.Empty


class _FinishesAfter:
    def __init__(self, polls):
        self.polls = polls

    def get(self, timeout=None):
        self.polls -= 1
        if self.polls > 0:
            raise TimeoutError
        return {"returncode": 0}

    def cancel(self):
        pass


def test_the_wait_is_reported_every_5_seconds_and_logged_once_the_job_starts(clock, caplog):
    lines = _StartsLater(clock, wait_polls=12)
    waits: list[float] = []
    started: list[bool] = []

    with caplog.at_level(logging.INFO, logger="backend.services.modal_jobs"):
        outcome, result = modal_jobs._follow(
            _FinishesAfter(polls=15),
            lines,
            lambda line: None,
            None,
            timeout_s=600.0,
            stall_s=600.0,
            queue_s=120.0,
            on_started=lambda: started.append(True),
            on_waiting=waits.append,
            job_timeout=type("FunctionTimeoutError", (Exception,), {}),
            unavailable=(),
            resource="CPU",
            queue_setting="RENDER_REMOTE_QUEUE_SEC",
        )

    assert outcome == modal_jobs.RemoteOutcome(0)
    assert result == {"returncode": 0}
    assert waits == [5.0, 10.0]  # nothing more once the job ran at 12 s
    assert started == [True]
    assert "The cloud CPU job started after 12 s in the queue" in caplog.text


# ==============================================================================
# Logging
# ==============================================================================


@pytest.fixture
def app_loggers():
    """Restores the app loggers' level and handlers after the test."""
    saved = {
        name: (logging.getLogger(name).level, list(logging.getLogger(name).handlers))
        for name in logging_setup.APP_LOGGERS
    }
    yield
    for name, (level, handlers) in saved.items():
        logger = logging.getLogger(name)
        logger.setLevel(level)
        logger.handlers[:] = handlers


def _app_handlers(name: str) -> list[logging.Handler]:
    return [h for h in logging.getLogger(name).handlers if getattr(h, "karaoke_app_handler", False)]


def test_the_app_logs_info_lines_through_one_handler(app_loggers, monkeypatch):
    monkeypatch.delenv("LOG_LEVEL", raising=False)
    logging_setup.configure_logging()
    logging_setup.configure_logging()

    for name in logging_setup.APP_LOGGERS:
        assert logging.getLogger(name).level == logging.INFO
        assert len(_app_handlers(name)) == 1
    assert logging.getLogger("backend.services.remote_render").isEnabledFor(logging.INFO)


@pytest.mark.parametrize(("value", "level"), [("debug", logging.DEBUG), ("nonsense", logging.INFO)])
def test_log_level_can_be_set(app_loggers, monkeypatch, value, level):
    monkeypatch.setenv("LOG_LEVEL", value)
    logging_setup.configure_logging()
    assert logging.getLogger("karaoke_backend").level == level
