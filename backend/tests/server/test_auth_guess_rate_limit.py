"""Passphrase guesses sent in headers and cookies share the login rate limit on every route,
and the client IP comes from FORWARDED_TRUSTED_HOPS entries of X-Forwarded-For."""

import asyncio
import base64
import hashlib
import hmac
import importlib
import json
import time

import httpx
import pytest
from starlette.requests import Request

import backend.main as main_mod
from backend import auth, config
from backend.main import app, create_session_token, get_client_ip

PASSPHRASE = "guess-limit-passphrase"
LIMIT_DETAIL = "Too many failed login attempts. Please try again later."
IP_A = {"X-Forwarded-For": "198.51.100.10"}
IP_B = {"X-Forwarded-For": "198.51.100.20"}


@pytest.fixture(autouse=True)
def limits(monkeypatch):
    monkeypatch.setattr(config, "APP_PASSWORD", PASSPHRASE)
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 5)
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_WINDOW_SECONDS", 60.0)
    monkeypatch.setattr(config, "FORWARDED_TRUSTED_HOPS", 1)


def _signed_token(secret: str, issued_at: float) -> str:
    payload = json.dumps(
        {"u": "singer", "t": issued_at, "s": "0123abcd"}, separators=(",", ":"), sort_keys=True
    )
    payload_b64 = base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).digest()
    return f"{payload_b64}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"


def _failures(ip: str) -> int:
    return len(auth._login_failures.get(ip, []))


def _limit(client, ip_headers: dict) -> None:
    for i in range(5):
        res = client.get("/api/projects", headers={**ip_headers, "X-App-Password": f"wrong-{i}"})
        assert res.status_code == 401


def _expired_cookies(res) -> set[str]:
    return {
        cookie.split("=", 1)[0]
        for cookie in res.headers.get_list("set-cookie")
        if "Max-Age=0" in cookie
    }


# Header guesses


def test_five_wrong_header_passphrases_then_a_429_with_retry_after(unauth_client):
    _limit(unauth_client, IP_A)

    res = unauth_client.get("/api/projects", headers={**IP_A, "X-App-Password": "wrong-5"})

    assert res.status_code == 429
    assert res.json() == {"detail": LIMIT_DETAIL}
    assert 1 <= int(res.headers["retry-after"]) <= 60
    assert res.headers["x-content-type-options"] == "nosniff"


def test_a_limited_ip_is_refused_even_with_the_right_passphrase(unauth_client):
    _limit(unauth_client, IP_A)

    from_a = unauth_client.get("/api/projects", headers={**IP_A, "X-App-Password": PASSPHRASE})
    from_b = unauth_client.get("/api/projects", headers={**IP_B, "X-App-Password": PASSPHRASE})

    assert from_a.status_code == 429
    assert from_b.status_code == 200


def test_bearer_session_header_and_wrong_key_tokens_count_toward_the_login_limit(unauth_client):
    sends = [
        {"Authorization": "Bearer wrong-bearer-1"},
        {"Authorization": "Bearer wrong-bearer-2"},
        {"X-Session-Token": "wrong-session"},
        {"X-Session-Token": "forged.signature"},
        {"X-Session-Token": create_session_token("wrong_key")},
    ]
    for headers in sends:
        assert unauth_client.get("/api/projects", headers={**IP_A, **headers}).status_code == 401
    assert _failures("198.51.100.10") == 5

    login = unauth_client.post("/api/auth/login", json={"password": PASSPHRASE}, headers=IP_A)

    assert login.status_code == 429


def test_a_valid_passphrase_beside_a_wrong_session_token_counts_nothing(unauth_client):
    headers = {**IP_A, "X-App-Password": PASSPHRASE, "X-Session-Token": "old.token"}

    for _ in range(6):
        assert unauth_client.get("/api/projects", headers=headers).status_code == 200

    assert _failures("198.51.100.10") == 0


def test_one_request_is_compared_on_no_more_new_values_than_the_limit_has_left(unauth_client):
    for i in range(4):
        headers = {**IP_A, "X-App-Password": f"wrong-{i}"}
        assert unauth_client.get("/api/projects", headers=headers).status_code == 401

    # A value counted already costs nothing to resend, so the passphrase beside it is compared
    known = {**IP_A, "X-Session-Token": "wrong-0", "X-App-Password": PASSPHRASE}
    assert unauth_client.get("/api/projects", headers=known).status_code == 200
    assert _failures("198.51.100.10") == 4

    # Room for one more: only the first of three new values is compared, so the passphrase in
    # the second header is never tried and the request counts one guess, not three
    three = {
        **IP_A,
        "X-Session-Token": "new-1",
        "X-App-Password": PASSPHRASE,
        "Authorization": "Bearer new-2",
    }
    assert unauth_client.get("/api/projects", headers=three).status_code == 401
    assert _failures("198.51.100.10") == 5

    res = unauth_client.get("/api/projects", headers={**IP_A, "X-App-Password": PASSPHRASE})
    assert res.status_code == 429


