"""Who sings which line: tells two voices apart on the vocal stem, line by line.

Songs with two voices are common (a rapper and a singer on the hook, a narrator and a lead),
and the lyric sources never say who sings what. Each line's audio on the vocal stem gives a
small voice print: its median pitch, how much of it is pitched rather than spoken or rapped,
and how bright it is. Two clusters of those prints that are clearly apart, in pitch above all,
are two voices; the one singing more becomes Singer 1 and the other Singer 2.

The test is strict on purpose: a wrong split is worse than none, so one voice, similar voices
or too few lines leave every line as it was.
"""

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from backend.services.vocal_analyzer import VocalRangeAnalyzer

logger = logging.getLogger(__name__)

# A line needs this much audio, and this many loud frames, to give a voice print
MIN_LINE_SEC = 0.6
MIN_ACTIVE_FRAMES = 4
# Two clusters count as two voices only when they are this well apart (mean silhouette),
# their median pitches this many semitones apart, and each holds at least this many lines
MIN_SILHOUETTE = 0.35
MIN_PITCH_GAP_SEMITONES = 4.0
MIN_LINES_PER_VOICE = 2
# Pitch matters most when telling voices apart
FEATURE_WEIGHTS = np.array([1.5, 1.0, 1.0])


@dataclass
class VoiceParts:
    """The outcome of detect_voice_parts: whether two voices were found, how clearly
    (``confidence``, the clusters' mean silhouette), and each line's part by line index."""

    detected: bool
    confidence: float = 0.0
    parts: dict[int, str] = field(default_factory=dict)
    reason: str = ""

    def report(self) -> dict[str, Any]:
        return {
            "detected": self.detected,
            "confidence": round(self.confidence, 3),
            "lines_singer2": sum(1 for p in self.parts.values() if p == "singer2"),
            "reason": self.reason,
        }


