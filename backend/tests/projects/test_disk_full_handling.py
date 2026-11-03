"""A full disk fails loudly: edits the studio reports as saved answer 507 and are rolled back in
memory when projects.json cannot be written, a delete retries its save once the song's media is
gone, background and progress saves stay soft, and new songs, uploads, renders and
re-separations are refused while the data disk is below DISK_MIN_FREE_MB."""

import errno
import json
import os
import threading
from collections import namedtuple

import pytest
from fastapi import HTTPException

import backend.main as main_mod
from backend import config, master_audio, project_store
from backend.pipeline import _progress_updater
from backend.project_store import (
    SAVE_ERROR_DETAIL,
    SAVE_FAILED_DETAIL,
    ensure_free_space,
    load_projects,
    merge_disk_projects,
    restore_on_failed_save,
    save_projects,
    save_projects_throttled,
)
from backend.routers import projects as projects_router
from backend.routers import quality as quality_router

WAV = b"RIFF" + (36).to_bytes(4, "little") + b"WAVEfmt " + bytes(64)
PNG = b"\x89PNG\r\n\x1a\n" + bytes(64)
MB = 1024 * 1024
DiskUsage = namedtuple("DiskUsage", "total used free")
# The real fsync, kept before any test fakes it: os.fsync itself is what the fakes replace
REAL_FSYNC = os.fsync

OLD_LINES = [{"id": 1, "text": "old words", "start_time": 1.0, "end_time": 2.0}]
OLD_KIT = {"title": "Old kit"}


def _disk() -> dict:
    return json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))


def _temp_files() -> list[str]:
    return [p.name for p in main_mod.DATA_DIR.iterdir() if p.name.startswith(".projects.json")]


def _fail_first_fsyncs(monkeypatch, failures: int) -> list[int]:
    """The first writes to projects.json fail as on a full disk, later ones go through."""
    calls: list[int] = []

    def fsync(fd):
        calls.append(fd)
        if len(calls) <= failures:
            raise OSError(errno.ENOSPC, "No space left on device")
        REAL_FSYNC(fd)

    monkeypatch.setattr(project_store.os, "fsync", fsync)
    return calls


@pytest.fixture
def disk_full(monkeypatch):
    """Every write to projects.json fails as on a full disk (fsync raises ENOSPC)."""

    def no_space(_fd):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(project_store.os, "fsync", no_space)


@pytest.fixture
def low_disk(monkeypatch):
    """The free-space guard is on at its default and the data disk has 100 MB free."""
    calls: list[object] = []

    def disk_usage(path):
        calls.append(path)
        return DiskUsage(40_000 * MB, 39_900 * MB, 100 * MB)

    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 1024)
    monkeypatch.setattr(project_store.shutil, "disk_usage", disk_usage)
    return calls


@pytest.fixture
def song():
    """A finished song with an original track, an instrumental and a YouTube kit, on disk."""
    pid = "full_song"
    stem_dir = main_mod.STEMS_DIR / pid
    stem_dir.mkdir(parents=True, exist_ok=True)
    inst = stem_dir / "instrumental.wav"
    inst.write_bytes(WAV)
    audio = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
    audio.write_bytes(WAV)
    main_mod.projects[pid] = {
        "id": pid,
        "track_id": pid,
        "title": "Old Title",
        "artist": "Old Artist",
        "status": "ready",
        "duration": 10.0,
        "lines": [dict(line) for line in OLD_LINES],
        "chords": [{"start": 0.0, "end": 1.0, "chord": "C"}],
        "semitones": 0,
        "guide_volume": 0.0,
        "audio_path": str(audio),
        "instrumental_path": str(inst),
        "instrumental_url": f"/static/stems/{pid}/instrumental.wav",
        "youtube_package": dict(OLD_KIT),
    }
    save_projects()
    return pid


# --- Saving -------------------------------------------------------------------------------


def test_a_save_reports_whether_it_was_written(monkeypatch):
    main_mod.projects["kept"] = {"id": "kept", "title": "Before"}
    assert save_projects() is True
    before = main_mod.PROJECTS_STORE_FILE.read_bytes()

    main_mod.projects["kept"]["title"] = "After"
    _fail_first_fsyncs(monkeypatch, failures=1)

    assert save_projects() is False
    assert main_mod.PROJECTS_STORE_FILE.read_bytes() == before
    assert _temp_files() == []


