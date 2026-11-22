"""Where a look puts each lyric line in the frame: the size and rows of its text and the
positions of the part name, the romaji and the next line around it.

Everything here is in u (1% of the frame's short side), em sizes and baselines, and none of
it depends on time, so the video (ass_layout_*) and the stage (frontend/src/utils/stageLayout.ts)
compute the same placement; both suites run stage_layout_cases.json. The three layouts:

- ``stack``: one reading place. The current line grows up from a fixed last baseline, the
  next line waits at a fixed place under it.
- ``rows``: two rows that lines take in turn, each growing up from its own baseline.
- ``column``: a column of lines that moves up, so the line being sung is at one height."""

from dataclasses import dataclass, replace
from typing import Any

from backend.services import font_metrics
from backend.services.lyric_tokenize import (
    adlib_flags,
    is_cjk_token,
    space_after,
    tokenize_lyric_text,
)
from backend.services.stage_looks import DEFAULT_PART_NAMES, fit_box
from backend.services.text_fit import Fit, FitBox, fit_block

# A row of small text under or over a block is spaced by this much of its own size
SMALL_ROW_PITCH = 1.3


@dataclass(frozen=True)
class LineText:
    """A lyric line's words as they are drawn: capitals applied, spaced as written."""

    tokens: tuple[str, ...]
    spaces: tuple[bool, ...]
    adlib: tuple[bool, ...]
    romaji: str = ""

    @property
    def breaks(self) -> tuple[bool, ...]:
        """After which tokens a row may end: at a space, or between two CJK characters."""
        last = len(self.tokens) - 1
        return tuple(
            i < last
            and (self.spaces[i] or (is_cjk_token(token) and is_cjk_token(self.tokens[i + 1])))
            for i, token in enumerate(self.tokens)
        )


@dataclass(frozen=True)
class Row:
    """One row of a block: its tokens [first, end) and its baseline."""

    first: int
    end: int
    baseline: float


@dataclass(frozen=True)
class Block:
    """A fitted block of words. ``x`` is the edge ``align`` names (the centre for "center").
    ``top`` is the cap line of its first row and ``bottom`` the baseline of its last."""

    face: str
    size: float
    condense: float
    x: float
    align: str
    rows: tuple[Row, ...]
    top: float
    bottom: float


@dataclass(frozen=True)
class Item:
    """One row of plain text: a part name, a romaji line, a count-in numeral, an artist."""

    face: str
    text: str
    size: float
    condense: float
    x: float
    align: str
    baseline: float


def line_text(line: dict[str, Any], caps: bool = False) -> LineText:
    """The words of a lyric line for drawing: its timed words when it has them, else its text
    split as the editor splits it."""
    words = [w for w in (line.get("words") or []) if isinstance(w, dict)]
    source = str(line.get("text") or "")
    tokens = [str(w.get("word") or "") for w in words] if words else tokenize_lyric_text(source)
    spaces = space_after(tokens, source)
    flags = adlib_flags(tokens)
    if caps:
        tokens = [token.upper() for token in tokens]
    romaji = " ".join(str(line.get("romaji") or "").split())
    return LineText(tuple(tokens), tuple(spaces), tuple(flags), romaji)


def plain_text(text: str, caps: bool = False) -> LineText:
    """Any other text (a title, a name) as words, split on spaces."""
    tokens = [token.upper() if caps else token for token in str(text or "").split()]
    spaces = [True] * (len(tokens) - 1) + [False] if tokens else []
    return LineText(tuple(tokens), tuple(spaces), tuple(False for _ in tokens))


def token_widths(
    face: str, text: LineText, adlib_scale: float = 1.0, tracking: float = 0.0
) -> list[float]:
    """Each token's width in ems of the block's size (an ad-lib is drawn smaller)."""
    return [
        font_metrics.text_width(face, token, tracking) * (adlib_scale if adlib else 1.0)
        for token, adlib in zip(text.tokens, text.adlib, strict=True)
    ]


def fit_text(
    face: str, text: LineText, box: FitBox, adlib_scale: float = 1.0, tracking: float = 0.0
) -> Fit:
    return fit_block(
        token_widths(face, text, adlib_scale, tracking),
        list(text.spaces),
        list(text.breaks),
        font_metrics.text_width(face, " ", tracking),
        box,
    )


