"""Waveform overview for the transport scrubber: per-bin loudness peaks computed server-side,
so browsers no longer download and decode the whole master mix just to draw it."""

import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np
import soundfile as sf

MIN_BINS = 50
MAX_BINS = 4000
DEFAULT_BINS = 800
DYNAMIC_RANGE_DB = 36.0
_BLOCK_FRAMES = 1 << 16
_CACHE_SIZE = 32

_cache: "OrderedDict[tuple, tuple[list[float], float]]" = OrderedDict()
_cache_lock = threading.Lock()


class WaveformUnavailable(Exception):
    """The audio file is missing or cannot be decoded."""


def compute_peaks(path: str | Path, bins: int = DEFAULT_BINS) -> tuple[list[float], float]:
    """Returns (peaks, duration_seconds) for an audio file.

    Each peak is the RMS loudness of one equal slice of the track on a decibel scale: the
    98th-percentile level (so one spike cannot flatten the rest) maps to 1.0 and
    DYNAMIC_RANGE_DB below it to 0. Results are cached per file path, size and mtime.
    """
    bins = max(MIN_BINS, min(MAX_BINS, int(bins)))
    file_path = Path(path)
    try:
        stat = file_path.stat()
    except OSError as exc:
        raise WaveformUnavailable(f"Audio file not found: {file_path.name}") from exc

    key = (str(file_path.resolve()), stat.st_size, stat.st_mtime_ns, bins)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key)
            return _cache[key]

    try:
        result = _analyze(file_path, bins)
    except (RuntimeError, ValueError) as exc:  # libsndfile errors subclass RuntimeError
        raise WaveformUnavailable(f"Cannot decode {file_path.name}: {exc}") from exc

    with _cache_lock:
        _cache[key] = result
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_SIZE:
            _cache.popitem(last=False)
    return result


def _analyze(file_path: Path, bins: int) -> tuple[list[float], float]:
    with sf.SoundFile(str(file_path)) as snd:
        total = snd.frames
        rate = snd.samplerate
        if total <= 0 or rate <= 0:
            return [0.0] * bins, 0.0
        energy = np.zeros(bins, dtype=np.float64)
        counts = np.zeros(bins, dtype=np.float64)
        offset = 0
        for block in snd.blocks(blocksize=_BLOCK_FRAMES, dtype="float32", always_2d=True):
            mono = block.mean(axis=1, dtype=np.float64)
            frames = np.arange(offset, offset + mono.shape[0], dtype=np.int64)
            idx = np.minimum((frames * bins) // total, bins - 1)
            energy += np.bincount(idx, weights=mono * mono, minlength=bins)
            counts += np.bincount(idx, minlength=bins)
            offset += mono.shape[0]

    rms = np.sqrt(np.divide(energy, counts, out=np.zeros_like(energy), where=counts > 0))
    reference = float(np.percentile(rms, 98)) if rms.size else 0.0
    if reference <= 1e-9:
        return [0.0] * bins, round(total / rate, 3)
    # Perceptual scale: the loud parts reach 1.0 and quieter passages stay visible
    # (-20 dB draws at ~0.44 instead of 0.1 on a linear scale).
    ratio = np.maximum(rms / reference, 1e-12)
    db = np.clip(20.0 * np.log10(ratio), -DYNAMIC_RANGE_DB, 0.0)
    peaks = np.where(rms > 0, 1.0 + db / DYNAMIC_RANGE_DB, 0.0)
    return [round(float(p), 3) for p in peaks], round(total / rate, 3)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()
