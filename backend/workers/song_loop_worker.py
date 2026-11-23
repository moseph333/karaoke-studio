"""Song loop worker: a looping background video made from a song's lyrics.

gpu/modal_app.py runs this on a cloud GPU (it needs about 24 GB of video memory and the
diffusers and transformers packages, which only that image installs):

    python -u -m backend.workers.song_loop_worker --out DIR --model-dir MODELS
        [--lyrics-file LYRICS.txt] [--title TITLE] [--artist ARTIST] [--prompt TEXT]
        [--model wan22|ltx] [--seed N] [--fade 1.0] [--keep-clip]

Three steps. With no --prompt, a small language model reads the lyrics and writes the scene:
one continuous shot of scenery, with no faces and no lettering, so nothing competes with the
lyrics drawn over it. A video model then draws a few seconds of that scene, and FFmpeg fades
the clip's first second over its last, which leaves a loop that runs into its own start.

It writes DIR/loop.mp4 (H.264, no audio) and DIR/result.json (the scene text and where it
came from, the model, the seed, the size and length); --keep-clip also leaves the clip as
drawn in DIR/clip.mp4. Progress goes to stderr as one JSON object per line
({"event": "stage" | "download" | "error", ...}), the protocol of roformer_worker, with a
line at least every 15 seconds while weights load so the caller can tell slow from stuck.
stdout is unused.

Exit codes: 0 ok, 2 bad arguments, 4 PyTorch, diffusers or transformers cannot be imported,
5 the loop could not be made.
"""

import argparse
import contextlib
import gc
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path

EXIT_OK = 0
EXIT_USAGE = 2
EXIT_IMPORT = 4
EXIT_FAILED = 5

# The model a loop is made with when none is named
DEFAULT_MODEL = "wan22"

# Sizes are what each model was trained at; a loop is scaled to the video when it is drawn
MODELS: dict[str, dict] = {
    "wan22": {
        "label": "Wan 2.2 (5B)",
        "repos": ["Wan-AI/Wan2.2-TI2V-5B-Diffusers"],
        "width": 1280,
        "height": 704,
        "frames": 121,  # 4k + 1
        "fps": 24,
        "steps": 50,
        "guidance": 5.0,
    },
    "ltx": {
        "label": "LTX-Video 0.9.7 (distilled)",
        "repos": ["Lightricks/LTX-Video-0.9.7-distilled", "Lightricks/ltxv-spatial-upscaler-0.9.7"],
        # Drawn small, doubled by the latent upscaler, then scaled to width x height
        "base_width": 800,
        "base_height": 448,
        "width": 1280,
        "height": 720,
        "frames": 161,  # 8k + 1
        "fps": 24,
    },
}

SCENE_MODEL = "Qwen/Qwen3-4B"
SCENE_MODEL_LABEL = "Qwen3 4B"
SCENE_WORDS = 70
MAX_SCENE_CHARS = 600
LYRICS_CHARS = 2400
HEARTBEAT_SECONDS = 15.0
DEFAULT_FADE = 1.0

SCENE_RULES = (
    "You describe one scene for a looping background video that plays behind karaoke lyrics. "
    "Read the song and describe ONE continuous shot whose imagery and mood come from it.\n"
    "Rules:\n"
    "- Scenery, weather, light, objects and atmosphere only. No faces and nobody in close-up.\n"
    "- No text of any kind: no signs, letters, captions or logos.\n"
    "- Slow, steady motion that could go on forever: drifting, flowing, swaying, falling, "
    "flickering.\n"
    "- A still or very slowly moving camera. No cuts.\n"
    "- Name the colours and the light.\n"
    f"Write in English, in the present tense, as one paragraph of at most {SCENE_WORDS} words. "
    "Do not quote the lyrics, name the song or the artist, or explain yourself: answer with "
    "the description only."
)
PROMPT_STYLE = "Slow, continuous motion. Cinematic lighting, soft focus, rich colour."
NEGATIVE_PROMPT = (
    "text, letters, words, subtitles, captions, watermark, logo, signature, faces, close-up "
    "of a person, fast motion, camera cuts, flicker, static image, overexposed, worst quality, "
    "low quality, jpeg artifacts, blurry, jittery, distorted"
)
# What the LTX-Video pipeline is documented with (the scene's own limits go in the prompt)
LTX_NEGATIVE_PROMPT = (
    "worst quality, inconsistent motion, blurry, jittery, distorted, text, letters, subtitles, "
    "watermark, faces"
)