def place_block(
    look: dict[str, Any],
    spec: dict[str, Any],
    text: LineText,
    scale: float = 1.0,
    role: str = "lyric",
    grow: str = "up",
    at: dict[str, Any] | None = None,
) -> Block:
    """Fits ``text`` into a text box of the look. The block grows up from the box's baseline
    (its last row sits there) or down from it (its first row does). ``at`` moves the box to
    another x, alignment and baseline (the rows layout's two rows)."""
    face = spec["face"]
    tracking = look["tracking"].get(role, 0.0)
    box = fit_box(spec, scale)
    if box.max > box.prefer and any(is_cjk_token(token) for token in text.tokens):
        # CJK characters come from a fallback font, which is not the look's display face:
        # they are not blown up past the preferred size
        box = replace(box, max=box.prefer)
    fit = fit_text(face, text, box, look["adlib"]["scale"], tracking)
    place = at or spec
    pitch = fit.size * spec.get("leading", 1.2)
    count = len(fit.rows)
    rows = []
    for k, (first, end) in enumerate(fit.rows):
        step = k - (count - 1) if grow == "up" else k
        rows.append(Row(first, end, round(place["baseline"] + step * pitch, 3)))
    first_baseline = rows[0].baseline if rows else place["baseline"]
    return Block(
        face=face,
        size=fit.size,
        condense=fit.condense,
        x=place["x"],
        align=place["align"],
        rows=tuple(rows),
        top=round(first_baseline - font_metrics.face(face)["cap_height"] * fit.size, 3),
        bottom=rows[-1].baseline if rows else place["baseline"],
    )


def place_item(
    look: dict[str, Any],
    face: str,
    text: str,
    size: float,
    measure: float,
    x: float,
    align: str,
    baseline: float,
    role: str = "",
) -> Item:
    """One row of plain text at a fixed size, shrunk and then condensed when it is wider than
    ``measure``."""
    words = plain_text(text, bool(look["caps"].get(role)))
    drawn = " ".join(words.tokens)
    one = LineText((drawn,), (False,), (False,)) if drawn else LineText((), (), ())
    box = fit_box({"size": size, "measure": measure, "rows": 1})
    fit = fit_text(face, one, box, tracking=look["tracking"].get(role, 0.0))
    return Item(face, drawn, fit.size, fit.condense, x, align, round(baseline, 3))


def part_name(part: str, part_names: dict[str, str] | None) -> str:
    """The name shown for a part: the song's own, else "Singer 1", "Singer 2" or "Both"."""
    given = str((part_names or {}).get(part) or "").strip()
    return given or DEFAULT_PART_NAMES.get(part, DEFAULT_PART_NAMES["singer1"])


def romaji_size(look: dict[str, Any], frame: dict[str, Any], scale: float) -> float:
    box = fit_box(frame["lyric"], scale)
    return round(box.prefer * look["romaji"]["scale"], 3)


def _romaji_item(
    look: dict[str, Any], frame: dict[str, Any], block: Block, text: LineText, scale: float
) -> Item | None:
    if not text.romaji:
        return None
    size = romaji_size(look, frame, scale)
    face = look["romaji"]["face"] or block.face
    return place_item(
        look,
        face,
        text.romaji,
        size,
        frame["lyric"]["measure"],
        block.x,
        block.align,
        block.bottom + size * SMALL_ROW_PITCH,
    )


def _label_item(
    look: dict[str, Any], frame: dict[str, Any], block: Block, name: str, baseline: float
) -> Item | None:
    """The part name by a block: over its first row, or in the margin on ``baseline``."""
    if not name:
        return None
    spec = frame["label"]
    if spec["place"] == "margin":
        return place_item(
            look,
            spec["face"],
            name,
            spec["size"],
            spec["measure"],
            spec["x"],
            spec["align"],
            baseline,
            role="label",
        )
    return place_item(
        look,
        spec["face"],
        name,
        spec["size"],
        frame["lyric"]["measure"],
        block.x,
        block.align,
        block.top - spec["gap"],
        role="label",
    )


@dataclass(frozen=True)
class PlacedLine:
    """A lyric line in a ``stack`` or ``rows`` layout: its words, its part name and romaji."""

    block: Block
    label: Item | None
    romaji: Item | None


def place_stack_line(
    look: dict[str, Any], frame: dict[str, Any], text: LineText, name: str = "", scale: float = 1.0
) -> PlacedLine:
    """The line at the reading place of a ``stack`` look."""
    block = place_block(look, frame["lyric"], text, scale)
    return PlacedLine(
        block,
        _label_item(look, frame, block, name, block.bottom),
        _romaji_item(look, frame, block, text, scale),
    )


