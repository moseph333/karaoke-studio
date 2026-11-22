"""Writes the case files the backend's and the stage's test suites both run, from the backend's
own rules, so the stage's copies of those rules are held to the same answers.

    python -m backend.tools.stage_cases

- stage_fit_cases.json: token widths and a text box in, size and row breaks out (text_fit).
- stage_timeline_cases.json: lyric lines in, when everything shows out (stage_timing).
- stage_layout_cases.json: a line, a look and a format in, where its words go out (stage_layout).
- stage_scene_cases.json: a song in a look at a moment, and everything the video draws then,
  read back from the subtitle file itself (ass_look).

Run it again after changing a rule or backend/assets/shared/stage_looks.json, and read the
diff: looks/test_stage_cases_current.py fails until the files match.
"""

import json
import re
from dataclasses import asdict
from typing import Any

from backend.services import font_metrics
from backend.services import stage_layout as layout
from backend.services.ass_draw import LookStyle
from backend.services.ass_look import generate_look_ass
from backend.services.stage_looks import LOOKS
from backend.services.stage_timing import plan_timeline
from backend.services.text_fit import FitBox, fit_block
from backend.shared_assets import SHARED_DIR
from backend.tools.look_frames import PART_NAMES, SONG_ARTIST, SONG_SECONDS, SONG_TITLE, demo_lines


def cases_json(about: str, cases: list[dict[str, Any]], song: dict[str, Any] | None = None) -> str:
    """A case file as it is written: one case per line (and the song they are about, when
    they share one)."""
    lines = ["{", f'  "about": {json.dumps(about)},']
    if song is not None:
        lines.append(f'  "song": {json.dumps(song, ensure_ascii=False)},')
    lines.append('  "cases": [')
    lines += [
        "    " + json.dumps(case, ensure_ascii=False) + ("," if i < len(cases) - 1 else "")
        for i, case in enumerate(cases)
    ]
    return "\n".join([*lines, "  ]", "}"]) + "\n"


# --- fitting ---------------------------------------------------------------------------------


def fit_case(name, widths, spaces, box, space=0.25, breaks=None):
    breaks = breaks if breaks is not None else spaces
    fit = fit_block(widths, spaces, breaks, space, FitBox(**box))
    return {
        "name": name,
        "widths": widths,
        "spaces": spaces,
        "breaks": breaks,
        "space": space,
        "box": box,
        "expect": {"size": fit.size, "condense": fit.condense, "rows": [list(r) for r in fit.rows]},
    }


