"""Fetched lyric files lose the text uploaders add that is never sung: translation blocks,
translator's notes and "x2" repeat markers."""

from backend.services.lyric_cleanup import clean_fetched_lines, is_annotation
from backend.services.lyrics import LyricsService
from backend.tests.helpers.lrclib_listings import LASER_SHARKS_ALL_CAPS, LASER_SHARKS_CLEAN


def line(text: str, start: float, end: float) -> dict:
    words = text.split()
    step = (end - start) / max(1, len(words))
    return {
        "id": 0,
        "text": text,
        "start_time": start,
        "end_time": end,
        "words": [
            {"word": w, "start_time": start + i * step, "end_time": start + (i + 1) * step}
            for i, w in enumerate(words)
        ],
    }


def test_the_translation_after_laser_sharks_is_dropped():
    lines = clean_fetched_lines(LyricsService.parse_lrc(LASER_SHARKS_ALL_CAPS["syncedLyrics"]))
    texts = [entry["text"] for entry in lines]
    assert texts[-1] == "Wareware wa katsu"
    assert not any("Translation" in t or "Happy" in t for t in texts)
    assert [entry["id"] for entry in lines] == list(range(len(lines)))


def test_repeat_markers_come_off_the_text_and_the_words():
    lines = clean_fetched_lines(LyricsService.parse_lrc(LASER_SHARKS_ALL_CAPS["syncedLyrics"]))
    same = next(entry for entry in lines if entry["text"].startswith("Shiawasena same same"))
    assert same["text"] == "Shiawasena same same"
    assert [w["word"] for w in same["words"]] == ["Shiawasena", "same", "same"]


def test_a_clean_file_keeps_every_sung_line():
    parsed = LyricsService.parse_lrc(LASER_SHARKS_CLEAN["syncedLyrics"])
    # Japanese lines keep their romanization apart, as romaji
    assert [
        f"{entry['text']} ({entry['romaji']})" if entry.get("romaji") else entry["text"]
        for entry in clean_fetched_lines(parsed)
    ] == [entry["text"] for entry in parsed]


def test_a_note_inside_a_line_is_cut_out():
    cleaned = clean_fetched_lines(
        [line("Then, we fought back. (This is phrased in present tense Japanese)", 1, 3)]
    )
    assert cleaned[0]["text"] == "Then, we fought back."
    assert len(cleaned[0]["words"]) == 4


def test_a_note_in_the_middle_of_a_line_leaves_the_words_after_it():
    noted = line("Kimi (Note: an informal word for you) wa doko", 1, 10)
    (cleaned,) = clean_fetched_lines([noted])
    assert cleaned["text"] == "Kimi wa doko"
    assert [w["word"] for w in cleaned["words"]] == ["Kimi", "wa", "doko"]
    # each word keeps its own timing: the last two were the line's eighth and ninth
    assert [w["start_time"] for w in cleaned["words"]] == [1, 8, 9]


def test_a_repeat_marker_after_a_japanese_line_leaves_every_character():
    (parsed,) = LyricsService.parse_lrc("[00:01.00]幸せなサメ x2\n[00:05.00]\n")
    (cleaned,) = clean_fetched_lines([parsed])
    assert cleaned["text"] == "幸せなサメ"
    assert [w["word"] for w in cleaned["words"]] == list("幸せなサメ")
    assert cleaned["words"] == parsed["words"][:5]


def test_words_that_do_not_follow_the_text_are_spread_over_the_cleaned_line():
    noted = {**line("La la la x2", 2, 6), "words": [{"word": "other", "start_time": 2}]}
    (cleaned,) = clean_fetched_lines([noted])
    assert [w["word"] for w in cleaned["words"]] == ["La", "la", "la"]
    assert cleaned["words"][0]["start_time"] == 2 and cleaned["words"][-1]["end_time"] == 6


def test_sung_parentheses_and_short_lines_stay():
    lines = [
        line("Mutants from outer space", 10, 12),
        line("(It's the laser sharks)", 13, 15),
        line("(Oh)", 16, 16.3),
    ]
    assert [entry["text"] for entry in clean_fetched_lines(lines)] == [
        "Mutants from outer space",
        "(It's the laser sharks)",
        "(Oh)",
    ]


