"""Vocal parts: a song's vocal stem split further, so each part can stay in the mix or leave it.

A split runs one RoFormer model over a vocal stem (through AudioSeparator.split_vocals, on
this machine or the cloud GPU like Balanced and Best) and keeps its two outputs beside the
song's stems:

    lead_backing  vocals.wav -> vocals_lead.wav + vocals_backing.wav (a "karaoke" model,
                  whose "vocals" output is the lead and whose "instrumental" is the rest of
                  what it was given: here, the backing vocals)

How each split was made is recorded in vocal_parts.json. Nothing here is asked of a song's
project: a stems folder can be shared by two songs and outlives an intake retry, so which
parts exist is always read from the files. A pair counts only while both files hold audio
and are no older than the stem they were split from, so re-made stems retire their parts.
There is no fallback engine: when RoFormer cannot run, a split cannot either.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any

from backend.services.separation_presets import (
    SeparationPlan,
    estimate_seconds,
    model_label,
    remote_backend,
    roformer_status,
    weights_cached,
)

logger = logging.getLogger(__name__)

LEAD_BACKING = "lead_backing"
RECORD_FILENAME = "vocal_parts.json"
VOCALS_FILENAME = "vocals.wav"
DEFAULT_LEAD_MODEL = "mel_band_roformer_karaoke_aufr33_viperx_sdr_10.1956.ckpt"

# Each kind of split: its two parts in the order the worker returns them (its "vocals"
# output, then the rest), the variable naming its model, and how the studio words it
SPLITS: dict[str, dict[str, Any]] = {
    LEAD_BACKING: {
        "parts": ("lead", "backing"),
        "label": "Lead and backing vocals",
        "model_env": "SEPARATION_LEAD_MODEL",
        "default_model": DEFAULT_LEAD_MODEL,
    },
}
SPLIT_KINDS = tuple(SPLITS)
PART_FILES = {
    "lead": "vocals_lead.wav",
    "backing": "vocals_backing.wav",
}

# Smallest plausible stem: anything at or below a bare RIFF header holds no audio
_MIN_STEM_BYTES = 44


def split_model(kind: str) -> str:
    """The model file a split of this kind runs: its variable, else its default."""
    spec = SPLITS[kind]
    return os.getenv(spec["model_env"], "").strip() or spec["default_model"]


def split_label(kind: str) -> str:
    return SPLITS[kind]["label"]


def split_plan(kind: str) -> SeparationPlan:
    """One model over the vocal stem. ``params["split"]`` marks the plan as a split for the
    separator (no cheaper preset to suggest) and the cloud call (no lyric emission)."""
    return SeparationPlan(
        preset=kind,
        engine="roformer",
        models=(split_model(kind),),
        params={"overlap": 2, "split": kind},
        label=f"{split_label(kind)} split",
    )


def split_status(kind: str) -> tuple[bool, str | None]:
    """Whether a split of this kind can run now, and why not."""
    return roformer_status(split_plan(kind))


def estimate_split_seconds(duration_seconds: float) -> int:
    """Expected time of one split: a single RoFormer pass, like Balanced."""
    return estimate_seconds("balanced", duration_seconds)


def split_capabilities() -> list[dict[str, Any]]:
    """What the studio needs to offer each split: whether it can run and where."""
    remote = remote_backend() is not None
    found = []
    for kind in SPLIT_KINDS:
        plan = split_plan(kind)
        ready, reason = roformer_status(plan)
        found.append(
            {
                "id": kind,
                "label": split_label(kind),
                "model": plan.models[0],
                "model_label": model_label(plan.models[0]),
                "available": ready,
                "reason": reason,
                # The cloud GPU keeps its own weights; only local ones are tracked
                "weights_cached": None if remote else weights_cached(plan.models),
                "runs_on": "cloud-gpu" if remote else None,
            }
        )
    return found


def _holds_audio(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > _MIN_STEM_BYTES
    except OSError:
        return False


def _modified(path: Path) -> float | None:
    try:
        return path.stat().st_mtime
    except OSError:
        return None


def part_path(stem_dir: Path, part: str) -> Path:
    return Path(stem_dir) / PART_FILES[part]


def source_path(stem_dir: Path, kind: str) -> Path:
    """The stem a split of this kind is made from."""
    return Path(stem_dir) / VOCALS_FILENAME


def _pair_is_current(stem_dir: Path, kind: str) -> bool:
    made_from = _modified(source_path(stem_dir, kind))
    if made_from is None:
        return False
    for part in SPLITS[kind]["parts"]:
        path = part_path(stem_dir, part)
        modified = _modified(path)
        if not _holds_audio(path) or modified is None or modified < made_from:
            return False
    return True


def current_parts(stem_dir: Path | str | None) -> dict[str, Path]:
    """The part stems in stem_dir that can be mixed and exported now, by part name. A split
    counts only as a pair: both files hold audio and neither is older than its source."""
    if not stem_dir:
        return {}
    stem_dir = Path(stem_dir)
    found: dict[str, Path] = {}
    for kind in SPLIT_KINDS:
        if _pair_is_current(stem_dir, kind):
            for part in SPLITS[kind]["parts"]:
                found[part] = part_path(stem_dir, part)
    return found


def read_record(stem_dir: Path) -> dict[str, dict]:
    """How each split in stem_dir was made, by kind; empty when there is no readable record."""
    try:
        record = json.loads((Path(stem_dir) / RECORD_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(record, dict):
        return {}
    return {kind: made for kind, made in record.items() if isinstance(made, dict)}


def _write_record(stem_dir: Path, record: dict[str, dict]) -> None:
    """Never raises: the record only describes the parts, which are found from their files."""
    path = Path(stem_dir) / RECORD_FILENAME
    staged = path.with_name(f"{RECORD_FILENAME}.tmp")
    try:
        if not record:
            path.unlink(missing_ok=True)
            return
        staged.write_text(json.dumps(record, indent=1), encoding="utf-8")
        os.replace(staged, path)
    except (OSError, TypeError, ValueError) as exc:
        logger.warning(f"Could not record how the vocal parts in {stem_dir} were made: {exc}")
        try:
            staged.unlink(missing_ok=True)
        except OSError:
            pass


def splits_summary(stem_dir: Path | str | None) -> dict[str, dict]:
    """What a song stores as ``vocal_splits``: each current split with how it was made."""
    if not stem_dir:
        return {}
    stem_dir = Path(stem_dir)
    record = read_record(stem_dir)
    return {
        kind: dict(record.get(kind) or {})
        for kind in SPLIT_KINDS
        if _pair_is_current(stem_dir, kind)
    }


def split_record(kind: str, plan: SeparationPlan, elapsed_seconds: float) -> dict[str, Any]:
    return {
        "kind": kind,
        "label": split_label(kind),
        "model": plan.models[0],
        "model_label": model_label(plan.models[0]),
        "elapsed_seconds": round(elapsed_seconds, 1),
        "split_at": int(time.time()),
    }


def install(stem_dir: Path, kind: str, first: Path, second: Path, record: dict) -> dict[str, Path]:
    """Moves a finished split's two stems into stem_dir as this kind's parts and records how
    they were made. The parts are dated now, not when the engine wrote them, so mixes made
    from earlier parts are stale. Returns the parts' paths by name."""
    stem_dir = Path(stem_dir)
    stem_dir.mkdir(parents=True, exist_ok=True)
    kept = read_record(stem_dir)
    # The old entry goes first, so it never describes the new parts (even after a crash)
    kept.pop(kind, None)
    _write_record(stem_dir, kept)
    placed: dict[str, Path] = {}
    for part, made in zip(SPLITS[kind]["parts"], (first, second), strict=True):
        target = part_path(stem_dir, part)
        os.replace(made, target)
        os.utime(target)
        placed[part] = target
    kept[kind] = dict(record)
    _write_record(stem_dir, kept)
    return placed


def drop_parts(stem_dir: Path | str | None) -> list[str]:
    """Deletes every part stem in stem_dir with the record, as when the vocals they were
    split from are replaced. Returns the names of the deleted files. Never raises."""
    if not stem_dir:
        return []
    stem_dir = Path(stem_dir)
    removed: list[str] = []
    for name in PART_FILES.values():
        path = stem_dir / name
        try:
            if path.is_file():
                path.unlink()
                removed.append(name)
        except OSError as exc:
            logger.warning(f"Could not remove the vocal part {path}: {exc}")
    _write_record(stem_dir, {})
    return removed
