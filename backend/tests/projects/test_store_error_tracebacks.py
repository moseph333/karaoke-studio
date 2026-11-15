"""When projects.json cannot be read or written, the log keeps the traceback (a full disk,
which retries every second, stays one line)."""

import json
import logging
import types

import backend.main as main_mod
import backend.project_store as project_store
from backend.project_store import load_projects, save_projects


def _errors(caplog):
    return [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_a_corrupt_store_and_backup_are_logged_with_tracebacks(caplog):
    main_mod.PROJECTS_STORE_FILE.write_text("{not json", encoding="utf-8")
    main_mod.PROJECTS_BACKUP_FILE.write_text("[also not", encoding="utf-8")
    caplog.set_level(logging.ERROR, logger="karaoke_backend")

    assert load_projects() == {}

    errors = _errors(caplog)
    assert len(errors) == 2
    assert all(r.exc_info and r.exc_info[0] is json.JSONDecodeError for r in errors)


def test_an_unexpected_save_failure_keeps_its_traceback(monkeypatch, caplog):
    def broken_dumps(*args, **kwargs):
        raise TypeError("not serialisable")

    # Only the store's own json module reference, not the json module every test shares
    monkeypatch.setattr(
        project_store, "json", types.SimpleNamespace(dumps=broken_dumps, loads=json.loads)
    )
    caplog.set_level(logging.ERROR, logger="karaoke_backend")

    assert save_projects() is False
    (record,) = _errors(caplog)
    assert record.exc_info[0] is TypeError


def test_a_full_disk_stays_one_line(monkeypatch, caplog):
    def full(*args, **kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(project_store.os, "replace", full)
    caplog.set_level(logging.ERROR, logger="karaoke_backend")

    assert save_projects() is False
    (record,) = _errors(caplog)
    assert "No space left on device" in record.getMessage()
    assert not record.exc_info
