"""The pieces every look's subtitle events are made of: the resolved style of one export
(LookStyle), text and shape events positioned in u, and a row's karaoke text.

libass facts these rely on (pinned by tests/subtitles/test_libass_assumptions.py): a
Fontsize is the font's Windows cell height, not its em; with \\an7 to \\an9 a row's top edge
is its baseline less the font's ascent; nothing wraps under WrapStyle 2; text before the first
\\k is drawn sung; \\move and \\fade take times from the event's start."""

import math
from dataclasses import dataclass
from typing import Any

from backend.services import font_metrics
from backend.services.ass_document import css_to_ass_color, escape_ass_text, format_ass_time
from backend.services.stage_layout import (
    Block,
    Item,
    LineText,
    Row,
    drawn_words,
    line_text,
    part_name,
)
from backend.services.stage_looks import Frame, frame_for, resolve_look

_ALIGN_TAG = {"left": 7, "center": 8, "right": 9}


@dataclass(frozen=True)
class LookStyle:
    """Everything one export's look depends on, decided once (ass_style.resolve_look_style):
    the look, the frame, the colours after the user's overrides, the lyric size and what to
    include."""

    look: dict[str, Any]
    frame: Frame
    sung: str
    unsung: str
    singer2: str
    both: str
    scale: float = 1.0
    sync_mode: str = "word"
    cues: bool = True
    part_names: dict[str, str] | None = None
    furniture: bool = True

    @classmethod
    def of(cls, look_id: Any, aspect_ratio: str = "16:9", **given: Any) -> "LookStyle":
        """A look as it comes, in a 16:9 or 9:16 frame; ``given`` overrides fields (colours as
        CSS hex)."""
        look, _legacy = resolve_look(look_id)
        palette = look["palette"]
        colors = {key: palette[key] for key in ("sung", "unsung", "singer2", "both")}
        return cls(look=look, frame=frame_for(aspect_ratio), **{**colors, **given})

    @property
    def spec(self) -> dict[str, Any]:
        """Where things sit in this export's frame."""
        return self.look["frames"][self.frame.aspect]

    @property
    def u(self) -> float:
        return self.frame.u

    def color(self, key: str) -> str:
        """A palette colour by name, with the user's sung and unsung colours applied."""
        if key in ("sung", "unsung", "singer2", "both"):
            return getattr(self, key)
        return self.look["palette"][key]

    def part_color(self, part: str) -> str:
        """The colour that tells a part apart: its sung colour, or in a look that dims what
        was sung, the colour of its words still to sing."""
        if part == "singer2":
            return self.singer2
        if part == "both":
            return self.both
        return self.unsung if self.look["emphasis"] == "unsung" else self.sung

    def sweep_colors(self, part: str) -> tuple[str, str]:
        """A part's (sung, unsung) colours as ASS primary and secondary colours."""
        if self.look["emphasis"] == "unsung":
            return ass_color(self.sung), ass_color(self.part_color(part))
        return ass_color(self.part_color(part)), ass_color(self.unsung)


def ass_color(css: str) -> str:
    """A CSS hex colour as an override tag's colour (&HBBGGRR&)."""
    return "&H" + css_to_ass_color(css, default="&H00FFFFFF")[4:] + "&"


def _alpha_255(opacity: float) -> int:
    return round((1.0 - min(1.0, max(0.0, opacity))) * 255)


def ass_alpha(opacity: float) -> str:
    """An opacity (1 solid, 0 clear) as an ASS alpha (&H00& solid, &HFF& clear)."""
    return f"&H{_alpha_255(opacity):02X}&"


def num(value: float) -> str:
    """A number as an override tag writes it: at most two decimals, no trailing zeros."""
    text = f"{value:.2f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def ms(seconds: float) -> int:
    return max(0, round(seconds * 1000))


def event(layer: int, start: float, end: float, face: str, role: str, text: str) -> str:
    """One Dialogue line. ``role`` goes in the Name field, which libass ignores: it says what
    the event is (lyric:3, next:4, part:3, title, ...) for tests and for the plain download."""
    return (
        f"Dialogue: {layer},{format_ass_time(start)},{format_ass_time(end)},{face},{role},0,0,0,,"
        f"{text}"
    )


