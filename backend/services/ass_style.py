"""Decides the look of one export from what the request says: resolve_look_style turns the
arguments, the request's style_config and the look into the LookStyle the generator draws."""

import math
from typing import Any

from backend.services.ass_document import to_css_color
from backend.services.ass_draw import LookStyle
from backend.services.stage_looks import LEGACY_DUET_COLORS, frame_for, resolve_look


def resolve_sync_mode(sync_mode: str | None, style_config: dict[str, Any] | None) -> str:
    """The sweep mode, "word" or "line": the requested one, unless it is None or the "word"
    default and style_config names one. Anything else counts as "word"."""
    mode = sync_mode
    if (mode is None or mode == "word") and style_config and "sync_mode" in style_config:
        mode = style_config["sync_mode"]
    mode = str(mode or "word").strip().lower()
    return mode if mode in ("word", "line") else "word"


# The numbers of a style_config that are read, with the range each is clamped to. Everything
# else a style_config once set about the drawing (font_name, font_size, outline_*, shadow_*,
# margin_*, chord_alignment) belongs to the look now and is ignored.
_STYLE_NUMBER_RANGES: dict[str, tuple[float, float, bool]] = {
    # field: (lowest, highest, whole number)
    "width": (16, 4096, True),
    "height": (16, 4096, True),
    "font_size_scale": (0.1, 5.0, False),
    "semitones": (-12, 12, True),
}


def clean_style_config(style_config: dict[str, Any] | None) -> dict[str, Any]:
    """A copy of a request's style_config with its numbers made safe: finite, and clamped to
    sane ranges. A value that fails is left out, so the default applies instead."""
    if not isinstance(style_config, dict):
        return {}
    cleaned = dict(style_config)
    for field, (lowest, highest, whole) in _STYLE_NUMBER_RANGES.items():
        if field not in cleaned:
            continue
        raw = cleaned.pop(field)
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        if not math.isfinite(value):
            continue
        value = min(max(value, lowest), highest)
        cleaned[field] = round(value) if whole or value.is_integer() else value
    return cleaned


# style_config's names for the four colours a user can choose
_COLOR_FIELDS = {
    "sung": "primary_color",
    "unsung": "secondary_color",
    "singer2": "singer2_color",
    "both": "both_color",
}


def resolve_look_style(
    style_config: dict[str, Any] | None = None,
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    sync_mode: str | None = "word",
    part_names: dict[str, str] | None = None,
    frame: str = "video",
) -> LookStyle:
    """Decides between the arguments, the request's style_config and the look:

    1. Sync mode: the argument, unless it is None or "word" (resolve_sync_mode).
    2. Cues (the count-in and the break marker): style_config's include_countdown (or its
       legacy enable_gap_countdown), else the argument. The cards, part names and progress
       line are part of the look and stay.
    3. Lyric size: style_config's font_size_scale when it has one, else the argument; kept
       between 0.1 and 5, and 1 when it is not a size at all.
    4. Format: style_config's aspect_ratio, else the argument; a style_config taller than
       wide is portrait too.
    5. Look: the theme_id argument, else style_config's, else the default look. The id of a
       preset the looks replaced gives the look nearest it.
    6. Sung, unsung, Singer 2 and Both colours: an argument that is a colour, else
       style_config's, else the look's. With a replaced preset's id, a colour equal to that
       preset's own is not a choice (the stage of that time sent the preset's colours with
       every request) and the look's applies; a preset that was only a colour carries its
       sung colour over.
    7. ``frame`` "subtitles" (the plain download) leaves out the progress line.
    """
    given = clean_style_config(style_config)

    cues = include_countdown
    if "include_countdown" in given:
        cues = bool(given["include_countdown"])
    elif "enable_gap_countdown" in given:
        cues = bool(given["enable_gap_countdown"])

    try:
        scale = float(given.get("font_size_scale", font_size_scale))
    except (TypeError, ValueError):
        scale = 1.0
    if scale <= 0.0 or not math.isfinite(scale):
        scale = 1.0
    # The same range whichever way the size came: a tiny or huge one draws nothing readable
    lowest, highest, _whole = _STYLE_NUMBER_RANGES["font_size_scale"]
    scale = min(max(scale, lowest), highest)

    vertical = (given.get("aspect_ratio") or aspect_ratio) == "9:16"
    if not vertical:
        width, height = given.get("width"), given.get("height")
        vertical = width is not None and height is not None and height > width

    look, legacy = resolve_look(theme_id or given.get("theme_id"))
    palette = look["palette"]
    was = {**LEGACY_DUET_COLORS, **legacy["was"]} if legacy else {}
    arguments = {
        "sung": primary_color,
        "unsung": secondary_color,
        "singer2": singer2_color,
        "both": both_color,
    }
    colors: dict[str, str] = {}
    for key, field in _COLOR_FIELDS.items():
        chosen = None
        for candidate in (arguments[key], given.get(field)):
            color = to_css_color(candidate)
            if color and color != was.get(key):
                chosen = color
                break
        if chosen is None and key == "sung" and legacy and legacy.get("carry_sung"):
            chosen = legacy["carry_sung"]
        colors[key] = chosen or palette[key]

    return LookStyle(
        look=look,
        frame=frame_for("9:16" if vertical else "16:9"),
        scale=scale,
        sync_mode=resolve_sync_mode(sync_mode, style_config),
        cues=cues,
        part_names=part_names if isinstance(part_names, dict) else None,
        furniture=frame != "subtitles",
        **colors,
    )
