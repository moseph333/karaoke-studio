"""A render request's style_config cannot inject text into the subtitle file: only its numbers
and colours are read, each made safe, and what it once set about the drawing is ignored."""

import pytest

from backend.services.ass_generator import generate_ass_content
from backend.services.ass_style import clean_style_config
from backend.tests.helpers.ass_script import parse_ass

LINE = [{"text": "Hello", "start_time": 1.0, "end_time": 2.0}]


def test_numbers_are_clamped_to_sane_ranges():
    cleaned = clean_style_config(
        {"font_size_scale": 99, "semitones": -40, "width": 10**9, "height": 1}
    )
    assert cleaned == {"font_size_scale": 5, "semitones": -12, "width": 4096, "height": 16}


@pytest.mark.parametrize("bad", ["big", float("nan"), float("inf"), None, True, [1], {"a": 1}])
def test_a_number_that_is_not_one_is_left_out(bad):
    assert "font_size_scale" not in clean_style_config({"font_size_scale": bad})


def test_numeric_text_is_read_and_whole_values_stay_whole():
    cleaned = clean_style_config({"font_size_scale": "1.5", "semitones": "3", "width": 720.0})
    assert cleaned == {"font_size_scale": 1.5, "semitones": 3, "width": 720}
    assert isinstance(cleaned["semitones"], int)


def test_anything_that_is_not_a_mapping_cleans_to_nothing():
    for value in (None, "theme", 7, [("font_size_scale", 2)]):
        assert clean_style_config(value) == {}  # type: ignore[arg-type]


def test_cleaning_does_not_change_the_request():
    request = {"font_size_scale": 99, "theme_id": "ktv"}
    clean_style_config(request)
    assert request == {"font_size_scale": 99, "theme_id": "ktv"}


INJECTIONS = [
    "Arial,99,&H00FFFFFF\nDialogue: 0,0:00:00.00,0:00:09.00,x,,0,0,0,,{\\fs300}OWNED",
    "x\n[Fonts]\nfontname: evil.ttf",
    "{\\p1}m 0 0 l 9999 0",
]


@pytest.mark.parametrize("payload", INJECTIONS)
@pytest.mark.parametrize(
    "field",
    [
        "font_name",
        "outline_color",
        "shadow_color",
        "primary_color",
        "secondary_color",
        "singer2_color",
        "both_color",
        "theme_id",
        "sync_mode",
        "aspect_ratio",
        "chord_color",
        "key",
    ],
)
def test_text_in_a_style_config_never_reaches_the_file(field, payload):
    clean = generate_ass_content(LINE, title="Song", theme_id="ktv")
    text = generate_ass_content(LINE, title="Song", theme_id="ktv", style_config={field: payload})
    assert "OWNED" not in text and "evil.ttf" not in text and "9999" not in text
    assert parse_ass(text)["styles"] == parse_ass(clean)["styles"]
    assert text.count("\nDialogue:") == clean.count("\nDialogue:")


@pytest.mark.parametrize(
    "retired",
    [
        {"font_name": "Comic Sans MS"},
        {"font_size": 400},
        {"outline_width": 20, "shadow_width": 20},
        {"outline_color": "#ff0000", "shadow_color": "#00ff00"},
        {"margin_v_line1": 4096, "margin_v_line2": 0, "margin_v_countdown": 9, "margin_lr": 500},
        {"chord_alignment": 2, "margin_v_chord": 300},
        {"width": 4096, "height": 16},
    ],
)
def test_what_a_style_config_once_set_about_the_drawing_is_ignored(retired):
    """The look decides the typeface, sizes, outline and places now."""
    plain = generate_ass_content(LINE, title="Song", theme_id="ktv")
    assert generate_ass_content(LINE, title="Song", theme_id="ktv", style_config=retired) == plain


def test_a_title_cannot_start_a_section_of_its_own():
    text = generate_ass_content(LINE, title="Song\n[Fonts]\nfontname: evil.ttf")
    assert "\n[Fonts]" not in text
    assert parse_ass(text)["info"]["Title"] == "Song [Fonts] fontname: evil.ttf"
