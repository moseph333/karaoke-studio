"""Saved neural listening passes (backend.services.emission_cache): keyed by the vocals'
content, handed to the CTC worker on every neural pass, kept from a cloud separation, and
pruned to the most recently used."""

import io
import json
import os

import numpy as np
import soundfile as sf

from backend import config
from backend.services import emission_cache, lyric_sync
from backend.tests.helpers.fake_ctc_worker import install_fake_ctc


def _npy(rows=4, cols=3) -> bytes:
    buffer = io.BytesIO()
    np.save(buffer, np.zeros((rows, cols), dtype=np.float32))
    return buffer.getvalue()


def test_files_live_in_the_data_dir_and_follow_the_vocals_content(tmp_path):
    a, b, c = tmp_path / "a.wav", tmp_path / "moved" / "b.wav", tmp_path / "c.wav"
    b.parent.mkdir()
    a.write_bytes(b"RIFF-same")
    b.write_bytes(b"RIFF-same")
    c.write_bytes(b"RIFF-other")
    path = emission_cache.path_for(a)
    assert path.parent == config.DATA_DIR / "alignment_cache"
    assert path.name.startswith(f"mms_fa-v{emission_cache.CACHE_VERSION}-")
    assert emission_cache.path_for(b) == path  # moved or staged stems keep their emission
    assert emission_cache.path_for(c) != path
    assert emission_cache.path_for(tmp_path / "missing.wav") is None


def test_rewritten_vocals_get_a_new_key(tmp_path):
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"RIFF-one")
    before = emission_cache.path_for(vocals)
    vocals.write_bytes(b"RIFF-two-longer")
    assert emission_cache.path_for(vocals) != before


def test_a_cloud_emission_is_kept_under_its_vocals_key(tmp_path):
    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"RIFF-vocals")
    kept = emission_cache.store(b"RIFF-vocals", _npy())
    assert kept == emission_cache.path_for(vocals)
    assert np.load(kept).shape == (4, 3)


def test_only_real_arrays_are_kept():
    assert emission_cache.store(b"RIFF-vocals", b"<html>error</html>") is None
    assert emission_cache.store(b"", _npy()) is None
    assert emission_cache.store(b"RIFF", b"") is None
    assert not emission_cache.cache_dir().exists()


def test_pruning_keeps_the_most_recently_used(tmp_path):
    folder = emission_cache.cache_dir()
    folder.mkdir(parents=True)
    for i in range(5):
        path = folder / f"mms_fa-v1-{i}.npy"
        path.write_bytes(_npy())
        os.utime(path, (1000 + i, 1000 + i))
    (folder / "notes.txt").write_text("left alone")
    emission_cache.prune(keep=2)
    assert sorted(p.name for p in folder.iterdir()) == [
        "mms_fa-v1-3.npy",
        "mms_fa-v1-4.npy",
        "notes.txt",
    ]


def test_every_neural_pass_names_the_vocals_emission(tmp_path, monkeypatch):
    fake = install_fake_ctc(tmp_path, monkeypatch)
    vocals = tmp_path / "vocals.wav"
    sf.write(str(vocals), np.zeros(16000, dtype=np.float32), 16000)
    lines = [{"index": 0, "window_start": 0.0, "window_end": 1.0, "words": ["hi"]}]
    lyric_sync.run_neural_pass(str(vocals), lines)
    request = json.loads(fake.log.read_text())
    assert request["emission_cache"] == str(emission_cache.path_for(vocals))