def test_a_strict_save_on_a_full_disk_answers_507(disk_full):
    main_mod.projects["strict"] = {"id": "strict"}

    with pytest.raises(HTTPException) as caught:
        save_projects(strict=True)

    assert caught.value.status_code == 507
    assert caught.value.detail == SAVE_FAILED_DETAIL
    assert _temp_files() == []


def test_a_save_that_fails_for_another_reason_answers_500_not_507():
    main_mod.projects["odd"] = {"id": "odd", "tags": {"a set json cannot write"}}

    with pytest.raises(HTTPException) as caught:
        save_projects(strict=True)
    assert caught.value.status_code == 500
    assert caught.value.detail == SAVE_ERROR_DETAIL

    assert save_projects() is False


def test_progress_saves_stay_soft_on_a_full_disk(disk_full):
    main_mod.projects["busy"] = {"id": "busy", "status": "downloading", "progress": 5}
    update = _progress_updater("busy", threading.Event(), 0.0)

    update("separating", 40, "Splitting the stems")  # a status change: saved at once
    update("separating", 45, "Splitting the stems")  # progress only: throttled
    save_projects_throttled()

    assert main_mod.projects["busy"]["status"] == "separating"
    assert main_mod.projects["busy"]["progress"] == 45


def test_a_failed_write_holds_back_the_next_progress_save(disk_full, monkeypatch):
    main_mod.projects["tick"] = {"id": "tick", "progress": 10}
    assert project_store._last_save_at == 0.0
    assert save_projects() is False
    assert project_store._last_save_at > 0.0

    monkeypatch.setattr(project_store.os, "fsync", REAL_FSYNC)
    main_mod.projects["tick"]["progress"] = 20
    save_projects_throttled()

    assert not main_mod.PROJECTS_STORE_FILE.exists()  # skipped: within the interval


def test_restore_on_failed_save_puts_fields_back_and_drops_new_ones():
    proj = {"title": "Old", "lines": [1]}

    with pytest.raises(RuntimeError), restore_on_failed_save(proj, ("title", "lines", "new")):
        proj["title"] = "New"
        proj["lines"] = [2]
        proj["new"] = "added"
        raise RuntimeError("save failed")

    assert proj == {"title": "Old", "lines": [1]}

    with restore_on_failed_save(proj, ("title",)):
        proj["title"] = "Kept"
    assert proj["title"] == "Kept"


# --- Edits --------------------------------------------------------------------------------


def test_a_lyrics_save_on_a_full_disk_answers_507_and_keeps_the_old_lines(client, song, disk_full):
    new_lines = [{"id": 1, "text": "new words", "start_time": 1.0, "end_time": 20.0}]

    res = client.post(f"/api/project/{song}/lyrics", json={"lines": new_lines})

    assert res.status_code == 507
    assert res.json()["detail"] == SAVE_FAILED_DETAIL
    shown = client.get(f"/api/project/{song}").json()
    assert shown["lines"] == OLD_LINES
    assert shown["duration"] == 10.0
    assert shown["youtube_package"] == OLD_KIT
    assert _disk()[song]["lines"] == OLD_LINES


def _fake_mix(*, output_filename, **_kwargs):
    out = main_mod.OUTPUT_DIR / output_filename
    out.write_bytes(WAV + bytes(4096))
    return str(out)


EDITS = {
    "metadata": ("post", "metadata", {"title": "New Title", "artist": "New Artist"}),
    "patch": ("patch", "", {"title": "New Title"}),
    "chords": ("post", "chords", {"chords": [{"start": 0.0, "end": 2.0, "chord": "Am"}]}),
    "mix": ("post", "mix", {"semitones": 3, "guide_volume": 0.4}),
}
EDITED_FIELDS = (
    "title",
    "artist",
    "youtube_package",
    "chords",
    "semitones",
    "guide_volume",
    "master_audio_path",
    "master_audio_url",
)


