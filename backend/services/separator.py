import os
import sys
import re
import time
import shutil
import subprocess
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from backend.config import STEMS_DIR

logger = logging.getLogger(__name__)

class AudioSeparator:
    def __init__(self, output_base_dir: Path = STEMS_DIR):
        self.output_base_dir = output_base_dir
        self.output_base_dir.mkdir(parents=True, exist_ok=True)

    def separate_stems(
        self,
        audio_path: str,
        track_id: str,
        model_name: str = "htdemucs",
        duration: Optional[float] = None,
        progress_callback: Optional[Any] = None,
        cancel_event: Optional[Any] = None
    ) -> Dict[str, str]:
        """
        Separates vocal and instrumental tracks using Demucs.
        Uses --two-stems=vocals for fast 2-stem separation (vocals vs no_vocals).
        Streams stderr to report percentage, ETA, and activity heartbeats.
        """
        audio_file = Path(audio_path)
        if not audio_file.exists():
            raise FileNotFoundError(f"Input audio file not found: {audio_path}")

        target_dir = self.output_base_dir / track_id
        target_dir.mkdir(parents=True, exist_ok=True)

        vocals_target = target_dir / "vocals.wav"
        instrumental_target = target_dir / "instrumental.wav"

        # Check if already processed
        if vocals_target.exists() and instrumental_target.exists():
            logger.info(f"Stems already exist for track {track_id}")
            if progress_callback:
                progress_callback(100.0, "Found cached vocal stems", 0)
            return {
                "vocals_path": str(vocals_target),
                "instrumental_path": str(instrumental_target),
            }

        logger.info(f"Starting Demucs separation for {audio_file.name} using {model_name}...")
        if progress_callback:
            progress_callback(5.0, "Initializing Demucs AI neural network...", None)

        # Invoke demucs unbuffered to stream tqdm progress
        cmd = [
            sys.executable,
            "-u",
            "-m", "demucs",
            "--two-stems=vocals",
            "-n", model_name,
            "-o", str(target_dir),
            str(audio_file)
        ]

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        stderr_lines = []
        last_callback_time = 0.0

        try:
            for line in process.stderr:
                stderr_lines.append(line)
                if cancel_event and cancel_event.is_set():
                    logger.warning(f"Demucs separation cancelled by user for track {track_id}")
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
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

                # Update callback at least every 0.3s or on percentage change
                if progress_callback and (now - last_callback_time >= 0.3 or current_pct is not None):
                    last_callback_time = now
                    progress_callback(current_pct, detail, eta_sec)

            process.wait()

        except Exception as e:
            if cancel_event and cancel_event.is_set():
                process.terminate()
            raise e

        if process.returncode != 0:
            full_stderr = "".join(stderr_lines)
            logger.error(f"Demucs separation failed: {full_stderr}")
            raise RuntimeError(f"Demucs failed: {full_stderr}")

        # Demucs output layout: <target_dir>/<model_name>/<stem_name>/vocals.wav and no_vocals.wav
        found_vocals = None
        found_no_vocals = None

        for path in target_dir.rglob("vocals.wav"):
            found_vocals = path
            break

        for path in target_dir.rglob("no_vocals.wav"):
            found_no_vocals = path
            break

        if not found_vocals or not found_no_vocals:
            raise RuntimeError(f"Could not locate separated stem outputs in {target_dir}")

        # Copy/move to standardized paths directly under track_id
        shutil.copy2(found_vocals, vocals_target)
        shutil.copy2(found_no_vocals, instrumental_target)

        return {
            "vocals_path": str(vocals_target),
            "instrumental_path": str(instrumental_target),
        }

    def set_custom_instrumental(self, track_id: str, custom_file_path: str) -> str:
        """Override the instrumental stem with a user-supplied audio file."""
        target_dir = self.output_base_dir / track_id
        target_dir.mkdir(parents=True, exist_ok=True)
        instrumental_target = target_dir / "instrumental.wav"
        shutil.copy2(custom_file_path, instrumental_target)
        return str(instrumental_target)
