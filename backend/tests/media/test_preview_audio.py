"""PREVIEW_AUDIO_FORMAT: with "aac" the studio streams a compressed .m4a copy of the master
mix, while exports, renders and the waveform keep using the WAV ("wav" is the default)."""

import os
import shutil
import subprocess
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend import config, master_audio
from backend.main import projects
from backend.master_audio import MIX_CACHE_MARKER, master_fields, mix_cache_epoch, mix_filename
from backend.services.audio_mixer import AudioMixer, ffmpeg_has_encoder, reset_ffmpeg_probe


def _write_wav(path: Path, seconds: float = 0.5, freq: float = 440.0) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, seconds, int(44100 * seconds), endpoint=False)
    tone = 0.2 * np.sin(2 * np.pi * freq * t)
    sf.write(str(path), np.column_stack([tone, tone]), 44100)
    return path


def _age(path: Path, seconds_ago: float) -> None:
    stamp = time.time() - seconds_ago
    os.utime(path, (stamp, stamp))


@pytest.fixture(autouse=True)
def mixer_in_use_for_an_hour():
    mix_cache_epoch(main_mod.OUTPUT_DIR)
    _age(main_mod.OUTPUT_DIR / MIX_CACHE_MARKER, 3600)


@pytest.fixture
def song():
    pid = "prev01"
    stems = main_mod.STEMS_DIR / pid
    inst = _write_wav(stems / "no_vocals.wav")
    vocals = _write_wav(stems / "vocals.wav", freq=880.0)
    _age(inst, 600)
    _age(vocals, 600)
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "status": "ready",
        "progress": 100,
        "lines": [],
        "instrumental_path": str(inst),
        "vocals_path": str(vocals),
        "semitones": 0,
        "guide_volume": 0.0,
    }
    return projects[pid]


@pytest.fixture
def calls(monkeypatch):
    """Fake mixer and encoder that record their calls and write real files."""
    log: dict[str, list] = {"mix": [], "encode": []}

    def fake_mix(
        instrumental_path, vocals_path=None, semitones=0, guide_volume=0.0, output_filename=None
    ):
        log["mix"].append(output_filename)
        return str(_write_wav(main_mod.OUTPUT_DIR / output_filename, seconds=0.25))

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


def _mix(client, pid, semitones=2, guide=0.0) -> str:
    res = client.post(
        f"/api/project/{pid}/mix", json={"semitones": semitones, "guide_volume": guide}
    )
    assert res.status_code == 200, res.text
    return res.json()["master_audio_url"]


@pytest.mark.parametrize(
    ("guide", "suffix"),
    [(0.0, "_0"), (0.25, "_25"), (0.29, "_29"), (0.3333333, "_33"), (1, "_100")],
)
def test_mix_filename_rounds_the_guide_level(guide, suffix):
    assert mix_filename("t1", 3, guide) == f"t1_mix_3{suffix}.wav"


def test_wav_mode_streams_the_wav_and_never_encodes(client, song, calls):
    assert config.PREVIEW_AUDIO_FORMAT == "wav"  # the default, pinned for tests
    url = _mix(client, song["id"])
    assert url.startswith("/static/output/prev01_mix_2_0.wav?v=")
    assert calls["encode"] == []


def test_aac_mode_streams_the_preview_and_keeps_the_wav_as_the_master(client, song, calls, aac):
    url = _mix(client, song["id"])

    assert url.startswith("/static/output/prev01_mix_2_0.m4a?v=")
    assert calls["encode"] == ["prev01_mix_2_0.wav"]
    stored = projects[song["id"]]
    assert stored["master_audio_path"] == str(main_mod.OUTPUT_DIR / "prev01_mix_2_0.wav")
    assert stored["master_audio_url"] == url


def test_a_repeated_mix_reuses_both_files(client, song, calls, aac):
    first = _mix(client, song["id"])
    second = _mix(client, song["id"])
    assert second == first
    assert calls == {"mix": ["prev01_mix_2_0.wav"], "encode": ["prev01_mix_2_0.wav"]}