_THINKING = re.compile(r"<think>.*?</think>", re.DOTALL)
_SPACE = re.compile(r"\s+")
_QUOTES = "\"'\u201c\u201d\u2018\u2019"


def emit(event: str, **fields) -> None:
    sys.stderr.write(json.dumps({"event": event, **fields}) + "\n")
    sys.stderr.flush()


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="song_loop_worker", description="Make a looping background video for a song."
    )
    parser.add_argument("--out", type=Path, required=True, help="Directory for loop.mp4")
    parser.add_argument("--model-dir", type=Path, required=True, help="Model weights directory")
    parser.add_argument("--lyrics-file", type=Path, default=None, help="The song's lyrics")
    parser.add_argument("--title", default="")
    parser.add_argument("--artist", default="")
    parser.add_argument("--prompt", default="", help="The scene, instead of one from the lyrics")
    parser.add_argument("--model", choices=sorted(MODELS), default=DEFAULT_MODEL)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--fade", type=float, default=DEFAULT_FADE, help="Seconds of crossfade")
    parser.add_argument("--keep-clip", action="store_true", help="Also keep the clip as drawn")
    args = parser.parse_args(argv)
    if args.lyrics_file is not None and not args.lyrics_file.is_file():
        parser.error(f"--lyrics-file {args.lyrics_file} is not a file")
    lyrics = args.lyrics_file.read_text(encoding="utf-8") if args.lyrics_file else ""
    if not (args.prompt.strip() or lyrics.strip() or args.title.strip()):
        parser.error("give --prompt, --lyrics-file or --title: there is nothing to go by")
    spec = MODELS[args.model]
    clip_seconds = spec["frames"] / spec["fps"]
    if not 0 < args.fade < clip_seconds / 2:
        parser.error(f"--fade must be above 0 and under {clip_seconds / 2:.1f} seconds")
    args.lyrics = lyrics
    return args


# --- The scene text ---------------------------------------------------------------------


def lyrics_excerpt(text: str, limit: int = LYRICS_CHARS) -> str:
    """The lyrics as the language model gets them: each line once (a chorus repeats), blank
    lines dropped, and whole lines only up to `limit` characters."""
    seen: set[str] = set()
    kept: list[str] = []
    size = 0
    for raw in text.splitlines():
        line = _SPACE.sub(" ", raw).strip()
        key = line.casefold()
        if not line or key in seen:
            continue
        if size + len(line) + 1 > limit:
            break
        seen.add(key)
        kept.append(line)
        size += len(line) + 1
    return "\n".join(kept)


def scene_source(lyrics: str, prompt: str) -> str:
    """Where a loop's scene text comes from: "typed", "lyrics", or "title" for a song with
    no lyrics."""
    if prompt.strip():
        return "typed"
    return "lyrics" if lyrics_excerpt(lyrics) else "title"


def llm_messages(lyrics: str, title: str = "", artist: str = "") -> list[dict[str, str]]:
    """The chat that asks the language model for a song's scene."""
    excerpt = lyrics_excerpt(lyrics)
    about = [
        f"{name}: {value.strip()}"
        for name, value in (("Title", title), ("Artist", artist))
        if value.strip()
    ]
    about.append(f"Lyrics:\n{excerpt}" if excerpt else "The song has no lyrics: go by its title.")
    request = "\n".join(about[:-1]) + "\n\n" + about[-1]
    return [
        {"role": "system", "content": SCENE_RULES},
        {"role": "user", "content": request.strip()},
    ]


def clean_scene(text: str, limit: int = MAX_SCENE_CHARS) -> str:
    """A scene as one line of plain text: no reasoning the model left in, no wrapping quotes,
    and cut at a sentence or word when it runs past `limit` characters."""
    text = _THINKING.sub(" ", text)
    text = _SPACE.sub(" ", text).strip().strip(_QUOTES).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    stop = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    if stop >= limit // 2:
        return cut[: stop + 1]
    return cut.rsplit(" ", 1)[0].rstrip(",;:") if " " in cut else cut


def video_prompt(scene: str) -> str:
    """What the video model is asked for: the scene, then how every loop should move and look."""
    scene = clean_scene(scene)
    if scene and scene[-1] not in ".!?":
        scene += "."
    return f"{scene} {PROMPT_STYLE}".strip()


# --- The loop ---------------------------------------------------------------------------


