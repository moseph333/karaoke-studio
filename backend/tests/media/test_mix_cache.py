"""Mix render reuse: POST /api/project/{id}/mix serves an existing render when this mixer
version made it and it is still newer than its source stems, and always returns a
cache-busting versioned master URL.

Eviction: after each /mix, and for every song in a background thread at startup, the song
keeps its MIX_CACHE_PER_SONG most recently used mixes (a reuse counts as a use), mixes that
can never be served again go at once, and no song's current master or mix used in the last
minute is ever deleted."""

import importlib
import os
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config, master_audio
from backend.main import projects
from backend.master_audio import master_fields, prune_mix_cache, prune_mixes_of_every_song
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


def _aged_mix(pid: str, semitones: int, pct: int, seconds_ago: float) -> Path:
    """A cached mix and its .m4a copy, both last used ``seconds_ago``. Never read one before
    a prune: with relatime the read would mark it as just used."""
    wav = _write_wav(main_mod.OUTPUT_DIR / f"{pid}_mix_{semitones}_{pct}.wav", seconds=0.1)
    preview = wav.with_suffix(".m4a")
    preview.write_bytes(b"fake aac")
    _age(wav, seconds_ago)
    _age(preview, seconds_ago)
    return wav


def _mixes_left(pid: str) -> list[str]:
    return sorted(p.name for p in main_mod.OUTPUT_DIR.iterdir() if p.name.startswith(f"{pid}_"))


def _prune(proj: dict, keep: str | None = None) -> list[str]:
    return sorted(
        prune_mix_cache(
            main_mod.OUTPUT_DIR,
            proj["track_id"],
            proj["instrumental_path"],
            proj["vocals_path"],
            keep=keep,
        )
    )


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
    # The stale guide blend was already deleted by the prune after the 0_0 mix
    assert not (main_mod.OUTPUT_DIR / f"{pid}_mix_0_30.wav").exists()
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


# ==============================================================================
# Eviction
# ==============================================================================


def test_only_the_most_recently_used_mixes_are_kept(client, mix_project, mixer_calls, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 2)
    pid = mix_project["id"]
    for semitones, seconds_ago in ((1, 300), (2, 200), (3, 100)):
        _aged_mix(pid, semitones, 0, seconds_ago)

    _mix(client, pid, 4, 0.0)

    assert len(mixer_calls) == 1
    assert _mixes_left(pid) == [
        f"{pid}_mix_3_0.m4a",
        f"{pid}_mix_3_0.wav",
        f"{pid}_mix_4_0.wav",
    ]


def test_a_reused_mix_counts_as_recently_used(client, mix_project, mixer_calls, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 2)
    pid = mix_project["id"]
    for semitones, seconds_ago in ((1, 300), (2, 200), (3, 100)):
        _aged_mix(pid, semitones, 0, seconds_ago)

    _mix(client, pid, 1, 0.0)  # the oldest render, reused
    _mix(client, pid, 4, 0.0)  # a new key

    assert [c[0] for c in mixer_calls] == [4]
    assert _mixes_left(pid) == [f"{pid}_mix_1_0.m4a", f"{pid}_mix_1_0.wav", f"{pid}_mix_4_0.wav"]


