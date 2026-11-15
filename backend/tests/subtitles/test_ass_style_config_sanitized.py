"""A render request's style_config cannot inject lines or sections into the subtitle file,
and sizes it names are clamped before libass sees them."""

import pytest

from backend.services.ass_generator import AssStyle, clean_style_config


def _style(**config) -> AssStyle:
    return AssStyle.resolve(style_config=config)


def test_a_font_name_cannot_add_fields_or_lines():
    style = _style(font_name="Arial,99,&H00FFFFFF\n[Fonts]\nfontname: evil.ttf\\N{\\b1}")
    assert "\n" not in style.font_name
    assert "," not in style.font_name
    assert "{" not in style.font_name and "\\" not in style.font_name
    assert style.font_name.startswith("Arial99&H00FFFFFF")


def test_an_empty_or_odd_font_name_falls_back_to_the_default():
    assert _style(font_name=",,,\n").font_name == _style().font_name
    assert _style(font_name=["not", "text"]).font_name == _style().font_name
    assert len(_style(font_name="x" * 500).font_name) == 64


@pytest.mark.parametrize("field", ["outline_color", "shadow_color"])
def test_outline_and_shadow_colours_must_be_colours(field):
    style = _style(**{field: "&H00000000,0,0\n[Events]"})
    assert getattr(style, field) in ("&H00111111", "&H80000000")
    assert getattr(_style(**{field: "#ff0000"}), field) == "&H000000FF"


def test_huge_sizes_are_clamped():
    style = _style(font_size=10_000_000, width=1e9, height=-5, outline_width=1e6, margin_lr=1e12)
    assert style.width == 4096
    assert style.height == 16
    assert style.font_size <= 400
    assert style.outline_width == 20
    assert style.margin_lr == 4096


def test_values_that_are_not_numbers_use_the_defaults():
    defaults = _style()
    style = _style(font_size="big", width=float("nan"), semitones="up", chord_alignment=None)
    assert style.font_size == defaults.font_size
    assert style.width == defaults.width
    assert style.semitones == 0


def test_numbers_given_as_text_still_count():
    assert clean_style_config({"font_size": "60", "font_size_scale": "1.5"}) == {
        "font_size": 60,
        "font_size_scale": 1.5,
    }
    assert clean_style_config({"outline_width": 5.0})["outline_width"] == 5


def test_other_fields_pass_through_untouched():
    assert clean_style_config({"theme_id": "neon", "include_chords": True}) == {
        "theme_id": "neon",
        "include_chords": True,
    }
    assert clean_style_config(None) == {}
