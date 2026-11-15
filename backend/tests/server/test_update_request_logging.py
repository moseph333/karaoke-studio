"""A forced update leaves a line in the log saying who asked for it and which versions it
moves between."""

import logging

from fastapi.testclient import TestClient

from backend import config
from backend.main import app


def test_an_update_request_is_logged_with_the_client(auth_headers, monkeypatch, caplog):
    monkeypatch.setattr(
        config,
        "trigger_system_update",
        lambda: {"status": "updating", "version": "v2.7.0", "latest_version": "v2.7.1"},
    )
    caplog.set_level(logging.INFO, logger="karaoke_backend")
    script = TestClient(app, headers={**auth_headers, "X-Forwarded-For": "192.0.2.44"})

    assert script.post("/api/system/update", json={"action": "update"}).status_code == 200

    assert "Update requested from 192.0.2.44" in caplog.text
    assert "Update trigger written for 192.0.2.44: v2.7.0 -> v2.7.1" in caplog.text
