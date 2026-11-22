"""Subtitle events of a ``column`` look (Songbook, Prompter): a column of lines that moves up
so the line being sung is always at the same height.

The column steps once per line. While line m is at the reading place every visible line
has one event per row: it moves from where it was while line m-1 was there and holds, so a
line's fill is never cut in two (a line takes the reading place before its first word)."""

from typing import Any

from backend.services import font_metrics
from backend.services.ass_draw import (
    LookStyle,
    Prepared,
    ass_color,
    block_events,
    fade_tags,
    item_event,
    shape_event,
    triangle_path,
)
from backend.services.stage_layout import column_state, place_column


def column_events(style: LookStyle, lines: list[Prepared], timeline: Any) -> list[str]:
    look, frame, motion = style.look, style.spec, style.look["motion"]
    if not lines:
        return []
    placed = place_column(
        look, frame, [entry.text for entry in lines], [entry.name for entry in lines], style.scale
    )
    quiet = f"\\1c{ass_color(style.color('quiet'))}"
    events: list[str] = []
    count = len(lines)
    ends_at = lines[-1].timing.leave
    for current in range(-1, count):
        start = timeline.first_show if current < 0 else lines[current].timing.advance
        end = lines[current + 1].timing.advance if current + 1 < count else ends_at
        if end <= start:
            continue
        last = current == count - 1
        now = column_state(frame, placed, current, style.scale)
        before = column_state(frame, placed, current - 1, style.scale) if current >= 0 else None
        over = min(motion["scroll"] if current >= 0 else motion["enter"], end - start)
        leaving = motion["exit"] if last else 0.0
        for i, (entry, line) in enumerate(zip(lines, placed, strict=True)):
            baseline, opacity = now[i]
            was_baseline, was_opacity = before[i] if before else (baseline, 0.0)
            if opacity <= 0 and was_opacity <= 0:
                continue
            moves: dict[str, Any] = {
                "shift": (was_baseline, baseline),
                "over": over,
                "opacity": opacity,
                "from_opacity": was_opacity,
                "enter": over,
                "exit_": leaving,
            }
            if i == current:
                role, colors, sweep = f"lyric:{entry.role}", entry.colors, entry.sweep
                label_color = style.part_color(entry.timing.part)
            elif i < current:
                role, colors, sweep = f"sung:{entry.role}", quiet, "none"
                label_color = style.color("quiet")
            else:
                unsung = entry.colors.split("\\2c")[1]
                role, colors, sweep = f"next:{entry.role}", f"\\1c{unsung}", "none"
                label_color = style.part_color(entry.timing.part)
            events += block_events(
                style,
                line.block,
                entry.words,
                role,
                0,
                start,
                end + leaving,
                colors,
                sweep=sweep,
                flip_at=entry.flip_at,
                **moves,
            )
            if line.label:
                events += item_event(
                    style,
                    line.label,
                    f"part:{entry.role}",
                    0,
                    start,
                    end + leaving,
                    label_color,
                    tracking=look["tracking"].get("label", 0.0),
                    **moves,
                )
            if line.romaji:
                events += item_event(
                    style,
                    line.romaji,
                    f"romaji:{entry.role}",
                    0,
                    start,
                    end + leaving,
                    style.color("quiet") if i < current else style.color("unsung"),
                    **moves,
                )

    caret = frame.get("caret")
    if caret:
        # A marker at the reading line, centred on the capitals of the line there
        spec = frame["lyric"]
        capitals = font_metrics.face(spec["face"])["cap_height"] * spec["size"] * style.scale
        top = spec["baseline"] - capitals / 2 - caret["height"] / 2
        length = ends_at + motion["exit"] - timeline.first_show
        events.append(
            shape_event(
                style,
                triangle_path(caret["width"] * style.u, caret["height"] * style.u),
                caret["x"],
                top,
                "caret",
                0,
                timeline.first_show,
                ends_at + motion["exit"],
                style.color("cue"),
                extra=fade_tags(length, 1.0, 0.0, motion["enter"], motion["exit"]),
            )
        )
    return events
