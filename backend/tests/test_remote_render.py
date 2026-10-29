"""Video export on a cloud CPU (RENDER_REMOTE=modal): what is uploaded, progress, fallbacks.

A stand-in replaces the Modal job runner, so nothing leaves the machine.
"""

import subprocess
import types
from pathlib import Path

import pytest

from backend.services import remote_render
from backend.services import separation_presets as presets
from backend.services import video_renderer as vr
from backend.services.modal_jobs import RemoteOutcome, RemoteUnavailable
from backend.services.video_renderer import VideoRenderer

PROGRESS = ["frame=60\n", "fps=240\n", "speed=4.0x\n", "out_time_us=1000000\n", "progress=end\n"]


class _QuietProcess:
    def __init__(self, cmd):
        self.cmd = list(cmd)
        self.stdout: list[str] = []
        self.stderr: list[str] = []
        self.returncode = 0

    def poll(self):
        return 0

    def terminate(self):
        pass

    def kill(self):
        pass

    def wait(self, timeout=None):
        return 0


@pytest.fixture
def local_ffmpeg(monkeypatch):
    """Records local FFmpeg launches instead of running them."""
    launched: list[list[str]] = []

    def popen(cmd, *args, **kwargs):
        process = _QuietProcess(cmd)
        launched.append(process.cmd)
        return process

    monkeypatch.setattr(subprocess, "Popen", popen)
    return launched


@pytest.fixture
def cloud(monkeypatch):
    """Turns cloud export on and hands render jobs to a stand-in that records them."""
    monkeypatch.setenv("RENDER_REMOTE", "modal")
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")
    state = types.SimpleNamespace(jobs=[], mode="ok", waited=None)

    def run_modal_job(function_name, kwargs, on_line, cancel_event, **limits):
        state.jobs.append({"function": function_name, **kwargs, **limits})
        if state.mode == "unavailable":
            raise RemoteUnavailable(
                "no cloud CPU started the job within 2 minutes (RENDER_REMOTE_QUEUE_SEC)"
            )
        if state.waited is not None:
            limits["on_waiting"](state.waited)
        limits["on_started"]()
        for line in PROGRESS:
            on_line(line)
        if state.mode == "cancelled":
            return RemoteOutcome(None, "cancelled"), None
        if state.mode == "fail":
            return RemoteOutcome(1), {"returncode": 1, "stderr": "Invalid data found"}
        return RemoteOutcome(0), {"returncode": 0, "video": b"MP4 from the cloud", "cpus": 16}

    monkeypatch.setattr(remote_render, "run_modal_job", run_modal_job)
    return state


def _render(tmp_path: Path, **kwargs):
    audio = tmp_path / "mix.wav"
    audio.write_bytes(b"RIFF audio")
    ass = tmp_path / "lyrics.ass"
    ass.write_text("[Script Info]\n", encoding="utf-8")
    reports: list[tuple] = []
    out = VideoRenderer(output_dir=tmp_path).render_video(
        str(audio),
        str(ass),
        tmp_path / "out.mp4",
        duration=1.0,
        progress_callback=lambda *update: reports.append(update),
        **kwargs,
    )
    return Path(out), reports


def test_exports_render_on_the_cloud_cpu_when_configured(tmp_path, cloud, local_ffmpeg):
    out, reports = _render(tmp_path)

    assert out.read_bytes() == b"MP4 from the cloud"
    assert local_ffmpeg == []
    job = cloud.jobs[0]
    assert job["function"] == "render"
    assert sorted(job["files"]) == ["audio.wav", "subtitles.ass"]
    assert job["files"]["audio.wav"] == b"RIFF audio"
    assert job["output"] == "out.mp4"
    assert (job["resource"], job["queue_setting"]) == ("CPU", "RENDER_REMOTE_QUEUE_SEC")
    args = job["args"]
    assert args[-1] == "out.mp4"
    assert "color=c=0x0f111a:s=1920x1080:r=60" in args
    assert "subtitles='subtitles.ass':fontsdir='/fonts'" in args[args.index("-filter_complex") + 1]

    details = [detail for _, detail, _ in reports]
    assert details[:2] == ["Waiting for a cloud CPU…", "Rendering on a cloud CPU…"]
    assert reports[-1] == (
        100.0,
        "Encoding 1080p60 on a cloud CPU: frame 60 (240 fps, 4.0x speed)",
        None,
    )


