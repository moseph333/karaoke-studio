import os
import subprocess
import logging
from pathlib import Path
from typing import Optional
from backend.config import OUTPUT_DIR

logger = logging.getLogger(__name__)

class AudioMixer:
    def __init__(self, output_dir: Path = OUTPUT_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def mix_and_shift(
        self,
        instrumental_path: str,
        vocals_path: Optional[str] = None,
        semitones: int = 0,
        guide_volume: float = 0.0,
        output_filename: str = "master_audio.wav"
    ) -> str:
        """
        Mixes instrumental track and optional guide vocals, applying pitch shift in semitones.
        Uses FFmpeg audio filters for high-speed, glitch-free pitch transformation.
        """
        output_path = self.output_dir / output_filename
        
        # Calculate pitch shift factor: 2^(semitones / 12)
        pitch_factor = 2.0 ** (semitones / 12.0)
        tempo_factor = 1.0 / pitch_factor

        # FFmpeg filter construction
        inputs = ["-i", instrumental_path]
        
        if vocals_path and os.path.exists(vocals_path) and guide_volume > 0.001:
            inputs.extend(["-i", vocals_path])
            # Filter graph: shift both or blend then shift
            # Shift input 0 (inst) and input 1 (voc with volume), then amix
            # FFmpeg atempo supports values between 0.5 and 2.0
            pitch_filter = f"asetrate=44100*{pitch_factor:.6f},atempo={tempo_factor:.6f}" if semitones != 0 else "anull"
            
            filter_complex = (
                f"[0:a]volume=1.0,{pitch_filter}[inst];"
                f"[1:a]volume={guide_volume:.2f},{pitch_filter}[voc];"
                f"[inst][voc]amix=inputs=2:duration=longest:dropout_transition=2,volume=1.0[outa]"
            )
            map_arg = ["-map", "[outa]"]
        else:
            if semitones != 0:
                filter_complex = f"[0:a]asetrate=44100*{pitch_factor:.6f},atempo={tempo_factor:.6f}[outa]"
                map_arg = ["-map", "[outa]"]
            else:
                filter_complex = None
                map_arg = ["-map", "0:a"]

        cmd = ["ffmpeg", "-y"] + inputs
        if filter_complex:
            cmd.extend(["-filter_complex", filter_complex])
        cmd.extend(map_arg)
        cmd.extend(["-c:a", "pcm_s16le", "-ar", "44100", str(output_path)])

        logger.info(f"Running audio mix command: {' '.join(cmd)}")
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if result.returncode != 0:
            logger.error(f"Audio mixing failed: {result.stderr}")
            raise RuntimeError(f"FFmpeg audio mixing failed: {result.stderr}")

        return str(output_path)