def fit_cases() -> list[dict[str, Any]]:
    W5 = [1.0, 2.0, 1.5, 0.5, 2.0]
    S5 = [True, True, True, True, False]
    return [
        fit_case(
            "a short line takes the largest size",
            [1.0, 1.0],
            [True, False],
            {"measure": 100, "min": 9, "prefer": 12, "max": 20, "rows": 2},
        ),
        fit_case(
            "one row is kept when it reaches the preferred size",
            W5,
            S5,
            {"measure": 100, "min": 9, "prefer": 12, "max": 20, "rows": 2},
        ),
        fit_case(
            "two rows when one row would be under the preferred size",
            W5,
            S5,
            {"measure": 60, "min": 4, "prefer": 9, "max": 20, "rows": 2},
        ),
        fit_case(
            "rows are balanced: the widest row is as narrow as it can be",
            [3.0, 1.0, 1.0, 3.0],
            [True, True, True, False],
            {"measure": 30, "min": 2, "prefer": 6, "max": 20, "rows": 2},
        ),
        fit_case(
            "the earliest break wins a tie",
            [1.0, 1.0, 1.0],
            [True, True, False],
            {"measure": 10, "min": 2, "prefer": 8, "max": 20, "rows": 2},
            space=0.0,
        ),
        fit_case(
            "three rows when two are still too small",
            [2.0] * 6,
            [True] * 5 + [False],
            {"measure": 30, "min": 2, "prefer": 6, "max": 10, "rows": 3},
        ),
        fit_case(
            "no row count reaches the preferred size: the largest type wins",
            [4.0] * 6,
            [True] * 5 + [False],
            {"measure": 30, "min": 1, "prefer": 9, "max": 12, "rows": 3},
        ),
        fit_case(
            "a fixed size is kept when the line fits",
            [1.0, 1.0, 1.0],
            [True, True, False],
            {"measure": 60, "min": 5, "prefer": 7, "max": 7, "rows": 2},
        ),
        fit_case(
            "a fixed size shrinks before it condenses",
            [3.0, 3.0, 3.0],
            [True, True, False],
            {"measure": 60, "min": 5, "prefer": 7, "max": 7, "rows": 1},
        ),
        fit_case(
            "text too wide at the smallest size is condensed",
            [6.0, 6.0, 6.0],
            [True, True, False],
            {"measure": 60, "min": 5, "prefer": 7, "max": 7, "rows": 1},
        ),
        fit_case(
            "condensing stops at the limit",
            [20.0, 20.0],
            [True, False],
            {"measure": 60, "min": 5, "prefer": 7, "max": 7, "rows": 1},
        ),
        fit_case(
            "one word cannot be broken",
            [9.0],
            [False],
            {"measure": 30, "min": 2, "prefer": 6, "max": 10, "rows": 3},
        ),
        fit_case(
            "a row may break between CJK characters with no space",
            [1.0] * 8,
            [False] * 8,
            {"measure": 40, "min": 4, "prefer": 8, "max": 8, "rows": 2},
            breaks=[True] * 7 + [False],
        ),
        fit_case("no words", [], [], {"measure": 40, "min": 4, "prefer": 8, "max": 12, "rows": 2}),
        fit_case(
            "sizes step down to a tenth",
            [1.0, 1.0, 1.0],
            [True, True, False],
            {"measure": 37, "min": 2, "prefer": 4, "max": 20, "rows": 1},
        ),
    ]


# --- timeline --------------------------------------------------------------------------------


def ln(start, end, singer=None):
    d = {"start_time": start, "end_time": end}
    if singer:
        d["singer"] = singer
    return d


def tl_case(name, lines, duration=None, cues=True):
    t = plan_timeline(lines, duration, cues)
    return {
        "name": name,
        "lines": lines,
        "duration": duration,
        "cues": cues,
        "expect": {
            "lines": [asdict(line) for line in t.lines],
            "title": list(t.title) if t.title else None,
            "end_card": list(t.end_card) if t.end_card else None,
            "count_ins": [list(c) for c in t.count_ins],
            "breaks": [list(b) for b in t.breaks],
            "first_show": t.first_show,
        },
    }