def _line_print(
    analyzer: VocalRangeAnalyzer, audio: np.ndarray, sr: int, start: float, end: float
) -> tuple[float, float, float] | None:
    """(median pitch in semitones, pitched share, log spectral centroid) of a span of the
    stem, or None when it holds too little voice."""
    a, b = max(0, int(start * sr)), min(len(audio), int(end * sr))
    seg = audio[a:b]
    n, hop = analyzer.frame_length, analyzer.hop_length
    if b - a < max(n, int(MIN_LINE_SEC * sr)):
        return None
    tau_min = max(2, int(sr / analyzer.max_freq))
    tau_max = min(n // 2, int(sr / analyzer.min_freq))
    window = np.hanning(n)
    freqs = np.fft.rfftfreq(n, 1.0 / sr)
    peak = float(np.max(np.abs(seg))) or 1.0
    pitches: list[float] = []
    centroids: list[float] = []
    active = 0
    for i in range(0, len(seg) - n + 1, hop):
        frame = seg[i : i + n]
        if float(np.sqrt(np.mean(frame**2))) < max(analyzer.energy_threshold, 0.05 * peak):
            continue
        active += 1
        spectrum = np.abs(np.fft.rfft(frame * window))
        total = float(spectrum.sum())
        if total > 0:
            centroids.append(float((freqs * spectrum).sum() / total))
        freq, _ = analyzer._detect_pitch_frame(frame, tau_min, tau_max, n - tau_max)
        if freq is not None:
            pitches.append(12.0 * math.log2(freq / 440.0) + 69.0)
    if active < MIN_ACTIVE_FRAMES or not centroids:
        return None
    pitch = float(np.median(pitches)) if len(pitches) >= 3 else math.nan
    return pitch, len(pitches) / active, math.log(max(1.0, float(np.median(centroids))))


def _kmeans_2(x: np.ndarray, iterations: int = 30) -> np.ndarray:
    """Labels 0/1 for two clusters, seeded at the lowest and highest first feature (pitch)
    so the result is the same on every run."""
    centers = np.stack([x[np.argmin(x[:, 0])], x[np.argmax(x[:, 0])]])
    labels = np.zeros(len(x), dtype=int)
    for _ in range(iterations):
        dist = np.linalg.norm(x[:, None, :] - centers[None, :, :], axis=2)
        new = np.argmin(dist, axis=1)
        if np.array_equal(new, labels) and _ > 0:
            break
        labels = new
        for k in (0, 1):
            if np.any(labels == k):
                centers[k] = x[labels == k].mean(axis=0)
    return labels


def _silhouette(x: np.ndarray, labels: np.ndarray) -> float:
    dist = np.linalg.norm(x[:, None, :] - x[None, :, :], axis=2)
    scores = []
    for i in range(len(x)):
        own = labels == labels[i]
        if own.sum() < 2:
            scores.append(0.0)
            continue
        a = dist[i, own].sum() / (own.sum() - 1)
        b = dist[i, ~own].mean()
        scores.append((b - a) / max(a, b, 1e-9))
    return float(np.mean(scores))


def detect_voice_parts(vocals_path: str | Path, lines: list[dict[str, Any]]) -> VoiceParts:
    """Each line's part, "singer1" or "singer2", when the stem clearly holds two voices."""
    analyzer = VocalRangeAnalyzer()
    try:
        audio, sr = analyzer._load_audio(vocals_path)
    except Exception as e:
        return VoiceParts(False, reason=f"could not read the vocals: {e}")
    prints: dict[int, tuple[float, float, float]] = {}
    sung: dict[int, float] = {}
    for idx, line in enumerate(lines):
        try:
            start, end = float(line.get("start_time", 0)), float(line.get("end_time", 0))
        except (TypeError, ValueError):
            continue
        p = _line_print(analyzer, audio, sr, start, end)
        if p is not None:
            prints[idx] = p
            sung[idx] = end - start
    if len(prints) < 2 * MIN_LINES_PER_VOICE:
        return VoiceParts(False, reason="too few lines with a clear voice")
    order = sorted(prints)
    raw = np.array([prints[i] for i in order], dtype=float)
    pitched = ~np.isnan(raw[:, 0])
    if pitched.sum() < 2 * MIN_LINES_PER_VOICE:
        return VoiceParts(False, reason="too few pitched lines")
    raw[~pitched, 0] = np.median(raw[pitched, 0])
    spread = raw.std(axis=0)
    x = (raw - raw.mean(axis=0)) / np.where(spread > 1e-9, spread, 1.0) * FEATURE_WEIGHTS
    labels = _kmeans_2(x)
    sizes = [int((labels == k).sum()) for k in (0, 1)]
    if min(sizes) < MIN_LINES_PER_VOICE:
        return VoiceParts(False, reason="one voice")
    gap = (
        abs(
            float(np.median(raw[(labels == 0) & pitched, 0]))
            - float(np.median(raw[(labels == 1) & pitched, 0]))
        )
        if all(((labels == k) & pitched).any() for k in (0, 1))
        else 0.0
    )
    score = _silhouette(x, labels)
    if score < MIN_SILHOUETTE or gap < MIN_PITCH_GAP_SEMITONES:
        return VoiceParts(False, confidence=max(0.0, score), reason="no clearly separate voices")
    seconds = [
        sum(sung[i] for i, lab in zip(order, labels, strict=True) if lab == k) for k in (0, 1)
    ]
    lead = 0 if seconds[0] >= seconds[1] else 1
    parts = {
        i: ("singer1" if lab == lead else "singer2") for i, lab in zip(order, labels, strict=True)
    }
    return VoiceParts(True, confidence=score, parts=parts, reason=f"{gap:.1f} semitones apart")


def assign_voice_parts(
    vocals_path: str | Path, lines: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], VoiceParts]:
    """The lines with their parts set by voice, when two voices are found and nobody has
    assigned parts yet (every line still Singer 1); otherwise the lines unchanged."""
    if any(str(line.get("singer") or "singer1") != "singer1" for line in lines):
        return lines, VoiceParts(False, reason="parts already assigned")
    try:
        found = detect_voice_parts(vocals_path, lines)
    except Exception as e:  # best effort: a song is never held back by this
        logger.warning(f"Voice part detection failed: {e}")
        return lines, VoiceParts(False, reason="detection failed")
    if not found.detected:
        return lines, found
    out = [
        {**line, "singer": found.parts[i]} if found.parts.get(i) == "singer2" else line
        for i, line in enumerate(lines)
    ]
    return out, found
