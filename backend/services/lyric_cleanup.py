"""Tidying of lyric files fetched from LRCLIB or syncedlyrics before they are timed: uploaders
leave translator's notes, "x2" repeat markers and similar text in them that is never sung.

The patterns here also tell ``LyricsService.lyric_quality`` how sloppy a candidate looks.
"""

import re
import unicodedata
from typing import Any

from backend.services.lyric_tokenize import is_cjk_token, join_lyric_tokens, tokenize_lyric_text

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
# A Japanese (or other CJK) line followed by its romanization in parentheses:
# "幸せなサメ サメ (Shiawase na same, same)"
_ROMAJI = re.compile(
    r"^(?P<lyric>.*\S)\s*\((?P<romaji>[A-Za-z][^()\u3000-\u9fff\uac00-\ud7af]*)\)\s*$"
)
# A romanization has about as many syllables as its line has sounds: one or more per
# character, never under ROMAJI_MIN_SYLLABLES of them or over ROMAJI_MAX_SYLLABLES each
# (plus ROMAJI_SLACK). "(Yeah)" after a long line, or a sentence after one character, is an
# ad-lib or a translation.
ROMAJI_MIN_SYLLABLES = 0.5
ROMAJI_MAX_SYLLABLES = 3.0
ROMAJI_SLACK = 2
# In a file that romanizes its lines, at least this share of the CJK lines carry one
ROMAJI_LINE_SHARE = 0.5
# Kana that add no syllable of their own: small kana, the long-vowel mark, n, the repeat mark
_SILENT_KANA = frozenset("ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮーんン々")
_VOWELS = re.compile(r"[aeiouy]+")

# A song whose Latin letters are more than this share capitals is shouting, not stressing
ALL_CAPS_SHARE = 0.7
# Words kept in capitals when an all-caps song is put into sentence case
_KEEP_UPPER = frozenset(["I", "OK", "TV", "DJ", "MC", "USA", "UK", "NYC"])
_SENTENCE_END = re.compile(r"[.!?\u2026][\"')\]]*$")

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
    """Where to cut a line's words in two: before a parenthesis (an ad-lib), after
    punctuation or before a conjunction, the nearer the middle (by characters) the better;
    never inside parentheses, and never leaving a piece under 2 words."""
    total = sum(len(w) + 1 for w in words)
    best, best_cost = len(words) // 2, float("inf")
    pos = 0
    depth = 0
    for k in range(1, len(words)):
        pos += len(words[k - 1]) + 1
        depth = max(0, depth + words[k - 1].count("(") - words[k - 1].count(")"))
        if k < 2 or len(words) - k < 2 or depth > 0:
            continue
        cost = abs(pos - total / 2) / max(1.0, total)
        if words[k].startswith("(") or _BREAK_AFTER.search(words[k - 1]):
            cost -= 0.3
        elif words[k].lower().strip("(\"'") in _BREAK_BEFORE:
            cost -= 0.2
        if cost < best_cost:
            best, best_cost = k, cost
    if best_cost == float("inf"):
        return len(words) // 2  # every cut falls inside parentheses: cut at the middle
    return best


def _after(text: Any, head: list[dict[str, Any]]) -> str:
    """The rest of a line's text after its first words (head)."""
    text, pos = str(text or ""), 0
    for w in head:
        found = text.find(str(w.get("word", "")), pos)
        if found < 0:
            return text[pos:]
        pos = found + len(str(w.get("word", "")))
    return text[pos:]


def _too_long(line: dict[str, Any]) -> bool:
    text = str(line.get("text") or "")
    words = line.get("words") or []
    # A CJK character is a word token of its own but not a word to read
    readable = sum(1 for w in words if not is_cjk_token(str(w.get("word", ""))))
    return len(words) >= 4 and (len(text) > MAX_LINE_CHARS or readable > MAX_LINE_WORDS)


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
        "text": join_lyric_tokens([str(w.get("word", "")) for w in head], line.get("text")),
        "words": head,
        "end_time": max(float(line.get("start_time", 0)), float(head[-1].get("end_time", 0))),
    }
    second = {
        **line,
        "text": join_lyric_tokens(
            [str(w.get("word", "")) for w in tail], _after(line.get("text"), head)
        ),
        "words": tail,
        "start_time": min(float(line.get("end_time", 0)), float(tail[0].get("start_time", 0))),
    }
    return split_long_line(first) + split_long_line(second)


def _latin_syllables(text: str) -> int:
    """Vowel groups in Latin text, accents ignored ("Tōkyō" has two)."""
    plain = "".join(
        ch for ch in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(ch)
    )
    return len(_VOWELS.findall(plain))


