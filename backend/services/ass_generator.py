"""Advanced SubStation Alpha (.ass) subtitle file generator supporting progressive karaoke sweep tags (\\kf), responsive 16:9/9:16 layouts, and visual theme styling."""

import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.config import DEFAULT_VIDEO_CONFIG
from backend.services.lyric_tokenize import (
    adlib_flags,
    is_cjk_token,
    space_after,
    tokenize_lyric_text,
)
from backend.shared_assets import load

_ASS_COLOR_DIGITS = re.compile(r"[0-9A-F]{6}(?:[0-9A-F]{2})?")


def css_to_ass_color(color: str, default: str = "&H0000D7FF") -> str:
    """Converts CSS hex color (#RRGGBB or RRGGBB) to ASS color format (&H00BBGGRR).

    An ASS color (&HBBGGRR or &HAABBGGRR) comes back upper-cased. Anything else gives
    ``default``, so request text never reaches the subtitle file.
    """
    if not color:
        return default
    c = str(color).strip()
    if c[:2].upper() == "&H":
        digits = c[2:].removesuffix("&").upper()
        return f"&H{digits}" if _ASS_COLOR_DIGITS.fullmatch(digits) else default
    if c.startswith("#"):
        c = c[1:]
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) == 6:
        try:
            int(c, 16)
            r = c[0:2].upper()
            g = c[2:4].upper()
            b = c[4:6].upper()
            return f"&H00{b}{g}{r}"
        except ValueError:
            return default
    return default


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


def safe_time(val: Any, default: float = 0.0) -> float:
    """Safely coerce timestamp values to non-negative finite floats.

    Handles None, NaN, Inf, negative values, and non-numeric types gracefully.
    """
    try:
        f = float(val)
        if math.isfinite(f) and f >= 0.0:
            return f
    except (ValueError, TypeError):
        pass

    try:
        d = float(default)
        if math.isfinite(d) and d >= 0.0:
            return d
    except (ValueError, TypeError):
        pass

    return 0.0


# The countdown's rule, which the YouTube kit's chapters (youtube_uploader) follow too: a
# silence of INSTRUMENTAL_GAP_THRESHOLD_SECONDS or more before a line is an instrumental gap
# (the stage's frontend/src/utils/gapDetection.ts uses the same threshold), and the countdown
# starts COUNTDOWN_LEAD_IN_SECONDS before that line.
INSTRUMENTAL_GAP_THRESHOLD_SECONDS = 4.0
COUNTDOWN_LEAD_IN_SECONDS = 3.0
# During a gap the video says so (GapLabel) from GAP_LABEL_DELAY_SECONDS into it until the next
# line shows; after the last line a title card shows from OUTRO_DELAY_SECONDS on, to the
# song's end, when that leaves OUTRO_MIN_SECONDS for it
GAP_LABEL_DELAY_SECONDS = 1.5
OUTRO_DELAY_SECONDS = 1.5
OUTRO_MIN_SECONDS = 3.0


def export_title(proj: dict) -> str:
    """The title an export carries (the subtitle file's title, the video's closing card):
    "Artist - Title", or whichever of the two the song has."""
    title = str(proj.get("title") or "").strip()
    artist = str(proj.get("artist") or "").strip()
    return f"{artist} - {title}" if (artist and title) else (title or artist or "Karaoke Track")


def line_span(line: dict) -> tuple[float, float]:
    """A line's (start, end) in seconds: a missing or bad start is 0, a missing or bad end is
    4 s after the start, and the end is never before the start."""
    start = safe_time(line.get("start_time"), 0.0)
    end = max(start, safe_time(line.get("end_time"), start + 4.0))
    return start, end


