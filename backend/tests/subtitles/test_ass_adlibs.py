"""Words sung in parentheses (backing vocals, ad-lib) are smaller, italic and faded in the
exported subtitles, and found the same way as on the stage."""

from backend.services.ass_generator import ADLIB_OFF, ADLIB_ON, generate_ass_content
from backend.services.lyric_tokenize import adlib_flags
from backend.shared_assets import load


def timed_line(text: str, start: float, singer: str = "singer1") -> dict:
    words = text.split()
    return {
        "id": 0,
        "text": text,
        "start_time": start,
        "end_time": start + 0.5 * len(words),
        "singer": singer,
        "words": [
            {"word": w, "start_time": start + 0.5 * i, "end_time": start + 0.5 * (i + 1)}
            for i, w in enumerate(words)
        ],
    }


def dialogue_texts(ass: str) -> list[str]:
    return [line.split(",", 9)[9] for line in ass.splitlines() if line.startswith("Dialogue: 0,")]


def test_the_shared_cases_match():
    for case in load("adlib_cases"):
        assert adlib_flags(case["words"]) == case["adlib"], case["words"]


def test_an_ad_lib_at_the_end_of_a_line_is_styled_and_the_style_ends_with_it():
    ass = generate_ass_content([timed_line("Interjection over introspection, (hmm?) yes", 10)])
    (text,) = dialogue_texts(ass)
    before, after = text.split(ADLIB_ON)
    assert "(hmm?)" not in before
    assert after.index("(hmm?)") < after.index(ADLIB_OFF) < after.index("yes")


def test_a_backing_line_is_styled_throughout_and_keeps_its_singer_style():
    ass = generate_ass_content([timed_line("(It's the laser sharks)", 5, singer="singer2")])
    dialogue = next(line for line in ass.splitlines() if line.startswith("Dialogue: 0,"))
    assert "KaraokeLine1_Singer2" in dialogue
    text = dialogue.split(",", 9)[9]
    assert text.count(ADLIB_ON) == 1 and ADLIB_OFF not in text
    assert text.index(ADLIB_ON) < text.index("(It's")


def test_a_line_without_parentheses_is_unchanged():
    (text,) = dialogue_texts(generate_ass_content([timed_line("Lasers from the dark", 1)]))
    assert ADLIB_ON not in text and ADLIB_OFF not in text


def test_line_sync_mode_styles_ad_libs_too():
    ass = generate_ass_content(
        [timed_line("Come on (yeah) now", 1)], style_config={"sync_mode": "line"}
    )
    (text,) = dialogue_texts(ass)
    assert f"{ADLIB_ON}(yeah) {ADLIB_OFF}now" in text
