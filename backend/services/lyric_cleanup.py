"""Tidying of lyric files fetched from LRCLIB or syncedlyrics before they are timed: uploaders
leave translator's notes, "x2" repeat markers and similar text in them that is never sung.

The patterns here also tell ``LyricsService.lyric_quality`` how sloppy a candidate looks.
"""

import re
from typing import Any

# "x2", "X2", "(x2)", "2x" or a multiplication sign and a count at the end of a line
REPEAT_MARKER = re.compile(
    r"(?:^|[\s(\[])(?:[x\u00d7]\s?\d{1,2}|\d{1,2}\s?[x\u00d7])[)\]]?\s*$", re.I
)
_REPEAT_WORD = re.compile(r"^[(\[]?(?:[x\u00d7]\d{1,2}|\d{1,2}[x\u00d7])[)\]]?$", re.I)
# A header that starts a translation or romanization block: "Translation Japanese:"
ANNOTATION_HEADER = re.compile(
    r"^\s*(?:translation|translated|romanization|romanized|romaji|english)\b[^:]{0,30}:\s*$",
    re.I,
)
# A long parenthesised explanation inside a line: "(This is phrased in present tense ...)"
ANNOTATION_NOTE = re.compile(
    r"\s*\((?=[^)]{25,})[^)]*\b(?:this is|could mean|literally|lit\.|note:|translator|"
    r"originally|phrased)\b[^)]*(?:\)|$)",
    re.I,
)
# A run of this many lines or more at the very end, each shorter than CRAMMED_LINE_SEC, is
# text dumped after the song (a translation), not sung
CRAMMED_RUN = 3
CRAMMED_LINE_SEC = 0.4


def is_annotation(text: str) -> bool:
    """True for a translator's header or a line carrying a long explanatory note."""
    return bool(ANNOTATION_HEADER.match(text or "") or ANNOTATION_NOTE.search(text or ""))


def _with_text(line: dict[str, Any], text: str) -> dict[str, Any]:
    """The line with new text, keeping the timing of the words that remain (text only
    loses words at its end or in a cut-out note, so the first N words stay)."""
    words = list(line.get("words") or [])
    kept = text.split()
    if words and len(kept) < len(words):
        if len(kept) and _REPEAT_WORD.match(str(words[-1].get("word", ""))):
            words = [w for w in words if not _REPEAT_WORD.match(str(w.get("word", "")))]
        words = words[: len(kept)]
    return {**line, "text": text, "words": words}


def _strip_line(line: dict[str, Any]) -> dict[str, Any] | None:
    """The line without repeat markers or notes, or None when nothing sung is left."""
    text = str(line.get("text") or "")
    cleaned = ANNOTATION_NOTE.sub("", text)
    while True:
        stripped = REPEAT_MARKER.sub("", cleaned).rstrip()
        if stripped == cleaned:
            break
        cleaned = stripped
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not any(ch.isalnum() for ch in cleaned):
        return None
    return line if cleaned == text.strip() else _with_text(line, cleaned)


def _drop_trailing_dump(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Without a translation block: everything from a translator's header in the second
    half of the song, and a final run of lines crammed into a fraction of a second each."""
    for i, line in enumerate(lines):
        if i >= len(lines) // 2 and ANNOTATION_HEADER.match(str(line.get("text") or "")):
            lines = lines[:i]
            break
    run = 0
    for line in reversed(lines):
        length = float(line.get("end_time", 0)) - float(line.get("start_time", 0))
        if 0 <= length < CRAMMED_LINE_SEC:
            run += 1
        else:
            break
    if run >= CRAMMED_RUN and run < len(lines):
        lines = lines[: len(lines) - run]
    return lines


def clean_fetched_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fetched lyric lines without the text uploaders add that is never sung: a translation
    block after the song, translator's notes and "x2" repeat markers. Lines are numbered
    again from 0."""
    kept = _drop_trailing_dump(list(lines or []))
    out: list[dict[str, Any]] = []
    for line in kept:
        cleaned = _strip_line(line)
        if cleaned is not None:
            out.append(cleaned)
    if len(out) == len(lines or []) and all(a is b for a, b in zip(out, lines, strict=True)):
        return out
    return [{**line, "id": i} for i, line in enumerate(out)]
