"""Advanced SubStation Alpha (.ass) subtitle file generator supporting progressive karaoke sweep tags (\\kf), responsive 16:9/9:16 layouts, and visual theme styling."""

import math
from pathlib import Path
from typing import Any

from backend.config import DEFAULT_VIDEO_CONFIG

VISUAL_THEMES: dict[str, dict[str, str]] = {
    "modern_gold": {
        "id": "modern_gold",
        "name": "Modern Gold",
        "description": "Crisp white transitioning into warm radiant gold",
        "primary_color": "&H0000D7FF",
        "secondary_color": "&H00FFFFFF",
    },
    "cyber_cyan": {
        "id": "cyber_cyan",
        "name": "Cyber Cyan",
        "description": "Electric cyan glowing wipe on ambient dark backdrop",
        "primary_color": "&H00FFFF00",
        "secondary_color": "&H00FFFFFF",
    },
    "neon_pink": {
        "id": "neon_pink",
        "name": "Neon Sunset",
        "description": "Vivid magenta sweep with high contrast",
        "primary_color": "&H00B300FF",
        "secondary_color": "&H00FFFFFF",
    },
    "classic_ktv": {
        "id": "classic_ktv",
        "name": "Classic KTV",
        "description": "Traditional karaoke blue-to-yellow karaoke look",
        "primary_color": "&H0000FFFF",
        "secondary_color": "&H00FFFFFF",
    },
}

DEFAULT_THEME_ID = "modern_gold"


def css_to_ass_color(color: str, default: str = "&H0000D7FF") -> str:
    """Converts CSS hex color (#RRGGBB or RRGGBB) to ASS color format (&H00BBGGRR).

    If already in &H format, returns as-is.
    """
    if not color:
        return default
    c = str(color).strip()
    if c.startswith("&H") or c.startswith("&h"):
        return c.upper()
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


def escape_ass_text(text: str) -> str:
    r"""Escapes ASS control characters ({, }, \) in lyric text

    to prevent corrupting ASS override blocks or injecting unintended formatting.
    """
    if not text:
        return ""
    text = str(text)
    # Escape backslashes first, then curly braces
    text = text.replace("\\", "\\\\")
    text = text.replace("{", "\\{")
    text = text.replace("}", "\\}")
    text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
    return text


