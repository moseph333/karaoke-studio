"""Shorter waits for a cloud separation: asking Modal for a GPU when a song's intake begins,
so the container boots while the audio downloads.

A stand-in `modal` module replaces the real client, so nothing leaves the machine.
"""

import ast
import sys
import threading
import time
import types

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects
from backend.project_store import save_projects
from backend.services import remote_separation
from backend.services import separation_presets as presets
from backend.services.process_watchdog import PROJECT_ROOT
from backend.services.separator import write_provenance


@pytest.fixture
def spawned(monkeypatch):
    """A stand-in modal client that records Function.from_name(...).spawn(...) calls."""
    state = types.SimpleNamespace(calls=[], error=None, done=threading.Event())

    def from_name(app_name, name):
        def spawn(**kwargs):
            try:
                if state.error is not None:
                    raise state.error
                state.calls.append((app_name, name, kwargs))
            finally:
                state.done.set()

        return types.SimpleNamespace(spawn=spawn)

    module = types.ModuleType("modal")
    module.Function = types.SimpleNamespace(from_name=from_name)
    monkeypatch.setitem(sys.modules, "modal", module)
    return state


@pytest.fixture
def cloud_separation(monkeypatch):
    """Cloud separation configured, with a fresh warm-up throttle and a hand-moved clock."""
    monkeypatch.setenv("SEPARATION_REMOTE", "modal")
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    monkeypatch.delenv("SEPARATION_REMOTE_PREWARM", raising=False)
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")
    monkeypatch.setattr(remote_separation, "_last_warmup", None)
    clock = types.SimpleNamespace(now=1000.0)
    monkeypatch.setattr(remote_separation.time, "monotonic", lambda: clock.now)
    return clock


def test_a_warm_up_starts_the_separate_function_at_most_every_20_seconds(cloud_separation, spawned):
    assert remote_separation.warm_up("best") == "warming"
    assert spawned.calls == [("karaoke-studio-gpu", "separate", {"warmup": True})]

    cloud_separation.now += 10
    assert remote_separation.warm_up("balanced") == "recent"
    cloud_separation.now += 11
    assert remote_separation.warm_up("balanced") == "warming"
    assert len(spawned.calls) == 2


def test_fast_and_unconfigured_servers_never_warm_a_gpu(cloud_separation, spawned, monkeypatch):
    assert remote_separation.warm_up("fast") == "off"
    assert remote_separation.warm_up(None) == "off"

    monkeypatch.setenv("SEPARATION_REMOTE_PREWARM", "0")
    assert remote_separation.warm_up("best") == "off"

    monkeypatch.delenv("SEPARATION_REMOTE_PREWARM")
    monkeypatch.delenv("SEPARATION_REMOTE")
    assert remote_separation.warm_up("best") == "off"

    monkeypatch.setenv("SEPARATION_REMOTE", "modal")
    monkeypatch.delenv("MODAL_TOKEN_ID")
    monkeypatch.delenv("MODAL_TOKEN_SECRET")
    monkeypatch.setattr(presets.Path, "home", lambda: PROJECT_ROOT / "no-such-home")
    assert remote_separation.warm_up("best") == "off"
    assert spawned.calls == []


def test_a_failed_warm_up_is_logged_and_retried_on_the_next_call(cloud_separation, spawned, caplog):
    spawned.error = ConnectionError("Modal is unreachable")
    assert remote_separation.warm_up("best") == "failed"
    assert "Modal is unreachable" in caplog.text

    spawned.error = None
    assert remote_separation.warm_up("best") == "warming"
    assert len(spawned.calls) == 1


def test_a_background_warm_up_does_not_wait_for_modal(cloud_separation, spawned):
    assert remote_separation.warm_up("best", background=True) == "warming"
    assert spawned.done.wait(timeout=5)
    assert spawned.calls == [("karaoke-studio-gpu", "separate", {"warmup": True})]


def test_the_youtube_pipeline_warms_the_gpu_before_the_download(
    cloud_separation, spawned, monkeypatch
):
    pid = "warm_yt_song"
    projects[pid] = {"id": pid, "status": "queued", "separation_quality": "best"}
    save_projects()
    active_cancellations.pop(pid, None)
    seen = {}

    def extract(url, progress_hook=None):
        seen["warmed_before_download"] = spawned.done.wait(timeout=5)
        raise RuntimeError("stop after the download")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", extract)
    pipeline.run_pipeline(pid, pid)

    assert seen["warmed_before_download"]
    assert spawned.calls == [("karaoke-studio-gpu", "separate", {"warmup": True})]


def test_the_download_keeps_the_gpu_warm_while_it_lasts(cloud_separation, spawned, monkeypatch):
    pid = "warm_long_dl"
    projects[pid] = {"id": pid, "status": "queued", "separation_quality": "balanced"}
    save_projects()
    active_cancellations.pop(pid, None)
    calls = []
    monkeypatch.setattr(
        remote_separation, "warm_up", lambda preset, background=False: calls.append(preset)
    )

    def extract(url, progress_hook=None):
        for done in (10, 50, 90):
            time.sleep(0.3)  # the hook reports at most every 0.25 s
            progress_hook({"status": "downloading", "total_bytes": 100, "downloaded_bytes": done})
        raise RuntimeError("stop after the download")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", extract)
    pipeline.run_pipeline(pid, pid)

    assert calls == ["balanced"] * 4  # once at the start, then on each progress report


def test_cached_stems_need_no_gpu(cloud_separation, spawned, monkeypatch, tmp_path):
    monkeypatch.setattr(main_mod.separator, "output_base_dir", tmp_path)
    stem_dir = tmp_path / "warm_cached"
    stem_dir.mkdir()
    for name in ("vocals.wav", "instrumental.wav"):
        (stem_dir / name).write_bytes(b"RIFF" + b"\0" * 4096)
    monkeypatch.setattr(type(main_mod.separator), "_is_valid_stem", staticmethod(lambda p: True))
    write_provenance(stem_dir, {"preset": "best"})
    projects["warm_cached"] = {"id": "warm_cached", "status": "queued"}

    assert main_mod.separator.has_cached_stems("warm_cached", "best")
    pipeline.warm_separation_gpu(main_mod, "warm_cached")
    assert spawned.calls == []

    write_provenance(stem_dir, {"preset": "fast"})
    assert not main_mod.separator.has_cached_stems("warm_cached", "balanced")
    projects["warm_cached"]["separation_quality"] = "balanced"
    pipeline.warm_separation_gpu(main_mod, "warm_cached")
    assert spawned.done.wait(timeout=5)
    assert len(spawned.calls) == 1


def test_the_modal_separate_function_accepts_a_warm_up_call():
    tree = ast.parse((PROJECT_ROOT / "gpu" / "modal_app.py").read_text())
    separate = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "separate"
    )
    names = [a.arg for a in separate.args.args]
    defaults = dict(zip(names[-len(separate.args.defaults) :], separate.args.defaults, strict=True))
    assert "warmup" in names
    assert ast.literal_eval(defaults["warmup"]) is False
    # The real call's keywords are unchanged
    assert {"audio", "filename", "models", "overlap", "ensemble", "lines"} <= set(names)