def test_the_wait_for_a_cloud_cpu_counts_up(tmp_path, cloud, local_ffmpeg):
    cloud.waited = 12.4
    _out, reports = _render(tmp_path)

    details = [detail for _, detail, _ in reports]
    assert details[:3] == [
        "Waiting for a cloud CPU…",
        "Waiting for a cloud CPU… 12 s",
        "Rendering on a cloud CPU…",
    ]


def test_the_prepared_background_is_uploaded_with_the_render(
    tmp_path, cloud, local_ffmpeg, monkeypatch
):
    def run(cmd, *args, **kwargs):
        Path(cmd[-1]).write_bytes(b"\x89PNG blurred")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(vr.subprocess, "run", run)
    thumbnail = tmp_path / "thumb.jpg"
    thumbnail.write_bytes(b"jpeg")

    _render(tmp_path, thumbnail_path=str(thumbnail))

    job = cloud.jobs[0]
    assert job["files"]["background.png"] == b"\x89PNG blurred"
    args = job["args"]
    i = args.index("-loop")
    assert args[i : i + 6] == ["-loop", "1", "-framerate", "60", "-i", "background.png"]


@pytest.mark.parametrize("style", ["aurora", "spectrum"])
def test_generated_backgrounds_upload_nothing_extra(tmp_path, cloud, local_ffmpeg, style):
    _render(tmp_path, background_style=style, background_color="#0b0b12")

    job = cloud.jobs[0]
    assert sorted(job["files"]) == ["audio.wav", "subtitles.ass"]
    assert "color=c=0x0b0b12:s=480x270:r=60" in job["args"]


def test_drifting_art_uploads_its_prepared_still(tmp_path, cloud, local_ffmpeg, monkeypatch):
    def run(cmd, *args, **kwargs):
        Path(cmd[-1]).write_bytes(b"\x89PNG overscan")
        return subprocess.CompletedProcess(cmd, 0, "", "")

    monkeypatch.setattr(vr.subprocess, "run", run)
    thumbnail = tmp_path / "thumb.jpg"
    thumbnail.write_bytes(b"jpeg")

    _render(tmp_path, thumbnail_path=str(thumbnail), background_style="drift")

    job = cloud.jobs[0]
    assert job["files"]["background.png"] == b"\x89PNG overscan"
    args = job["args"]
    assert "-loop" not in args
    i = args.index("-framerate")
    assert args[i : i + 4] == ["-framerate", "60", "-i", "background.png"]


@pytest.mark.parametrize("mode", ["unavailable", "fail"])
def test_a_cloud_problem_falls_back_to_a_local_render(tmp_path, cloud, local_ffmpeg, mode):
    cloud.mode = mode
    out, reports = _render(tmp_path)

    assert len(cloud.jobs) == 1
    assert len(local_ffmpeg) == 1
    assert local_ffmpeg[0][0] == "ffmpeg"
    assert local_ffmpeg[0][-1] == str(out)
    assert "Cloud render unavailable, rendering here…" in [detail for _, detail, _ in reports]


def test_cancelling_a_cloud_render_does_not_render_locally(tmp_path, cloud, local_ffmpeg):
    cloud.mode = "cancelled"
    with pytest.raises(RuntimeError, match="Video rendering was cancelled by user"):
        _render(tmp_path)
    assert local_ffmpeg == []


def test_cloud_export_stays_off_without_the_setting_or_credentials(
    tmp_path, cloud, local_ffmpeg, monkeypatch
):
    monkeypatch.delenv("MODAL_TOKEN_ID")
    monkeypatch.setenv("HOME", str(tmp_path))  # no ~/.modal.toml either
    _render(tmp_path)
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.delenv("RENDER_REMOTE")
    _render(tmp_path)

    assert cloud.jobs == []
    assert len(local_ffmpeg) == 2


def test_cloud_render_settings(monkeypatch):
    assert remote_render.backend() is None
    assert (remote_render.queue_seconds(), remote_render.timeout_seconds()) == (120.0, 3600.0)
    monkeypatch.setenv("RENDER_REMOTE", " Modal ")
    monkeypatch.setenv("RENDER_REMOTE_QUEUE_SEC", "30")
    monkeypatch.setenv("RENDER_REMOTE_TIMEOUT_SEC", "nonsense")
    assert remote_render.backend() == "modal"
    assert (remote_render.queue_seconds(), remote_render.timeout_seconds()) == (30.0, 3600.0)
    assert remote_render.prewarm_enabled() is True
    monkeypatch.setenv("RENDER_REMOTE_PREWARM", "off")
    assert remote_render.prewarm_enabled() is False
