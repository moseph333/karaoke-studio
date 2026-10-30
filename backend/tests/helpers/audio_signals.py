"""Synthetic audio for the alignment tests: vocal tracks with voiced notes, breaths and
transients at known times, and the benchmark track whose word timings are ground truth."""

from typing import Any

import numpy as np
import soundfile as sf


def create_synthetic_vocal_signal(
    duration: float,
    vocal_events: list[dict[str, Any]],
    sr: int = 44100,
    noise_level: float = 0.001,
    channels: int = 1,
) -> np.ndarray:
    """
    Synthesizes a deterministic vocal audio track.
    Each event in vocal_events can specify:
      - 'start': float (onset in seconds)
      - 'end': float (release in seconds)
      - 'freq': float (fundamental frequency f0, default 300.0)
      - 'is_breath': bool (if True, generates high-frequency bandpass noise)
      - 'is_transient': bool (if True, generates short impulsive burst)
    """
    num_samples = int(duration * sr)
    t = np.linspace(0, duration, num_samples, endpoint=False)
    signal = np.random.RandomState(42).normal(0.0, noise_level, num_samples).astype(np.float32)

    ramp_dur = 0.02
    ramp_samples = int(ramp_dur * sr)
    window = np.hanning(max(2, ramp_samples * 2))
    attack = window[:ramp_samples]
    decay = window[ramp_samples:]

    for ev in vocal_events:
        idx_s = max(0, int(ev["start"] * sr))
        idx_e = min(num_samples, int(ev["end"] * sr))
        ev_len = idx_e - idx_s
        if ev_len <= 0:
            continue

        if ev.get("is_breath", False):
            # Breath noise: bandpass/high-frequency white noise centered at 3500 Hz
            rng = np.random.RandomState(int(ev["start"] * 1000) % 10000)
            breath = rng.normal(0.0, 0.35, ev_len).astype(np.float32)
            # Simple high-pass difference filter
            breath = np.diff(breath, prepend=breath[0])
            if ev_len >= ramp_samples * 2:
                breath[:ramp_samples] *= attack
                breath[-ramp_samples:] *= decay
            signal[idx_s:idx_e] += breath
        elif ev.get("is_transient", False):
            # Drum/percussive bleed: broadband decaying impulse
            rng = np.random.RandomState(int(ev["start"] * 1000) % 10000)
            decay_env = np.exp(-np.linspace(0, 10, ev_len))
            transient = (rng.normal(0.0, 0.7, ev_len) * decay_env).astype(np.float32)
            signal[idx_s:idx_e] += transient
        else:
            # Voiced vocal harmonic tone: f0 + 2*f0 + 3*f0
            freq = float(ev.get("freq", 300.0))
            tone = (
                0.50 * np.sin(2 * np.pi * freq * t[idx_s:idx_e])
                + 0.25 * np.sin(2 * np.pi * (2 * freq) * t[idx_s:idx_e])
                + 0.12 * np.sin(2 * np.pi * (3 * freq) * t[idx_s:idx_e])
            ).astype(np.float32)
            if ev_len >= ramp_samples * 2:
                tone[:ramp_samples] *= attack
                tone[-ramp_samples:] *= decay
            signal[idx_s:idx_e] += tone

    signal = np.clip(signal, -0.98, 0.98)
    if channels == 2:
        return np.column_stack((signal, signal))
    return signal


def write_test_wav(
    path: str,
    duration: float,
    vocal_events: list[dict[str, Any]],
    sr: int = 44100,
    channels: int = 1,
) -> str:
    """Helper writing a synthetic audio track to a WAV file."""
    audio = create_synthetic_vocal_signal(
        duration=duration, vocal_events=vocal_events, sr=sr, channels=channels
    )
    sf.write(path, audio, sr)
    return path


def generate_synthetic_benchmark_track(
    file_path: str,
    ground_truth: list[dict[str, Any]],
    sr: int = 44100,
    total_duration: float = 14.0,
) -> None:
    """Generates synthetic vocal audio with realistic sinusoidal bursts and cosine ramps matching ground truth."""
    t = np.linspace(0, total_duration, int(sr * total_duration), endpoint=False)
    audio = np.zeros_like(t)

    ramp_dur = 0.02  # 20ms attack/decay
    ramp_samples = int(ramp_dur * sr)
    window = np.hanning(ramp_samples * 2)
    attack = window[:ramp_samples]
    decay = window[ramp_samples:]

    for line in ground_truth:
        for w in line["words"]:
            w_s, w_e, freq = w["start"], w["end"], w["freq"]
            idx_s = int(w_s * sr)
            idx_e = int(w_e * sr)
            n_samples = idx_e - idx_s
            if n_samples <= 0:
                continue

            tone = 0.5 * np.sin(2 * np.pi * freq * t[idx_s:idx_e])
            if n_samples >= ramp_samples * 2:
                tone[:ramp_samples] *= attack
                tone[-ramp_samples:] *= decay

            audio[idx_s:idx_e] += tone

    audio = np.clip(audio, -0.95, 0.95)
    sf.write(file_path, audio, sr)
