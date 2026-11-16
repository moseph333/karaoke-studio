"""Synthetic vocal stems with one or two voices, for telling voices apart: a low "rapper"
in short syllables and a high "singer" holding notes, each on known lines."""

from backend.tests.helpers.audio_signals import write_test_wav


def rapped_line(start: float, end: float, base_hz: float = 115.0) -> list[dict]:
    """Short syllables around a low pitch, with gaps, like a rapped line."""
    events, t, i = [], start, 0
    while t + 0.18 <= end:
        events.append({"start": t, "end": t + 0.16, "freq": base_hz * (1.0 + 0.04 * (i % 3))})
        t += 0.22
        i += 1
    return events


def sung_line(start: float, end: float, base_hz: float = 440.0) -> list[dict]:
    """Two held notes around a high pitch, like a sung hook."""
    mid = (start + end) / 2
    return [
        {"start": start, "end": mid - 0.05, "freq": base_hz},
        {"start": mid, "end": end, "freq": base_hz * 1.12},
    ]


def line(idx: int, start: float, end: float, singer: str = "singer1") -> dict:
    return {
        "id": idx,
        "text": f"line {idx}",
        "start_time": start,
        "end_time": end,
        "singer": singer,
    }


def two_voice_song(path: str) -> tuple[str, list[dict], list[str]]:
    """A rapper on six lines and a singer on three, in verse-hook order. Returns the stem's
    path, the lines (all Singer 1) and who really sings each line ("rap" or "sing")."""
    plan = ["rap", "rap", "rap", "sing", "rap", "rap", "rap", "sing", "sing"]
    events, lines = [], []
    t = 0.5
    for i, who in enumerate(plan):
        length = 2.5 if who == "rap" else 3.0
        events += rapped_line(t, t + length) if who == "rap" else sung_line(t, t + length)
        lines.append(line(i, t, t + length))
        t += length + 0.6
    return write_test_wav(path, t + 0.5, events, sr=16000), lines, plan


def one_voice_song(path: str) -> tuple[str, list[dict]]:
    """One voice on eight lines, its pitch moving by a couple of semitones between lines."""
    events, lines = [], []
    t = 0.5
    for i in range(8):
        hz = 220.0 * (1.0 + 0.06 * (i % 3))
        events += sung_line(t, t + 2.5, base_hz=hz)
        lines.append(line(i, t, t + 2.5))
        t += 3.1
    return write_test_wav(path, t + 0.5, events, sr=16000), lines
