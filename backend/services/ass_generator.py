"""Advanced SubStation Alpha (.ass) subtitle file generator supporting progressive karaoke sweep tags (\\kf), responsive 16:9/9:16 layouts, and visual theme styling."""

import math
import re
from pathlib import Path
from typing import Any

from backend.config import DEFAULT_VIDEO_CONFIG

VISUAL_THEMES: dict[str, dict[str, Any]] = {
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
    "punk_diy": {
        "id": "punk_diy",
        "name": "Punk DIY Flyer",
        "description": "Gritty Xerox black with raw flyer-yellow wipe and bold typography",
        "primary_color": "&H0015CCFA",  # #facc15 (Flyer Yellow) -> BGR &H0015CCFA
        "secondary_color": "&H00F5F5F5",  # #f5f5f5 (Paper Off-White) -> BGR &H00F5F5F5
        "outline_color": "&H00000000",  # Solid Ink Black outline
        "shadow_color": "&H00000000",  # Hard offset drop shadow
        "outline_width": 3,
        "shadow_width": 3,
        "font_name": "Impact",
    },
    "tape_70s": {
        "id": "tape_70s",
        "name": "Analog 70s Studio",
        "description": "Teak console with warm amber VU meter glow and sepia cream",
        "primary_color": "&H000B9EF5",  # #f59e0b (Warm Amber VU) -> BGR &H000B9EF5
        "secondary_color": "&H00C7F3FE",  # #fef3c7 (Sepia Cream) -> BGR &H00C7F3FE
        "outline_color": "&H00000000",  # Deep walnut/black outline
        "shadow_color": "&H80000000",  # Warm tape shadow
        "outline_width": 3,
        "shadow_width": 2,
        "font_name": "Georgia",
    },
    "crt_ktv": {
        "id": "crt_ktv",
        "name": "Dive Bar CRT KTV",
        "description": "Phosphor green scanline CRT glow with retro arcade raster font",
        "primary_color": "&H005EC522",  # #22c55e (Phosphor Green) -> BGR &H005EC522
        "secondary_color": "&H00ACEF86",  # #86efac (Dim Phosphor Mint) -> BGR &H00ACEF86
        "outline_color": "&H00000000",  # Deep cathode black
        "shadow_color": "&H80000000",  # CRT scanline shadow
        "outline_width": 3,
        "shadow_width": 2,
        "font_name": "VT323",
    },
    "clean_paper": {
        "id": "clean_paper",
        "name": "Clean Paper Studio",
        "description": "Brutalist Swiss drafting paper with razor-sharp editorial red and black ink",
        "primary_color": "&H002626DC",  # #dc2626 (Editorial Red) -> BGR &H002626DC
        "secondary_color": "&H00111111",  # #111111 (Monochrome Ink) -> BGR &H00111111
        "outline_color": "&H00FFFFFF",  # Paper white contrast outline
        "shadow_color": "&H00000000",  # Sharp brutalist offset shadow
        "outline_width": 2,
        "shadow_width": 2,
        "font_name": "Arial",
    },
    "afterglow": {
        "id": "afterglow",
        "name": "Afterglow",
        "description": "Ink-black stage with a warm gold sweep and violet-to-rose duet glow",
        "primary_color": "&H0024BFFB",  # #fbbf24 (Warm Gold) -> BGR &H0024BFFB
        "secondary_color": "&H00FFEBED",  # #edebff (Lilac White) -> BGR &H00FFEBED
        "outline_color": "&H00120B0B",  # #0b0b12 (Ink) outline
        "shadow_color": "&H80120B0B",  # Soft ink shadow
        "outline_width": 3,
        "shadow_width": 2,
        "font_name": "Sora",
        "singer2_color": "&H00B672F4",  # #f472b6 (Rose)
        "both_color": "&H00D4EA5E",  # #5eead4 (Aqua)
    },
}

DEFAULT_THEME_ID = "modern_gold"

DEFAULT_SINGER2_COLOR = "&H00B300FF"  # #ff00b3
DEFAULT_BOTH_COLOR = "&H0050FA7B"  # #7bfa50

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


