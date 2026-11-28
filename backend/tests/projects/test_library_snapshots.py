"""The library is copied once a day to <data dir>/snapshots, only when it changed, and the
newest LIBRARY_SNAPSHOT_DAYS copies are kept; a store that cannot be read is never copied
there, and is kept beside the store instead of being lost to the next save."""

import gzip
import json
import os
from datetime import date

import pytest

import backend.main as main_mod
from backend import config, library_snapshots
from backend.main import projects
from backend.project_store import load_projects, save_projects

DAY = date(2026, 11, 28)
# conftest replaces start() for every test; this is the real one, taken at import
REAL_START = library_snapshots.start


def _song(pid: str) -> dict:
    return {"id": pid, "title": pid.title(), "status": "ready"}


def _save_library(*ids: str) -> None:
    projects.clear()
    for pid in ids:
        projects[pid] = _song(pid)
    assert save_projects()


def _names() -> list[str]:
    return [p.name for p in library_snapshots.list_snapshots()]


def _age_snapshots(seconds: float = 3600) -> None:
    """Dates the snapshots there are before the store's next write."""
    for snapshot in library_snapshots.list_snapshots():
        then = snapshot.stat().st_mtime - seconds
        os.utime(snapshot, (then, then))


def test_a_snapshot_holds_the_library_as_it_was_saved():
    _save_library("first", "second")

    made = library_snapshots.take_snapshot(DAY)

    assert made == config.DATA_DIR / "snapshots" / "projects-2026-11-28.json.gz"
    assert json.loads(gzip.decompress(made.read_bytes())) == {
        "first": _song("first"),
        "second": _song("second"),
    }
    assert gzip.decompress(made.read_bytes()) == main_mod.PROJECTS_STORE_FILE.read_bytes()


def test_a_day_gets_one_snapshot():
    _save_library("first")
    made = library_snapshots.take_snapshot(DAY)
    _age_snapshots()
    _save_library("first", "second")

    assert library_snapshots.take_snapshot(DAY) is None
    assert list(json.loads(gzip.decompress(made.read_bytes()))) == ["first"]


def test_a_library_that_did_not_change_gets_no_new_snapshot():
    _save_library("first")
    library_snapshots.take_snapshot(DAY)

    assert library_snapshots.take_snapshot(date(2026, 11, 29)) is None
    assert _names() == ["projects-2026-11-28.json.gz"]


def test_a_changed_library_gets_the_next_days_snapshot():
    _save_library("first")
    library_snapshots.take_snapshot(DAY)
    _age_snapshots()
    _save_library("first", "second")

    made = library_snapshots.take_snapshot(date(2026, 11, 29))

    assert made is not None
    assert _names() == ["projects-2026-11-28.json.gz", "projects-2026-11-29.json.gz"]


def test_only_the_newest_snapshots_are_kept(monkeypatch):
    monkeypatch.setenv("LIBRARY_SNAPSHOT_DAYS", "3")
    for day in range(1, 6):
        _save_library(*[f"song{n}" for n in range(day)])
        library_snapshots.take_snapshot(date(2026, 11, day))
        _age_snapshots()

    assert _names() == [f"projects-2026-11-0{day}.json.gz" for day in (3, 4, 5)]


def test_other_files_in_the_folder_are_left_alone(monkeypatch):
    monkeypatch.setenv("LIBRARY_SNAPSHOT_DAYS", "1")
    folder = library_snapshots.snapshots_dir()
    folder.mkdir()
    (folder / "projects-before-the-move.json.gz").write_bytes(b"kept by hand")
    for day in (1, 2):
        _save_library(f"song{day}")
        library_snapshots.take_snapshot(date(2026, 11, day))
        _age_snapshots()

    assert sorted(p.name for p in folder.iterdir()) == [
        "projects-2026-11-02.json.gz",
        "projects-before-the-move.json.gz",
    ]


def test_zero_days_makes_no_snapshot_and_removes_none(monkeypatch):
    _save_library("first")
    library_snapshots.take_snapshot(DAY)
    _age_snapshots()
    _save_library("first", "second")
    monkeypatch.setenv("LIBRARY_SNAPSHOT_DAYS", "0")

    assert library_snapshots.take_snapshot(date(2026, 11, 29)) is None
    assert _names() == ["projects-2026-11-28.json.gz"]


