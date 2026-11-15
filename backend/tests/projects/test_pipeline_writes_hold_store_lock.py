"""The intake pipelines change a song only while they hold the store lock, so a library
listing that copies every song under the lock never meets one halfway through a write."""

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects
from backend.project_store import PROJECTS_LOCK, find_project, save_projects
from backend.services.lyric_sync import SyncResult

LYRICS = {"source": "lrclib", "synced": True, "lines": [{"text": "hi", "start": 1.0, "end": 2.0}]}


@pytest.fixture
def fake_services(monkeypatch, tmp_path):
    """Stand-ins for the download, separation, lyrics, alignment and mix."""
    monkeypatch.setattr(
        main_mod.downloader,
        "extract_info_and_download",
        lambda url, progress_hook=None: {
            "id": "lockvid",
            "title": "Song",
            "artist": "Singer",
            "duration": 200.0,
            "audio_path": str(tmp_path / "song.wav"),
        },
    )
    monkeypatch.setattr(
        main_mod.separator,
        "separate_stems",
        lambda **kw: {
            "vocals_path": str(tmp_path / "vocals.wav"),
            "instrumental_path": str(tmp_path / "inst.wav"),
        },
    )
    monkeypatch.setattr(main_mod.lyrics_service, "fetch_lyrics", lambda *a, **k: LYRICS)
    monkeypatch.setattr(
        pipeline,
        "sync_lyrics",
        lambda vocals, lines, **kw: SyncResult(lines=lines, report={}, lyric_timing="line"),
    )
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda **kw: str(tmp_path / "m.wav"))
    monkeypatch.setattr(pipeline, "analyze_project_stems", lambda *a, **k: None)

    return None


class _LockCheckedSong(dict):
    """A song that records, for every write, whether the writer fake_services the store lock."""

    writes: list[tuple[str, bool]]

    def __setitem__(self, key, value):
        self.writes.append((key, PROJECTS_LOCK._is_owned()))
        super().__setitem__(key, value)

    def update(self, *args, **kwargs):
        for key in dict(*args, **kwargs):
            self.writes.append((key, PROJECTS_LOCK._is_owned()))
        super().update(*args, **kwargs)


def _new_project(pid: str) -> _LockCheckedSong:
    song = _LockCheckedSong(id=pid, status="queued")
    song.writes = []
    projects[pid] = song
    save_projects()
    active_cancellations.pop(pid, None)
    return song


def _unlocked(song: _LockCheckedSong) -> list[str]:
    return [key for key, owned in song.writes if not owned]


def test_a_youtube_intake_writes_only_under_the_lock(fake_services):
    song = _new_project("lockyt")
    pipeline.run_pipeline("lockyt", "lockvid")
    assert find_project("lockyt")["status"] == "ready"
    assert song.writes and _unlocked(song) == []


def test_a_failed_intake_records_its_error_under_the_lock(fake_services, monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("separation exploded")

    monkeypatch.setattr(main_mod.separator, "separate_stems", broken)
    song = _new_project("lockfail")
    pipeline.run_pipeline("lockfail", "lockvid")
    assert find_project("lockfail")["status"] == "error"
    assert ("error", True) in song.writes
    assert _unlocked(song) == []


def test_a_cancelled_queued_intake_is_marked_under_the_lock(fake_services):
    song = _new_project("lockcancel")
    import threading

    event = threading.Event()
    event.set()
    active_cancellations["lockcancel"] = event
    pipeline.run_pipeline("lockcancel", "lockvid")
    assert find_project("lockcancel")["status"] == "cancelled"
    assert ("status", True) in song.writes
    assert _unlocked(song) == []