def test_reusing_a_mix_keeps_its_url_and_marks_it_used(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    pid = mix_project["id"]
    reused = _aged_mix(pid, 1, 0, 300)
    newer = _aged_mix(pid, 2, 0, 200)
    before = reused.stat()
    url = master_fields(str(reused))["master_audio_url"]

    sources = [mix_project["instrumental_path"]]
    assert reusable_mix_path(main_mod.OUTPUT_DIR, reused.name, sources) == str(reused)

    after = reused.stat()
    assert after.st_mtime_ns == before.st_mtime_ns
    assert after.st_atime > before.st_atime + 200
    assert master_fields(str(reused))["master_audio_url"] == url
    # Neither the master nor used in the last minute: only the order of use keeps it
    monkeypatch.setattr(master_audio, "_IN_USE_SEC", 0)
    assert _prune(mix_project) == [newer.name]
    assert _mixes_left(pid) == [f"{pid}_mix_1_0.m4a", reused.name]


def test_another_songs_master_with_the_same_track_is_kept(
    client, mix_project, mixer_calls, monkeypatch
):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 2)
    pid = mix_project["id"]
    oldest = _aged_mix(pid, 1, 0, 300)
    _aged_mix(pid, 2, 0, 200)
    _aged_mix(pid, 3, 0, 100)
    projects["mixcache02"] = {
        "id": "mixcache02",
        "track_id": pid,
        "status": "ready",
        "master_audio_path": str(oldest),
    }

    _mix(client, pid, 4, 0.0)

    assert _mixes_left(pid) == [
        f"{pid}_mix_1_0.m4a",
        f"{pid}_mix_1_0.wav",
        f"{pid}_mix_3_0.m4a",
        f"{pid}_mix_3_0.wav",
        f"{pid}_mix_4_0.wav",
    ]


def test_a_master_stored_under_another_folder_spelling_is_kept(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    pid = mix_project["id"]
    master = _aged_mix(pid, 1, 0, 300)
    _aged_mix(pid, 2, 0, 200)
    newest = _aged_mix(pid, 3, 0, 100)
    # A relative KARAOKE_DATA_DIR, or one that has moved since the mix was made
    mix_project["master_audio_path"] = f"workspace_data/output/{master.name}"

    assert _prune(mix_project) == [f"{pid}_mix_2_0.wav"]
    assert master.exists() and newest.exists()


def test_mixes_that_can_never_be_reused_go_even_under_the_limit(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 6)
    pid = mix_project["id"]
    _aged_mix(pid, 1, 0, 900)  # older than the stems (600 s)
    _aged_mix(pid, 2, 0, 2 * 3600)  # older than this mixer version (an hour)
    _aged_mix(pid, 3, 0, 300)

    assert _prune(mix_project) == [f"{pid}_mix_1_0.wav", f"{pid}_mix_2_0.wav"]
    assert _mixes_left(pid) == [f"{pid}_mix_3_0.m4a", f"{pid}_mix_3_0.wav"]


@pytest.mark.parametrize("marker_text", [None, "1"], ids=["no marker", "older mixer's marker"])
def test_pruning_only_reads_the_mixer_version_marker(mix_project, monkeypatch, marker_text):
    """A prune never writes the marker: one written now would date every mix it keeps as
    older than the mixer, so the next /mix would make them again."""
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 6)
    pid = mix_project["id"]
    marker = main_mod.OUTPUT_DIR / MIX_CACHE_MARKER
    if marker_text is None:
        marker.unlink()
    else:
        marker.write_text(marker_text, encoding="utf-8")
    # Newer than the stems and used five minutes ago: only a fresh marker would make it stale
    kept = _aged_mix(pid, 1, 0, 300)

    assert mix_cache_epoch(main_mod.OUTPUT_DIR, create=False) == float("-inf")
    assert _prune(mix_project) == []

    assert _mixes_left(pid) == [f"{pid}_mix_1_0.m4a", kept.name]
    if marker_text is None:
        assert not marker.exists()
    else:
        assert marker.read_text(encoding="utf-8") == marker_text


def test_newer_vocals_make_only_guide_mixes_stale(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 6)
    pid = mix_project["id"]
    _aged_mix(pid, 0, 0, 300)
    _aged_mix(pid, 0, 30, 300)
    _age(Path(mix_project["vocals_path"]), 100)  # re-separated after both mixes

    assert _prune(mix_project) == [f"{pid}_mix_0_30.wav"]
    assert _mixes_left(pid) == [f"{pid}_mix_0_0.m4a", f"{pid}_mix_0_0.wav"]


