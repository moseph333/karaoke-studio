"""Subtitle events of a ``rows`` look (KTV): two rows that lines take in turn, each line
showing a little before it is sung and staying a moment after."""

from typing import Any

from backend.services.ass_draw import LookStyle, Prepared, block_events, item_event
from backend.services.stage_layout import place_rows_line


def rows_events(style: LookStyle, lines: list[Prepared], timeline: Any) -> list[str]:
    look, frame, motion = style.look, style.spec, style.look["motion"]
    events: list[str] = []
    for entry in lines:
        timing = entry.timing
        placed = place_rows_line(look, frame, entry.text, timing.index % 2, entry.name, style.scale)
        fades: dict[str, Any] = {
            "from_opacity": 0.0,
            "enter": motion["enter"],
            "exit_": motion["exit"],
        }
        events += block_events(
            style,
            placed.block,
            entry.words,
            f"lyric:{entry.role}",
            0,
            timing.show,
            timing.hide,
            entry.colors,
            sweep=entry.sweep,
            flip_at=entry.flip_at,
            **fades,
        )
        if placed.label:
            events += item_event(
                style,
                placed.label,
                f"part:{entry.role}",
                0,
                timing.show,
                timing.hide,
                style.part_color(timing.part),
                tracking=look["tracking"].get("label", 0.0),
                **fades,
            )
        if placed.romaji:
            events += item_event(
                style,
                placed.romaji,
                f"romaji:{entry.role}",
                0,
                timing.show,
                timing.hide,
                style.color("unsung"),
                **fades,
            )
    return events