def test_a_stale_token_resent_by_every_request_counts_once(unauth_client):
    stale = create_session_token("previous-passphrase")
    headers = {**IP_A, "X-App-Password": stale, "Authorization": f"Bearer {stale}"}

    for _ in range(10):
        assert unauth_client.get("/api/projects", headers=headers).status_code == 401
    assert _failures("198.51.100.10") == 1

    login = unauth_client.post("/api/auth/login", json={"password": PASSPHRASE}, headers=IP_A)

    assert login.status_code == 200
    assert _failures("198.51.100.10") == 0
    assert "198.51.100.10" not in auth._counted_guesses


# What does not count


def test_expired_and_far_future_tokens_signed_with_the_passphrase_do_not_count(unauth_client):
    expired = _signed_token(PASSPHRASE, time.time() - 8 * 86400)
    far_future = _signed_token(PASSPHRASE, time.time() + 3600)

    for _ in range(6):
        res = unauth_client.get("/api/projects", headers={**IP_A, "X-Session-Token": expired})
        assert res.status_code == 401
        res = unauth_client.get(
            "/api/projects", headers={**IP_A, "Authorization": f"Bearer {far_future}"}
        )
        assert res.status_code == 401

    assert auth._login_failures == {}


def test_requests_without_a_usable_credential_are_neither_counted_nor_limited(unauth_client):
    sends = [{}, {"X-Session-Token": "   "}, {"Authorization": "Basic dXNlcjpwYXNz"}]
    for headers in sends:
        for _ in range(6):
            res = unauth_client.get("/api/projects", headers={**IP_A, **headers})
            assert res.status_code == 401
    assert auth._login_failures == {}

    _limit(unauth_client, IP_A)
    for headers in sends:
        assert unauth_client.get("/api/projects", headers={**IP_A, **headers}).status_code == 401


def test_old_signature_cookies_count_once_and_the_401_expires_them(unauth_client):
    old = create_session_token("previous-passphrase")
    cookie = {"Cookie": f"session_token={old}; karaoke_token={old}"}

    for i in range(20):
        path = "/static/output/x.wav" if i % 2 else "/api/projects"
        res = unauth_client.get(path, headers={**IP_A, **cookie})
        assert res.status_code == 401
        assert _expired_cookies(res) == {"session_token", "karaoke_token"}
    assert _failures("198.51.100.10") == 1

    login = unauth_client.post("/api/auth/login", json={"password": PASSPHRASE}, headers=IP_A)
    assert login.status_code == 200


def test_wrong_cookies_count_toward_the_limit_and_a_limited_ip_is_refused_its_right_cookie(
    unauth_client,
):
    for i in range(5):
        path = "/static/output/x.wav" if i % 2 else "/api/projects"
        cookie = {"Cookie": f"karaoke_token=cookie-guess-{i}"}
        assert unauth_client.get(path, headers={**IP_A, **cookie}).status_code == 401
    assert _failures("198.51.100.10") == 5

    sixth = unauth_client.get(
        "/api/projects", headers={**IP_A, "Cookie": "karaoke_token=cookie-guess-5"}
    )
    right = {"Cookie": f"karaoke_token={PASSPHRASE}"}
    from_a = unauth_client.get("/api/projects", headers={**IP_A, **right})
    from_b = unauth_client.get("/api/projects", headers={**IP_B, **right})

    for res in (sixth, from_a):
        assert res.status_code == 429
        assert res.json() == {"detail": LIMIT_DETAIL}
        assert 1 <= int(res.headers["retry-after"]) <= 60
    assert from_b.status_code == 200


def test_an_expired_cookie_is_expired_too_but_not_counted(unauth_client):
    expired = _signed_token(PASSPHRASE, time.time() - 8 * 86400)

    res = unauth_client.get("/api/projects", headers={**IP_A, "Cookie": f"karaoke_token={expired}"})

    assert res.status_code == 401
    assert _expired_cookies(res) == {"session_token", "karaoke_token"}
    assert auth._login_failures == {}