@pytest.mark.parametrize("edit", list(EDITS))
def test_an_edit_on_a_full_disk_answers_507_and_shows_the_old_values(
    client, monkeypatch, song, disk_full, edit
):
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", _fake_mix)
    monkeypatch.setattr(master_audio, "preview_for", lambda _path: None)
    before = {field: main_mod.projects[song].get(field) for field in EDITED_FIELDS}
    method, route, body = EDITS[edit]
    url = f"/api/project/{song}/{route}".rstrip("/")

    res = client.request(method.upper(), url, json=body)

    assert res.status_code == 507, res.text
    shown = client.get(f"/api/project/{song}").json()
    assert {field: shown.get(field) for field in EDITED_FIELDS} == before
    # Fields the edit would have added are gone again, not left as None
    assert "master_audio_url" not in main_mod.projects[song]


def test_an_instrumental_upload_on_a_full_disk_answers_507_and_keeps_the_old_track(
    client, song, disk_full
):
    before = (
        main_mod.projects[song]["instrumental_path"],
        main_mod.projects[song]["instrumental_url"],
    )

    res = client.post(
        "/api/upload-instrumental",
        data={"project_id": song},
        files={"file": ("backing.wav", WAV, "audio/wav")},
    )

    assert res.status_code == 507
    assert res.json()["detail"] == SAVE_FAILED_DETAIL
    stored = main_mod.projects[song]
    assert (stored["instrumental_path"], stored["instrumental_url"]) == before
    assert _disk()[song]["instrumental_url"] == before[1]
    # The upload left no file behind on a disk that is already full
    assert sorted(p.name for p in (main_mod.STEMS_DIR / song).iterdir()) == ["instrumental.wav"]


def test_a_failed_save_puts_back_the_backing_track_an_earlier_upload_made(
    client, monkeypatch, song
):
    first, second = WAV + b"first", WAV + b"second"

    def upload(data: bytes):
        return client.post(
            "/api/upload-instrumental",
            data={"project_id": song},
            files={"file": ("backing.wav", data, "audio/wav")},
        )

    assert upload(first).status_code == 200
    custom = main_mod.STEMS_DIR / song / "custom_inst.wav"
    assert main_mod.projects[song]["instrumental_path"] == str(custom)

    def no_space(_fd):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(project_store.os, "fsync", no_space)
    res = upload(second)

    assert res.status_code == 507
    assert res.json()["detail"] == SAVE_FAILED_DETAIL
    # Same path before and after, so the file itself must be the first upload again
    assert main_mod.projects[song]["instrumental_path"] == str(custom)
    assert custom.read_bytes() == first
    assert sorted(p.name for p in custom.parent.iterdir()) == [
        "custom_inst.wav",
        "instrumental.wav",
    ]

    # Once the disk takes writes again, a new upload replaces it and leaves no copy behind
    monkeypatch.setattr(project_store.os, "fsync", REAL_FSYNC)
    assert upload(second).status_code == 200
    assert custom.read_bytes() == second
    assert sorted(p.name for p in custom.parent.iterdir()) == [
        "custom_inst.wav",
        "instrumental.wav",
    ]


# --- Delete -------------------------------------------------------------------------------


def test_a_delete_retries_its_save_after_the_media_is_gone(client, monkeypatch, song):
    calls = _fail_first_fsyncs(monkeypatch, failures=1)

    res = client.delete(f"/api/project/{song}")

    assert res.status_code == 200, res.text
    assert len(calls) == 2
    assert song not in main_mod.projects
    assert song not in load_projects()
    assert not (main_mod.STEMS_DIR / song).exists()


def test_a_delete_whose_retry_also_fails_answers_507(client, song, disk_full):
    res = client.delete(f"/api/project/{song}")

    assert res.status_code == 507
    # Not the edit message: the song's files are already gone
    assert res.json()["detail"] == projects_router.DELETE_SAVE_FAILED_DETAIL
    assert not (main_mod.STEMS_DIR / song).exists()


def test_a_reload_during_the_cleanup_does_not_bring_the_deleted_song_back(
    client, monkeypatch, song
):
    _fail_first_fsyncs(monkeypatch, failures=1)
    real_cleanup = projects_router.cleanup_project_disk_artifacts
    reloaded: list[bool] = []

    def cleanup_after_a_reload(*args, **kwargs):
        # What a project list or a lookup miss does while the delete removes the files
        merge_disk_projects(main_mod.projects)
        reloaded.append(song in main_mod.projects)
        return real_cleanup(*args, **kwargs)

    monkeypatch.setattr(projects_router, "cleanup_project_disk_artifacts", cleanup_after_a_reload)

    res = client.delete(f"/api/project/{song}")

    assert res.status_code == 200, res.text
    assert reloaded == [True]  # the failed first save left the song on disk
    assert song not in main_mod.projects
    assert song not in load_projects()