def instrumental_gaps(lines: Any) -> list[int]:
    """The indexes of the lines that come after an instrumental gap: a silence of at least
    INSTRUMENTAL_GAP_THRESHOLD_SECONDS since the song's start, or since the latest end of
    any line before it. Entries that are not dicts are skipped but keep their index."""
    if not isinstance(lines, list):
        return []
    gaps: list[int] = []
    previous_end = 0.0
    for i, line in enumerate(lines):
        if not isinstance(line, dict):
            continue
        start, end = line_span(line)
        if start - previous_end >= INSTRUMENTAL_GAP_THRESHOLD_SECONDS:
            gaps.append(i)
        previous_end = max(previous_end, end)
    return gaps


# Words sung in parentheses (backing vocals, ad-libs) are smaller, italic and a little faded;
# {\\r} then returns to the line's own style (its singer colours included)
ADLIB_ON = "{\\i1\\fscx80\\fscy80\\alpha&H40&}"
ADLIB_OFF = "{\\r}"

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


def _scale_tag(scale: int) -> str:
    return "" if scale == 100 else f"{{\\fscx{scale}\\fscy{scale}}}"


def _adlib_tags(scale: int) -> tuple[str, str]:
    """The ad-lib on and off tags for a line drawn at ``scale`` percent."""
    if scale == 100:
        return ADLIB_ON, ADLIB_OFF
    small = round(0.8 * scale)
    return (
        f"{{\\i1\\fscx{small}\\fscy{small}\\alpha&H40&}}",
        ADLIB_OFF + _scale_tag(scale),
    )


def _adlib_text(text: str, scale: int = 100) -> str:
    """A line's escaped words spaced as written (no spaces between CJK characters), with the
    ad-lib runs (adlib_flags) styled, drawn at ``scale`` percent."""
    tokens = tokenize_lyric_text(text)
    on, off = _adlib_tags(scale)
    parts: list[str] = [_scale_tag(scale)]
    inside = False
    spaced = space_after(tokens, text)
    for token, adlib, gap in zip(tokens, adlib_flags(tokens), spaced, strict=True):
        if adlib != inside:
            parts.append(on if adlib else off)
            inside = adlib
        parts.append(escape_ass_text(token) + (" " if gap else ""))
    return "".join(parts).strip()


def _word_sweep_text(
    words: list,
    base_cs: int,
    line_start: float,
    escape: bool = True,
    source: str | None = None,
    scale: int = 100,
) -> str:
    """Karaoke text with one \\kf sweep per word, placed on absolute centisecond boundaries.

    Silent \\k spacers cover the lead-in and every pause between words, and each boundary is
    rounded once (not each duration), so the highlight neither runs ahead after a pause nor
    drifts over a long line. Words in parentheses are styled as ad-libs (ADLIB_ON). Words
    are spaced as in the line's ``source`` text, so CJK characters are not spaced out. A
    ``scale`` under 100 draws the line smaller (line_scale).
    """
    parts: list[str] = [_scale_tag(scale)]
    on, off = _adlib_tags(scale)
    cursor = base_cs
    previous_end = line_start
    words = [w for w in words if isinstance(w, dict)]
    tokens = [str(w.get("word") or "") for w in words]
    adlib = adlib_flags(tokens)
    spaced = space_after(tokens, source)
    inside = False
    for w, is_adlib, gap in zip(words, adlib, spaced, strict=True):
        if is_adlib != inside:
            parts.append(on if is_adlib else off)
            inside = is_adlib
        start = safe_time(w.get("start_time"), previous_end)
        end = safe_time(w.get("end_time"), start + 0.4)
        start_cs = max(cursor, round(start * 100))
        end_cs = max(start_cs + 1, round(end * 100))
        if start_cs > cursor:
            parts.append(f"{{\\k{start_cs - cursor}}}")
        raw_word = str(w.get("word") or "")
        word_text = escape_ass_text(raw_word) if escape else raw_word
        parts.append(f"{{\\kf{end_cs - start_cs}}}{word_text}{' ' if gap else ''}")
        cursor = end_cs
        previous_end = max(start, end)
    return "".join(parts).strip()


