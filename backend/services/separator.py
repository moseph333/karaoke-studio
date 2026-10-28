"""AI stem separation: isolates the vocals and the instrumental of a song.

Engines (see separation_presets): Demucs (`python -m demucs`) for the Fast preset, and RoFormer
models through backend.workers.roformer_worker for Balanced and Best. Each runs as a child
process whose stderr is parsed for progress, while a watchdog thread stops it on cancel, on
the overall timeout or after a long silence. When a preset cannot run, or fails, the next
cheaper one is tried (best -> balanced -> fast) and the reason is recorded in the returned
provenance.
"""

import logging
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

from backend.config import STEMS_DIR
from backend.services.separation_presets import (
    SeparationPlan,
    demucs_supports_quality_flags,
    downloads_allowed,
    estimate_cpu_seconds,
    fallback_chain,
    model_dir,
    model_label,
    plan_status,
    resolve_plan,
    separation_stall_seconds,
    separation_timeout_seconds,
)
from backend.services.separation_progress import ProgressTracker

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROFORMER_WORK_DIR = "roformer"
KILL_GRACE_SECONDS = 10.0
_REASON_CHARS = 300


class SeparationCancelled(RuntimeError):
    """The user cancelled while separation was running."""


def _quietly(action) -> None:
    try:
        action()
    except Exception:
        pass


class _Watchdog(threading.Thread):
    """Stops a separation process on cancel, overall timeout or a long output stall.

    It only terminates the child (and kills it if it ignores that); the reading loop then sees
    end-of-file, and the caller's cleanup owns waiting for the exit status.
    """

    def __init__(self, process, cancel_event, timeout_s: float, stall_s: float):
        super().__init__(name="separation-watchdog", daemon=True)
        self.process = process
        self.cancel_event = cancel_event
        self.timeout_s = timeout_s
        self.stall_s = stall_s
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
            logger.warning(f"Stopping stem separation process ({reason})")
            _quietly(self.process.terminate)
            if not self._halt.wait(KILL_GRACE_SECONDS):
                _quietly(self.process.kill)
            return


class _ProgressReporter:
    """Forwards progress updates, dropping exact repeats that arrive in quick succession."""

    def __init__(self, callback, min_interval: float = 1.0):
        self.callback = callback
        self.min_interval = min_interval
        self.last: tuple[float | None, str] | None = None
        self.last_time = 0.0

    def __call__(self, pct: float | None, detail: str, eta: int | None) -> None:
        if not self.callback:
            return
        now = time.monotonic()
        if (pct, detail) == self.last and now - self.last_time < self.min_interval:
            return
        self.last, self.last_time = (pct, detail), now
        self.callback(pct, detail, eta)


def _engine_name(plan: SeparationPlan) -> str:
    return "Demucs" if plan.engine == "demucs" else "RoFormer separation"


def _failure_hint(plan: SeparationPlan, returncode: Any, text: str) -> str | None:
    lower = text.lower()
    code = returncode if isinstance(returncode, int) else None
    if code in (137, -9) or any(
        s in lower for s in ("out of memory", "memoryerror", "cannot allocate memory")
    ):
        if plan.engine == "demucs":
            return "it ran out of memory. Close other heavy jobs or give the server more RAM"
        return "it ran out of memory. Try the Fast preset or give the server more RAM"
    if "no space left on device" in lower:
        return "the disk is full. Free up space in the data folder and try again"
    if plan.engine == "roformer" and code == 3:
        return "the model weights are not downloaded and automatic download is disabled"
    if (plan.engine == "roformer" and code == 4) or "no module named" in lower:
        return "a required package is not installed"
    if code is not None and code < 0:
        return f"the process was stopped by signal {-code}"
    return None


def _duration_text(seconds: float) -> str:
    if seconds < 120:
        return f"{seconds:g} seconds"
    if seconds < 7200:
        return f"{seconds / 60:.0f} minutes"
    return f"{seconds / 3600:g} hours"


