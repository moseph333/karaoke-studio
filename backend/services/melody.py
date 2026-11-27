"""The melody of a song: the pitch its singer holds, moment by moment.

Practice draws it for a singer to match. It is the vocal stem's pitch track (the frame by
frame pitches the vocal range analysis already hears, see ``VocalRangeAnalyzer.pitch_contour``)
tidied into something a voice can follow, and kept beside the stems as ``melody.json``.

The pitch detector follows one voice. Where the stem holds two (backing vocals under the
lead, a duet) it jumps between them, so the lead part is used when the song's vocals have
been split into lead and backing.

The file is current only while it was made by this version from the very file it would be
made from now: it records its source's name, size and modification time, and anything else
(new vocals after a re-separation, a split that came or went) means it is made again.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf

from backend.services import vocal_parts

logger = logging.getLogger("karaoke_backend")

# Bump when the melody of the same audio would come out differently (the detector's settings,
# the tidying below): files made before are then made again
MELODY_VERSION = 1
SIDECAR_NAME = "melody.json"

# A run this short an octave away from the notes on both sides is the detector slipping
_OCTAVE_RUN_SEC = 0.25
_OCTAVE = 12.0
_OCTAVE_SLACK = 1.5
# Neighbouring frames within this many semitones belong to one held note
_SAME_NOTE = 1.5
# A pause this short inside one note (a consonant) is drawn through
_BRIDGE_FRAMES = 2
_BRIDGE_SEMITONES = 1.0
_MEDIAN_FRAMES = 5
# A note shorter than this is a blip, not something to sing
_MIN_RUN_FRAMES = 3
# A neighbouring note counts when it is this close in time
_NEIGHBOUR_SEC = 0.3


class Unreadable(Exception):
    """The source audio cannot be read as audio."""


class SourceChanged(Exception):
    """The source audio was replaced while its melody was being worked out."""


def melody_source(vocals_path: str | os.PathLike) -> tuple[str, Path]:
    """What the melody is read from and what to call it: the lead part ("lead") when the
    vocals have been split into lead and backing, else the vocal stem ("vocals")."""
    vocals = Path(vocals_path)
    lead = vocal_parts.current_parts(vocals.parent).get("lead")
    return ("lead", lead) if lead else ("vocals", vocals)


def _stamp(path: Path) -> dict[str, Any] | None:
    try:
        stat = path.stat()
    except OSError:
        return None
    return {"name": path.name, "size": stat.st_size, "mtime_ns": stat.st_mtime_ns}


def _runs(voiced: np.ndarray) -> list[tuple[int, int]]:
    """The stretches of True in ``voiced`` as (first, one past last)."""
    edges = np.flatnonzero(np.diff(np.concatenate(([False], voiced, [False])).astype(np.int8)))
    return list(zip(edges[::2].tolist(), edges[1::2].tolist(), strict=True))


def _notes(midi: np.ndarray) -> list[tuple[int, int]]:
    """The sung stretches cut wherever the pitch steps to another note."""
    notes: list[tuple[int, int]] = []
    for first, end in _runs(~np.isnan(midi)):
        start = first
        for i in range(first + 1, end):
            if abs(midi[i] - midi[i - 1]) > _SAME_NOTE:
                notes.append((start, i))
                start = i
        notes.append((start, end))
    return notes


def _repair_octaves(midi: np.ndarray, hop: float) -> np.ndarray:
    """Moves a short note that sits an octave from the notes before and after it back to
    them. A leap that is held (a real one) stays."""
    notes = _notes(midi)
    longest = max(1, round(_OCTAVE_RUN_SEC / hop))
    near = max(1, round(_NEIGHBOUR_SEC / hop))
    medians = [float(np.median(midi[a:b])) for a, b in notes]
    out = midi.copy()
    for n, (a, b) in enumerate(notes):
        if b - a > longest or n == 0 or n == len(notes) - 1:
            continue
        before, after = notes[n - 1], notes[n + 1]
        if a - before[1] > near or after[0] - b > near:
            continue
        up = medians[n] - medians[n - 1], medians[n] - medians[n + 1]
        for sign in (1.0, -1.0):
            if all(abs(step * sign - _OCTAVE) <= _OCTAVE_SLACK for step in up):
                out[a:b] -= sign * _OCTAVE
    return out


def _bridge_gaps(midi: np.ndarray) -> np.ndarray:
    """Draws through a pause of a frame or two inside one note."""
    out = midi.copy()
    for a, b in _runs(np.isnan(midi)):
        if a == 0 or b == len(midi) or b - a > _BRIDGE_FRAMES:
            continue
        left, right = midi[a - 1], midi[b]
        if abs(left - right) <= _BRIDGE_SEMITONES:
            out[a:b] = np.linspace(left, right, b - a + 2)[1:-1]
    return out


def _smooth(midi: np.ndarray) -> np.ndarray:
    """Each sung frame as the median of the sung frames around it."""
    half = _MEDIAN_FRAMES // 2
    out = midi.copy()
    for i in np.flatnonzero(~np.isnan(midi)):
        window = midi[max(0, i - half) : i + half + 1]
        out[i] = float(np.nanmedian(window))
    return out


def _drop_blips(midi: np.ndarray) -> np.ndarray:
    out = midi.copy()
    for a, b in _runs(~np.isnan(midi)):
        if b - a < _MIN_RUN_FRAMES:
            out[a:b] = np.nan
    return out


def clean_contour(midi: np.ndarray, hop: float) -> np.ndarray:
    """A raw pitch track (MIDI note numbers, NaN where nothing is sung) made followable:
    octave slips put back, breaths inside a note drawn through, jitter evened out, and blips
    too short to sing dropped. ``hop`` is the time between frames in seconds."""
    midi = np.asarray(midi, dtype=float)
    if midi.size == 0:
        return midi
    return _drop_blips(_smooth(_bridge_gaps(_repair_octaves(midi, hop))))


def _payload(kind: str, hop: float, start: float, midi: np.ndarray) -> dict[str, Any]:
    sung = midi[~np.isnan(midi)]
    return {
        "version": MELODY_VERSION,
        "source": kind,
        "detected": bool(sung.size),
        "start": round(float(start), 4),
        "hop": round(float(hop), 4),
        # The range to draw: the odd stray note does not stretch it
        "low": round(float(np.percentile(sung, 5)), 1) if sung.size else None,
        "high": round(float(np.percentile(sung, 95)), 1) if sung.size else None,
        "midi": [None if np.isnan(note) else round(float(note), 1) for note in midi],
    }


def empty(kind: str = "vocals") -> dict[str, Any]:
    """The answer for audio that holds no melody to read."""
    return _payload(kind, 0.032, 0.064, np.array([], dtype=float))


def build(vocals_path: str | os.PathLike, analyzer: Any) -> dict[str, Any]:
    """Works out the melody from the song's vocals and returns it with a record of the file
    it came from (``made_from``), ready for ``write``. Raises Unreadable for a file that is
    not audio and SourceChanged when the file is replaced during the run."""
    kind, source = melody_source(vocals_path)
    before = _stamp(source)
    try:
        contour = analyzer.pitch_contour(str(source))
    except (sf.LibsndfileError, FileNotFoundError) as exc:
        raise Unreadable(str(exc)) from exc
    if before is None or _stamp(source) != before:
        raise SourceChanged(source.name)
    hop = float(contour["hop"])
    payload = _payload(kind, hop, contour["start"], clean_contour(contour["midi"], hop))
    return {**payload, "made_from": before}


def public(payload: dict[str, Any]) -> dict[str, Any]:
    """A stored melody without its bookkeeping."""
    return {key: value for key, value in payload.items() if key != "made_from"}


def read_current(vocals_path: str | os.PathLike) -> dict[str, Any] | None:
    """The melody kept beside the song's vocals, when it was made by this version from the
    file it would be made from now; None otherwise (also for a damaged file)."""
    _, source = melody_source(vocals_path)
    try:
        stored = json.loads((Path(vocals_path).parent / SIDECAR_NAME).read_text("utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(stored, dict) or stored.get("version") != MELODY_VERSION:
        return None
    if not isinstance(stored.get("midi"), list) or stored.get("made_from") != _stamp(source):
        return None
    return public(stored)


def write(vocals_path: str | os.PathLike, payload: dict[str, Any]) -> bool:
    """Keeps a melody beside the song's vocals. Never raises and never makes the folder (a
    song deleted meanwhile stays deleted); False when nothing was written."""
    target = Path(vocals_path).parent / SIDECAR_NAME
    staged = target.with_name(f"{SIDECAR_NAME}.tmp")
    try:
        staged.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
        os.replace(staged, target)
        return True
    except OSError as exc:
        logger.warning(f"Could not keep the melody beside {target.parent.name}: {exc}")
        try:
            staged.unlink(missing_ok=True)
        except OSError:
            pass
        return False