def timeline_cases() -> list[dict[str, Any]]:
    return [
        tl_case(
            "a long intro gets a title card, a break marker and a count-in",
            [ln(20.0, 24.0), ln(24.5, 28.0)],
            60.0,
        ),
        tl_case("an intro of exactly six seconds still gets the card", [ln(6.0, 9.0)], 20.0),
        tl_case(
            "an intro just under six seconds gets no card but a count-in", [ln(5.9, 9.0)], 20.0
        ),
        tl_case("an intro under the gap threshold gets neither", [ln(3.9, 7.0)], 20.0),
        tl_case(
            "lines that follow closely take over when the one before ends",
            [ln(1.0, 3.0), ln(3.2, 5.0), ln(5.0, 7.0)],
            12.0,
        ),
        tl_case(
            "a line that starts before the one before ends takes over at its own start",
            [ln(1.0, 4.0), ln(3.0, 6.0)],
            10.0,
        ),
        tl_case(
            "a break of four seconds or more gets a marker and a count-in",
            [ln(1.0, 3.0), ln(12.0, 15.0)],
            30.0,
        ),
        tl_case("a break just under four seconds gets none", [ln(1.0, 3.0), ln(6.99, 9.0)], 30.0),
        tl_case(
            "a break too short for its marker still gets the count-in",
            [ln(1.0, 3.0), ln(8.0, 10.0)],
            30.0,
        ),
        tl_case("the end card needs three seconds after the last line", [ln(1.0, 3.0)], 7.5),
        tl_case("no end card when the song ends sooner", [ln(1.0, 3.0)], 7.4),
        tl_case("no end card without the song's length", [ln(1.0, 3.0)], None),
        tl_case(
            "cues off: no count-ins or break markers, the cards stay",
            [ln(20.0, 24.0), ln(40.0, 44.0)],
            60.0,
            cues=False,
        ),
        tl_case(
            "a part name shows where the singer changes",
            [
                ln(1.0, 3.0),
                ln(3.5, 5.0, "singer2"),
                ln(5.5, 7.0, "Singer 2"),
                ln(7.5, 9.0, "both"),
                ln(9.5, 11.0),
            ],
            20.0,
        ),
        tl_case("one part: no part names", [ln(1.0, 3.0), ln(3.5, 5.0, "lead")], 20.0),
        tl_case(
            "entries that are not lines are skipped but keep their index",
            [None, ln(1.0, 3.0), "x", ln(3.5, 5.0)],
            20.0,
        ),
        tl_case(
            "a line without times starts at 0 and lasts four seconds", [{"text": "untimed"}], 20.0
        ),
        tl_case("times are rounded to the centisecond", [ln(1.005, 3.333), ln(3.337, 5.001)], 12.0),
        tl_case("no lines", [], 20.0),
    ]


# --- layout ----------------------------------------------------------------------------------


def _line(text: str, **more: Any) -> dict[str, Any]:
    return {"text": text, **more}


def blk(b):
    return {
        "face": b.face,
        "size": b.size,
        "condense": b.condense,
        "x": b.x,
        "align": b.align,
        "rows": [[r.first, r.end, r.baseline] for r in b.rows],
        "top": b.top,
        "bottom": b.bottom,
    }


def itm(i):
    return (
        None
        if i is None
        else {
            "face": i.face,
            "text": i.text,
            "size": i.size,
            "condense": i.condense,
            "x": i.x,
            "align": i.align,
            "baseline": i.baseline,
        }
    )


def text_of(look, line, role="lyric"):
    return layout.line_text(line, bool(LOOKS[look]["caps"].get(role)))


def stack_case(name, look, aspect, line, part="", nxt=None, scale=1.0, frame_height=None):
    lk = LOOKS[look]
    fr = lk["frames"][aspect]
    text = text_of(look, line)
    placed = layout.place_stack_line(lk, fr, text, part, scale)
    case = {
        "name": name,
        "layout": "stack",
        "look": look,
        "aspect": aspect,
        "scale": scale,
        "line": line,
        "part_name": part,
        "expect": {
            "tokens": list(text.tokens),
            "block": blk(placed.block),
            "label": itm(placed.label),
            "romaji": itm(placed.romaji),
        },
    }
    if nxt is not None:
        height = 100.0 if aspect == "16:9" else 177.78
        nb = layout.place_stack_next(
            lk, fr, text_of(look, nxt, "next"), scale, bool(text.romaji), height
        )
        case["next_line"] = nxt
        case["frame_height"] = height
        case["expect"]["next"] = blk(nb) if nb else None
    return case


def rows_case(name, look, aspect, line, slot, part="", scale=1.0):
    lk = LOOKS[look]
    fr = lk["frames"][aspect]
    text = text_of(look, line)
    placed = layout.place_rows_line(lk, fr, text, slot, part, scale)
    return {
        "name": name,
        "layout": "rows",
        "look": look,
        "aspect": aspect,
        "scale": scale,
        "line": line,
        "slot": slot,
        "part_name": part,
        "expect": {
            "tokens": list(text.tokens),
            "block": blk(placed.block),
            "label": itm(placed.label),
            "romaji": itm(placed.romaji),
        },
    }