def test_a_header_401_sends_no_cookie_deletions(unauth_client):
    res = unauth_client.get("/api/projects", headers={**IP_A, "X-App-Password": "wrong"})

    assert res.status_code == 401
    assert res.headers.get_list("set-cookie") == []


# Other channels


def test_auth_status_counts_guesses_and_reports_false_while_limited(unauth_client):
    for i in range(5):
        res = unauth_client.get("/api/auth/status", headers={**IP_A, "X-App-Password": f"g{i}"})
        assert res.status_code == 200
        assert res.json() == {"auth_required": True, "authenticated": False}
    assert _failures("198.51.100.10") == 5

    from_a = unauth_client.get("/api/auth/status", headers={**IP_A, "X-App-Password": PASSPHRASE})
    from_b = unauth_client.get("/api/auth/status", headers={**IP_B, "X-App-Password": PASSPHRASE})

    assert from_a.status_code == 200
    assert from_a.json()["authenticated"] is False
    assert from_b.json()["authenticated"] is True


def test_health_remote_check_counts_guesses_and_is_not_forced_while_limited(
    unauth_client, monkeypatch
):
    calls = []

    def fake_check_for_updates(force_remote=False):
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:
            on_loop = False
        calls.append((force_remote, on_loop))
        return {"status": "ok"}

    monkeypatch.setattr(config, "check_for_updates", fake_check_for_updates)
    url = "/api/health?check_remote=true"

    for i in range(5):
        res = unauth_client.get(url, headers={**IP_A, "X-App-Password": f"g{i}"})
        assert res.status_code == 200
    assert _failures("198.51.100.10") == 5
    assert unauth_client.get(url, headers={**IP_A, "X-App-Password": PASSPHRASE}).status_code == 200
    assert unauth_client.get(url, headers={**IP_B, "X-App-Password": PASSPHRASE}).status_code == 200

    # The git check still runs in a worker thread, not on the event loop
    assert calls == [(False, False)] * 6 + [(True, False)]


@pytest.mark.parametrize("url", ["/api/auth/status", "/api/health?check_remote=true"])
def test_concurrent_guesses_stop_at_the_limit(monkeypatch, url):
    real_check = auth._check_credentials
    forced = []

    def slow_check(*args, **kwargs):
        # Widens the gap between the limit check and the count: requests handled in worker
        # threads would all pass the check before any of them is counted
        time.sleep(0.01)
        return real_check(*args, **kwargs)

    def fake_check_for_updates(force_remote=False):
        forced.append(force_remote)
        return {"status": "ok"}

    monkeypatch.setattr(auth, "_check_credentials", slow_check)
    monkeypatch.setattr(config, "check_for_updates", fake_check_for_updates)

    async def burst():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            return await asyncio.gather(
                *(ac.get(url, headers={**IP_A, "X-App-Password": f"burst-{i}"}) for i in range(20))
            )

    responses = asyncio.run(burst())

    assert all(res.status_code == 200 for res in responses)
    if url.startswith("/api/auth/status"):
        assert all(res.json()["authenticated"] is False for res in responses)
    else:
        assert forced == [False] * 20
    # Checking and counting run as one step on the event loop, so no request slips past
    assert _failures("198.51.100.10") == config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS


# Bookkeeping


def test_record_credential_failure_counts_a_value_once_per_window():
    now = 1_000_000.0
    ip = "198.51.100.7"

    assert auth.record_credential_failure(ip, "guess", now=now) is True
    assert auth.record_credential_failure(ip, "guess", now=now + 30) is False
    assert auth.record_credential_failure(ip, "other", now=now + 30) is True
    assert auth.record_credential_failure("198.51.100.8", "guess", now=now + 30) is True
    assert auth.record_credential_failure(ip, "guess", now=now + 61) is True

    assert auth._login_failures[ip] == [now + 30, now + 61]
    # Only keyed fingerprints are kept, never the guesses themselves
    assert "guess" not in json.dumps(auth._counted_guesses)


def test_reset_and_clear_forget_counted_guesses():
    auth.record_credential_failure("198.51.100.7", "guess")
    auth.record_credential_failure("198.51.100.8", "guess")

    auth.reset_login_failures("198.51.100.7")
    assert list(auth._counted_guesses) == ["198.51.100.8"]

    auth.clear_all_login_failures()
    assert auth._counted_guesses == {}