def _failure_message(
    plan: SeparationPlan, returncode: Any, tracker: ProgressTracker, reason: str | None = None
) -> str:
    lines = [line for line in tracker.tail if line != tracker.error_detail]
    text = "\n".join([*lines, tracker.error_detail or ""])
    name = _engine_name(plan)
    if reason == "timeout":
        head = (
            f"{name} failed: stopped after {_duration_text(separation_timeout_seconds())} "
            "(SEPARATION_TIMEOUT_SEC)"
        )
    elif reason == "stalled":
        head = (
            f"{name} failed: no output for {_duration_text(separation_stall_seconds())} "
            "(SEPARATION_STALL_SEC)"
        )
    else:
        # Lead with the most useful sentence: a known cause, the worker's own error, or
        # the engine's last words
        summary = _failure_hint(plan, returncode, text) or tracker.error_detail
        if not summary and lines:
            summary = lines.pop()
        head = f"{name} failed (exit {returncode})" + (f": {summary}" if summary else "")
    return "\n".join([head, *lines])


def _short_reason(plan: SeparationPlan, detail: str) -> str:
    first = detail.strip().splitlines()[0] if detail.strip() else "unavailable"
    if len(first) > _REASON_CHARS:
        first = first[:_REASON_CHARS] + "…"
    return f"{plan.label}: {first}"


def _worker_env() -> dict[str, str]:
    """Environment for `python -m backend.workers...`, whatever the server's working dir."""
    env = dict(os.environ)
    env["PYTHONPATH"] = os.pathsep.join(
        p for p in (str(PROJECT_ROOT), env.get("PYTHONPATH", "")) if p
    )
    return env


