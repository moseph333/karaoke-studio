"""How each look treats the picture behind the lyrics: the song's cover art (a still made
once), an uploaded image or video, and for a look with a picture frame (Cinema's letterbox)
where in the frame the picture goes.

The treatments are FFmpeg filter chains built from the look's ``art`` block in the shared
spec, so the stage is served the same still (the backdrop route) and can imitate what is
done to an upload."""

from typing import Any

from backend.services.stage_looks import SHORT_SIDE_PX, resolve_look

# The cover art blurred and darkened so outlined lyrics stand out: the treatment exports
# have always used, which KTV keeps
BLUR_LOOK = "boxblur=45:5,eq=brightness=-0.25:contrast=1.1"
# How much of each channel makes a grey of the same lightness (Rec. 709)
_LUMA = (0.2126, 0.7152, 0.0722)


def look_for(look_id: Any) -> dict[str, Any] | None:
    """The look an id names (a replaced preset's id included), or None for no id at all,
    which keeps a background exactly as exports drew it before the looks."""
    if not look_id:
        return None
    return resolve_look(look_id)[0]


def _hex_rgb(color: str) -> tuple[int, int, int]:
    value = color.lstrip("#")
    return int(value[0:2], 16), int(value[2:4], 16), int(value[4:6], 16)


def treatment_chain(treatment: dict[str, Any] | None, ground: str) -> str:
    """The filter chain of one treatment (empty for none): ``blur`` (with a ``level``, darker
    still), ``mono`` (grey, at ``level`` of its lightness), ``dim`` (colours kept, at
    ``level``), ``wash`` (grey, ``keep`` of it over the look's ground colour) or ``sharp``."""
    if not treatment:
        return ""
    kind = treatment["kind"]
    if kind == "blur":
        level = treatment.get("level")
        if level is None:
            return BLUR_LOOK
        return f"boxblur=45:5,colorchannelmixer=rr={level:g}:gg={level:g}:bb={level:g}"
    if kind == "mono":
        row = ":".join(f"{weight * treatment['level']:.4f}" for weight in _LUMA) + ":0"
        return f"colorchannelmixer={row}:{row}:{row}"
    if kind == "dim":
        level = treatment["level"]
        return f"colorchannelmixer=rr={level:g}:gg={level:g}:bb={level:g}"
    if kind == "wash":
        keep = treatment["keep"]
        channels = ":".join(
            f"{name}={value * (1 - keep):.2f}+val*{keep:g}"
            for name, value in zip("rgb", _hex_rgb(ground), strict=True)
        )
        return f"hue=s=0,format=rgb24,lutrgb={channels}"
    return ""


def cover_chain(look: dict[str, Any]) -> str:
    """What the look does to the song's cover art."""
    return treatment_chain(look["art"]["cover"], look["palette"]["ground"])


def upload_chain(look: dict[str, Any]) -> str:
    """What the look does to an uploaded image or video so its lyrics stay readable."""
    return treatment_chain(look["art"]["upload"], look["palette"]["ground"])


def picture_rect(
    look: dict[str, Any] | None, width: int, height: int
) -> tuple[int, int, int, int] | None:
    """Where the picture goes in a frame of ``width`` by ``height`` pixels, as (x, y, width,
    height) on even pixels, for a look that frames it; None for a look whose picture fills
    the frame."""
    if not look:
        return None
    aspect = "9:16" if height > width else "16:9"
    picture = look["frames"][aspect].get("picture")
    if not picture:
        return None
    u = SHORT_SIDE_PX / 100

    def even(value: float) -> int:
        return round(value * u / 2) * 2

    x, y = even(picture["x"]), even(picture["y"])
    return x, y, min(even(picture["w"]), width - x), min(even(picture["h"]), height - y)


def pad_to_frame(rect: tuple[int, int, int, int], width: int, height: int) -> str:
    """The filter that sets a picture of the rect's size into a black frame."""
    x, y, _w, _h = rect
    return f"pad={width}:{height}:{x}:{y}:black"
