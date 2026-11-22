"""Reads a generated subtitle file the way the tests ask about it: its header, its styles by
name and its events, each with the role its Name field carries (lyric:3, next:4, title...)."""

import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class AssEvent:
    layer: int
    start: float
    end: float
    style: str
    role: str
    text: str

    @property
    def kind(self) -> str:
        """The role without its line number: "lyric" for "lyric:3"."""
        return self.role.split(":")[0]

    @property
    def line(self) -> int | None:
        """The lyric line an event belongs to, when its role names one."""
        tail = self.role.split(":")[-1]
        return int(tail) if tail.isdigit() else None

    @property
    def tags(self) -> str:
        """The override tags of the event's first block."""
        match = re.match(r"\{([^}]*)\}", self.text)
        return match.group(1) if match else ""

    @property
    def plain(self) -> str:
        """The text as written into the event without its override blocks (a brace a lyric
        holds is escaped, and stays)."""
        return re.sub(r"(?<!\\)\{[^}]*\}", "", self.text)

    def numbers(self, tag: str) -> list[float]:
        """The numbers of the first ``\\tag(...)`` in the event's first block."""
        match = re.search(rf"\\{tag}\(([^)]*)\)", self.tags)
        return [float(part) for part in match.group(1).split(",")] if match else []


def ass_seconds(stamp: str) -> float:
    hours, minutes, seconds = stamp.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_ass(ass_text: str) -> dict[str, Any]:
    """A subtitle file as {"info": {...}, "styles": {name: {field: value}}, "events":
    [{field: value}]}, each event's fields as written."""
    script_info: dict[str, str] = {}
    styles: dict[str, dict[str, str]] = {}
    events: list[dict[str, str]] = []
    section = None
    style_format: list[str] = []
    event_format: list[str] = []
    for line in ass_text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith(";"):
            continue
        if stripped.startswith("[") and stripped.endswith("]"):
            section = stripped[1:-1]
            continue
        if section == "Script Info":
            if ":" in stripped:
                key, value = stripped.split(":", 1)
                script_info[key.strip()] = value.strip()
        elif section == "V4+ Styles":
            if stripped.startswith("Format:"):
                style_format = [f.strip() for f in stripped[len("Format:") :].split(",")]
            elif stripped.startswith("Style:"):
                values = [v.strip() for v in stripped[len("Style:") :].split(",")]
                styles[values[0]] = dict(zip(style_format, values, strict=False))
        elif section == "Events":
            if stripped.startswith("Format:"):
                event_format = [f.strip() for f in stripped[len("Format:") :].split(",")]
            elif stripped.startswith("Dialogue:"):
                values = stripped[len("Dialogue:") :].split(",", len(event_format) - 1)
                events.append(
                    dict(
                        zip(
                            event_format,
                            [v.strip() for v in values[:-1]] + [values[-1]],
                            strict=False,
                        )
                    )
                )
    return {"info": script_info, "styles": styles, "events": events}


def ass_events(ass_text: str) -> list[AssEvent]:
    """Every Dialogue line of a subtitle file, in file order."""
    return [
        AssEvent(
            layer=int(event["Layer"]),
            start=ass_seconds(event["Start"]),
            end=ass_seconds(event["End"]),
            style=event["Style"],
            role=event["Name"],
            text=event["Text"],
        )
        for event in parse_ass(ass_text)["events"]
    ]
