"""What an exported subtitle file's look depends on: the stage looks, the request's
style_config made safe, and AssStyle.resolve, which decides between them."""

import math
import re
from dataclasses import dataclass
from typing import Any

from backend.config import DEFAULT_VIDEO_CONFIG
from backend.services.ass_document import css_to_ass_color
from backend.services.lyric_tokenize import is_cjk_token
from backend.shared_assets import load

# Each stage look's id, name, description and sung/unsung colours are shared with the stage
# (backend/assets/shared/stage_presets.json); these are what only the export needs.
_EXPORT_STYLES: dict[str, dict[str, Any]] = {
    "punk_diy": {
        "outline_color": "&H00000000",  # Solid Ink Black outline
        "shadow_color": "&H00000000",  # Hard offset drop shadow
        "outline_width": 3,
        "shadow_width": 3,
        "font_name": "Impact",
    },
    "tape_70s": {
        "outline_color": "&H00000000",  # Deep walnut/black outline
        "shadow_color": "&H80000000",  # Warm tape shadow
        "outline_width": 3,
        "shadow_width": 2,
        "font_name": "Georgia",
    },
    "crt_ktv": {
        "outline_color": "&H00000000",  # Deep cathode black
        "shadow_color": "&H80000000",  # CRT scanline shadow
        "outline_width": 3,
        "shadow_width": 2,
        "font_name": "VT323",
    },
    "clean_paper": {
        "outline_color": "&H00FFFFFF",  # Paper white contrast outline
        "shadow_color": "&H00000000",  # Sharp brutalist offset shadow
        "outline_width": 2,
        "shadow_width": 2,
        "font_name": "Space Grotesk",
    },
    "afterglow": {
        "outline_color": "&H00120B0B",  # #0b0b12 (Ink) outline
        "shadow_color": "&H80120B0B",  # Soft ink shadow
        "outline_width": 3,
        "shadow_width": 2,
        "font_name": "Sora",
    },
}


def _export_preset(shared: dict[str, Any]) -> dict[str, Any]:
    preset = {**shared, **_EXPORT_STYLES.get(shared["id"], {})}
    for field in ("singer2_color", "both_color"):
        if field in preset:
            preset[field] = css_to_ass_color(preset[field])
    return preset


_STAGE_PRESETS = load("stage_presets")
VISUAL_THEMES: dict[str, dict[str, Any]] = {
    preset["id"]: _export_preset(preset) for preset in _STAGE_PRESETS["presets"]
}

DEFAULT_THEME_ID = "modern_gold"

DEFAULT_SINGER2_COLOR = css_to_ass_color(_STAGE_PRESETS["default_duet_colors"]["singer2"])
DEFAULT_BOTH_COLOR = css_to_ass_color(_STAGE_PRESETS["default_duet_colors"]["both"])


# A line too long for MAX_LINE_ROWS rows (libass wraps it) would climb over the other lyric
# row: it is shrunk to fit, down to MIN_LINE_SCALE (percent). Widths are estimated from the
# font size: a CJK character is about one em wide, other characters LATIN_CHAR_EM of one.
MAX_LINE_ROWS = 2
MIN_LINE_SCALE = 70
LATIN_CHAR_EM = 0.58


def estimated_width(text: str, font_size: float) -> float:
    """About how wide a line of lyrics is drawn, in script pixels."""
    wide = sum(1 for ch in text if is_cjk_token(ch))
    return font_size * (wide + LATIN_CHAR_EM * (len(text) - wide))


def line_scale(text: str, style: "AssStyle") -> int:
    """The percent a line is drawn at so it wraps to at most MAX_LINE_ROWS rows: 100 for
    lines that fit, never below MIN_LINE_SCALE."""
    usable = max(1, style.width - 2 * style.margin_lr) * MAX_LINE_ROWS * 0.92
    width = estimated_width(text, style.font_size)
    if width <= usable:
        return 100
    return max(MIN_LINE_SCALE, int(100 * usable / width))


def resolve_sync_mode(sync_mode: str | None, style_config: dict[str, Any] | None) -> str:
    """The sweep mode, "word" or "line": the requested one, unless it is None or the "word"
    default and style_config names one. Anything else counts as "word"."""
    mode = sync_mode
    if (mode is None or mode == "word") and style_config and "sync_mode" in style_config:
        mode = style_config["sync_mode"]
    mode = str(mode or "word").strip().lower()
    return mode if mode in ("word", "line") else "word"


