"""The saved server settings: a file in the data folder laid over the environment, written in
one step, read once, and recovered from its backup when it is damaged."""

import json

import pytest

from backend import config, project_store, server_settings


def settings_path():
    return config.DATA_DIR / "settings.json"


def test_without_a_saved_value_the_environment_answers(monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")
    monkeypatch.delenv("SONG_LOOP_MODELS", raising=False)

    assert server_settings.saved() == {}
    assert server_settings.env("SONG_LOOP_MODEL") == "wan22"
    assert server_settings.env("SONG_LOOP_MODELS") is None
    assert server_settings.env("SONG_LOOP_MODELS", "all") == "all"
    assert not settings_path().exists()


def test_a_saved_value_wins_over_the_environment_at_once(monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")

    server_settings.save({"SONG_LOOP_MODEL": "ltx"})

    assert server_settings.env("SONG_LOOP_MODEL") == "ltx"
    assert json.loads(settings_path().read_text()) == {
        "version": 1,
        "env": {"SONG_LOOP_MODEL": "ltx"},
    }


def test_an_empty_saved_value_counts_as_one(monkeypatch):
    """That is how "off" is saved for an option whose variable turns something on."""
    monkeypatch.setenv("RENDER_REMOTE", "modal")

    server_settings.save({"RENDER_REMOTE": ""})

    assert server_settings.env("RENDER_REMOTE") == ""
    assert server_settings.env("RENDER_REMOTE", "modal") == ""


def test_removing_a_saved_value_puts_the_environment_back(monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")
    server_settings.save({"SONG_LOOP_MODEL": "ltx", "RENDER_REMOTE": ""})

    server_settings.save({"RENDER_REMOTE": ""})

    assert server_settings.env("SONG_LOOP_MODEL") == "wan22"
    assert server_settings.saved() == {"RENDER_REMOTE": ""}


def test_saved_values_are_read_again_after_a_restart():
    server_settings.save({"SONG_LOOP_MODELS": "ltx"})

    server_settings.reset_cache()

    assert server_settings.saved() == {"SONG_LOOP_MODELS": "ltx"}


def test_the_file_is_read_once_not_on_every_call():
    server_settings.save({"SONG_LOOP_MODELS": "ltx"})
    settings_path().write_text(json.dumps({"version": 1, "env": {"SONG_LOOP_MODELS": "wan22"}}))

    assert server_settings.env("SONG_LOOP_MODELS") == "ltx"


def test_what_saved_returns_is_a_copy():
    server_settings.save({"SONG_LOOP_MODELS": "ltx"})

    server_settings.saved()["SONG_LOOP_MODELS"] = "wan22"

    assert server_settings.env("SONG_LOOP_MODELS") == "ltx"


def test_a_damaged_file_is_recovered_from_its_backup():
    server_settings.save({"SONG_LOOP_MODELS": "ltx"})
    server_settings.save({"SONG_LOOP_MODELS": "ltx", "SONG_LOOP_MODEL": "ltx"})
    backup = config.DATA_DIR / "settings.json.bak"
    assert json.loads(backup.read_text())["env"] == {"SONG_LOOP_MODELS": "ltx"}

    settings_path().write_text('{"version": 1, "env": {"SONG_LO')
    server_settings.reset_cache()

    assert server_settings.saved() == {"SONG_LOOP_MODELS": "ltx"}


@pytest.mark.parametrize(
    "content",
    ["", "not json", "[]", '{"version": 1}', '{"version": 1, "env": ["SONG_LOOP_MODELS"]}'],
)
def test_a_file_that_holds_no_settings_is_ignored(content, monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")
    settings_path().write_text(content)

    assert server_settings.saved() == {}
    assert server_settings.env("SONG_LOOP_MODEL") == "wan22"


def test_values_that_are_not_text_are_left_out():
    settings_path().write_text(
        json.dumps({"version": 1, "env": {"MAX_SONG_MINUTES": 30, "SONG_LOOP_MODEL": "ltx"}})
    )

    assert server_settings.saved() == {"SONG_LOOP_MODEL": "ltx"}


def test_a_full_disk_leaves_the_saved_values_as_they_were(monkeypatch):
    server_settings.save({"SONG_LOOP_MODELS": "ltx"})

    def disk_full(src, dst):
        raise OSError(28, "No space left on device")

    with monkeypatch.context() as patch:
        patch.setattr(project_store.os, "replace", disk_full)
        with pytest.raises(OSError):
            server_settings.save({"SONG_LOOP_MODELS": "wan22"})

    assert server_settings.env("SONG_LOOP_MODELS") == "ltx"
    assert json.loads(settings_path().read_text())["env"] == {"SONG_LOOP_MODELS": "ltx"}
    assert sorted(path.name for path in config.DATA_DIR.glob(".settings.json.tmp.*")) == []


def test_each_data_folder_has_its_own_settings(tmp_path, monkeypatch):
    server_settings.save({"SONG_LOOP_MODELS": "ltx"})

    other = tmp_path / "another_server"
    other.mkdir()
    monkeypatch.setattr(config, "DATA_DIR", other)

    assert server_settings.saved() == {}


def test_importing_the_store_brings_in_nothing_from_the_app():
    """RoFormer's worker imports separation_presets, which imports the store, on a cloud GPU
    that has neither FastAPI nor the server's data folder."""
    import subprocess
    import sys

    code = (
        "import sys\n"
        "import backend.services.separation_presets\n"
        "loaded = [m for m in ('backend.config', 'backend.project_store', 'fastapi') "
        "if m in sys.modules]\n"
        "print(','.join(loaded))\n"
    )
    done = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)

    assert done.stdout.strip() == ""
