"""Deleting a song leaves a line in the log saying which one."""

import logging

from backend.main import projects


def test_a_deleted_song_is_logged(client, caplog):
    projects["gone01"] = {
        "id": "gone01",
        "track_id": "gone01",
        "title": "Last Call",
        "artist": "The Leavers",
        "status": "ready",
        "lines": [],
    }
    caplog.set_level(logging.INFO, logger="karaoke_backend")
    assert client.delete("/api/project/gone01").status_code == 200
    assert "Deleted song gone01 (The Leavers - Last Call)" in caplog.text
