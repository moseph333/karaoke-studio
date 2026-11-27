"""GET /api/project/{id}/melody: the pitch a song's singer holds over time, worked out from
the vocal stem on the first request and kept beside the stems, never on the song itself."""

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects
from backend.services import melody

PID = "melody01"
SR = 44100


def _voice(*notes: tuple[float | None, float]) -> np.ndarray:
    """A voice singing (frequency in Hz or None for a rest, seconds) pieces in turn."""
    pieces = []
    for hz, seconds in notes:
        t = np.arange(int(SR * seconds)) / SR
        pieces.append(np.zeros_like(t) if hz is None else 0.4 * np.sin(2 * np.pi * hz * t))
    return np.concatenate(pieces)


def _write(path: Path, audio: np.ndarray) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, SR)
    return path


@pytest.fixture
def song():
    """A song whose singer holds A3 for two seconds, rests for one, then holds E4."""
    vocals = _write(
        main_mod.STEMS_DIR / PID / "vocals.wav",
        _voice((220.0, 2.0), (None, 1.0), (329.63, 2.0)),
    )
    projects[PID] = {
        "id": PID,
        "track_id": PID,
        "title": "Melody",
        "status": "ready",
        "lines": [],
        "vocals_path": str(vocals),
    }
    return projects[PID]


@pytest.fixture
def analyses(monkeypatch):
    """Counts the analyzer's runs, leaving it to do its work."""
    runs: list[str] = []
    real = main_mod.vocal_analyzer.pitch_contour

    def counted(audio_input, sr=None):
        runs.append(str(audio_input))
        return real(audio_input, sr=sr)

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", counted)
    return runs


def _get(client, pid=PID):
    return client.get(f"/api/project/{pid}/melody")


def _sidecar() -> Path:
    return main_mod.STEMS_DIR / PID / melody.SIDECAR_NAME


def test_the_melody_is_the_singers_notes_in_time(client, song):
    res = _get(client)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["project_id"] == PID
    assert body["version"] == melody.MELODY_VERSION
    assert body["source"] == "vocals"
    assert body["detected"] is True
    assert body["hop"] == pytest.approx(0.032)
    assert body["start"] == pytest.approx(0.064)
    notes = body["midi"]
    # Five seconds of song, a frame every 32 ms
    assert len(notes) == pytest.approx(5.0 / 0.032, abs=5)

    def at(seconds: float):
        return notes[round((seconds - body["start"]) / body["hop"])]

    assert at(1.0) == pytest.approx(57.0, abs=0.2)  # A3
    assert at(2.5) is None  # the rest
    assert at(4.0) == pytest.approx(64.0, abs=0.2)  # E4
    assert body["low"] == pytest.approx(57.0, abs=0.3)
    assert body["high"] == pytest.approx(64.0, abs=0.3)
    # Tenths of a semitone: all a drawing needs, and a small answer
    assert all(note is None or round(note, 1) == note for note in notes)


def test_it_is_kept_beside_the_stems_and_not_on_the_song(client, song, monkeypatch):
    saves = []
    monkeypatch.setattr(main_mod, "save_projects", lambda *a, **k: saves.append(1))
    before = dict(song)

    body = _get(client).json()

    assert song == before
    assert saves == []
    kept = json.loads(_sidecar().read_text())
    assert kept["midi"] == body["midi"]
    assert kept["made_from"]["name"] == "vocals.wav"
    assert kept["made_from"]["size"] == Path(song["vocals_path"]).stat().st_size
    # The file's bookkeeping stays on the server
    assert "made_from" not in body
    assert not _sidecar().with_name(f"{melody.SIDECAR_NAME}.tmp").exists()


def test_a_second_request_reads_the_kept_melody(client, song, analyses):
    first = _get(client).json()
    second = _get(client).json()

    assert second == first
    assert len(analyses) == 1


def test_silent_vocals_have_no_melody_and_that_is_kept_too(client, song, analyses):
    _write(Path(song["vocals_path"]), np.zeros(SR * 3))

    body = _get(client).json()

    assert body["detected"] is False
    assert body["low"] is None
    assert body["high"] is None
    assert len(body["midi"]) > 50
    assert all(note is None for note in body["midi"])
    _get(client)
    assert len(analyses) == 1


def test_vocals_shorter_than_a_frame_have_no_frames(client, song):
    _write(Path(song["vocals_path"]), 0.4 * np.ones(400))

    body = _get(client).json()

    assert body["detected"] is False
    assert body["midi"] == []


def test_vocals_that_are_not_audio_answer_with_no_melody_and_keep_nothing(client, song):
    Path(song["vocals_path"]).write_bytes(b"this is not a wav file, whatever its name says")

    res = _get(client)

    assert res.status_code == 200
    body = res.json()
    assert body["detected"] is False
    assert body["midi"] == []
    assert not _sidecar().exists()


def test_an_unknown_song_is_a_404(client):
    assert _get(client, "nope").status_code == 404


@pytest.mark.parametrize("vocals", ["missing", "empty", "unset"])
def test_a_song_without_vocals_is_refused(client, song, vocals):
    path = Path(song["vocals_path"])
    if vocals == "missing":
        path.unlink()
    elif vocals == "empty":
        path.write_bytes(b"")
    else:
        del song["vocals_path"]

    res = _get(client)

    assert res.status_code == 400
    assert res.json()["detail"] == "This song has no separate vocal track."


def test_a_crash_in_the_analysis_is_a_500_that_says_nothing_of_the_server(
    client, song, monkeypatch
):
    def crash(audio_input, sr=None):
        raise MemoryError("could not allocate 1.2 GiB for /srv/secret/stems")

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", crash)

    res = _get(client)

    assert res.status_code == 500
    assert "secret" not in res.text
    assert not _sidecar().exists()


def test_the_studio_passphrase_is_needed(unauth_client, song):
    assert unauth_client.get(f"/api/project/{PID}/melody").status_code == 401


def test_the_answer_is_small_enough_to_send_whole(client, song):
    """A four-minute song is 7,500 frames: tens of kilobytes, not a file to stream."""
    _write(
        Path(song["vocals_path"]),
        np.concatenate([_voice((220.0, 2.0), (None, 1.0), (329.63, 2.0), (None, 1.0))] * 40),
    )

    res = _get(client)

    assert len(res.json()["midi"]) > 7000
    assert len(res.content) < 80_000
