"""The parts of a video's frame that are not lyric lines, drawn by every look in its own type
and colours: the opening title card and the end card, the count-in and the break marker, the
song progress line and the chords."""

import math
from typing import Any

from backend.services import font_metrics
from backend.services.ass_document import escape_ass_text, safe_time
from backend.services.ass_draw import (
    LookStyle,
    ass_color,
    block_events,
    circle_path,
    event,
    fade_tags,
    item_event,
    line_words,
    num,
    rect_path,
    shape_event,
)
from backend.services.stage_layout import Item, place_block, place_item, plain_text
from backend.services.stage_looks import TIMING

LAYER_CUE = 1
LAYER_CHORD = 2
LAYER_CARD = 3
LAYER_PROGRESS = 4
# A count-in dot is this much of the cue size across, with this much between two dots
DOT_SIZE = 0.62
DOT_GAP = 0.36
COUNT_IN_DOTS = 3


def card_events(
    style: LookStyle, title: str, artist: str, window: tuple[float, float], role: str
) -> list[str]:
    """A title card (the song's title with its artist) over ``window``, fading in and out.
    A song with only one of the two shows that one as the title."""
    look, frame = style.look, style.spec
    heading, byline = (title, artist) if title else (artist, "")
    if not heading:
        return []
    start, end = window
    fade = TIMING["card_fade"]
    spec = frame["title"]
    text = plain_text(heading, bool(look["caps"].get("title")))
    block = place_block(look, spec, text, role="title")
    events = _card_scrim(style, role, start, end)
    events += block_events(
        style,
        block,
        line_words({}, text),
        role,
        LAYER_CARD,
        start,
        end,
        f"\\1c{ass_color(style.color(spec.get('color', 'unsung')))}",
        from_opacity=0.0,
        enter=fade,
        exit_=fade,
        tracking=look["tracking"].get("title", 0.0),
    )
    if byline:
        by = frame["artist"]
        if by["place"] == "above":
            baseline = block.top - by["gap"]
        else:
            capitals = font_metrics.face(by["face"])["cap_height"] * by["size"]
            baseline = block.bottom + by["gap"] + capitals
        item = place_item(
            look,
            by["face"],
            byline,
            by["size"],
            spec["measure"],
            block.x,
            block.align,
            baseline,
            role="artist",
        )
        events += item_event(
            style,
            item,
            f"{role}:artist",
            LAYER_CARD,
            start,
            end,
            style.color(by["color"]),
            from_opacity=0.0,
            enter=fade,
            exit_=fade,
            tracking=look["tracking"].get("artist", 0.0),
        )
    return events


def _card_scrim(style: LookStyle, role: str, start: float, end: float) -> list[str]:
    """A look whose cards sit on the picture (Cinema) dims the picture under them."""
    strength = style.look.get("card_scrim")
    if not strength:
        return []
    whole = {"x": 0, "y": 0, "w": style.frame.width, "h": style.frame.height}
    picture = style.spec.get("picture") or whole
    fade = TIMING["card_fade"]
    return [
        shape_event(
            style,
            rect_path(picture["w"] * style.u, picture["h"] * style.u),
            picture["x"],
            picture["y"],
            f"{role}:scrim",
            LAYER_CARD,
            start,
            end,
            style.color("ground"),
            extra=fade_tags(end - start, strength, 0.0, fade, fade),
        )
    ]


def _cue_item(style: LookStyle, text: str) -> Item:
    cue = style.spec["cue"]
    return place_item(
        style.look, cue["face"], text, cue["size"], 60, cue["x"], cue["align"], cue["baseline"]
    )


