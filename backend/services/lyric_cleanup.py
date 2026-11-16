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
# A line longer than either is too much to read and sing as one: it is split in two at the
# natural break nearest its middle, again until every piece fits
MAX_LINE_CHARS = 70
MAX_LINE_WORDS = 14
_BREAK_AFTER = re.compile(r"[,.;:!?\u2026)\]\u3001\u3002]$")
# Conjunctions and relative words a line breaks well before (prepositions break badly)
_BREAK_BEFORE = frozenset(
    [
        "and",
        "but",
        "or",
        "so",
        "because",
        "cause",
        "'cause",
        "that",
        "when",
        "while",
        "where",
        "who",
        "which",
        "then",
        "if",
    ]
)


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


def _split_index(words: list[str]) -> int:
    """Where to cut a line's words in two: after punctuation or before a conjunction, the
    nearer the middle (by characters) the better; never leaving a piece under 2 words."""
    total = sum(len(w) + 1 for w in words)
    best, best_cost = len(words) // 2, float("inf")
    pos = 0
    for k in range(1, len(words)):
        pos += len(words[k - 1]) + 1
        if k < 2 or len(words) - k < 2:
            continue
        cost = abs(pos - total / 2) / max(1.0, total)
        if _BREAK_AFTER.search(words[k - 1]):
            cost -= 0.3
        elif words[k].lower().strip("(\"'") in _BREAK_BEFORE:
            cost -= 0.2
        if cost < best_cost:
            best, best_cost = k, cost
    return best


def _too_long(line: dict[str, Any]) -> bool:
    text = str(line.get("text") or "")
    words = line.get("words") or []
    return len(words) >= 4 and (len(text) > MAX_LINE_CHARS or len(words) > MAX_LINE_WORDS)


def split_long_line(line: dict[str, Any]) -> list[dict[str, Any]]:
    """The line as pieces short enough to sing as one (MAX_LINE_CHARS, MAX_LINE_WORDS), each
    keeping its words' timing; the first starts with the line and the last ends with it."""
    if not _too_long(line):
        return [line]
    words = list(line["words"])
    k = _split_index([str(w.get("word", "")) for w in words])
    head, tail = words[:k], words[k:]
    first = {
        **line,
        "text": " ".join(str(w.get("word", "")) for w in head),
        "words": head,
        "end_time": max(float(line.get("start_time", 0)), float(head[-1].get("end_time", 0))),
    }
    second = {
        **line,
        "text": " ".join(str(w.get("word", "")) for w in tail),
        "words": tail,
        "start_time": min(float(line.get("end_time", 0)), float(tail[0].get("start_time", 0))),
    }
    return split_long_line(first) + split_long_line(second)


def clean_fetched_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fetched lyric lines without the text uploaders add that is never sung: a translation
    block after the song, translator's notes and "x2" repeat markers; lines too long to sing
    as one are split (split_long_line). Lines are numbered again from 0."""
    kept = _drop_trailing_dump(list(lines or []))
    out: list[dict[str, Any]] = []
    for line in kept:
        cleaned = _strip_line(line)
        if cleaned is not None:
            out.extend(split_long_line(cleaned))
    if len(out) == len(lines or []) and all(a is b for a, b in zip(out, lines, strict=True)):
        return out
    return [{**line, "id": i} for i, line in enumerate(out)]