# style_config fields written into the [V4+ Styles] and [Script Info] lines, with the range
# each is clamped to. Text there is unescaped ASS: a comma would shift a style's fields and a
# newline would start a section of its own (embedded fonts included), and a huge size would
# send libass into minutes of work, so request values never reach the file unchecked.
_STYLE_NUMBER_RANGES: dict[str, tuple[float, float, bool]] = {
    # field: (lowest, highest, whole number)
    "width": (16, 4096, True),
    "height": (16, 4096, True),
    "font_size": (8, 400, True),
    "font_size_scale": (0.1, 5.0, False),
    "outline_width": (0, 20, False),
    "shadow_width": (0, 20, False),
    "margin_v_line1": (0, 4096, True),
    "margin_v_line2": (0, 4096, True),
    "margin_v_countdown": (0, 4096, True),
    "margin_v_chord": (0, 4096, True),
    "margin_lr": (0, 4096, True),
    "chord_alignment": (1, 9, True),
    "semitones": (-12, 12, True),
}
_STYLE_COLOR_DEFAULTS = {"outline_color": "&H00111111", "shadow_color": "&H80000000"}
_FONT_NAME_UNSAFE = re.compile(r"[,{}\\\x00-\x1f\x7f]")
_FONT_NAME_MAX = 64


def clean_style_config(style_config: dict[str, Any] | None) -> dict[str, Any]:
    """A copy of a request's style_config that is safe to write into the subtitle file.

    font_name loses commas, braces, backslashes and control characters (and is cut to 64
    characters); outline and shadow colours must be colours; sizes, widths, margins and the
    like must be finite numbers and are clamped to sane ranges. A value that fails is left
    out, so the stage look or the default applies instead."""
    if not isinstance(style_config, dict):
        return {}
    cleaned = dict(style_config)
    if "font_name" in cleaned:
        raw = cleaned.pop("font_name")
        name = (
            _FONT_NAME_UNSAFE.sub("", raw).strip()[:_FONT_NAME_MAX] if isinstance(raw, str) else ""
        )
        if name:
            cleaned["font_name"] = name
    for field, default in _STYLE_COLOR_DEFAULTS.items():
        if field in cleaned:
            raw = cleaned.pop(field)
            if raw:
                cleaned[field] = css_to_ass_color(str(raw), default=default)
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
        # Whole values stay ints, so an outline of 5 is written as 5, not 5.0
        cleaned[field] = round(value) if whole or value.is_integer() else value
    return cleaned


# What a stage look (VISUAL_THEMES entry) sets, where style_config leaves it out
_PRESET_FIELDS = (
    "primary_color",
    "secondary_color",
    "font_name",
    "outline_color",
    "shadow_color",
    "outline_width",
    "shadow_width",
)


