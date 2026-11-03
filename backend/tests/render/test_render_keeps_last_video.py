"""A render that fails or is cancelled keeps the song's last good video. FFmpeg writes
`<name>.part.mp4` next to the video, which replaces it only when the render has finished and is
removed otherwise; a server restart's leftovers are removed at startup, and deleting a song
removes both formats' videos and any leftover."""

import subprocess
import threading
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.main import projects
from backend.render_worker import remove_render_leftovers
from backend.services.video_renderer import VideoRenderer

PREVIOUS_VIDEO = b"MP4 of the last good render"
NEW_VIDEO = b"MP4 of the new render"


class _FakeFFmpeg:
    """Stands in for FFmpeg: writes `written` to its output file (the last argument) and exits
    with returncode after printing `lines` of progress."""

    def __init__(self, cmd, written: bytes, returncode: int, lines: list[str]):
        self.cmd = list(cmd)
        Path(cmd[-1]).write_bytes(written)
        self.stdout = list(lines)
        self.stderr = ["Error: Encoding failed\n"] if returncode else []
        self.returncode = returncode

    def poll(self):
        return self.returncode

    def terminate(self):
        pass

    def kill(self):
        pass

    def wait(self, timeout=None):
        return self.returncode


@pytest.fixture
def ffmpeg(monkeypatch):
    """Records each FFmpeg launch; set .written, .returncode and .lines to shape the next one."""
    launches: list[list[str]] = []
    behaviour = {"written": NEW_VIDEO, "returncode": 0, "lines": ["progress=end\n"]}

    def popen(cmd, *args, **kwargs):
        process = _FakeFFmpeg(cmd, **behaviour)
        launches.append(process.cmd)
        return process

    monkeypatch.setattr(subprocess, "Popen", popen)
    return launches, behaviour


def _render(tmp_path: Path, cancel_event=None) -> str:
    audio = tmp_path / "mix.wav"
    audio.write_bytes(b"RIFF audio")
    ass = tmp_path / "lyrics.ass"
    ass.write_text("[Script Info]\n", encoding="utf-8")
    return VideoRenderer(output_dir=tmp_path).render_video(
        str(audio), str(ass), tmp_path / "out.mp4", duration=1.0, cancel_event=cancel_event
    )


def test_a_failed_render_keeps_the_previous_video_and_leaves_no_part_file(tmp_path, ffmpeg):
    launches, behaviour = ffmpeg
    (tmp_path / "out.mp4").write_bytes(PREVIOUS_VIDEO)
    behaviour.update(written=b"CORRUPTED_PARTIAL_MP4_DATA", returncode=1)

    with pytest.raises(RuntimeError, match="FFmpeg video render error"):
        _render(tmp_path)

    assert len(launches) == 1
    assert (tmp_path / "out.mp4").read_bytes() == PREVIOUS_VIDEO
    assert not (tmp_path / "out.part.mp4").exists()


def test_a_cancelled_render_keeps_the_previous_video_and_leaves_no_part_file(tmp_path, ffmpeg):
    launches, behaviour = ffmpeg
    (tmp_path / "out.mp4").write_bytes(PREVIOUS_VIDEO)
    behaviour.update(written=b"HALF_AN_MP4", lines=["frame=30\n", "progress=continue\n"])
    cancel_event = threading.Event()
    cancel_event.set()

    with pytest.raises(RuntimeError, match="cancelled by user"):
        _render(tmp_path, cancel_event=cancel_event)

    assert len(launches) == 1
    assert (tmp_path / "out.mp4").read_bytes() == PREVIOUS_VIDEO
    assert not (tmp_path / "out.part.mp4").exists()


def test_a_finished_render_replaces_the_video_through_a_part_file(tmp_path, ffmpeg):
    launches, _behaviour = ffmpeg
    (tmp_path / "out.mp4").write_bytes(PREVIOUS_VIDEO)

    out = _render(tmp_path)

    assert out == str(tmp_path / "out.mp4")
    assert launches[0][-1] == str(tmp_path / "out.part.mp4")
    assert (tmp_path / "out.mp4").read_bytes() == NEW_VIDEO
    assert not (tmp_path / "out.part.mp4").exists()


def test_deleting_a_song_removes_both_formats_and_a_leftover_part_file(client):
    projects["gone01"] = {"id": "gone01", "track_id": "gone01", "title": "Gone", "status": "ready"}
    projects["kept01"] = {"id": "kept01", "track_id": "kept01", "title": "Kept", "status": "ready"}
    output = config.OUTPUT_DIR
    doomed = ["gone01_karaoke.mp4", "gone01_karaoke_vertical.mp4", "gone01_karaoke.part.mp4"]
    for name in [*doomed, "kept01_karaoke.mp4", "kept01_karaoke_vertical.mp4"]:
        (output / name).write_bytes(b"mp4")

    res = client.delete("/api/project/gone01")

    assert res.status_code == 200
    assert [name for name in doomed if (output / name).exists()] == []
    assert (output / "kept01_karaoke.mp4").exists()
    assert (output / "kept01_karaoke_vertical.mp4").exists()


def _output_with_leftovers() -> Path:
    output = main_mod.OUTPUT_DIR
    for name in (
        "song1_karaoke.part.mp4",
        "song2_karaoke_vertical.part.mp4",
        "song2_final_audio.wav",
        "song2_final_audio.tmp_1a2b3c4d.wav",
        "song1_karaoke.mp4",
        "song2_karaoke_vertical.mp4",
        "song1_master.wav",
        "song1_mix_2_30.wav",
        "song1.ass",
    ):
        (output / name).write_bytes(b"data")
    return output


def test_removing_render_leftovers_deletes_part_files_and_scratch_mixes():
    output = _output_with_leftovers()

    assert remove_render_leftovers() == 4

    assert sorted(path.name for path in output.iterdir()) == [
        "song1.ass",
        "song1_karaoke.mp4",
        "song1_master.wav",
        "song1_mix_2_30.wav",
        "song2_karaoke_vertical.mp4",
    ]
    assert remove_render_leftovers() == 0


def test_startup_removes_the_part_files_of_renders_a_restart_cut_off():
    output = _output_with_leftovers()

    with TestClient(main_mod.app):
        assert sorted(output.glob("*.part.mp4")) == []
        assert not (output / "song2_final_audio.wav").exists()
        assert not (output / "song2_final_audio.tmp_1a2b3c4d.wav").exists()
        assert (output / "song1_karaoke.mp4").exists()


def test_startup_goes_on_when_the_leftovers_cannot_be_removed(monkeypatch, caplog, auth_headers):
    def broken():
        raise PermissionError("output folder is read-only")

    monkeypatch.setattr(main_mod, "remove_render_leftovers", broken)

    with TestClient(main_mod.app, headers=auth_headers) as started:
        assert started.get("/api/health").status_code == 200

    assert "Could not remove the unfinished videos left by the previous process" in caplog.text
