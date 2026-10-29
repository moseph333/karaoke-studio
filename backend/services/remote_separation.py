"""Balanced and Best on a cloud GPU (SEPARATION_REMOTE=modal).

The Modal function deployed from gpu/modal_app.py runs backend.workers.roformer_worker
unchanged on a GPU. Its stderr comes back line by line through an ephemeral Modal Queue, so
separation_progress.ProgressTracker reads the same text as for a local run, and the two stems
come back as the call's return value. The call is spawned rather than awaited so that it can
be cancelled. When the service cannot be reached, or no GPU starts the job within
SEPARATION_REMOTE_QUEUE_SEC, RemoteUnavailable tells the separator to skip the other cloud
presets and fall back to Fast here.
"""

import logging
import queue
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.services.process_watchdog import duration_text
from backend.services.separation_presets import SeparationPlan, remote_app_name

logger = logging.getLogger(__name__)

FUNCTION_NAME = "separate"
# First item the GPU function puts on the queue once it runs (same value in gpu/modal_app.py)
STARTED = "\x00karaoke-gpu-started"
_POLL_SECONDS = 1.0
_BATCH = 500


class RemoteUnavailable(RuntimeError):
    """The cloud GPU cannot take the job: not deployed, bad credentials, or no GPU in time."""


@dataclass
class RemoteOutcome:
    returncode: int | None
    reason: str | None = None  # "cancelled", "timeout" or "stalled" when the job was stopped


def _cancel(call: Any) -> None:
    try:
        call.cancel()
    except Exception as exc:  # the call may already be over; nothing more to do
        logger.warning(f"Could not cancel the cloud GPU job: {exc}")


def _save_stems(result: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for key, name in (("vocals", "vocals.wav"), ("no_vocals", "no_vocals.wav")):
        data = result.get(key)
        if data:
            (out_dir / name).write_bytes(data)


def run_remote(
    plan: SeparationPlan,
    audio_file: Path,
    out_dir: Path,
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    *,
    timeout_s: float,
    stall_s: float,
    queue_s: float,
    on_started: Callable[[], None] | None = None,
) -> RemoteOutcome:
    """Separate audio_file with plan on the cloud GPU into out_dir/vocals.wav and
    out_dir/no_vocals.wav, as the local worker would.

    on_line receives every line the worker writes to stderr and on_started fires once a GPU
    picks the job up. Raises RemoteUnavailable when the service cannot be reached or no GPU
    starts the job within queue_s.
    """
    try:
        import modal
        from modal import exception as modal_errors
    except ImportError as exc:
        raise RemoteUnavailable("the modal package is not installed") from exc

    unavailable = (
        modal_errors.NotFoundError,
        modal_errors.AuthError,
        modal_errors.ConnectionError,
        modal_errors.InternalFailure,
    )
    audio = audio_file.read_bytes()
    try:
        function = modal.Function.from_name(remote_app_name(), FUNCTION_NAME)
        with modal.Queue.ephemeral() as lines:
            call = function.spawn(
                audio=audio,
                filename=audio_file.name,
                models=list(plan.models),
                overlap=int(plan.params.get("overlap", 2)),
                ensemble=str(plan.params.get("ensemble", "avg_wave")),
                lines=lines,
            )
            return _follow(
                call,
                lines,
                out_dir,
                on_line,
                cancel_event,
                timeout_s=timeout_s,
                stall_s=stall_s,
                queue_s=queue_s,
                on_started=on_started,
                job_timeout=modal_errors.FunctionTimeoutError,
                unavailable=unavailable,
            )
    except unavailable as exc:
        raise RemoteUnavailable(
            f"the cloud GPU is unavailable ({type(exc).__name__}: {exc})"
        ) from exc


def _follow(
    call: Any,
    lines: Any,
    out_dir: Path,
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    *,
    timeout_s: float,
    stall_s: float,
    queue_s: float,
    on_started: Callable[[], None] | None,
    job_timeout: type[BaseException],
    unavailable: tuple[type[BaseException], ...],
) -> RemoteOutcome:
    started_at = time.monotonic()
    last_output = started_at
    running = False

    def deliver(items: list) -> None:
        nonlocal running, last_output
        for item in items:
            if item == STARTED:
                running = True
                if on_started:
                    on_started()
            else:
                on_line(str(item))
            last_output = time.monotonic()

    while True:
        if cancel_event is not None and cancel_event.is_set():
            _cancel(call)
            return RemoteOutcome(None, "cancelled")
        now = time.monotonic()
        if not running and now - started_at > queue_s:
            _cancel(call)
            raise RemoteUnavailable(
                f"no cloud GPU started the job within {duration_text(queue_s)} "
                "(SEPARATION_REMOTE_QUEUE_SEC)"
            )
        if now - started_at > timeout_s:
            _cancel(call)
            return RemoteOutcome(None, "timeout")
        if running and now - last_output > stall_s:
            _cancel(call)
            return RemoteOutcome(None, "stalled")

        try:
            deliver(lines.get_many(_BATCH, timeout=_POLL_SECONDS))
        except queue.Empty:
            pass
        try:
            result = call.get(timeout=0)
        except job_timeout:  # the GPU function hit its own time limit
            return RemoteOutcome(None, "timeout")
        except TimeoutError:  # still running
            continue
        except unavailable:
            raise
        except Exception as exc:  # the GPU function itself raised
            on_line(f"The cloud GPU job failed: {type(exc).__name__}: {exc}")
            return RemoteOutcome(1)

        # Finished: collect the last lines before the queue goes away
        while items := lines.get_many(_BATCH, block=False):
            deliver(items)
        if not isinstance(result, dict):
            on_line("The cloud GPU job returned no stems")
            return RemoteOutcome(1)
        returncode = int(result.get("returncode", 1))
        gpu = result.get("gpu") or "an unknown GPU"
        logger.info(
            f"Cloud GPU job on {gpu} finished with exit {returncode} "
            f"after {time.monotonic() - started_at:.0f}s"
        )
        if returncode == 0:
            _save_stems(result, out_dir)
        return RemoteOutcome(returncode)