def _romanizes(romaji: str, tokens: list[str]) -> bool:
    """Whether Latin text in parentheses has the length of a romanization of the lyric
    before it (see ROMAJI_MIN_SYLLABLES)."""
    sounds = 0
    for token in tokens:
        if is_cjk_token(token):
            sounds += sum(1 for ch in token if ch not in _SILENT_KANA)
        else:
            sounds += _latin_syllables(token)
    syllables = _latin_syllables(romaji)
    low = ROMAJI_MIN_SYLLABLES * sounds
    return low <= syllables <= ROMAJI_MAX_SYLLABLES * sounds + ROMAJI_SLACK


def _has_cjk(line: dict[str, Any]) -> bool:
    return any(is_cjk_token(t) for t in tokenize_lyric_text(str(line.get("text") or "")))


def split_romaji(line: dict[str, Any]) -> dict[str, Any]:
    """A CJK line written with its romanization in parentheses, as the lyric alone with the
    romanization kept as ``romaji`` (shown under it and used to time it). The line's words
    become the lyric's characters, spread over the line's time. Other lines are unchanged,
    as is a line whose parentheses hold an ad-lib or a translation (_romanizes)."""
    match = _ROMAJI.match(str(line.get("text") or ""))
    if not match:
        return line
    tokens = tokenize_lyric_text(match["lyric"])
    if not any(is_cjk_token(t) for t in tokens) or not _romanizes(match["romaji"], tokens):
        return line
    lyric, romaji = match["lyric"].strip(), " ".join(match["romaji"].split())
    start, end = float(line.get("start_time", 0)), float(line.get("end_time", 0))
    step = max(0.0, end - start) / len(tokens)
    words = [
        {
            "word": t,
            "start_time": round(start + i * step, 3),
            "end_time": round(start + (i + 1) * step, 3),
        }
        for i, t in enumerate(tokens)
    ]
    return {**line, "text": lyric, "romaji": romaji, "words": words}


def is_all_caps(texts: list[str]) -> bool:
    """True when at least 40 Latin letters are present and most of them are capitals."""
    letters = [ch for text in texts for ch in text if ch.isascii() and ch.isalpha()]
    upper = sum(ch.isupper() for ch in letters)
    return len(letters) >= 40 and upper / len(letters) > ALL_CAPS_SHARE


def _sentence_case_word(word: str, starts_sentence: bool) -> str:
    core = word.strip("(\"'[")
    if core.rstrip(",.!?;:)\"']") in _KEEP_UPPER:
        return word  # I, OK, TV...
    if re.search(r"[A-Z]\.[A-Z]", core):
        return word  # U.S., L.A.
    lower = word.lower()
    if core.startswith("I'") or starts_sentence:  # I'm, I'll, and a sentence's first word
        for i, ch in enumerate(lower):
            if ch.isalpha():
                return lower[:i] + ch.upper() + lower[i + 1 :]
    return lower


def sentence_case_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """An all-caps song's lines in sentence case: each line and each sentence starts with a
    capital, "I" and a few acronyms stay. Other songs come back unchanged."""
    if not is_all_caps([str(line.get("text") or "") for line in lines]):
        return lines
    out = []
    for line in lines:
        tokens = str(line.get("text") or "").split()
        cased, start = [], True
        for token in tokens:
            cased.append(_sentence_case_word(token, start))
            start = bool(_SENTENCE_END.search(token))
        words = list(line.get("words") or [])
        if len(words) == len(cased):
            words = [{**w, "word": c} for w, c in zip(words, cased, strict=True)]
        else:
            words = [{**w, "word": str(w.get("word", "")).lower()} for w in words]
        out.append({**line, "text": " ".join(cased), "words": words})
    return out


def clean_fetched_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Fetched lyric lines without the text uploaders add that is never sung: a translation
    block after the song, translator's notes and "x2" repeat markers; lines too long to sing
    as one are split (split_long_line), a CJK line's romanization in parentheses becomes
    its ``romaji`` (split_romaji), and an all-caps song is put into sentence case
    (sentence_case_lines). Lines are numbered again from 0."""
    kept = _drop_trailing_dump(list(lines or []))
    stripped = [cleaned for line in kept if (cleaned := _strip_line(line)) is not None]
    # A file romanizes most of its CJK lines or none: a few Latin parentheticals in a
    # Japanese song are ad-libs, however long they are
    romanized = [split_romaji(line) for line in stripped]
    cjk_lines = sum(1 for line in stripped if _has_cjk(line))
    with_romaji = sum(1 for line in romanized if line.get("romaji"))
    if with_romaji < ROMAJI_LINE_SHARE * cjk_lines:
        romanized = stripped
    out: list[dict[str, Any]] = []
    for line in romanized:
        out.extend(split_long_line(line))
    out = sentence_case_lines(out)
    if len(out) == len(lines or []) and all(a is b for a, b in zip(out, lines, strict=True)):
        return out
    return [{**line, "id": i} for i, line in enumerate(out)]