# --- Free-space guard ---------------------------------------------------------------------


def _assert_low_disk_detail(res):
    assert res.status_code == 507, res.text
    assert "100 MB free, 1024 MB required" in res.json()["detail"]


def test_a_new_song_is_refused_on_a_low_disk(client, monkeypatch, low_disk):
    started: list[tuple] = []
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *args: started.append(args))

    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    _assert_low_disk_detail(res)
    assert main_mod.projects == {}
    assert "dQw4w9WgXcQ" not in main_mod.active_cancellations
    assert started == []


def test_a_song_already_ready_is_still_opened_on_a_low_disk(client, low_disk):
    main_mod.projects["dQw4w9WgXcQ"] = {
        "id": "dQw4w9WgXcQ",
        "track_id": "dQw4w9WgXcQ",
        "status": "ready",
    }

    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    assert res.status_code == 200, res.text
    assert res.json() == {"project_id": "dQw4w9WgXcQ", "status": "ready"}


def test_a_track_upload_is_refused_on_a_low_disk(client, monkeypatch, low_disk):
    started: list[tuple] = []
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args: started.append(args))

    res = client.post("/api/upload-track", files={"file": ("song.wav", WAV, "audio/wav")})

    _assert_low_disk_detail(res)
    assert main_mod.projects == {}
    assert list(main_mod.DOWNLOADS_DIR.iterdir()) == []
    assert started == []


def test_an_instrumental_upload_is_refused_on_a_low_disk(client, song, low_disk):
    before = dict(main_mod.projects[song])

    res = client.post(
        "/api/upload-instrumental",
        data={"project_id": song},
        files={"file": ("backing.wav", WAV, "audio/wav")},
    )

    _assert_low_disk_detail(res)
    assert main_mod.projects[song] == before
    assert sorted(p.name for p in (main_mod.STEMS_DIR / song).iterdir()) == ["instrumental.wav"]


def test_a_background_upload_is_refused_on_a_low_disk(client, low_disk):
    res = client.post("/api/upload-background", files={"file": ("bg.png", PNG, "image/png")})

    _assert_low_disk_detail(res)
    assert list(main_mod.BACKGROUNDS_DIR.iterdir()) == []


def test_a_render_is_refused_on_a_low_disk_without_blocking_the_next_one(
    client, monkeypatch, song, low_disk
):
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)

    res = client.post(f"/api/project/{song}/render", json={})

    _assert_low_disk_detail(res)
    assert "render_status" not in main_mod.projects[song]
    assert f"{song}_render" not in main_mod.active_cancellations

    # Once there is room again the render starts: the refusal left no event behind
    monkeypatch.setattr(
        project_store.shutil, "disk_usage", lambda _path: DiskUsage(40_000 * MB, 0, 5_000 * MB)
    )
    again = client.post(f"/api/project/{song}/render", json={})
    assert again.status_code == 200, again.text
    assert main_mod.projects[song]["render_status"] == "queued"


def test_a_reseparation_is_refused_on_a_low_disk(client, monkeypatch, song, low_disk):
    started: list[tuple] = []
    monkeypatch.setattr(quality_router, "run_job", lambda *args: started.append(args))

    res = client.post(f"/api/project/{song}/reseparate", json={"quality": "fast"})

    _assert_low_disk_detail(res)
    assert started == []
    assert "separation_job" not in main_mod.projects[song]
    assert f"{song}_reseparate" not in main_mod.active_cancellations
    assert "separation_job" not in _disk()[song]


def test_reseparation_still_answers_404_and_409_first_on_a_low_disk(client, song, low_disk):
    assert client.post("/api/project/nope/reseparate", json={"quality": "fast"}).status_code == 404

    main_mod.projects[song]["render_status"] = "rendering"
    res = client.post(f"/api/project/{song}/reseparate", json={"quality": "fast"})
    assert res.status_code == 409


