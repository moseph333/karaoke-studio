"""SEPARATION_PRESETS: the stem quality presets a server offers. One that is not offered is
left out of the studio's choices, refused when asked for, skipped as a fallback, never the
default, and a song that asked for it earlier runs the best preset still offered below it."""

import pytest
from pydantic import ValidationError

import backend.main as main_mod
from backend import server_settings
from backend.pipeline import project_preset
from backend.schemas import ReseparateRequest, parse_separation_quality
from backend.services import separation_presets as presets


def chain(preset: str) -> list[str]:
    return [plan.preset for plan in presets.fallback_chain(presets.preset_plan(preset))]


def test_every_preset_is_offered_unless_the_setting_names_some(monkeypatch):
    assert presets.offered_presets() == ("fast", "balanced", "best")

    monkeypatch.setenv("SEPARATION_PRESETS", " Balanced , fast ")
    assert presets.offered_presets() == ("fast", "balanced")

    monkeypatch.setenv("SEPARATION_PRESETS", "best")
    assert presets.offered_presets() == ("fast", "best")


def test_fast_is_always_offered(monkeypatch):
    """It is what the other presets fall back to, and the only one every server can run."""
    monkeypatch.setenv("SEPARATION_PRESETS", "balanced")
    assert presets.offered_presets() == ("fast", "balanced")

    monkeypatch.setenv("SEPARATION_PRESETS", "fast")
    assert presets.offered_presets() == ("fast",)


@pytest.mark.parametrize("value", ["", "  ", "studio", "ultra, studio", ","])
def test_a_setting_that_names_no_preset_offers_them_all(monkeypatch, value):
    monkeypatch.setenv("SEPARATION_PRESETS", value)

    assert presets.offered_presets() == ("fast", "balanced", "best")


def test_a_saved_setting_wins_over_the_environment(monkeypatch):
    monkeypatch.setenv("SEPARATION_PRESETS", "fast,balanced,best")

    server_settings.save({"SEPARATION_PRESETS": "fast,balanced"})

    assert presets.offered_presets() == ("fast", "balanced")


@pytest.mark.parametrize(
    ("offered", "default", "expected"),
    [
        ("fast,balanced,best", "best", "best"),
        ("fast,balanced", "best", "balanced"),
        ("fast", "best", "fast"),
        ("fast,best", "balanced", "fast"),
        ("fast,best", "best", "best"),
    ],
)
def test_the_default_is_always_a_preset_the_server_offers(monkeypatch, offered, default, expected):
    monkeypatch.setenv("SEPARATION_PRESETS", offered)
    monkeypatch.setenv("SEPARATION_QUALITY", default)

    assert presets.configured_preset() == expected


def test_a_preset_that_is_not_offered_is_skipped_as_a_fallback(monkeypatch):
    assert chain("best") == ["best", "balanced", "fast"]
    assert chain("balanced") == ["balanced", "fast"]
    assert chain("fast") == ["fast"]

    monkeypatch.setenv("SEPARATION_PRESETS", "fast,best")

    assert chain("best") == ["best", "fast"]


def test_a_song_that_asked_for_a_preset_no_longer_offered_runs_the_next_one_down(monkeypatch):
    monkeypatch.setenv("SEPARATION_QUALITY", "fast")
    song = {"id": "p1", "separation_quality": "best"}
    assert project_preset(song) == "best"

    monkeypatch.setenv("SEPARATION_PRESETS", "fast,balanced")
    assert project_preset(song) == "balanced"

    monkeypatch.setenv("SEPARATION_PRESETS", "fast")
    assert project_preset(song) == "fast"
    assert project_preset({"id": "p2"}) == "fast"


def test_the_studio_is_told_only_about_the_presets_offered(client, monkeypatch):
    monkeypatch.setenv("SEPARATION_PRESETS", "fast,balanced")
    monkeypatch.setenv("SEPARATION_QUALITY", "best")

    body = client.get("/api/capabilities").json()["separation"]

    assert [preset["id"] for preset in body["presets"]] == ["fast", "balanced"]
    assert body["default"] == "balanced"
    assert body["effective_default"] in ("fast", "balanced")


def test_asking_for_a_preset_that_is_not_offered_says_which_are(monkeypatch):
    monkeypatch.setenv("SEPARATION_PRESETS", "fast,balanced")

    assert parse_separation_quality(" Balanced ") == "balanced"
    assert parse_separation_quality("", optional=True) is None
    with pytest.raises(ValueError, match=r"does not offer Best stems\. Choose one of: fast"):
        parse_separation_quality("best")
    with pytest.raises(ValueError, match=r"must be one of: fast, balanced$"):
        parse_separation_quality("studio")


def test_a_new_song_cannot_ask_for_a_preset_that_is_not_offered(client, monkeypatch):
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *args, **kwargs: None)
    monkeypatch.setenv("SEPARATION_PRESETS", "fast,balanced")

    refused = client.post(
        "/api/process", json={"url_or_id": "dQw4w9WgXcQ", "separation_quality": "best"}
    )
    assert refused.status_code == 422
    assert "does not offer Best stems" in str(refused.json())
    assert "dQw4w9WgXcQ" not in main_mod.projects

    accepted = client.post(
        "/api/process", json={"url_or_id": "dQw4w9WgXcQ", "separation_quality": "balanced"}
    )
    assert accepted.status_code == 200


def test_an_upload_cannot_ask_for_a_preset_that_is_not_offered(client, monkeypatch):
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
    monkeypatch.setenv("SEPARATION_PRESETS", "fast")

    refused = client.post(
        "/api/upload-track",
        files={"file": ("song.wav", b"RIFF", "audio/wav")},
        data={"separation_quality": "balanced"},
    )

    assert refused.status_code == 400
    assert refused.json()["detail"] == (
        "This server does not offer Balanced stems. Choose one of: fast"
    )


def test_stems_cannot_be_remade_at_a_preset_that_is_not_offered(monkeypatch):
    assert ReseparateRequest(quality="best").quality == "best"

    monkeypatch.setenv("SEPARATION_PRESETS", "fast,balanced")

    with pytest.raises(ValidationError, match="does not offer Best stems"):
        ReseparateRequest(quality="best")
