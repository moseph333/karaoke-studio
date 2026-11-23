"""The subtitle file a look writes: which events it holds, when, and what they say."""

import itertools
import re

import pytest

from backend.services import font_metrics
from backend.services.ass_draw import LookStyle
from backend.services.ass_look import generate_look_ass, look_faces, look_fonts
from backend.services.stage_looks import ASPECTS, LOOKS
from backend.services.stage_timing import plan_timeline
from backend.tests.helpers.ass_script import ass_events, parse_ass
from backend.tools.look_frames import PART_NAMES, SONG_ARTIST, SONG_SECONDS, SONG_TITLE, demo_lines

LINES = demo_lines()
PLAN = plan_timeline(LINES, SONG_SECONDS)
EVERY_LOOK = [(look, aspect) for look in LOOKS for aspect in ASPECTS]


def write(look_id: str, aspect: str = "16:9", lines=None, **given) -> str:
    style = LookStyle.of(look_id, aspect, part_names=PART_NAMES, **given)
    return generate_look_ass(
        LINES if lines is None else lines,
        style,
        title=SONG_TITLE,
        artist=SONG_ARTIST,
        duration=SONG_SECONDS,
    )


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_the_header_fits_the_frame_and_turns_wrapping_off(look_id, aspect):
    info = parse_ass(write(look_id, aspect))["info"]
    assert (info["PlayResX"], info["PlayResY"]) == (
        ("1080", "1920") if aspect == "9:16" else ("1920", "1080")
    )
    assert info["WrapStyle"] == "2" and info["Kerning"] == "yes"
    assert info["Title"] == f"{SONG_ARTIST} - {SONG_TITLE}"


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_every_event_uses_a_style_the_file_defines(look_id, aspect):
    text = write(look_id, aspect)
    styles = parse_ass(text)["styles"]
    style = LookStyle.of(look_id, aspect)
    for face in look_faces(style):
        metrics = font_metrics.face(face)
        assert styles[face]["Fontname"] == metrics["ass_family"]
        assert styles[face]["Bold"] == ("-1" if metrics["ass_bold"] else "0")
    assert {event.style for event in ass_events(text)} <= set(styles)


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_every_line_is_filled_by_exactly_one_run_of_events_from_before_it_starts(look_id, aspect):
    """The fill of a line is never cut in two: all its sweep rows share one event window,
    which opens no later than the line's first word."""
    events = ass_events(write(look_id, aspect))
    for timing in PLAN.lines:
        rows = [e for e in events if e.role == f"lyric:{timing.index}"]
        assert rows, f"line {timing.index} is never the line being sung"
        assert len({(e.start, e.end) for e in rows}) == 1
        assert rows[0].start <= timing.start + 0.005
        assert rows[0].end >= min(timing.end, rows[0].end)
        drawn = "".join(e.plain for e in rows).replace(" ", "")
        expected = "".join(w["word"] for w in LINES[timing.index]["words"]).replace(" ", "")
        assert drawn.casefold() == expected.casefold()


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_a_words_fill_starts_and_ends_on_its_own_times(look_id, aspect):
    events = ass_events(write(look_id, aspect))
    line = LINES[0]
    rows = [e for e in events if e.role == "lyric:0"]
    found = {}
    for row in rows:
        clock = round(row.start * 100)
        for kind, length, word in re.findall(r"\{\\(kf|k)(\d+)\}([^{]*)", row.text):
            if kind == "kf":
                found[word.strip().casefold()] = (clock, clock + int(length))
            clock += int(length)
    for word in line["words"]:
        start, end = found[word["word"].casefold()]
        assert start == round(word["start_time"] * 100)
        assert end == round(word["end_time"] * 100)


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_an_event_moves_at_most_once_and_fades_at_most_once(look_id, aspect):
    for event in ass_events(write(look_id, aspect)):
        assert event.tags.count("\\move(") + event.tags.count("\\pos(") == 1, event.text
        assert event.tags.count("\\fade(") <= 1
        assert event.end > event.start


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_the_frame_parts_show_when_the_plan_says(look_id, aspect):
    events = ass_events(write(look_id, aspect))

    def window(kind: str) -> tuple[float, float]:
        chosen = [e for e in events if e.kind == kind]
        assert chosen, f"no {kind}"
        return min(e.start for e in chosen), max(e.end for e in chosen)

    assert window("title") == pytest.approx(PLAN.title)
    assert window("end") == pytest.approx(PLAN.end_card)
    assert window("progress") == pytest.approx((0.0, SONG_SECONDS))
    for index, start, end in PLAN.count_ins:
        cue = [e for e in events if e.role == f"countin:{index}"]
        assert min(e.start for e in cue) == pytest.approx(start)
        assert max(e.end for e in cue) == pytest.approx(end)
    first_break = PLAN.breaks[-1]
    marks = sorted((e for e in events if e.kind == "break"), key=lambda e: e.start)
    last = [e for e in marks if e.start >= first_break[0] - 0.005]
    assert last[0].start == pytest.approx(first_break[0])
    assert last[-1].end == pytest.approx(first_break[1])
    assert [e.plain for e in last][-3:] == ["6", "5", "4"]


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_a_part_name_shows_where_the_singer_changes(look_id, aspect):
    events = ass_events(write(look_id, aspect))
    named = {e.line: e.plain for e in events if e.kind == "part"}
    assert sorted(named) == [line.index for line in PLAN.lines if line.label]
    upper = bool(LOOKS[look_id]["caps"].get("label"))
    assert named[0] == ("MARA" if upper else "Mara")
    assert named[2] == ("THEO" if upper else "Theo")
    assert named[4].casefold() == "both"


