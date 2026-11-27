"""The Server settings page's API: what it shows for each setting, what it accepts, and that a
saved change is in force at once, survives a restart and can be handed back to the
environment."""

import json

import pytest

from backend import config, project_store, server_settings
from backend.services import admin_settings, remote_song_loop, separation_presets, song_loops

ADMIN = "owner-only-words"
URL = "/api/admin/settings"


@pytest.fixture
def owner(client, monkeypatch):
    """The studio's client, unlocked as the owner."""
    monkeypatch.setattr(config, "ADMIN_PASSWORD", ADMIN)
    client.headers["X-Admin-Password"] = ADMIN
    return client


def save(owner, **values):
    return owner.put(URL, json={"values": {key.replace("__", "."): v for key, v in values.items()}})


def shown(owner) -> dict:
    res = owner.get(URL)
    assert res.status_code == 200, res.text
    return res.json()["settings"]


# --- What the page shows ---


def test_every_setting_is_shown_with_its_value_and_what_the_environment_gives(owner):
    settings = shown(owner)

    assert list(settings) == list(admin_settings.definitions())
    assert len(settings) == 13
    for entry in settings.values():
        assert entry["overridden"] is False
        assert entry["value"] == entry["default"]
    assert settings["song_loop.enabled"]["value"] is False
    assert settings["song_loop.models"]["value"] == ["wan22", "ltx"]
    assert settings["song_loop.default_model"]["value"] == "wan22"
    assert settings["separation.presets"]["value"] == ["fast", "balanced", "best"]
    assert settings["separation.default"]["value"] == "fast"  # the test environment's
    assert settings["render.prewarm"]["value"] is True
    assert settings["limits.song_minutes"]["value"] == 60
    assert settings["search.sources"]["value"] == ["deezer", "itunes", "suggest"]
    assert settings["alignment.engine"]["value"] == "dsp"


def test_choices_and_sets_list_their_options(owner):
    settings = shown(owner)

    models = settings["song_loop.models"]["options"]
    assert [option["id"] for option in models] == ["wan22", "ltx"]
    assert [option["label"] for option in models] == ["Best", "Fast"]
    assert "Wan 2.2" in models[0]["note"] and "8 minutes" in models[0]["note"]
    # A default is picked among its set's options
    assert settings["song_loop.default_model"]["options"] == models
    assert [o["id"] for o in settings["separation.default"]["options"]] == [
        "fast",
        "balanced",
        "best",
    ]
    assert [o["label"] for o in settings["alignment.engine"]["options"]] == [
        "Automatic",
        "Neural",
        "Signal only",
    ]
    assert "options" not in settings["render.cloud"]
    assert "options" not in settings["limits.song_minutes"]


def test_the_page_says_whether_the_cloud_can_be_asked(owner, monkeypatch):
    monkeypatch.setattr(separation_presets, "remote_status", lambda: (False, "no credentials"))
    assert owner.get(URL).json()["cloud"] == {"ready": False, "reason": "no credentials"}

    monkeypatch.setattr(separation_presets, "remote_status", lambda: (True, None))
    assert owner.get(URL).json()["cloud"] == {"ready": True, "reason": None}