def loop_filter(duration: float, fade: float, fps: int) -> str:
    """FFmpeg graph that makes a clip of `duration` seconds loop: its first `fade` seconds
    are faded in over its last, and what is left starts where that fade ends. The result is
    `duration - fade` long and its last frame leads into its first. Both halves are given
    the clip's frame rate again after they are cut: the crossfade refuses input whose rate
    it cannot read, which is how FFmpeg 7 leaves a trimmed stream."""
    if not 0 < fade < duration / 2:
        raise ValueError(f"a {duration:g} s clip cannot fade over {fade:g} s")
    offset = duration - 2 * fade
    return (
        "[0:v]split[whole][start];"
        f"[whole]trim=start={fade:.6f}:end={duration:.6f},setpts=PTS-STARTPTS,fps={fps}[body];"
        f"[start]trim=start=0:end={fade:.6f},setpts=PTS-STARTPTS,fps={fps}[head];"
        f"[body][head]xfade=transition=fade:duration={fade:.6f}:offset={offset:.6f},"
        "format=yuv420p[v]"
    )


def loop_command(clip: Path, target: Path, duration: float, fade: float, fps: int) -> list[str]:
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(clip),
        "-filter_complex",
        loop_filter(duration, fade, fps),
        "-map",
        "[v]",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        str(target),
    ]


def clip_command(target: Path, width: int, height: int, fps: int) -> list[str]:
    """FFmpeg reading raw RGB frames on stdin into a clip that loses next to nothing."""
    return [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{width}x{height}",
        "-r",
        str(fps),
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-crf",
        "10",
        "-pix_fmt",
        "yuv420p",
        str(target),
    ]


