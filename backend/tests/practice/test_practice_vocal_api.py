"""POST /api/project/{id}/practice-vocal: where a song's vocals by themselves are served at a
key, for practice to play beside the master.

At the original key the answer is the vocal stem and nothing is made; at another key the
mixer shifts the stem alone, once, and the file is reused. Nothing is saved on the song.
"""

import os
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend import config, master_audio
from backend.main import projects
from backend.master_audio import PRACTICE_VOCAL_KEY, practice_vocal_filename
from backend.update_drain import drain_file

PID = "practice01"


def _write_wav(path: Path, seconds: float = 0.5, freq: float = 440.0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, seconds, int(44100 * seconds), endpoint=False)
    tone = 0.2 * np.sin(2 * np.pi * freq * t)
    sf.write(str(path), np.column_stack([tone, tone]), 44100)
    return path


def _age(path: Path, seconds_ago: float) -> None:
    stamp = time.time() - seconds_ago
    os.utime(path, (stamp, stamp))


@pytest.fixture
def song():
    """A finished song whose stems were separated ten minutes ago."""
    stems = main_mod.STEMS_DIR / PID
    inst = _write_wav(stems / "instrumental.wav")
    vocals = _write_wav(stems / "vocals.wav", freq=880.0)
    _age(inst, 600)
    _age(vocals, 600)
    projects[PID] = {
        "id": PID,
        "track_id": PID,
        "title": "Practice",
        "artist": "Tester",
        "status": "ready",
        "progress": 100,
        "lines": [],
        "instrumental_path": str(inst),
        "vocals_path": str(vocals),
        "vocals_url": f"/static/stems/{PID}/vocals.wav",
        "semitones": 0,
        "guide_volume": 0.0,
    }
    return projects[PID]


@pytest.fixture
def calls(monkeypatch):
    """A mixer and an encoder that record their calls and write real files."""
    log: dict[str, list] = {"mix": [], "encode": []}

    def fake_mix(**kwargs):
        log["mix"].append(kwargs)
        return str(_write_wav(main_mod.OUTPUT_DIR / kwargs["output_filename"], seconds=0.25))

    def fake_encode(wav_path, timeout=120):
        log["encode"].append(Path(wav_path).name)
        preview = Path(wav_path).with_suffix(".m4a")
        preview.write_bytes(b"\x00\x00\x00\x18ftypM4A fake preview")
        return str(preview)

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix)
    monkeypatch.setattr(main_mod.audio_mixer, "encode_preview", fake_encode)
    return log


@pytest.fixture
def aac(monkeypatch):
    monkeypatch.setattr(config, "PREVIEW_AUDIO_FORMAT", "aac")
    monkeypatch.setattr(master_audio, "ffmpeg_has_encoder", lambda name: name == "aac")


def _ask(client, semitones=None, pid=PID):
    body = {} if semitones is None else {"semitones": semitones}
    return client.post(f"/api/project/{pid}/practice-vocal", json=body)


def _made() -> list[str]:
    return sorted(p.name for p in main_mod.OUTPUT_DIR.iterdir() if p.name.startswith(f"{PID}_"))


# --- The original key ---


def test_the_original_key_is_the_vocal_stem_itself(client, song, calls):
    res = _ask(client, 0)

    assert res.status_code == 200, res.text
    assert res.json() == {"status": "ok", "url": f"/static/stems/{PID}/vocals.wav", "semitones": 0}
    assert calls["mix"] == []
    assert _made() == []


def test_no_key_given_means_the_original(client, song, calls):
    assert _ask(client).json()["url"] == f"/static/stems/{PID}/vocals.wav"


def test_the_stem_link_keeps_the_version_a_re_separation_gave_it(client, song, calls):
    song["vocals_url"] = f"/static/stems/{PID}/vocals.wav?v=1700000000000"

    assert _ask(client, 0).json()["url"] == f"/static/stems/{PID}/vocals.wav?v=1700000000000"


def test_a_song_without_a_stem_link_gets_the_stems_place(client, song, calls):
    del song["vocals_url"]

    assert _ask(client, 0).json()["url"] == f"/static/stems/{PID}/vocals.wav"


# --- Another key ---


def test_another_key_shifts_the_vocals_alone(client, song, calls):
    res = _ask(client, 2)

    assert res.status_code == 200, res.text
    name = f"{PID}_mix_2_100_{PRACTICE_VOCAL_KEY}.wav"
    assert name == practice_vocal_filename(PID, 2)
    body = res.json()
    assert body["status"] == "ok"
    assert body["semitones"] == 2
    assert body["url"].startswith(f"/static/output/{name}?v=")
    # The stem is the mixer's only input: the chain a master's backing takes at that key
    assert calls["mix"] == [
        {
            "instrumental_path": song["vocals_path"],
            "vocals_path": None,
            "semitones": 2,
            "guide_volume": 0.0,
            "output_filename": name,
        }
    ]


def test_a_key_down_has_its_own_file(client, song, calls):
    assert f"{PID}_mix_-3_100_{PRACTICE_VOCAL_KEY}.wav?v=" in _ask(client, -3).json()["url"]


def test_the_same_key_again_reuses_the_file(client, song, calls):
    first = _ask(client, 2).json()["url"]
    second = _ask(client, 2).json()["url"]

    assert second == first
    assert len(calls["mix"]) == 1


