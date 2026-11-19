"""The audio side of picking songs out of an album recording (see ``album_tracks``): a
loudness curve of the whole recording, read through FFmpeg a little at a time so a long album
never sits in memory; the cuts between songs, moved to the quietest moment near where the
chapters or the catalog lengths put them, or found from the pauses alone; one song cut out
as the studio's WAV; and the chapters an uploaded file carries."""

import json
import logging
import subprocess
import threading
from pathlib import Path

import numpy as np

from backend.errors import public_error

logger = logging.getLogger(__name__)

# The loudness curve: one value (dBFS) every HOP_SECONDS of a mono copy at ENVELOPE_RATE
ENVELOPE_RATE = 8000
HOP_SECONDS = 0.05
_HOP = int(ENVELOPE_RATE * HOP_SECONDS)
SILENT_DB = -90.0
# Curve values averaged over this long before the quietest moment is chosen
SMOOTH_SECONDS = 0.4
# How far a cut may move: chapters are written to the second, catalog lengths drift with the
# silence an upload adds between songs
CHAPTER_WINDOW_SEC = 2.5
CATALOG_WINDOW_SEC = 12.0
# A cut further from where it was expected costs this much (dB per second), so of two equally
# quiet moments the nearer wins
DISTANCE_COST_DB = 0.6
# The quiet stretch a cut is centred in: as quiet as the quietest moment within this many dB,
# and no wider than this on either side of it
QUIET_SPREAD_DB = 3.0
QUIET_SPREAD_MAX_SEC = 4.0
# Pauses that separate songs when nothing names them
PAUSE_MIN_SEC = 1.0
PAUSE_BELOW_LOUD_DB = 32.0
PAUSE_CEILING_DB = -40.0
SONG_MIN_SEC = 45.0
# How long FFmpeg may take: reading a long album, and cutting one song out of it
ENVELOPE_TIMEOUT_SEC = 600
CUT_TIMEOUT_SEC = 300


class AlbumAudioError(RuntimeError):
    """FFmpeg could not read or cut the album's audio."""


