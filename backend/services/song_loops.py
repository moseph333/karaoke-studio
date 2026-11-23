"""A song's loop: the looping background video made from its lyrics.

The loop is one file beside the song's renders, OUTPUT_DIR/<project id>_loop.mp4, so it is
deleted with the song like they are, and ``song_loop`` on the project says what it shows and
how it was made (the scene text, the model, the seed, its size and length, and its URL). A
song has one loop: making it again replaces the file. The file is what a render draws, so a
record whose file is gone counts as no loop (current_file).

backend.song_loop is the job that makes one; the video itself comes from the cloud GPU
(backend.services.remote_song_loop).
"""

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from backend.config import OUTPUT_DIR
from backend.services import remote_song_loop
from backend.upload_utils import MAX_BACKGROUND_UPLOAD_BYTES
from backend.workers.song_loop_worker import DEFAULT_MODEL, MAX_SCENE_CHARS, MODELS

SONG_LOOP = "song_loop"
# The stage style, and a render's background_style, that shows the song's loop
STYLE = "loop"
LOOP_SUFFIX = "_loop.mp4"
# Swept at startup with the unfinished videos of renders (render_worker.PART_FILE_GLOB)
PART_SUFFIX = "_loop.part.mp4"
MAX_PROMPT_CHARS = MAX_SCENE_CHARS
# A cloud render is sent its background whole, as an uploaded video is
MAX_LOOP_BYTES = MAX_BACKGROUND_UPLOAD_BYTES
_MIN_SIDE, _MAX_SIDE = 64, 4096
_MIN_SECONDS, _MAX_SECONDS = 1.0, 120.0
_PROBE_TIMEOUT_SECONDS = 30


def _output_dir() -> Path:
    import backend.main as main_mod

    return Path(getattr(main_mod, "OUTPUT_DIR", OUTPUT_DIR))


def loop_path(project_id: str) -> Path:
    return _output_dir() / f"{Path(project_id).name}{LOOP_SUFFIX}"


def part_path(project_id: str) -> Path:
    """Where a loop is written until it is complete and checked."""
    return _output_dir() / f"{Path(project_id).name}{PART_SUFFIX}"


def current_file(proj: dict) -> Path | None:
    """The song's loop on disk, or None when it has none (or its file is gone)."""
    if not isinstance(proj.get(SONG_LOOP), dict) or not proj.get("id"):
        return None
    path = loop_path(proj["id"])
    try:
        return path if path.is_file() and path.stat().st_size > 0 else None
    except OSError:
        return None


def lyrics_text(proj: dict) -> str:
    """The song's lyric lines as plain text, one per line."""
    lines = proj.get("lines")
    if not isinstance(lines, list):
        return ""
    texts = (line.get("text") for line in lines if isinstance(line, dict))
    return "\n".join(text.strip() for text in texts if isinstance(text, str) and text.strip())


def configured_model() -> str:
    """SONG_LOOP_MODEL: the video model loops are made with (the worker's default if unset
    or unknown)."""
    value = (os.getenv("SONG_LOOP_MODEL") or "").strip().lower()
    return value if value in MODELS else DEFAULT_MODEL


def capability() -> dict[str, Any]:
    """Whether this server can make song loops, for GET /api/capabilities."""
    ready, reason = remote_song_loop.status()
    model = configured_model()
    return {
        "available": ready,
        "reason": reason,
        "runs_on": "cloud-gpu" if remote_song_loop.backend() else None,
        "model": model,
        "model_label": MODELS[model]["label"],
        "max_prompt_chars": MAX_PROMPT_CHARS,
    }


def probe_video(path: Path) -> dict[str, float]:
    """Width, height and length of a video file's first video stream, read by ffprobe."""
    cmd = ["ffprobe", "-v", "error", "-select_streams", "v:0"]
    cmd += ["-show_entries", "stream=width,height:format=duration", "-of", "json", str(path)]
    try:
        done = subprocess.run(cmd, capture_output=True, timeout=_PROBE_TIMEOUT_SECONDS)
        data = json.loads(done.stdout or b"{}")
        stream = data["streams"][0]
        return {
            "width": int(stream["width"]),
            "height": int(stream["height"]),
            "duration": float(data["format"]["duration"]),
        }
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, IndexError, TypeError):
        raise RuntimeError("The loop that came back is not a video") from None


def check_video(path: Path) -> dict[str, float]:
    """What probe_video says of a loop that arrived, once it is something a render can take:
    a video of a sane size and length, no larger than an uploaded background may be."""
    size = path.stat().st_size if path.is_file() else 0
    if size == 0:
        raise RuntimeError("The loop that came back is empty")
    if size > MAX_LOOP_BYTES:
        raise RuntimeError(
            f"The loop that came back is too large ({size / 1e6:.0f} MB; "
            f"the limit is {MAX_LOOP_BYTES / 1e6:.0f} MB)"
        )
    info = probe_video(path)
    sides_ok = all(_MIN_SIDE <= info[side] <= _MAX_SIDE for side in ("width", "height"))
    if not sides_ok or not _MIN_SECONDS <= info["duration"] <= _MAX_SECONDS:
        raise RuntimeError(
            f"The loop that came back is {info['width']}x{info['height']} and "
            f"{info['duration']:.1f} s long, which cannot be a song loop"
        )
    return info


def install(proj: dict, staged: Path, info: dict[str, float], made: dict[str, Any]) -> dict:
    """Moves a finished loop into place and records it on the project (a new dict, so
    restore_on_failed_save's shallow copies stay valid). ``made`` is what the worker said of
    it. Call with PROJECTS_LOCK held; returns the record."""
    target = loop_path(proj["id"])
    os.replace(staged, target)
    stamp = target.stat().st_mtime_ns // 1_000_000
    model = str(made.get("model") or configured_model())
    record = {
        "url": f"/static/output/{target.name}?v={stamp}",
        "prompt": str(made.get("prompt") or "")[:MAX_PROMPT_CHARS],
        "written_from": made.get("written_from") or "typed",
        "model": model,
        "model_label": made.get("model_label") or MODELS.get(model, {}).get("label") or model,
        "seed": made.get("seed"),
        "width": info["width"],
        "height": info["height"],
        "duration": round(info["duration"], 3),
        "created_at": int(time.time()),
    }
    proj[SONG_LOOP] = record
    return record


def remove_file(project_id: str) -> None:
    try:
        loop_path(project_id).unlink(missing_ok=True)
    except OSError:
        pass
