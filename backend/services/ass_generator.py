"""Advanced SubStation Alpha (.ass) subtitle file generator supporting progressive karaoke sweep tags (\\kf), responsive 16:9/9:16 layouts, and visual theme styling."""

from pathlib import Path
from typing import Any

from backend.services.ass_document import (
    BACKSLASH_GUARD,
    css_to_ass_color,
    escape_ass_text,
    format_ass_time,
    safe_time,
)
from backend.services.ass_style import (
    DEFAULT_BOTH_COLOR,
    DEFAULT_SINGER2_COLOR,
    DEFAULT_THEME_ID,
    LATIN_CHAR_EM,
    MAX_LINE_ROWS,
    MIN_LINE_SCALE,
    VISUAL_THEMES,
    AssStyle,
    clean_style_config,
    estimated_width,
    line_scale,
    resolve_sync_mode,
)
from backend.services.ass_sweep import ADLIB_OFF, ADLIB_ON, _adlib_text, _word_sweep_text
from backend.services.stage_timing import (
    COUNTDOWN_LEAD_IN_SECONDS,
    GAP_LABEL_DELAY_SECONDS,
    INSTRUMENTAL_GAP_THRESHOLD_SECONDS,
    OUTRO_DELAY_SECONDS,
    OUTRO_MIN_SECONDS,
    instrumental_gaps,
    line_span,
    singer_part,
)

# The names other modules and the tests import from here, wherever they are defined now
__all__ = [
    "ADLIB_OFF",
    "ADLIB_ON",
    "BACKSLASH_GUARD",
    "COUNTDOWN_LEAD_IN_SECONDS",
    "DEFAULT_BOTH_COLOR",
    "DEFAULT_SINGER2_COLOR",
    "DEFAULT_THEME_ID",
    "GAP_LABEL_DELAY_SECONDS",
    "INSTRUMENTAL_GAP_THRESHOLD_SECONDS",
    "LATIN_CHAR_EM",
    "MAX_LINE_ROWS",
    "MIN_LINE_SCALE",
    "OUTRO_DELAY_SECONDS",
    "OUTRO_MIN_SECONDS",
    "VISUAL_THEMES",
    "AssStyle",
    "clean_style_config",
    "css_to_ass_color",
    "escape_ass_text",
    "estimated_width",
    "export_title",
    "format_ass_time",
    "generate_ass",
    "generate_ass_content",
    "generate_ass_subtitles",
    "generate_karaoke_ass",
    "instrumental_gaps",
    "line_scale",
    "line_span",
    "resolve_sync_mode",
    "safe_time",
    "singer_part",
]


def export_title(proj: dict) -> str:
    """The title an export carries (the subtitle file's title, the video's closing card):
    "Artist - Title", or whichever of the two the song has."""
    title = str(proj.get("title") or "").strip()
    artist = str(proj.get("artist") or "").strip()
    return f"{artist} - {title}" if (artist and title) else (title or artist or "Karaoke Track")


