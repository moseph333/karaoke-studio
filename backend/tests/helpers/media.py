"""Real media files for the end-to-end tests: a stereo sine-wave WAV and a JPEG image."""

from pathlib import Path

import numpy as np
import soundfile as sf
from PIL import Image


def generate_sine_wave_wav(
    file_path: Path, duration: float = 1.0, sr: int = 44100, freq: float = 440.0
):
    """Generates a real valid stereo sine wave WAV file."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.4 * np.sin(2 * np.pi * freq * t)
    stereo = np.column_stack((sine, sine))
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), stereo, sr)
    return file_path


def generate_test_image(file_path: Path, width: int = 200, height: int = 200, color=(50, 100, 150)):
    """Generates a real valid JPEG image file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (width, height), color=color)
    img.save(str(file_path), format="JPEG")
    return file_path