def test_one_part_songs_show_no_part_names():
    solo = [{**line, "singer": "singer1"} for line in LINES]
    assert not [e for e in ass_events(write("marquee", lines=solo)) if e.kind == "part"]


def test_marquee_writes_the_line_being_sung_in_capitals_and_the_next_as_written():
    events = ass_events(write("marquee"))
    assert next(e for e in events if e.role == "lyric:0").plain == "PAPER LANTERNS ON THE WATER"
    assert next(e for e in events if e.role == "next:1").plain == "Drifting where the river bends"


def test_marquee_brings_a_line_up_into_place_as_it_takes_over():
    line = next(e for e in ass_events(write("marquee")) if e.role == "lyric:1")
    x0, y0, x1, y1, t0, t1 = line.numbers("move")
    assert (x0, t0, t1) == (x1, 0, 180)
    assert y0 - y1 == pytest.approx(1.5 * 10.8, abs=0.02)
    assert line.numbers("fade")[:2] == [255, 0]


def test_ktv_alternates_two_rows_left_and_right():
    events = ass_events(write("ktv"))
    rows = {e.line: e.tags for e in events if e.kind == "lyric"}
    assert "\\an7" in rows[0] and "\\an9" in rows[1] and "\\an7" in rows[2]
    assert all("\\bord" in tags and "\\3c" in tags for tags in rows.values())
    shadows = [e for e in events if e.kind == "shadow"]
    assert shadows and all("\\blur" in e.tags and "\\1a&HFF&" in e.tags for e in shadows)
    assert all("\\k" not in e.text for e in shadows)


def test_ktv_counts_in_with_dots_that_go_out_one_a_second():
    cue = [e for e in ass_events(write("ktv")) if e.role == "countin:0"]
    assert len(cue) == 3 and all("\\p1" in e.text for e in cue)
    assert sorted(round(e.end, 2) for e in cue) == [10.0, 11.0, 12.0]


def test_a_column_steps_once_per_line_and_never_cuts_a_line_being_sung():
    events = ass_events(write("songbook"))
    for timing in PLAN.lines:
        mine = sorted(
            (e for e in events if e.line == timing.index and e.kind in ("next", "lyric", "sung")),
            key=lambda e: e.start,
        )
        kinds = [e.kind for e in mine]
        assert kinds == sorted(kinds, key=["next", "lyric", "sung"].index)
        for earlier, later in itertools.pairwise(mine):
            assert later.start == pytest.approx(earlier.end) or later.start == earlier.start
        assert all("\\k" not in e.text for e in mine if e.kind != "lyric")


def test_a_columns_line_arrives_at_the_reading_line_and_stays_there():
    style = LookStyle.of("prompter")
    spec = style.spec["lyric"]
    events = ass_events(write("prompter"))
    top = spec["baseline"] * 10.8 - font_metrics.face(spec["face"])["ascent"] * spec["size"] * 10.8
    for timing in PLAN.lines[1:]:
        row = next(e for e in events if e.role == f"lyric:{timing.index}")
        move = row.numbers("move")
        assert move, "a line steps up into the reading place"
        assert move[3] == pytest.approx(top, abs=0.02)
        assert move[1] > move[3]


