"""A saved server setting changes what the code that reads its environment variable sees,
without a restart, and each reader parses it as it parses the variable."""

import pytest

from backend import config, server_settings
from backend.services import (
    album_tracks,
    alignment_config,
    remote_render,
    remote_separation,
    remote_song_loop,
    separation_presets,
    song_loops,
)
from backend.services.downloader import UnusableLink, refuse_unsuitable


def test_song_loop_models_and_the_default(monkeypatch):
    monkeypatch.setenv("SONG_LOOP_MODEL", "wan22")
    assert song_loops.offered_models() == ["wan22", "ltx"]
    assert song_loops.configured_model() == "wan22"

    server_settings.save({"SONG_LOOP_MODELS": "ltx"})

    assert song_loops.offered_models() == ["ltx"]
    assert song_loops.configured_model() == "ltx"
    assert [model["id"] for model in song_loops.capability()["models"]] == ["ltx"]

    server_settings.save({"SONG_LOOP_MODELS": "wan22,ltx", "SONG_LOOP_MODEL": "ltx"})

    assert song_loops.offered_models() == ["wan22", "ltx"]
    assert song_loops.configured_model() == "ltx"


def test_song_loops_on_and_off(monkeypatch):
    assert remote_song_loop.backend() is None

    server_settings.save({"SONG_LOOP_REMOTE": "modal"})
    assert remote_song_loop.backend() == "modal"

    monkeypatch.setenv("SONG_LOOP_REMOTE", "modal")
    server_settings.save({"SONG_LOOP_REMOTE": ""})
    assert remote_song_loop.backend() is None
    assert remote_song_loop.status()[0] is False


def test_the_default_stem_quality_and_the_cloud_gpu(monkeypatch):
    monkeypatch.setenv("SEPARATION_QUALITY", "fast")
    monkeypatch.setenv("SEPARATION_REMOTE", "modal")

    server_settings.save({"SEPARATION_QUALITY": "best", "SEPARATION_REMOTE": ""})

    assert separation_presets.configured_preset() == "best"
    assert separation_presets.remote_backend() is None


def test_cloud_rendering_and_the_warm_ups(monkeypatch):
    assert remote_render.backend() is None
    assert remote_render.prewarm_enabled() is True
    assert remote_separation.prewarm_enabled() is True

    server_settings.save(
        {"RENDER_REMOTE": "modal", "RENDER_REMOTE_PREWARM": "0", "SEPARATION_REMOTE_PREWARM": "0"}
    )

    assert remote_render.backend() == "modal"
    assert remote_render.prewarm_enabled() is False
    assert remote_separation.prewarm_enabled() is False


def test_the_lyric_timing_engine(monkeypatch):
    monkeypatch.setenv("ALIGNMENT_ENGINE", "dsp")

    server_settings.save({"ALIGNMENT_ENGINE": "ctc"})

    assert alignment_config.requested_engine() == "ctc"


def test_the_longest_song_and_album(monkeypatch):
    monkeypatch.setattr(config, "MAX_SONG_MINUTES", 60)
    monkeypatch.setattr(config, "MAX_ALBUM_MINUTES", 120)
    assert server_settings.max_song_minutes() == 60
    assert album_tracks.album_limit_seconds() == 7200

    server_settings.save({"MAX_SONG_MINUTES": "15", "MAX_ALBUM_MINUTES": "0"})

    assert server_settings.max_song_minutes() == 15
    assert server_settings.max_album_minutes() == 0
    assert album_tracks.album_limit_seconds() is None


def test_a_link_longer_than_the_saved_limit_is_refused_before_it_downloads():
    twenty_minutes = {"duration": 20 * 60, "title": "A long mix"}
    assert refuse_unsuitable(twenty_minutes) is None

    server_settings.save({"MAX_SONG_MINUTES": "15"})

    with pytest.raises(UnusableLink, match="longest this server downloads is 15 minutes"):
        refuse_unsuitable(twenty_minutes)


def test_the_song_search_catalogs(monkeypatch):
    monkeypatch.setattr(config, "SONG_SEARCH_SOURCES", ("deezer", "itunes", "suggest"))
    assert server_settings.song_search_sources() == ("deezer", "itunes", "suggest")

    server_settings.save({"SONG_SEARCH_SOURCES": "itunes"})
    assert server_settings.song_search_sources() == ("itunes",)

    server_settings.save({"SONG_SEARCH_SOURCES": "none"})
    assert server_settings.song_search_sources() == ()
