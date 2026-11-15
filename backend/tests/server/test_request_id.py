"""Each request gets an id that tags the app's log lines and comes back in X-Request-ID."""

import logging

from backend.logging_setup import RequestIdFilter, request_id_var


def test_responses_carry_a_new_request_id(client):
    first = client.get("/api/health").headers["X-Request-ID"]
    second = client.get("/api/health").headers["X-Request-ID"]
    assert first and second and first != second


def test_a_well_formed_incoming_id_is_kept(client):
    res = client.get("/api/health", headers={"X-Request-ID": "edge-1234-abcd"})
    assert res.headers["X-Request-ID"] == "edge-1234-abcd"


def test_a_malformed_incoming_id_is_replaced(client):
    res = client.get("/api/health", headers={"X-Request-ID": "bad id\r\nX-Evil: 1"})
    assert res.headers["X-Request-ID"] != "bad id\r\nX-Evil: 1"
    assert " " not in res.headers["X-Request-ID"]


def test_a_401_carries_it_too(unauth_client):
    res = unauth_client.get("/api/projects")
    assert res.status_code == 401
    assert res.headers["X-Request-ID"]


def test_log_lines_written_during_a_request_carry_its_id(unauth_client, caplog):
    caplog.set_level(logging.WARNING, logger="karaoke_backend")
    caplog.handler.addFilter(RequestIdFilter())
    unauth_client.get(
        "/api/projects", headers={"X-Request-ID": "trace-77", "X-App-Password": "wrong"}
    )
    tagged = [r for r in caplog.records if "Rejected" in r.getMessage()]
    assert tagged and tagged[0].request_tag == " [req=trace-77]"


def test_outside_a_request_the_tag_is_empty():
    record = logging.LogRecord("karaoke_backend", logging.INFO, __file__, 1, "x", None, None)
    assert request_id_var.get() is None
    RequestIdFilter().filter(record)
    assert record.request_tag == ""