def column_case(name, look, aspect, lines, parts, currents, scale=1.0):
    lk = LOOKS[look]
    fr = lk["frames"][aspect]
    texts = [text_of(look, line) for line in lines]
    placed = layout.place_column(lk, fr, texts, parts, scale)
    return {
        "name": name,
        "layout": "column",
        "look": look,
        "aspect": aspect,
        "scale": scale,
        "lines": lines,
        "part_names": parts,
        "expect": {
            "lines": [
                {
                    "block": blk(p.block),
                    "label": itm(p.label),
                    "romaji": itm(p.romaji),
                    "offset": p.offset,
                    "height": p.height,
                }
                for p in placed
            ],
            "states": {
                str(c): [list(s) for s in layout.column_state(fr, placed, c, scale)]
                for c in currents
            },
        },
    }


def layout_cases() -> list[dict[str, Any]]:
    LONG = "We could ride it till the morning finds us sleeping at the end of the line"
    JA = {"text": "夜のバスに乗って", "romaji": "yoru no basu ni notte"}
    SONG = [
        _line("Paper lanterns on the water"),
        _line("Drifting where the river bends"),
        _line(LONG),
        _line("Hold on (hold on) till the light"),
        JA,
        _line("Oh!"),
        _line("Paper lanterns in the rain"),
    ]
    return [
        stack_case(
            "marquee: a short line in capitals at the largest size", "marquee", "16:9", _line("Oh!")
        ),
        stack_case(
            "marquee: one row at a size between preferred and largest, the next line under it",
            "marquee",
            "16:9",
            _line("Paper lanterns on the water"),
            nxt=_line("Drifting where the river bends"),
        ),
        stack_case(
            "marquee: a long line on two rows growing up, with its part name over it",
            "marquee",
            "16:9",
            _line(LONG),
            part="Both",
        ),
        stack_case(
            "marquee: an ad-lib is narrower",
            "marquee",
            "16:9",
            _line("Hold on (hold on) till the light"),
        ),
        stack_case(
            "marquee: a Japanese line stays at the preferred size; the next line moves under the romaji",
            "marquee",
            "16:9",
            JA,
            nxt=_line("Oh!"),
        ),
        stack_case(
            "marquee 9:16: a long line on three rows", "marquee", "9:16", _line(LONG), part="Both"
        ),
        stack_case(
            "marquee: a larger lyric size scales the type",
            "marquee",
            "16:9",
            _line("Paper lanterns on the water"),
            scale=1.5,
        ),
        stack_case(
            "cinema: one centred row in the bar, the part name in the margin",
            "cinema",
            "16:9",
            _line("Paper lanterns on the water"),
            part="Mara",
            nxt=_line("Drifting where the river bends"),
        ),
        stack_case("cinema: a long line shrinks to stay on one row", "cinema", "16:9", _line(LONG)),
        stack_case(
            "cinema: no room for the next line under the romaji",
            "cinema",
            "16:9",
            JA,
            nxt=_line("Oh!"),
        ),
        stack_case(
            "cinema 9:16: rows under the picture, the part name over them",
            "cinema",
            "9:16",
            _line(LONG),
            part="Both",
            nxt=_line("Oh!"),
        ),
        rows_case(
            "ktv: an even line sits in the left row",
            "ktv",
            "16:9",
            _line("Paper lanterns on the water"),
            0,
            part="Mara",
        ),
        rows_case(
            "ktv: an odd line sits in the right row",
            "ktv",
            "16:9",
            _line("Drifting where the river bends"),
            1,
            part="Theo",
        ),
        rows_case("ktv: a long line takes two rows growing up", "ktv", "16:9", _line(LONG), 0),
        rows_case("ktv: romaji under the row", "ktv", "16:9", JA, 1),
        rows_case(
            "ktv 9:16", "ktv", "9:16", _line("Hold on (hold on) till the light"), 0, part="Mara"
        ),
        column_case(
            "songbook: the column, with part names in the margin",
            "songbook",
            "16:9",
            SONG,
            ["Mara", "", "Both", "Mara", "", "", ""],
            [-1, 0, 2, 4, 6],
        ),
        column_case(
            "songbook 9:16: part names over their lines",
            "songbook",
            "9:16",
            SONG,
            ["Mara", "", "Both", "Mara", "", "", ""],
            [-1, 0, 3],
        ),
        column_case(
            "prompter: three lines ahead, dimmer as they are farther",
            "prompter",
            "16:9",
            SONG,
            ["Mara", "", "Both", "Mara", "", "", ""],
            [-1, 0, 1, 5],
        ),
        column_case(
            "prompter 9:16 at a larger lyric size",
            "prompter",
            "9:16",
            SONG,
            ["", "", "", "", "", "", ""],
            [0, 2],
            scale=1.2,
        ),
    ]


