"""Text widths and vertical metrics of the stage fonts, from the table the stage reads too
(backend/assets/shared/stage_font_metrics.json, written by backend/tools/font_metrics.py).

Sizes in the looks are em sizes. libass wants a font's Windows cell height as its Fontsize and
places a row by its top edge, so ``ass_size`` and ``ascent`` convert. Widths are sums of
advance widths without kerning: a little wide for kerned text, and the same on both sides,
which is what makes the stage and the video break a line at the same word."""

from functools import cache
from typing import Any

from backend.shared_assets import load


def _table() -> dict[str, Any]:
    return load("stage_font_metrics")


def face(face_id: str) -> dict[str, Any]:
    """One face's entry: its file, the names libass and CSS know it by, and its metrics."""
    return _table()["faces"][face_id]


def _in_ranges(code: int, ranges: list[list[int]]) -> bool:
    return any(first <= code <= last for first, last in ranges)


@cache
def char_advance(face_id: str, char: str) -> int:
    """A character's advance width in thousandths of an em: the face's own, else nothing for
    a combining mark, one em for an East Asian wide character, else the fallback width."""
    table = _table()
    listed = table["faces"][face_id]["advances"].get(char)
    if listed is not None:
        return listed
    code = ord(char)
    if _in_ranges(code, table["zero_ranges"]):
        return 0
    if _in_ranges(code, table["wide_ranges"]):
        return table["wide_advance"]
    return table["fallback_advance"]


def text_width(face_id: str, text: str, tracking: float = 0.0) -> float:
    """How wide ``text`` is in ems, with ``tracking`` ems added after every character."""
    total = sum(char_advance(face_id, char) for char in text)
    return total / 1000 + tracking * len(text)