@pytest.mark.parametrize("raw", ["fourteen", "", "-3"])
def test_an_unreadable_setting_does_not_turn_snapshots_off_by_accident(monkeypatch, raw):
    monkeypatch.setenv("LIBRARY_SNAPSHOT_DAYS", raw)

    assert library_snapshots.snapshot_days() == (0 if raw == "-3" else 14)


def test_there_is_no_snapshot_without_a_library():
    assert library_snapshots.take_snapshot(DAY) is None
    assert not library_snapshots.snapshots_dir().exists()


def test_an_empty_library_is_not_copied():
    _save_library()

    assert library_snapshots.take_snapshot(DAY) is None


def test_a_damaged_store_is_not_copied_over_good_snapshots(monkeypatch):
    monkeypatch.setenv("LIBRARY_SNAPSHOT_DAYS", "1")
    _save_library("first")
    library_snapshots.take_snapshot(DAY)
    _age_snapshots()
    main_mod.PROJECTS_STORE_FILE.write_text('{"first": {"id": "fir', encoding="utf-8")

    assert library_snapshots.take_snapshot(date(2026, 11, 29)) is None
    assert _names() == ["projects-2026-11-28.json.gz"]


def test_a_store_that_holds_something_else_is_not_copied():
    main_mod.PROJECTS_STORE_FILE.write_text('["not", "a", "library"]', encoding="utf-8")

    assert library_snapshots.take_snapshot(DAY) is None


def test_a_failed_write_leaves_no_partial_snapshot(monkeypatch):
    _save_library("first")

    def full_disk(*_args, **_kwargs):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(library_snapshots.os, "replace", full_disk)

    with pytest.raises(OSError):
        library_snapshots.take_snapshot(DAY)

    assert list(library_snapshots.snapshots_dir().iterdir()) == []


def test_the_thread_starts_once(monkeypatch):
    started = []

    class FakeThread:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

        def start(self):
            started.append(self.kwargs)

        def is_alive(self):
            return True

    monkeypatch.setattr(library_snapshots.threading, "Thread", FakeThread)
    monkeypatch.setattr(library_snapshots, "_thread", None)

    REAL_START()
    REAL_START()

    assert len(started) == 1
    assert started[0]["daemon"] is True


# --- A store that cannot be read ---------------------------------------------------------------


def _damaged_copies() -> list[str]:
    return sorted(p.name for p in config.DATA_DIR.glob("projects.json.damaged-*"))


def test_an_unreadable_store_is_kept_beside_the_backup_it_is_recovered_from():
    _save_library("first")
    main_mod.PROJECTS_BACKUP_FILE.write_bytes(main_mod.PROJECTS_STORE_FILE.read_bytes())
    damaged = '{"first": {"id": "first", "title": "Fir'
    main_mod.PROJECTS_STORE_FILE.write_text(damaged, encoding="utf-8")

    assert list(load_projects()) == ["first"]

    copies = _damaged_copies()
    assert len(copies) == 1
    assert (config.DATA_DIR / copies[0]).read_text(encoding="utf-8") == damaged


def test_the_copy_survives_the_save_that_replaces_the_store():
    _save_library("first")
    main_mod.PROJECTS_STORE_FILE.write_text("{ damaged", encoding="utf-8")
    load_projects()

    _save_library("second")

    assert (config.DATA_DIR / _damaged_copies()[0]).read_text(encoding="utf-8") == "{ damaged"


def test_reading_the_same_damaged_store_again_keeps_one_copy():
    main_mod.PROJECTS_STORE_FILE.write_text("{ damaged", encoding="utf-8")

    load_projects()
    load_projects()

    assert len(_damaged_copies()) == 1


def test_a_store_and_backup_that_cannot_be_read_say_where_the_snapshots_are(caplog):
    main_mod.PROJECTS_STORE_FILE.write_text("{ damaged", encoding="utf-8")
    main_mod.PROJECTS_BACKUP_FILE.write_text("{ damaged too", encoding="utf-8")

    with caplog.at_level("ERROR", logger="karaoke_backend"):
        assert load_projects() == {}

    assert "snapshots/" in caplog.text
    assert "Restoring the library" in caplog.text


def test_a_first_start_without_a_store_says_nothing(caplog):
    with caplog.at_level("ERROR", logger="karaoke_backend"):
        assert load_projects() == {}

    assert caplog.text == ""
    assert _damaged_copies() == []