# --- scenes ----------------------------------------------------------------------------------

# Moments of the demo song a scene is read at: the frames the look_frames tool draws, and
# moments inside a transition (a card fading in, a line arriving, a column stepping, a line
# leaving)
SCENE_TIMES = (0.6, 3.0, 9.2, 10.4, 13.4, 15.5, 21.2, 27.1, 28.6, 33.4, 37.6, 41.5, 42.4,
               47.0, 54.1, 58.3, 64.9, 66.2, 72.0)  # fmt: skip
PORTRAIT_SCENE_TIMES = (3.0, 15.5, 28.6, 37.6, 47.0, 72.0)
_ALIGN = {"7": "left", "8": "center", "9": "right"}


def _seconds(stamp: str) -> float:
    hours, minutes, seconds = stamp.split(":")
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def _numbers(tags: str, tag: str) -> list[float] | None:
    found = re.search(rf"\\{tag}\(([^)]*)\)", tags)
    return [float(part) for part in found.group(1).split(",")] if found else None


def _ramp(at: float, start: float, end: float, first: float, last: float) -> float:
    if at <= start or end <= start:
        return first if at <= start else last
    return last if at >= end else first + (last - first) * (at - start) / (end - start)


def _css(color: str) -> str:
    digits = color.strip("&H")[-6:]
    return f"#{digits[4:6]}{digits[2:4]}{digits[0:2]}".lower()


def scene_of_script(script: str, at: float, u: float) -> dict[str, list[dict[str, Any]]]:
    """Everything a subtitle file draws at ``at`` seconds, read from its events: each row of
    text with its place (the edge its alignment names and its top, in u), em size, squeeze,
    opacity and colours, and each shape. Shadows and chords are left out."""
    texts: list[dict[str, Any]] = []
    shapes: list[dict[str, Any]] = []
    for row in script.splitlines():
        if not row.startswith("Dialogue:"):
            continue
        _layer, start, end, face, role, _l, _r, _v, _e, text = row[len("Dialogue:") :].split(",", 9)
        if not _seconds(start.strip()) <= at < _seconds(end.strip()):
            continue
        if role.startswith("shadow") or role == "chord":
            continue
        tags = re.match(r"\{([^}]*)\}", text).group(1)
        local = (at - _seconds(start.strip())) * 1000
        place = _numbers(tags, "pos") or _numbers(tags, "move")
        x, y = place[0], place[1]
        if len(place) == 6:
            y = _ramp(local, place[4], place[5], place[1], place[3])
        opacity = 1.0
        fade = _numbers(tags, "fade")
        if fade:
            a1, a2, a3, t1, t2, t3, t4 = fade
            alpha = _ramp(local, t1, t2, a1, a2) if local < t3 else _ramp(local, t3, t4, a2, a3)
            opacity = 1 - alpha / 255
        entry: dict[str, Any] = {"role": role, "x": round(x / u, 3), "opacity": round(opacity, 3)}
        color = re.search(r"\\1c(&H[0-9A-F]+&)", tags)
        if face == "Shape":
            entry |= {"y": round(y / u, 3), "color": _css(color.group(1))}
            clip = re.search(r"\\t\(0,(\d+),\\clip\(0,[\d.]+,(\d+),", tags)
            if clip:
                entry["width"] = round(int(clip.group(2)) * local / int(clip.group(1)) / u, 3)
            shapes.append(entry)
            continue
        size = float(re.search(r"\\fs([\d.]+)", tags).group(1))
        squeeze = re.search(r"\\fscx([\d.]+)", tags)
        unsung = re.search(r"\\2c(&H[0-9A-F]+&)", tags)
        entry |= {
            "text": re.sub(r"\{[^}]*\}", "", text),
            "align": _ALIGN[re.search(r"\\an(\d)", tags).group(1)],
            "top": round(y / u, 3),
            "face": face,
            "size": round(size / font_metrics.face(face)["ass_size"] / u, 3),
            "condense": round(float(squeeze.group(1)) / 100, 3) if squeeze else 1.0,
            "sung": _css(color.group(1)),
        }
        if unsung:
            entry["unsung"] = _css(unsung.group(1))
        texts.append(entry)
    texts.sort(key=lambda item: (item["role"], item["top"]))
    shapes.sort(key=lambda item: (item["role"], item["x"]))
    return {"texts": texts, "shapes": shapes}


