"""Failed requests tell the client what failed, not the exception's text (which carries
server paths and library internals); the text and traceback go to the log."""

import logging

import backend.main as main_mod


def test_a_failed_search_does_not_echo_the_exception(client, monkeypatch, caplog):
    def crash(query, limit=5):
        raise RuntimeError("yt-dlp blew up reading /srv/karaoke/workspace_data/cache")

    monkeypatch.setattr(main_mod.downloader, "search_tracks", crash)
    caplog.set_level(logging.ERROR, logger="karaoke_backend")
    res = client.post("/api/search", json={"query": "anything"})
    assert res.status_code == 500
    assert "/srv/karaoke" not in res.text
    assert "yt-dlp" not in res.text
    record = next(r for r in caplog.records if r.getMessage() == "Search failed")
    assert record.exc_info is not None


def test_a_failed_vocal_range_analysis_does_not_echo_the_exception(client, monkeypatch):
    import backend.routers.projects as projects_router

    def crash(*args, **kwargs):
        raise RuntimeError("librosa failed on /srv/karaoke/stems/x/vocals.wav")

    monkeypatch.setattr(projects_router, "ensure_vocal_range", crash)
    res = client.get("/api/project/any-song/vocal-range")
    assert res.status_code == 500
    assert "/srv/karaoke" not in res.text
    assert res.json()["detail"].startswith("Failed to analyze vocal range")
