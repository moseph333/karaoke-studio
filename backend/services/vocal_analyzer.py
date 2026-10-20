"""Offline deterministic vocal range analyzer and smart key recommender.

Implements FFT-accelerated YIN pitch tracking, Krumhansl-Schmuckler 12-bin
chroma key estimation, percentile-based tessitura extraction, and voice-preset
cost-minimizing key recommendation.
"""

from __future__ import annotations

import logging
import math
import re
from pathlib import Path
from typing import Any

import numpy as np
import scipy.signal
import soundfile as sf

logger = logging.getLogger("karaoke_backend")

NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

NOTE_TO_SEMITONE: dict[str, int] = {name: idx for idx, name in enumerate(NOTE_NAMES)}
NOTE_TO_SEMITONE.update(
    {
        "DB": 1,
        "EB": 3,
        "GB": 6,
        "AB": 8,
        "BB": 10,
        "B#": 0,
        "E#": 5,
        "CB": 11,
        "FB": 4,
    }
)

# Standard voice type presets (Classical & Contemporary Vocal Ranges)
VOICE_PRESETS: dict[str, dict[str, Any]] = {
    "Bass": {"low_note": "E2", "high_note": "E4", "low_midi": 40, "high_midi": 64},
    "Baritone": {"low_note": "A2", "high_note": "A4", "low_midi": 45, "high_midi": 69},
    "Tenor": {"low_note": "C3", "high_note": "C5", "low_midi": 48, "high_midi": 72},
    "Alto": {"low_note": "F3", "high_note": "F5", "low_midi": 53, "high_midi": 77},
    "Mezzo-Soprano": {"low_note": "A3", "high_note": "A5", "low_midi": 57, "high_midi": 81},
    "Soprano": {"low_note": "C4", "high_note": "C6", "low_midi": 60, "high_midi": 84},
}

VOICE_PRESET_ALIASES: dict[str, str] = {
    "bass": "Bass",
    "baritone": "Baritone",
    "tenor": "Tenor",
    "alto": "Alto",
    "mezzo-soprano": "Mezzo-Soprano",
    "mezzosoprano": "Mezzo-Soprano",
    "mezzo_soprano": "Mezzo-Soprano",
    "mezzo": "Mezzo-Soprano",
    "soprano": "Soprano",
}

