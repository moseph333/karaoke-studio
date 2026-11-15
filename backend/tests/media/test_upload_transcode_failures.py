"""An upload whose transcode fails stores a short reason, not FFmpeg's whole banner, and
leaves no half-written WAV behind; the transcode gets enough time for a long song."""

import subprocess
import types

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects
from backend.project_store import find_project, save_projects


@pytest.fixture
def upload(monkeypatch):
    pid = "transfail01"
    projects[pid] = {"id": pid, "status": "queued"}
    save_projects()
    active_cancellations.pop(pid, None)
    raw = main_mod.DOWNLOADS_DIR / f"{pid}.mp3"
    raw.write_bytes(b"ID3 not really audio")
    yield pid, raw
    projects.pop(pid, None)


def _fake_ffmpeg(monkeypatch, behaviour):
    calls = []

    def run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        (main_mod.DOWNLOADS_DIR / "transfail01_norm.wav").write_bytes(b"RIFF half")
        return behaviour(cmd, kwargs)

    monkeypatch.setattr(main_mod, "subprocess", types.SimpleNamespace(run=run))
    return calls


def test_a_failed_transcode_stores_a_short_reason_and_cleans_up(upload, monkeypatch):
    pid, raw = upload
    banner = "ffmpeg version 6.1 Copyright (c) the FFmpeg developers\n" * 100
    calls = _fake_ffmpeg(
        monkeypatch,
        lambda cmd, kw: types.SimpleNamespace(returncode=1, stderr=banner + "Invalid data"),
    )

    pipeline.run_local_pipeline(pid, str(raw), title="T", artist="A")

    proj = find_project(pid)
    assert proj["status"] == "error"
    assert proj["error"].startswith("FFmpeg audio transcoding failed:")
    assert len(proj["error"]) <= 400
    assert not (main_mod.DOWNLOADS_DIR / f"{pid}_norm.wav").exists()
    cmd, kwargs = calls[0]
    assert cmd[:4] == ["ffmpeg", "-hide_banner", "-loglevel", "error"]
    assert kwargs["timeout"] == pipeline.TRANSCODE_TIMEOUT_SEC >= 300


def test_a_timed_out_transcode_cleans_up(upload, monkeypatch):
    pid, raw = upload

    def timeout(cmd, kwargs):
        raise subprocess.TimeoutExpired(cmd, kwargs["timeout"])

    _fake_ffmpeg(monkeypatch, timeout)

    pipeline.run_local_pipeline(pid, str(raw), title="T", artist="A")

    assert find_project(pid)["status"] == "error"
    assert not (main_mod.DOWNLOADS_DIR / f"{pid}_norm.wav").exists()
