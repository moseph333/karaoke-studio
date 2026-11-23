"""Karaoke Studio's cloud workers on Modal: Balanced and Best stem separation on a GPU,
video export on a CPU, and song loops (a background video made from a song's lyrics) on a GPU.

Deploy once from the repository root (needs `pip install modal` and `modal setup`):

    modal deploy gpu/modal_app.py

then let the server use them with SEPARATION_REMOTE=modal, RENDER_REMOTE=modal and/or
SONG_LOOP_REMOTE=modal and a Modal token in .env (MODAL_TOKEN_ID and MODAL_TOKEN_SECRET; see
.env.example). Deploy again after changing the RoFormer, CTC or song loop worker,
backend/requirements-ml.txt or backend/assets/fonts.

`separate` runs backend.workers.roformer_worker unchanged on the first free GPU from
SEPARATION_REMOTE_GPUS and sends the worker's stderr back through the queue it is handed, for
backend.services.remote_separation to read. Once the stems are made it also runs
backend.workers.ctc_align_worker in emission-only mode on the new vocals and returns that
emission too (backend.services.emission_cache), so the server's lyric alignment does not have
to run the MMS model on its CPU; if that step fails the stems still come back. Model weights
(RoFormer and MMS) live in the Modal volume "karaoke-models", so each downloads once. `render` runs FFmpeg with the arguments
backend.services.video_renderer builds, on RENDER_REMOTE_CPUS cores with the app's fonts, and
sends FFmpeg's -progress lines back the same way. Called with warmup=True, either function
only starts a container: `separate` when a song's intake begins (while the audio downloads),
`render` when the Export dialog opens. Billing is per second while a container runs; an
idle GPU container stops after SEPARATION_REMOTE_SCALEDOWN_SEC and an idle render container
after RENDER_REMOTE_SCALEDOWN_SEC, long enough for the job that follows a warm-up.

`song_loop` runs backend.workers.song_loop_worker on the first free GPU from
SONG_LOOP_REMOTE_GPUS (it wants 24 GB of video memory or more) in an image of its own, with
the video and language model weights in the same volume (/models/loops, tens of gigabytes on
the first run), and returns the loop with the scene text it was drawn from. To compare the
video models on a few songs before choosing one, without touching the deployed app:

    modal run gpu/modal_app.py::song_loop_trial --lyrics a.txt,b.txt --out /tmp/loops
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

import modal

ROOT = Path(__file__).resolve().parents[1]
APP_NAME = os.environ.get("SEPARATION_REMOTE_APP", "").strip() or "karaoke-studio-gpu"
# Faster GPUs first: billing is per second, so a quicker GPU usually costs less per song
# (Best on a 3-minute song: about 1 minute on an A10G, more than 2 on an L4)
GPUS = [
    gpu.strip()
    for gpu in os.environ.get("SEPARATION_REMOTE_GPUS", "A10G,L40S,L4,T4").split(",")
    if gpu.strip()
]
SCALEDOWN_SECONDS = int(os.environ.get("SEPARATION_REMOTE_SCALEDOWN_SEC", "30"))
# Modal stops a separation (the emission step included) after this long. It is fixed when the
# app is deployed, so the server's SEPARATION_TIMEOUT_SEC can only stop a job sooner: raise
# this and deploy again to let a very long song run longer
SEPARATE_TIMEOUT_SECONDS = int(os.environ.get("SEPARATION_REMOTE_TIMEOUT_SEC", "1800"))
# Physical cores for an export; libx264 at 1080p60 keeps about 16 busy
RENDER_CPUS = float(os.environ.get("RENDER_REMOTE_CPUS", "16"))
RENDER_SCALEDOWN_SECONDS = int(os.environ.get("RENDER_REMOTE_SCALEDOWN_SEC", "120"))
# A song loop's video model needs 24 GB of video memory; with more, it runs without swapping
# its parts in and out
LOOP_GPUS = [
    gpu.strip()
    for gpu in os.environ.get("SONG_LOOP_REMOTE_GPUS", "L40S,A100,A10G").split(",")
    if gpu.strip()
]
LOOP_SCALEDOWN_SECONDS = int(os.environ.get("SONG_LOOP_REMOTE_SCALEDOWN_SEC", "30"))
# Fixed at deploy time like SEPARATE_TIMEOUT_SECONDS; the first run also downloads the weights
LOOP_TIMEOUT_SECONDS = int(os.environ.get("SONG_LOOP_REMOTE_TIMEOUT_SEC", "2400"))
LOOP_MODEL_DIR = "/models/loops"
MODEL_DIR = "/models/audio-separator"
ALIGN_MODEL_DIR = "/models/mms_fa"
# The emission takes seconds on a GPU (plus a one-time 1.2 GB download); never let it hold
# the stems back for long
EMISSION_TIMEOUT_SECONDS = 300
FONTS_DIR = "/fonts"  # same path as backend/services/remote_render.py
# Put on the queue when the job starts (same value in backend/services/modal_jobs.py)
STARTED = "\x00karaoke-gpu-started"


def _gpu_name() -> str:
    try:
        done = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return done.stdout.strip().splitlines()[0]
    except (OSError, subprocess.SubprocessError, IndexError):
        return ""


def _emission(vocals: Path, work: Path) -> bytes | None:
    """The MMS aligner's emission for the new vocals as .npy bytes, or None when it could not
    be made (the separation still succeeds)."""
    target = work / "emission.npy"
    cmd = [
        sys.executable,
        "-u",
        "-m",
        "backend.workers.ctc_align_worker",
        "--emission",
        str(vocals),
        "--out",
        str(target),
        "--model-dir",
        ALIGN_MODEL_DIR,
        "--allow-download",
        "1",
        "--device",
        "auto",
    ]
    try:
        done = subprocess.run(
            cmd,
            cwd="/app",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=EMISSION_TIMEOUT_SECONDS,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        print(f"No neural listening pass: {exc}", file=sys.stderr)
        return None
    if done.returncode != 0 or not target.is_file():
        tail = "\n".join(done.stderr.strip().splitlines()[-5:])
        print(f"No neural listening pass (exit {done.returncode}): {tail}", file=sys.stderr)
        return None
    return target.read_bytes()


def _ml_requirements() -> list[str]:
    """backend/requirements-ml.txt with the GPU build of audio-separator.

    Read where the repository is (deploy time); inside the container the image already exists.
    """
    path = ROOT / "backend" / "requirements-ml.txt"
    if not path.is_file():
        return []
    packages = [line.split("#", 1)[0].strip() for line in path.read_text().splitlines()]
    return [p.replace("audio-separator[cpu]", "audio-separator[gpu]") for p in packages if p]


image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(*_ml_requirements(), "torchaudio>=2.10.0", "soundfile")
    .env({"PYTHONPATH": "/app"})
)
if modal.is_local():  # the worker code is uploaded at deploy time
    image = image.add_local_dir(
        ROOT / "backend", "/app/backend", ignore=["tests", "**/__pycache__"]
    )

# The same Debian FFmpeg and system fonts as the app image (Noto CJK draws Japanese, Chinese
# and Korean lyrics, which the theme fonts lack), plus the theme fonts the subtitles ask for
render_image = modal.Image.debian_slim(python_version="3.12").apt_install(
    "ffmpeg", "fontconfig", "fonts-noto-cjk", "fonts-dejavu-core"
)
if modal.is_local():  # the fonts are uploaded at deploy time
    render_image = render_image.add_local_dir(ROOT / "backend" / "assets" / "fonts", FONTS_DIR)

# The song loop worker's own image: the video and language models' packages, kept apart from
# the separation image so neither set of pins constrains the other
loop_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install(
        "torch>=2.4",
        "diffusers>=0.35",
        "transformers>=4.51",
        "accelerate",
        "safetensors",
        "sentencepiece",
        "protobuf",
        "ftfy",
        "numpy",
        "pillow",
    )
    .env({"PYTHONPATH": "/app"})
)
if modal.is_local():  # the worker is uploaded at deploy time
    loop_image = loop_image.add_local_file(
        ROOT / "backend" / "workers" / "song_loop_worker.py",
        "/app/backend/workers/song_loop_worker.py",
    )

weights = modal.Volume.from_name("karaoke-models", create_if_missing=True)
app = modal.App(APP_NAME, image=image)


@app.function(
    gpu=GPUS,
    volumes={"/models": weights},
    timeout=SEPARATE_TIMEOUT_SECONDS,
    scaledown_window=SCALEDOWN_SECONDS,
)
def separate(
    audio: bytes = b"",
    filename: str = "",
    models: list[str] | None = None,
    overlap: int = 2,
    ensemble: str = "avg_wave",
    lines: modal.Queue | None = None,
    warmup: bool = False,
    first_tags: list[str] | None = None,
    second_tags: list[str] | None = None,
) -> dict:
    """Separate one song: the worker's stderr goes to `lines`, the two stems (and, when it
    could be made, the vocals' MMS emission) are returned. With warmup=True it returns at
    once: the call only starts a GPU container for a separation that is about to follow.
    first_tags and second_tags go to the worker, for a model whose two outputs are not
    vocals and instrumental (the server sends them only for such a model)."""
    if warmup or lines is None or not models:
        return {"warmup": True}
    lines.put(STARTED)
    work = Path(tempfile.mkdtemp(prefix="karaoke-"))
    try:
        song = work / (Path(filename).name or "song.wav")
        song.write_bytes(audio)
        out = work / "out"
        cmd = [
            sys.executable,
            "-u",
            "-m",
            "backend.workers.roformer_worker",
            "--audio",
            str(song),
            "--out",
            str(out),
            "--models",
            *models,
            "--overlap",
            str(overlap),
            "--model-dir",
            MODEL_DIR,
            "--allow-download",
            "1",
        ]
        if len(models) > 1:
            cmd += ["--ensemble", ensemble]
        if first_tags and second_tags:
            cmd += ["--first-tags", *first_tags, "--second-tags", *second_tags]
        process = subprocess.Popen(
            cmd,
            cwd="/app",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        try:
            batch: list[str] = []
            sent = time.monotonic()
            for line in process.stderr:
                batch.append(line)
                # Progress bars at most twice a second; worker events straight away
                if line.lstrip().startswith("{") or time.monotonic() - sent >= 0.5:
                    lines.put_many(batch)
                    batch, sent = [], time.monotonic()
            returncode = process.wait()
            if batch:
                lines.put_many(batch)
        finally:
            if process.poll() is None:  # cancelled or failed while the worker ran
                process.kill()
        result: dict = {"returncode": returncode, "gpu": _gpu_name()}
        if returncode == 0:
            result["vocals"] = (out / "vocals.wav").read_bytes()
            result["no_vocals"] = (out / "no_vocals.wav").read_bytes()
            emission = _emission(out / "vocals.wav", work)
            if emission is not None:
                result["emission"] = emission
        weights.commit()  # keep any weights this run downloaded
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def missing_fonts(names: list[str] | None, fonts_dir: str = FONTS_DIR) -> list[str]:
    """The font files a render names that this deployment does not hold (it was deployed
    before they were added to backend/assets/fonts)."""
    return sorted(
        name for name in (names or []) if not (Path(fonts_dir) / Path(name).name).is_file()
    )


@app.function(
    image=render_image,
    cpu=RENDER_CPUS,
    memory=8192,
    timeout=3600,
    scaledown_window=RENDER_SCALEDOWN_SECONDS,
)
def render(
    files: dict[str, bytes] | None = None,
    args: list[str] | None = None,
    output: str = "",
    lines: modal.Queue | None = None,
    warmup: bool = False,
    fonts: list[str] | None = None,
) -> dict:
    """Run `ffmpeg *args` next to the uploaded files: FFmpeg's -progress lines go to `lines`,
    the finished video (`output`) is returned. With warmup=True it returns at once: the call
    only starts a container for the render that follows. `fonts` names the font files the
    subtitles need: when this deployment lacks one the render is refused (a non-zero result),
    so the server renders locally instead of getting a video drawn in a fallback font."""
    if warmup:
        return {"warmup": True, "cpus": os.cpu_count()}
    if lines is None or args is None:
        raise ValueError("render needs FFmpeg arguments and a queue for its output")
    lines.put(STARTED)
    lacking = missing_fonts(fonts)
    if lacking:
        return {
            "returncode": 1,
            "stderr": (
                f"This cloud renderer has no {', '.join(lacking)}: "
                "deploy it again (modal deploy gpu/modal_app.py)"
            ),
            "cpus": os.cpu_count(),
        }
    work = Path(tempfile.mkdtemp(prefix="render-"))
    try:
        for name, data in (files or {}).items():
            (work / Path(name).name).write_bytes(data)
        process = subprocess.Popen(
            ["ffmpeg", "-nostdin", *args],
            cwd=work,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        errors: list[str] = []
        drain = threading.Thread(target=lambda: errors.extend(process.stderr), daemon=True)
        drain.start()
        try:
            batch: list[str] = []
            sent = time.monotonic()
            for line in process.stdout:
                batch.append(line)
                # One block of key=value lines ends with progress=...; send at most twice a second
                if line.startswith("progress=") and time.monotonic() - sent >= 0.5:
                    lines.put_many(batch)
                    batch, sent = [], time.monotonic()
            returncode = process.wait()
            if batch:
                lines.put_many(batch)
        finally:
            if process.poll() is None:  # cancelled while FFmpeg ran
                process.kill()
            drain.join(timeout=5)
        result: dict = {
            "returncode": returncode,
            "stderr": "".join(errors[-20:]).strip(),
            "cpus": os.cpu_count(),
        }
        video = work / Path(output).name
        if returncode == 0 and video.is_file():
            result["video"] = video.read_bytes()
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.function(
    image=loop_image,
    gpu=LOOP_GPUS,
    volumes={"/models": weights},
    timeout=LOOP_TIMEOUT_SECONDS,
    scaledown_window=LOOP_SCALEDOWN_SECONDS,
)
def song_loop(
    lyrics: str = "",
    title: str = "",
    artist: str = "",
    prompt: str = "",
    model: str = "",
    seed: int | None = None,
    lines: modal.Queue | None = None,
    warmup: bool = False,
    fade: float = 0.0,
    keep_clip: bool = False,
) -> dict:
    """Make one song's loop: the worker's stderr goes to `lines` (to this container's own
    output without one), and the loop comes back as `video` with what result.json says about
    it (`prompt`, `written_from`, `model`, `seed`, ...). `prompt` is the scene as typed;
    without it the worker writes one from `lyrics`. `model` and `fade` left empty take the
    worker's defaults. keep_clip also returns the clip as drawn, before it was made to loop
    (`clip`). With warmup=True it returns at once."""
    if warmup:
        return {"warmup": True}
    if not (prompt.strip() or lyrics.strip() or title.strip()):
        raise ValueError("song_loop needs a prompt, lyrics or a title")
    if lines is not None:
        lines.put(STARTED)

    def send(batch: list[str]) -> None:
        if lines is not None:
            lines.put_many(batch)
        else:
            sys.stderr.write("".join(batch))

    started = time.monotonic()
    work = Path(tempfile.mkdtemp(prefix="loop-"))
    try:
        out = work / "out"
        cmd = [
            sys.executable,
            "-u",
            "-m",
            "backend.workers.song_loop_worker",
            "--out",
            str(out),
            "--model-dir",
            LOOP_MODEL_DIR,
            # As one argument each: a title may begin with a dash
            f"--title={title}",
            f"--artist={artist}",
        ]
        if lyrics.strip():
            words = work / "lyrics.txt"
            words.write_text(lyrics, encoding="utf-8")
            cmd += ["--lyrics-file", str(words)]
        if prompt.strip():
            cmd.append(f"--prompt={prompt}")
        if model:
            cmd += ["--model", model]
        if seed is not None:
            cmd += ["--seed", str(seed)]
        if fade > 0:
            cmd += ["--fade", str(fade)]
        if keep_clip:
            cmd.append("--keep-clip")
        process = subprocess.Popen(
            cmd,
            cwd="/app",
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
        )
        try:
            batch: list[str] = []
            sent = time.monotonic()
            for line in process.stderr:
                batch.append(line)
                # Worker events straight away; anything else at most twice a second
                if line.lstrip().startswith("{") or time.monotonic() - sent >= 0.5:
                    send(batch)
                    batch, sent = [], time.monotonic()
            returncode = process.wait()
            if batch:
                send(batch)
        finally:
            if process.poll() is None:  # cancelled or failed while the worker ran
                process.kill()
        result: dict = {"returncode": returncode, "gpu": _gpu_name()}
        if returncode == 0:
            result.update(json.loads((out / "result.json").read_text(encoding="utf-8")))
            result["video"] = (out / "loop.mp4").read_bytes()
            if keep_clip and (out / "clip.mp4").is_file():
                result["clip"] = (out / "clip.mp4").read_bytes()
        result["total_seconds"] = round(time.monotonic() - started, 1)
        weights.commit()  # keep any weights this run downloaded
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.local_entrypoint()
def song_loop_trial(
    lyrics: str, out: str = "song-loop-trial", models: str = "wan22,ltx", seed: int = 7
):
    """Make a loop for each lyrics file with each model, to compare them by eye.

    `lyrics` is a comma-separated list of text files; a file's name (without its extension)
    is taken as the song's title. Each run leaves <title>.<model>.loop.mp4, the clip before
    looping (.clip.mp4) and the scene text (.txt) in `out`, and a line with the GPU and the
    seconds each step took. One run at a time, so each model's weights download once.
    """
    target = Path(out).expanduser()
    target.mkdir(parents=True, exist_ok=True)
    report: list[str] = []
    for model in [name.strip() for name in models.split(",") if name.strip()]:
        for name in [item.strip() for item in lyrics.split(",") if item.strip()]:
            source = Path(name).expanduser()
            title = source.stem
            print(f"--- {title}: {model}")
            result = song_loop.remote(
                lyrics=source.read_text(encoding="utf-8"),
                title=title,
                model=model,
                seed=seed,
                keep_clip=True,
            )
            if result.get("returncode") != 0 or "video" not in result:
                report.append(f"{title:<28} {model:<6} FAILED (exit {result.get('returncode')})")
                continue
            stem = f"{title}.{model}"
            (target / f"{stem}.loop.mp4").write_bytes(result["video"])
            if "clip" in result:
                (target / f"{stem}.clip.mp4").write_bytes(result["clip"])
            (target / f"{stem}.txt").write_text(result.get("prompt", "") + "\n", encoding="utf-8")
            took = result.get("seconds", {})
            report.append(
                f"{title:<28} {model:<6} {result.get('gpu', '?'):<22} "
                f"text {took.get('text', 0):>6.1f} s  video {took.get('video', 0):>7.1f} s  "
                f"loop {took.get('loop', 0):>5.1f} s  total {result.get('total_seconds', 0):>7.1f} s"
            )
    print("\n".join(["", *report, "", f"Loops are in {target}"]))