def loudness_envelope(path: str | Path, cancel_event: threading.Event | None = None) -> np.ndarray:
    """The recording's loudness every HOP_SECONDS, in dBFS (SILENT_DB for digital silence)."""
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        str(ENVELOPE_RATE),
        "-f",
        "s16le",
        "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    timer = threading.Timer(ENVELOPE_TIMEOUT_SEC, proc.kill)
    timer.start()
    values: list[np.ndarray] = []
    leftover = np.zeros(0, dtype=np.float32)
    try:
        assert proc.stdout is not None
        while True:
            if cancel_event is not None and cancel_event.is_set():
                proc.kill()
                raise RuntimeError("Processing cancelled by user")
            chunk = proc.stdout.read(_HOP * 2 * 2000)
            if not chunk:
                break
            samples = np.frombuffer(chunk[: len(chunk) // 2 * 2], dtype="<i2").astype(np.float32)
            samples = np.concatenate([leftover, samples / 32768.0])
            whole = len(samples) // _HOP * _HOP
            frames = samples[:whole].reshape(-1, _HOP)
            leftover = samples[whole:]
            values.append(np.sqrt(np.mean(frames * frames, axis=1)))
        stderr = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
        if proc.wait() != 0:
            raise AlbumAudioError(f"FFmpeg could not read the album: {public_error(stderr)}")
    finally:
        timer.cancel()
        if proc.poll() is None:
            proc.kill()
            proc.wait()
    rms = np.concatenate(values) if values else np.zeros(0, dtype=np.float32)
    with np.errstate(divide="ignore"):
        db = 20.0 * np.log10(rms)
    return np.maximum(db, SILENT_DB).astype(np.float32)


def _smoothed(envelope: np.ndarray) -> np.ndarray:
    width = max(1, round(SMOOTH_SECONDS / HOP_SECONDS))
    if len(envelope) < width:
        return envelope
    return np.convolve(envelope, np.ones(width) / width, mode="same")


def quietest_near(smooth: np.ndarray, at: float, window: float) -> float:
    """The middle of the quietest stretch within ``window`` seconds of ``at``: the quietest
    moment (a nearer one breaks ties), widened to the stretch around it that is within
    QUIET_SPREAD_DB of it, so a cut lands mid-pause rather than on the edge of a song."""
    if not len(smooth):
        return at
    centre = round(at / HOP_SECONDS)
    reach = round(window / HOP_SECONDS)
    low, high = max(0, centre - reach), min(len(smooth), centre + reach + 1)
    if low >= high:
        return at
    frames = np.arange(low, high)
    cost = smooth[low:high] + np.abs(frames - centre) * HOP_SECONDS * DISTANCE_COST_DB
    quietest = int(frames[int(np.argmin(cost))])
    ceiling = smooth[quietest] + QUIET_SPREAD_DB
    # Within the window too, so the cut never lands further away than the window allows
    limit = round(QUIET_SPREAD_MAX_SEC / HOP_SECONDS)
    first = quietest
    while first > low and quietest - first < limit and smooth[first - 1] <= ceiling:
        first -= 1
    last = quietest
    while last < high - 1 and last - quietest < limit and smooth[last + 1] <= ceiling:
        last += 1
    return float((first + last) / 2 * HOP_SECONDS)


def _ordered(cuts: list[float], duration: float, min_gap: float) -> list[float]:
    """Cuts kept in order, each at least ``min_gap`` after the one before and before the end."""
    kept: list[float] = []
    for cut in cuts:
        floor = (kept[-1] if kept else 0.0) + min_gap
        kept.append(min(max(cut, floor), duration - min_gap))
    return kept


def snap_cuts(envelope: np.ndarray, cuts: list[float], duration: float) -> list[float]:
    """Chapter boundaries moved to the quiet within CHAPTER_WINDOW_SEC of each."""
    smooth = _smoothed(envelope)
    moved = [quietest_near(smooth, cut, CHAPTER_WINDOW_SEC) for cut in cuts]
    return _ordered(moved, duration, 5.0)


def place_cuts(envelope: np.ndarray, lengths: list[float], duration: float) -> list[float]:
    """The cuts between songs whose catalog lengths are ``lengths``: each is looked for one
    song's length after the cut before it, so the silence an upload adds between songs does
    not pile up towards the end of the album."""
    smooth = _smoothed(envelope)
    cuts: list[float] = []
    position = 0.0
    for length in lengths[:-1]:
        position = quietest_near(smooth, position + length, CATALOG_WINDOW_SEC)
        cuts.append(position)
    return _ordered(cuts, duration, 5.0)


def pauses(envelope: np.ndarray) -> list[tuple[float, float]]:
    """The stretches (start, end in seconds) quiet enough and long enough to be the pause
    between two songs: PAUSE_BELOW_LOUD_DB under the recording's loud passages, and never
    louder than PAUSE_CEILING_DB. Silence at the very start and end does not count."""
    if not len(envelope):
        return []
    smooth = _smoothed(envelope)
    loud = float(np.percentile(envelope, 95))
    threshold = min(loud - PAUSE_BELOW_LOUD_DB, PAUSE_CEILING_DB)
    quiet = smooth < threshold
    found: list[tuple[float, float]] = []
    start = None
    for index, is_quiet in enumerate(np.append(quiet, False)):
        if is_quiet and start is None:
            start = index
        elif not is_quiet and start is not None:
            if start > 0 and index < len(quiet) and (index - start) * HOP_SECONDS >= PAUSE_MIN_SEC:
                found.append((start * HOP_SECONDS, index * HOP_SECONDS))
            start = None
    return found


def split_at_pauses(envelope: np.ndarray, duration: float) -> list[float]:
    """Cuts at the pauses between songs, for a recording whose songs nothing names. A pause
    that would leave a part shorter than SONG_MIN_SEC (a break inside a song, a short intro)
    is passed over; the longer of two close pauses is the one kept."""
    candidates = [((start + end) / 2, end - start) for start, end in pauses(envelope)]
    cuts: list[tuple[float, float]] = []
    for cut, length in candidates:
        if duration - cut < SONG_MIN_SEC:
            continue
        previous = cuts[-1][0] if cuts else 0.0
        if cut - previous >= SONG_MIN_SEC:
            cuts.append((cut, length))
        elif cuts and length > cuts[-1][1] and (len(cuts) < 2 or cut - cuts[-2][0] >= SONG_MIN_SEC):
            cuts[-1] = (cut, length)
    return [cut for cut, _ in cuts]


def cut_song(source: str | Path, start: float, end: float, target: str | Path) -> float:
    """Writes the part of ``source`` from ``start`` to ``end`` to ``target`` as the studio's
    WAV (16-bit, 44.1 kHz, stereo) and returns its length. Written beside the target first,
    so a failed cut never leaves half a song where a finished one is expected."""
    target = Path(target)
    partial = target.with_name(f"{target.stem}_cut.wav")
    length = max(0.1, end - start)
    cmd = [
        "ffmpeg",
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        f"{max(0.0, start):.3f}",
        "-i",
        str(source),
        "-t",
        f"{length:.3f}",
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "44100",
        "-ac",
        "2",
        str(partial),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=CUT_TIMEOUT_SEC)
        if res.returncode != 0 or not partial.is_file() or partial.stat().st_size == 0:
            reason = public_error(res.stderr or f"exit {res.returncode}")
            raise AlbumAudioError(f"FFmpeg could not cut the song out of the album: {reason}")
        partial.replace(target)
    finally:
        partial.unlink(missing_ok=True)
    return length


def file_chapters(path: str | Path) -> list[dict]:
    """The chapters an audio file carries (an .m4b, or an .m4a or .mka ripped with them), in
    yt-dlp's shape (start_time, end_time, title); empty when it has none or FFprobe fails."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_chapters",
        str(path),
    ]
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        data = json.loads(res.stdout or "{}") if res.returncode == 0 else {}
    except Exception as exc:
        logger.info(f"Could not read the chapters of {Path(path).name}: {exc}")
        return []
    chapters = []
    for chapter in data.get("chapters") or []:
        try:
            chapters.append(
                {
                    "start_time": float(chapter["start_time"]),
                    "end_time": float(chapter["end_time"]),
                    "title": str((chapter.get("tags") or {}).get("title") or ""),
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    return chapters
