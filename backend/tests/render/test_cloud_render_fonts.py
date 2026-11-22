"""A cloud render names the fonts its subtitles need, and a deployment that lacks one
refuses it, so the video is rendered here in the right font instead."""

import ast
import subprocess
import types
from pathlib import Path

import pytest

from backend.services import remote_render
from backend.services import separation_presets as presets
from backend.services.modal_jobs import RemoteOutcome
from backend.services.process_watchdog import PROJECT_ROOT
from backend.services.video_renderer import VideoRenderer

MODAL_APP = (PROJECT_ROOT / "gpu" / "modal_app.py").read_text(encoding="utf-8")
LOCAL_VIDEO = b"MP4 rendered here"


@pytest.fixture
def cloud(monkeypatch):
    """Cloud export on; jobs go to a stand-in that records them and answers ``state.result``."""
    monkeypatch.setenv("RENDER_REMOTE", "modal")
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")
    state = types.SimpleNamespace(
        jobs=[], result={"returncode": 0, "video": b"MP4 from the cloud", "cpus": 16}
    )

    def run_modal_job(function_name, kwargs, on_line, cancel_event, **limits):
        state.jobs.append(kwargs)
        limits["on_started"]()
        return RemoteOutcome(int(state.result["returncode"])), state.result

    monkeypatch.setattr(remote_render, "run_modal_job", run_modal_job)

    class LocalFfmpeg:
        returncode = 0

        def __init__(self, cmd, *args, **kwargs):
            self.stdout: list = []
            self.stderr: list = []
            state.local = list(cmd)
            Path(cmd[-1]).write_bytes(LOCAL_VIDEO)

        def poll(self):
            return 0

        def wait(self, timeout=None):
            return 0

        def terminate(self):
            pass

        def kill(self):
            pass

    state.local = None
    monkeypatch.setattr(subprocess, "Popen", LocalFfmpeg)
    return state


def render(tmp_path: Path, **kwargs) -> Path:
    audio = tmp_path / "mix.wav"
    audio.write_bytes(b"RIFF audio")
    script = tmp_path / "lyrics.ass"
    script.write_text("[Script Info]\n", encoding="utf-8")
    out = VideoRenderer(output_dir=tmp_path).render_video(
        str(audio), str(script), tmp_path / "out.mp4", duration=1.0, **kwargs
    )
    return Path(out)


def test_a_render_names_the_fonts_its_subtitles_need(tmp_path, cloud):
    out = render(tmp_path, fonts=["Newsreader-MediumItalic.ttf", "Newsreader-Medium.ttf"])
    assert out.read_bytes() == b"MP4 from the cloud"
    assert cloud.jobs[0]["fonts"] == ["Newsreader-Medium.ttf", "Newsreader-MediumItalic.ttf"]


def test_a_render_that_names_no_fonts_sends_none_so_any_deployment_takes_it(tmp_path, cloud):
    render(tmp_path)
    assert "fonts" not in cloud.jobs[0]


def test_a_deployment_without_the_font_is_answered_by_a_render_here(tmp_path, cloud):
    cloud.result = {
        "returncode": 1,
        "stderr": "This cloud renderer has no Jost-Medium.ttf: deploy it again",
    }
    out = render(tmp_path, fonts=["Jost-Medium.ttf"])
    assert out.read_bytes() == LOCAL_VIDEO
    assert cloud.local is not None and "ffmpeg" in cloud.local[0]


def _function(name: str) -> ast.FunctionDef:
    tree = ast.parse(MODAL_APP)
    return next(
        node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name
    )


def test_the_cloud_function_takes_the_fonts_with_a_default():
    """Every argument keeps a default, so a server from before the looks still renders."""
    args = _function("render").args
    names = [arg.arg for arg in args.args]
    assert names[-1] == "fonts"
    assert len(args.defaults) == len(names)


def test_the_cloud_function_refuses_before_ffmpeg_runs():
    body = ast.unparse(_function("render"))
    assert body.index("missing_fonts(fonts)") < body.index("subprocess.Popen")
    assert "'returncode': 1" in body


def test_missing_fonts_are_the_named_files_the_deployment_does_not_hold(tmp_path):
    scope: dict = {"Path": Path, "FONTS_DIR": str(tmp_path)}
    exec(ast.unparse(_function("missing_fonts")), scope)
    missing_fonts = scope["missing_fonts"]
    (tmp_path / "Jost-Medium.ttf").write_bytes(b"font")
    assert missing_fonts(None) == [] and missing_fonts([]) == []
    assert missing_fonts(["Jost-Medium.ttf"]) == []
    assert missing_fonts(["Sora-Bold.ttf", "Jost-Medium.ttf", "A.ttf"]) == [
        "A.ttf",
        "Sora-Bold.ttf",
    ]
    # A name cannot reach outside the fonts folder
    outside = tmp_path.parent / "secret.ttf"
    outside.write_bytes(b"x")
    assert missing_fonts(["../secret.ttf"]) == ["../secret.ttf"]
