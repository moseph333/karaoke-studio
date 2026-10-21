"""CPU-based Harmonic Chord Progression Detector and Key-Aware Transposition Engine.

Implements Short-Time Fourier Transform (STFT), 12-bin log-frequency Pitch Class
Profile (chroma) filterbank across [65Hz, 2100Hz], 60 chord templates covering
Major, Minor, Dominant 7th, Major 7th, Minor 7th harmonies, energy gating,
modal temporal smoothing, flicker pruning (<0.3s), and circle-of-fifths key-aware
chromatic transposition without librosa or heavy ML dependencies.
"""

from __future__ import annotations

import logging
import math
import re
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import scipy.signal
import soundfile as sf

logger = logging.getLogger("karaoke_backend")

# Canonical 12-pitch chromatic scales
SHARP_SCALE: list[str] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
FLAT_SCALE: list[str] = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]

# Mapping from any recognized note spelling to pitch class integer (0-11)
NOTE_TO_PITCH_CLASS: dict[str, int] = {
    # Naturals
    "C": 0,
    "D": 2,
    "E": 4,
    "F": 5,
    "G": 7,
    "A": 9,
    "B": 11,
    # Sharps
    "C#": 1,
    "D#": 3,
    "E#": 5,
    "F#": 6,
    "G#": 8,
    "A#": 10,
    "B#": 0,
    # Flats
    "CB": 11,
    "DB": 1,
    "EB": 3,
    "FB": 4,
    "GB": 6,
    "AB": 8,
    "BB": 10,
}

# Key classifications for enharmonic spelling preference
FLAT_KEYS: set[tuple[str, str]] = {
    # Major keys
    ("F", "major"),
    ("BB", "major"),
    ("EB", "major"),
    ("AB", "major"),
    ("DB", "major"),
    ("GB", "major"),
    ("CB", "major"),
    # Minor keys
    ("D", "minor"),
    ("G", "minor"),
    ("C", "minor"),
    ("F", "minor"),
    ("BB", "minor"),
    ("EB", "minor"),
    ("AB", "minor"),
}

SHARP_KEYS: set[tuple[str, str]] = {
    # Major keys
    ("G", "major"),
    ("D", "major"),
    ("A", "major"),
    ("E", "major"),
    ("B", "major"),
    ("F#", "major"),
    ("C#", "major"),
    # Minor keys
    ("E", "minor"),
    ("B", "minor"),
    ("F#", "minor"),
    ("C#", "minor"),
    ("G#", "minor"),
    ("D#", "minor"),
    ("A#", "minor"),
}

CHORD_REGEX = re.compile(r"^([A-Ga-g][#b♯♭]?)(.*)$")
NO_CHORD_VALUES: set[str] = {"N", "N.C.", "NC", "NO-CHORD", "NONE", ""}

# Supported chord qualities and relative pitch class intervals
CHORD_QUALITIES: dict[str, list[int]] = {
    "": [0, 4, 7],  # Major triad
    "m": [0, 3, 7],  # Minor triad
    "7": [0, 4, 7, 10],  # Dominant 7th
    "maj7": [0, 4, 7, 11],  # Major 7th
    "m7": [0, 3, 7, 10],  # Minor 7th
}


class ChordList(list):
    """List of chord segment dictionaries with dict-compatible 'chords' access."""

    def get(self, key: str, default: Any = None) -> Any:
        if key == "chords":
            return self
        return default

    def __getitem__(self, item: Any) -> Any:
        if item == "chords":
            return self
        return super().__getitem__(item)

    def __contains__(self, item: Any) -> bool:
        if item == "chords":
            return True
        return super().__contains__(item)


