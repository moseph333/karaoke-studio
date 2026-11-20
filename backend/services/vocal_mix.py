"""Which vocals stay in the backing track, and at what level.

The mixer takes one vocal input at one level (the guide vocal). A song's ``vocal_levels``
ask for more than that:

    backing            the level of the backing vocals, once the vocals are split into lead
                       and backing parts (see vocal_parts)
    by: "lines"        the lead follows who sings: singer1, singer2 and both each have a
                       level, applied during that singer's lyric lines
    by: "voices"       the lead is the male and the female voice it was split into (see
                       vocal_parts), each with a level: male and female

A key that is not set takes the guide level, and one whose stems are missing is ignored, so
the levels of a song survive its parts being dropped and made again. Singer levels likewise
wait for lines of more than one singer, and voice levels for the male/female split: until
then the lead is the guide vocal. plan_mix turns the
levels, the song's lines and the stems on disk into a MixPlan. When the plan asks for
nothing the mixer cannot already do (every vocal at one level), its ``key`` is None and the
mix is today's: the whole vocal stem at ``guide_volume``, under the same file name. Otherwise
write_kept_vocals sums each part at its gain into one temporary "kept vocals" file, which the
mixer then blends in at full level, and ``key`` names the mix so that a different choice, or
lines that moved, never serve an older file.

The gate that follows the lines is a curve of (time, gain) points: each line's level starts
LEAD_SECONDS before the line and holds TAIL_SECONDS after it, into time no line covers (a
sung note outlasts the last word's timing); lines sung together, and lines of different
singers that overlap, take the "both" level; the rest of the song takes the lowest level in
use, and every change is a RAMP_SECONDS fade.
"""

import hashlib
import itertools
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.services import vocal_parts

logger = logging.getLogger(__name__)

# Bump when the kept vocals of the same levels and lines would sound different
VOCAL_MIX_VERSION = "1"
BY_LINES = "lines"
BY_VOICES = "voices"
SINGER_KEYS = ("singer1", "singer2", "both")
VOICE_KEYS = ("male", "female")
LEVEL_KEYS = ("backing", *SINGER_KEYS, *VOICE_KEYS)
LEAD_SECONDS = 0.15
TAIL_SECONDS = 1.0
RAMP_SECONDS = 0.05
_SILENT = 0.001  # the mixer leaves the vocals out below this level
_BLOCK_FRAMES = 65536

Gate = tuple[tuple[float, float], ...]


@dataclass(frozen=True)
class PartMix:
    """One stem of the kept vocals: at a constant gain, or following a gate curve."""

    path: str
    gain: float = 1.0
    gate: Gate | None = None


@dataclass(frozen=True)
class MixPlan:
    """How to mix a song's vocals in. ``key`` None: the whole vocal stem at ``guide_volume``,
    as the mixer has always done. Otherwise ``parts`` are summed into the kept vocals and
    ``key`` goes into the mix's file name; ``sources`` are the files that date it."""

    guide_volume: float
    key: str | None = None
    parts: tuple[PartMix, ...] = ()
    sources: tuple[str, ...] = ()


