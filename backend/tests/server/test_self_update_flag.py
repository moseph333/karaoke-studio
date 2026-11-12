"""SELF_UPDATE tells the studio whether a host service applies requested updates, so it only
offers "Update now" where the button can work."""

import pytest

from backend import config


def test_self_update_is_off_by_default():
    assert config.self_update_enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "YES", " on "])
def test_self_update_accepts_common_true_spellings(monkeypatch, value):
    monkeypatch.setenv("SELF_UPDATE", value)
    assert config.self_update_enabled() is True


@pytest.mark.parametrize("value", ["", "0", "false", "off", "maybe"])
def test_self_update_treats_anything_else_as_off(monkeypatch, value):
    monkeypatch.setenv("SELF_UPDATE", value)
    assert config.self_update_enabled() is False


def test_health_reports_the_flag(client, monkeypatch):
    assert client.get("/api/health").json()["self_update"] is False
    monkeypatch.setenv("SELF_UPDATE", "1")
    assert client.get("/api/health").json()["self_update"] is True
