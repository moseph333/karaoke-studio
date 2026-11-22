"""The word-by-word karaoke sweep of an exported subtitle line (\\kf tags), with ad-libs."""

from backend.services.ass_document import escape_ass_text, safe_time
from backend.services.lyric_tokenize import adlib_flags, space_after, tokenize_lyric_text

# Words sung in parentheses (backing vocals, ad-libs) are smaller, italic and a little faded;
# {\\r} then returns to the line's own style (its singer colours included)
ADLIB_ON = "{\\i1\\fscx80\\fscy80\\alpha&H40&}"
ADLIB_OFF = "{\\r}"


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
