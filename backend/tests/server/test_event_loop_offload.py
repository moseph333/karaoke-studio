"""Blocking work in async handlers runs in worker threads, not on the event loop."""

import asyncio

import backend.main as main_mod
from backend import config, upload_utils
from backend.routers import uploads

PNG = b"\x89PNG\r\n\x1a\n" + bytes(256)


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


def test_upload_copy_header_and_store_writes_run_off_the_event_loop(client, monkeypatch):
    seen: dict[str, bool] = {}

    def spy(name, real):
        def wrapper(*args, **kwargs):
            seen[name] = _on_event_loop()
            return real(*args, **kwargs)

        return wrapper

    monkeypatch.setattr(upload_utils, "_save_bounded", spy("copy", upload_utils._save_bounded))
    monkeypatch.setattr(uploads, "read_header", spy("header", uploads.read_header))
    monkeypatch.setattr(uploads, "save_projects", spy("save", uploads.save_projects))
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)

    wav = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(64)
    res = client.post("/api/upload-track", files={"file": ("song.wav", wav, "audio/wav")})

    assert res.status_code == 200, res.text
    assert seen == {"copy": False, "header": False, "save": False}


def test_background_upload_copy_runs_off_the_event_loop(client, monkeypatch):
    seen = []
    real = upload_utils._save_bounded

    def spy(*args):
        seen.append(_on_event_loop())
        return real(*args)

    monkeypatch.setattr(upload_utils, "_save_bounded", spy)
    res = client.post("/api/upload-background", files={"file": ("bg.png", PNG, "image/png")})

    assert res.status_code == 200, res.text
    assert seen == [False]


def test_update_check_runs_git_off_the_event_loop(client, monkeypatch):
    seen = []

    def fake_check(force_remote=False):
        seen.append((_on_event_loop(), force_remote))
        return {"version": "test"}

    monkeypatch.setattr(config, "check_for_updates", fake_check)
    res = client.post("/api/system/update", json={"action": "check"})

    assert res.status_code == 200
    assert seen == [(False, True)]
