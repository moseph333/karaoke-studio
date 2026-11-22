"""Words sung in parentheses (backing vocals, ad-lib) are smaller and faded in the exported
subtitles (italic too in a look that has an italic), and found the same way as on the stage."""

from backend.services.ass_draw import LookStyle, adlib_tags
from backend.services.ass_generator import generate_ass_content
from backend.services.lyric_tokenize import adlib_flags
from backend.services.stage_looks import LOOKS
from backend.shared_assets import load
from backend.tests.helpers.ass_script import AssEvent, ass_events

# The two-row look writes a line as it is written (the default look writes it in capitals)
LOOK = "ktv"
ADLIB_ON, ADLIB_OFF = adlib_tags(LookStyle.of(LOOK), 1.0)


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


def lyric_rows(ass: str) -> list[AssEvent]:
    """The rows of the first line: one event each, top row first."""
    return [e for e in ass_events(ass) if e.role == "lyric:0"]


def dialogue_texts(ass: str) -> list[str]:
    return [e.text for e in lyric_rows(ass)]


def test_the_shared_cases_match():
    for case in load("adlib_cases"):
        assert adlib_flags(case["words"]) == case["adlib"], case["words"]


def test_the_ad_lib_tags_make_the_words_smaller_and_see_through_and_end_both():
    assert ADLIB_ON == "{\\fscx80\\fscy80\\1a&H40&\\2a&H40&\\3a&H40&}"
    assert ADLIB_OFF == "{\\fscx100\\fscy100\\1a&H00&\\2a&H00&\\3a&H00&}"


def test_an_ad_lib_at_the_end_of_a_line_is_styled_and_the_style_ends_with_it():
    ass = generate_ass_content(
        [timed_line("Interjection over introspection, (hmm?) yes", 10)], theme_id=LOOK
    )
    # The line takes two rows; the ad-lib is in the last and no row before it is styled
    *above, text = dialogue_texts(ass)
    assert all(ADLIB_ON not in row and ADLIB_OFF not in row for row in above)
    before, after = text.split(ADLIB_ON)
    assert "(hmm?)" not in before
    assert after.index("(hmm?)") < after.index(ADLIB_OFF) < after.index("yes")


def test_a_backing_line_is_styled_throughout_and_keeps_its_singer_colour():
    look = LookStyle.of(LOOK)
    backing = [timed_line("(It's the laser sharks)", 5, singer="singer2")]
    (row,) = lyric_rows(generate_ass_content(backing, theme_id=LOOK))
    sung, unsung = look.sweep_colors("singer2")
    assert row.tags.endswith(f"\\1c{sung}\\2c{unsung}")
    assert look.sweep_colors("singer2") != look.sweep_colors("singer1")
    text = row.text
    assert text.count(ADLIB_ON) == 1 and ADLIB_OFF not in text
    assert text.index(ADLIB_ON) < text.index("(It's")


def test_a_line_without_parentheses_is_unchanged():
    (text,) = dialogue_texts(
        generate_ass_content([timed_line("Lasers from the dark", 1)], theme_id=LOOK)
    )
    assert ADLIB_ON not in text and ADLIB_OFF not in text
    assert "\\fscy" not in text and "\\1a" not in text


def test_line_sync_mode_styles_ad_libs_too():
    ass = generate_ass_content(
        [timed_line("Come on (yeah) now", 1)],
        theme_id=LOOK,
        style_config={"sync_mode": "line"},
    )
    (text,) = dialogue_texts(ass)
    assert f"{ADLIB_ON}(yeah) {ADLIB_OFF}now" in text


def test_every_look_styles_an_ad_lib_with_its_own_tags():
    for look_id in LOOKS:
        on, off = adlib_tags(LookStyle.of(look_id), 1.0)
        ass = generate_ass_content([timed_line("Come on (yeah) now", 1)], theme_id=look_id)
        text = "".join(dialogue_texts(ass))
        assert text.count("\\fscy80") == 1 and text.count("\\fscy100") == 1, look_id
        assert text.index("\\fscy80") < text.casefold().index("(yeah)") < text.index("\\fscy100")
        assert ("\\i1" in on) == ("\\i1" in text) == bool(LOOKS[look_id]["adlib"].get("face"))
        assert ("\\i0" in off) == ("\\i0" in text)