def test_prompter_dims_what_was_sung_and_tints_a_part_on_the_words_to_sing():
    look = LOOKS["prompter"]["palette"]
    events = ass_events(write("prompter"))

    def bgr(css: str) -> str:
        return f"&H{css[5:7]}{css[3:5]}{css[1:3]}&".upper()

    solo = next(e for e in events if e.role == "lyric:0")
    duet = next(e for e in events if e.role == "lyric:2")
    assert f"\\1c{bgr(look['sung'])}\\2c{bgr(look['unsung'])}" in solo.tags
    assert f"\\1c{bgr(look['sung'])}\\2c{bgr(look['singer2'])}" in duet.tags


def test_line_mode_flips_a_whole_line_when_it_starts_and_prompter_when_it_ends():
    line = LINES[1]
    marquee = next(e for e in ass_events(write("marquee", sync_mode="line")) if e.role == "lyric:1")
    lead = round((line["start_time"] - marquee.start) * 100)
    assert f"{{\\k{lead}}}{{\\k0}}" in marquee.text and "\\kf" not in marquee.text
    prompter = next(
        e for e in ass_events(write("prompter", sync_mode="line")) if e.role == "lyric:1"
    )
    lead = round((line["end_time"] - prompter.start) * 100)
    assert f"{{\\k{lead}}}{{\\k0}}" in prompter.text


def test_a_line_without_word_timing_flips_like_line_mode():
    untimed = [{"text": "No word times here", "start_time": 2.0, "end_time": 5.0}]
    row = next(e for e in ass_events(write("ktv", lines=untimed)) if e.kind == "lyric")
    assert "\\kf" not in row.text and "{\\k0}" in row.text
    assert row.plain == "No word times here"


def test_ad_libs_are_smaller_and_see_through_and_italic_only_where_the_look_has_one():
    marquee = next(e for e in ass_events(write("marquee")) if e.role == "lyric:5")
    assert "\\fscy80" in marquee.text and "\\1a&H40&" in marquee.text and "\\i1" not in marquee.text
    assert marquee.text.index("\\fscy80") < marquee.text.index("(HOLD")
    assert "\\fscy100" in marquee.text.split("ON)")[1]
    songbook = next(e for e in ass_events(write("songbook")) if e.role == "lyric:5")
    assert "\\i1" in songbook.text and "\\i0" in songbook.text


def test_romaji_is_a_row_of_its_own_that_is_never_swept():
    for look_id in LOOKS:
        romaji = [e for e in ass_events(write(look_id)) if e.role == "romaji:6"]
        assert romaji and all(e.plain == "yoru no basu ni notte" for e in romaji)
        assert all("\\k" not in e.text for e in romaji)


def test_a_japanese_line_is_filled_one_character_at_a_time():
    row = next(e for e in ass_events(write("ktv")) if e.role == "lyric:6")
    assert row.plain == "夜のバスに乗って"
    assert row.text.count("\\kf") == 8


def test_lyric_text_cannot_inject_override_tags():
    nasty = [
        {
            "text": "{\\fs200}big \\N break",
            "start_time": 1.0,
            "end_time": 3.0,
            "words": [
                {"word": "{\\fs200}big", "start_time": 1.0, "end_time": 2.0},
                {"word": "\\N", "start_time": 2.0, "end_time": 2.5},
                {"word": "break", "start_time": 2.5, "end_time": 3.0},
            ],
        }
    ]
    row = next(e for e in ass_events(write("ktv", lines=nasty)) if e.kind == "lyric")
    assert "\\{\\\u2060fs200\\}big" in row.text
    assert "\\\u2060N" in row.text


def test_the_users_colours_and_lyric_size_apply():
    plain = next(e for e in ass_events(write("ktv")) if e.role == "lyric:0")
    custom = next(
        e
        for e in ass_events(write("ktv", sung="#00ff00", unsung="#112233", scale=1.5))
        if e.role == "lyric:0"
    )
    assert "\\1c&H00FF00&\\2c&H332211&" in custom.tags

    def size(event) -> float:
        return float(re.search(r"\\fs([\d.]+)", event.tags).group(1))

    assert size(custom) == pytest.approx(size(plain) * 1.5, rel=0.01)