def test_files_in_use_or_not_cached_mixes_are_never_removed(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    pid = mix_project["id"]
    out = main_mod.OUTPUT_DIR
    # Each would be stale (older than the instrumental) if it were a cached mix of this song
    others = [
        out / f"{pid}_mix_0_0.tmp_1a2b3c4d.wav",  # a mix still being written
        out / f"{pid}_master.wav",  # the intake's first master
        out / f"{pid}2_mix_0_0.wav",  # another song whose id starts the same
        out / "othersong_mix_0_0.wav",
    ]
    for path in others:
        _write_wav(path, seconds=0.1)
        _age(path, 900)
    # Made half a minute ago, from stems re-made since: stale, but maybe still being served
    just_made = _write_wav(out / f"{pid}_mix_5_0.wav", seconds=0.1)
    _age(just_made, 30)
    _age(Path(mix_project["instrumental_path"]), 10)

    assert _prune(mix_project) == []
    assert all(path.exists() for path in [*others, just_made])


def test_a_limit_of_zero_keeps_every_mix(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 0)
    pid = mix_project["id"]
    stale = _aged_mix(pid, 1, 0, 900)
    for semitones in range(2, 10):
        _aged_mix(pid, semitones, 0, 300)

    assert _prune(mix_project) == []
    assert stale.exists()
    assert len(_mixes_left(pid)) == 18


def test_nothing_to_prune_without_an_output_folder(tmp_path):
    assert prune_mix_cache(MagicMock(), "song", None, None) == []
    assert prune_mix_cache(tmp_path / "missing", "song", None, None) == []


def test_a_failing_prune_never_fails_the_mix(client, mix_project, mixer_calls, monkeypatch, caplog):
    def broken():
        raise RuntimeError("store unreadable")

    monkeypatch.setattr(master_audio, "_current_masters", broken)
    pid = mix_project["id"]
    _aged_mix(pid, 1, 0, 900)

    url = _mix(client, pid, 2, 0.0)

    assert url.startswith(f"/static/output/{pid}_mix_2_0.wav?v=")
    assert projects[pid]["master_audio_url"] == url
    assert "Could not prune the cached mixes of mixcache01: store unreadable" in caplog.text
    assert (main_mod.OUTPUT_DIR / f"{pid}_mix_1_0.wav").exists()


def _second_song(track_id: str = "yt02") -> dict:
    """Another finished song, stored under its id and its track id, separated a while ago."""
    stems = main_mod.STEMS_DIR / track_id
    inst = _write_wav(stems / "no_vocals.wav")
    vocals = _write_wav(stems / "vocals.wav", freq=880.0)
    _age(inst, 600)
    _age(vocals, 600)
    proj = {
        "id": "upload02",
        "track_id": track_id,
        "status": "ready",
        "instrumental_path": str(inst),
        "vocals_path": str(vocals),
    }
    projects["upload02"] = projects[track_id] = proj
    return proj


def test_pruning_every_song_trims_each_track_once(mix_project, monkeypatch, caplog):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 1)
    pid = mix_project["id"]
    _second_song()
    for track_id in (pid, "yt02"):
        _aged_mix(track_id, 1, 30, 300)
        _aged_mix(track_id, 2, 30, 200)
    # Entries that are not songs, or songs without any id
    projects["_schema"] = 1  # type: ignore[assignment]
    projects["nameless"] = {"status": "error"}
    pruned: list[str] = []
    real = master_audio.prune_mix_cache

    def spy(output_dir, track_id, *args, **kwargs):
        pruned.append(track_id)
        return real(output_dir, track_id, *args, **kwargs)

    monkeypatch.setattr(master_audio, "prune_mix_cache", spy)

    assert prune_mixes_of_every_song(main_mod.OUTPUT_DIR) == 2

    assert sorted(pruned) == [pid, "yt02"]
    assert _mixes_left(pid) == [f"{pid}_mix_2_30.m4a", f"{pid}_mix_2_30.wav"]
    assert _mixes_left("yt02") == ["yt02_mix_2_30.m4a", "yt02_mix_2_30.wav"]
    assert "Removed 2 cached mix(es) of 2 song(s) at startup" in caplog.text


