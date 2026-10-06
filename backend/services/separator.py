import os
import sys
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

    def separate_stems(self, audio_path: str, track_id: str, model_name: str = "htdemucs") -> Dict[str, str]:
        """
        Separates vocal and instrumental tracks using Demucs.
        Uses --two-stems=vocals for fast 2-stem separation (vocals vs no_vocals).
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
            return {
                "vocals_path": str(vocals_target),
                "instrumental_path": str(instrumental_target),
            }

        logger.info(f"Starting Demucs separation for {audio_file.name} using {model_name}...")
        
        # We invoke demucs as a subprocess using the current python executable
        cmd = [
            sys.executable,
            "-m", "demucs",
            "--two-stems=vocals",
            "-n", model_name,
            "-o", str(target_dir),
            str(audio_file)
        ]

        process = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        if process.returncode != 0:
            logger.error(f"Demucs separation failed: {process.stderr}")
            raise RuntimeError(f"Demucs failed: {process.stderr}")

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
