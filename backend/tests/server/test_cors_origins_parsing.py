"""ALLOWED_ORIGINS never lets every website read the API with a visitor's session."""

import logging

from backend.config import DEFAULT_ALLOWED_ORIGINS, parse_allowed_origins


def test_unset_gives_the_local_dev_origins():
    assert parse_allowed_origins(None) == DEFAULT_ALLOWED_ORIGINS
    assert parse_allowed_origins("  ") == DEFAULT_ALLOWED_ORIGINS


def test_listed_origins_are_kept():
    assert parse_allowed_origins("https://a.example, https://b.example") == [
        "https://a.example",
        "https://b.example",
    ]


def test_a_wildcard_is_dropped_with_a_warning(caplog):
    caplog.set_level(logging.WARNING, logger="karaoke_backend")
    assert parse_allowed_origins("*, https://studio.example") == ["https://studio.example"]
    assert parse_allowed_origins("*") == []
    assert "ALLOWED_ORIGINS contains '*'" in caplog.text
