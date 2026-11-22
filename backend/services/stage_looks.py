"""The five stage looks, read from the spec the stage reads too
(backend/assets/shared/stage_looks.json): each look's layout, colours, typefaces and where
things sit in a 16:9 and a 9:16 frame.

Lengths in the spec are in u, 1% of the frame's short side (10.8 px in a 1080p video). Sizes
are em sizes and vertical positions are baselines. An id of one of the nine presets the looks
replaced still resolves, to the look nearest it (``legacy_ids``)."""

from dataclasses import dataclass
from typing import Any

from backend.services.text_fit import FitBox, fit_rules
from backend.shared_assets import load

LAYOUTS = ("stack", "rows", "column")
ASPECTS = ("16:9", "9:16")
PARTS = ("singer1", "singer2", "both")
# A video's short side in pixels, so one u is 10.8 px
SHORT_SIDE_PX = 1080


def _spec() -> dict[str, Any]:
    return load("stage_looks")


LOOKS: dict[str, dict[str, Any]] = {look["id"]: look for look in _spec()["looks"]}
DEFAULT_LOOK_ID: str = _spec()["default_look"]
LEGACY_IDS: dict[str, dict[str, Any]] = _spec()["legacy_ids"]
# The duet colours the stage sent for a replaced preset that had none of its own
LEGACY_DUET_COLORS: dict[str, str] = _spec()["legacy_duet_colors"]
TIMING: dict[str, float] = _spec()["timing"]
DEFAULT_PART_NAMES: dict[str, str] = _spec()["default_part_names"]


def is_known_look_id(look_id: Any) -> bool:
    """True for a look's id and for the id of a preset a look replaced."""
    return isinstance(look_id, str) and (look_id in LOOKS or look_id in LEGACY_IDS)


def resolve_look(look_id: Any) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The look an id names, and the legacy entry when the id is a replaced preset's (its
    ``was`` colours are that preset's own, which an old tab sends as if they were chosen).
    Anything unknown gives the default look."""
    if isinstance(look_id, str):
        if look_id in LOOKS:
            return LOOKS[look_id], None
        legacy = LEGACY_IDS.get(look_id)
        if legacy:
            return LOOKS[legacy["look"]], legacy
    return LOOKS[DEFAULT_LOOK_ID], None


@dataclass(frozen=True)
class Frame:
    """A video frame: its size in pixels and in u, and the pixels in one u."""

    aspect: str
    width_px: int
    height_px: int

    @property
    def u(self) -> float:
        return SHORT_SIDE_PX / 100

    @property
    def width(self) -> float:
        return self.width_px / self.u

    @property
    def height(self) -> float:
        return self.height_px / self.u


def frame_for(aspect: str) -> Frame:
    if aspect == "9:16":
        return Frame("9:16", SHORT_SIDE_PX, SHORT_SIDE_PX * 16 // 9)
    return Frame("16:9", SHORT_SIDE_PX * 16 // 9, SHORT_SIDE_PX)


def fit_box(box: dict[str, Any], scale: float = 1.0) -> FitBox:
    """The sizes a text box of the spec allows: its ``min``, ``prefer`` and ``max``, or one
    ``size`` that may shrink by the spec's ``shrink`` before the text is condensed. ``scale``
    is the lyric size the user chose."""
    if "size" in box:
        size = box["size"] * scale
        return FitBox(
            measure=box["measure"],
            min=size * fit_rules()["shrink"],
            prefer=size,
            max=size,
            rows=box.get("rows", 1),
        )
    return FitBox(
        measure=box["measure"],
        min=box["min"] * scale,
        prefer=box["prefer"] * scale,
        max=box["max"] * scale,
        rows=box.get("rows", 1),
    )
