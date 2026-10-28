"""Lyric alignment settings and neural-engine availability.

    ALIGNMENT_ENGINE           auto (default) | ctc | dsp
    ALIGNMENT_ALLOW_DOWNLOAD   download the MMS model on first use (default 1)
    ALIGNMENT_MODEL_DIR        where the model lives (default <data dir>/models/mms_fa)
    ALIGNMENT_MIN_CONFIDENCE   neural words replace the DSP estimate from this score (0.45)
    ALIGNMENT_TIMEOUT_SEC      stop the neural pass after this long (1800)
    ALIGNMENT_STALL_SEC        ... or after this long without output (600)
    ALIGN_REFINE_PLAIN         snap plain-lyric lines to the vocal phrases (default 1)
    MAX_CONCURRENT_ALIGN_JOBS  neural passes allowed at once, read at start-up (default 1)

"auto" uses the neural (CTC) aligner when PyTorch and torchaudio >= 2.10 are installed and
the model is cached or may be downloaded, and the DSP aligner otherwise. Values are read at
call time and checks never import torch.
"""

import os
from pathlib import Path
from typing import Any

from backend.services.separation_presets import package_available, package_version, version_tuple

ENGINES = ("auto", "ctc", "dsp")
WEIGHTS_FILE = "mms_fa.pt"
MIN_TORCHAUDIO = (2, 10)
LICENSE_NOTE = (
    "Neural alignment uses Meta's MMS model (about 1.2 GB), published under CC-BY-NC 4.0: "
    "free for non-commercial use."
)


def _flag(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() not in ("0", "false", "no", "off")


def _positive(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def normalize_engine(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    clean = value.strip().lower()
    return clean if clean in ENGINES else None


def requested_engine() -> str:
    return normalize_engine(os.getenv("ALIGNMENT_ENGINE")) or "auto"


def downloads_allowed() -> bool:
    return _flag("ALIGNMENT_ALLOW_DOWNLOAD", True)


def refine_plain_lyrics() -> bool:
    return _flag("ALIGN_REFINE_PLAIN", True)


def min_confidence() -> float:
    value = _positive("ALIGNMENT_MIN_CONFIDENCE", 0.45)
    return min(value, 1.0)


def timeout_seconds() -> float:
    return _positive("ALIGNMENT_TIMEOUT_SEC", 1800.0)


def stall_seconds() -> float:
    return _positive("ALIGNMENT_STALL_SEC", 600.0)


def max_concurrent_jobs() -> int:
    try:
        return max(1, int(os.getenv("MAX_CONCURRENT_ALIGN_JOBS", "1").strip()))
    except ValueError:
        return 1


def model_dir() -> Path:
    raw = os.getenv("ALIGNMENT_MODEL_DIR", "").strip()
    if raw:
        return Path(raw)
    from backend.config import DATA_DIR

    return DATA_DIR / "models" / "mms_fa"


def weights_cached() -> bool:
    return (model_dir() / WEIGHTS_FILE).is_file()


def ctc_status() -> tuple[bool, str | None]:
    """Whether the neural aligner can run now, and why not."""
    if not package_available("torch"):
        return False, "PyTorch is not installed"
    if not package_available("torchaudio"):
        return False, "torchaudio is not installed"
    version = package_version("torchaudio")
    if version and version_tuple(version) < MIN_TORCHAUDIO:
        return False, f"torchaudio {version} is too old (2.10 or newer is needed)"
    if weights_cached() or downloads_allowed():
        return True, None
    return False, "The MMS model is not downloaded and automatic download is disabled"


def effective_engine(requested: str | None = None) -> tuple[str, str | None]:
    """The engine that will run for a request, and why the neural one will not."""
    engine = normalize_engine(requested) or requested_engine()
    if engine == "dsp":
        return "dsp", None
    ready, reason = ctc_status()
    return ("ctc", None) if ready else ("dsp", reason)


def alignment_capabilities() -> dict[str, Any]:
    requested = requested_engine()
    effective, reason = effective_engine(requested)
    ready, unavailable = ctc_status()
    return {
        "requested": requested,
        "effective": effective,
        "ctc_available": ready,
        "reason": reason or (None if ready else unavailable),
        "weights_cached": weights_cached(),
        "downloads_allowed": downloads_allowed(),
        "license_note": LICENSE_NOTE,
    }
