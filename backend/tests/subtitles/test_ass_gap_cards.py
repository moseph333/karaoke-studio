"""Exported videos say what is happening between the lyrics: a label through instrumental
gaps and a closing title card through the outro."""

from backend.services.ass_generator import (
    GAP_LABEL_DELAY_SECONDS,
    export_title,
    format_ass_time,
    generate_ass_content,
)


def line(start: float, end: float, text: str = "words here") -> dict:
    return {
        "text": text,
        "start_time": start,
        "end_time": end,
        "words": [{"word": text, "start_time": start, "end_time": end}],
    }


# Metaphysical's shape: an intro, verses with long gaps, and a minute-long outro
SONG = [line(12.9, 17.0), line(39.9, 43.0), line(62.8, 65.7), line(138.9, 142.0)]


def events(ass: str, style: str) -> list[list[str]]:
    rows = [row.split(",", 9) for row in ass.splitlines() if row.startswith("Dialogue:")]
    return [row for row in rows if row[3] == style]


def test_the_intro_and_every_gap_get_a_label_that_ends_when_the_next_line_shows():
    ass = generate_ass_content(SONG)
    labels = events(ass, "GapLabel")
    assert [row[9] for row in labels] == ["♪ Instrumental Intro ♪"] + ["♪ Instrumental ♪"] * 3
    lyric_starts = [row[1] for row in events(ass, "KaraokeLine1") + events(ass, "KaraokeLine2")]
    assert all(row[2] in lyric_starts for row in labels)
    assert labels[1][1] == format_ass_time(17.0 + GAP_LABEL_DELAY_SECONDS)
    # Labels sit on their own layer, apart from the lyric lines
    assert {row[0] for row in labels} == {"Dialogue: 3"}


def test_short_gaps_get_no_label():
    assert events(generate_ass_content([line(0.5, 3.0), line(5.0, 7.0)]), "GapLabel") == []


def test_the_outro_shows_the_title_until_the_song_ends():
    ass = generate_ass_content(
        SONG, title="Handsome Boy Modeling School - Metaphysical", song_duration=206.0
    )
    (card,) = events(ass, "TitleCard")
    assert card[1] == format_ass_time(143.5)
    assert card[2] == format_ass_time(206.0)
    assert card[9].endswith("Handsome Boy Modeling School - Metaphysical")


def test_no_outro_card_without_the_songs_length_or_room_for_it():
    assert events(generate_ass_content(SONG), "TitleCard") == []
    assert events(generate_ass_content(SONG, song_duration=144.0), "TitleCard") == []


def test_turning_the_countdown_off_turns_the_cards_off():
    ass = generate_ass_content(SONG, include_countdown=False, song_duration=206.0)
    assert events(ass, "GapLabel") == [] and events(ass, "TitleCard") == []


def test_the_export_title_names_artist_and_song():
    assert export_title({"title": "Laser Sharks", "artist": "Savant"}) == "Savant - Laser Sharks"
    assert export_title({"title": "Laser Sharks"}) == "Laser Sharks"
    assert export_title({}) == "Karaoke Track"