@dataclass(frozen=True)
class AssStyle:
    """Everything an exported subtitle file's look depends on, resolved once by resolve()."""

    sync_mode: str
    countdown: bool
    chords_enabled: bool
    semitones: int
    chords: list[dict[str, Any]] | None
    key: str | None
    width: int
    height: int
    font_name: str
    font_size: int
    primary_color: str
    secondary_color: str
    outline_color: str
    shadow_color: str
    outline_width: int
    shadow_width: int
    singer2_color: str
    both_color: str
    margin_v_line1: int
    margin_v_line2: int
    margin_v_countdown: int
    margin_lr: int
    margin_v_title: int
    chord_font_size: int
    chord_color: str
    chord_alignment: int
    margin_v_chord: int
    chord_align_tag: str

    @classmethod
    def resolve(
        cls,
        style_config: dict[str, Any] | None = None,
        aspect_ratio: str = "16:9",
        theme_id: str | None = None,
        primary_color: str | None = None,
        secondary_color: str | None = None,
        singer2_color: str | None = None,
        both_color: str | None = None,
        font_size_scale: float = 1.0,
        include_countdown: bool = True,
        chords: list[dict[str, Any]] | None = None,
        include_chords: bool = False,
        semitones: int = 0,
        key: str | None = None,
        sync_mode: str | None = "word",
    ) -> "AssStyle":
        """Decides between the arguments, the request's style_config, the stage look
        (theme preset) and the defaults:

        1. Sync mode: the argument, unless it is None or "word" (resolve_sync_mode).
        2. Countdown: style_config's include_countdown (or its legacy enable_gap_countdown),
           else the argument.
        3. Chords on/off, semitones and font scale: style_config's when it has the key.
        4. Chords and key: the argument, unless it is None.
        5. Aspect ratio: style_config's, else the argument; a style_config taller than wide
           is portrait too. Portrait defaults fill only what style_config leaves out.
        6. Stage look: the theme_id argument, else style_config's. Its preset fills what
           style_config leaves out, and DEFAULT_VIDEO_CONFIG what neither sets.
        7. Sung and unsung colours: an argument that is not None, else the merged config;
           every source is normalised to an ASS colour.
        8. Duet colours: a given argument > style_config > the preset > the defaults; a value
           that is not a colour counts as not given.
        """
        given = clean_style_config(style_config)

        countdown = include_countdown
        if "include_countdown" in given:
            countdown = bool(given["include_countdown"])
        elif "enable_gap_countdown" in given:
            countdown = bool(given["enable_gap_countdown"])

        chords_enabled = (
            bool(given["include_chords"]) if "include_chords" in given else include_chords
        )
        semitones = int(given["semitones"]) if "semitones" in given else semitones
        scale = float(given.get("font_size_scale", font_size_scale))
        if scale <= 0.0 or not math.isfinite(scale):
            scale = 1.0

        if chords is None:
            chords = given.get("chords")
        if key is None:
            key = given.get("key")

        vertical = (given.get("aspect_ratio") or aspect_ratio) == "9:16"
        if not vertical:
            w, h = given.get("width"), given.get("height")
            vertical = w is not None and h is not None and h > w

        cfg = {**DEFAULT_VIDEO_CONFIG, **given}
        default_font_size = 46 if vertical else 52
        if vertical:
            for field, value in (("width", 1080), ("height", 1920), ("font_size", 46)):
                if field not in given:
                    cfg[field] = value

        theme_id = theme_id or given.get("theme_id")
        preset = VISUAL_THEMES.get(theme_id, {}) if theme_id else {}
        for field in _PRESET_FIELDS:
            if field in preset and field not in given:
                cfg[field] = preset[field]

        if primary_color is not None:
            cfg["primary_color"] = css_to_ass_color(primary_color)
        elif cfg.get("primary_color"):
            cfg["primary_color"] = css_to_ass_color(cfg["primary_color"])
        if secondary_color is not None:
            cfg["secondary_color"] = css_to_ass_color(secondary_color, default="&H00FFFFFF")
        elif cfg.get("secondary_color"):
            cfg["secondary_color"] = css_to_ass_color(cfg["secondary_color"], default="&H00FFFFFF")

        def duet_color(arg: str | None, field: str, fallback: str) -> str:
            raw = arg or given.get(field) or preset.get(field)
            return css_to_ass_color(raw, default=preset.get(field, fallback)) if raw else fallback

        font_size = max(12, round(cfg.get("font_size", default_font_size) * scale))
        chord_color = given.get("chord_color")
        chord_alignment = int(given.get("chord_alignment", 8))
        if chord_alignment == 8:
            margin_v_chord = given.get("margin_v_chord", 120 if vertical else 80)
        elif chord_alignment == 2:
            margin_v_chord = given.get("margin_v_chord", 720 if vertical else 270)
        else:
            margin_v_chord = given.get("margin_v_chord", 80)

        return cls(
            sync_mode=resolve_sync_mode(sync_mode, style_config),
            countdown=countdown,
            chords_enabled=chords_enabled,
            semitones=semitones,
            chords=chords,
            key=key,
            width=cfg["width"],
            height=cfg["height"],
            font_name=cfg.get("font_name", "DejaVu Sans"),
            font_size=font_size,
            primary_color=cfg.get("primary_color", "&H0022E5FF"),
            secondary_color=cfg.get("secondary_color", "&H00FFFFFF"),
            outline_color=cfg.get("outline_color", "&H00111111"),
            shadow_color=cfg.get("shadow_color", "&H80000000"),
            outline_width=cfg.get("outline_width", 3),
            shadow_width=cfg.get("shadow_width", 2),
            singer2_color=duet_color(singer2_color, "singer2_color", DEFAULT_SINGER2_COLOR),
            both_color=duet_color(both_color, "both_color", DEFAULT_BOTH_COLOR),
            margin_v_line1=given.get("margin_v_line1", 640 if vertical else 200),
            margin_v_line2=given.get("margin_v_line2", 500 if vertical else 110),
            margin_v_countdown=given.get("margin_v_countdown", 780 if vertical else 290),
            margin_lr=given.get("margin_lr", 60 if vertical else 80),
            margin_v_title=300 if vertical else 180,
            chord_font_size=max(12, round(font_size * 0.70)),
            chord_color=(
                css_to_ass_color(chord_color, default="&H0000D7FF") if chord_color else "&H0000D7FF"
            ),
            chord_alignment=chord_alignment,
            margin_v_chord=margin_v_chord,
            chord_align_tag=f"{{\\an{chord_alignment}}}",
        )