@pytest.mark.parametrize("custom_song_first", [False, True], ids=["stored last", "stored first"])
def test_songs_sharing_a_track_but_not_its_stems_keep_mixes_their_stems_disagree_on(
    mix_project, custom_song_first
):
    pid = mix_project["id"]
    # A second song of the same track, given its own backing track after these mixes were made
    own = _write_wav(main_mod.STEMS_DIR / "mixcache02" / "custom_inst.wav")
    _age(own, 100)
    projects["mixcache02"] = {
        "id": "mixcache02",
        "track_id": pid,
        "status": "ready",
        "instrumental_path": str(own),
        "vocals_path": mix_project["vocals_path"],
    }
    if custom_song_first:
        projects[pid] = projects.pop(pid)
    shared = _aged_mix(pid, 1, 0, 300)  # newer than one song's stems, older than the other's
    _aged_mix(pid, 2, 0, 2 * 3600)  # older than this mixer version: stale for both

    assert prune_mixes_of_every_song(main_mod.OUTPUT_DIR) == 1

    assert _mixes_left(pid) == [f"{pid}_mix_1_0.m4a", shared.name]


def test_a_failing_prune_of_every_song_is_logged_and_never_raises(monkeypatch, caplog):
    class _Unreadable(dict):
        def values(self):
            raise RuntimeError("store unreadable")

    monkeypatch.setattr(main_mod, "projects", _Unreadable())

    assert prune_mixes_of_every_song(main_mod.OUTPUT_DIR) == 0
    assert "Could not prune the cached mixes of every song: store unreadable" in caplog.text


def test_startup_prunes_every_songs_mixes_on_a_background_thread(mix_project, monkeypatch):
    monkeypatch.setattr(config, "MIX_CACHE_PER_SONG", 2)
    pid = mix_project["id"]
    for semitones, seconds_ago in ((1, 400), (2, 300), (3, 200)):
        _aged_mix(pid, semitones, 0, seconds_ago)
    started: list[threading.Thread] = []
    real = master_audio.start_pruning_mixes_of_every_song

    def start_and_keep() -> threading.Thread:
        started.append(real())
        return started[-1]

    monkeypatch.setattr(main_mod, "start_pruning_mixes_of_every_song", start_and_keep)

    with TestClient(main_mod.app):
        pass
    [thread] = started
    thread.join(timeout=30)

    assert thread.daemon
    assert not thread.is_alive()
    assert _mixes_left(pid) == [
        f"{pid}_mix_2_0.m4a",
        f"{pid}_mix_2_0.wav",
        f"{pid}_mix_3_0.m4a",
        f"{pid}_mix_3_0.wav",
    ]


def test_startup_serves_requests_while_the_mix_prune_is_still_running(monkeypatch):
    release = threading.Event()
    entered = threading.Event()

    def slow_prune(output_dir) -> int:
        entered.set()
        release.wait(timeout=30)
        return 0

    monkeypatch.setattr(master_audio, "prune_mixes_of_every_song", slow_prune)
    started: list[threading.Thread] = []
    real = master_audio.start_pruning_mixes_of_every_song

    def start_and_keep() -> threading.Thread:
        started.append(real())
        return started[-1]

    monkeypatch.setattr(main_mod, "start_pruning_mixes_of_every_song", start_and_keep)

    try:
        with TestClient(main_mod.app) as client:
            assert entered.wait(timeout=10)
            assert client.get("/api/health").status_code == 200
            [thread] = started
            assert thread.is_alive()
    finally:
        release.set()
    thread.join(timeout=10)
    assert not thread.is_alive()


@pytest.mark.parametrize(
    ("raw", "expected"), [("abc", 6), ("0", 0), ("-1", 0), (" 10 ", 10), ("", 6)]
)
def test_mix_cache_size_setting(monkeypatch, raw, expected):
    monkeypatch.setenv("MIX_CACHE_PER_SONG", raw)
    try:
        size = importlib.reload(config).MIX_CACHE_PER_SONG
        assert size == expected
    finally:
        monkeypatch.delenv("MIX_CACHE_PER_SONG")
        importlib.reload(config)
