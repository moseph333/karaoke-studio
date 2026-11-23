"""The song loop worker makes a clip loop: with real FFmpeg, the loop is one fade shorter
than the clip and its last frame leads into its first. Then the worker end to end, with the
models stood in for."""

import json
import shutil
import subprocess
import sys
import types

import numpy as np
import pytest

from backend.workers import song_loop_worker as worker

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")

FPS = 24
SIDE = 64


def ramp(frames: int) -> np.ndarray:
    """Frames that brighten steadily from black to white, so a frame's brightness says
    which moment of the clip it is."""
    levels = np.linspace(0.0, 1.0, frames, dtype=np.float32)
    return np.broadcast_to(levels[:, None, None, None], (frames, SIDE, SIDE, 3)).copy()


def brightness(video) -> list[float]:
    """Mean brightness (0..255) of every frame of a video."""
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(video), "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
        check=True,
    ).stdout
    frames = np.frombuffer(raw, dtype=np.uint8).reshape(-1, SIDE * SIDE)
    return [float(frame.mean()) for frame in frames]


def test_the_graph_fades_the_start_over_the_end():
    graph = worker.loop_filter(5.0, 1.0)
    assert "trim=start=1.000000:end=5.000000" in graph
    assert "trim=start=0:end=1.000000" in graph
    assert "xfade=transition=fade:duration=1.000000:offset=3.000000" in graph
    assert graph.endswith("format=yuv420p[v]")


@pytest.mark.parametrize("fade", [0.0, -1.0, 2.5, 3.0])
def test_a_fade_of_half_the_clip_or_more_is_refused(fade):
    with pytest.raises(ValueError):
        worker.loop_filter(5.0, fade)


@needs_ffmpeg
def test_the_loop_runs_into_its_own_start(tmp_path):
    clip, loop = tmp_path / "clip.mp4", tmp_path / "loop.mp4"
    assert worker.write_clip(ramp(3 * FPS), clip, FPS) == (SIDE, SIDE)
    drawn = brightness(clip)
    assert len(drawn) == 3 * FPS
    # As drawn, the clip jumps from white back to black when it repeats
    assert drawn[-1] - drawn[0] > 200

    worker.make_loop(clip, loop, 3.0, 1.0)
    looped = brightness(loop)
    assert len(looped) == 2 * FPS
    step = drawn[1 * FPS + 1] - drawn[1 * FPS]
    # It starts where the fade ends, and its last frame is the one just before that
    assert looped[0] == pytest.approx(drawn[1 * FPS], abs=3)
    assert abs(looped[-1] - looped[0]) <= 2 * step + 3
    # Before the fade it is the clip itself
    assert looped[FPS // 2] == pytest.approx(drawn[FPS + FPS // 2], abs=3)


@needs_ffmpeg
def test_frames_come_as_images_or_arrays(tmp_path):
    from PIL import Image

    images = [Image.new("RGB", (SIDE + 1, SIDE), (n * 10, 0, 0)) for n in range(12)]
    # An odd side is trimmed to what H.264 can hold
    assert worker.write_clip(images, tmp_path / "images.mp4", FPS) == (SIDE, SIDE)
    whole = (ramp(12) * 255).astype(np.uint8)
    assert worker.write_clip(whole, tmp_path / "bytes.mp4", FPS) == (SIDE, SIDE)
    with pytest.raises(RuntimeError, match="frames shaped"):
        worker.write_clip(np.zeros((4, SIDE, SIDE)), tmp_path / "flat.mp4", FPS)


@pytest.fixture
def stand_in_models(monkeypatch):
    """The worker with its packages importable and its two models replaced: the language
    model answers a fixed scene, the video model draws the brightening ramp."""
    for name in ("diffusers", "transformers"):
        monkeypatch.setitem(sys.modules, name, types.ModuleType(name))
    seen = types.SimpleNamespace(prompts=[], wrote=0)

    def write_scene(args, seed):
        seen.wrote += 1
        return "Paper lanterns drift down a dark river"

    def draw(args, spec, prompt, seed):
        seen.prompts.append(prompt)
        return ramp(3 * FPS)

    monkeypatch.setattr(worker, "write_scene", write_scene)
    monkeypatch.setitem(worker.DRAW, "wan22", draw)
    monkeypatch.setitem(worker.MODELS, "wan22", {**worker.MODELS["wan22"], "fps": FPS})
    return seen


def base_args(out, tmp_path) -> list[str]:
    return ["--out", str(out), "--model-dir", str(tmp_path / "models")]


def events(text: str) -> list[dict]:
    return [json.loads(line) for line in text.splitlines() if line.startswith("{")]


@needs_ffmpeg
def test_the_worker_writes_the_loop_and_what_it_was_made_from(tmp_path, stand_in_models, capsys):
    lyrics = tmp_path / "lyrics.txt"
    lyrics.write_text("Down by the river\nwhere the lanterns glow\n", encoding="utf-8")
    out = tmp_path / "out"
    code = worker.main(
        [
            *base_args(out, tmp_path),
            "--lyrics-file",
            str(lyrics),
            "--title",
            "Paper Boats",
            "--seed",
            "11",
            "--fade",
            "1",
        ]
    )
    assert code == worker.EXIT_OK
    assert len(brightness(out / "loop.mp4")) == 2 * FPS
    assert not (out / "clip.mp4").exists()
    result = json.loads((out / "result.json").read_text())
    assert result["prompt"] == "Paper lanterns drift down a dark river"
    assert result["written_from"] == "lyrics"
    assert (result["model"], result["seed"]) == ("wan22", 11)
    assert (result["width"], result["height"], result["fps"]) == (SIDE, SIDE, FPS)
    assert result["duration"] == 2.0
    assert stand_in_models.prompts == [
        f"Paper lanterns drift down a dark river. {worker.PROMPT_STYLE}"
    ]
    last = events(capsys.readouterr().err)[-1]
    assert (last["event"], last["pct"]) == ("stage", 100)


@needs_ffmpeg
def test_a_typed_scene_skips_the_language_model(tmp_path, stand_in_models):
    out = tmp_path / "out"
    code = worker.main(
        [
            *base_args(out, tmp_path),
            "--keep-clip",
            "--fade",
            "1",
            "--prompt",
            "  A field of wheat under slow clouds ",
        ]
    )
    assert code == worker.EXIT_OK
    assert stand_in_models.wrote == 0
    result = json.loads((out / "result.json").read_text())
    assert result["written_from"] == "typed"
    assert result["prompt"] == "A field of wheat under slow clouds"
    assert (out / "clip.mp4").is_file()


def test_a_failure_is_reported_as_an_event(tmp_path, stand_in_models, monkeypatch, capsys):
    def fail(args, spec, prompt, seed):
        raise RuntimeError("out of video memory")

    monkeypatch.setitem(worker.DRAW, "wan22", fail)
    code = worker.main(
        ["--out", str(tmp_path / "out"), "--model-dir", str(tmp_path / "m"), "--prompt", "a lake"]
    )
    assert code == worker.EXIT_FAILED
    last = events(capsys.readouterr().err)[-1]
    assert last == {
        "event": "error",
        "code": "failed",
        "detail": "RuntimeError: out of video memory",
    }


def test_missing_packages_are_an_import_failure(tmp_path, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "diffusers", None)
    code = worker.main(
        ["--out", str(tmp_path / "out"), "--model-dir", str(tmp_path / "m"), "--prompt", "a lake"]
    )
    assert code == worker.EXIT_IMPORT
    assert events(capsys.readouterr().err)[-1]["code"] == "import"