def test_what_the_environment_gives_is_shown_beside_a_saved_value(owner, monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")

    res = save(owner, song_loop__default_model="ltx")

    entry = res.json()["settings"]["song_loop.default_model"]
    assert entry == {**entry, "value": "ltx", "default": "wan22", "overridden": True}


# --- The owner's example: the heavy video model off, the light one the default ---


def test_turning_the_heavy_video_model_off_and_the_light_one_into_the_default(owner):
    res = save(owner, song_loop__models=["ltx"], song_loop__default_model="ltx")

    assert res.status_code == 200, res.text
    settings = res.json()["settings"]
    assert settings["song_loop.models"]["value"] == ["ltx"]
    assert settings["song_loop.default_model"]["value"] == "ltx"
    # In force at once, for the studio and for the next loop
    assert song_loops.offered_models() == ["ltx"]
    assert song_loops.configured_model() == "ltx"
    capability = owner.get("/api/capabilities").json()["song_loop"]
    assert [model["id"] for model in capability["models"]] == ["ltx"]
    assert capability["model"] == "ltx"
    assert json.loads((config.DATA_DIR / "settings.json").read_text())["env"] == {
        "SONG_LOOP_MODEL": "ltx",
        "SONG_LOOP_MODELS": "ltx",
    }


def test_a_loop_with_a_model_that_was_turned_off_is_refused(owner, monkeypatch):
    from backend.main import projects

    monkeypatch.setenv("SONG_LOOP_REMOTE", "modal")
    # The cloud can be asked, whatever credentials the machine running the tests has
    monkeypatch.setattr(remote_song_loop, "remote_status", lambda: (True, None))
    projects["p1"] = {"id": "p1", "status": "ready", "title": "Song", "lines": [{"text": "la"}]}
    save(owner, song_loop__models=["ltx"])

    res = owner.post("/api/project/p1/song-loop", json={"model": "wan22"})

    assert res.status_code == 400
    assert "wan22" in res.json()["detail"]


def test_the_default_follows_when_only_the_offered_models_change(owner, monkeypatch):
    """Nothing is saved for the default, so the code that reads it settles on an offered one."""
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")

    res = save(owner, song_loop__models=["ltx"])

    assert res.status_code == 200
    assert res.json()["settings"]["song_loop.default_model"]["value"] == "ltx"


# --- Each kind of setting ---


def test_switches(owner):
    res = save(
        owner,
        song_loop__enabled=True,
        separation__cloud=True,
        render__cloud=True,
        render__prewarm=False,
        separation__prewarm=False,
    )

    assert res.status_code == 200
    assert server_settings.saved() == {
        "SONG_LOOP_REMOTE": "modal",
        "SEPARATION_REMOTE": "modal",
        "RENDER_REMOTE": "modal",
        "RENDER_REMOTE_PREWARM": "0",
        "SEPARATION_REMOTE_PREWARM": "0",
    }
    settings = res.json()["settings"]
    assert settings["song_loop.enabled"]["value"] is True
    assert settings["render.prewarm"]["value"] is False


def test_a_switch_turns_off_what_the_environment_turned_on(owner, monkeypatch):
    monkeypatch.setenv("RENDER_REMOTE", "modal")
    assert shown(owner)["render.cloud"]["value"] is True

    entry = save(owner, render__cloud=False).json()["settings"]["render.cloud"]

    assert entry == {"value": False, "default": True, "overridden": True}


def test_presets_offered_and_the_default_quality(owner):
    res = save(owner, separation__presets=["balanced", "fast"], separation__default="balanced")

    assert res.status_code == 200
    assert server_settings.saved() == {
        "SEPARATION_PRESETS": "fast,balanced",
        "SEPARATION_QUALITY": "balanced",
    }
    capabilities = owner.get("/api/capabilities").json()["separation"]
    assert [preset["id"] for preset in capabilities["presets"]] == ["fast", "balanced"]
    assert capabilities["default"] == "balanced"


def test_limits_and_the_song_search(owner):
    res = save(
        owner,
        limits__song_minutes=15,
        limits__album_minutes=0,
        search__sources=["itunes"],
        alignment__engine="auto",
    )

    assert res.status_code == 200
    assert server_settings.max_song_minutes() == 15
    assert server_settings.max_album_minutes() == 0
    assert server_settings.song_search_sources() == ("itunes",)
    settings = res.json()["settings"]
    assert settings["limits.song_minutes"] == {"value": 15, "default": 60, "overridden": True}
    assert settings["alignment.engine"]["value"] == "auto"


def test_the_song_search_can_be_turned_off_altogether(owner):
    res = save(owner, search__sources=[])

    assert res.status_code == 200
    assert server_settings.saved() == {"SONG_SEARCH_SOURCES": "none"}
    assert res.json()["settings"]["search.sources"]["value"] == []


# --- Handing a setting back to the environment ---


def test_resetting_a_setting_hands_it_back_to_the_environment(owner, monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODELS", "wan22")
    save(owner, song_loop__models=["ltx"], render__prewarm=False)

    res = save(owner, song_loop__models=None)

    settings = res.json()["settings"]
    assert settings["song_loop.models"] == {
        **settings["song_loop.models"],
        "value": ["wan22"],
        "overridden": False,
    }
    assert settings["render.prewarm"]["overridden"] is True
    assert server_settings.saved() == {"RENDER_REMOTE_PREWARM": "0"}


def test_resetting_a_setting_that_was_never_saved_changes_nothing(owner):
    res = save(owner, render__cloud=None)

    assert res.status_code == 200
    assert server_settings.saved() == {}


def test_saved_settings_survive_a_restart(owner):
    save(owner, song_loop__models=["ltx"], limits__song_minutes=15)

    server_settings.reset_cache()

    settings = shown(owner)
    assert settings["song_loop.models"]["value"] == ["ltx"]
    assert settings["limits.song_minutes"]["value"] == 15


# --- What the page refuses ---


@pytest.mark.parametrize(
    ("values", "sentence"),
    [
        ({"song_loop.models": []}, "Video models offered: keep at least one on."),
        ({"song_loop.models": ["sora"]}, "Video models offered: choose among Best, Fast."),
        ({"song_loop.models": "ltx"}, "Video models offered: choose among Best, Fast."),
        ({"song_loop.default_model": "sora"}, "Default video model: choose one of Best, Fast."),
        (
            {"separation.presets": ["balanced", "best"]},
            "Presets offered: Fast cannot be turned off.",
        ),
        ({"separation.default": "ultra"}, "Default for new songs: choose one of Fast, Balanced"),
        ({"render.cloud": "yes"}, "Render videos in the cloud: choose on or off."),
        ({"render.prewarm": 1}, "Start a cloud machine when Export opens: choose on or off."),
        (
            {"limits.song_minutes": -1},
            "Longest song, in minutes: enter a whole number from 0 to 600",
        ),
        (
            {"limits.song_minutes": 601},
            "Longest song, in minutes: enter a whole number from 0 to 600",
        ),
        ({"limits.song_minutes": 12.5}, "Longest song, in minutes: enter a whole number"),
        ({"limits.song_minutes": "15"}, "Longest song, in minutes: enter a whole number"),
        ({"limits.album_minutes": True}, "Longest album, in minutes: enter a whole number"),
        ({"search.sources": ["spotify"]}, "Song search: choose among Deezer, iTunes Store"),
        ({"alignment.engine": "whisper"}, "Lyric timing: choose one of Automatic, Neural"),
        ({"APP_PASSWORD": "open sesame"}, "This server has no setting called “APP_PASSWORD”."),
    ],
)
def test_a_value_a_setting_cannot_take_is_refused_in_a_sentence(owner, values, sentence):
    res = owner.put(URL, json={"values": values})

    assert res.status_code == 400
    assert res.json()["detail"].startswith(sentence)
    assert server_settings.saved() == {}


def test_a_default_must_be_one_of_those_offered(owner):
    turned_off = save(owner, song_loop__models=["ltx"], song_loop__default_model="wan22")
    assert turned_off.status_code == 400
    assert turned_off.json()["detail"] == (
        "Default video model: Best is turned off under “Video models offered”. "
        "Choose one that is offered."
    )

    quality = save(owner, separation__presets=["fast"], separation__default="best")
    assert quality.status_code == 400
    assert "Best is turned off under “Presets offered”" in quality.json()["detail"]
    assert server_settings.saved() == {}


def test_turning_off_the_saved_default_without_choosing_another_is_refused(owner):
    assert save(owner, song_loop__default_model="wan22").status_code == 200

    res = save(owner, song_loop__models=["ltx"])

    assert res.status_code == 400
    assert server_settings.saved() == {"SONG_LOOP_MODEL": "wan22"}


def test_one_bad_value_saves_none_of_the_changes(owner):
    res = save(owner, render__prewarm=False, limits__song_minutes=9999)

    assert res.status_code == 400
    assert server_settings.saved() == {}
    assert shown(owner)["render.prewarm"]["value"] is True


@pytest.mark.parametrize("body", [{}, {"values": None}, {"values": ["render.cloud"]}, []])
def test_a_request_of_the_wrong_shape_is_refused(owner, body):
    assert owner.put(URL, json=body).status_code == 422


def test_a_full_disk_says_so_and_keeps_the_settings_as_they_were(owner, monkeypatch):
    save(owner, limits__song_minutes=15)

    def disk_full(src, dst):
        raise OSError(28, "No space left on device")

    monkeypatch.setattr(project_store.os, "replace", disk_full)
    res = save(owner, limits__song_minutes=30)

    assert res.status_code == 507
    assert "not saved" in res.json()["detail"]
    assert server_settings.max_song_minutes() == 15


# --- The list the page and the server share ---


def test_every_listed_setting_has_a_reader_and_every_reader_a_listing():
    assert set(admin_settings.definitions()) == set(admin_settings.READERS)


def test_the_list_is_well_formed():
    settings = admin_settings.definitions()
    environment_variables = [setting["env"] for setting in settings.values()]

    assert len(set(environment_variables)) == len(environment_variables)
    for setting_id, setting in settings.items():
        assert setting["kind"] in ("flag", "choice", "set", "minutes"), setting_id
        assert setting["title"] and setting["text"], setting_id
        if setting["kind"] == "flag":
            assert setting["on"] != setting["off"], setting_id
        if setting["kind"] == "minutes":
            assert setting["max"] > 0, setting_id
        if setting["kind"] in ("choice", "set"):
            assert admin_settings.options(setting), setting_id
        if "among" in setting:
            assert settings[setting["among"]]["kind"] == "set", setting_id


def test_a_value_saved_through_the_page_reads_back_as_itself():
    """Each kind's text is what the code that reads the variable understands."""
    samples = {
        "song_loop.enabled": True,
        "song_loop.models": ["ltx"],
        "song_loop.default_model": "ltx",
        "separation.presets": ["fast", "best"],
        "separation.default": "best",
        "separation.cloud": True,
        "render.cloud": True,
        "render.prewarm": False,
        "separation.prewarm": False,
        "limits.song_minutes": 15,
        "limits.album_minutes": 45,
        "search.sources": ["deezer"],
        "alignment.engine": "ctc",
    }
    assert set(samples) == set(admin_settings.definitions())

    admin_settings.update(samples)

    assert {key: admin_settings.describe()["settings"][key]["value"] for key in samples} == samples