def row_top(
    style: LookStyle, face: str, size: float, baseline: float, tallest: float = 1.0
) -> float:
    """The pixel y of a row's top edge, for a baseline in u. ``tallest`` is the scale of the
    row's largest run (under 1 for a row of ad-libs only, which libass makes a shorter row)."""
    return baseline * style.u - font_metrics.face(face)["ascent"] * size * style.u * tallest


def font_tags(
    style: LookStyle, face: str, size: float, condense: float = 1.0, tracking: float = 0.0
) -> str:
    """\\fs for an em size in u, with the squeeze of a condensed row, letter spacing
    (``tracking``, in ems) and the look's outline."""
    cell = size * style.u * font_metrics.face(face)["ass_size"]
    tags = f"\\fs{num(cell)}"
    if tracking:
        tags += f"\\fsp{num(tracking * size * style.u)}"
    if condense < 1.0:
        tags += f"\\fscx{num(condense * 100)}"
    outline = style.look["outline"]
    if outline:
        tags += f"\\bord{num(outline['width'] * style.u)}\\3c{ass_color(outline['color'])}"
    return tags


def place_tags(
    style: LookStyle,
    align: str,
    x: float,
    top: float,
    from_top: float | None = None,
    over: float = 0.0,
) -> str:
    """\\an and \\pos for a row whose edge ``align`` names is at x (u) and whose top is at
    ``top`` (px); with ``from_top`` it moves there from that y over the first ``over`` seconds."""
    tag = f"\\an{_ALIGN_TAG[align]}"
    px = num(x * style.u)
    if from_top is None or abs(from_top - top) < 0.005 or over <= 0:
        return f"{tag}\\pos({px},{num(top)})"
    return f"{tag}\\move({px},{num(from_top)},{px},{num(top)},0,{ms(over)})"


def fade_tags(
    length: float,
    opacity: float = 1.0,
    from_opacity: float | None = None,
    enter: float = 0.0,
    exit_: float = 0.0,
) -> str:
    """The event's opacity over its ``length``: from ``from_opacity`` to ``opacity`` over the
    first ``enter`` seconds, then to clear over the last ``exit_`` seconds. Nothing when it is
    solid throughout."""
    start = opacity if from_opacity is None else from_opacity
    if start >= 1.0 and opacity >= 1.0 and exit_ <= 0:
        return ""
    total = ms(length)
    enter_ms = min(ms(enter), total)
    exit_ms = min(ms(exit_), max(0, total - enter_ms))
    first, held = _alpha_255(start), _alpha_255(opacity)
    last = 255 if exit_ms else held
    return f"\\fade({first},{held},{last},0,{enter_ms},{total - exit_ms},{total})"


@dataclass(frozen=True)
class Word:
    """A token of a row with its sung times (None for a line that has no word timing)."""

    text: str
    start: float | None
    end: float | None
    adlib: bool
    space: bool


def line_words(line: dict[str, Any], text: LineText) -> list[Word]:
    """A line's drawn tokens with the times of its words (the editor keeps one word per
    token); a line without word timing has none."""
    words = drawn_words(line)
    timed = len(words) == len(text.tokens) and bool(words)
    out = []
    for i, token in enumerate(text.tokens):
        start = end = None
        if timed:
            start = _time(words[i].get("start_time"))
            end = _time(words[i].get("end_time"))
        out.append(Word(token, start, end, text.adlib[i], text.spaces[i]))
    return out


# Later than any song: a word time beyond it is bad data, not a time
_LATEST_SECONDS = 1e7


