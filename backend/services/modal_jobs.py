"""Jobs on the deployed Modal app (gpu/modal_app.py), followed through an ephemeral queue.

Shared by remote_separation (RoFormer on a GPU) and remote_render (video export on a CPU).
The function is spawned rather than awaited so the job can be cancelled. It puts STARTED on
the queue once it runs, then its own output lines; the result comes back as the call's
return value. RemoteUnavailable means the service could not be reached or nothing started
the job in time, so the caller should fall back to running locally.
"""

import logging
import queue
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from backend.services.process_watchdog import duration_text
from backend.services.separation_presets import remote_app_name

logger = logging.getLogger(__name__)

# First item a Modal function puts on the queue once it runs (same value in gpu/modal_app.py)
STARTED = "\x00karaoke-gpu-started"
_POLL_SECONDS = 1.0
_BATCH = 500
_WAITING_REPORT_SECONDS = 5.0


class RemoteUnavailable(RuntimeError):
    """The cloud service cannot take the job: not deployed, bad credentials, or nothing free."""


@dataclass
class RemoteOutcome:
    returncode: int | None
    reason: str | None = None  # "cancelled", "timeout" or "stalled" when the job was stopped


def _cancel(call: Any) -> None:
    try:
        call.cancel()
    except Exception as exc:  # the call may already be over; nothing more to do
        logger.warning(f"Could not cancel the cloud job: {exc}")


def run_modal_job(
    function_name: str,
    kwargs: dict[str, Any],
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    *,
    timeout_s: float,
    stall_s: float,
    queue_s: float,
    on_started: Callable[[], None] | None = None,
    on_waiting: Callable[[float], None] | None = None,
    resource: str = "GPU",
    queue_setting: str = "SEPARATION_REMOTE_QUEUE_SEC",
) -> tuple[RemoteOutcome, dict | None]:
    """Spawn function_name(**kwargs, lines=queue) and follow it until it ends.

    on_line receives each line the function puts on the queue; on_started fires once it
    runs, and until then on_waiting gets the seconds waited so far, about every 5 seconds.
    Returns the outcome and, when the function returned a dict, that dict (also on a
    non-zero returncode). Any exception while following, including one raised by on_line,
    cancels the remote call before it propagates.
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
    try:
        function = modal.Function.from_name(remote_app_name(), function_name)
        with modal.Queue.ephemeral() as lines:
            call = function.spawn(**kwargs, lines=lines)
            try:
                return _follow(
                    call,
                    lines,
                    on_line,
                    cancel_event,
                    timeout_s=timeout_s,
                    stall_s=stall_s,
                    queue_s=queue_s,
                    on_started=on_started,
                    on_waiting=on_waiting,
                    job_timeout=modal_errors.FunctionTimeoutError,
                    unavailable=unavailable,
                    resource=resource,
                    queue_setting=queue_setting,
                )
            except BaseException:
                _cancel(call)
                raise
    except unavailable as exc:
        raise RemoteUnavailable(
            f"the cloud {resource} is unavailable ({type(exc).__name__}: {exc})"
        ) from exc


def _follow(
    call: Any,
    lines: Any,
    on_line: Callable[[str], None],
    cancel_event: Any | None,
    *,
    timeout_s: float,
    stall_s: float,
    queue_s: float,
    on_started: Callable[[], None] | None,
    on_waiting: Callable[[float], None] | None,
    job_timeout: type[BaseException],
    unavailable: tuple[type[BaseException], ...],
    resource: str,
    queue_setting: str,
) -> tuple[RemoteOutcome, dict | None]:
    started_at = time.monotonic()
    last_output = started_at
    last_waiting_report = started_at
    running = False

    def deliver(items: list) -> None:
        nonlocal running, last_output
        for item in items:
            if item == STARTED:
                running = True
                waited = time.monotonic() - started_at
                logger.info(f"The cloud {resource} job started after {waited:.0f} s in the queue")
                if on_started:
                    on_started()
            else:
                on_line(str(item))
            last_output = time.monotonic()

    while True:
        if cancel_event is not None and cancel_event.is_set():
            _cancel(call)
            return RemoteOutcome(None, "cancelled"), None
        now = time.monotonic()
        if not running and now - started_at > queue_s:
            _cancel(call)
            raise RemoteUnavailable(
                f"no cloud {resource} started the job within {duration_text(queue_s)} "
                f"({queue_setting})"
            )
        if not running and on_waiting and now - last_waiting_report >= _WAITING_REPORT_SECONDS:
            last_waiting_report = now
            on_waiting(now - started_at)
        if now - started_at > timeout_s:
            _cancel(call)
            return RemoteOutcome(None, "timeout"), None
        if running and now - last_output > stall_s:
            _cancel(call)
            return RemoteOutcome(None, "stalled"), None

        try:
            deliver(lines.get_many(_BATCH, timeout=_POLL_SECONDS))
        except queue.Empty:
            pass
        try:
            result = call.get(timeout=0)
        except job_timeout:  # the function hit its own time limit
            return RemoteOutcome(None, "timeout"), None
        except TimeoutError:  # still running
            continue
        except unavailable:
            raise
        except Exception as exc:  # the function itself raised
            on_line(f"The cloud {resource} job failed: {type(exc).__name__}: {exc}")
            return RemoteOutcome(1), None

        # Finished: collect the last lines before the queue goes away
        while items := lines.get_many(_BATCH, block=False):
            deliver(items)
        if not isinstance(result, dict):
            on_line(f"The cloud {resource} job returned nothing usable")
            return RemoteOutcome(1), None
        return RemoteOutcome(int(result.get("returncode", 1))), result