def generate_ass_content(
    lines: list[dict[str, Any]],
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    title: str = "",
    style_config: dict[str, Any] | None = None,
    font_size_scale: float = 1.0,
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file content

    with smooth progressive karaoke sweep tags (\\kf).
    Supports dynamic 16:9 and 9:16 layout adjustments, visual theme presets,
    direct color overrides, font size scaling, and control character escaping.
    """
    # Determine aspect ratio and layout mode
    ar = (style_config or {}).get("aspect_ratio") or aspect_ratio
    is_vertical = ar == "9:16"
    if not is_vertical and style_config:
        w = style_config.get("width")
        h = style_config.get("height")
        if w is not None and h is not None and h > w:
            is_vertical = True

    default_width, default_height = (1080, 1920) if is_vertical else (1920, 1080)
    default_font_size = 46 if is_vertical else 52
    margin_v_line1 = (style_config or {}).get("margin_v_line1", 640 if is_vertical else 200)
    margin_v_line2 = (style_config or {}).get("margin_v_line2", 500 if is_vertical else 110)
    margin_v_countdown = (style_config or {}).get("margin_v_countdown", 780 if is_vertical else 290)
    margin_lr = (style_config or {}).get("margin_lr", 60 if is_vertical else 80)
    margin_v_title = 300 if is_vertical else 180

    cfg = {**DEFAULT_VIDEO_CONFIG, **(style_config or {})}

    # Read font_size_scale and apply to typography
    scale = float((style_config or {}).get("font_size_scale", font_size_scale))
    if scale <= 0.0 or not math.isfinite(scale):
        scale = 1.0

    if is_vertical:
        if not style_config or "width" not in style_config:
            cfg["width"] = default_width
        if not style_config or "height" not in style_config:
            cfg["height"] = default_height
        if not style_config or "font_size" not in style_config:
            cfg["font_size"] = default_font_size

    # Apply visual theme preset if specified
    if theme_id and theme_id in VISUAL_THEMES:
        theme = VISUAL_THEMES[theme_id]
        cfg["primary_color"] = theme["primary_color"]
        cfg["secondary_color"] = theme["secondary_color"]

    # Apply direct color overrides if passed, normalizing CSS hex to ASS BGR
    if primary_color is not None:
        cfg["primary_color"] = css_to_ass_color(primary_color)
    elif cfg.get("primary_color"):
        cfg["primary_color"] = css_to_ass_color(cfg["primary_color"])

    if secondary_color is not None:
        cfg["secondary_color"] = css_to_ass_color(secondary_color, default="&H00FFFFFF")
    elif cfg.get("secondary_color"):
        cfg["secondary_color"] = css_to_ass_color(cfg["secondary_color"], default="&H00FFFFFF")

    font_name = cfg.get("font_name", "DejaVu Sans")
    base_font_size = cfg.get("font_size", default_font_size)
    font_size = max(12, round(base_font_size * scale))
    primary_color_val = cfg.get("primary_color", "&H0022E5FF")  # Sung color (cyan/gold)
    secondary_color_val = cfg.get("secondary_color", "&H00FFFFFF")  # Unsung text (white)
    outline_color = cfg.get("outline_color", "&H00111111")
    shadow_color = cfg.get("shadow_color", "&H80000000")
    outline_width = cfg.get("outline_width", 3)
    shadow_width = cfg.get("shadow_width", 2)

    safe_title = (title or "Karaoke Studio").replace("\r", " ").replace("\n", " ").strip()
    doc_title = safe_title or "Karaoke Studio"

    ass_content = [
        "[Script Info]",
        f"Title: {doc_title}",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {cfg['width']}",
        f"PlayResY: {cfg['height']}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # Alignment 2 = Bottom Center, 5 = Top Center
        f"Style: KaraokeLine1,{font_name},{font_size},{primary_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line1},1",
        f"Style: KaraokeLine2,{font_name},{font_size},{primary_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line2},1",
        f"Style: Countdown,{font_name},{font_size + 10},{primary_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,2,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_countdown},1",
        f"Style: TitleCard,{font_name},64,&H00FFFFFF,&H00FFFFFF,{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,3,3,5,{margin_lr},{margin_lr},{margin_v_title},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    prev_end_time = 0.0

    if not lines or not isinstance(lines, list):
        return "\n".join(ass_content) + "\n"

    for i, line in enumerate(lines):
        if not isinstance(line, dict):
            continue
        l_start = safe_time(line.get("start_time"), 0.0)
        l_end = safe_time(line.get("end_time"), l_start + 4.0)
        l_end = max(l_start, l_end)
        raw_words = line.get("words", [])
        words = raw_words if isinstance(raw_words, list) else []

        # Alternate between Line1 and Line2 styles for natural dual-line reading
        style_name = "KaraokeLine1" if (i % 2 == 0) else "KaraokeLine2"

        # Show line early on screen so the singer can prepare
        if i == 0:
            display_start = max(0.0, l_start - 2.5)
        elif l_start > prev_end_time:
            display_start = max(prev_end_time, l_start - 2.0)
        else:
            display_start = max(0.0, l_start - 2.0)

        display_start = max(0.0, min(l_start, display_start))
        display_end = max(display_start + 0.5, l_end + 1.2)

        # Visual countdown cue if there's a significant break (> 3 seconds)
        gap = l_start - prev_end_time
        if (i == 0 and l_start >= 3.0) or (i > 0 and gap >= 3.5):
            countdown_start = max(0.0, l_start - 3.0)
            dots_text = "{\\kf100}● {\\kf100}● {\\kf100}● "
            ass_content.append(
                f"Dialogue: 1,{format_ass_time(countdown_start)},{format_ass_time(l_start)},Countdown,,0,0,0,,{dots_text}"
            )

        # Build line text with \\kf (progressive fill) tags
        karaoke_text_parts = []

        # Initial lead-in delay tag if display starts before line starts
        lead_in_cs = max(0, round((l_start - display_start) * 100))
        if lead_in_cs > 0:
            karaoke_text_parts.append(f"{{\\k{lead_in_cs}}}")

        if words:
            cur_word_time = l_start
            for w in words:
                if not isinstance(w, dict):
                    continue
                w_start = safe_time(w.get("start_time"), cur_word_time)
                w_end = safe_time(w.get("end_time"), w_start + 0.4)
                w_end = max(w_start, w_end)
                dur_cs = max(1, round((w_end - w_start) * 100))
                raw_word = str(w.get("word", ""))
                word_text = escape_ass_text(raw_word)

                # Use \\kf for smooth progressive sweep
                karaoke_text_parts.append(f"{{\\kf{dur_cs}}}{word_text} ")
                cur_word_time = w_end
        elif line.get("text"):
            line_dur_cs = max(1, round((l_end - l_start) * 100))
            escaped_text = escape_ass_text(str(line.get("text", "")))
            karaoke_text_parts.append(f"{{\\kf{line_dur_cs}}}{escaped_text}")

        full_line_text = "".join(karaoke_text_parts).strip()

        ass_content.append(
            f"Dialogue: 0,{format_ass_time(display_start)},{format_ass_time(display_end)},{style_name},,0,0,0,,{full_line_text}"
        )

        prev_end_time = max(prev_end_time, l_end)

    return "\n".join(ass_content) + "\n"


def generate_ass_subtitles(
    lines: list[dict[str, Any]],
    output_ass_path: Path,
    style_config: dict[str, Any] | None = None,
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    title: str = "",
    font_size_scale: float = 1.0,
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file

    with smooth progressive karaoke sweep tags (\\kf).
    Supports dynamic 16:9 and 9:16 layout adjustments, custom styling,
    and control character escaping.
    """
    content = generate_ass_content(
        lines=lines,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        title=title,
        style_config=style_config,
        font_size_scale=font_size_scale,
    )
    output_ass_path.write_text(content, encoding="utf-8")
    return str(output_ass_path)
