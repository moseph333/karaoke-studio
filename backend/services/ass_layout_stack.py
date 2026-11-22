"""Subtitle events of a ``stack`` look (Marquee, Cinema): one reading place, where the current
line comes up as it takes over, with the next line waiting under it."""

from typing import Any

from backend.services.ass_draw import (
    LookStyle,
    Prepared,
    ass_color,
    block_events,
    item_event,
    line_words,
)
from backend.services.stage_layout import line_text, place_stack_line, place_stack_next


def stack_events(style: LookStyle, lines: list[Prepared], timeline: Any) -> list[str]:
    look, frame, motion = style.look, style.spec, style.look["motion"]
    tracking = look["tracking"]
    events: list[str] = []
    for n, entry in enumerate(lines):
        timing = entry.timing
        placed = place_stack_line(look, frame, entry.text, entry.name, style.scale)
        start, end = timing.advance, timing.leave + motion["exit"]
        arrive: dict[str, Any] = {
            "rise": motion["rise"],
            "over": motion["enter"],
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
            start,
            end,
            entry.colors,
            sweep=entry.sweep,
            flip_at=entry.flip_at,
            **arrive,
        )
        if placed.label:
            events += item_event(
                style,
                placed.label,
                f"part:{entry.role}",
                0,
                start,
                end,
                style.part_color(timing.part),
                tracking=tracking.get("label", 0.0),
                **arrive,
            )
        if placed.romaji:
            events += item_event(
                style,
                placed.romaji,
                f"romaji:{entry.role}",
                0,
                start,
                end,
                style.color("unsung"),
                **arrive,
            )

        # The line waits under the reading place from when the line before it took over
        waits_from = lines[n - 1].timing.advance if n else timeline.first_show
        if waits_from < timing.advance:
            waiting = line_text(entry.line, bool(look["caps"].get("next")))
            under_romaji = bool(n and lines[n - 1].text.romaji)
            block = place_stack_next(
                look, frame, waiting, style.scale, under_romaji, style.frame.height
            )
            if block:
                events += block_events(
                    style,
                    block,
                    line_words(entry.line, waiting),
                    f"next:{entry.role}",
                    0,
                    waits_from,
                    timing.advance,
                    f"\\1c{ass_color(style.color('quiet'))}",
                    from_opacity=0.0,
                    enter=motion["enter"],
                    tracking=tracking.get("next", 0.0),
                )
    return events
