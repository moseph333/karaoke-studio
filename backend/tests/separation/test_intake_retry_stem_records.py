"""Retrying a YouTube intake (adding the same URL again) replaces the song, but not what it
knew about its stems.

Stems made before separation.json records were kept beside them count as Fast. When the old
song recorded how they were made, the retry writes that record first, so the stems are reused
instead of being separated again; stems no song vouches for still count as Fast. Engines never
run here: every launch is recorded and fails.
"""

import threading
import types
from pathlib import Path

import pytest

import backend.main as main_mod
from backend import pipeline
from backend.services import separator as separator_mod
from backend.tests.helpers.media import generate_sine_wave_wav

VIDEO_ID = "dQw4w9WgXcQ"
URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
BEST_RECORD = {
    "preset": "best",
    "engine": "roformer",
    "models": ["vocals_mel_band_roformer.ckpt", "model_bs_roformer_ep_317_sdr_12.9755.ckpt"],
    "label": "Best · RoFormer ensemble",
    "requested": "best",
    "fallback_reason": None,
    "elapsed_seconds": 412.5,
    "separated_at": 1767225600,
}


def _write_stems(stem_dir: Path) -> None:
    generate_sine_wave_wav(stem_dir / "vocals.wav", duration=0.25, freq=880.0)
    generate_sine_wave_wav(stem_dir / "instrumental.wav", duration=0.25, freq=440.0)


def _stem_files(stem_dir: Path) -> dict[str, tuple[int, int]]:
    """Each file's inode and mtime, which change whenever the file is replaced."""
    return {p.name: (p.stat().st_ino, p.stat().st_mtime_ns) for p in sorted(stem_dir.iterdir())}


@pytest.fixture
def retry(monkeypatch):
    """A failed intake of VIDEO_ID, on a server set to Best, whose stems were made before
    records were kept. The retried intake runs only its separation step."""
    monkeypatch.setenv("SEPARATION_QUALITY", "best")
    stem_dir = main_mod.STEMS_DIR / VIDEO_ID
    _write_stems(stem_dir)
    audio = generate_sine_wave_wav(main_mod.DOWNLOADS_DIR / f"{VIDEO_ID}.wav", duration=0.25)
    main_mod.projects[VIDEO_ID] = {
        "id": VIDEO_ID,
        "track_id": VIDEO_ID,
        "title": "Never Gonna Give You Up",
        "status": "error",
        "error": "Lyrics fetch failed",
        "vocals_path": str(stem_dir / "vocals.wav"),
        "instrumental_path": str(stem_dir / "instrumental.wav"),
    }
    main_mod.save_projects()

    launches: list[list[str]] = []

    def popen(cmd, *args, **kwargs):
        launches.append(list(cmd))
        raise OSError("no separation engine may run in this test")

    monkeypatch.setattr(separator_mod.subprocess, "Popen", popen)
    monkeypatch.setattr(separator_mod, "plan_status", lambda plan: (True, None))

    def separation_step(project_id, url_or_id, custom_lyrics=None):
        pipeline.separate_project_stems(
            main_mod,
            project_id,
            str(audio),
            VIDEO_ID,
            0.25,
            lambda *args, **kwargs: None,
            threading.Event(),
        )

    monkeypatch.setattr(main_mod, "run_pipeline", separation_step)
    return types.SimpleNamespace(stem_dir=stem_dir, launches=launches)


def test_a_retried_intake_reuses_stems_its_old_song_recorded_as_best(client, retry):
    main_mod.projects[VIDEO_ID]["separation"] = dict(BEST_RECORD)
    main_mod.save_projects()
    before = _stem_files(retry.stem_dir)

    res = client.post("/api/process", json={"url_or_id": URL})

    assert res.status_code == 200
    assert res.json() == {"project_id": VIDEO_ID, "status": "queued"}
    assert retry.launches == []
    assert separator_mod.read_provenance(retry.stem_dir) == BEST_RECORD
    after = _stem_files(retry.stem_dir)
    assert {name: after[name] for name in before} == before  # the stems were not touched
    song = main_mod.projects[VIDEO_ID]
    assert song["separation"] == {**BEST_RECORD, "requested": "best", "fallback_reason": None}
    assert song["vocals_path"] == str(retry.stem_dir / "vocals.wav")


def test_a_retried_intake_without_a_record_still_counts_its_stems_as_fast(client, retry):
    before = _stem_files(retry.stem_dir)

    res = client.post("/api/process", json={"url_or_id": URL})

    assert res.status_code == 200
    # Best, then Balanced, were tried to beat the stems, as for any Fast stems; both failed
    # here, so the stems were kept
    assert len(retry.launches) == 2
    assert all("backend.workers.roformer_worker" in cmd for cmd in retry.launches)
    assert separator_mod.read_provenance(retry.stem_dir) is None
    assert _stem_files(retry.stem_dir) == before
    assert "separation" not in main_mod.projects[VIDEO_ID]


def test_adopted_records_go_only_to_valid_stems_without_a_readable_record(tmp_path):
    stem_dir = tmp_path / "stems" / "trk"
    separator_mod.adopt_provenance(stem_dir, BEST_RECORD)  # no stems at all
    assert not stem_dir.exists()

    stem_dir.mkdir(parents=True)
    (stem_dir / "vocals.wav").write_bytes(b"")
    generate_sine_wave_wav(stem_dir / "instrumental.wav", duration=0.25)
    separator_mod.adopt_provenance(stem_dir, BEST_RECORD)  # an empty vocal stem
    assert separator_mod.read_provenance(stem_dir) is None

    _write_stems(stem_dir)
    separator_mod.adopt_provenance(stem_dir, None)
    separator_mod.adopt_provenance(stem_dir, "best")
    assert separator_mod.read_provenance(stem_dir) is None

    # An unreadable record counts as none, so the known one takes its place
    (stem_dir / "separation.json").write_text("{not json")
    separator_mod.adopt_provenance(stem_dir, BEST_RECORD)
    assert separator_mod.read_provenance(stem_dir) == BEST_RECORD

    # A readable record describes the stems on disk and always wins
    separator_mod.write_provenance(stem_dir, {"preset": "fast"})
    separator_mod.adopt_provenance(stem_dir, BEST_RECORD)
    assert separator_mod.read_provenance(stem_dir) == {"preset": "fast"}
    assert sorted(p.name for p in stem_dir.iterdir()) == [
        "instrumental.wav",
        "separation.json",
        "vocals.wav",
    ]
