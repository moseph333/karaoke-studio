"""Synthetic album recordings for the album tests: songs (tones with a little noise and a
slow swell, so each is loud with quieter moments inside) separated by pauses, written as a
small WAV, and yt-dlp's metadata of a whole-album video with chapters."""

from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 8000


def album_signal(
    lengths: list[float],
    pause: float = 2.0,
    lead: float = 0.5,
    rate: int = RATE,
    inner_breaks: dict[int, float] | None = None,
) -> tuple[np.ndarray, list[float]]:
    """Songs of the given lengths with ``pause`` seconds of near silence between them.
    ``inner_breaks`` puts a short break (seconds) halfway through the songs it names, as a
    song with a stop in it has. Returns the signal and where each pause's middle is."""
    rng = np.random.RandomState(7)
    parts = [np.zeros(int(lead * rate), dtype=np.float32)]
    middles: list[float] = []
    position = lead
    for index, length in enumerate(lengths):
        t = np.arange(int(length * rate)) / rate
        freq = 180.0 + 70.0 * index
        swell = 0.55 + 0.35 * np.sin(2 * np.pi * t / 7.0)
        song = (swell * np.sin(2 * np.pi * freq * t) + rng.normal(0, 0.05, len(t))).astype(
            np.float32
        ) * 0.6
        if inner_breaks and index in inner_breaks:
            middle = len(song) // 2
            song[middle : middle + int(inner_breaks[index] * rate)] = 0.0
        parts.append(song)
        position += length
        if index < len(lengths) - 1:
            parts.append(rng.normal(0, 0.0005, int(pause * rate)).astype(np.float32))
            middles.append(position + pause / 2)
            position += pause
    parts.append(np.zeros(int(lead * rate), dtype=np.float32))
    return np.concatenate(parts), middles


def write_album(path: Path, lengths: list[float], **kwargs) -> tuple[float, list[float]]:
    """Writes an album WAV; returns its length and the middles of its pauses."""
    signal, middles = album_signal(lengths, **kwargs)
    rate = kwargs.get("rate", RATE)
    sf.write(str(path), signal, rate, subtype="PCM_16")
    return len(signal) / rate, middles


def album_info(
    video_id: str,
    duration: float,
    chapters: list[tuple[float, str]] | None = None,
    title: str = "The Band - The Record [1999] FULL ALBUM",
    uploader: str = "Some Fan",
) -> dict:
    """yt-dlp's metadata of a whole-album upload."""
    info = {"id": video_id, "title": title, "duration": duration, "uploader": uploader}
    if chapters is not None:
        ends = [start for start, _ in chapters[1:]] + [duration]
        info["chapters"] = [
            {"start_time": start, "end_time": end, "title": name}
            for (start, name), end in zip(chapters, ends, strict=True)
        ]
    return info
