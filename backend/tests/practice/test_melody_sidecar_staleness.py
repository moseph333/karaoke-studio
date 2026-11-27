"""The melody kept beside a song's stems is used only while it was made, by this version of
the analysis, from the very file it would be made from now. New vocals, a lead part that
came or went, an older version or a damaged file all mean it is worked out again."""

import json
import os
import shutil
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects
from backend.services import melody

PID = "melodystale"
SR = 44100


def _tone(hz: float, seconds: float = 2.0) -> np.ndarray:
    t = np.arange(int(SR * seconds)) / SR
    return 0.4 * np.sin(2 * np.pi * hz * t)


def _write(path: Path, audio: np.ndarray, seconds_ago: float = 0.0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, SR)
    if seconds_ago:
        stamp = time.time() - seconds_ago
        os.utime(path, (stamp, stamp))
    return path


def _note(body: dict) -> float:
    sung = [note for note in body["midi"] if note is not None]
    return float(np.median(sung))


@pytest.fixture
def song():
    """A song whose vocals, separated ten minutes ago, hold A3."""
    vocals = _write(main_mod.STEMS_DIR / PID / "vocals.wav", _tone(220.0), seconds_ago=600)
    projects[PID] = {"id": PID, "track_id": PID, "status": "ready", "vocals_path": str(vocals)}
    return projects[PID]


@pytest.fixture
def analyses(monkeypatch):
    runs: list[str] = []
    real = main_mod.vocal_analyzer.pitch_contour

    def counted(audio_input, sr=None):
        runs.append(Path(str(audio_input)).name)
        return real(audio_input, sr=sr)

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", counted)
    return runs


def _get(client) -> dict:
    res = client.get(f"/api/project/{PID}/melody")
    assert res.status_code == 200, res.text
    return res.json()


def _sidecar() -> Path:
    return main_mod.STEMS_DIR / PID / melody.SIDECAR_NAME


def _split(stems: Path, lead_hz: float, seconds_ago: float = 0.0) -> None:
    """The vocals split into lead and backing, as a vocal split leaves them."""
    _write(stems / "vocals_lead.wav", _tone(lead_hz), seconds_ago)
    _write(stems / "vocals_backing.wav", _tone(110.0), seconds_ago)


def test_new_vocals_get_a_new_melody(client, song, analyses):
    assert _note(_get(client)) == pytest.approx(57.0, abs=0.2)
    # A re-separation replaces the stem
    _write(Path(song["vocals_path"]), _tone(329.63))

    assert _note(_get(client)) == pytest.approx(64.0, abs=0.2)
    assert analyses == ["vocals.wav", "vocals.wav"]


def test_vocals_put_back_with_an_older_date_still_count_as_changed(client, song, analyses):
    """Equality, not "is it newer": a restored file is another file."""
    _get(client)
    _write(Path(song["vocals_path"]), _tone(329.63), seconds_ago=5000)

    assert _note(_get(client)) == pytest.approx(64.0, abs=0.2)


def test_the_lead_part_is_read_once_the_vocals_are_split(client, song, analyses):
    assert _get(client)["source"] == "vocals"
    _split(Path(song["vocals_path"]).parent, lead_hz=440.0)

    body = _get(client)

    assert body["source"] == "lead"
    assert _note(body) == pytest.approx(69.0, abs=0.2)
    assert analyses == ["vocals.wav", "vocals_lead.wav"]
    # And kept: asking again reads nothing
    _get(client)
    assert len(analyses) == 2


def test_a_lead_part_older_than_the_vocals_is_not_read(client, song, analyses):
    """New vocals make the old split stale: its lead is of another recording."""
    _split(Path(song["vocals_path"]).parent, lead_hz=440.0, seconds_ago=5000)

    body = _get(client)

    assert body["source"] == "vocals"
    assert _note(body) == pytest.approx(57.0, abs=0.2)


def test_the_whole_vocals_are_read_again_when_the_split_goes(client, song, analyses):
    stems = Path(song["vocals_path"]).parent
    _split(stems, lead_hz=440.0)
    assert _get(client)["source"] == "lead"
    (stems / "vocals_lead.wav").unlink()
    (stems / "vocals_backing.wav").unlink()

    body = _get(client)

    assert body["source"] == "vocals"
    assert _note(body) == pytest.approx(57.0, abs=0.2)


def test_a_melody_from_another_version_of_the_analysis_is_made_again(
    client, song, analyses, monkeypatch
):
    _get(client)
    monkeypatch.setattr(melody, "MELODY_VERSION", melody.MELODY_VERSION + 1)

    body = _get(client)

    assert body["version"] == melody.MELODY_VERSION
    assert len(analyses) == 2
    assert json.loads(_sidecar().read_text())["version"] == melody.MELODY_VERSION


@pytest.mark.parametrize(
    "damage",
    [b"", b"{not json", b"[1, 2, 3]", b'{"version": 1}', b'{"version": 1, "midi": "none"}'],
)
def test_a_damaged_file_is_made_again(client, song, analyses, damage):
    _get(client)
    _sidecar().write_bytes(damage)

    assert _note(_get(client)) == pytest.approx(57.0, abs=0.2)
    assert len(analyses) == 2
    assert json.loads(_sidecar().read_text())["detected"] is True


def test_a_folder_that_cannot_be_written_still_answers(client, song, analyses, monkeypatch):
    def refuse(self, *args, **kwargs):
        raise PermissionError("read-only file system")

    monkeypatch.setattr(Path, "write_text", refuse)

    body = _get(client)

    assert _note(body) == pytest.approx(57.0, abs=0.2)
    assert not _sidecar().exists()


def test_a_song_deleted_during_the_analysis_leaves_nothing_behind(client, song, monkeypatch):
    stems = Path(song["vocals_path"]).parent
    real = main_mod.vocal_analyzer.pitch_contour

    def deleted_meanwhile(audio_input, sr=None):
        contour = real(audio_input, sr=sr)
        projects.pop(PID)
        return contour

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", deleted_meanwhile)

    res = client.get(f"/api/project/{PID}/melody")

    assert res.status_code == 404
    assert not (stems / melody.SIDECAR_NAME).exists()


def test_a_song_whose_folder_went_during_the_analysis_does_not_get_it_back(
    client, song, monkeypatch
):
    stems = Path(song["vocals_path"]).parent
    real = main_mod.vocal_analyzer.pitch_contour

    def folder_gone(audio_input, sr=None):
        contour = real(audio_input, sr=sr)
        shutil.rmtree(stems)
        return contour

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", folder_gone)

    res = client.get(f"/api/project/{PID}/melody")

    # Its vocals vanished mid-run: no melody, and no folder made again to hold one
    assert res.status_code == 200
    assert res.json()["detected"] is False
    assert not stems.exists()


def test_vocals_replaced_during_the_analysis_are_read_on_the_next_request(
    client, song, monkeypatch
):
    real = main_mod.vocal_analyzer.pitch_contour
    runs = []

    def replaced_meanwhile(audio_input, sr=None):
        contour = real(audio_input, sr=sr)
        if not runs:
            _write(Path(song["vocals_path"]), _tone(329.63))
        runs.append(1)
        return contour

    monkeypatch.setattr(main_mod.vocal_analyzer, "pitch_contour", replaced_meanwhile)

    first = _get(client)
    # The melody of the old vocals is not passed off as the new ones'
    assert first["detected"] is False
    assert not _sidecar().exists()

    assert _note(_get(client)) == pytest.approx(64.0, abs=0.2)