def test_new_vocals_make_the_file_again(client, song, calls):
    _ask(client, 2)
    made = main_mod.OUTPUT_DIR / practice_vocal_filename(PID, 2)
    _age(made, 300)
    # A re-separation just replaced the stem
    _write_wav(Path(song["vocals_path"]), freq=660.0)

    _ask(client, 2)

    assert len(calls["mix"]) == 2


def test_nothing_is_saved_on_the_song(client, song, calls, monkeypatch):
    saves = []
    monkeypatch.setattr(main_mod, "save_projects", lambda *a, **k: saves.append(1))
    before = dict(song)

    _ask(client, 2)

    assert song == before
    assert saves == []


def test_the_songs_current_master_survives_the_prune(client, song, calls, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    master = _write_wav(main_mod.OUTPUT_DIR / f"{PID}_mix_2_0.wav", seconds=0.1)
    _age(master, 300)
    song["master_audio_path"] = str(master)

    _ask(client, 2)

    assert _made() == [f"{PID}_mix_2_0.wav", practice_vocal_filename(PID, 2)]


# --- A server that streams compressed copies ---


def test_a_compressed_master_gets_a_compressed_vocal(client, song, calls, aac):
    url = _ask(client, 2).json()["url"]

    name = practice_vocal_filename(PID, 2)
    assert url.startswith(f"/static/output/{Path(name).with_suffix('.m4a').name}?v=")
    assert calls["encode"] == [name]


def test_a_compressed_master_at_the_original_key_gets_a_compressed_vocal_too(
    client, song, calls, aac
):
    """The stem is a WAV: beside a compressed master it would start a few milliseconds
    early, so the copy is made at the original key as well."""
    url = _ask(client, 0).json()["url"]

    name = practice_vocal_filename(PID, 0)
    assert url.startswith(f"/static/output/{Path(name).with_suffix('.m4a').name}?v=")
    assert [call["semitones"] for call in calls["mix"]] == [0]
    assert not list((main_mod.STEMS_DIR / PID).glob("*.m4a"))


def test_without_an_encoder_the_wav_is_served(client, song, calls, monkeypatch):
    monkeypatch.setattr(config, "PREVIEW_AUDIO_FORMAT", "aac")
    monkeypatch.setattr(master_audio, "ffmpeg_has_encoder", lambda name: False)

    assert _ask(client, 0).json()["url"] == f"/static/stems/{PID}/vocals.wav"
    assert ".wav?v=" in _ask(client, 2).json()["url"]


# --- Refusals ---


def test_an_unknown_song_is_a_404(client, calls):
    assert _ask(client, 2, pid="nope").status_code == 404


@pytest.mark.parametrize("semitones", [13, -13, 1.5, "high"])
def test_a_key_out_of_range_is_refused(client, song, calls, semitones):
    assert _ask(client, semitones).status_code == 422
    assert calls["mix"] == []


@pytest.mark.parametrize("status", ["processing", "separating", "mixing"])
def test_a_song_still_being_made_is_refused(client, song, calls, status):
    song["status"] = status

    res = _ask(client, 2)

    assert res.status_code == 409
    assert res.json()["detail"] == "This song is still being processed"


@pytest.mark.parametrize("vocals", ["missing", "empty", "unset"])
def test_a_song_without_vocals_is_refused(client, song, calls, vocals):
    path = Path(song["vocals_path"])
    if vocals == "missing":
        path.unlink()
    elif vocals == "empty":
        path.write_bytes(b"")
    else:
        song["vocals_path"] = None

    for semitones in (0, 2):
        res = _ask(client, semitones)
        assert res.status_code == 400
        assert res.json()["detail"] == "This song has no separate vocal track."
    assert calls["mix"] == []


def test_a_full_disk_refuses_only_a_file_that_must_be_made(client, song, calls, monkeypatch):
    _ask(client, 2)
    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 10**12)

    assert _ask(client, 0).status_code == 200
    assert _ask(client, 2).status_code == 200  # already made
    assert _ask(client, 5).status_code == 507
    assert len(calls["mix"]) == 1


def test_an_update_waiting_for_jobs_does_not_stop_practice(client, song, calls):
    drain_file().write_text("draining", encoding="utf-8")

    assert _ask(client, 2).status_code == 200


def test_vocals_replaced_during_the_run_leave_no_file(client, song, monkeypatch):
    def mix_while_the_stem_is_replaced(**kwargs):
        made = _write_wav(main_mod.OUTPUT_DIR / kwargs["output_filename"], seconds=0.25)
        _write_wav(Path(song["vocals_path"]), seconds=0.7, freq=660.0)
        return str(made)

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", mix_while_the_stem_is_replaced)

    res = _ask(client, 2)

    assert res.status_code == 409
    assert res.json()["detail"] == "The song's vocals were just replaced. Try again."
    assert _made() == []


def test_a_mixer_failure_is_a_500_that_says_nothing_of_the_server(client, song, monkeypatch):
    def broken(**kwargs):
        raise RuntimeError("FFmpeg audio mixing failed (code 1): /srv/data/secret/path")

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", broken)

    res = _ask(client, 2)

    assert res.status_code == 500
    assert "secret" not in res.text
    assert _made() == []


def test_the_studio_passphrase_is_needed(unauth_client, song):
    assert unauth_client.post(f"/api/project/{PID}/practice-vocal", json={}).status_code == 401
