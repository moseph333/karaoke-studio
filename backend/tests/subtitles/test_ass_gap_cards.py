"""Exported videos say what is happening between the lyrics: a marker that counts the seconds
of an instrumental gap and a closing title card through the outro."""

import itertools
import math

import pytest

from backend.services.ass_generator import (
    COUNTDOWN_LEAD_IN_SECONDS,
    GAP_LABEL_DELAY_SECONDS,
    export_title,
    generate_ass_content,
)
from backend.tests.helpers.ass_script import AssEvent, ass_events


def line(start: float, end: float, text: str = "words here") -> dict:
    return {
        "text": text,
        "start_time": start,
        "end_time": end,
        "words": [{"word": text, "start_time": start, "end_time": end}],
    }


# Metaphysical's shape: an intro, verses with long gaps, and a minute-long outro
SONG = [line(12.9, 17.0), line(39.9, 43.0), line(62.8, 65.7), line(138.9, 142.0)]


def events(ass: str, *kinds: str) -> list[AssEvent]:
    """The events of these kinds (break, countin, title, end), in time order."""
    return sorted((e for e in ass_events(ass) if e.kind in kinds), key=lambda e: e.start)


def test_the_intro_and_every_gap_count_the_seconds_until_the_count_in_takes_over():
    ass = generate_ass_content(SONG, title="A song")
    marks = events(ass, "break")
    title_ends = max(e.end for e in events(ass, "title"))
    previous_ends = [None, 17.0, 43.0, 65.7]
    counted = 0
    for song_line, previous_end in zip(SONG, previous_ends, strict=True):
        vocals_at = song_line["start_time"]
        run = [e for e in marks if (previous_end or 0.0) <= e.start < vocals_at]
        counted += len(run)
        # One event a second, each saying how many seconds are left when it appears
        assert [int(e.plain) for e in run] == [
            math.ceil(round(vocals_at - e.start, 2)) for e in run
        ]
        assert all(later.start == earlier.end for earlier, later in itertools.pairwise(run))
        assert run[-1].end == pytest.approx(vocals_at - COUNTDOWN_LEAD_IN_SECONDS)
        if previous_end is None:
            # The intro's marker waits for the opening title card
            assert title_ends <= run[0].start <= title_ends + 1.0
        else:
            assert run[0].start == pytest.approx(previous_end + GAP_LABEL_DELAY_SECONDS)
        cue = [e for e in events(ass, "countin") if e.line == SONG.index(song_line)]
        assert [e.plain for e in cue] == ["3", "2", "1"]
        assert cue[0].start == pytest.approx(run[-1].end)
        assert cue[-1].end == pytest.approx(vocals_at)
    assert counted == len(marks)
    # The markers sit on their own layer, apart from the lyric lines
    assert {e.layer for e in marks} == {1}
    assert {e.layer for e in ass_events(ass) if e.kind == "lyric"} == {0}


def test_short_gaps_get_no_marker():
    ass = generate_ass_content([line(0.5, 3.0), line(5.0, 7.0)])
    assert events(ass, "break", "countin") == []
    assert events(ass, "lyric")


def card_text(card: list[AssEvent], role: str) -> str:
    """What a card's rows of one role say, read as one line."""
    return " ".join(e.plain for e in card if e.role == role)


def test_the_outro_shows_the_title_until_the_song_ends():
    ass = generate_ass_content(
        SONG, title="Handsome Boy Modeling School - Metaphysical", song_duration=206.0
    )
    card = events(ass, "end")
    assert {(e.start, e.end) for e in card} == {(143.5, 206.0)}
    assert card_text(card, "end").casefold() == "handsome boy modeling school - metaphysical"


def test_the_outro_card_names_the_song_and_its_artist_when_they_are_given():
    ass = generate_ass_content(
        SONG,
        theme_id="ktv",
        title="Handsome Boy Modeling School - Metaphysical",
        card_title="Metaphysical",
        card_artist="Handsome Boy Modeling School",
        song_duration=206.0,
    )
    card = events(ass, "end")
    assert {(e.start, e.end) for e in card} == {(143.5, 206.0)}
    assert card_text(card, "end") == "Metaphysical"
    assert card_text(card, "end:artist") == "Handsome Boy Modeling School"


def test_no_outro_card_without_the_songs_length_or_room_for_it():
    assert events(generate_ass_content(SONG, title="A song"), "end") == []
    assert events(generate_ass_content(SONG, title="A song", song_duration=144.0), "end") == []
    assert events(generate_ass_content(SONG, title="A song", song_duration=146.5), "end")


def test_turning_the_countdown_off_keeps_the_cards():
    ass = generate_ass_content(SONG, title="A song", include_countdown=False, song_duration=206.0)
    assert events(ass, "break", "countin") == []
    assert events(ass, "title") and events(ass, "end")


def test_the_export_title_names_artist_and_song():
    assert export_title({"title": "Laser Sharks", "artist": "Savant"}) == "Savant - Laser Sharks"
    assert export_title({"title": "Laser Sharks"}) == "Laser Sharks"
    assert export_title({}) == "Karaoke Track"