def format_ass_time(seconds: float) -> str:
    """Converts float seconds to ASS timestamp format: H:MM:SS.cs

    Safely handles negative values, non-finite values (NaN, Inf), None,
    and ensures proper centisecond-to-second rollover (e.g. 59.996s -> 0:01:00.00).
    """
    try:
        val = float(seconds)
        if not math.isfinite(val) or val < 0.0:
            val = 0.0
    except (ValueError, TypeError):
        val = 0.0

    total_cs = round(val * 100)
    cs = total_cs % 100
    total_s = total_cs // 100
    s = total_s % 60
    m = (total_s // 60) % 60
    h = total_s // 3600
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


# Follows each backslash a lyric contains. ASS has no escape for the backslash itself (libass
# draws "\\" as two), so the only way to keep "\N", "\n", "\h" or a backslash before the next
# word's "{" from acting is to part the pair. U+2060 WORD JOINER has no width, allows no line
# break, and libass never draws it, whatever the font
BACKSLASH_GUARD = "\u2060"


def escape_ass_text(text: str) -> str:
    r"""Lyric text made safe for an ASS Dialogue line: braces are escaped (\{ and \}), a
    backslash is drawn as the one character it is and never starts \N, \n or \h, and real
    line breaks become spaces."""
    if not text:
        return ""
    text = str(text)
    # Backslashes first, then the braces, whose escapes add backslashes of their own
    text = text.replace("\\", "\\" + BACKSLASH_GUARD)
    text = text.replace("{", "\\{")
    text = text.replace("}", "\\}")
    text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    return text


def singer_part(line: dict[str, Any]) -> str:
    """Which part sings a line: "singer2", "both" or "singer1" (the default), by the singer
    labels the stage shares (backend/assets/shared/singer_aliases.json)."""
    raw = str(line.get("singer") or "singer1").strip().lower()
    return load("singer_aliases").get(raw, "singer1")


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


def generate_ass_content(
    lines: list[dict[str, Any]],
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    title: str = "",
    style_config: dict[str, Any] | None = None,
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    chords: list[dict[str, Any]] | None = None,
    include_chords: bool = False,
    semitones: int = 0,
    key: str | None = None,
    sync_mode: str = "word",
    song_duration: float | None = None,
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file content

    with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
    Supports dynamic 16:9 and 9:16 layout adjustments, visual theme presets,
    direct color overrides, font size scaling, control character escaping,
    and optional transposed musical chords on Layer 2. AssStyle.resolve decides which
    of the arguments, style_config, the stage look and the defaults applies. With the
    countdown on, instrumental gaps also get a label, and the end of the song a title card
    (when ``song_duration`` is given).
    """
    style = AssStyle.resolve(
        style_config=style_config,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        singer2_color=singer2_color,
        both_color=both_color,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        chords=chords,
        include_chords=include_chords,
        semitones=semitones,
        key=key,
        sync_mode=sync_mode,
    )

    safe_title = (title or "Karaoke Studio").replace("\r", " ").replace("\n", " ").strip()
    doc_title = safe_title or "Karaoke Studio"

    ass_content = [
        "[Script Info]",
        f"Title: {doc_title}",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {style.width}",
        f"PlayResY: {style.height}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # Alignment 2 = Bottom Center, 5 = Top Center
        f"Style: KaraokeLine1,{style.font_name},{style.font_size},{style.primary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: KaraokeLine2,{style.font_name},{style.font_size},{style.primary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line2},1",
        f"Style: KaraokeLine1_Singer2,{style.font_name},{style.font_size},{style.singer2_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: KaraokeLine2_Singer2,{style.font_name},{style.font_size},{style.singer2_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line2},1",
        f"Style: KaraokeLine1_Both,{style.font_name},{style.font_size},{style.both_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: KaraokeLine2_Both,{style.font_name},{style.font_size},{style.both_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line2},1",
        f"Style: Countdown,{style.font_name},{style.font_size + 10},{style.primary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,2,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_countdown},1",
        f"Style: GapLabel,{style.font_name},{max(24, style.font_size - 12)},{style.secondary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},0,-1,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: TitleCard,{style.font_name},64,&H00FFFFFF,&H00FFFFFF,{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,3,3,5,{style.margin_lr},{style.margin_lr},{style.margin_v_title},1",
    ]

    if style.chords_enabled:
        ass_content.append(
            f"Style: Chord,{style.font_name},{style.chord_font_size},{style.chord_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{max(1, style.outline_width - 1)},{style.shadow_width},{style.chord_alignment},{style.margin_lr},{style.margin_lr},{style.margin_v_chord},1"
        )

    ass_content.extend(
        [
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )

    prev_end_time = 0.0

    if lines and isinstance(lines, list):
        gap_lines = set(instrumental_gaps(lines))
        for i, line in enumerate(lines):
            if not isinstance(line, dict):
                continue
            l_start, l_end = line_span(line)
            raw_words = line.get("words", [])
            words = raw_words if isinstance(raw_words, list) else []

            # Select line style matching singer part assignment while alternating Line1 and Line2
            base_line = "KaraokeLine1" if (i % 2 == 0) else "KaraokeLine2"
            part = singer_part(line)
            style_name = {"singer2": f"{base_line}_Singer2", "both": f"{base_line}_Both"}.get(
                part, base_line
            )

            # Show line early on screen so the singer can prepare
            has_gap = i in gap_lines
            if i == 0:
                display_start = max(0.0, l_start - 2.5)
            elif l_start > prev_end_time:
                display_start = max(prev_end_time, l_start - 2.0)
            else:
                display_start = max(0.0, l_start - 2.0)

            display_start = max(0.0, min(l_start, display_start))
            display_end = max(display_start + 0.5, l_end + 1.2)

            # Visual countdown cue after an instrumental gap (the rule is instrumental_gaps),
            # and a label while the gap lasts
            if style.countdown and has_gap:
                label_start = (prev_end_time + GAP_LABEL_DELAY_SECONDS) if i else 0.0
                if display_start - label_start >= 1.0:
                    label = "♪ Instrumental Intro ♪" if prev_end_time == 0.0 else "♪ Instrumental ♪"
                    ass_content.append(
                        f"Dialogue: 3,{format_ass_time(label_start)},{format_ass_time(display_start)},GapLabel,,0,0,0,,{label}"
                    )
                countdown_start = max(0.0, l_start - COUNTDOWN_LEAD_IN_SECONDS)
                part_color = {"singer2": style.singer2_color, "both": style.both_color}.get(part)
                dots_color_tag = f"{{\\c{part_color}&}}" if part_color else ""

                dots_text = f"{dots_color_tag}{{\\kf100}}● {{\\kf100}}● {{\\kf100}}● "
                ass_content.append(
                    f"Dialogue: 1,{format_ass_time(countdown_start)},{format_ass_time(l_start)},Countdown,,0,0,0,,{dots_text}"
                )

            lead_in_cs = max(0, round((l_start - display_start) * 100))

            if style.sync_mode == "line":
                raw_text = str(line.get("text") or "").strip()
                if not raw_text and words:
                    raw_text = " ".join(
                        str(w.get("word") or "").strip()
                        for w in words
                        if isinstance(w, dict) and str(w.get("word") or "").strip()
                    )
                clean_line_text = _adlib_text(raw_text, line_scale(raw_text, style))

                if lead_in_cs > 0:
                    line_karaoke_text = f"{{\\k{lead_in_cs}}}{{\\k0}}{clean_line_text}"
                else:
                    line_karaoke_text = clean_line_text
            else:
                base_cs = round(display_start * 100)  # the event start exactly as written
                if words:
                    source = str(line.get("text") or "") or " ".join(
                        str(w.get("word") or "") for w in words if isinstance(w, dict)
                    )
                    line_karaoke_text = _word_sweep_text(
                        words, base_cs, l_start, source=source, scale=line_scale(source, style)
                    )
                elif line.get("text"):
                    escaped_text = escape_ass_text(str(line.get("text") or ""))
                    line_karaoke_text = _word_sweep_text(
                        [{"word": escaped_text, "start_time": l_start, "end_time": l_end}],
                        base_cs,
                        l_start,
                        escape=False,
                    )
                else:
                    line_karaoke_text = f"{{\\k{lead_in_cs}}}" if lead_in_cs > 0 else ""

            romaji = " ".join(str(line.get("romaji") or "").split())
            if romaji:
                # A CJK line's romanization, a smaller row under it in the unsung colour
                tint = style.secondary_color.rstrip("&") + "&"
                line_karaoke_text += (
                    f"\\N{{\\r\\i1\\fscx62\\fscy62\\1c{tint}\\2c{tint}}}{escape_ass_text(romaji)}"
                )
            ass_content.append(
                f"Dialogue: 0,{format_ass_time(display_start)},{format_ass_time(display_end)},{style_name},,0,0,0,,{line_karaoke_text}"
            )

            prev_end_time = max(prev_end_time, l_end)

        # The end of the song: its title, from a moment after the last line to the song's end
        # (only when the song's length is known, so the card never outlasts the song)
        card_start = prev_end_time + OUTRO_DELAY_SECONDS
        duration = safe_time(song_duration, 0.0)
        if style.countdown and prev_end_time > 0 and duration - card_start >= OUTRO_MIN_SECONDS:
            ass_content.append(
                f"Dialogue: 3,{format_ass_time(card_start)},{format_ass_time(duration)},TitleCard,,0,0,0,,"
                f"{{\\fad(600,600)}}{escape_ass_text(doc_title)}"
            )

    # Emit chord events on Layer 2 if enabled
    if style.chords_enabled and style.chords and isinstance(style.chords, list):
        from backend.services.chord_detector import NO_CHORD_VALUES, transpose_chord

        for seg in style.chords:
            if not isinstance(seg, dict):
                continue
            raw_chord = str(seg.get("chord", "")).strip()
            if not raw_chord or raw_chord.upper() in NO_CHORD_VALUES:
                continue

            c_start = safe_time(seg.get("start") if "start" in seg else seg.get("start_time"), 0.0)
            c_end = safe_time(
                seg.get("end") if "end" in seg else seg.get("end_time"), c_start + 1.0
            )
            if c_end <= c_start:
                c_end = c_start + 0.1

            if style.semitones != 0:
                try:
                    transposed = transpose_chord(raw_chord, style.semitones, key=style.key)
                except Exception:
                    transposed = raw_chord
            else:
                transposed = raw_chord

            escaped = escape_ass_text(transposed)
            ass_content.append(
                f"Dialogue: 2,{format_ass_time(c_start)},{format_ass_time(c_end)},Chord,,0,0,0,,{style.chord_align_tag}{escaped}"
            )

    return "\n".join(ass_content) + "\n"


def generate_ass_subtitles(
    lines: list[dict[str, Any]],
    output_ass_path: Path,
    style_config: dict[str, Any] | None = None,
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    title: str = "",
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    chords: list[dict[str, Any]] | None = None,
    include_chords: bool = False,
    semitones: int = 0,
    key: str | None = None,
    sync_mode: str = "word",
    song_duration: float | None = None,
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file

    with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
    Supports dynamic 16:9 and 9:16 layout adjustments, custom styling,
    control character escaping, and optional musical chord cues.
    """
    content = generate_ass_content(
        lines=lines,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        singer2_color=singer2_color,
        both_color=both_color,
        title=title,
        style_config=style_config,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        chords=chords,
        include_chords=include_chords,
        semitones=semitones,
        key=key,
        sync_mode=sync_mode,
        song_duration=song_duration,
    )
    output_ass_path.write_text(content, encoding="utf-8")
    return str(output_ass_path)


# Backward-compatible aliases
generate_ass = generate_ass_subtitles
generate_karaoke_ass = generate_ass_content
