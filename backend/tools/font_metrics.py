"""Writes backend/assets/shared/stage_font_metrics.json from the bundled stage fonts.

The video (libass) and the stage (the browser) size and break lyric lines from this one table
instead of each measuring text itself, so both break a line at the same word. Run it again
after changing a file in backend/assets/fonts::

    python -m backend.tools.font_metrics

Reads the TrueType tables directly (head, hhea, OS/2, name, cmap, hmtx), so it needs nothing
beyond the standard library.
"""

import json
import struct
from pathlib import Path
from typing import Any

from backend.shared_assets import SHARED_DIR

FONTS_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"
METRICS_PATH = SHARED_DIR / "stage_font_metrics.json"

# face id: (file, the family, weight and style the stage's CSS asks for)
FACES: dict[str, tuple[str, str, int, str]] = {
    "sofia_xcond_black": (
        "SofiaSansExtraCondensed-Black.ttf",
        "Sofia Sans Extra Condensed",
        900,
        "normal",
    ),
    "sofia_bold": ("SofiaSans-Bold.ttf", "Sofia Sans", 700, "normal"),
    "mplus_rounded_extrabold": ("MPLUSRounded1c-ExtraBold.ttf", "M PLUS Rounded 1c", 800, "normal"),
    "newsreader_medium": ("Newsreader-Medium.ttf", "Newsreader", 500, "normal"),
    "newsreader_medium_italic": ("Newsreader-MediumItalic.ttf", "Newsreader", 500, "italic"),
    "jost_medium": ("Jost-Medium.ttf", "Jost", 500, "normal"),
    "atkinson_bold": ("AtkinsonHyperlegible-Bold.ttf", "Atkinson Hyperlegible", 700, "normal"),
}

# The characters whose widths are listed: Latin, Greek, Cyrillic, punctuation and symbols a
# lyric may hold. Anything else is measured by the table's rules (wide_advance, fallback_advance)
CHARACTER_RANGES: tuple[tuple[int, int], ...] = (
    (0x20, 0x7E),
    (0xA0, 0x17F),
    (0x18F, 0x192),
    (0x1A0, 0x1B0),
    (0x218, 0x21B),
    (0x2BC, 0x2BC),
    (0x2C6, 0x2DD),
    (0x386, 0x3CE),
    (0x400, 0x45F),
    (0x490, 0x491),
    (0x1E80, 0x1E85),
    (0x1EA0, 0x1EF9),
    (0x2010, 0x2026),
    (0x2030, 0x203A),
    (0x20AC, 0x20AC),
    (0x2122, 0x2122),
    (0x266A, 0x266F),
)
# An East Asian wide character is one em in every face; a character a face lacks is drawn by
# a fallback font, counted as this many thousandths of an em
WIDE_ADVANCE = 1000
FALLBACK_ADVANCE = 620
# Wide: CJK ideographs, kana, Hangul and full-width forms. Zero: combining marks and joiners
WIDE_RANGES: tuple[tuple[int, int], ...] = (
    (0x1100, 0x115F),
    (0x2E80, 0x303E),
    (0x3041, 0x33FF),
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xA000, 0xA4CF),
    (0xAC00, 0xD7A3),
    (0xF900, 0xFAFF),
    (0xFE30, 0xFE4F),
    (0xFF00, 0xFF60),
    (0xFFE0, 0xFFE6),
    (0x20000, 0x3FFFD),
)
ZERO_RANGES: tuple[tuple[int, int], ...] = (
    (0x300, 0x36F),
    (0x200B, 0x200F),
    (0x2060, 0x2060),
    (0xFE00, 0xFE0F),
)


def _tables(data: bytes) -> dict[str, bytes]:
    count = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(count):
        tag, _checksum, offset, length = struct.unpack(">4sLLL", data[12 + 16 * i : 28 + 16 * i])
        tables[tag.decode("latin-1")] = data[offset : offset + length]
    return tables


def _names(table: bytes) -> dict[int, str]:
    """The font's Windows English names by name id (1 family, 2 style, 4 full, 6 PostScript)."""
    _format, count, strings = struct.unpack(">HHH", table[:6])
    names: dict[int, str] = {}
    for i in range(count):
        platform, _encoding, language, name_id, length, offset = struct.unpack(
            ">HHHHHH", table[6 + 12 * i : 18 + 12 * i]
        )
        if platform == 3 and language == 0x409:
            raw = table[strings + offset : strings + offset + length]
            names[name_id] = raw.decode("utf-16-be")
    return names