def parse_chord_symbol(chord: str) -> tuple[str, str, str | None] | None:
    """Parse a chord string into (root, quality, optional_bass).

    Returns None if the chord is empty or a no-chord symbol.
    """
    if not chord:
        return None
    trimmed = chord.strip()
    if trimmed.upper() in NO_CHORD_VALUES:
        return None

    # Handle slash chords (e.g. "C/G", "Am7/F#")
    if "/" in trimmed:
        main_part, bass_part = trimmed.split("/", 1)
        main_part = main_part.strip()
        bass_part = bass_part.strip()
        if bass_part:
            b_match = CHORD_REGEX.match(bass_part)
            if b_match:
                b_raw = b_match.group(1)
                b_letter = b_raw[0].upper()
                b_acc = b_raw[1:] if len(b_raw) > 1 else ""
                if b_acc in ("#", "♯"):
                    b_acc = "#"
                elif b_acc.lower() in ("b", "♭"):
                    b_acc = "b"
                bass_part = f"{b_letter}{b_acc}"
        else:
            bass_part = None
    else:
        main_part = trimmed
        bass_part = None

    match = CHORD_REGEX.match(main_part)
    if not match:
        return None

    raw_root, raw_quality = match.group(1), match.group(2)
    letter = raw_root[0].upper()
    accidental = raw_root[1:] if len(raw_root) > 1 else ""
    if accidental in ("#", "♯"):
        accidental = "#"
    elif accidental.lower() in ("b", "♭"):
        accidental = "b"
    normalized_root = f"{letter}{accidental}"

    if normalized_root.upper() not in NOTE_TO_PITCH_CLASS:
        return None

    return normalized_root, raw_quality, bass_part


def classify_key_spelling(key: str | None, original_chord: str = "") -> str:
    """Determine whether to use 'flat' or 'sharp' scale based on key context and chord accidental."""
    if not key or key.strip().upper() in ("UNKNOWN", "NONE", ""):
        return "flat" if "b" in original_chord.lower() else "sharp"

    clean_key = key.strip()
    parts = clean_key.split()

    if len(parts) >= 2:
        root_str = parts[0]
        mode_str = parts[1].lower()
    else:
        match = re.match(r"^([A-Ga-g][#bB]?)(.*)$", clean_key)
        if match:
            root_str = match.group(1)
            mode_str = match.group(2).lower()
        else:
            root_str = clean_key
            mode_str = ""

    root_upper = root_str[0].upper()
    if len(root_str) > 1:
        acc = root_str[1:].lower()
        if acc in ("#", "♯"):
            root_upper += "#"
        elif acc in ("b", "♭"):
            root_upper += "B"
    if root_upper == "BB" and len(root_str) > 1 and root_str[1:].upper() == "B":
        root_upper = "BB"

    mode = (
        "minor"
        if (mode_str.startswith("min") or mode_str == "m" or mode_str == "minor")
        else "major"
    )
    key_tuple = (root_upper, mode)

    if key_tuple in FLAT_KEYS:
        return "flat"
    if key_tuple in SHARP_KEYS:
        return "sharp"

    # Neutral keys (C Major, A Minor) fallback: check original chord accidental
    return "flat" if "b" in original_chord.lower() else "sharp"


def project_key_signature(key: str | None, semitones: int) -> str:
    """Project a musical key signature through semitone transposition using circle of fifths."""
    if not key or key.strip().upper() in ("UNKNOWN", "NONE", "") or semitones == 0:
        return key or "C Major"
    clean = key.strip()
    match = re.match(r"^([A-Ga-g][#bB]?)(.*)$", clean)
    if not match:
        return clean
    root_str, mode = match.group(1), match.group(2)
    root_upper = root_str.upper()
    if root_upper not in NOTE_TO_PITCH_CLASS:
        return clean
    orig_pc = NOTE_TO_PITCH_CLASS[root_upper]
    new_pc = (orig_pc + semitones) % 12
    mode_lower = mode.strip().lower()
    is_minor = mode_lower.startswith("min") or mode_lower.endswith("m") or mode_lower == "m"

    prefer_flat = new_pc in [2, 7, 0, 5, 10, 3] if is_minor else new_pc in [5, 10, 3, 8, 1, 6]
    new_root = FLAT_SCALE[new_pc] if prefer_flat else SHARP_SCALE[new_pc]
    return f"{new_root}{mode}".strip()


def _transpose_root(
    root: str, semitones: int, spelling: str, preserve_accidental: bool = False
) -> str:
    """Transpose a root note string by semitones using the chosen spelling scale."""
    root_key = root.upper()
    if root_key not in NOTE_TO_PITCH_CLASS:
        return root

    pitch_class = NOTE_TO_PITCH_CLASS[root_key]

    if preserve_accidental:
        letter = root[0].upper()
        acc = root[1:] if len(root) > 1 else ""
        return f"{letter}{acc}"

    shifted_pc = (pitch_class + semitones) % 12
    scale = FLAT_SCALE if spelling == "flat" else SHARP_SCALE
    return scale[shifted_pc]