def _word_sweep_text(words: list, base_cs: int, line_start: float, escape: bool = True) -> str:
    """Karaoke text with one \\kf sweep per word, placed on absolute centisecond boundaries.

    Silent \\k spacers cover the lead-in and every pause between words, and each boundary is
    rounded once (not each duration), so the highlight neither runs ahead after a pause nor
    drifts over a long line.
    """
    parts: list[str] = []
    cursor = base_cs
    previous_end = line_start
    for w in words:
        if not isinstance(w, dict):
            continue
        start = safe_time(w.get("start_time"), previous_end)
        end = safe_time(w.get("end_time"), start + 0.4)
        start_cs = max(cursor, round(start * 100))
        end_cs = max(start_cs + 1, round(end * 100))
        if start_cs > cursor:
            parts.append(f"{{\\k{start_cs - cursor}}}")
        raw_word = str(w.get("word") or "")
        word_text = escape_ass_text(raw_word) if escape else raw_word
        parts.append(f"{{\\kf{end_cs - start_cs}}}{word_text} ")
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
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file content

    with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
    Supports dynamic 16:9 and 9:16 layout adjustments, visual theme presets,
    direct color overrides, font size scaling, control character escaping,
    and optional transposed musical chords on Layer 2.
    """
    # Resolve synchronization mode ('word' progressive \kf sweep vs 'line' instant highlight)
    eff_sync_mode = sync_mode
    if (
        (eff_sync_mode is None or eff_sync_mode == "word")
        and style_config
        and "sync_mode" in style_config
    ):
        eff_sync_mode = style_config["sync_mode"]
    eff_sync_mode = str(eff_sync_mode or "word").strip().lower()
    if eff_sync_mode not in ("word", "line"):
        eff_sync_mode = "word"

    # Resolve countdown enabled flag
    countdown_enabled = include_countdown
    if style_config and "include_countdown" in style_config:
        countdown_enabled = bool(style_config["include_countdown"])
    elif style_config and "enable_gap_countdown" in style_config:
        countdown_enabled = bool(style_config["enable_gap_countdown"])

    # Resolve chords enabled and transposition settings
    chords_enabled = include_chords
    if style_config and "include_chords" in style_config:
        chords_enabled = bool(style_config["include_chords"])

    eff_semitones = semitones
    if style_config and "semitones" in style_config:
        eff_semitones = int(style_config["semitones"])

    eff_chords = chords
    if eff_chords is None and style_config and "chords" in style_config:
        eff_chords = style_config["chords"]

    eff_key = key
    if eff_key is None and style_config and "key" in style_config:
        eff_key = style_config["key"]

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
    eff_theme_id = theme_id or (style_config or {}).get("theme_id")
    if eff_theme_id and eff_theme_id in VISUAL_THEMES:
        theme = VISUAL_THEMES[eff_theme_id]
        if "primary_color" in theme and (not style_config or "primary_color" not in style_config):
            cfg["primary_color"] = theme["primary_color"]
        if "secondary_color" in theme and (
            not style_config or "secondary_color" not in style_config
        ):
            cfg["secondary_color"] = theme["secondary_color"]
        if "font_name" in theme and (not style_config or "font_name" not in style_config):
            cfg["font_name"] = theme["font_name"]
        if "outline_color" in theme and (not style_config or "outline_color" not in style_config):
            cfg["outline_color"] = theme["outline_color"]
        if "shadow_color" in theme and (not style_config or "shadow_color" not in style_config):
            cfg["shadow_color"] = theme["shadow_color"]
        if "outline_width" in theme and (not style_config or "outline_width" not in style_config):
            cfg["outline_width"] = theme["outline_width"]
        if "shadow_width" in theme and (not style_config or "shadow_width" not in style_config):
            cfg["shadow_width"] = theme["shadow_width"]

    # Apply direct color overrides if passed, normalizing CSS hex to ASS BGR
    if primary_color is not None:
        cfg["primary_color"] = css_to_ass_color(primary_color)
    elif cfg.get("primary_color"):
        cfg["primary_color"] = css_to_ass_color(cfg["primary_color"])

    if secondary_color is not None:
        cfg["secondary_color"] = css_to_ass_color(secondary_color, default="&H00FFFFFF")
    elif cfg.get("secondary_color"):
        cfg["secondary_color"] = css_to_ass_color(cfg["secondary_color"], default="&H00FFFFFF")

    # Resolve Singer 2 and Both sung colors: explicit arg > style_config > preset > defaults
    # (a value that is not a color counts as not given)
    preset = VISUAL_THEMES.get(eff_theme_id or "", {}) if eff_theme_id else {}
    s2_raw = (
        singer2_color or (style_config or {}).get("singer2_color") or preset.get("singer2_color")
    )
    singer2_color_val = (
        css_to_ass_color(s2_raw, default=preset.get("singer2_color", DEFAULT_SINGER2_COLOR))
        if s2_raw
        else DEFAULT_SINGER2_COLOR
    )

    both_raw = both_color or (style_config or {}).get("both_color") or preset.get("both_color")
    both_color_val = (
        css_to_ass_color(both_raw, default=preset.get("both_color", DEFAULT_BOTH_COLOR))
        if both_raw
        else DEFAULT_BOTH_COLOR
    )

    font_name = cfg.get("font_name", "DejaVu Sans")
    base_font_size = cfg.get("font_size", default_font_size)
    font_size = max(12, round(base_font_size * scale))
    primary_color_val = cfg.get("primary_color", "&H0022E5FF")  # Sung color (cyan/gold)
    secondary_color_val = cfg.get("secondary_color", "&H00FFFFFF")  # Unsung text (white)
    outline_color = cfg.get("outline_color", "&H00111111")
    shadow_color = cfg.get("shadow_color", "&H80000000")
    outline_width = cfg.get("outline_width", 3)
    shadow_width = cfg.get("shadow_width", 2)

    # Chord typography and placement
    chord_font_size = max(12, round(font_size * 0.70))
    chord_color_raw = (style_config or {}).get("chord_color")
    chord_color_val = (
        css_to_ass_color(chord_color_raw, default="&H0000D7FF") if chord_color_raw else "&H0000D7FF"
    )
    chord_alignment = int((style_config or {}).get("chord_alignment", 8))
    if chord_alignment == 8:
        margin_v_chord = (style_config or {}).get("margin_v_chord", 120 if is_vertical else 80)
        align_tag = "{\\an8}"
    elif chord_alignment == 2:
        margin_v_chord = (style_config or {}).get("margin_v_chord", 720 if is_vertical else 270)
        align_tag = "{\\an2}"
    else:
        margin_v_chord = (style_config or {}).get("margin_v_chord", 80)
        align_tag = f"{{\\an{chord_alignment}}}"

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
        f"Style: KaraokeLine1_Singer2,{font_name},{font_size},{singer2_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line1},1",
        f"Style: KaraokeLine2_Singer2,{font_name},{font_size},{singer2_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line2},1",
        f"Style: KaraokeLine1_Both,{font_name},{font_size},{both_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line1},1",
        f"Style: KaraokeLine2_Both,{font_name},{font_size},{both_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line2},1",
        f"Style: Countdown,{font_name},{font_size + 10},{primary_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,2,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_countdown},1",
        f"Style: TitleCard,{font_name},64,&H00FFFFFF,&H00FFFFFF,{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,3,3,5,{margin_lr},{margin_lr},{margin_v_title},1",
    ]

    if chords_enabled:
        ass_content.append(
            f"Style: Chord,{font_name},{chord_font_size},{chord_color_val},{secondary_color_val},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{max(1, outline_width - 1)},{shadow_width},{chord_alignment},{margin_lr},{margin_lr},{margin_v_chord},1"
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
        for i, line in enumerate(lines):
            if not isinstance(line, dict):
                continue
            l_start = safe_time(line.get("start_time"), 0.0)
            l_end = safe_time(line.get("end_time"), l_start + 4.0)
            l_end = max(l_start, l_end)
            raw_words = line.get("words", [])
            words = raw_words if isinstance(raw_words, list) else []

            # Select line style matching singer part assignment while alternating Line1 and Line2
            base_line = "KaraokeLine1" if (i % 2 == 0) else "KaraokeLine2"
            raw_singer = str(line.get("singer") or "singer1").strip().lower()
            if raw_singer in (
                "singer2",
                "partner",
                "singer 2",
                "singer_2",
                "part2",
                "part 2",
                "s2",
            ):
                style_name = f"{base_line}_Singer2"
            elif raw_singer in ("both", "unison", "duet", "all", "together"):
                style_name = f"{base_line}_Both"
            else:
                style_name = base_line

            # Show line early on screen so the singer can prepare
            if i == 0:
                display_start = max(0.0, l_start - 2.5)
            elif l_start > prev_end_time:
                display_start = max(prev_end_time, l_start - 2.0)
            else:
                display_start = max(0.0, l_start - 2.0)

            display_start = max(0.0, min(l_start, display_start))
            display_end = max(display_start + 0.5, l_end + 1.2)

            # Visual countdown cue for qualifying non-vocal intervals (>= 4.0 seconds)
            gap = l_start - prev_end_time
            has_gap = (i == 0 and l_start >= 4.0) or (i > 0 and gap >= 4.0)
            if countdown_enabled and has_gap:
                countdown_start = max(0.0, l_start - 3.0)
                if raw_singer in (
                    "singer2",
                    "partner",
                    "singer 2",
                    "singer_2",
                    "part2",
                    "part 2",
                    "s2",
                ):
                    dots_color_tag = f"{{\\c{singer2_color_val}&}}"
                elif raw_singer in ("both", "unison", "duet", "all", "together"):
                    dots_color_tag = f"{{\\c{both_color_val}&}}"
                else:
                    dots_color_tag = ""

                dots_text = f"{dots_color_tag}{{\\kf100}}● {{\\kf100}}● {{\\kf100}}● "
                ass_content.append(
                    f"Dialogue: 1,{format_ass_time(countdown_start)},{format_ass_time(l_start)},Countdown,,0,0,0,,{dots_text}"
                )

            lead_in_cs = max(0, round((l_start - display_start) * 100))

            if eff_sync_mode == "line":
                raw_text = str(line.get("text") or "").strip()
                if not raw_text and words:
                    raw_text = " ".join(
                        str(w.get("word") or "").strip()
                        for w in words
                        if isinstance(w, dict) and str(w.get("word") or "").strip()
                    )
                clean_line_text = escape_ass_text(raw_text)

                if lead_in_cs > 0:
                    line_karaoke_text = f"{{\\k{lead_in_cs}}}{{\\k0}}{clean_line_text}"
                else:
                    line_karaoke_text = clean_line_text
            else:
                base_cs = round(display_start * 100)  # the event start exactly as written
                if words:
                    line_karaoke_text = _word_sweep_text(words, base_cs, l_start)
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

            ass_content.append(
                f"Dialogue: 0,{format_ass_time(display_start)},{format_ass_time(display_end)},{style_name},,0,0,0,,{line_karaoke_text}"
            )

            prev_end_time = max(prev_end_time, l_end)

    # Emit chord events on Layer 2 if enabled
    if chords_enabled and eff_chords and isinstance(eff_chords, list):
        from backend.services.chord_detector import NO_CHORD_VALUES, transpose_chord

        for seg in eff_chords:
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

            if eff_semitones != 0:
                try:
                    transposed = transpose_chord(raw_chord, eff_semitones, key=eff_key)
                except Exception:
                    transposed = raw_chord
            else:
                transposed = raw_chord

            escaped = escape_ass_text(transposed)
            ass_content.append(
                f"Dialogue: 2,{format_ass_time(c_start)},{format_ass_time(c_end)},Chord,,0,0,0,,{align_tag}{escaped}"
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
    )
    output_ass_path.write_text(content, encoding="utf-8")
    return str(output_ass_path)


# Backward-compatible aliases
generate_ass = generate_ass_subtitles
generate_karaoke_ass = generate_ass_content
