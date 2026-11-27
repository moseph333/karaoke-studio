"""Several requests for a melody that is not made yet run one analysis between them, one
song's analysis at a time across the server, and a melody already kept never waits for
another song's analysis."""

import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects

SR = 44100


def _song(pid: str, hz: float = 220.0) -> dict:
    stems = main_mod.STEMS_DIR / pid
    stems.mkdir(parents=True, exist_ok=True)
    t = np.arange(SR * 2) / SR
    sf.write(str(stems / "vocals.wav"), 0.4 * np.sin(2 * np.pi * hz * t), SR)
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "vocals_path": str(stems / "vocals.wav"),
    }
    return projects[pid]


class SlowAnalysis:
    """The real analysis, held at a gate so a test decides when it ends."""

    def __init__(self, monkeypatch):
        self.started = threading.Event()
        self.release = threading.Event()
        self.runs: list[str] = []
        self.running = 0
        self.most_at_once = 0
        self._count = threading.Lock()
        real = main_mod.vocal_analyzer.pitch_contour

        def gated(audio_input, sr=None):
            with self._count:
                self.runs.append(Path(str(audio_input)).parent.name)
                self.running += 1
                self.most_at_once = max(self.most_at_once, self.running)
            self.started.set()
            try:
                assert self.release.wait(timeout=10), "the test never released the analysis"
                return real(audio_input, sr=sr)
            finally:
                with self._count:
                    self.running -= 1

        monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", gated)


@pytest.fixture
def slow(monkeypatch):
    analysis = SlowAnalysis(monkeypatch)
    yield analysis
    analysis.release.set()


def _get(client, pid: str):
    return client.get(f"/api/project/{pid}/melody")


def test_eight_cold_requests_run_one_analysis(client, slow):
    _song("melodycold")

    with ThreadPoolExecutor(max_workers=8) as pool:
        waiting = [pool.submit(_get, client, "melodycold") for _ in range(8)]
        assert slow.started.wait(timeout=5)
        slow.release.set()
        answers = [future.result(timeout=20) for future in waiting]

    assert [res.status_code for res in answers] == [200] * 8
    assert slow.runs == ["melodycold"]
    assert all(res.json()["midi"] == answers[0].json()["midi"] for res in answers)
    assert answers[0].json()["detected"] is True


def test_two_songs_are_analysed_one_after_the_other(client, slow):
    _song("melodyfirst")
    _song("melodysecond", hz=330.0)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(_get, client, "melodyfirst")
        assert slow.started.wait(timeout=5)
        second = pool.submit(_get, client, "melodysecond")
        # The second song waits for the first to finish: it has not started its analysis
        assert not second.done()
        assert slow.runs == ["melodyfirst"]
        slow.release.set()
        assert first.result(timeout=20).status_code == 200
        assert second.result(timeout=20).status_code == 200

    assert slow.runs == ["melodyfirst", "melodysecond"]
    assert slow.most_at_once == 1


def test_a_kept_melody_does_not_wait_for_another_songs_analysis(client, slow):
    _song("melodykept")
    slow.release.set()
    assert _get(client, "melodykept").status_code == 200
    slow.release.clear()
    slow.started.clear()
    _song("melodybusy")

    with ThreadPoolExecutor(max_workers=1) as pool:
        busy = pool.submit(_get, client, "melodybusy")
        assert slow.started.wait(timeout=5)

        # Answered while the other song's analysis still holds the slot
        kept = _get(client, "melodykept")
        assert kept.status_code == 200
        assert not busy.done()

        slow.release.set()
        assert busy.result(timeout=20).status_code == 200

    assert slow.runs == ["melodykept", "melodybusy"]


def test_a_failed_analysis_frees_the_slot_for_the_next_song(client, monkeypatch):
    _song("melodybroken")
    _song("melodyfine")
    real = main_mod.vocal_analyzer.pitch_contour

    def break_one(audio_input, sr=None):
        if "melodybroken" in str(audio_input):
            raise RuntimeError("analysis fell over")
        return real(audio_input, sr=sr)

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", break_one)

    assert _get(client, "melodybroken").status_code == 500
    assert _get(client, "melodyfine").status_code == 200
    # And the broken song can be asked again
    assert _get(client, "melodybroken").status_code == 500
