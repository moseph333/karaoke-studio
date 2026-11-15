"""With ALLOWED_HOSTS set, a request naming another host (a rebound DNS name) is refused;
loopback names always pass, and an empty setting answers any host."""

import pytest

from backend import config
from backend.config import parse_allowed_hosts
from backend.middleware import host_allowed


def test_an_empty_setting_answers_any_host(client):
    assert client.get("/api/health", headers={"Host": "attacker.example"}).status_code == 200


def test_another_host_is_refused(client, monkeypatch):
    monkeypatch.setattr(config, "ALLOWED_HOSTS", ["karaoke.home.example"])
    res = client.get("/api/health", headers={"Host": "rebind.attacker.example"})
    assert res.status_code == 400
    assert client.get("/api/health", headers={"Host": "karaoke.home.example"}).status_code == 200


@pytest.mark.parametrize(
    ("host", "allowed"),
    [
        ("karaoke.home.example", True),
        ("KARAOKE.home.example:443", True),
        ("studio.lan.example", True),
        ("lan.example", False),
        ("evil-lan.example", False),
        ("localhost:8000", True),
        ("127.0.0.1", True),
        ("[::1]:8000", True),
        ("10.0.0.5", False),
        ("", False),
    ],
)
def test_host_matching(host, allowed):
    assert host_allowed(host, ["karaoke.home.example", "*.lan.example"]) is allowed


def test_parsing():
    assert parse_allowed_hosts(" A.example , *.B.example,, ") == ["a.example", "*.b.example"]
    assert parse_allowed_hosts(None) == []
