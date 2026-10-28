"""Master audio mixing and pitch-shifting service using FFmpeg to blend guide vocals and
transpose backing tracks.

Two quality levels, chosen per call site with ``mix_quality``:

* preview (default): resampling-based pitch shift (asetrate + atempo), fast enough to
  remix while someone changes key in the studio.
* final: Rubber Band pitch shifting (formant-preserving on the guide vocal) for exported
  videos, when FFmpeg is built with librubberband; otherwise the preview method.

Guide vocals are added on top of the instrumental at their own level (amix without
normalisation, so switching the guide on no longer halves the backing track) and a
lookahead limiter catches the peaks instead of hard clipping.
"""

import contextlib
import logging
import math
import os
import subprocess
from collections.abc import Iterator
from contextvars import ContextVar
from pathlib import Path
from typing import Any

import soundfile as sf

from backend.config import OUTPUT_DIR

logger = logging.getLogger(__name__)

MIX_QUALITY: ContextVar[str] = ContextVar("MIX_QUALITY", default="preview")
# -0.5 dBFS ceiling; level=0 keeps the limiter from re-normalising the whole mix
LIMITER = "alimiter=limit=0.944:level=0"
_FINAL_PITCH = "rubberband=pitch={factor:.6f}:transients=mixed:pitchq=quality:channels=together"
_UNSUPPORTED_HINTS = (
    "Option not found",
    "No such filter",
    "not found for",
    "Error applying option",
)

_ffmpeg_filters: frozenset[str] | None = None


@contextlib.contextmanager
def mix_quality(level: str) -> Iterator[None]:
    """Mixes made inside this block use the given quality ("preview" or "final")."""
    token = MIX_QUALITY.set(level)
    try:
        yield
    finally:
        MIX_QUALITY.reset(token)


def ffmpeg_has_filter(name: str) -> bool:
    """Whether the installed FFmpeg has a filter; the probe result is remembered once it works."""
    global _ffmpeg_filters
    if _ffmpeg_filters is None:
        try:
            res = subprocess.run(
                ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, timeout=10
            )
        except (OSError, subprocess.SubprocessError):
            return False
        if res.returncode != 0 or not isinstance(res.stdout, str):
            return False
        names = set()
        for line in res.stdout.splitlines():
            parts = line.split()
            if len(parts) >= 3 and "->" in parts[2]:
                names.add(parts[1])
        _ffmpeg_filters = frozenset(names)
    return name in _ffmpeg_filters


def reset_ffmpeg_probe() -> None:
    global _ffmpeg_filters
    _ffmpeg_filters = None


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

        # Calculate pitch shift factor: 2^(semitones / 12)
        pitch_factor = 2.0 ** (clamped_semitones / 12.0)
        final = MIX_QUALITY.get() == "final" and clamped_semitones != 0
        rubberband = final and ffmpeg_has_filter("rubberband")

        inputs = ["-i", str(instrumental_path)]
        has_vocals = vocals_path and os.path.isfile(vocals_path) and safe_guide_volume > 0.001
        # The resampling method needs each input's own rate (also for the legacy retry)
        inst_sr = self._get_sample_rate(instrumental_path, default=44100)

        # legacy_filter: what FFmpeg before 4.4 (no amix normalize, no alimiter level, maybe
        # no rubberband options) can run, used only when FFmpeg rejects the main graph
        if has_vocals:
            assert vocals_path is not None
            voc_sr = self._get_sample_rate(vocals_path, default=inst_sr)
            inputs.extend(["-i", str(vocals_path)])
            inst_pitch = self._pitch_filter(clamped_semitones, pitch_factor, inst_sr, rubberband)
            voc_pitch = self._pitch_filter(
                clamped_semitones, pitch_factor, voc_sr, rubberband, vocals=True
            )
            guide = f"volume={safe_guide_volume:.2f}"
            mix = "amix=inputs=2:duration=longest:dropout_transition=2"
            filter_complex = (
                f"[0:a]{inst_pitch}[inst];[1:a]{guide},{voc_pitch}[voc];"
                f"[inst][voc]{mix}:normalize=0,{LIMITER}[outa]"
            )
            legacy_filter = (
                f"[0:a]{self._pitch_filter(clamped_semitones, pitch_factor, inst_sr, False)}[inst];"
                f"[1:a]{guide},{self._pitch_filter(clamped_semitones, pitch_factor, voc_sr, False)}"
                f"[voc];[inst][voc]{mix}[outa]"
            )
            map_arg = ["-map", "[outa]"]
        elif clamped_semitones != 0:
            inst_pitch = self._pitch_filter(clamped_semitones, pitch_factor, inst_sr, rubberband)
            filter_complex = f"[0:a]{inst_pitch},{LIMITER}[outa]"
            legacy_filter = (
                f"[0:a]{self._pitch_filter(clamped_semitones, pitch_factor, inst_sr, False)}[outa]"
            )
            map_arg = ["-map", "[outa]"]
        else:
            filter_complex = legacy_filter = None
            map_arg = ["-map", "0:a"]

        def build(graph: str | None) -> list[str]:
            cmd = ["ffmpeg", "-y", *inputs]
            if graph:
                cmd.extend(["-filter_complex", graph])
            return [*cmd, *map_arg, "-c:a", "pcm_s16le", "-ar", "44100", str(temp_output)]

        cmd = build(filter_complex)
        logger.info(f"Running audio mix command: {' '.join(cmd)}")
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
            if (
                result.returncode != 0
                and legacy_filter
                and isinstance(result.stderr, str)
                and any(hint in result.stderr for hint in _UNSUPPORTED_HINTS)
            ):
                logger.warning("FFmpeg rejected the mix filters; retrying with the legacy graph")
                cmd = build(legacy_filter)
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

    @staticmethod
    def _pitch_filter(
        semitones: int, factor: float, sample_rate: int, rubberband: bool, vocals: bool = False
    ) -> str:
        if semitones == 0:
            return "anull"
        if rubberband:
            chain = _FINAL_PITCH.format(factor=factor)
            return f"{chain}:formant=preserved" if vocals else chain
        return f"asetrate={sample_rate}*{factor:.6f},atempo={1.0 / factor:.6f}"

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