def place_stack_next(
    look: dict[str, Any],
    frame: dict[str, Any],
    text: LineText,
    scale: float = 1.0,
    under_romaji: bool = False,
    frame_height: float = 1000.0,
) -> Block | None:
    """The line waiting under the reading place (written as it is, never in capitals by the
    lyric's rule), moved down a row while the current line shows romaji."""
    spec = frame.get("next")
    if not spec:
        return None
    place = dict(spec)
    if under_romaji:
        place["baseline"] = spec["baseline"] + romaji_size(look, frame, scale) * SMALL_ROW_PITCH
    block = place_block(look, spec, text, scale, role="next", grow="down", at=place)
    # No room left under the romaji (Cinema's bar): the next line waits out this one
    return block if block.bottom <= frame_height - 1.0 else None


def place_rows_line(
    look: dict[str, Any],
    frame: dict[str, Any],
    text: LineText,
    slot: int,
    name: str = "",
    scale: float = 1.0,
) -> PlacedLine:
    """A line in row ``slot`` (0 or 1) of a ``rows`` look."""
    block = place_block(look, frame["lyric"], text, scale, at=frame["rows"][slot % 2])
    return PlacedLine(
        block,
        _label_item(look, frame, block, name, block.bottom),
        _romaji_item(look, frame, block, text, scale),
    )


@dataclass(frozen=True)
class ColumnLine:
    """A line of a ``column`` look, measured from its own first baseline (0). ``offset`` is
    where that baseline sits down the whole column and ``height`` how much of the column the
    line takes, part name, romaji and the gap after it included."""

    block: Block
    label: Item | None
    romaji: Item | None
    offset: float
    height: float


def place_column(
    look: dict[str, Any],
    frame: dict[str, Any],
    texts: list[LineText],
    names: list[str],
    scale: float = 1.0,
) -> list[ColumnLine]:
    """Every line of the song down one column."""
    spec = frame["lyric"]
    label_spec = frame["label"]
    column = frame["column"]
    placed: list[ColumnLine] = []
    cursor = 0.0
    for text, name in zip(texts, names, strict=True):
        local = {"x": spec["x"], "align": spec["align"], "baseline": 0.0}
        block = place_block(look, spec, text, scale, grow="down", at=local)
        pitch = block.size * spec.get("leading", 1.2)
        above = 0.0
        if name and label_spec["place"] == "above":
            above = label_spec["size"] * SMALL_ROW_PITCH + label_spec["gap"]
        romaji = _romaji_item(look, frame, block, text, scale)
        below = romaji.size * SMALL_ROW_PITCH if romaji else 0.0
        height = above + max(1, len(block.rows)) * pitch + below + column["gap"]
        placed.append(
            ColumnLine(
                block=block,
                label=_label_item(look, frame, block, name, 0.0),
                romaji=romaji,
                offset=round(cursor + above, 3),
                height=round(height, 3),
            )
        )
        cursor += height
    return placed


def column_state(
    frame: dict[str, Any], placed: list[ColumnLine], current: int, scale: float = 1.0
) -> list[tuple[float, float]]:
    """For each line, the frame baseline of its first row and its opacity while line
    ``current`` is at the reading place (-1: before the first line gets there). Lines outside
    the look's window, or that would run off the frame, have opacity 0."""
    spec = frame["lyric"]
    column = frame["column"]
    if not placed:
        return []
    if current < 0:
        standard = fit_box(spec, scale).prefer * spec.get("leading", 1.2) + column["gap"]
        origin = placed[0].offset - standard
    else:
        origin = placed[min(current, len(placed) - 1)].offset
    states: list[tuple[float, float]] = []
    for i, line in enumerate(placed):
        baseline = round(spec["baseline"] + line.offset - origin, 3)
        slot = i - current
        if slot < -column["before"] or slot > column["after"]:
            alpha = 0.0
        elif slot <= 0:
            alpha = 1.0
        else:
            alpha = column["after_alpha"][slot - 1]
        last = baseline + (line.block.bottom if line.block.rows else 0.0)
        if baseline < column["min_baseline"] or last > column["max_baseline"]:
            alpha = 0.0
        states.append((baseline, alpha))
    return states
