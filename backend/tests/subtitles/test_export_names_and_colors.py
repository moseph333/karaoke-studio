"""The names an export shows and the colours it accepts from a request."""

import pytest

from backend.services.ass_document import to_css_color
from backend.services.ass_generator import card_names, export_title


@pytest.mark.parametrize(
    ("project", "expected"),
    [
        ({"title": "Song", "artist": "Band"}, ("Song", "Band")),
        ({"title": "  Two\n lines ", "artist": " The  Band "}, ("Two lines", "The Band")),
        ({"title": "Song", "artist": "Unknown Artist"}, ("Song", "")),
        ({"title": "Song", "artist": "unknown artist"}, ("Song", "")),
        ({"title": "Song", "artist": "Artist"}, ("Song", "")),
        ({"title": "Song"}, ("Song", "")),
        ({"artist": "Band"}, ("", "Band")),
        ({"title": None, "artist": None}, ("", "")),
        ({}, ("", "")),
    ],
)
def test_the_cards_show_the_title_and_a_real_artist(project, expected):
    assert card_names(project) == expected


def test_the_files_own_title_is_artist_then_title():
    assert export_title({"title": "Song", "artist": "Band"}) == "Band - Song"
    assert export_title({"title": "Song"}) == "Song"
    assert export_title({"artist": "Band"}) == "Band"
    assert export_title({}) == "Karaoke Track"


@pytest.mark.parametrize(
    ("given", "expected"),
    [
        ("#FFD21F", "#ffd21f"),
        ("ffd21f", "#ffd21f"),
        ("#abc", "#aabbcc"),
        (" #ABCDEF ", "#abcdef"),
        ("&H001FD2FF", "#ffd21f"),
        ("&H1FD2FF", "#ffd21f"),
        ("&H1FD2FF&", "#ffd21f"),
        ("&h801fd2ff", "#ffd21f"),
    ],
)
def test_a_colour_is_read_from_css_or_ass_and_given_as_css(given, expected):
    assert to_css_color(given) == expected


@pytest.mark.parametrize(
    "bad",
    [None, "", "  ", "red", "#12", "#12345", "#1234567", "&H", "&HGGGGGG", "&H12345", 123456,
     "#ffd21f;}", "{\\fs99}", ["#ffffff"]],
)  # fmt: skip
def test_anything_else_is_not_a_colour(bad):
    assert to_css_color(bad) is None