def _run(cmd: list[str], data: bytes | None = None) -> None:
    done = subprocess.run(cmd, input=data, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if done.returncode != 0:
        # The first lines name the cause; the last few only say that everything stopped
        tail = done.stderr.decode("utf-8", "replace").strip().splitlines()[:4]
        raise RuntimeError(f"FFmpeg failed ({done.returncode}): {' '.join(tail)}")


def make_loop(clip: Path, target: Path, duration: float, fade: float, fps: int) -> None:
    _run(loop_command(clip, target, duration, fade, fps))


def write_clip(frames, target: Path, fps: int) -> tuple[int, int]:
    """Encode what a pipeline returned (PIL images, or an array of frames in 0..1 or 0..255)
    and say its size."""
    import numpy as np

    if hasattr(frames, "shape"):
        array = np.asarray(frames)
        if array.dtype != np.uint8:
            array = (np.clip(array, 0.0, 1.0) * 255.0).round().astype(np.uint8)
    else:
        array = np.stack([np.asarray(frame.convert("RGB")) for frame in frames])
    if array.ndim != 4 or array.shape[-1] != 3:
        raise RuntimeError(f"The video model returned frames shaped {array.shape}")
    height, width = int(array.shape[1]), int(array.shape[2])
    # libx264 with yuv420p needs even sides
    array = array[:, : height - height % 2, : width - width % 2]
    height, width = int(array.shape[1]), int(array.shape[2])
    _run(clip_command(target, width, height, fps), array.tobytes())
    return width, height


# --- Models -----------------------------------------------------------------------------


def _cached(model_dir: Path, repo: str) -> bool:
    return (model_dir / "hub" / f"models--{repo.replace('/', '--')}").is_dir()


@contextlib.contextmanager
def loading(model_dir: Path, repos: list[str], label: str, pct: float):
    """Say what is loading, and keep saying it: a first run downloads many gigabytes with
    nothing else on stderr, which the caller would take for a stall."""
    missing = [repo for repo in repos if not _cached(model_dir, repo)]
    if missing:
        event, detail = "download", f"Downloading {label} (first run only)…"
    else:
        event, detail = "stage", f"Loading {label}…"
    done = threading.Event()

    def beat() -> None:
        emit(event, detail=detail, pct=pct)
        while not done.wait(HEARTBEAT_SECONDS):
            emit(event, detail=detail, pct=pct)

    thread = threading.Thread(target=beat, daemon=True)
    thread.start()
    try:
        yield
    finally:
        done.set()
        thread.join(timeout=1)


def _free_gpu() -> None:
    import torch

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def _take_turns(pipe) -> None:
    """Each part of the pipeline sits on the GPU only while it works. With the text encoder,
    the video model and the decoder all there at once, a 48 GB card ran out of memory at the
    last step, turning the result into frames."""
    pipe.enable_model_cpu_offload()


def _on_gpu(pipe) -> None:
    pipe.to("cuda")


def _decode_in_tiles(pipe) -> None:
    """Decode the video a tile at a time, where the decoder can: far less memory at once."""
    if hasattr(pipe.vae, "enable_tiling"):
        pipe.vae.enable_tiling()


def _in_half_precision(pipe, dtype) -> None:
    """Loaders have spelled the dtype argument two ways; whichever this one ignored, the
    large parts end up in `dtype`."""
    for name in ("transformer", "text_encoder"):
        part = getattr(pipe, name, None)
        if part is not None and getattr(part, "dtype", dtype) != dtype:
            part.to(dtype)


def write_scene(args: argparse.Namespace, seed: int) -> str:
    """The scene for the song, from the language model."""
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    with loading(args.model_dir, [SCENE_MODEL], f"{SCENE_MODEL_LABEL} to read the lyrics", 2):
        tokenizer = AutoTokenizer.from_pretrained(SCENE_MODEL)
        model = AutoModelForCausalLM.from_pretrained(
            SCENE_MODEL, torch_dtype=torch.bfloat16, device_map="auto"
        )
    emit("stage", pct=8, detail="Writing the scene from the lyrics")
    text = tokenizer.apply_chat_template(
        llm_messages(args.lyrics, args.title, args.artist),
        tokenize=False,
        add_generation_prompt=True,
        enable_thinking=False,
    )
    inputs = tokenizer([text], return_tensors="pt").to(model.device)
    torch.manual_seed(seed)
    with torch.no_grad():
        generated = model.generate(
            **inputs, max_new_tokens=220, do_sample=True, temperature=0.7, top_p=0.8, top_k=20
        )
    answer = tokenizer.decode(generated[0][inputs.input_ids.shape[1] :], skip_special_tokens=True)
    del model, inputs, generated
    _free_gpu()
    scene = clean_scene(answer)
    if not scene:
        raise RuntimeError("The language model wrote no scene for this song")
    return scene


def _step_reporter(label: str, total: int, start: float = 15.0, end: float = 90.0):
    def report(pipe, step: int, timestep, callback_kwargs: dict) -> dict:
        done = min(total, step + 1)
        pct = round(start + (end - start) * done / max(1, total), 1)
        emit("stage", pct=pct, detail=f"{label} drawing the loop (step {done} of {total})")
        return callback_kwargs

    return report


def draw_wan(args: argparse.Namespace, spec: dict, prompt: str, seed: int):
    import torch
    from diffusers import AutoencoderKLWan, WanPipeline

    repo = spec["repos"][0]
    with loading(args.model_dir, spec["repos"], spec["label"], 12):
        vae = AutoencoderKLWan.from_pretrained(repo, subfolder="vae", torch_dtype=torch.float32)
        pipe = WanPipeline.from_pretrained(repo, vae=vae, torch_dtype=torch.bfloat16)
        _in_half_precision(pipe, torch.bfloat16)
        pipe.set_progress_bar_config(disable=True)
        _take_turns(pipe)
        _decode_in_tiles(pipe)
    steps = spec["steps"]
    return pipe(
        prompt=prompt,
        negative_prompt=NEGATIVE_PROMPT,
        height=spec["height"],
        width=spec["width"],
        num_frames=spec["frames"],
        guidance_scale=spec["guidance"],
        num_inference_steps=steps,
        generator=torch.Generator().manual_seed(seed),
        callback_on_step_end=_step_reporter(spec["label"], steps),
    ).frames[0]


def draw_ltx(args: argparse.Namespace, spec: dict, prompt: str, seed: int):
    """The three passes the pipeline is documented with: draw small, double the size in
    latent space, then a few more steps on the larger frames."""
    import torch
    from diffusers import LTXConditionPipeline, LTXLatentUpsamplePipeline

    base_repo, upscaler_repo = spec["repos"]
    with loading(args.model_dir, spec["repos"], spec["label"], 12):
        pipe = LTXConditionPipeline.from_pretrained(base_repo, torch_dtype=torch.bfloat16)
        _in_half_precision(pipe, torch.bfloat16)
        upscale = LTXLatentUpsamplePipeline.from_pretrained(
            upscaler_repo, vae=pipe.vae, torch_dtype=torch.bfloat16
        )
        for part in (pipe, upscale):
            part.set_progress_bar_config(disable=True)
            _on_gpu(part)
        _decode_in_tiles(pipe)

    shared = {
        "prompt": prompt,
        "negative_prompt": LTX_NEGATIVE_PROMPT,
        "num_frames": spec["frames"],
        "frame_rate": spec["fps"],
        "decode_timestep": 0.05,
        "decode_noise_scale": 0.025,
        "image_cond_noise_scale": 0.0,
        "guidance_scale": 1.0,
        "guidance_rescale": 0.7,
    }
    first = [1000, 993, 987, 981, 975, 909, 725, 0.03]
    second = [1000, 909, 725, 421, 0]
    width, height = spec["base_width"], spec["base_height"]
    latents = pipe(
        **shared,
        width=width,
        height=height,
        timesteps=first,
        generator=torch.Generator().manual_seed(seed),
        output_type="latent",
        callback_on_step_end=_step_reporter(spec["label"], len(first), 15, 60),
    ).frames
    emit("stage", pct=62, detail=f"{spec['label']} enlarging the loop")
    larger = upscale(latents=latents, adain_factor=1.0, output_type="latent").frames
    frames = pipe(
        **shared,
        width=width * 2,
        height=height * 2,
        denoise_strength=0.999,
        timesteps=second,
        latents=larger,
        generator=torch.Generator().manual_seed(seed),
        output_type="pil",
        callback_on_step_end=_step_reporter(spec["label"], len(second) - 1, 65, 90),
    ).frames[0]
    return [frame.resize((spec["width"], spec["height"])) for frame in frames]


DRAW = {"wan22": draw_wan, "ltx": draw_ltx}


def make(args: argparse.Namespace) -> dict:
    """Write the scene, draw it, loop it; returns what result.json records."""
    args.out.mkdir(parents=True, exist_ok=True)
    spec = MODELS[args.model]
    seed = args.seed if args.seed is not None else random.SystemRandom().randrange(2**31)
    source = scene_source(args.lyrics, args.prompt)
    timings: dict[str, float] = {}

    started = time.monotonic()
    scene = clean_scene(args.prompt) if source == "typed" else write_scene(args, seed)
    timings["text"] = round(time.monotonic() - started, 1)

    started = time.monotonic()
    frames = DRAW[args.model](args, spec, video_prompt(scene), seed)
    timings["video"] = round(time.monotonic() - started, 1)
    _free_gpu()

    started = time.monotonic()
    emit("stage", pct=92, detail="Making the clip loop")
    clip = args.out / "clip.mp4"
    width, height = write_clip(frames, clip, spec["fps"])
    clip_seconds = len(frames) / spec["fps"]
    make_loop(clip, args.out / "loop.mp4", clip_seconds, args.fade, spec["fps"])
    if not args.keep_clip:
        clip.unlink(missing_ok=True)
    timings["loop"] = round(time.monotonic() - started, 1)

    result = {
        "prompt": scene,
        "written_from": source,
        "model": args.model,
        "model_label": spec["label"],
        "seed": seed,
        "width": width,
        "height": height,
        "fps": spec["fps"],
        "duration": round(clip_seconds - args.fade, 3),
        "seconds": timings,
    }
    (args.out / "result.json").write_text(json.dumps(result), encoding="utf-8")
    emit("stage", pct=100, detail="Song loop ready")
    return result


def _quiet_progress_bars() -> None:
    """Turn off the libraries' own progress bars (loading shards, denoising steps). They
    share stderr with this worker's events, would be read as the job's progress, and a bar
    left without a newline hides the event printed after it."""
    for package in ("diffusers", "transformers"):
        try:
            logging = __import__(f"{package}.utils.logging", fromlist=["disable_progress_bar"])
            logging.disable_progress_bar()
        except (ImportError, AttributeError):
            pass


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    args.model_dir.mkdir(parents=True, exist_ok=True)
    # Every model here comes from the Hugging Face hub, which keeps its files under HF_HOME
    os.environ["HF_HOME"] = str(args.model_dir)
    # The hub's and the pipelines' progress bars would be read as this job's progress
    os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
    # Lets PyTorch reuse the memory one model leaves behind for the next one's larger blocks
    os.environ.setdefault("PYTORCH_CUDA_ALLOC_CONF", "expandable_segments:True")

    try:
        import diffusers  # noqa: F401
        import torch  # noqa: F401
        import transformers  # noqa: F401
    except Exception as exc:  # ImportError, or a broken torch install raising OSError
        emit("error", code="import", detail=f"The video models could not be loaded: {exc}")
        return EXIT_IMPORT
    _quiet_progress_bars()

    try:
        make(args)
    except Exception as exc:
        traceback.print_exc(file=sys.stderr)
        emit("error", code="failed", detail=f"{type(exc).__name__}: {exc}")
        return EXIT_FAILED
    return EXIT_OK


if __name__ == "__main__":
    sys.exit(main())
