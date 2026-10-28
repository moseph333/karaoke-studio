"""Stem separation quality presets and engine availability.

    fast      Demucs htdemucs: bundled, quickest on CPU.
    balanced  Mel-Band RoFormer vocal model via audio-separator: noticeably cleaner vocals
              and fewer instrument bleed artifacts (the default when installed).
    best      Two RoFormer models averaged (Mel-Band + BS-RoFormer): cleanest, slowest.

RoFormer runs in a worker process (backend.workers.roformer_worker) and needs the optional
``audio-separator`` package plus model weights, which download on first use unless
SEPARATION_ALLOW_DOWNLOAD=0. When a preset cannot run, separation falls back down the chain
best -> balanced -> fast. Availability checks never import torch.
"""

import importlib.metadata
import importlib.util
import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

PRESET_IDS = ("fast", "balanced", "best")
DEFAULT_PRESET = "balanced"
DEFAULT_DEMUCS_MODEL = "htdemucs"

DEFAULT_BALANCED_MODEL = "vocals_mel_band_roformer.ckpt"
DEFAULT_BEST_MODELS = ("vocals_mel_band_roformer.ckpt", "model_bs_roformer_ep_317_sdr_12.9755.ckpt")

PRESET_LABELS = {
    "fast": "Fast · Demucs",
    "balanced": "Balanced · Mel-Band RoFormer",
    "best": "Best · RoFormer ensemble",
}

# Rough CPU cost relative to track length (seconds of processing per second of audio)
CPU_REALTIME_FACTORS = {"fast": 0.35, "balanced": 1.6, "best": 6.4}

MODEL_LABELS = {
    "htdemucs": "Demucs",
    "vocals_mel_band_roformer.ckpt": "Mel-Band RoFormer",
    "model_bs_roformer_ep_317_sdr_12.9755.ckpt": "BS-RoFormer",
}


def model_label(name: str) -> str:
    """A readable name for a model file, e.g. "Mel-Band RoFormer"."""
    if name in MODEL_LABELS:
        return MODEL_LABELS[name]
    lower = name.lower()
    if "mel_band" in lower or "melband" in lower:
        return "Mel-Band RoFormer"
    if "bs_roformer" in lower or "bs-roformer" in lower:
        return "BS-RoFormer"
    if "roformer" in lower:
        return "RoFormer"
    return Path(name).stem or name


@dataclass(frozen=True)
class SeparationPlan:
    preset: str  # fast | balanced | best | custom
    engine: str  # demucs | roformer
    models: tuple[str, ...]
    passes: int = 1
    params: dict = field(default_factory=dict, compare=False, hash=False)
    label: str = ""


# --- Settings (read at call time so tests and admins can change them without a restart) ---


def _env_flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _env_float(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def configured_preset() -> str:
    """SEPARATION_QUALITY (fast | balanced | best), defaulting to balanced."""
    return normalize_preset(os.getenv("SEPARATION_QUALITY")) or DEFAULT_PRESET


def downloads_allowed() -> bool:
    return _env_flag("SEPARATION_ALLOW_DOWNLOAD", True)


def separation_timeout_seconds() -> float:
    return _env_float("SEPARATION_TIMEOUT_SEC", 7200.0)


def separation_stall_seconds() -> float:
    return _env_float("SEPARATION_STALL_SEC", 900.0)


def model_dir() -> Path:
    raw = os.getenv("AUDIO_SEPARATOR_MODEL_DIR", "").strip()
    if raw:
        return Path(raw)
    from backend.config import DATA_DIR

    return DATA_DIR / "models" / "audio-separator"


def balanced_model() -> str:
    return os.getenv("SEPARATION_BALANCED_MODEL", "").strip() or DEFAULT_BALANCED_MODEL


def best_models() -> tuple[str, ...]:
    raw = os.getenv("SEPARATION_BEST_MODELS", "")
    models = tuple(m.strip() for m in raw.split(",") if m.strip())
    return models or DEFAULT_BEST_MODELS


# --- Plans ---


def normalize_preset(value: object) -> str | None:
    """A preset id for user input like " Balanced ", or None."""
    if not isinstance(value, str):
        return None
    clean = value.strip().lower()
    return clean if clean in PRESET_IDS else None


def preset_plan(preset: str) -> SeparationPlan:
    if preset == "best":
        models = best_models()
        return SeparationPlan(
            preset="best",
            engine="roformer",
            models=models,
            passes=len(models),
            params={"overlap": 4, "ensemble": "avg_wave"},
            label=PRESET_LABELS["best"],
        )
    if preset == "balanced":
        return SeparationPlan(
            preset="balanced",
            engine="roformer",
            models=(balanced_model(),),
            params={"overlap": 2},
            label=PRESET_LABELS["balanced"],
        )
    return SeparationPlan(
        preset="fast",
        engine="demucs",
        models=(DEFAULT_DEMUCS_MODEL,),
        params={"shifts": 1, "overlap": 0.25},
        label=PRESET_LABELS["fast"],
    )


def resolve_plan(model_name: str | None) -> SeparationPlan:
    """Plan for a preset id, or for a raw Demucs model name such as "htdemucs_ft"."""
    preset = normalize_preset(model_name)
    if preset:
        return preset_plan(preset)
    name = (model_name or "").strip() or DEFAULT_DEMUCS_MODEL
    if name == DEFAULT_DEMUCS_MODEL:
        return preset_plan("fast")
    return SeparationPlan(
        preset="custom",
        engine="demucs",
        models=(name,),
        params={"shifts": 1, "overlap": 0.25},
        label=f"Demucs · {name}",
    )


def fallback_chain(plan: SeparationPlan) -> list[SeparationPlan]:
    """Plans to try in order: the requested one, then cheaper presets."""
    if plan.preset == "best":
        return [plan, preset_plan("balanced"), preset_plan("fast")]
    if plan.preset == "balanced":
        return [plan, preset_plan("fast")]
    return [plan]


# --- Availability ---


def package_available(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except importlib.metadata.PackageNotFoundError:
        return None


def _version_tuple(version: str | None) -> tuple[int, ...]:
    parts: list[int] = []
    for piece in (version or "").split("."):
        digits = "".join(ch for ch in piece if ch.isdigit())
        if not digits:
            break
        parts.append(int(digits))
    return tuple(parts)


@lru_cache(maxsize=1)
def demucs_supports_quality_flags() -> bool:
    """--shifts/--overlap/--int24/--clip-mode are passed only to demucs >= 4.1."""
    return _version_tuple(package_version("demucs")) >= (4, 1)


def weights_cached(models: tuple[str, ...], directory: Path | None = None) -> bool:
    base = directory or model_dir()
    return all((base / name).is_file() for name in models)


def roformer_status(plan: SeparationPlan) -> tuple[bool, str | None]:
    """Whether a RoFormer plan can run now, and why not."""
    if not package_available("audio_separator"):
        return False, "audio-separator is not installed (see requirements-ml.txt)"
    if not package_available("torch"):
        return False, "PyTorch is not installed"
    if weights_cached(plan.models) or downloads_allowed():
        return True, None
    return False, "Model weights are not downloaded and automatic download is disabled"


def plan_status(plan: SeparationPlan) -> tuple[bool, str | None]:
    if plan.engine == "roformer":
        return roformer_status(plan)
    # Demucs is invoked as `python -m demucs`; tests and minimal installs may stub it
    return True, None


def estimate_cpu_seconds(preset: str, duration_seconds: float) -> int:
    factor = CPU_REALTIME_FACTORS.get(preset, CPU_REALTIME_FACTORS["fast"])
    return int(max(1.0, duration_seconds) * factor)
