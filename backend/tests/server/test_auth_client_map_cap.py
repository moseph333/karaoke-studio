"""The rate limit's per-client-IP bookkeeping stays bounded even when every request claims
a new IP (a forged X-Forwarded-For on a directly reachable port)."""

from backend import auth


def test_rate_limit_maps_keep_the_newest_clients_up_to_the_cap(monkeypatch):
    monkeypatch.setattr(auth, "MAX_TRACKED_CLIENTS", 50)
    now = 1_000_000.0
    for i in range(200):
        auth.record_credential_failure(f"10.0.0.{i}", f"guess-{i}", now=now + i * 0.1)
    with auth.LOGIN_RATE_LIMIT_LOCK:
        auth._prune_stale_rate_limits_locked(now + 20, 60.0)
    assert len(auth._login_failures) == 50
    assert len(auth._counted_guesses) == 50
    assert "10.0.0.199" in auth._login_failures
    assert "10.0.0.0" not in auth._login_failures


def test_maps_under_the_cap_are_left_alone(monkeypatch):
    now = 1_000_000.0
    for i in range(20):
        auth.record_credential_failure(f"10.0.1.{i}", "guess", now=now)
    with auth.LOGIN_RATE_LIMIT_LOCK:
        auth._prune_stale_rate_limits_locked(now + 1, 60.0)
    assert len(auth._login_failures) == 20