def test_a_render_still_answers_409_while_one_runs_on_a_low_disk(
    client, monkeypatch, song, low_disk
):
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)
    running = threading.Event()
    main_mod.active_cancellations[f"{song}_render"] = running

    res = client.post(f"/api/project/{song}/render", json={})

    assert res.status_code == 409, res.text
    assert main_mod.active_cancellations[f"{song}_render"] is running
    assert low_disk == []  # refused before the guard looked at the disk


def test_a_render_still_answers_400_without_an_instrumental_on_a_low_disk(
    client, monkeypatch, song, low_disk
):
    monkeypatch.setattr(main_mod, "run_video_render", lambda *_args: None)
    os.remove(main_mod.projects[song]["instrumental_path"])

    res = client.post(f"/api/project/{song}/render", json={})

    assert res.status_code == 400, res.text
    assert f"{song}_render" not in main_mod.active_cancellations
    assert low_disk == []


def test_a_song_already_running_still_answers_with_its_status_on_a_low_disk(
    client, monkeypatch, low_disk
):
    started: list[tuple] = []
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *args: started.append(args))
    main_mod.projects["dQw4w9WgXcQ"] = {
        "id": "dQw4w9WgXcQ",
        "track_id": "dQw4w9WgXcQ",
        "status": "separating",
    }
    main_mod.active_cancellations["dQw4w9WgXcQ"] = threading.Event()

    res = client.post("/api/process", json={"url_or_id": "dQw4w9WgXcQ"})

    assert res.status_code == 200, res.text
    assert res.json() == {"project_id": "dQw4w9WgXcQ", "status": "separating"}
    assert started == []
    assert low_disk == []


@pytest.mark.parametrize(
    ("project_id", "status", "expected"),
    [("nope", "ready", 404), ("full_song", "separating", 409)],
)
def test_an_instrumental_upload_still_answers_404_and_409_first_on_a_low_disk(
    client, song, low_disk, project_id, status, expected
):
    main_mod.projects[song]["status"] = status

    res = client.post(
        "/api/upload-instrumental",
        data={"project_id": project_id},
        files={"file": ("backing.wav", WAV, "audio/wav")},
    )

    assert res.status_code == expected, res.text
    assert low_disk == []
    assert sorted(p.name for p in (main_mod.STEMS_DIR / song).iterdir()) == ["instrumental.wav"]


def test_the_guard_is_off_at_zero_and_never_reads_the_disk(monkeypatch, low_disk):
    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 0)

    ensure_free_space()

    assert low_disk == []


def test_the_guard_passes_with_room_to_spare_and_reads_the_data_folder(monkeypatch):
    seen: list[object] = []

    def disk_usage(path):
        seen.append(path)
        return DiskUsage(40_000 * MB, 0, 1025 * MB)

    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 1024)
    monkeypatch.setattr(project_store.shutil, "disk_usage", disk_usage)

    ensure_free_space()

    assert seen == [main_mod.DATA_DIR]


def test_the_guard_lets_requests_through_when_the_free_space_cannot_be_read(monkeypatch):
    def unreadable(_path):
        raise OSError(errno.EIO, "Input/output error")

    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 1024)
    monkeypatch.setattr(project_store.shutil, "disk_usage", unreadable)

    ensure_free_space()


def test_the_guard_keeps_one_gigabyte_free_by_default_and_reads_its_setting():
    # The parsing alone: reloading config would also read a developer's repo-root .env
    assert config._min_free_mb(None) == 1024
    assert config._min_free_mb("") == 1024
    assert config._min_free_mb(" 4096 ") == 4096
    assert config._min_free_mb("0") == 0
    assert config._min_free_mb("-5") == 0
    assert config._min_free_mb("plenty") == 1024


def test_the_guard_reads_the_real_disk_of_the_data_folder(monkeypatch):
    # Unfaked: the test's data folder has far more than 1 MB free, and far less than 10 PB
    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 1)
    ensure_free_space()

    monkeypatch.setattr(config, "DISK_MIN_FREE_MB", 10_000_000_000)
    with pytest.raises(HTTPException) as caught:
        ensure_free_space()
    assert caught.value.status_code == 507
