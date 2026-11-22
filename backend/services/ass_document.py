"""The parts of an Advanced SubStation Alpha (.ass) file that do not depend on a look: colours,
timestamps and lyric text made safe to write into a Dialogue line."""

import math
import re
from typing import Any

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


def to_css_color(color: Any) -> str | None:
    """A colour as lower-case CSS hex (#rrggbb), from CSS hex (#rgb, #rrggbb, with or without
    the #) or an ASS colour (&HBBGGRR, &HAABBGGRR, with or without the closing &). None for
    anything else, so request text never reaches the subtitle file."""
    if not isinstance(color, str) or not color.strip():
        return None
    text = color.strip()
    if text[:2].upper() == "&H":
        digits = text[2:].removesuffix("&").upper()
        if not _ASS_COLOR_DIGITS.fullmatch(digits):
            return None
        bgr = digits[-6:]
        return f"#{bgr[4:6]}{bgr[2:4]}{bgr[0:2]}".lower()
    text = text.removeprefix("#")
    if len(text) == 3:
        text = "".join(ch * 2 for ch in text)
    if len(text) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in text):
        return f"#{text}".lower()
    return None


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
