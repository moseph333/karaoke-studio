"""Values the backend and the studio must agree on (stage presets, singer labels, upload
limits, confidence thresholds, background motion), read from backend/assets/shared, which
the frontend imports too (as @shared/<name>.json)."""

import json
from functools import cache
from pathlib import Path
from typing import Any

SHARED_DIR = Path(__file__).resolve().parent / "assets" / "shared"


@cache
def load(name: str) -> Any:
    """The parsed contents of SHARED_DIR/<name>.json. Treat the result as read-only: it is
    cached and shared by every caller."""
    return json.loads((SHARED_DIR / f"{name}.json").read_text(encoding="utf-8"))
