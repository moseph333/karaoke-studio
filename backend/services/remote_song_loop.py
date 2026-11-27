"""Song loops on a cloud GPU (SONG_LOOP_REMOTE=modal).

The Modal function `song_loop` in gpu/modal_app.py runs backend.workers.song_loop_worker: a
language model writes a scene from the song's lyrics (unless one was typed), a video model
draws it, and the clip is made to loop. The worker's stderr comes back through modal_jobs
for the progress parsing separation uses, and the loop comes back as the call's return value
with what it was made from.

There is no local way to make a loop: the models need a large GPU and packages this server
does not install, so with SONG_LOOP_REMOTE unset the studio says the server cannot make them.
"""

import os
from collections.abc import Callable
from pathlib import Path
from typing import Any

from backend import server_settings
from backend.services.modal_jobs import RemoteUnavailable, run_modal_job
from backend.services.process_watchdog import duration_text
from backend.services.separation_presets import remote_status
from backend.services.separation_progress import ProgressTracker

FUNCTION_NAME = "song_loop"
REMOTE_BACKENDS = ("modal",)
# What the function returns besides the video (same keys in gpu/modal_app.py and the worker)
RESULT_KEYS = ("prompt", "written_from", "model", "model_label", "seed", "gpu", "seconds")

__all__ = ["RemoteUnavailable", "SongLoopCancelled", "backend", "make", "status"]

ProgressCallback = Callable[[float | None, str, int | None], None]


class SongLoopCancelled(RuntimeError):
    """The user cancelled while the loop was being made."""


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def backend() -> str | None:
    """SONG_LOOP_REMOTE: "modal" makes song loops on a cloud GPU; unset, none are made."""
    value = (server_settings.env("SONG_LOOP_REMOTE") or "").strip().lower()
    return value if value in REMOTE_BACKENDS else None


def status() -> tuple[bool, str | None]:
    """Whether a loop can be made, and if not, why (checked offline, like the cloud GPU for
    separation: the setting, the modal package and the credentials)."""
    if backend() is None:
        return False, "it has no cloud GPU set up for them (SONG_LOOP_REMOTE)"
    return remote_status()


def queue_seconds() -> float:
    """How long a loop may wait for a cloud GPU before the job gives up."""
    return _env_float("SONG_LOOP_REMOTE_QUEUE_SEC", 300.0)


def timeout_seconds() -> float:
    return _env_float("SONG_LOOP_TIMEOUT_SEC", 2400.0)


def stall_seconds() -> float:
    return _env_float("SONG_LOOP_STALL_SEC", 300.0)


def make(
    request: dict[str, Any],
    output_path: Path,
    on_progress: ProgressCallback,
    cancel_event: Any | None,
) -> dict[str, Any]:
    """Make one loop on the cloud GPU and write it to output_path. ``request`` holds the
    function's arguments (lyrics, title, artist, prompt, model). on_progress gets a
    percentage (None while waiting), a sentence and seconds left (always None: the models
    report steps, not time). Returns what the function said of the loop (RESULT_KEYS).

    Raises SongLoopCancelled on cancel, RemoteUnavailable when the service cannot take the
    job, and RuntimeError when the loop could not be made.
    """
    tracker = ProgressTracker(engine_label="Song loop")

    def on_line(line: str) -> None:
        update = tracker.feed(line)
        if update is not None:
            on_progress(*update)

    on_progress(None, "Waiting for a cloud GPU…", None)
    outcome, result = run_modal_job(
        FUNCTION_NAME,
        {key: value for key, value in request.items() if value not in (None, "")},
        on_line,
        cancel_event,
        timeout_s=timeout_seconds(),
        stall_s=stall_seconds(),
        queue_s=queue_seconds(),
        on_started=lambda: on_progress(None, "A cloud GPU is making the loop…", None),
        on_waiting=lambda waited: on_progress(
            None, f"Waiting for a cloud GPU… {waited:.0f} s", None
        ),
        resource="GPU",
        queue_setting="SONG_LOOP_REMOTE_QUEUE_SEC",
    )
    if (cancel_event is not None and cancel_event.is_set()) or outcome.reason == "cancelled":
        raise SongLoopCancelled("The song loop was cancelled")
    if outcome.reason == "timeout" and outcome.remote_limit:
        raise RuntimeError(
            "The cloud GPU stopped the loop at its own time limit "
            "(SONG_LOOP_REMOTE_TIMEOUT_SEC when gpu/modal_app.py was deployed)"
        )
    if outcome.reason == "timeout":
        raise RuntimeError(
            f"The loop was stopped after {duration_text(timeout_seconds())} (SONG_LOOP_TIMEOUT_SEC)"
        )
    if outcome.reason == "stalled":
        raise RuntimeError(
            f"The loop was stopped: no output for {duration_text(stall_seconds())} "
            "(SONG_LOOP_STALL_SEC)"
        )
    video = (result or {}).get("video")
    if outcome.returncode != 0 or not video:
        why = tracker.error_detail or (tracker.tail[-1] if tracker.tail else "")
        raise RuntimeError(
            f"The cloud GPU could not make the loop (exit {outcome.returncode})"
            + (f": {why}" if why else "")
        )
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(video)
    return {key: result[key] for key in RESULT_KEYS if key in result}
