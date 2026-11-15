"""The intake opens the studio without waiting for its stems' analysis: the vocal range and
chords are detected on threads of their own while lyrics are timed and the song opens.

A request for them that arrives while they run waits for that run (one analysis of each kind
per song at a time) instead of detecting again, and a chord edit saved meanwhile is kept.
"""

import threading

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend import project_analysis
from backend.main import active_cancellations, projects
from backend.project_store import find_project, save_projects
from backend.services.lyric_sync import SyncResult

CHORDS = [{"chord": "G", "start": 0.0, "end": 2.0}]
EDITED = [{"chord": "Em", "start": 0.0, "end": 2.0}]  # stored with the schema's extra fields
RANGE = {"lowest_note": "A2", "highest_note": "E4", "estimated_key": "G major", "is_voiced": True}


class SlowAnalysis:
    """A chord detector and vocal analyser that block until the test releases them."""

    def __init__(self):
        self.release = threading.Event()
        self.started = threading.Event()
        self.chord_calls = 0
        self.range_calls = 0
        self.chords = CHORDS

    def detect_chords(self, path):
        self.chord_calls += 1
        self.started.set()
        assert self.release.wait(timeout=10)
        return self.chords

    def analyze_vocals(self, path):
        self.range_calls += 1
        assert self.release.wait(timeout=10)
        return RANGE


@pytest.fixture
def slow(monkeypatch, tmp_path):
    """Stand-ins for the pipeline's services, with stems on disk and a slow analysis."""
    analysis = SlowAnalysis()
    stems = {}
    for name in ("vocals", "instrumental"):
        path = tmp_path / f"{name}.wav"
        path.write_bytes(b"RIFF" + b"\0" * 64)
        stems[f"{name}_path"] = str(path)

    def extract(url, progress_hook=None):
        return {
            "id": url,
            "title": "Song",
            "artist": "Singer",
            "duration": 120.0,
            "audio_path": str(tmp_path / "song.wav"),
        }

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", extract)
    monkeypatch.setattr(main_mod.separator, "separate_stems", lambda **kw: dict(stems))
    monkeypatch.setattr(
        main_mod.lyrics_service,
        "fetch_lyrics",
        lambda *a, **k: {"source": "lrclib", "synced": True, "lines": []},
    )
    monkeypatch.setattr(
        pipeline, "sync_lyrics", lambda v, lines, **kw: SyncResult(lines, {}, "line")
    )
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda **kw: "master.wav")
    monkeypatch.setattr(main_mod, "chord_detector", analysis)
    monkeypatch.setattr(main_mod, "vocal_analyzer", analysis)
    yield analysis
    analysis.release.set()  # never leave a thread blocked for later tests
    for thread in threading.enumerate():
        if thread.name.startswith("stem-analysis-"):
            thread.join(timeout=5)


def _process(pid: str, **fields) -> None:
    projects[pid] = {"id": pid, "status": "queued", **fields}
    save_projects()
    active_cancellations.pop(pid, None)
    pipeline.run_pipeline(pid, pid)


def test_the_song_is_ready_before_its_analysis_finishes(slow):
    _process("open_early")

    proj = find_project("open_early")
    assert proj["status"] == "ready", proj.get("error")
    assert slow.started.wait(timeout=5)
    assert proj.get("chords") is None and not proj.get("vocal_range")

    slow.release.set()
    assert project_analysis.ensure_chords("open_early") == CHORDS
    assert project_analysis.ensure_vocal_range("open_early") == RANGE


def test_the_studio_waits_for_the_running_analysis_instead_of_starting_another(slow, client):
    _process("open_wait")
    assert slow.started.wait(timeout=5)

    replies = {}

    def ask(path):
        replies[path] = client.get(f"/api/project/open_wait/{path}")

    askers = [threading.Thread(target=ask, args=(p,)) for p in ("chords", "vocal-range")]
    for thread in askers:
        thread.start()
    threading.Timer(0.3, slow.release.set).start()
    for thread in askers:
        thread.join(timeout=10)

    assert replies["chords"].status_code == 200
    assert [c["chord"] for c in replies["chords"].json()["chords"]] == ["G"]
    assert replies["vocal-range"].json()["estimated_key"] == "G major"
    assert (slow.chord_calls, slow.range_calls) == (1, 1)


def test_a_chord_edit_saved_while_a_retried_song_is_analysed_is_kept(slow, client):
    _process("open_edit", chords=[{"chord": "C", "start": 0.0, "end": 2.0}])
    assert slow.started.wait(timeout=5)

    res = client.post("/api/project/open_edit/chords", json={"chords": EDITED})
    assert res.status_code == 200
    slow.release.set()

    # The forced re-detection finishes, and leaves the user's edit in place
    assert [c["chord"] for c in project_analysis.ensure_chords("open_edit")] == ["Em"]
    assert slow.chord_calls == 1


def test_a_retried_song_left_alone_gets_the_new_chords(slow):
    _process("open_retry", chords=[{"chord": "C", "start": 0.0, "end": 2.0}])
    slow.release.set()

    # The forced run holds the lock until it has stored its result, so this waits for it
    assert project_analysis.ensure_chords("open_retry") == CHORDS


def test_a_failed_analysis_does_not_stop_the_song(slow, monkeypatch):
    def broken(path):
        raise RuntimeError("detector crashed")

    monkeypatch.setattr(slow, "detect_chords", broken)
    slow.release.set()
    _process("open_broken")

    assert find_project("open_broken")["status"] == "ready"


def test_the_pipeline_no_longer_reports_an_analysis_step(slow, monkeypatch):
    details = []
    real = pipeline._progress_updater

    def recording(project_id, cancel_event, started):
        update = real(project_id, cancel_event, started)

        def wrapped(status, progress, detail, eta_s=None):
            details.append(detail.lower())
            update(status, progress, detail, eta_s)

        return wrapped

    monkeypatch.setattr(pipeline, "_progress_updater", recording)
    slow.release.set()
    _process("open_steps")

    assert details and not any("chord" in d or "vocal range" in d for d in details)
