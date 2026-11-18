"""The first mix's preview is made before the intake takes the store lock.

With PREVIEW_AUDIO_FORMAT=aac, master_fields() encodes the mix with FFmpeg. The pipelines
called it inside PROJECTS_LOCK, so every status poll, save and library listing waited for
the encode."""

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects
from backend.project_store import PROJECTS_LOCK
from backend.services.lyric_sync import SyncResult

LYRICS = {"source": "lrclib", "synced": True, "lines": [{"text": "hi", "start": 1.0, "end": 2.0}]}
SONG = "firstmix001"


@pytest.fixture
def lock_held_during_preview(monkeypatch, tmp_path):
    """Stand-ins for the download, separation, lyrics, alignment and mix; yields what
    master_fields saw of the store lock on each call."""
    wav = main_mod.DOWNLOADS_DIR / f"{SONG}.wav"
    sf.write(str(wav), np.zeros((4410, 2), dtype="float32"), 44100)
    monkeypatch.setattr(
        main_mod.downloader,
        "extract_info_and_download",
        lambda url, progress_hook=None: {
            "id": SONG,
            "title": "Song",
            "artist": "Singer",
            "duration": 200.0,
            "audio_path": str(wav),
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

    held = []
    real = pipeline.master_fields

    def spy(path):
        held.append(PROJECTS_LOCK._is_owned())
        return real(path)

    monkeypatch.setattr(pipeline, "master_fields", spy)
    projects[SONG] = {"id": SONG, "status": "queued", "lines": []}
    active_cancellations.pop(SONG, None)
    yield held
    projects.pop(SONG, None)


def test_a_youtube_intake_makes_the_preview_before_it_locks_the_store(lock_held_during_preview):
    pipeline.run_pipeline(SONG, SONG)

    assert projects[SONG]["status"] == "ready"
    assert projects[SONG]["master_audio_url"].startswith("/static/output/m.wav?v=")
    assert lock_held_during_preview == [False]


def test_an_upload_intake_makes_the_preview_before_it_locks_the_store(lock_held_during_preview):
    wav = main_mod.DOWNLOADS_DIR / f"{SONG}.wav"

    pipeline.run_local_pipeline(SONG, str(wav), "Song", "Singer")

    assert projects[SONG]["status"] == "ready", projects[SONG].get("error")
    assert projects[SONG]["master_audio_url"].startswith("/static/output/m.wav?v=")
    assert lock_held_during_preview == [False]