def test_pruning_drops_expired_fingerprints_and_keeps_fresh_ones(monkeypatch):
    monkeypatch.setattr(main_mod, "_last_rate_limit_cleanup", main_mod._last_rate_limit_cleanup)
    monkeypatch.setattr(auth, "_last_rate_limit_cleanup", auth._last_rate_limit_cleanup)
    now = main_mod._last_rate_limit_cleanup + 350
    auth._counted_guesses["10.0.0.1"] = {"old": now - 100}
    auth._counted_guesses["10.0.0.2"] = {"old": now - 100, "fresh": now - 10}

    with auth.LOGIN_RATE_LIMIT_LOCK:
        auth._prune_stale_rate_limits_locked(now, 60.0)

    assert auth._counted_guesses == {"10.0.0.2": {"fresh": now - 10}}


# FORWARDED_TRUSTED_HOPS


def _request(xff: str | None, client: tuple[str, int] | None = ("192.0.2.10", 5000)) -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff is not None else []
    scope = {"type": "http", "headers": headers}
    if client:
        scope["client"] = client
    return Request(scope)


def test_one_trusted_hop_keys_on_the_last_entry_as_before():
    assert get_client_ip(_request("203.0.113.5, 70.41.3.18, 198.51.100.20")) == "198.51.100.20"
    assert get_client_ip(_request("198.51.100.22:443")) == "198.51.100.22"
    assert get_client_ip(_request("[2001:db8::1]:8080")) == "2001:db8::1"
    assert get_client_ip(_request("   ")) == "192.0.2.10"
    assert get_client_ip(_request(None)) == "192.0.2.10"
    assert get_client_ip(_request(None, client=None)) == "127.0.0.1"


def test_two_trusted_hops_key_on_the_entry_before_the_nearest_proxy(monkeypatch):
    monkeypatch.setattr(config, "FORWARDED_TRUSTED_HOPS", 2)

    # cloudflared writes the client, Nginx Proxy Manager appends cloudflared's address
    assert get_client_ip(_request("198.51.100.20, 172.18.0.5")) == "198.51.100.20"
    assert get_client_ip(_request("[2001:db8::7]:443, 172.18.0.5")) == "2001:db8::7"


def test_spoofed_entries_before_the_trusted_ones_are_ignored(monkeypatch, unauth_client):
    monkeypatch.setattr(config, "FORWARDED_TRUSTED_HOPS", 2)
    assert get_client_ip(_request("1.1.1.1, 2.2.2.2, 198.51.100.20, 172.18.0.5")) == (
        "198.51.100.20"
    )

    for i in range(6):
        xff = {"X-Forwarded-For": f"10.9.9.{i}, 198.51.100.20, 172.18.0.5"}
        res = unauth_client.get("/api/projects", headers={**xff, "X-App-Password": f"wrong-{i}"})
        assert res.status_code == (429 if i == 5 else 401)

    other = {"X-Forwarded-For": "198.51.100.30, 172.18.0.5", "X-App-Password": PASSPHRASE}
    assert unauth_client.get("/api/projects", headers=other).status_code == 200


def test_zero_trusted_hops_ignore_the_header_and_use_the_socket(monkeypatch):
    monkeypatch.setattr(config, "FORWARDED_TRUSTED_HOPS", 0)

    assert get_client_ip(_request("198.51.100.20")) == "192.0.2.10"
    assert get_client_ip(_request("198.51.100.20", client=None)) == "127.0.0.1"


def test_a_header_shorter_than_the_trusted_hops_uses_its_first_entry(monkeypatch):
    monkeypatch.setattr(config, "FORWARDED_TRUSTED_HOPS", 3)

    assert get_client_ip(_request("198.51.100.20, 172.18.0.5")) == "198.51.100.20"
    assert get_client_ip(_request("198.51.100.22:443")) == "198.51.100.22"


def test_the_setting_is_parsed_and_clamped(monkeypatch, tmp_path):
    monkeypatch.setenv("KARAOKE_DATA_DIR", str(tmp_path / "reload"))
    try:
        for raw, hops in [("2", 2), (" 3 ", 3), ("-4", 0), ("two", 1), ("", 1)]:
            monkeypatch.setenv("FORWARDED_TRUSTED_HOPS", raw)
            parsed = importlib.reload(config).FORWARDED_TRUSTED_HOPS
            assert parsed == hops, raw
    finally:
        monkeypatch.delenv("FORWARDED_TRUSTED_HOPS")
        importlib.reload(config)
