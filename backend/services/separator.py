import logging
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from backend.config import STEMS_DIR

logger = logging.getLogger(__name__)


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

    def separate_stems(
        self,
        audio_path: str,
        track_id: str,
        model_name: str = "htdemucs",
        duration: float | None = None,
        progress_callback: Any | None = None,
        cancel_event: Any | None = None,
    ) -> dict[str, str]:
        """
        Separates vocal and instrumental tracks using Demucs.
        Uses --two-stems=vocals for fast 2-stem separation (vocals vs no_vocals).
        Eliminates pipe deadlocks by routing stdout to DEVNULL and draining stderr.
        Guarantees child subprocess termination and cleans up intermediate Demucs model directories.
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

        logger.info(f"Starting Demucs separation for {audio_file.name} using {model_name}...")
        if progress_callback:
            progress_callback(5.0, "Initializing Demucs AI neural network...", None)

        cmd = [
            sys.executable,
            "-u",
            "-m",
            "demucs",
            "--two-stems=vocals",
            "-n",
            model_name,
            "-o",
            str(target_dir),
            str(audio_file),
        ]

        # Use stdout=subprocess.DEVNULL to eliminate unread stdout pipe buffer deadlock hazard!
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )

        stderr_lines = []
        last_callback_time = 0.0

        try:
            if process.stderr:
                for line in process.stderr:
                    stderr_lines.append(line)
                    if cancel_event and cancel_event.is_set():
                        logger.warning(f"Demucs separation cancelled by user for track {track_id}")
                        raise RuntimeError("Demucs separation cancelled by user")

                    now = time.time()
                    # Parse tqdm progress patterns: e.g. " 45%|████▌     | 45/100 [00:15<00:18,  2.97it/s]"
                    pct_match = re.search(r"(\d+)%", line)
                    eta_match = re.search(r"<(\d+):(\d+)", line)
                    chunk_match = re.search(r"(\d+)/(\d+)", line)

                    current_pct = float(pct_match.group(1)) if pct_match else None
                    eta_sec = None
                    if eta_match:
                        eta_sec = int(eta_match.group(1)) * 60 + int(eta_match.group(2))

                    detail = "Separating audio with Demucs AI..."
                    if chunk_match and current_pct is not None:
                        detail = f"Demucs AI: chunk {chunk_match.group(1)}/{chunk_match.group(2)} ({current_pct:.0f}%)"
                    elif current_pct is not None:
                        detail = f"Demucs AI separating stems ({current_pct:.0f}%)"

                    if progress_callback and (
                        now - last_callback_time >= 0.3 or current_pct is not None
                    ):
                        last_callback_time = now
                        progress_callback(current_pct, detail, eta_sec)

            process.wait()

        finally:
            # Guaranteed subprocess termination in all cases (cancellation, exceptions, or failure)
            if process.poll() is None:
                logger.warning(f"Terminating lingering Demucs subprocess for track {track_id}")
                process.terminate()
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    logger.warning(f"Force killing Demucs subprocess for track {track_id}")
                    process.kill()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        pass
            if process.stderr and hasattr(process.stderr, "close"):
                try:
                    process.stderr.close()
                except Exception:
                    pass

        if process.returncode != 0:
            full_stderr = "".join(stderr_lines)
            logger.error(
                f"Demucs separation failed (exit code {process.returncode}): {full_stderr}"
            )
            raise RuntimeError(f"Demucs failed: {full_stderr}")

        # Locate separated stem outputs in Demucs directory structure
        found_vocals = None
        found_no_vocals = None

        for path in target_dir.rglob("vocals.wav"):
            if path != vocals_target:
                found_vocals = path
                break

        for path in target_dir.rglob("no_vocals.wav"):
            if path != instrumental_target:
                found_no_vocals = path
                break

        if not found_vocals or not found_no_vocals:
            raise RuntimeError(f"Could not locate separated stem outputs in {target_dir}")

        # Copy to standardized paths directly under track_id
        shutil.copy2(found_vocals, vocals_target)
        shutil.copy2(found_no_vocals, instrumental_target)

        # Validate that standardized output files were created properly
        if not self._is_valid_stem(vocals_target) or not self._is_valid_stem(instrumental_target):
            raise RuntimeError("Separated stem output files are invalid or empty")

        # Clean up intermediate Demucs model directories to prevent disk bloat
        intermediate_model_dir = target_dir / model_name
        if intermediate_model_dir.exists() and intermediate_model_dir.is_dir():
            shutil.rmtree(intermediate_model_dir, ignore_errors=True)
            logger.info(f"Cleaned up intermediate Demucs directory: {intermediate_model_dir}")

        for child in list(target_dir.iterdir()):
            if child.is_dir():
                shutil.rmtree(child, ignore_errors=True)

        return {
            "vocals_path": str(vocals_target),
            "instrumental_path": str(instrumental_target),
        }

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