class AudioSeparator:
    def __init__(self, output_base_dir: Path = STEMS_DIR):
        self.output_base_dir = output_base_dir
        self.output_base_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _is_valid_stem(stem_path: Path) -> bool:
        """Verify that a stem file exists, is a regular file, and contains audio data."""
        try:
            return stem_path.is_file() and stem_path.stat().st_size > 44
        except OSError:
            return False

    @staticmethod
    def _purge_work_dirs(target_dir: Path) -> None:
        """Remove engine scratch folders; only the two standard stems live in target_dir."""
        try:
            children = list(target_dir.iterdir())
        except OSError:
            return
        for child in children:
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)

    def separate_stems(
        self,
        audio_path: str,
        track_id: str,
        model_name: str = "htdemucs",
        duration: float | None = None,
        progress_callback: Any | None = None,
        cancel_event: Any | None = None,
    ) -> dict[str, Any]:
        """Separate a song into vocals.wav and instrumental.wav under output_base_dir/track_id.

        model_name is a preset id (fast | balanced | best) or a Demucs model name such as
        "htdemucs". Returns the stem paths plus, when an engine ran, a "separation" dict
        describing what produced them. Valid cached stems are reused without running anything.
        Raises SeparationCancelled (a RuntimeError) on cancel and RuntimeError on failure.
        """
        if not audio_path or not str(audio_path).strip():
            raise ValueError("Input audio path cannot be empty")

        audio_file = Path(audio_path)
        if not audio_file.exists():
            raise FileNotFoundError(f"Input audio file not found: {audio_path}")
        if not audio_file.is_file() or audio_file.stat().st_size == 0:
            raise ValueError(f"Input audio file is empty (0 bytes): {audio_path}")

        target_dir = self.output_base_dir / track_id
        target_dir.mkdir(parents=True, exist_ok=True)

        vocals_target = target_dir / "vocals.wav"
        instrumental_target = target_dir / "instrumental.wav"

        # Check for valid cached stems
        if self._is_valid_stem(vocals_target) and self._is_valid_stem(instrumental_target):
            logger.info(f"Stems already exist and valid for track {track_id}")
            if progress_callback:
                progress_callback(100.0, "Found cached vocal stems", 0)
            return {
                "vocals_path": str(vocals_target),
                "instrumental_path": str(instrumental_target),
            }

        # Purge any 0-byte or corrupt leftovers before separation
        if vocals_target.exists() and not self._is_valid_stem(vocals_target):
            vocals_target.unlink(missing_ok=True)
        if instrumental_target.exists() and not self._is_valid_stem(instrumental_target):
            instrumental_target.unlink(missing_ok=True)

        requested = resolve_plan(model_name)
        chain = fallback_chain(requested)
        reasons: list[str] = []
        started = time.monotonic()
        report = _ProgressReporter(progress_callback)

        for plan in chain:
            if cancel_event is not None and cancel_event.is_set():
                raise SeparationCancelled("Stem separation cancelled by user")
            is_last = plan is chain[-1]
            ready, why = plan_status(plan)
            if not ready:
                logger.info(f"Skipping {plan.label} for {track_id}: {why}")
                reasons.append(_short_reason(plan, why or "unavailable"))
                if is_last:
                    raise RuntimeError(f"No separation engine can run: {'; '.join(reasons)}")
                continue

            self._purge_work_dirs(target_dir)
            eta = estimate_cpu_seconds(plan.preset, duration) if duration else None
            if reasons:
                report(5.0, f"Using {plan.label} instead", eta)
            elif plan.engine == "demucs":
                report(5.0, "Initializing Demucs AI neural network...", eta)
            else:
                report(5.0, f"Starting {plan.label}…", eta)
            logger.info(f"Separating {audio_file.name} for {track_id} with {plan.label}")

            try:
                self._run_plan(plan, audio_file, target_dir, report, cancel_event)
                found_vocals, found_instrumental = self._find_outputs(
                    target_dir, vocals_target, instrumental_target
                )
            except SeparationCancelled:
                self._purge_work_dirs(target_dir)
                raise
            except (RuntimeError, OSError) as exc:
                self._purge_work_dirs(target_dir)
                if (cancel_event is not None and cancel_event.is_set()) or is_last:
                    raise
                logger.warning(f"{plan.label} failed for {track_id}; falling back: {exc}")
                reasons.append(_short_reason(plan, str(exc)))
                continue
            break
        else:  # every plan was skipped or failed without raising (not expected)
            raise RuntimeError(f"Stem separation failed: {'; '.join(reasons)}")

        # Move the stems to their standard paths directly under track_id
        os.replace(found_vocals, vocals_target)
        os.replace(found_instrumental, instrumental_target)
        self._purge_work_dirs(target_dir)

        if not self._is_valid_stem(vocals_target) or not self._is_valid_stem(instrumental_target):
            raise RuntimeError("Separated stem output files are invalid or empty")

        elapsed = time.monotonic() - started
        logger.info(f"Separated {track_id} with {plan.label} in {elapsed:.0f}s")
        return {
            "vocals_path": str(vocals_target),
            "instrumental_path": str(instrumental_target),
            "separation": {
                "preset": plan.preset,
                "engine": plan.engine,
                "models": list(plan.models),
                "label": plan.label,
                "requested": requested.preset,
                "fallback_reason": "; ".join(reasons) or None,
                "elapsed_seconds": round(elapsed, 1),
                "separated_at": int(time.time()),
            },
        }

    @staticmethod
    def _find_outputs(
        target_dir: Path, vocals_target: Path, instrumental_target: Path
    ) -> tuple[Path, Path]:
        """The engine's vocals.wav / no_vocals.wav, wherever under target_dir it wrote them."""
        found_vocals = next((p for p in target_dir.rglob("vocals.wav") if p != vocals_target), None)
        found_instrumental = next(
            (p for p in target_dir.rglob("no_vocals.wav") if p != instrumental_target), None
        )
        if not found_vocals or not found_instrumental:
            raise RuntimeError(f"Could not locate separated stem outputs in {target_dir}")
        return found_vocals, found_instrumental

    def _command(self, plan: SeparationPlan, audio_file: Path, target_dir: Path) -> list[str]:
        if plan.engine == "demucs":
            cmd = [sys.executable, "-u", "-m", "demucs", "--two-stems=vocals", "-n", plan.models[0]]
            if demucs_supports_quality_flags():
                cmd += [
                    "--shifts",
                    str(plan.params.get("shifts", 1)),
                    "--overlap",
                    str(plan.params.get("overlap", 0.25)),
                    "--int24",
                    # Clip the rare overs instead of rescaling each stem by a different amount
                    "--clip-mode",
                    "clamp",
                ]
            return [*cmd, "-o", str(target_dir), str(audio_file)]

        cmd = [
            sys.executable,
            "-u",
            "-m",
            "backend.workers.roformer_worker",
            "--audio",
            str(audio_file.resolve()),
            "--out",
            str((target_dir / ROFORMER_WORK_DIR).resolve()),
            "--models",
            *plan.models,
            "--overlap",
            str(plan.params.get("overlap", 2)),
            "--model-dir",
            str(model_dir().resolve()),
            "--allow-download",
            "1" if downloads_allowed() else "0",
        ]
        if len(plan.models) > 1:
            cmd += ["--ensemble", str(plan.params.get("ensemble", "avg_wave"))]
        return cmd

    def _run_plan(
        self,
        plan: SeparationPlan,
        audio_file: Path,
        target_dir: Path,
        report: _ProgressReporter,
        cancel_event: Any | None,
    ) -> None:
        if plan.engine == "demucs":
            tracker = ProgressTracker(engine_label="Demucs AI", count_unit="seconds")
            extra: dict[str, Any] = {}
        else:
            label = model_label(plan.models[0]) if len(plan.models) == 1 else "RoFormer"
            tracker = ProgressTracker(plan.passes, engine_label=label, count_unit="chunks")
            extra = {"env": _worker_env()}

        # stdout goes to DEVNULL so an unread pipe can never fill up and deadlock the child
        process = subprocess.Popen(
            self._command(plan, audio_file, target_dir),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            **extra,
        )
        watchdog = _Watchdog(
            process, cancel_event, separation_timeout_seconds(), separation_stall_seconds()
        )
        watchdog.start()
        engine = "Demucs" if plan.engine == "demucs" else "RoFormer"
        cancelled_message = f"{engine} separation cancelled by user"

        try:
            if process.stderr:
                for line in process.stderr:
                    watchdog.touch()
                    if cancel_event and cancel_event.is_set():
                        logger.warning(f"{plan.label} cancelled by user")
                        raise SeparationCancelled(cancelled_message)
                    update = tracker.feed(line)
                    if update is not None:
                        report(*update)
            process.wait()
        finally:
            watchdog.halt()
            # Guaranteed subprocess termination in all cases (cancellation, exceptions, or failure)
            if process.poll() is None:
                logger.warning(f"Terminating lingering {plan.label} subprocess")
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    logger.warning(f"Force killing {plan.label} subprocess")
                    process.kill()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        pass
            if process.stderr and hasattr(process.stderr, "close"):
                _quietly(process.stderr.close)
            watchdog.join(timeout=1)

        if (cancel_event is not None and cancel_event.is_set()) or watchdog.reason == "cancelled":
            raise SeparationCancelled(cancelled_message)
        if watchdog.reason in ("timeout", "stalled"):
            message = _failure_message(plan, process.returncode, tracker, watchdog.reason)
            logger.error(message)
            raise RuntimeError(message)
        if process.returncode != 0:
            message = _failure_message(plan, process.returncode, tracker)
            logger.error(message)
            raise RuntimeError(message)

    def set_custom_instrumental(self, track_id: str, custom_file_path: str) -> str:
        """Override the instrumental stem with a user-supplied audio file."""
        if not track_id or not str(track_id).strip():
            raise ValueError("track_id cannot be empty")
        src_path = Path(custom_file_path)
        if not src_path.exists():
            raise FileNotFoundError(f"Custom instrumental file not found: {custom_file_path}")

        target_dir = self.output_base_dir / track_id
        target_dir.mkdir(parents=True, exist_ok=True)
        instrumental_target = target_dir / "instrumental.wav"
        shutil.copy2(src_path, instrumental_target)
        return str(instrumental_target)