def scene_song() -> dict[str, Any]:
    return {
        "lines": demo_lines(),
        "title": SONG_TITLE,
        "artist": SONG_ARTIST,
        "duration": SONG_SECONDS,
        "part_names": PART_NAMES,
    }


def scene_cases() -> list[dict[str, Any]]:
    song = scene_song()
    cases = []
    for look_id in LOOKS:
        for aspect, times in (("16:9", SCENE_TIMES), ("9:16", PORTRAIT_SCENE_TIMES)):
            style = LookStyle.of(look_id, aspect, part_names=song["part_names"])
            script = generate_look_ass(
                song["lines"],
                style,
                title=song["title"],
                artist=song["artist"],
                duration=song["duration"],
            )
            for at in times:
                cases.append(
                    {
                        "name": f"{look_id} {aspect} at {at} s",
                        "look": look_id,
                        "aspect": aspect,
                        "time": at,
                        "expect": scene_of_script(script, at, style.u),
                    }
                )
    return cases


# --- the files -------------------------------------------------------------------------------


def case_files() -> dict[str, str]:
    """Each case file's name and the text it should hold."""
    return {
        "stage_fit_cases.json": cases_json(
            "Token widths and a text box in, the fitted size, squeeze and row breaks out. Run by backend/tests/looks/test_text_fit_cases.py and the stage's stageFit tests.",
            fit_cases(),
        ),
        "stage_timeline_cases.json": cases_json(
            "Lyric lines and the song's length in, when everything shows out (seconds). show/hide are for looks with a row per line, advance/leave for looks with one reading place. Run by backend/tests/looks/test_stage_timeline_cases.py and the stage's stageTimeline tests.",
            timeline_cases(),
        ),
        "stage_layout_cases.json": cases_json(
            "A lyric line, a look and a format in, where its words go out (u: 1% of the frame's short side; sizes are ems, positions baselines). Run by backend/tests/looks/test_stage_layout_cases.py and the stage's stageLayout tests.",
            layout_cases(),
        ),
        "stage_scene_cases.json": cases_json(
            "A made-up song in a look and a format at a moment, and every row of text and "
            "every shape the video draws then, read back from the subtitle file (u: 1% of the "
            "frame's short side; x is the edge the alignment names, top the row's top edge). "
            "Run by the stage's stageScene tests; looks/test_stage_cases_current.py keeps "
            "the file current.",
            scene_cases(),
            scene_song(),
        ),
    }


def main() -> None:
    for name, text in case_files().items():
        (SHARED_DIR / name).write_text(text, encoding="utf-8")
        print(f"Wrote {SHARED_DIR / name}")


if __name__ == "__main__":
    main()