def transpose_chord(
    chord: str,
    semitones: int,
    key: str | None = None,
    target_key: str | None = None,
) -> str:
    """Transpose a single chord symbol by semitones with key-aware enharmonic spelling.

    Args:
        chord: Chord symbol (e.g. "C", "Am", "G7", "Cmaj7", "Dm7", "N", "C/G").
        semitones: Integer shift in [-12, +12].
        key: Key context (e.g. "F Major", "Bb", "B Minor", "G").
        target_key: Optional explicit target key override.

    Returns:
        Transposed chord symbol string.
    """
    if not (-12 <= semitones <= 12):
        raise ValueError(f"semitones must be in range [-12, 12], got {semitones}")

    # 0 is strict identity
    if semitones == 0:
        return chord

    # Silence / no-chord
    if not chord or chord.strip().upper() in NO_CHORD_VALUES:
        return "N"

    parsed = parse_chord_symbol(chord)
    if parsed is None:
        return chord

    root, quality, bass = parsed
    eff_key = target_key or key
    spelling = classify_key_spelling(eff_key, chord)
    preserve_accidental = semitones in (-12, 12)

    new_root = _transpose_root(root, semitones, spelling, preserve_accidental)

    if bass:
        new_bass = _transpose_root(bass, semitones, spelling, preserve_accidental)
        return f"{new_root}{quality}/{new_bass}"

    return f"{new_root}{quality}"


def transpose_chord_progression(
    chords: list[dict[str, Any]],
    semitones: int,
    key: str | None = None,
    target_key: str | None = None,
) -> list[dict[str, Any]]:
    """Transpose an entire chord progression non-destructively.

    Args:
        chords: List of chord segment dicts (each having at least 'start', 'end', 'chord').
        semitones: Integer shift in [-12, +12].
        key: Key context.
        target_key: Optional explicit target key override.

    Returns:
        New list of chord segment dicts with transposed 'chord' values.
    """
    if not (-12 <= semitones <= 12):
        raise ValueError(f"semitones must be in range [-12, 12], got {semitones}")

    if not chords:
        return []

    if semitones == 0:
        return [dict(seg) for seg in chords]

    result = []
    eff_key = target_key or key
    for seg in chords:
        new_seg = dict(seg)
        if "chord" in new_seg and isinstance(new_seg["chord"], str):
            new_seg["chord"] = transpose_chord(new_seg["chord"], semitones, key=eff_key)
        result.append(new_seg)

    return result


