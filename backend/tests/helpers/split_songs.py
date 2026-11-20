"""A finished song whose vocals can be split into parts, and a stand-in for the model."""

from pathlib import Path

import numpy as np
import soundfile as sf

RATE = 8000


def wav(path: Path, value: float = 0.1, seconds: float = 0.1, rate: int = RATE) -> Path:
    """A stereo WAV holding one constant level."""
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.full((int(seconds * rate), 2), value, dtype="float32"), rate)
    return path


def level(path: str | Path) -> float:
    return float(sf.read(str(path))[0].mean())


def make_song(main_mod, pid: str = "vs1", **fields) -> dict:
    """Stores a finished song with stems, two lines and a master mix; returns its project."""
    stems = main_mod.STEMS_DIR / pid
    proj = {
        "id": pid,
        "title": "Song",
        "status": "ready",
        "progress": 100,
        "duration": 30.0,
        "audio_path": str(wav(main_mod.DOWNLOADS_DIR / f"{pid}.wav", 0.5)),
        "vocals_path": str(wav(stems / "vocals.wav", 0.3)),
        "instrumental_path": str(wav(stems / "instrumental.wav", 0.1)),
        "vocals_url": f"/static/stems/{pid}/vocals.wav",
        "instrumental_url": f"/static/stems/{pid}/instrumental.wav",
        "lines": [
            {"id": 1, "text": "hello world", "start_time": 1.0, "end_time": 2.0},
            {"id": 2, "text": "hello you", "start_time": 3.0, "end_time": 4.0, "singer": "singer2"},
        ],
        "semitones": 0,
        "guide_volume": 0.0,
        "separation": {"preset": "fast", "label": "Fast · Demucs"},
        **fields,
    }
    main_mod.projects[pid] = proj
    return proj


def fake_splitter(main_mod, log: list, first: float = 0.2, second: float = 0.1):
    """A stand-in for AudioSeparator.split_vocals that writes two constant stems into the work
    folder, as the worker leaves them, and notes each call in ``log``."""

    def split_vocals(source_path, work_id, plan, progress_callback=None, cancel_event=None):
        log.append((Path(source_path).name, work_id, plan.models[0]))
        if progress_callback:
            progress_callback(50.0, "Mel-Band RoFormer: chunk 5/10 (50%)", 12)
        out = main_mod.STEMS_DIR / work_id / "roformer"
        return wav(out / "vocals.wav", first), wav(out / "no_vocals.wav", second)

    return split_vocals
