"""Writes a look-driven subtitle file: the header, a style per typeface, and the events of the
look's layout and frame parts. Each event's Name field says what it is (lyric:3, next:4,
part:3, title, countin:5, break, progress, ...); libass ignores it."""

from typing import Any

from backend.services import font_metrics
from backend.services.ass_draw import LookStyle, num, prepare_lines
from backend.services.ass_frame import (
    card_events,
    chord_events,
    chord_style,
    cue_events,
    progress_events,
)
from backend.services.ass_layout_column import column_events
from backend.services.ass_layout_rows import rows_events
from backend.services.ass_layout_stack import stack_events
from backend.services.stage_timing import plan_timeline

_LAYOUT_EVENTS = {"stack": stack_events, "rows": rows_events, "column": column_events}
STYLE_FORMAT = (
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
    "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
    "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding"
)
EVENT_FORMAT = "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"


def look_faces(style: LookStyle) -> list[str]:
    """The typefaces a look's frame uses, in a stable order."""
    look, frame = style.look, style.spec
    faces = [
        frame[key]["face"]
        for key in ("lyric", "next", "label", "cue", "title", "artist")
        if frame.get(key)
    ]
    faces += [look["romaji"].get("face"), look["adlib"].get("face")]
    return list(dict.fromkeys(face for face in faces if face))


def _face_style(style: LookStyle, face_id: str) -> str:
    """A style that names one typeface; each event sets its own size, colours and place."""
    face = font_metrics.face(face_id)
    cell = 5 * style.u * face["ass_size"]
    return (
        f"Style: {face_id},{face['ass_family']},{num(cell)},&H00FFFFFF,&H00FFFFFF,&H00000000,"
        f"&H00000000,{-1 if face['ass_bold'] else 0},{-1 if face['ass_italic'] else 0},0,0,"
        "100,100,0,0,1,0,0,7,0,0,0,1"
    )


def look_fonts(style: LookStyle) -> list[str]:
    """The font files this look's subtitle file needs."""
    return [font_metrics.face(face_id)["file"] for face_id in look_faces(style)]


def generate_look_ass(
    lines: Any,
    style: LookStyle,
    *,
    title: str = "",
    artist: str = "",
    doc_title: str | None = None,
    duration: float | None = None,
    chords: list[dict[str, Any]] | None = None,
    semitones: int = 0,
    key: str | None = None,
) -> str:
    """The subtitle file of ``lines`` in a look. ``title`` and ``artist`` go on the cards
    (``doc_title`` is the file's own title, "Artist - Title" when not given);
    ``duration`` is the song's length (the end card and the progress line need it);
    ``chords`` are drawn when given. With ``style.furniture`` off (the plain download) the
    progress line is left out."""
    frame = style.frame
    valid = lines if isinstance(lines, list) else []
    timeline = plan_timeline(valid, duration, cues=style.cues)
    prepared = prepare_lines(style, valid, timeline)
    heading = " - ".join(part for part in (artist.strip(), title.strip()) if part)
    # A line break in a title would start a section of its own in the file
    doc_title = " ".join((doc_title or heading or "Karaoke Studio").split()) or "Karaoke Studio"
    families = sorted({font_metrics.face(face)["ass_family"] for face in look_faces(style)})

    script = [
        "[Script Info]",
        f"; Fonts: {', '.join(families)}",
        f"Title: {doc_title}",
        "ScriptType: v4.00+",
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "Kerning: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {frame.width_px}",
        f"PlayResY: {frame.height_px}",
        "",
        "[V4+ Styles]",
        STYLE_FORMAT,
    ]
    script += [_face_style(style, face_id) for face_id in look_faces(style)]
    script.append(
        "Style: Shape,Arial,20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,"
        "0,0,1,0,0,7,0,0,0,1"
    )
    if chords:
        script.append(chord_style(style))
    script += ["", "[Events]", EVENT_FORMAT]

    if timeline.title:
        script += card_events(style, title, artist, timeline.title, "title")
    script += _LAYOUT_EVENTS[style.look["layout"]](style, prepared, timeline)
    script += cue_events(style, timeline)
    if timeline.end_card:
        script += card_events(style, title, artist, timeline.end_card, "end")
    if chords:
        script += chord_events(chords, semitones, key)
    if style.furniture:
        script += progress_events(style, duration)
    return "\n".join(script) + "\n"
