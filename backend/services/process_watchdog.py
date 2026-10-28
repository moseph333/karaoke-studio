"""Watchdog thread for long-running ML worker processes (stem separation, neural alignment)."""

import logging
import os
import threading
import time
from pathlib import Path

logger = logging.getLogger(__name__)

KILL_GRACE_SECONDS = 10.0
PROJECT_ROOT = Path(__file__).resolve().parents[2]


def quietly(action) -> None:
    try:
        action()
    except Exception:
        pass


class ProcessWatchdog(threading.Thread):
    """Stops a child process on cancel, overall timeout or a long output stall.

    It only terminates the child (and kills it if it ignores that); the reading loop then sees
    end-of-file, and the caller's cleanup owns waiting for the exit status. ``reason`` tells
    the caller why it stepped in ("cancelled", "timeout" or "stalled").
    """

    def __init__(self, process, cancel_event, timeout_s: float, stall_s: float, label: str):
        super().__init__(name=f"{label}-watchdog", daemon=True)
        self.process = process
        self.cancel_event = cancel_event
        self.timeout_s = timeout_s
        self.stall_s = stall_s
        self.label = label
        self.interval = 0.2
        self.started = time.monotonic()
        self.last_output = self.started
        self.reason: str | None = None
        self._halt = threading.Event()

    def touch(self) -> None:
        self.last_output = time.monotonic()

    def halt(self) -> None:
        self._halt.set()

    def _due(self) -> str | None:
        if self.cancel_event is not None and self.cancel_event.is_set():
            return "cancelled"
        now = time.monotonic()
        if now - self.started > self.timeout_s:
            return "timeout"
        if now - self.last_output > self.stall_s:
            return "stalled"
        return None

    def run(self) -> None:
        while not self._halt.wait(self.interval):
            reason = self._due()
            if reason is None:
                continue
            self.reason = reason
            logger.warning(f"Stopping {self.label} process ({reason})")
            quietly(self.process.terminate)
            if not self._halt.wait(KILL_GRACE_SECONDS):
                quietly(self.process.kill)
            return


def duration_text(seconds: float) -> str:
    if seconds < 120:
        return f"{seconds:g} seconds"
    if seconds < 7200:
        return f"{seconds / 60:.0f} minutes"
    return f"{seconds / 3600:g} hours"


def worker_env() -> dict[str, str]:
    """Environment for `python -m backend.workers...`, whatever the server's working dir."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (str(PROJECT_ROOT), env.get("PYTHONPATH", "")) if p
    )
    return env