def _cmap(table: bytes) -> dict[int, int]:
    """Character code to glyph id, from the font's Unicode subtable (format 12, else 4)."""
    count = struct.unpack(">H", table[2:4])[0]
    subtables: dict[int, int] = {}
    for i in range(count):
        platform, encoding, offset = struct.unpack(">HHL", table[4 + 8 * i : 12 + 8 * i])
        if (platform == 3 and encoding in (1, 10)) or platform == 0:
            subtables[struct.unpack(">H", table[offset : offset + 2])[0]] = offset
    mapping: dict[int, int] = {}
    if 12 in subtables:
        start = subtables[12]
        groups = struct.unpack(">L", table[start + 12 : start + 16])[0]
        for i in range(groups):
            first, last, glyph = struct.unpack(
                ">LLL", table[start + 16 + 12 * i : start + 28 + 12 * i]
            )
            for code in range(first, last + 1):
                mapping[code] = glyph + code - first
        return mapping
    start = subtables[4]
    segments = struct.unpack(">H", table[start + 6 : start + 8])[0] // 2
    ends = start + 14
    starts = ends + 2 * segments + 2
    deltas = starts + 2 * segments
    ranges = deltas + 2 * segments
    for i in range(segments):
        last = struct.unpack(">H", table[ends + 2 * i : ends + 2 * i + 2])[0]
        first = struct.unpack(">H", table[starts + 2 * i : starts + 2 * i + 2])[0]
        delta = struct.unpack(">h", table[deltas + 2 * i : deltas + 2 * i + 2])[0]
        range_offset = struct.unpack(">H", table[ranges + 2 * i : ranges + 2 * i + 2])[0]
        for code in range(first, min(last, 0xFFFE) + 1):
            if range_offset == 0:
                glyph = (code + delta) & 0xFFFF
            else:
                at = ranges + 2 * i + range_offset + 2 * (code - first)
                glyph = struct.unpack(">H", table[at : at + 2])[0]
                if glyph:
                    glyph = (glyph + delta) & 0xFFFF
            if glyph:
                mapping[code] = glyph
    return mapping


def read_face(path: Path) -> dict[str, Any]:
    """What the table records about one font file: its names as libass matches them, its
    vertical metrics in font units, and each listed character's advance width."""
    tables = _tables(path.read_bytes())
    units_per_em = struct.unpack(">H", tables["head"][18:20])[0]
    mac_style = struct.unpack(">H", tables["head"][44:46])[0]
    hhea = tables["hhea"]
    h_metrics = struct.unpack(">H", hhea[34:36])[0]
    os2 = tables["OS/2"]
    version = struct.unpack(">H", os2[0:2])[0]
    weight = struct.unpack(">H", os2[4:6])[0]
    win_ascent, win_descent = struct.unpack(">HH", os2[74:78])
    cap_height = struct.unpack(">h", os2[88:90])[0] if version >= 2 and len(os2) >= 90 else 0
    names = _names(tables["name"])
    cmap = _cmap(tables["cmap"])
    hmtx = tables["hmtx"]

    def advance(glyph: int) -> int:
        index = min(glyph, h_metrics - 1)
        return struct.unpack(">H", hmtx[4 * index : 4 * index + 2])[0]

    advances: dict[str, int] = {}
    for first, last in CHARACTER_RANGES:
        for code in range(first, last + 1):
            if code in cmap:
                advances[chr(code)] = round(advance(cmap[code]) * 1000 / units_per_em)
    return {
        "family": names.get(1, ""),
        "style": names.get(2, ""),
        "postscript": names.get(6, ""),
        "weight": weight,
        "bold": bool(mac_style & 1),
        "italic": bool(mac_style & 2),
        "units_per_em": units_per_em,
        "win_ascent": win_ascent,
        "win_descent": win_descent,
        "cap_height": cap_height,
        "advances": advances,
    }


def face_entry(face_id: str) -> dict[str, Any]:
    """One face's entry in the table. Sizes in the looks are em sizes: ``ass_size`` turns an em
    into the Fontsize libass wants (the font's Windows cell height), and ``ascent`` puts a
    row's top edge above its baseline, both as multiples of the em."""
    file, css_family, css_weight, css_style = FACES[face_id]
    face = read_face(FONTS_DIR / file)
    em = face["units_per_em"]
    return {
        "file": file,
        # libass finds a static cut by its legacy family name; bold and italic pick the file of
        # that family whose style has them (asking for more would fake them)
        "ass_family": face["family"],
        "ass_bold": face["bold"],
        "ass_italic": face["italic"],
        "postscript": face["postscript"],
        "css_family": css_family,
        "css_weight": css_weight,
        "css_style": css_style,
        "ass_size": round((face["win_ascent"] + face["win_descent"]) / em, 4),
        "ascent": round(face["win_ascent"] / em, 4),
        "descent": round(face["win_descent"] / em, 4),
        # M PLUS Rounded 1c records no cap height; its capitals are 0.73 of the em
        "cap_height": round(face["cap_height"] / em, 4) or 0.73,
        "advances": face["advances"],
    }


def build_metrics() -> dict[str, Any]:
    return {
        "wide_advance": WIDE_ADVANCE,
        "fallback_advance": FALLBACK_ADVANCE,
        "wide_ranges": [list(r) for r in WIDE_RANGES],
        "zero_ranges": [list(r) for r in ZERO_RANGES],
        "faces": {face_id: face_entry(face_id) for face_id in FACES},
    }


def metrics_json(metrics: dict[str, Any]) -> str:
    """The table as it is written: one face per block, its advances on one line."""
    faces = []
    for face_id, entry in metrics["faces"].items():
        fields = [
            f"      {json.dumps(key)}: {json.dumps(value, ensure_ascii=False)}"
            for key, value in entry.items()
        ]
        faces.append(f"    {json.dumps(face_id)}: {{\n" + ",\n".join(fields) + "\n    }")
    return (
        "{\n"
        f'  "wide_advance": {metrics["wide_advance"]},\n'
        f'  "fallback_advance": {metrics["fallback_advance"]},\n'
        f'  "wide_ranges": {json.dumps(metrics["wide_ranges"])},\n'
        f'  "zero_ranges": {json.dumps(metrics["zero_ranges"])},\n'
        '  "faces": {\n' + ",\n".join(faces) + "\n  }\n}\n"
    )


def main() -> None:
    METRICS_PATH.write_text(metrics_json(build_metrics()), encoding="utf-8")
    print(f"Wrote {METRICS_PATH}")


if __name__ == "__main__":
    main()
