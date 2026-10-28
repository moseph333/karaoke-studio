"""Seed a self-contained demo workspace for local UI development and screenshots.

Generates synthetic (royalty-free) stems, album art and a ``projects.json`` with:

* ``demo`` - a ready duet song with word timings, chords, a vocal range, Balanced stems
  and auto-aligned lyrics with per-line confidence (one line flagged for review),
* ``demo_processing`` - a song mid-way through stem separation,
* ``demo_error`` - a failed import,
* a few extra ready songs so the library grid has content.

Usage::

    KARAOKE_DATA_DIR=/tmp/karaoke-demo python -m backend.tools.seed_demo

No network access, Demucs or model weights are required.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw, ImageFilter

from backend.config import DATA_DIR, DOWNLOADS_DIR, OUTPUT_DIR, STEMS_DIR

SAMPLE_RATE = 44100
DURATION = 62.0
BEAT = 0.5  # 120 BPM

# Original demo lyrics (written for this project; free to use).
DEMO_LINES: list[tuple[float, str, str]] = [
    (6.0, "City lights are humming low tonight", "singer1"),
    (10.2, "Every window glowing like a sign", "singer1"),
    (14.4, "I can hear the rhythm in the rain", "singer2"),
    (18.6, "Calling out your name again", "singer2"),
    (22.8, "We are neon on the skyline", "both"),
    (27.0, "Burning bright until the morning", "both"),
    (36.0, "Hold the note and let it carry", "singer1"),
    (40.2, "Over rooftops, over bridges", "singer2"),
    (44.4, "Every echo knows the chorus", "singer1"),
    (48.6, "Sing it louder, sing it with me", "both"),
    (52.8, "We are neon on the skyline", "both"),
    (57.0, "Glowing on and on", "both"),
]

CHORD_CYCLE = [
    ("C", (261.63, 329.63, 392.00), 130.81),
    ("Am", (220.00, 261.63, 329.63), 110.00),
    ("F", (174.61, 220.00, 261.63), 87.31),
    ("G", (196.00, 246.94, 293.66), 98.00),
]

# Per-line sync confidence for the demo song (the 0.52 line shows up under "Needs review")
LINE_CONFIDENCE = [0.94, 0.91, 0.88, 0.9, 0.86, 0.83, 0.52, 0.89, 0.92, 0.87, 0.9, 0.79]

PRESET_LABELS = {
    "fast": "Fast · Demucs",
    "balanced": "Balanced · Mel-Band RoFormer",
}

MELODY_HZ = [329.63, 349.23, 392.00, 440.00, 392.00, 349.23, 329.63, 293.66, 261.63]


def _envelope(n: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(n, dtype=np.float32)
    a = max(1, int(attack * SAMPLE_RATE))
    r = max(1, int(release * SAMPLE_RATE))
    env[: min(a, n)] = np.linspace(0.0, 1.0, min(a, n), dtype=np.float32)
    if r < n:
        env[-r:] *= np.linspace(1.0, 0.0, r, dtype=np.float32)
    return env


def build_lines() -> list[dict]:
    lines = []
    for idx, (start, text, singer) in enumerate(DEMO_LINES):
        words = text.split()
        line_len = 3.6
        step = line_len / len(words)
        word_items = []
        for w_i, word in enumerate(words):
            ws = round(start + w_i * step, 3)
            we = round(start + (w_i + 1) * step - 0.06, 3)
            word_items.append({"word": word, "start_time": ws, "end_time": we})
        confidence = LINE_CONFIDENCE[idx % len(LINE_CONFIDENCE)]
        lines.append(
            {
                "id": idx + 1,
                "text": text,
                "start_time": round(start, 3),
                "end_time": round(start + line_len, 3),
                "words": word_items,
                "singer": singer,
                "confidence": confidence,
                "align_method": "ctc" if confidence >= 0.6 else "dsp",
            }
        )
    return lines


def sync_report(lines: list[dict]) -> dict:
    confidences = [line["confidence"] for line in lines]
    methods = [line["align_method"] for line in lines]
    return {
        "version": 1,
        "engine": "ctc",
        "requested_engine": "auto",
        "fallback_reason": None,
        "lyric_source": "custom",
        "source_timing": "none",
        "global_offset": None,
        "lines_total": len(lines),
        "lines_ctc": methods.count("ctc"),
        "lines_dsp": methods.count("dsp"),
        "lines_lrc": 0,
        "lines_fallback": 0,
        "low_confidence_lines": sum(1 for c in confidences if c < 0.6),
        "mean_confidence": round(sum(confidences) / len(confidences), 3),
        "elapsed_seconds": 41.7,
        "aligned_at": int(time.time()),
    }


def synth_instrumental() -> np.ndarray:
    total = int(DURATION * SAMPLE_RATE)
    t = np.arange(total, dtype=np.float32) / SAMPLE_RATE
    out = np.zeros(total, dtype=np.float32)
    bar = 2.0
    for i in range(math.ceil(DURATION / bar)):
        _, triad, bass = CHORD_CYCLE[i % len(CHORD_CYCLE)]
        s = int(i * bar * SAMPLE_RATE)
        e = min(total, int((i + 1) * bar * SAMPLE_RATE))
        seg_t = t[s:e]
        pad = sum(np.sin(2 * np.pi * f * seg_t) for f in triad) * 0.05
        low = np.sin(2 * np.pi * bass * seg_t) * 0.12
        out[s:e] += (pad + low) * _envelope(e - s, 0.05, 0.3)
    rng = np.random.default_rng(7)
    for k in range(int(DURATION / BEAT)):
        s = int(k * BEAT * SAMPLE_RATE)
        n = min(int(0.18 * SAMPLE_RATE), total - s)
        if n <= 0:
            break
        kt = np.arange(n, dtype=np.float32) / SAMPLE_RATE
        kick = np.sin(2 * np.pi * (55 + 60 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 18) * 0.35
        out[s : s + n] += kick.astype(np.float32)
        hs = s + int(BEAT * SAMPLE_RATE / 2)
        hn = min(int(0.04 * SAMPLE_RATE), total - hs)
        if hn > 0:
            hat = rng.standard_normal(hn).astype(np.float32) * np.exp(-np.arange(hn) / 300) * 0.05
            out[hs : hs + hn] += hat
    return out


def synth_vocals(lines: list[dict]) -> np.ndarray:
    total = int(DURATION * SAMPLE_RATE)
    out = np.zeros(total, dtype=np.float32)
    note_i = 0
    for line in lines:
        shift = 1.0 if line["singer"] != "singer2" else 1.25
        for word in line["words"]:
            s = int(word["start_time"] * SAMPLE_RATE)
            e = min(total, int(word["end_time"] * SAMPLE_RATE))
            if e <= s:
                continue
            f0 = MELODY_HZ[note_i % len(MELODY_HZ)] * shift
            note_i += 1
            wt = np.arange(e - s, dtype=np.float32) / SAMPLE_RATE
            vib = 1.0 + 0.006 * np.sin(2 * np.pi * 5.5 * wt)
            phase = 2 * np.pi * f0 * np.cumsum(vib) / SAMPLE_RATE
            tone = np.sin(phase) * 0.5 + np.sin(2 * phase) * 0.22 + np.sin(3 * phase) * 0.1
            out[s:e] += (tone * _envelope(e - s, 0.02, 0.06) * 0.6).astype(np.float32)
    return out


def write_stereo(path: Path, mono: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    peak = float(np.max(np.abs(mono))) or 1.0
    data = (mono / max(1.0, peak / 0.95)).astype(np.float32)
    sf.write(str(path), np.stack([data, data], axis=1), SAMPLE_RATE, subtype="PCM_16")


def make_cover(path: Path, hue_a: tuple[int, int, int], hue_b: tuple[int, int, int]) -> None:
    size = 640
    img = Image.new("RGB", (size, size), hue_a)
    draw = ImageDraw.Draw(img)
    for y in range(size):
        ratio = y / size
        color = tuple(int(hue_a[c] * (1 - ratio) + hue_b[c] * ratio) for c in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    for i in range(7):
        r = 60 + i * 55
        draw.ellipse(
            [size / 2 - r, size * 0.62 - r, size / 2 + r, size * 0.62 + r],
            outline=(255, 255, 255),
            width=2,
        )
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    draw = ImageDraw.Draw(img)
    for x in range(0, size, 16):
        h = int(40 + 160 * abs(math.sin(x * 0.045)))
        draw.rectangle([x, size - h, x + 8, size], fill=(255, 255, 255))
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(str(path), quality=88)


def build_chords() -> list[dict]:
    chords = []
    bar = 2.0
    for i in range(math.ceil(DURATION / bar)):
        name = CHORD_CYCLE[i % len(CHORD_CYCLE)][0]
        chords.append(
            {
                "id": f"c{i}",
                "start": round(i * bar, 3),
                "end": round(min(DURATION, (i + 1) * bar), 3),
                "chord": name,
                "confidence": 0.82,
            }
        )
    return chords


def ready_project(
    pid: str,
    title: str,
    artist: str,
    cover: str,
    lines: list[dict],
    quality: str = "fast",
    auto_aligned: bool = False,
) -> dict:
    now = time.time()
    if not auto_aligned:
        # Timing that came with LRCLIB lyrics carries no aligner confidence
        lines = [
            {k: v for k, v in line.items() if k not in ("confidence", "align_method")}
            for line in lines
        ]
    project = {
        "id": pid,
        "track_id": "demo",
        "status": "ready",
        "progress": 100,
        "title": title,
        "artist": artist,
        "duration": DURATION,
        "audio_url": "/static/downloads/demo.wav",
        "vocals_url": "/static/stems/demo/vocals.wav",
        "instrumental_url": "/static/stems/demo/instrumental.wav",
        "master_audio_url": "/static/output/demo_master.wav",
        "thumbnail_url": f"/static/downloads/{cover}",
        # Disk paths let path-based endpoints (waveform, mix, exports) work on the demo
        "audio_path": str(DOWNLOADS_DIR / "demo.wav"),
        "vocals_path": str(STEMS_DIR / "demo" / "vocals.wav"),
        "instrumental_path": str(STEMS_DIR / "demo" / "instrumental.wav"),
        "master_audio_path": str(OUTPUT_DIR / "demo_master.wav"),
        "thumbnail_path": str(DOWNLOADS_DIR / cover),
        "lines": lines,
        "lyric_source": "lrclib",
        "is_synced": True,
        "semitones": 0,
        "guide_volume": 0.0,
        "chords": build_chords(),
        "vocal_range": {
            "lowest_note": "C4",
            "highest_note": "B4",
            "lowest_hz": 261.63,
            "highest_hz": 493.88,
            "tessitura_low_note": "D4",
            "tessitura_high_note": "A4",
            "tessitura_low_hz": 293.66,
            "tessitura_high_hz": 440.0,
            "median_note": "F4",
            "median_hz": 349.23,
            "estimated_key": "C Major",
            "key_confidence": 0.78,
            "is_voiced": True,
            "voiced_frames_count": 1200,
            "total_frames_count": 1900,
        },
        "created_by": "Friend",
        "created_at": now,
        "render_status": "idle",
        "render_progress": 0,
        "separation_quality": quality,
        "separation": {
            "preset": quality,
            "engine": "roformer" if quality != "fast" else "demucs",
            "label": PRESET_LABELS[quality],
            "requested": quality,
            "fallback_reason": None,
            "elapsed_seconds": 96 if quality != "fast" else 21,
            "separated_at": int(now),
        },
        "lyric_timing": "source_line",
    }
    if auto_aligned:
        project.update(
            lyric_source="custom",
            is_synced=False,
            lyric_timing="aligned",
            sync_report=sync_report(lines),
        )
    return project


def main() -> None:
    lines = build_lines()
    instrumental = synth_instrumental()
    vocals = synth_vocals(lines)
    write_stereo(STEMS_DIR / "demo" / "instrumental.wav", instrumental)
    write_stereo(STEMS_DIR / "demo" / "vocals.wav", vocals)
    write_stereo(OUTPUT_DIR / "demo_master.wav", instrumental)
    write_stereo(DOWNLOADS_DIR / "demo.wav", instrumental + vocals * 0.8)

    covers = {
        "demo.jpg": ((124, 58, 237), (219, 39, 119)),
        "demo_b.jpg": ((14, 116, 144), (30, 27, 75)),
        "demo_c.jpg": ((234, 88, 12), (127, 29, 29)),
        "demo_d.jpg": ((22, 101, 52), (15, 23, 42)),
    }
    for name, (a, b) in covers.items():
        make_cover(DOWNLOADS_DIR / name, a, b)

    now = time.time()
    projects: dict[str, dict] = {
        "demo": ready_project(
            "demo",
            "Neon Skyline",
            "The Midnight Static",
            "demo.jpg",
            lines,
            quality="balanced",
            auto_aligned=True,
        ),
        "demo_b": ready_project("demo_b", "Harbor Lights", "Coastline Echo", "demo_b.jpg", lines),
        "demo_c": ready_project("demo_c", "Ember Hour", "Velvet Arcade", "demo_c.jpg", lines),
        "demo_processing": {
            "id": "demo_processing",
            "track_id": "demo_processing",
            "status": "separating",
            "progress": 48,
            "status_detail": "Mel-Band RoFormer: chunk 12/25 (48%)",
            "separation_quality": "balanced",
            "eta_seconds": 95,
            "elapsed_seconds": 63,
            "heartbeat": int((now + 3600) * 1000),  # milliseconds, fresh for an hour
            "title": "Glasshouse",
            "artist": "Northern Satellites",
            "thumbnail_url": "/static/downloads/demo_d.jpg",
            "lines": [],
            "semitones": 0,
            "guide_volume": 0.0,
            "created_by": "Friend",
            "created_at": now - 63,
        },
        "demo_error": {
            "id": "demo_error",
            "track_id": "demo_error",
            "status": "error",
            "progress": 35,
            "error": "Could not download audio: the video is unavailable in your region.",
            "title": "Unavailable Upload",
            "artist": "Unknown Artist",
            "lines": [],
            "semitones": 0,
            "guide_volume": 0.0,
            "created_by": "Friend",
            "created_at": now - 7200,
        },
    }
    (DATA_DIR / "projects.json").write_text(json.dumps(projects, indent=2), encoding="utf-8")
    print(f"Seeded demo workspace in {DATA_DIR} ({len(projects)} projects)")


if __name__ == "__main__":
    main()
