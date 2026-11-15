"""An error no route handles is logged with its traceback and answered with JSON carrying
the request id, never with the exception's text."""

import logging

from fastapi.testclient import TestClient

import backend.main as main_mod


def test_an_unhandled_error_answers_json_and_is_logged(auth_headers, monkeypatch, caplog):
    def explode(*args, **kwargs):
        raise RuntimeError("secret /srv/data/internal detail")

    monkeypatch.setattr(main_mod.config, "check_for_updates", explode)
    caplog.set_level(logging.ERROR, logger="karaoke_backend")
    client = TestClient(main_mod.app, headers=auth_headers, raise_server_exceptions=False)

    res = client.get("/api/health", headers={"X-Request-ID": "boom-1"})

    assert res.status_code == 500
    assert res.json() == {"detail": "Internal server error", "request_id": "boom-1"}
    assert res.headers["X-Request-ID"] == "boom-1"
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert "/srv/data" not in res.text
    record = next(r for r in caplog.records if "Unhandled error" in r.getMessage())
    assert "GET /api/health [req=boom-1]" in record.getMessage()
    assert record.exc_info and record.exc_info[0] is RuntimeError
