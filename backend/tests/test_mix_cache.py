"""Mix render reuse: POST /api/project/{id}/mix serves an existing render when this mixer
version made it and it is still newer than its source stems, and always returns a
cache-busting versioned master URL."""

import os
import time
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.main import projects
from backend.routers.projects import (
    MIX_CACHE_MARKER,
    MIX_CACHE_VERSION,
    mix_cache_epoch,
    mix_version,
    reusable_mix_path,
)


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
    """This mixer version started rendering into the output folder an hour ago."""
    mix_cache_epoch(main_mod.OUTPUT_DIR)
    _age(main_mod.OUTPUT_DIR / MIX_CACHE_MARKER, 3600)


@pytest.fixture
def mix_project():
    pid = "mixcache01"
    stems = main_mod.STEMS_DIR / pid
    inst = _write_wav(stems / "no_vocals.wav")
    vocals = _write_wav(stems / "vocals.wav", freq=880.0)
    # Stems were separated a while ago
    _age(inst, 600)
    _age(vocals, 600)
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Mix Cache",
        "artist": "Tester",
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
def mixer_calls(monkeypatch):
    calls = []

    def fake_mix_and_shift(
        instrumental_path, vocals_path=None, semitones=0, guide_volume=0.0, output_filename=None
    ):
        calls.append((semitones, guide_volume, output_filename))
        return str(_write_wav(main_mod.OUTPUT_DIR / output_filename, seconds=0.25))

    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", fake_mix_and_shift)
    return calls


def _mix(client, pid, semitones, guide):
    res = client.post(
        f"/api/project/{pid}/mix", json={"semitones": semitones, "guide_volume": guide}
    )
    assert res.status_code == 200, res.text
    return res.json()["master_audio_url"]


def test_identical_mix_request_reuses_the_existing_render(client, mix_project, mixer_calls):
    first = _mix(client, mix_project["id"], 2, 0.0)
    second = _mix(client, mix_project["id"], 2, 0.0)

    assert len(mixer_calls) == 1
    assert first.startswith(f"/static/output/{mix_project['id']}_mix_2_0.wav?v=")
    assert second == first
    assert projects[mix_project["id"]]["master_audio_url"] == first
    assert projects[mix_project["id"]]["semitones"] == 2


def test_switching_back_to_a_previous_key_does_not_rerender(client, mix_project, mixer_calls):
    _mix(client, mix_project["id"], 1, 0.0)
    _mix(client, mix_project["id"], 3, 0.0)
    _mix(client, mix_project["id"], 1, 0.0)

    assert [c[0] for c in mixer_calls] == [1, 3]


def test_replaced_instrumental_invalidates_the_cached_render(client, mix_project, mixer_calls):
    out = main_mod.OUTPUT_DIR / f"{mix_project['id']}_mix_0_0.wav"
    _mix(client, mix_project["id"], 0, 0.0)
    _age(out, 120)

    # The user uploads a new backing track after the render was made
    custom = _write_wav(Path(mix_project["instrumental_path"]).with_name("custom_inst.wav"))
    projects[mix_project["id"]]["instrumental_path"] = str(custom)

    _mix(client, mix_project["id"], 0, 0.0)
    assert len(mixer_calls) == 2


def test_newer_vocals_only_matter_when_the_guide_vocal_is_mixed_in(
    client, mix_project, mixer_calls
):
    pid = mix_project["id"]
    _mix(client, pid, 0, 0.0)
    _mix(client, pid, 0, 0.3)
    assert len(mixer_calls) == 2
    for name in (f"{pid}_mix_0_0.wav", f"{pid}_mix_0_30.wav"):
        _age(main_mod.OUTPUT_DIR / name, 120)

    # Vocals re-separated after both renders
    Path(mix_project["vocals_path"]).touch()

    _mix(client, pid, 0, 0.0)  # instrumental-only render stays valid
    assert len(mixer_calls) == 2
    _mix(client, pid, 0, 0.3)  # guide blend must be rebuilt
    assert len(mixer_calls) == 3


def test_truncated_cached_file_is_rendered_again(client, mix_project, mixer_calls):
    (main_mod.OUTPUT_DIR / f"{mix_project['id']}_mix_4_0.wav").write_bytes(b"RIFF")
    _mix(client, mix_project["id"], 4, 0.0)
    assert len(mixer_calls) == 1


def test_renders_from_an_older_mixer_are_made_again(client, mix_project, mixer_calls):
    for stem in ("instrumental_path", "vocals_path"):
        _age(Path(mix_project[stem]), 3 * 3600)
    # Rendered from these stems by Karaoke Studio 1.x, before this mixer version first ran
    old = _write_wav(main_mod.OUTPUT_DIR / f"{mix_project['id']}_mix_0_0.wav")
    _age(old, 2 * 3600)

    _mix(client, mix_project["id"], 0, 0.0)
    _mix(client, mix_project["id"], 0, 0.0)
    assert len(mixer_calls) == 1


def test_rerender_under_the_same_name_changes_the_url_version(client, mix_project, mixer_calls):
    out = main_mod.OUTPUT_DIR / f"{mix_project['id']}_mix_0_0.wav"
    first = _mix(client, mix_project["id"], 0, 0.0)
    _age(out, 120)
    Path(mix_project["instrumental_path"]).touch()

    second = _mix(client, mix_project["id"], 0, 0.0)
    assert first.split("?")[0] == second.split("?")[0]
    assert first != second


class TestReusableMixPath:
    def test_missing_file_is_not_reusable(self, tmp_path):
        assert reusable_mix_path(tmp_path, "nope.wav", []) is None

    def test_non_path_output_dir_is_ignored(self):
        assert reusable_mix_path(MagicMock(), "x.wav", []) is None

    def test_missing_sources_do_not_block_reuse(self, tmp_path):
        mix_cache_epoch(tmp_path)
        out = _write_wav(tmp_path / "mix.wav")
        assert reusable_mix_path(tmp_path, "mix.wav", [None, str(tmp_path / "gone.wav")]) == str(
            out
        )

    def test_a_new_mixer_version_starts_over(self, tmp_path):
        marker = tmp_path / MIX_CACHE_MARKER
        marker.write_text("1", encoding="utf-8")
        _age(marker, 3600)
        _age(_write_wav(tmp_path / "mix.wav"), 600)  # made by mixer version 1

        assert reusable_mix_path(tmp_path, "mix.wav", []) is None
        assert marker.read_text(encoding="utf-8") == MIX_CACHE_VERSION
        assert mix_cache_epoch(tmp_path) == marker.stat().st_mtime

    def test_an_unwritable_output_folder_never_reuses(self, tmp_path):
        _write_wav(tmp_path / "mix.wav")
        (tmp_path / MIX_CACHE_MARKER).mkdir()  # cannot be read or written as a file
        assert mix_cache_epoch(tmp_path) == float("inf")
        assert reusable_mix_path(tmp_path, "mix.wav", []) is None

    def test_mix_version_falls_back_to_now_for_missing_files(self, tmp_path):
        before = int(time.time() * 1000)
        assert mix_version(str(tmp_path / "missing.wav")) >= before