# Krumhansl-Kessler key profiles
MAJOR_PROFILE = np.array(
    [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
    dtype=float,
)
MINOR_PROFILE = np.array(
    [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
    dtype=float,
)


def hz_to_midi(hz: float) -> float:
    """Convert frequency in Hertz to continuous MIDI note number."""
    if hz <= 0.0 or not math.isfinite(hz):
        raise ValueError(f"Frequency must be a finite positive number, got {hz}")
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def midi_to_hz(midi: float) -> float:
    """Convert MIDI note number to fundamental frequency in Hertz."""
    if not math.isfinite(midi):
        raise ValueError(f"MIDI note must be a finite number, got {midi}")
    return 440.0 * (2.0 ** ((midi - 69.0) / 12.0))


def midi_to_note_name(midi: float | int) -> str:
    """Convert MIDI note number to Scientific Pitch Notation (e.g. 60 -> 'C4', 69 -> 'A4')."""
    rounded = round(midi)
    pitch_class = rounded % 12
    octave = (rounded // 12) - 1
    return f"{NOTE_NAMES[pitch_class]}{octave}"


def note_name_to_midi(note_str: str) -> int:
    """Convert Scientific Pitch Notation note string (e.g. 'C#3', 'Db3', 'G4') to integer MIDI."""
    clean = note_str.strip().upper()
    match = re.match(r"^([A-G][#B]?)(-?\d+)$", clean)
    if not match:
        raise ValueError(f"Invalid scientific pitch notation format: '{note_str}'")
    pitch_cls, oct_str = match.group(1), match.group(2)
    octave = int(oct_str)
    if pitch_cls not in NOTE_TO_SEMITONE:
        raise ValueError(f"Unrecognized pitch class: '{pitch_cls}' in '{note_str}'")
    return (octave + 1) * 12 + NOTE_TO_SEMITONE[pitch_cls]


def hz_to_note_name(hz: float) -> str:
    """Convert frequency in Hertz directly to Scientific Pitch Notation."""
    return midi_to_note_name(hz_to_midi(hz))


def project_key(original_key: str, semitones: int) -> str:
    """Transpose a musical key string by integer semitones."""
    if not original_key or original_key.strip().lower() == "unknown":
        return "Unknown"
    parts = original_key.strip().split()
    if not parts:
        return "Unknown"
    root = (
        parts[0]
        .upper()
        .replace("DB", "C#")
        .replace("EB", "D#")
        .replace("GB", "F#")
        .replace("AB", "G#")
        .replace("BB", "A#")
    )
    mode = " ".join(parts[1:]) if len(parts) > 1 else ""
    if root not in NOTE_TO_SEMITONE:
        return original_key
    new_idx = (NOTE_TO_SEMITONE[root] + semitones) % 12
    new_root = NOTE_NAMES[new_idx]
    return f"{new_root} {mode}".strip()


class VocalRangeAnalyzer:
    """Offline deterministic vocal range analyzer and smart key recommender."""

    def __init__(
        self,
        sample_rate: int = 16000,
        frame_length: int = 2048,
        hop_length: int = 512,
        min_freq: float = 65.0,
        max_freq: float = 1100.0,
        yin_threshold: float = 0.15,
        energy_threshold: float = 0.008,
        min_voiced_frames: int = 5,
    ) -> None:
        self.sample_rate = sample_rate
        self.frame_length = frame_length
        self.hop_length = hop_length
        self.min_freq = min_freq
        self.max_freq = max_freq
        self.yin_threshold = yin_threshold
        self.energy_threshold = energy_threshold
        self.min_voiced_frames = min_voiced_frames

    def _safe_empty_result(self, voiced_count: int = 0, total_count: int = 0) -> dict[str, Any]:
        """Return safe unvoiced dictionary guaranteeing no NaN or None-pointer crashes."""
        return {
            "is_voiced": False,
            "lowest_note": None,
            "highest_note": None,
            "lowest_hz": None,
            "highest_hz": None,
            "tessitura_low_note": None,
            "tessitura_high_note": None,
            "tessitura_low_hz": None,
            "tessitura_high_hz": None,
            "median_note": None,
            "median_hz": None,
            "estimated_key": "Unknown",
            "key_confidence": 0.0,
            "voiced_frames_count": int(voiced_count),
            "total_frames_count": int(total_count),
        }

    def _load_audio(
        self, audio_input: str | Path | np.ndarray, sr: int | None = None
    ) -> tuple[np.ndarray, int]:
        """Load audio file or format raw array, downmix to mono, scrub NaNs, and resample."""
        if isinstance(audio_input, (str, Path)):
            path = Path(audio_input)
            if not path.is_file():
                raise FileNotFoundError(f"Audio file not found: {path}")
            data, in_sr = sf.read(str(path), dtype="float32")
        else:
            data = audio_input
            in_sr = sr or self.sample_rate

        if data.size == 0:
            return np.array([], dtype=np.float32), self.sample_rate

        mono = np.mean(data, axis=1) if data.ndim > 1 else data.astype(np.float32, copy=False)

        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0)

        if in_sr != self.sample_rate and len(mono) > 0:
            gcd = math.gcd(in_sr, self.sample_rate)
            up = self.sample_rate // gcd
            down = in_sr // gcd
            mono = scipy.signal.resample_poly(mono, up, down).astype(np.float32)

        return mono, self.sample_rate

    def _detect_pitch_frame(
        self, frame: np.ndarray, tau_min: int, tau_max: int, W: int
    ) -> tuple[float | None, float]:
        """Run FFT-accelerated YIN pitch detection on a single windowed frame."""
        sq = frame**2
        cum_sq = np.concatenate(([0.0], np.cumsum(sq)))
        term1 = cum_sq[W] - cum_sq[0]
        term2 = cum_sq[W : W + tau_max] - cum_sq[:tau_max]

        conv = scipy.signal.correlate(frame[: W + tau_max], frame[:W], mode="valid", method="fft")
        d = term1 + term2 - 2.0 * conv[:tau_max]

        cmndf = np.ones(tau_max, dtype=float)
        d_cumsum = np.cumsum(d[1:])
        taus = np.arange(1, tau_max)
        safe_cumsum = np.where(d_cumsum <= 1e-12, 1e-12, d_cumsum)
        cmndf[1:] = (d[1:] * taus) / safe_cumsum

        chosen_tau = -1
        for tau in range(tau_min, tau_max - 1):
            if cmndf[tau] < self.yin_threshold:
                while tau + 1 < tau_max and cmndf[tau + 1] < cmndf[tau]:
                    tau += 1
                chosen_tau = tau
                break

        if chosen_tau == -1:
            min_idx = tau_min + int(np.argmin(cmndf[tau_min:tau_max]))
            if cmndf[min_idx] < 0.20:
                chosen_tau = min_idx

        if chosen_tau <= 0:
            return None, 1.0

        tau = chosen_tau
        if 0 < tau < tau_max - 1:
            alpha = cmndf[tau - 1]
            beta = cmndf[tau]
            gamma = cmndf[tau + 1]
            denom = 2.0 * (alpha - 2.0 * beta + gamma)
            delta = (alpha - gamma) / denom if abs(denom) > 1e-9 else 0.0
            refined_tau = tau + delta
        else:
            refined_tau = float(tau)

        if refined_tau <= 0.0:
            return None, 1.0

        freq = self.sample_rate / refined_tau
        if self.min_freq <= freq <= self.max_freq:
            return float(freq), float(cmndf[tau])

        return None, 1.0

    def estimate_key(self, chroma_vector: np.ndarray | list[float]) -> tuple[str, float]:
        """Estimate musical key and confidence score using Krumhansl-Schmuckler profiles."""
        c = np.asarray(chroma_vector, dtype=float)
        if c.size != 12 or np.all(c == 0.0):
            return "Unknown", 0.0

        c_std = float(np.std(c))
        if c_std < 1e-9:
            return "Unknown", 0.0

        c_norm = c - np.mean(c)
        best_key = "Unknown"
        best_corr = -1.0

        for shift in range(12):
            p_maj = np.roll(MAJOR_PROFILE, shift)
            p_maj_norm = p_maj - np.mean(p_maj)
            corr_maj = float(np.dot(c_norm, p_maj_norm) / (12.0 * c_std * np.std(p_maj)))
            if corr_maj > best_corr:
                best_corr = corr_maj
                best_key = f"{NOTE_NAMES[shift]} Major"

            p_min = np.roll(MINOR_PROFILE, shift)
            p_min_norm = p_min - np.mean(p_min)
            corr_min = float(np.dot(c_norm, p_min_norm) / (12.0 * c_std * np.std(p_min)))
            if corr_min > best_corr:
                best_corr = corr_min
                best_key = f"{NOTE_NAMES[shift]} Minor"

        confidence = max(0.0, min(1.0, float(best_corr)))
        return best_key, round(confidence, 2)

    def analyze_audio(self, audio_data: np.ndarray, sr: int | None = None) -> dict[str, Any]:
        """Analyze raw numpy audio array for vocal range, tessitura, and musical key."""
        mono, sample_rate = self._load_audio(audio_data, sr=sr)
        total_samples = len(mono)

        if total_samples < self.frame_length:
            return self._safe_empty_result(0, 0)

        if float(np.max(np.abs(mono))) < 1e-4:
            total_frames = max(0, (total_samples - self.frame_length) // self.hop_length + 1)
            return self._safe_empty_result(0, total_frames)

        tau_min = max(2, int(sample_rate / self.max_freq))
        tau_max = min(self.frame_length // 2, int(sample_rate / self.min_freq))
        W = self.frame_length - tau_max

        total_frames = max(0, (total_samples - self.frame_length) // self.hop_length + 1)
        voiced_pitches: list[float] = []
        chroma = np.zeros(12, dtype=float)

        for i in range(0, total_samples - self.frame_length + 1, self.hop_length):
            frame = mono[i : i + self.frame_length]
            rms = float(np.sqrt(np.mean(frame**2)))
            if rms < self.energy_threshold:
                continue

            freq, _ = self._detect_pitch_frame(frame, tau_min, tau_max, W)
            if freq is not None:
                voiced_pitches.append(freq)
                midi = hz_to_midi(freq)
                pitch_class = round(midi) % 12
                chroma[pitch_class] += rms

        if len(voiced_pitches) < self.min_voiced_frames:
            return self._safe_empty_result(len(voiced_pitches), total_frames)

        pitches = np.array(voiced_pitches, dtype=float)
        lowest_hz = round(float(np.percentile(pitches, 5)), 1)
        highest_hz = round(float(np.percentile(pitches, 95)), 1)
        tess_low_hz = round(float(np.percentile(pitches, 15)), 1)
        tess_high_hz = round(float(np.percentile(pitches, 85)), 1)
        median_hz = round(float(np.percentile(pitches, 50)), 1)

        lowest_note = hz_to_note_name(lowest_hz)
        highest_note = hz_to_note_name(highest_hz)
        tessitura_low_note = hz_to_note_name(tess_low_hz)
        tessitura_high_note = hz_to_note_name(tess_high_hz)
        median_note = hz_to_note_name(median_hz)

        est_key, confidence = self.estimate_key(chroma)

        return {
            "is_voiced": True,
            "lowest_note": lowest_note,
            "highest_note": highest_note,
            "lowest_hz": lowest_hz,
            "highest_hz": highest_hz,
            "tessitura_low_note": tessitura_low_note,
            "tessitura_high_note": tessitura_high_note,
            "tessitura_low_hz": tess_low_hz,
            "tessitura_high_hz": tess_high_hz,
            "median_note": median_note,
            "median_hz": median_hz,
            "estimated_key": est_key,
            "key_confidence": confidence,
            "voiced_frames_count": len(voiced_pitches),
            "total_frames_count": total_frames,
        }

    def analyze_vocals(self, file_path: str | Path) -> dict[str, Any]:
        """Load audio file from disk and compute complete vocal range metadata."""
        mono, _ = self._load_audio(file_path)
        return self.analyze_audio(mono, sr=self.sample_rate)

    def recommend_key(
        self,
        song_range: dict[str, Any] | None = None,
        target_preset: str | None = None,
        custom_low_note: str | None = None,
        custom_high_note: str | None = None,
        *,
        song_vocal_range: dict[str, Any] | None = None,
        target_voice_preset: str | None = None,
    ) -> dict[str, Any]:
        """Calculate optimal pitch shift semitones in [-12, +12] minimizing out-of-range penalty."""
        actual_song = song_range if song_range is not None else song_vocal_range
        actual_preset = target_preset if target_preset is not None else target_voice_preset

        if (
            not actual_song
            or not actual_song.get("is_voiced")
            or not actual_song.get("lowest_note")
            or not actual_song.get("highest_note")
        ):
            orig_key = actual_song.get("estimated_key", "Unknown") if actual_song else "Unknown"
            return {
                "recommended_semitones": 0,
                "projected_key": orig_key,
                "projected_low_note": None,
                "projected_high_note": None,
                "cost": 0.0,
                "is_in_range": True,
                "target_preset": actual_preset,
                "original_key": orig_key,
            }

        preset_name: str | None = None
        if custom_low_note and custom_high_note:
            r_low = note_name_to_midi(custom_low_note)
            r_high = note_name_to_midi(custom_high_note)
            if r_low > r_high:
                r_low, r_high = r_high, r_low
        else:
            resolved_preset_name = "Baritone"
            if actual_preset:
                stripped = actual_preset.strip()
                canonical = VOICE_PRESET_ALIASES.get(stripped.lower()) or stripped
                if canonical in VOICE_PRESETS:
                    resolved_preset_name = canonical

            preset = VOICE_PRESETS[resolved_preset_name]
            preset_name = resolved_preset_name
            r_low = preset["low_midi"]
            r_high = preset["high_midi"]

        r_mid = (r_low + r_high) / 2.0

        song_low = note_name_to_midi(actual_song["lowest_note"])
        song_high = note_name_to_midi(actual_song["highest_note"])
        if actual_song.get("median_note"):
            song_med = note_name_to_midi(actual_song["median_note"])
        else:
            song_med = (song_low + song_high) / 2.0

        best_s = 0
        best_cost = float("inf")

        for s in range(-12, 13):
            h_shift = song_high + s
            l_shift = song_low + s
            m_shift = song_med + s

            delta_high = max(0.0, float(h_shift - r_high))
            delta_low = max(0.0, float(r_low - l_shift))

            cost = (
                100.0 * (delta_high**2)
                + 80.0 * (delta_low**2)
                + 2.0 * abs(m_shift - r_mid)
                + 0.5 * abs(s)
            )

            if cost < best_cost:
                best_cost = cost
                best_s = s
            elif abs(cost - best_cost) < 1e-9:
                if abs(s) < abs(best_s):
                    best_cost = cost
                    best_s = s

        best_s = max(-12, min(12, int(best_s)))
        orig_key = actual_song.get("estimated_key", "Unknown")
        proj_key = project_key(orig_key, best_s)
        proj_low = midi_to_note_name(song_low + best_s)
        proj_high = midi_to_note_name(song_high + best_s)
        is_in_range = bool((song_low + best_s >= r_low) and (song_high + best_s <= r_high))

        return {
            "recommended_semitones": best_s,
            "projected_key": proj_key,
            "projected_low_note": proj_low,
            "projected_high_note": proj_high,
            "cost": round(float(best_cost), 2),
            "is_in_range": is_in_range,
            "target_preset": preset_name,
            "original_key": orig_key,
        }

    def get_voice_presets(self) -> dict[str, dict[str, Any]]:
        """Return the catalog of supported voice presets."""
        return VOICE_PRESETS