def cue_events(style: LookStyle, timeline: Any) -> list[str]:
    """The break marker (the seconds until the vocals return) and the count-in over the last
    seconds before a line that follows a break: numerals, or a look's row of dots that go
    out one a second."""
    events: list[str] = []
    cue = style.spec["cue"]
    for start, end, vocals_at in timeline.breaks:
        # The seconds are counted for the last ten minutes of a break, however long it is
        first = min(math.ceil(vocals_at - start - 1e-6), int(TIMING["break_max"]))
        for seconds in range(first, 0, -1):
            shown_from = max(start, vocals_at - seconds)
            shown_to = min(end, vocals_at - seconds + 1)
            if shown_to - shown_from < 0.02:
                continue
            events += item_event(
                style,
                _cue_item(style, str(seconds)),
                "break",
                LAYER_CUE,
                shown_from,
                shown_to,
                style.color("quiet"),
            )
    parts = {line.index: line.part for line in timeline.lines}
    for index, start, end in timeline.count_ins:
        part = parts.get(index, "singer1")
        color = style.color("cue") if part == "singer1" else style.part_color(part)
        if style.look["count_in"] == "dots":
            size = cue["size"] * DOT_SIZE
            step = cue["size"] * (DOT_SIZE + DOT_GAP)
            for dot in range(COUNT_IN_DOTS):
                goes_out = end - (COUNT_IN_DOTS - 1 - dot)
                if goes_out - start < 0.02:
                    continue
                events.append(
                    shape_event(
                        style,
                        circle_path(size * style.u),
                        cue["x"] + dot * step,
                        cue["baseline"] - size,
                        f"countin:{index}",
                        LAYER_CUE,
                        start,
                        goes_out,
                        color,
                        outline=True,
                    )
                )
            continue
        for seconds in range(COUNT_IN_DOTS, 0, -1):
            shown_from = max(start, end - seconds)
            shown_to = end - seconds + 1
            if shown_to - shown_from < 0.02:
                continue
            events += item_event(
                style,
                _cue_item(style, str(seconds)),
                f"countin:{index}",
                LAYER_CUE,
                shown_from,
                shown_to,
                color,
            )
    return events


def progress_events(style: LookStyle, duration: float | None) -> list[str]:
    """A thin line along the bottom edge that fills over the song. Left out when the song's
    length is not known."""
    length = safe_time(duration, 0.0)
    if length <= 0:
        return []
    frame = style.frame
    height = style.spec["progress"]["height"] * style.u
    top = frame.height_px - height
    clip_from = f"\\clip(0,{num(top)},0,{frame.height_px})"
    clip_to = f"\\clip(0,{num(top)},{frame.width_px},{frame.height_px})"
    return [
        shape_event(
            style,
            rect_path(frame.width_px, height),
            0,
            top / style.u,
            "progress",
            LAYER_PROGRESS,
            0.0,
            length,
            style.color("cue"),
            extra=f"{clip_from}\\t(0,{round(length * 1000)},{clip_to})",
        )
    ]


def chord_style(style: LookStyle) -> str:
    """The style line of the chords: the look's label face, top centre."""
    label = style.spec["label"]
    face = font_metrics.face(label["face"])
    cell = 4.2 * style.u * face["ass_size"]
    outline = style.look["outline"]
    width = outline["width"] * style.u if outline else 0
    outline_color = "&H00" + ass_color(outline["color"] if outline else "#000000")[2:8]
    primary = "&H00" + ass_color(style.color("cue"))[2:8]
    margin = round((4.2 if style.frame.aspect == "16:9" else 7.0) * style.u)
    return (
        f"Style: Chord,{face['ass_family']},{num(cell)},{primary},{primary},{outline_color},"
        f"&H00000000,{-1 if face['ass_bold'] else 0},0,0,0,100,100,0,0,1,{num(width)},0,8,"
        f"0,0,{margin},1"
    )


def chord_events(
    chords: list[dict[str, Any]] | None, semitones: int = 0, key: str | None = None
) -> list[str]:
    """One event per chord, transposed with the song."""
    from backend.services.chord_detector import NO_CHORD_VALUES, transpose_chord

    events: list[str] = []
    for seg in chords if isinstance(chords, list) else []:
        if not isinstance(seg, dict):
            continue
        raw = str(seg.get("chord", "")).strip()
        if not raw or raw.upper() in NO_CHORD_VALUES:
            continue
        start = safe_time(seg.get("start") if "start" in seg else seg.get("start_time"), 0.0)
        end = safe_time(seg.get("end") if "end" in seg else seg.get("end_time"), start + 1.0)
        if end <= start:
            end = start + 0.1
        name = raw
        if semitones:
            try:
                name = transpose_chord(raw, semitones, key=key)
            except Exception:
                name = raw
        events.append(
            event(LAYER_CHORD, start, end, "Chord", "chord", f"{{\\an8}}{escape_ass_text(name)}")
        )
    return events