def _time(value: Any) -> float | None:
    """A word's time in seconds, or None when it is not a time (missing, negative, not
    finite, absurdly large)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and 0 <= number < _LATEST_SECONDS else None


def adlib_tags(style: LookStyle, condense: float) -> tuple[str, str]:
    """Override tags that start and end an ad-lib run (words in parentheses): smaller, a
    little see-through, italic where the look has an italic face."""
    adlib = style.look["adlib"]
    alpha = ass_alpha(adlib["alpha"])
    italic = bool(adlib.get("face"))
    on = (
        f"{{\\fscx{num(condense * adlib['scale'] * 100)}\\fscy{num(adlib['scale'] * 100)}"
        f"\\1a{alpha}\\2a{alpha}\\3a{alpha}{'\\i1' if italic else ''}}}"
    )
    off = (
        f"{{\\fscx{num(condense * 100)}\\fscy100\\1a&H00&\\2a&H00&\\3a&H00&"
        f"{'\\i0' if italic else ''}}}"
    )
    return on, off


def row_text(
    style: LookStyle,
    words: list[Word],
    row: Row,
    condense: float,
    event_start: float,
    sweep: str = "none",
    flip_at: float = 0.0,
) -> str:
    """The text of one row's event. ``sweep`` is "word" (each word fills over its own time),
    "line" (the whole row changes colour at ``flip_at``) or "none" (plain text). Karaoke
    times are centiseconds from ``event_start``, each boundary rounded once so the fill
    neither runs ahead after a pause nor drifts over a long line."""
    on, off = adlib_tags(style, condense)
    base = round(event_start * 100)
    parts: list[str] = []
    if sweep == "line":
        lead = max(0, round(flip_at * 100) - base)
        if lead > 0:
            parts.append(f"{{\\k{lead}}}{{\\k0}}")
    cursor = base
    inside = False
    for index in range(row.first, row.end):
        word = words[index]
        if word.adlib != inside:
            parts.append(on if word.adlib else off)
            inside = word.adlib
        gap = " " if word.space and index < row.end - 1 else ""
        drawn = escape_ass_text(word.text) + gap
        if sweep == "word" and word.start is not None:
            start = max(cursor, round(word.start * 100))
            end_time = word.end if word.end is not None else word.start + 0.4
            end = max(start + 1, round(end_time * 100))
            if start > cursor:
                parts.append(f"{{\\k{start - cursor}}}")
            parts.append(f"{{\\kf{end - start}}}{drawn}")
            cursor = end
        else:
            parts.append(drawn)
    return "".join(parts)


def tallest_run(style: LookStyle, words: list[Word], row: Row) -> float:
    """1, or the ad-lib scale for a row that is ad-libs only."""
    runs = words[row.first : row.end]
    return style.look["adlib"]["scale"] if runs and all(w.adlib for w in runs) else 1.0


def block_events(
    style: LookStyle,
    block: Block,
    words: list[Word],
    role: str,
    layer: int,
    start: float,
    end: float,
    colors: str,
    sweep: str = "none",
    flip_at: float = 0.0,
    rise: float = 0.0,
    shift: tuple[float, float] | None = None,
    over: float = 0.0,
    opacity: float = 1.0,
    from_opacity: float | None = None,
    enter: float = 0.0,
    exit_: float = 0.0,
    offset: float = 0.0,
    tracking: float = 0.0,
) -> list[str]:
    """One event per row of a block, from ``start`` to ``end``. ``colors`` are the colour tags
    (the sweep's primary and secondary, or one colour for plain text). ``rise`` (u) makes the
    block come up into place over ``over`` seconds; ``shift`` moves it from one baseline
    offset (u) to another over ``over`` instead, for a column; ``offset`` is added to every
    baseline. Opacity follows fade_tags. A look with a shadow gets it as an event of its own
    under each row, so the outline over it stays crisp."""
    events: list[str] = []
    fade = fade_tags(end - start, opacity, from_opacity, enter, exit_)
    for row in block.rows:
        tallest = tallest_run(style, words, row)
        from_y = to_y = row.baseline + offset
        if shift:
            from_y, to_y = row.baseline + shift[0], row.baseline + shift[1]
        elif rise:
            from_y = to_y + rise
        top = row_top(style, block.face, block.size, to_y, tallest)
        from_top = row_top(style, block.face, block.size, from_y, tallest)
        where = place_tags(style, block.align, block.x, top, from_top, over)
        fonts = font_tags(style, block.face, block.size, block.condense, tracking)
        shadow = style.look["shadow"]
        if shadow:
            plain = row_text(style, words, row, block.condense, start)
            events.append(
                event(
                    layer,
                    start,
                    end,
                    block.face,
                    f"shadow:{role}",
                    f"{{{where}{fonts}{fade}\\1a&HFF&\\2a&HFF&\\3a&HFF&"
                    f"\\4c{ass_color(shadow['color'])}\\4a{ass_alpha(shadow['alpha'])}"
                    f"\\shad{num(shadow['offset'] * style.u)}\\blur{num(shadow['blur'] * style.u)}}}"
                    f"{plain}",
                )
            )
        text = row_text(style, words, row, block.condense, start, sweep, flip_at)
        events.append(
            event(layer, start, end, block.face, role, f"{{{where}{fonts}{fade}{colors}}}{text}")
        )
    return events


def item_event(
    style: LookStyle,
    item: Item,
    role: str,
    layer: int,
    start: float,
    end: float,
    color: str,
    rise: float = 0.0,
    shift: tuple[float, float] | None = None,
    over: float = 0.0,
    opacity: float = 1.0,
    from_opacity: float | None = None,
    enter: float = 0.0,
    exit_: float = 0.0,
    offset: float = 0.0,
    tracking: float = 0.0,
) -> list[str]:
    """A row of plain text as a block of one row (see block_events)."""
    block = Block(
        face=item.face,
        size=item.size,
        condense=item.condense,
        x=item.x,
        align=item.align,
        rows=(Row(0, 1, item.baseline),),
        top=item.baseline,
        bottom=item.baseline,
    )
    words = [Word(item.text, None, None, False, False)]
    return block_events(
        style,
        block,
        words,
        role,
        layer,
        start,
        end,
        f"\\1c{ass_color(color)}",
        rise=rise,
        shift=shift,
        over=over,
        opacity=opacity,
        from_opacity=from_opacity,
        enter=enter,
        exit_=exit_,
        offset=offset,
        tracking=tracking,
    )


def shape_event(
    style: LookStyle,
    path: str,
    x: float,
    y: float,
    role: str,
    layer: int,
    start: float,
    end: float,
    color: str,
    extra: str = "",
    outline: bool = False,
) -> str:
    """A drawing whose own (0, 0) is at (x, y) u. ``path`` is in pixels."""
    border = "\\bord0"
    look_outline = style.look["outline"]
    if outline and look_outline:
        border = (
            f"\\bord{num(look_outline['width'] * style.u)}\\3c{ass_color(look_outline['color'])}"
        )
    return event(
        layer,
        start,
        end,
        "Shape",
        role,
        f"{{\\an7\\pos({num(x * style.u)},{num(y * style.u)})\\1c{ass_color(color)}{border}\\shad0"
        f"{extra}\\p1}}{path}{{\\p0}}",
    )


def rect_path(width: float, height: float) -> str:
    return f"m 0 0 l {num(width)} 0 {num(width)} {num(height)} 0 {num(height)}"


def circle_path(diameter: float) -> str:
    r = diameter / 2
    k = r * 0.5523
    d = diameter
    return (
        f"m {num(r)} 0 b {num(r + k)} 0 {num(d)} {num(r - k)} {num(d)} {num(r)} "
        f"b {num(d)} {num(r + k)} {num(r + k)} {num(d)} {num(r)} {num(d)} "
        f"b {num(r - k)} {num(d)} 0 {num(r + k)} 0 {num(r)} "
        f"b 0 {num(r - k)} {num(r - k)} 0 {num(r)} 0"
    )


def triangle_path(width: float, height: float) -> str:
    return f"m 0 0 l {num(width)} {num(height / 2)} 0 {num(height)}"


@dataclass(frozen=True)
class Prepared:
    """A lyric line ready to be laid out: when it shows, its words as drawn and timed, the
    part name it carries (empty when it shows none), how it fills and in which colours."""

    timing: Any
    line: dict[str, Any]
    text: LineText
    words: list[Word]
    name: str
    sweep: str
    flip_at: float
    colors: str

    @property
    def role(self) -> str:
        return str(self.timing.index)


def prepare_lines(style: LookStyle, lines: list[Any], timeline: Any) -> list[Prepared]:
    """Each planned line with its drawn words, colours and fill. A line fills word by word
    when the export asks for that and the line has word timing; otherwise all at once: when
    it starts, or in a look that dims what was sung, when it ends."""
    caps = bool(style.look["caps"].get("lyric"))
    prepared = []
    for timing in timeline.lines:
        line = lines[timing.index]
        text = line_text(line, caps)
        words = line_words(line, text)
        timed = any(word.start is not None for word in words)
        sung, unsung = style.sweep_colors(timing.part)
        dims = style.look["emphasis"] == "unsung"
        prepared.append(
            Prepared(
                timing=timing,
                line=line,
                text=text,
                words=words,
                # A line with nothing to draw carries no part name either
                name=part_name(timing.part, style.part_names)
                if timing.label and text.tokens
                else "",
                sweep="word" if style.sync_mode == "word" and timed else "line",
                flip_at=timing.end if dims else timing.start,
                colors=f"\\1c{sung}\\2c{unsung}",
            )
        )
    return prepared
