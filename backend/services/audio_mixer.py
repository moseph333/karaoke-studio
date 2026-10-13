import logging
import math
import os
import subprocess
from pathlib import Path
from typing import Any

import soundfile as sf

from backend.config import OUTPUT_DIR

logger = logging.getLogger(__name__)


class AudioMixer:
    """
    Mixes instrumental backing tracks with optional guide vocals and applies
    semitone pitch shifts (-12 to +12) with dynamic sample-rate inspection and FFmpeg.
    """

    def __init__(self, output_dir: Path = OUTPUT_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def _get_sample_rate(self, file_path: str, default: int = 44100) -> int:
        """
        Dynamically inspects audio sample rate using soundfile.info with ffprobe fallback.
        """
        # Primary inspection: soundfile.info
        try:
            info = sf.info(file_path)
            if info.samplerate > 0:
                return int(info.samplerate)
        except Exception as sf_err:
            logger.debug(
                f"soundfile.info could not read sample rate from {file_path}: {sf_err}; trying ffprobe"
            )

        # Fallback inspection: ffprobe
        try:
            cmd = [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a:0",
                "-show_entries",
                "stream=sample_rate",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(file_path),
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
            if res.returncode == 0 and res.stdout.strip().isdigit():
                rate = int(res.stdout.strip())
                if rate > 0:
                    return rate
        except Exception as probe_err:
            logger.warning(f"ffprobe sample rate detection failed for {file_path}: {probe_err}")

        return default

    def mix_and_shift(
        self,
        instrumental_path: str,
        vocals_path: str | None = None,
        semitones: int = 0,
        guide_volume: float = 0.0,
        output_filename: str = "master_audio.wav",
        timeout: int = 120,
    ) -> str:
        """
        Mixes instrumental track and optional guide vocals, applying pitch shift in semitones.
        Clamps semitones to [-12, 12], detects input sample rate dynamically, and cleans up on failure.
        """
        if not instrumental_path or not os.path.isfile(instrumental_path):
            raise FileNotFoundError(f"Instrumental audio file not found: {instrumental_path}")

        # Validate and clamp semitones to [-12, 12]
        try:
            raw_semitones = round(float(semitones))
        except (ValueError, TypeError, OverflowError):
            logger.warning(f"Invalid semitones value {semitones!r}; defaulting to 0")
            raw_semitones = 0

        if raw_semitones < -12 or raw_semitones > 12:
            logger.warning(f"Semitones {raw_semitones} out of range [-12, 12]; clamping.")
            clamped_semitones = max(-12, min(12, raw_semitones))
        else:
            clamped_semitones = raw_semitones

        # Validate and clamp guide_volume to [0.0, 1.0]
        try:
            parsed_vol = float(guide_volume)
            if math.isnan(parsed_vol) or math.isinf(parsed_vol):
                logger.warning(f"Invalid guide_volume value {guide_volume!r}; defaulting to 0.0")
                safe_guide_volume = 0.0
            else:
                safe_guide_volume = max(0.0, min(1.0, parsed_vol))
        except (ValueError, TypeError):
            logger.warning(f"Invalid guide_volume value {guide_volume!r}; defaulting to 0.0")
            safe_guide_volume = 0.0

        output_path = self.output_dir / output_filename
        temp_output = output_path.with_suffix(f".tmp_{os.getpid()}.wav")

        # Dynamically inspect sample rate of input instrumental
        inst_sr = self._get_sample_rate(instrumental_path, default=44100)

        # Calculate pitch shift factor: 2^(semitones / 12)
        pitch_factor = 2.0 ** (clamped_semitones / 12.0)
        tempo_factor = 1.0 / pitch_factor

        # FFmpeg filter construction
        inputs = ["-i", str(instrumental_path)]
        has_vocals = vocals_path and os.path.isfile(vocals_path) and safe_guide_volume > 0.001

        if has_vocals:
            assert vocals_path is not None
            voc_sr = self._get_sample_rate(vocals_path, default=inst_sr)
            inputs.extend(["-i", str(vocals_path)])

            inst_pitch = (
                f"asetrate={inst_sr}*{pitch_factor:.6f},atempo={tempo_factor:.6f}"
                if clamped_semitones != 0
                else "anull"
            )
            voc_pitch = (
                f"asetrate={voc_sr}*{pitch_factor:.6f},atempo={tempo_factor:.6f}"
                if clamped_semitones != 0
                else "anull"
            )

            filter_complex = (
                f"[0:a]volume=1.0,{inst_pitch}[inst];"
                f"[1:a]volume={safe_guide_volume:.2f},{voc_pitch}[voc];"
                f"[inst][voc]amix=inputs=2:duration=longest:dropout_transition=2,volume=1.0[outa]"
            )
            map_arg = ["-map", "[outa]"]
        else:
            if clamped_semitones != 0:
                filter_complex = (
                    f"[0:a]asetrate={inst_sr}*{pitch_factor:.6f},atempo={tempo_factor:.6f}[outa]"
                )
                map_arg = ["-map", "[outa]"]
            else:
                filter_complex = None
                map_arg = ["-map", "0:a"]

        cmd = ["ffmpeg", "-y", *inputs]
        if filter_complex:
            cmd.extend(["-filter_complex", filter_complex])
        cmd.extend(map_arg)
        cmd.extend(["-c:a", "pcm_s16le", "-ar", "44100", str(temp_output)])

        logger.info(f"Running audio mix command: {' '.join(cmd)}")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            if result.returncode != 0:
                if temp_output.exists():
                    temp_output.unlink(missing_ok=True)
                err_lines = [line for line in result.stderr.strip().splitlines() if line.strip()]
                last_err = err_lines[-1] if err_lines else "Unknown FFmpeg error"
                logger.error(f"Audio mixing failed: {result.stderr}")
                raise RuntimeError(
                    f"FFmpeg audio mixing failed (code {result.returncode}): {last_err}"
                )

            # Atomic rename upon successful generation
            temp_output.replace(output_path)
            return str(output_path)

        except subprocess.TimeoutExpired as timeout_err:
            if temp_output.exists():
                temp_output.unlink(missing_ok=True)
            logger.error(f"FFmpeg audio mixing timed out after {timeout}s: {' '.join(cmd)}")
            raise RuntimeError(
                f"FFmpeg audio mixing timed out after {timeout} seconds"
            ) from timeout_err
        except Exception:
            if temp_output.exists():
                temp_output.unlink(missing_ok=True)
            raise

    def create_mix(
        self,
        project: dict[str, Any],
        semitones: int = 0,
        guide_volume: float = 0.0,
    ) -> str:
        """
        High-level interface adhering to PROJECT.md contract: extracts project paths
        and generates master audio mix.
        """
        instrumental_path = project.get("instrumental_path", "")
        vocals_path = project.get("vocals_path")
        track_id = project.get("track_id") or project.get("id") or "master"
        output_filename = f"{track_id}_master.wav"
        return self.mix_and_shift(
            instrumental_path=instrumental_path,
            vocals_path=vocals_path,
            semitones=semitones,
            guide_volume=guide_volume,
            output_filename=output_filename,
        )
