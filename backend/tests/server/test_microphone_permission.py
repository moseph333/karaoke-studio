"""Permissions-Policy: the studio's own pages may ask for the microphone (practice shows a
singer's pitch), nothing they embed may, and every other device stays off for everyone."""

from backend import config
from backend.middleware import PERMISSIONS_POLICY

EXPECTED = "camera=(), microphone=(self), geolocation=(), payment=(), usb=()"


def _features(header: str) -> dict[str, str]:
    return dict(part.strip().split("=", 1) for part in header.split(","))


def test_the_header_says_exactly_this():
    """Spelled out: a test that only compares the header to the constant passes whatever the
    constant says."""
    assert PERMISSIONS_POLICY == EXPECTED


def test_only_this_site_may_use_the_microphone():
    features = _features(PERMISSIONS_POLICY)

    assert features["microphone"] == "(self)"
    # Not "*": a page framed from elsewhere gets no microphone
    assert "*" not in PERMISSIONS_POLICY


def test_everything_else_stays_off():
    features = _features(PERMISSIONS_POLICY)

    assert {name for name, allowed in features.items() if allowed != "()"} == {"microphone"}
    assert {"camera", "geolocation", "payment", "usb"} <= set(features)


def test_every_kind_of_response_carries_it(client, unauth_client):
    (config.BACKGROUNDS_DIR / "bg.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    answers = [
        client.get("/api/health"),
        client.get("/static/backgrounds/bg.png"),
        client.get("/api/project/nope"),
        unauth_client.get("/api/projects"),
        client.get("/api/docs"),
    ]

    assert [res.status_code for res in answers] == [200, 200, 404, 401, 200]
    assert all(res.headers["Permissions-Policy"] == EXPECTED for res in answers)