def test_a_new_wav_is_encoded_again(song, calls, aac):
    wav = _write_wav(main_mod.OUTPUT_DIR / "prev01_mix_1_0.wav")
    master_fields(str(wav))
    preview = wav.with_suffix(".m4a")
    _age(preview, 120)
    # Same name, re-made after the preview
    _write_wav(wav, freq=660.0)

    fields = master_fields(str(wav))

    assert calls["encode"] == ["prev01_mix_1_0.wav", "prev01_mix_1_0.wav"]
    assert fields["master_audio_url"].startswith("/static/output/prev01_mix_1_0.m4a?v=")


def test_falls_back_to_the_wav_without_an_aac_encoder(client, song, calls, monkeypatch):
    monkeypatch.setattr(config, "PREVIEW_AUDIO_FORMAT", "aac")
    monkeypatch.setattr(master_audio, "ffmpeg_has_encoder", lambda name: False)
    assert _mix(client, song["id"]).startswith("/static/output/prev01_mix_2_0.wav?v=")
    assert calls["encode"] == []


def test_falls_back_to_the_wav_when_encoding_fails(client, song, calls, aac, monkeypatch):
    def broken_encode(wav_path, timeout=120):
        raise RuntimeError("AAC preview encoding failed (code 1): Unknown encoder 'aac'")

    monkeypatch.setattr(main_mod.audio_mixer, "encode_preview", broken_encode)
    assert _mix(client, song["id"]).startswith("/static/output/prev01_mix_2_0.wav?v=")


def test_invalid_setting_means_wav(monkeypatch):
    import importlib

    monkeypatch.setenv("PREVIEW_AUDIO_FORMAT", "flac")
    try:
        assert importlib.reload(config).PREVIEW_AUDIO_FORMAT == "wav"
        monkeypatch.setenv("PREVIEW_AUDIO_FORMAT", " AAC ")
        assert importlib.reload(config).PREVIEW_AUDIO_FORMAT == "aac"
    finally:
        monkeypatch.delenv("PREVIEW_AUDIO_FORMAT")
        importlib.reload(config)


def test_waveform_and_master_export_still_use_the_wav(client, song, calls, aac):
    _mix(client, song["id"])

    waveform = client.get(f"/api/project/{song['id']}/waveform?bins=64")
    assert waveform.status_code == 200
    assert waveform.json()["source"] == "master"

    export = client.get(f"/api/project/{song['id']}/export/audio/master")
    assert export.status_code == 200, export.text
    assert export.content[:4] == b"RIFF"


def test_m4a_is_served_as_audio_mp4_with_ranges(client):
    preview = main_mod.OUTPUT_DIR / "served.m4a"
    preview.write_bytes(b"\x00\x00\x00\x18ftypM4A " + bytes(4096))

    whole = client.get("/static/output/served.m4a")
    assert whole.status_code == 200
    assert whole.headers["content-type"] == "audio/mp4"
    assert whole.headers.get("accept-ranges") == "bytes"

    part = client.get("/static/output/served.m4a", headers={"Range": "bytes=0-99"})
    assert part.status_code == 206
    assert len(part.content) == 100


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
def test_real_encoder_writes_an_aac_file_with_the_index_first(tmp_path):
    reset_ffmpeg_probe()
    if not ffmpeg_has_encoder("aac"):
        pytest.skip("FFmpeg has no AAC encoder")
    wav = _write_wav(tmp_path / "song_mix_0_0.wav", seconds=2.0)

    preview = Path(AudioMixer(output_dir=tmp_path).encode_preview(str(wav)))

    assert preview == wav.with_suffix(".m4a")
    assert not list(tmp_path.glob("*.tmp_*"))
    data = preview.read_bytes()
    # Top-level MP4 boxes: the index (moov) comes before the audio (mdat), so playback and
    # seeking start before the whole file has downloaded
    boxes, offset = [], 0
    while offset + 8 <= len(data):
        size = int.from_bytes(data[offset : offset + 4], "big")
        boxes.append(data[offset + 4 : offset + 8].decode("latin-1"))
        if size < 8:
            break
        offset += size
    assert boxes.index("moov") < boxes.index("mdat")
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=codec_name", "-of", "csv=p=0", preview],
        capture_output=True,
        text=True,
    )
    assert probe.stdout.strip() == "aac"
    assert preview.stat().st_size < wav.stat().st_size / 4