class ChordDetector:
    """CPU-bound harmonic chord progression detector using STFT and Chroma filterbank."""

    def __init__(
        self,
        sample_rate: int = 22050,
        nperseg: int = 4096,
        hop_length: int = 2048,
        f_min: float = 65.0,
        f_max: float = 2100.0,
        energy_threshold: float = 0.005,
        chroma_flatness_threshold: float = 0.20,
        confidence_cutoff: float = 0.35,
        min_duration: float = 0.30,
        sigma: float = 0.5,
    ) -> None:
        self.sample_rate = sample_rate
        self.nperseg = nperseg
        self.hop_length = hop_length
        self.f_min = f_min
        self.f_max = f_max
        self.energy_threshold = energy_threshold
        self.chroma_flatness_threshold = chroma_flatness_threshold
        self.confidence_cutoff = confidence_cutoff
        self.min_duration = min_duration
        self.sigma = sigma

        self._init_chroma_filterbank()
        self._init_chord_templates()

    def _init_chroma_filterbank(self) -> None:
        freqs = np.fft.rfftfreq(self.nperseg, 1.0 / self.sample_rate)
        valid_mask = (freqs >= self.f_min) & (freqs <= self.f_max)
        valid_freqs = freqs[valid_mask]
        valid_indices = np.where(valid_mask)[0]
        midi_pitches = 69.0 + 12.0 * np.log2(valid_freqs / 440.0)

        chroma_filters = np.zeros((12, len(freqs)), dtype=np.float32)
        for pc in range(12):
            diff = (midi_pitches - pc + 6.0) % 12.0 - 6.0
            weights = np.exp(-0.5 * (diff / self.sigma) ** 2)
            octave_weight = np.exp(-0.5 * ((midi_pitches - 60.0) / 24.0) ** 2)
            chroma_filters[pc, valid_indices] = weights * octave_weight

        row_norms = np.linalg.norm(chroma_filters, axis=1, keepdims=True)
        row_norms[row_norms == 0] = 1.0
        self.chroma_filters = (chroma_filters / row_norms).astype(np.float32)

    def _init_chord_templates(self) -> None:
        template_names = []
        template_matrix = []
        for root_idx, root_name in enumerate(SHARP_SCALE):
            for q_name, intervals in CHORD_QUALITIES.items():
                vec = np.zeros(12, dtype=np.float32)
                pcs = [(root_idx + iv) % 12 for iv in intervals]
                vec[pcs] = 1.0
                vec_zm = vec - np.mean(vec)
                norm = float(np.linalg.norm(vec_zm))
                if norm > 1e-9:
                    vec_zm /= norm
                template_matrix.append(vec_zm)
                template_names.append(f"{root_name}{q_name}")

        self.template_matrix = np.array(template_matrix, dtype=np.float32)
        self.template_names = template_names

    def _load_audio(
        self, audio_input: str | Path | np.ndarray, sr: int | None = None
    ) -> tuple[np.ndarray, int]:
        """Loads audio file or formats numpy array, downmixing to mono and scrubbing non-finites."""
        if isinstance(audio_input, (str, Path)):
            p = Path(audio_input)
            if not p.is_file():
                raise FileNotFoundError(f"Audio file not found: {p}")
            if p.stat().st_size == 0:
                return np.array([], dtype=np.float32), self.sample_rate
            data, in_sr = sf.read(str(p), dtype="float32")
        else:
            data = audio_input
            in_sr = sr or self.sample_rate

        if data is None or data.size == 0:
            return np.array([], dtype=np.float32), self.sample_rate

        mono = np.mean(data, axis=1) if data.ndim > 1 else data.astype(np.float32, copy=False)
        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0)

        if in_sr != self.sample_rate and len(mono) > 0:
            gcd = math.gcd(in_sr, self.sample_rate)
            up = self.sample_rate // gcd
            down = in_sr // gcd
            mono = scipy.signal.resample_poly(mono, up, down).astype(np.float32)

        return mono, self.sample_rate

    def detect_chords(
        self,
        audio_input: str | Path | np.ndarray,
        sr: int | None = None,
        filter_no_chord: bool = False,
    ) -> ChordList:
        """Detect time-aligned chord segments from audio input."""
        mono, _ = self._load_audio(audio_input, sr=sr)
        total_samples = len(mono)
        if total_samples < self.nperseg:
            return ChordList([])

        total_dur = total_samples / self.sample_rate
        _f, frame_centers, Zxx = scipy.signal.stft(
            mono,
            fs=self.sample_rate,
            window="hann",
            nperseg=self.nperseg,
            noverlap=self.nperseg - self.hop_length,
            boundary="zeros",
        )

        mag = np.abs(Zxx)
        chroma = self.chroma_filters @ mag
        n_frames = len(frame_centers)

        labels: list[str] = []
        confidences: list[float] = []
        frame_times: list[tuple[float, float]] = []

        half_hop = (self.hop_length / self.sample_rate) / 2.0
        for i in range(n_frames):
            t_mid = float(frame_centers[i])
            t_start = max(0.0, t_mid - half_hop)
            t_end = min(total_dur, t_mid + half_hop)
            frame_times.append((t_start, t_end))

            start_samp = int(max(0, i * self.hop_length - self.nperseg // 2))
            end_samp = min(total_samples, start_samp + self.nperseg)
            frame_samp = mono[start_samp:end_samp]
            rms = float(np.sqrt(np.mean(frame_samp**2))) if len(frame_samp) > 0 else 0.0

            c = chroma[:, i]
            c_std = float(np.std(c))
            c_mean = float(np.mean(c))

            # Silence and flat noise gating
            if (
                rms < self.energy_threshold
                or c_std < 1e-6
                or (c_std / (c_mean + 1e-9)) < self.chroma_flatness_threshold
            ):
                labels.append("N")
                confidences.append(0.0)
                continue

            c_zm = c - c_mean
            c_norm = float(np.linalg.norm(c_zm))
            if c_norm < 1e-9:
                labels.append("N")
                confidences.append(0.0)
                continue

            c_zm /= c_norm
            sims = self.template_matrix @ c_zm
            best_idx = int(np.argmax(sims))
            best_sim = float(sims[best_idx])

            if best_sim < self.confidence_cutoff:
                labels.append("N")
                confidences.append(round(max(0.0, best_sim), 3))
            else:
                labels.append(self.template_names[best_idx])
                confidences.append(round(min(1.0, max(0.0, best_sim)), 3))

        return self.smooth_segments(
            labels,
            confidences,
            frame_times,
            total_dur,
            min_duration=self.min_duration,
            filter_no_chord=filter_no_chord,
        )

    def smooth_segments(
        self,
        labels: list[str],
        confidences: list[float],
        frame_times: list[tuple[float, float]],
        total_duration: float,
        min_duration: float = 0.30,
        filter_no_chord: bool = False,
    ) -> ChordList:
        """Applies modal filter, run-length grouping, flicker pruning, and monotonic interval clamping."""
        n = len(labels)
        if n == 0:
            return ChordList([])

        # 1. 3-frame modal smoothing
        smoothed = list(labels)
        for i in range(n):
            window = labels[max(0, i - 1) : min(n, i + 2)]
            counts = Counter(window)
            smoothed[i] = counts.most_common(1)[0][0]

        # 2. Run-length grouping
        raw_segments: list[dict[str, Any]] = []
        cur_chord = smoothed[0]
        cur_start = frame_times[0][0]
        cur_end = frame_times[0][1]
        cur_confs = [confidences[0]]

        for i in range(1, n):
            if smoothed[i] == cur_chord:
                cur_end = frame_times[i][1]
                cur_confs.append(confidences[i])
            else:
                raw_segments.append(
                    {
                        "start": round(float(cur_start), 3),
                        "end": round(float(cur_end), 3),
                        "chord": cur_chord,
                        "confidence": round(float(np.mean(cur_confs)), 3),
                    }
                )
                cur_chord = smoothed[i]
                cur_start = frame_times[i][0]
                cur_end = frame_times[i][1]
                cur_confs = [confidences[i]]

        raw_segments.append(
            {
                "start": round(float(cur_start), 3),
                "end": round(float(cur_end), 3),
                "chord": cur_chord,
                "confidence": round(float(np.mean(cur_confs)), 3),
            }
        )

        # 3. Iterative flicker pruning (< min_duration)
        changed = True
        while changed and len(raw_segments) > 1:
            changed = False
            for idx, seg in enumerate(raw_segments):
                if (seg["end"] - seg["start"]) < min_duration:
                    changed = True
                    if idx == 0:
                        raw_segments[1]["start"] = seg["start"]
                        raw_segments.pop(0)
                    elif idx == len(raw_segments) - 1:
                        raw_segments[idx - 1]["end"] = seg["end"]
                        raw_segments.pop(idx)
                    else:
                        prev_s = raw_segments[idx - 1]
                        next_s = raw_segments[idx + 1]
                        if prev_s["chord"] == next_s["chord"]:
                            prev_s["end"] = next_s["end"]
                            raw_segments.pop(idx + 1)
                            raw_segments.pop(idx)
                        elif (prev_s["end"] - prev_s["start"]) >= (next_s["end"] - next_s["start"]):
                            prev_s["end"] = seg["end"]
                            raw_segments.pop(idx)
                        else:
                            next_s["start"] = seg["start"]
                            raw_segments.pop(idx)
                    break

        # 4. Consolidate adjacent identical chords resulting from mergers
        merged: list[dict[str, Any]] = []
        for s in raw_segments:
            if merged and merged[-1]["chord"] == s["chord"]:
                merged[-1]["end"] = s["end"]
                merged[-1]["confidence"] = round(
                    (merged[-1]["confidence"] + s["confidence"]) / 2.0, 3
                )
            else:
                merged.append(s)

        # 5. Boundary clamping
        if merged:
            merged[0]["start"] = 0.0
            merged[-1]["end"] = round(total_duration, 3)

        # 6. Monotonicity enforcement and ID assignment
        for i in range(len(merged)):
            merged[i]["id"] = f"chord-{i}"
            if i > 0 and merged[i]["start"] < merged[i - 1]["end"]:
                merged[i]["start"] = merged[i - 1]["end"]
            if merged[i]["end"] <= merged[i]["start"]:
                merged[i]["end"] = round(merged[i]["start"] + 0.01, 3)

        if filter_no_chord:
            merged = [s for s in merged if s["chord"] != "N"]
            # Re-index IDs if filtered
            for i, s in enumerate(merged):
                s["id"] = f"chord-{i}"

        return ChordList(merged)
