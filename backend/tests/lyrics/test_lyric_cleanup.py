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


def test_a_crammed_run_at_the_end_is_dropped_but_not_a_whole_short_file():
    tail = [line(f"note {i}", 60 + i * 0.2, 60 + i * 0.2 + 0.15) for i in range(3)]
    song = [line("Sung line one", 10, 13), line("Sung line two", 14, 17)]
    assert [entry["text"] for entry in clean_fetched_lines(song + tail)] == [
        "Sung line one",
        "Sung line two",
    ]
    assert len(clean_fetched_lines(tail)) == 3


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