def test_cues_off_leaves_out_the_count_in_and_the_break_marker_only():
    kinds = {e.kind for e in ass_events(write("marquee", cues=False))}
    assert not kinds & {"countin", "break"}
    assert {"title", "end", "progress", "lyric"} <= kinds


def test_the_plain_download_leaves_out_the_progress_line():
    kinds = {e.kind for e in ass_events(write("marquee", furniture=False))}
    assert "progress" not in kinds and "lyric" in kinds


def test_a_song_of_unknown_length_gets_no_end_card_and_no_progress_line():
    style = LookStyle.of("marquee")
    text = generate_look_ass(LINES, style, title=SONG_TITLE, artist=SONG_ARTIST)
    kinds = {e.kind for e in ass_events(text)}
    assert not kinds & {"end", "progress"} and "title" in kinds


def test_no_lines_still_gives_a_valid_file():
    for look_id in LOOKS:
        text = write(look_id, lines=[])
        assert "[Events]" in text
        assert {e.kind for e in ass_events(text)} <= {"progress"}


def test_chords_are_drawn_top_centre_and_transposed():
    style = LookStyle.of("cinema")
    chords = [{"chord": "C", "start": 1.0, "end": 3.0}, {"chord": "N", "start": 3.0, "end": 4.0}]
    text = generate_look_ass(LINES, style, duration=SONG_SECONDS, chords=chords, semitones=2)
    drawn = [e for e in ass_events(text) if e.kind == "chord"]
    assert [e.plain for e in drawn] == ["D"]
    assert parse_ass(text)["styles"]["Chord"]["Alignment"] == "8"


def test_a_look_names_the_font_files_its_file_needs():
    assert look_fonts(LookStyle.of("songbook")) == [
        "Newsreader-Medium.ttf",
        "Newsreader-MediumItalic.ttf",
    ]
    assert set(look_fonts(LookStyle.of("marquee"))) == {
        "SofiaSansExtraCondensed-Black.ttf",
        "SofiaSans-Bold.ttf",
    }
    assert "; Fonts: Newsreader Medium" in write("songbook")


def test_a_thousand_lines_are_written_quickly():
    import time

    many = [
        {
            "text": f"Line number {i} of a very long song",
            "start_time": i * 3.0,
            "end_time": i * 3.0 + 2.5,
            "words": [
                {
                    "word": word,
                    "start_time": i * 3.0 + k * 0.3,
                    "end_time": i * 3.0 + k * 0.3 + 0.25,
                }
                for k, word in enumerate(f"Line number {i} of a very long song".split())
            ],
        }
        for i in range(1000)
    ]
    for look_id in LOOKS:
        started = time.perf_counter()
        text = write(look_id, lines=many)
        assert time.perf_counter() - started < 6.0, look_id
        assert len({e.line for e in ass_events(text) if e.kind == "lyric"}) == 1000


def test_words_that_are_blank_or_padded_are_drawn_clean():
    messy = [
        {
            "start_time": 1.0,
            "end_time": 4.0,
            "words": [
                {"word": None, "start_time": 1.0, "end_time": 1.2},
                {"word": "  Starlight  ", "start_time": 1.2, "end_time": 2.0},
                {"word": "", "start_time": 2.0, "end_time": 2.2},
                "not a word",
                {"word": "   ", "start_time": 2.2, "end_time": 2.4},
                {"word": "Serenade", "start_time": 2.4, "end_time": 4.0},
            ],
        }
    ]
    for sync_mode in ("word", "line"):
        row = next(
            e
            for e in ass_events(write("ktv", lines=messy, sync_mode=sync_mode))
            if e.kind == "lyric"
        )
        assert row.plain == "Starlight Serenade"
    swept = next(e for e in ass_events(write("ktv", lines=messy)) if e.kind == "lyric")
    assert swept.text.count("\\kf") == 2


def test_a_line_with_nothing_to_draw_draws_nothing_not_even_its_part_name():
    empty = [
        {"text": None, "words": None, "singer": "both", "start_time": 1.0, "end_time": 3.0},
        {
            "text": "",
            "words": [{"word": ""}],
            "singer": "singer2",
            "start_time": 3.5,
            "end_time": 5.0,
        },
    ]
    line_roles = ("lyric", "next", "sung", "part", "shadow:lyric", "shadow:part")
    for look_id in LOOKS:
        roles = [e.role for e in ass_events(write(look_id, lines=empty))]
        assert not [role for role in roles if role.startswith(line_roles)], look_id


