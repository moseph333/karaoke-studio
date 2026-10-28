"""Word tokens for lyric lines, shared by alignment and confidence scoring.

``tokenize_lyric_text`` mirrors the studio's tokenizer (frontend/src/utils/lyrics.ts): every
CJK, kana or Hangul character is its own token (keeping closing punctuation attached), and
everything else splits on whitespace. ``normalize_for_mms`` turns one token into the
lowercase letters the MMS forced-alignment model knows (a-z and the apostrophe): accents are
stripped, digits spelled out with num2words and other scripts romanized with uroman when
those optional packages are installed. A token that ends up empty cannot be aligned by the
model and is timed by interpolation instead.
"""

import logging
import re
import unicodedata
from functools import lru_cache

logger = logging.getLogger(__name__)

_CJK = "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af"
_CJK_TRAILING = (
    "\u30fc\u3001\u3002\uff01\uff0c\uff1f\uff1a\uff1b\u3009\u300b\u300d\u300f\u3011.,!?'\")\\]}>"
)
TOKEN_RE = re.compile(f"([{_CJK}][{_CJK_TRAILING}]*)|([^\\s{_CJK}]+)")

# Labels of torchaudio's MMS_FA bundle, apart from the blank and the star token
MMS_ALPHABET = frozenset("aienoutsrmkldghybpwcvjzf'qx")
_APOSTROPHES = str.maketrans({"\u2019": "'", "\u2018": "'", "`": "'", "\u02bc": "'"})
_DIGITS = re.compile(r"\d+")


def tokenize_lyric_text(text: str) -> list[str]:
    """Tokens of a lyric line, split exactly like the studio editor splits them."""
    if not isinstance(text, str) or not text.strip():
        return []
    return [m.group(0) for m in TOKEN_RE.finditer(text.strip())]


@lru_cache(maxsize=1)
def _num2words():
    try:
        from num2words import num2words

        return num2words
    except Exception:
        return None


@lru_cache(maxsize=1)
def _uroman():
    try:
        import uroman

        return uroman.Uroman()
    except Exception:
        return None


def _spell_digits(text: str, language: str | None) -> str:
    speller = _num2words()
    if speller is None:
        return text

    def spell(match: re.Match) -> str:
        try:
            return f" {speller(int(match.group(0)), lang=language or 'en')} "
        except Exception:
            try:
                return f" {speller(int(match.group(0)))} "
            except Exception:
                return match.group(0)

    return _DIGITS.sub(spell, text)


def _romanize(text: str) -> str:
    romanizer = _uroman()
    if romanizer is None:
        return text
    try:
        return str(romanizer.romanize_string(text))
    except Exception as exc:  # uroman is best effort
        logger.debug(f"uroman could not romanize {text!r}: {exc}")
        return text


def _needs_romanizing(text: str) -> bool:
    return any(ch.isalpha() and not unicodedata.normalize("NFKD", ch)[0].isascii() for ch in text)


def normalize_for_mms(token: str, language: str | None = None) -> str:
    """The alignable letters of one lyric token ("Don't!" -> "don't", "2" -> "two")."""
    if not isinstance(token, str):
        return ""
    text = unicodedata.normalize("NFKC", token).translate(_APOSTROPHES)
    if any(ch.isdigit() for ch in text):
        text = _spell_digits(text, language)
    if _needs_romanizing(text):
        text = _romanize(text)
    decomposed = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()
    letters = "".join(ch for ch in text if ch in MMS_ALPHABET)
    return letters.strip("'")