def generate_ass_content(
    lines: list[dict[str, Any]],
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    title: str = "",
    style_config: dict[str, Any] | None = None,
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    chords: list[dict[str, Any]] | None = None,
    include_chords: bool = False,
    semitones: int = 0,
    key: str | None = None,
    sync_mode: str = "word",
    song_duration: float | None = None,
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file content

    with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
    Supports dynamic 16:9 and 9:16 layout adjustments, visual theme presets,
    direct color overrides, font size scaling, control character escaping,
    and optional transposed musical chords on Layer 2. AssStyle.resolve decides which
    of the arguments, style_config, the stage look and the defaults applies. With the
    countdown on, instrumental gaps also get a label, and the end of the song a title card
    (when ``song_duration`` is given).
    """
    style = AssStyle.resolve(
        style_config=style_config,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        singer2_color=singer2_color,
        both_color=both_color,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        chords=chords,
        include_chords=include_chords,
        semitones=semitones,
        key=key,
        sync_mode=sync_mode,
    )

    safe_title = (title or "Karaoke Studio").replace("\r", " ").replace("\n", " ").strip()
    doc_title = safe_title or "Karaoke Studio"

    ass_content = [
        "[Script Info]",
        f"Title: {doc_title}",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "YCbCr Matrix: TV.709",
        f"PlayResX: {style.width}",
        f"PlayResY: {style.height}",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        # Alignment 2 = Bottom Center, 5 = Top Center
        f"Style: KaraokeLine1,{style.font_name},{style.font_size},{style.primary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: KaraokeLine2,{style.font_name},{style.font_size},{style.primary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line2},1",
        f"Style: KaraokeLine1_Singer2,{style.font_name},{style.font_size},{style.singer2_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: KaraokeLine2_Singer2,{style.font_name},{style.font_size},{style.singer2_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line2},1",
        f"Style: KaraokeLine1_Both,{style.font_name},{style.font_size},{style.both_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: KaraokeLine2_Both,{style.font_name},{style.font_size},{style.both_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line2},1",
        f"Style: Countdown,{style.font_name},{style.font_size + 10},{style.primary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,2,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_countdown},1",
        f"Style: GapLabel,{style.font_name},{max(24, style.font_size - 12)},{style.secondary_color},{style.secondary_color},{style.outline_color},{style.shadow_color},0,-1,0,0,100,100,1,0,1,{style.outline_width},{style.shadow_width},2,{style.margin_lr},{style.margin_lr},{style.margin_v_line1},1",
        f"Style: TitleCard,{style.font_name},64,&H00FFFFFF,&H00FFFFFF,{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,3,3,5,{style.margin_lr},{style.margin_lr},{style.margin_v_title},1",
    ]

    if style.chords_enabled:
        ass_content.append(
            f"Style: Chord,{style.font_name},{style.chord_font_size},{style.chord_color},{style.secondary_color},{style.outline_color},{style.shadow_color},-1,0,0,0,100,100,1,0,1,{max(1, style.outline_width - 1)},{style.shadow_width},{style.chord_alignment},{style.margin_lr},{style.margin_lr},{style.margin_v_chord},1"
        )

    ass_content.extend(
        [
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]
    )

    prev_end_time = 0.0

    if lines and isinstance(lines, list):
        gap_lines = set(instrumental_gaps(lines))
        for i, line in enumerate(lines):
            if not isinstance(line, dict):
                continue
            l_start, l_end = line_span(line)
            raw_words = line.get("words", [])
            words = raw_words if isinstance(raw_words, list) else []

            # Select line style matching singer part assignment while alternating Line1 and Line2
            base_line = "KaraokeLine1" if (i % 2 == 0) else "KaraokeLine2"
            part = singer_part(line)
            style_name = {"singer2": f"{base_line}_Singer2", "both": f"{base_line}_Both"}.get(
                part, base_line
            )

            # Show line early on screen so the singer can prepare
            has_gap = i in gap_lines
            if i == 0:
                display_start = max(0.0, l_start - 2.5)
            elif l_start > prev_end_time:
                display_start = max(prev_end_time, l_start - 2.0)
            else:
                display_start = max(0.0, l_start - 2.0)

            display_start = max(0.0, min(l_start, display_start))
            display_end = max(display_start + 0.5, l_end + 1.2)

            # Visual countdown cue after an instrumental gap (the rule is instrumental_gaps),
            # and a label while the gap lasts
            if style.countdown and has_gap:
                label_start = (prev_end_time + GAP_LABEL_DELAY_SECONDS) if i else 0.0
                if display_start - label_start >= 1.0:
                    label = "♪ Instrumental Intro ♪" if prev_end_time == 0.0 else "♪ Instrumental ♪"
                    ass_content.append(
                        f"Dialogue: 3,{format_ass_time(label_start)},{format_ass_time(display_start)},GapLabel,,0,0,0,,{label}"
                    )
                countdown_start = max(0.0, l_start - COUNTDOWN_LEAD_IN_SECONDS)
                part_color = {"singer2": style.singer2_color, "both": style.both_color}.get(part)
                dots_color_tag = f"{{\\c{part_color}&}}" if part_color else ""

                dots_text = f"{dots_color_tag}{{\\kf100}}● {{\\kf100}}● {{\\kf100}}● "
                ass_content.append(
                    f"Dialogue: 1,{format_ass_time(countdown_start)},{format_ass_time(l_start)},Countdown,,0,0,0,,{dots_text}"
                )

            lead_in_cs = max(0, round((l_start - display_start) * 100))

            if style.sync_mode == "line":
                raw_text = str(line.get("text") or "").strip()
                if not raw_text and words:
                    raw_text = " ".join(
                        str(w.get("word") or "").strip()
                        for w in words
                        if isinstance(w, dict) and str(w.get("word") or "").strip()
                    )
                clean_line_text = _adlib_text(raw_text, line_scale(raw_text, style))

                if lead_in_cs > 0:
                    line_karaoke_text = f"{{\\k{lead_in_cs}}}{{\\k0}}{clean_line_text}"
                else:
                    line_karaoke_text = clean_line_text
            else:
                base_cs = round(display_start * 100)  # the event start exactly as written
                if words:
                    source = str(line.get("text") or "") or " ".join(
                        str(w.get("word") or "") for w in words if isinstance(w, dict)
                    )
                    line_karaoke_text = _word_sweep_text(
                        words, base_cs, l_start, source=source, scale=line_scale(source, style)
                    )
                elif line.get("text"):
                    escaped_text = escape_ass_text(str(line.get("text") or ""))
                    line_karaoke_text = _word_sweep_text(
                        [{"word": escaped_text, "start_time": l_start, "end_time": l_end}],
                        base_cs,
                        l_start,
                        escape=False,
                    )
                else:
                    line_karaoke_text = f"{{\\k{lead_in_cs}}}" if lead_in_cs > 0 else ""

            romaji = " ".join(str(line.get("romaji") or "").split())
            if romaji:
                # A CJK line's romanization, a smaller row under it in the unsung colour
                tint = style.secondary_color.rstrip("&") + "&"
                line_karaoke_text += (
                    f"\\N{{\\r\\i1\\fscx62\\fscy62\\1c{tint}\\2c{tint}}}{escape_ass_text(romaji)}"
                )
            ass_content.append(
                f"Dialogue: 0,{format_ass_time(display_start)},{format_ass_time(display_end)},{style_name},,0,0,0,,{line_karaoke_text}"
            )

            prev_end_time = max(prev_end_time, l_end)

        # The end of the song: its title, from a moment after the last line to the song's end
        # (only when the song's length is known, so the card never outlasts the song)
        card_start = prev_end_time + OUTRO_DELAY_SECONDS
        duration = safe_time(song_duration, 0.0)
        if style.countdown and prev_end_time > 0 and duration - card_start >= OUTRO_MIN_SECONDS:
            ass_content.append(
                f"Dialogue: 3,{format_ass_time(card_start)},{format_ass_time(duration)},TitleCard,,0,0,0,,"
                f"{{\\fad(600,600)}}{escape_ass_text(doc_title)}"
            )

    # Emit chord events on Layer 2 if enabled
    if style.chords_enabled and style.chords and isinstance(style.chords, list):
        from backend.services.chord_detector import NO_CHORD_VALUES, transpose_chord

        for seg in style.chords:
            if not isinstance(seg, dict):
                continue
            raw_chord = str(seg.get("chord", "")).strip()
            if not raw_chord or raw_chord.upper() in NO_CHORD_VALUES:
                continue

            c_start = safe_time(seg.get("start") if "start" in seg else seg.get("start_time"), 0.0)
            c_end = safe_time(
                seg.get("end") if "end" in seg else seg.get("end_time"), c_start + 1.0
            )
            if c_end <= c_start:
                c_end = c_start + 0.1

            if style.semitones != 0:
                try:
                    transposed = transpose_chord(raw_chord, style.semitones, key=style.key)
                except Exception:
                    transposed = raw_chord
            else:
                transposed = raw_chord

            escaped = escape_ass_text(transposed)
            ass_content.append(
                f"Dialogue: 2,{format_ass_time(c_start)},{format_ass_time(c_end)},Chord,,0,0,0,,{style.chord_align_tag}{escaped}"
            )

    return "\n".join(ass_content) + "\n"


def generate_ass_subtitles(
    lines: list[dict[str, Any]],
    output_ass_path: Path,
    style_config: dict[str, Any] | None = None,
    aspect_ratio: str = "16:9",
    theme_id: str | None = None,
    primary_color: str | None = None,
    secondary_color: str | None = None,
    singer2_color: str | None = None,
    both_color: str | None = None,
    title: str = "",
    font_size_scale: float = 1.0,
    include_countdown: bool = True,
    chords: list[dict[str, Any]] | None = None,
    include_chords: bool = False,
    semitones: int = 0,
    key: str | None = None,
    sync_mode: str = "word",
    song_duration: float | None = None,
) -> str:
    """Generates Advanced SubStation Alpha (.ass) subtitle file

    with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
    Supports dynamic 16:9 and 9:16 layout adjustments, custom styling,
    control character escaping, and optional musical chord cues.
    """
    content = generate_ass_content(
        lines=lines,
        aspect_ratio=aspect_ratio,
        theme_id=theme_id,
        primary_color=primary_color,
        secondary_color=secondary_color,
        singer2_color=singer2_color,
        both_color=both_color,
        title=title,
        style_config=style_config,
        font_size_scale=font_size_scale,
        include_countdown=include_countdown,
        chords=chords,
        include_chords=include_chords,
        semitones=semitones,
        key=key,
        sync_mode=sync_mode,
        song_duration=song_duration,
    )
    output_ass_path.write_text(content, encoding="utf-8")
    return str(output_ass_path)


# Backward-compatible aliases
generate_ass = generate_ass_subtitles
generate_karaoke_ass = generate_ass_content