def test_a_very_long_break_counts_only_its_last_ten_minutes():
    far = [
        {"text": "Start", "start_time": 1.0, "end_time": 2.0},
        {"text": "A day later", "start_time": 86_400.0, "end_time": 86_402.0},
    ]
    marks = [e for e in ass_events(write("marquee", lines=far)) if e.kind == "break"]
    assert len(marks) == 600 - 3
    assert marks[0].plain == "600" and marks[-1].plain == "4"
    assert marks[0].start == pytest.approx(86_400.0 - 600)


def test_word_times_that_are_not_times_do_not_stop_the_file_being_written():
    odd = [
        {
            "text": "a b c",
            "start_time": 1.0,
            "end_time": 4.0,
            "words": [
                {"word": "a", "start_time": float("inf"), "end_time": float("inf")},
                {"word": "b", "start_time": 2.0, "end_time": 1e308},
                {"word": "c", "start_time": float("nan"), "end_time": -5},
            ],
        }
    ]
    for look_id in LOOKS:
        rows = [e for e in ass_events(write(look_id, lines=odd)) if e.kind == "lyric"]
        assert "".join(e.plain for e in rows).replace(" ", "").casefold() == "abc"


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_what_starts_with_the_song_is_there_from_the_first_frame(look_id):
    """A video does not open on an empty frame: the title card of a song with an intro, or the
    first lines of one without, are solid at 0:00 instead of fading in."""
    card = [e for e in ass_events(write(look_id)) if e.kind == "title" and e.start == 0]
    assert card
    for event in card:
        fade = event.numbers("fade")
        assert not fade or fade[0] == fade[1], event.text
    assert all(not e.numbers("move") for e in card)

    shift = LINES[0]["start_time"] - 1.0
    early = [
        {
            **line,
            "singer": "singer1",
            "start_time": line["start_time"] - shift,
            "end_time": line["end_time"] - shift,
            "words": [
                {**w, "start_time": w["start_time"] - shift, "end_time": w["end_time"] - shift}
                for w in line["words"]
            ],
        }
        for line in LINES[:3]
    ]
    opening = [e for e in ass_events(write(look_id, lines=early)) if e.start == 0 and e.line == 0]
    assert opening, "the first line shows from 0:00"
    for event in opening:
        fade = event.numbers("fade")
        assert not fade or fade[0] == fade[1], event.text
        assert not event.numbers("move"), event.text


@pytest.mark.parametrize(("look_id", "aspect"), EVERY_LOOK)
def test_a_very_long_line_takes_more_rows_and_stays_in_the_frame(look_id, aspect):
    """The old stage wrapped a line of any length. A line far too long for its box takes
    more rows than the look asks for, instead of running off the frame."""
    from backend.services import font_metrics as metrics
    from backend.services.stage_layout import line_text

    words = [f"word{n}" for n in range(50)]
    long_line = [
        {
            "text": " ".join(words),
            "start_time": 1.0,
            "end_time": 21.0,
            "words": [
                {"word": w, "start_time": 1.0 + 0.4 * n, "end_time": 1.3 + 0.4 * n}
                for n, w in enumerate(words)
            ],
        }
    ]
    style = LookStyle.of(look_id, aspect)
    rows = [e for e in ass_events(write(look_id, aspect, lines=long_line)) if e.kind == "lyric"]
    drawn = " ".join(e.plain.strip() for e in rows).casefold().split()
    assert drawn == [w.casefold() for w in line_text(long_line[0]).tokens]
    assert len(rows) > style.spec["lyric"].get("rows", 1)
    for row in rows:
        size = float(re.search(r"\\fs([\d.]+)", row.tags).group(1))
        squeeze = re.search(r"\\fscx([\d.]+)", row.tags)
        face = metrics.face(row.style)
        em = size / face["ass_size"]
        width = metrics.text_width(row.style, row.plain.strip()) * em
        width *= float(squeeze.group(1)) / 100 if squeeze else 1.0
        assert width <= style.spec["lyric"]["measure"] * style.u + 1, row.plain