def test_a_name_ending_in_x_and_a_number_is_not_a_repeat_marker():
    lines = [
        line("We're live on Channel X5", 10, 13),
        line("He drives a BMW X5", 14, 17),
        line("La la la x2", 18, 21),
        line("La la la (X2)", 22, 25),
        line("LA LA LA X2", 26, 29),
        line("Na na na 2x", 30, 33),
    ]
    assert [entry["text"] for entry in clean_fetched_lines(lines)] == [
        "We're live on Channel X5",
        "He drives a BMW X5",
        "La la la",
        "La la la",
        "LA LA LA",
        "Na na na",
    ]
    flags = LyricsService.lyric_quality
    assert "repeat_markers" not in flags("Intro\nWe're live on Channel X5")[1]
    assert "repeat_markers" in flags("Intro\nLa la la x2")[1]


def test_a_sung_line_in_parentheses_is_not_a_translators_note():
    for sung in (
        "(this is the rhythm of the night)",
        "Oh yeah (this is how we do it every night)",
        "(I'm literally dying over here tonight)",
        "(originally I thought that you were mine)",
    ):
        assert not is_annotation(sung)
        assert [entry["text"] for entry in clean_fetched_lines([line(sung, 1, 4)])] == [sung]
    for note in (
        "Went away (This is phrased in present tense Japanese)",
        "Sora (literally means the sky above us all)",
        "Kimi (Note: an informal word for you)",
        "Yoru (translator: night, or evening here)",
    ):
        assert is_annotation(note)


def test_a_crammed_run_at_the_end_is_dropped_but_not_a_whole_short_file():
    tail = [line(f"note {i}", 60 + i * 0.2, 60 + i * 0.2 + 0.15) for i in range(3)]
    song = [line("Sung line one", 10, 13), line("Sung line two", 14, 17)]
    assert [entry["text"] for entry in clean_fetched_lines(song + tail)] == [
        "Sung line one",
        "Sung line two",
    ]
    assert len(clean_fetched_lines(tail)) == 3


def test_a_crammed_run_is_dropped_from_a_file_without_a_closing_timestamp():
    lrc = (
        "[00:10.00]Sung line one\n"
        "[00:14.00]Sung line two\n"
        "[00:20.00]Sung line three\n"
        "[01:00.00]Translated line one\n"
        "[01:00.20]Translated line two\n"
        "[01:00.40]Translated line three\n"
    )
    parsed = LyricsService.parse_lrc(lrc)
    assert parsed[-1]["end_time"] - parsed[-1]["start_time"] >= 2.5  # no stamp ends it
    assert [entry["text"] for entry in clean_fetched_lines(parsed)] == [
        "Sung line one",
        "Sung line two",
        "Sung line three",
    ]
    # a last line sung right after a quick one is no run
    quick = [line("Sung line one", 10, 13), line("Hey", 14, 14.3), line("Last line", 14.3, 17)]
    assert len(clean_fetched_lines(quick)) == 3


def test_annotation_detection():
    assert is_annotation("Translation Japanese:")
    assert is_annotation('Japan went to space. (Space could mean "empty space" or "outer space")')
    assert not is_annotation("(Shiawase na same, same)")
    assert not is_annotation("English girls are pretty: yeah")


def test_fetch_lyrics_returns_cleaned_lines(monkeypatch):
    import backend.services.lyrics as lyrics_mod

    monkeypatch.setattr(lyrics_mod.syncedlyrics, "search", lambda *a, **k: None)  # no NetEase
    service = LyricsService()
    raw = LyricsService.parse_lrc(LASER_SHARKS_ALL_CAPS["syncedLyrics"])
    monkeypatch.setattr(
        service,
        "_fetch_from_lrclib",
        lambda *a, **k: {"source": "lrclib", "synced": True, "lines": raw, "lrc": "x"},
    )
    result = service.fetch_lyrics("Laser Sharks", "Savant", 244)
    assert result["lrc"] == "x"
    assert result["lines"][-1]["text"] == "Wareware wa katsu"
