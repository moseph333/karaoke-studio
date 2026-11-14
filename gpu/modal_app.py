"""Karaoke Studio's cloud workers on Modal: Balanced and Best stem separation on a GPU, and
video export on a CPU.

Deploy once from the repository root (needs `pip install modal` and `modal setup`):

    modal deploy gpu/modal_app.py

then let the server use them with SEPARATION_REMOTE=modal and/or RENDER_REMOTE=modal and a
Modal token in .env (MODAL_TOKEN_ID and MODAL_TOKEN_SECRET; see .env.example). Deploy again
after changing the RoFormer or CTC worker, backend/requirements-ml.txt or backend/assets/fonts.

`separate` runs backend.workers.roformer_worker unchanged on the first free GPU from
SEPARATION_REMOTE_GPUS and sends the worker's stderr back through the queue it is handed, for
backend.services.remote_separation to read. Once the stems are made it also runs
backend.workers.ctc_align_worker in emission-only mode on the new vocals and returns that
emission too (backend.services.emission_cache), so the server's lyric alignment does not have
to run the MMS model on its CPU; if that step fails the stems still come back. Model weights
(RoFormer and MMS) live in the Modal volume "karaoke-models", so each downloads once. `render` runs FFmpeg with the arguments
backend.services.video_renderer builds, on RENDER_REMOTE_CPUS cores with the app's fonts, and
sends FFmpeg's -progress lines back the same way; called with warmup=True (when the Export
dialog opens) it only starts a container. Billing is per second while a container runs; an
idle GPU container stops after SEPARATION_REMOTE_SCALEDOWN_SEC and an idle render container
after RENDER_REMOTE_SCALEDOWN_SEC, long enough for the Render click that follows a warm-up.
"""

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
# Physical cores for an export; libx264 at 1080p60 keeps about 16 busy
RENDER_CPUS = float(os.environ.get("RENDER_REMOTE_CPUS", "16"))
RENDER_SCALEDOWN_SECONDS = int(os.environ.get("RENDER_REMOTE_SCALEDOWN_SEC", "120"))
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

# The same Debian FFmpeg as the app image, plus the theme fonts the subtitles ask for
render_image = modal.Image.debian_slim(python_version="3.12").apt_install(
    "ffmpeg", "fontconfig", "fonts-dejavu-core"
)
if modal.is_local():  # the fonts are uploaded at deploy time
    render_image = render_image.add_local_dir(ROOT / "backend" / "assets" / "fonts", FONTS_DIR)

weights = modal.Volume.from_name("karaoke-models", create_if_missing=True)
app = modal.App(APP_NAME, image=image)


@app.function(
    gpu=GPUS,
    volumes={"/models": weights},
    timeout=1800,
    scaledown_window=SCALEDOWN_SECONDS,
)
def separate(
    audio: bytes,
    filename: str,
    models: list[str],
    overlap: int,
    ensemble: str,
    lines: modal.Queue,
) -> dict:
    """Separate one song: the worker's stderr goes to `lines`, the two stems (and, when it
    could be made, the vocals' MMS emission) are returned."""
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
) -> dict:
    """Run `ffmpeg *args` next to the uploaded files: FFmpeg's -progress lines go to `lines`,
    the finished video (`output`) is returned. With warmup=True it returns at once: the call
    only starts a container for the render that follows."""
    if warmup:
        return {"warmup": True, "cpus": os.cpu_count()}
    if lines is None or args is None:
        raise ValueError("render needs FFmpeg arguments and a queue for its output")
    lines.put(STARTED)
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