def _level(value: Any, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    if value != value:  # NaN
        return default
    return round(min(1.0, max(0.0, float(value))), 2)


def normalize_levels(raw: Any) -> dict[str, Any]:
    """The levels a song stores: known keys only, each level within 0-1 to two decimals.
    Empty when nothing is asked."""
    if not isinstance(raw, dict):
        return {}
    levels: dict[str, Any] = {}
    for key in LEVEL_KEYS:
        if raw.get(key) is not None:
            levels[key] = _level(raw[key], 0.0)
    if raw.get("by") in (BY_LINES, BY_VOICES):
        levels["by"] = raw["by"]
    return levels


def any_vocal_kept(guide_volume: Any, levels: Any, threshold: float = 0.05) -> bool:
    """Whether a mix with these settings can have any of the song's vocals in it."""
    kept = [_level(guide_volume, 0.0)]
    if isinstance(levels, dict):
        kept += [_level(levels.get(key), 0.0) for key in LEVEL_KEYS]
    return max(kept) > threshold


def _line_spans(lines: Any) -> list[tuple[float, float, str]]:
    spans = []
    for line in lines if isinstance(lines, list) else []:
        if not isinstance(line, dict):
            continue
        try:
            start, end = float(line.get("start_time")), float(line.get("end_time"))
        except (TypeError, ValueError):
            continue
        if not (0 <= start < end):
            continue
        singer = line.get("singer")
        spans.append((start, end, singer if singer in SINGER_KEYS else "singer1"))
    return spans


def _covered_runs(spans: list[tuple[float, float, str]]) -> list[tuple[float, float, str]]:
    """The stretches of the song inside lyric lines, in order, each with who sings it: one
    singer, or "both" where a line is sung together or lines of two singers overlap."""
    edges = sorted({t for start, end, _ in spans for t in (start, end)})
    runs: list[tuple[float, float, str]] = []
    for left, right in itertools.pairwise(edges):
        singing = {singer for start, end, singer in spans if start < right and end > left}
        if not singing:
            continue
        who = next(iter(singing)) if len(singing) == 1 else "both"
        if runs and runs[-1][2] == who and runs[-1][1] == left:
            runs[-1] = (runs[-1][0], right, who)
        else:
            runs.append((left, right, who))
    return runs


def gate_curve(lines: Any, levels: dict[str, float]) -> Gate | None:
    """The gain of the lead over time for these singer levels, as (seconds, gain) points to
    interpolate between, or None when it never changes (no lines, or one level throughout).
    Times are rounded to the millisecond, so the same lines always give the same curve."""
    runs = _covered_runs(_line_spans(lines))
    if not runs:
        return None
    in_use = {levels[who] for _, _, who in runs}
    floor = min(in_use)
    if len(in_use) == 1:
        return None

    # Piecewise-constant steps (from, level), with each run widened into the silence around it
    steps: list[tuple[float, float]] = [(0.0, floor)]

    def step(at: float, level: float) -> None:
        at = max(at, steps[-1][0])
        if steps[-1][0] == at:
            steps[-1] = (at, level)
        elif steps[-1][1] != level:
            steps.append((at, level))

    previous_end: float | None = None
    for start, end, who in runs:
        if previous_end is None:
            step(max(0.0, start - LEAD_SECONDS), levels[who])
        elif start > previous_end:
            # The line before holds on into the gap, this one starts a little early
            tail_end = max(previous_end, min(previous_end + TAIL_SECONDS, start - LEAD_SECONDS))
            step(tail_end, floor)
            step(max(tail_end, start - LEAD_SECONDS), levels[who])
        else:
            step(start, levels[who])
        previous_end = end
    step(previous_end + TAIL_SECONDS, floor)

    # Drop steps a later one overwrote at the same instant, then fade across each change
    merged: list[tuple[float, float]] = []
    for at, level in steps:
        if merged and merged[-1][1] == level:
            continue
        merged.append((at, level))
    if len(merged) == 1:
        return None
    points: list[tuple[float, float]] = [(0.0, merged[0][1])]
    half = RAMP_SECONDS / 2
    for (_, before), (at, after) in itertools.pairwise(merged):
        for time_at, gain in ((at - half, before), (at + half, after)):
            time_at = round(max(time_at, points[-1][0] + 0.001), 3)
            points.append((time_at, gain))
    return tuple(points)


def _plan_key(parts: tuple[PartMix, ...]) -> str:
    digest = hashlib.sha1(VOCAL_MIX_VERSION.encode(), usedforsecurity=False)
    for part in parts:
        digest.update(f"|{Path(part.path).name}:{part.gain:.2f}".encode())
        for at, gain in part.gate or ():
            digest.update(f";{at:.3f}={gain:.2f}".encode())
    return digest.hexdigest()[:8]


def plan_mix(vocals_path: Any, lines: Any, guide_volume: Any, levels: Any) -> MixPlan:
    """How to mix in the vocals of a song whose vocal stem is at vocals_path, for a guide
    level and the song's vocal_levels (see the module docstring)."""
    guide = _level(guide_volume, 0.0)
    asked = normalize_levels(levels)
    if not asked or not isinstance(vocals_path, str) or not vocals_path:
        return MixPlan(guide)
    parts = vocal_parts.current_parts(Path(vocals_path).parent)
    split = "lead" in parts and "backing" in parts

    lead_gain, gate = guide, None
    if asked.get("by") == BY_LINES:
        singers = {key: asked.get(key, guide) for key in SINGER_KEYS}
        runs = _covered_runs(_line_spans(lines))
        # A song with one singer has nothing to divide: its lead stays the guide vocal, which
        # is the one control the studio then shows for it
        if len({who for _, _, who in runs}) > 1:
            gate = gate_curve(lines, singers)
            if gate is None:
                lead_gain = singers[runs[0][2]]  # every singer at one level

    if asked.get("by") == BY_VOICES and all(voice in parts for voice in VOICE_KEYS):
        # The two voices are what the lead was split into (the whole vocal stem, for a song
        # without a lead/backing split), so they stand in for it
        kept = [PartMix(str(parts[voice]), asked.get(voice, guide)) for voice in VOICE_KEYS]
    else:
        lead_path = str(parts["lead"]) if split else vocals_path
        # A gated part's gain is all in its curve
        kept = [PartMix(lead_path, 1.0 if gate else lead_gain, gate)]
    if split:
        kept.append(PartMix(str(parts["backing"]), asked.get("backing", guide)))

    gains = {part.gain for part in kept}
    if gate is None and len(gains) == 1:
        # Every vocal at one level, which is what the guide vocal already is
        return MixPlan(gains.pop())
    audible = tuple(part for part in kept if part.gate is not None or part.gain > _SILENT)
    if not audible:
        return MixPlan(0.0)
    return MixPlan(
        guide,
        key=_plan_key(audible),
        parts=audible,
        sources=tuple(part.path for part in audible),
    )


def write_kept_vocals(plan: MixPlan, target: Path) -> Path:
    """Sums the plan's parts, each at its gain or following its gate, into one WAV at target.

    Read and written a block at a time, so a long song costs no more memory than a short one,
    and as 32-bit float, so parts that add up past full scale reach the mixer's limiter
    unclipped. A mono part is repeated on every channel and a shorter one ends in silence;
    parts at different sample rates cannot be summed and raise RuntimeError."""
    import numpy as np
    import soundfile as sf

    opened = [sf.SoundFile(part.path) for part in plan.parts]
    try:
        if not opened:
            raise RuntimeError("No vocal part to keep")
        rates = {audio.samplerate for audio in opened}
        if len(rates) != 1:
            raise RuntimeError(f"The vocal parts disagree on sample rate ({sorted(rates)})")
        rate = rates.pop()
        channels = max(audio.channels for audio in opened)
        frames = max(len(audio) for audio in opened)
        curves = [
            (
                np.array([at for at, _ in part.gate], dtype="float64"),
                np.array([gain for _, gain in part.gate], dtype="float64"),
            )
            if part.gate
            else None
            for part in plan.parts
        ]
        with sf.SoundFile(
            str(target), "w", samplerate=rate, channels=channels, subtype="FLOAT", format="WAV"
        ) as out:
            position = 0
            while position < frames:
                count = min(_BLOCK_FRAMES, frames - position)
                total = np.zeros((count, channels), dtype="float32")
                for part, audio, curve in zip(plan.parts, opened, curves, strict=True):
                    block = audio.read(count, dtype="float32", always_2d=True)
                    if not len(block):
                        continue
                    if block.shape[1] != channels:
                        block = np.repeat(block[:, :1], channels, axis=1)
                    if curve is None:
                        block = block * np.float32(part.gain)
                    else:
                        times = (position + np.arange(len(block))) / rate
                        gains = np.interp(times, curve[0], curve[1]).astype("float32")
                        block = block * gains[:, None]
                    total[: len(block)] += block
                out.write(total)
                position += count
    finally:
        for audio in opened:
            audio.close()
    return target
