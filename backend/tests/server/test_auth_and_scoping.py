import base64
import hashlib
import hmac
import json
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

import backend.config as config
from backend.main import (
    app,
    check_login_rate_limit,
    clear_all_login_failures,
    create_session_token,
    get_client_ip,
    record_login_failure,
    verify_session_token,
)


def test_auth_status_open():
    client = TestClient(app)
    # When APP_PASSWORD is empty
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = ""
        res = client.get("/api/auth/status")
        assert res.status_code == 200
        assert res.json()["auth_required"] is False
    finally:
        config.APP_PASSWORD = orig_pwd


def test_auth_status_and_protected_routes():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = "secret_passphrase"

        # Auth status indicates required and unauthenticated without header
        res = client.get("/api/auth/status")
        assert res.status_code == 200
        assert res.json()["auth_required"] is True
        assert res.json()["authenticated"] is False

        # Auth status indicates authenticated with valid header
        res = client.get("/api/auth/status", headers={"X-App-Password": "secret_passphrase"})
        assert res.status_code == 200
        assert res.json()["authenticated"] is True

        # Unauthenticated request to protected route fails with 401
        res = client.get("/api/projects")
        assert res.status_code == 401

        # Incorrect password fails with 401
        res = client.post(
            "/api/auth/login", json={"password": "wrong_password", "username": "Tester"}
        )
        assert res.status_code == 401

        # Correct password succeeds
        res = client.post(
            "/api/auth/login", json={"password": "secret_passphrase", "username": "Tester"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["username"] == "Tester"
        assert data["token"] != "secret_passphrase"
        assert verify_session_token(data["token"], "secret_passphrase") is True

        # Request with X-App-Password header succeeds
        res = client.get("/api/projects", headers={"X-App-Password": "secret_passphrase"})
        assert res.status_code == 200

        # Health endpoint remains open without auth
        res = client.get("/api/health")
        assert res.status_code == 200
    finally:
        config.APP_PASSWORD = orig_pwd


def test_hmac_session_token_creation_and_format():
    token = create_session_token("my_app_pwd", "test_user")
    assert token
    assert token != "my_app_pwd"
    parts = token.split(".")
    assert len(parts) == 2
    payload_b64, sig_b64 = parts
    assert len(payload_b64) > 0
    assert len(sig_b64) > 0

    # Verify entropy: subsequent tokens differ due to salt
    token2 = create_session_token("my_app_pwd", "test_user")
    assert token != token2

    # Empty pwd returns empty string
    assert create_session_token("") == ""


def test_hmac_session_token_verification_success_and_tampering():
    pwd = "super_secret_studio_pwd"
    token = create_session_token(pwd, "user1")
    assert verify_session_token(token, pwd) is True

    # Tampered signature fails
    tampered_sig = token[:-3] + "xyz"
    assert verify_session_token(tampered_sig, pwd) is False

    # Tampered payload fails
    parts = token.split(".")
    tampered_payload = "dGVzdF9mYWtl" + "." + parts[1]
    assert verify_session_token(tampered_payload, pwd) is False

    # Wrong password fails
    assert verify_session_token(token, "wrong_pwd") is False

    # Malformed strings
    assert verify_session_token("", pwd) is False
    assert verify_session_token("not_a_valid_token", pwd) is False
    assert verify_session_token("a.b.c", pwd) is False
    assert verify_session_token(None, pwd) is False


def test_hmac_session_token_expiration_and_clock_skew():
    pwd = "clock_test_pwd"
    # Token crafted with timestamp 200 seconds in past
    past_time = int(time.time()) - 200
    payload = {"u": "old_user", "t": past_time, "s": "12345678abcdef"}
    p_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    p_b64 = base64.urlsafe_b64encode(p_json.encode()).decode().rstrip("=")
    sig = hmac.new(pwd.encode(), p_b64.encode(), hashlib.sha256).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    old_token = f"{p_b64}.{sig_b64}"

    # Valid with default max_age (7 days)
    assert verify_session_token(old_token, pwd) is True
    # Expired with max_age = 100 seconds
    assert verify_session_token(old_token, pwd, max_age=100) is False

    # Future clock skew <= 300s is tolerated
    near_future_time = int(time.time()) + 100
    payload_future = {"u": "future_user", "t": near_future_time, "s": "12345678abcdef"}
    pf_json = json.dumps(payload_future, separators=(",", ":"), sort_keys=True)
    pf_b64 = base64.urlsafe_b64encode(pf_json.encode()).decode().rstrip("=")
    sig_f = hmac.new(pwd.encode(), pf_b64.encode(), hashlib.sha256).digest()
    sig_f_b64 = base64.urlsafe_b64encode(sig_f).decode().rstrip("=")
    future_token = f"{pf_b64}.{sig_f_b64}"
    assert verify_session_token(future_token, pwd) is True

    # Far future clock skew > 300s is rejected
    far_future_time = int(time.time()) + 500
    payload_far = {"u": "far_user", "t": far_future_time, "s": "12345678abcdef"}
    pfar_json = json.dumps(payload_far, separators=(",", ":"), sort_keys=True)
    pfar_b64 = base64.urlsafe_b64encode(pfar_json.encode()).decode().rstrip("=")
    sig_far = hmac.new(pwd.encode(), pfar_b64.encode(), hashlib.sha256).digest()
    sig_far_b64 = base64.urlsafe_b64encode(sig_far).decode().rstrip("=")
    far_future_token = f"{pfar_b64}.{sig_far_b64}"
    assert verify_session_token(far_future_token, pwd) is False


def test_auth_login_returns_signed_token_not_password():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = "production_studio_secret"

        login_res = client.post(
            "/api/auth/login",
            json={"password": "production_studio_secret", "username": "StarSinger"},
        )
        assert login_res.status_code == 200
        body = login_res.json()
        token = body.get("token")
        assert token is not None
        assert token != "production_studio_secret"
        assert verify_session_token(token, "production_studio_secret") is True

        # Check cookies
        assert "session_token" in login_res.cookies
        assert "karaoke_token" in login_res.cookies
        assert login_res.cookies["session_token"] == token
        assert login_res.cookies["karaoke_token"] == token

        # Verify authenticated routes via token in X-Session-Token
        res = client.get("/api/auth/status", headers={"X-Session-Token": token})
        assert res.status_code == 200
        assert res.json()["authenticated"] is True

        # Verify authenticated routes via token in Authorization Bearer
        res = client.get("/api/auth/status", headers={"Authorization": f"Bearer {token}"})
        assert res.status_code == 200
        assert res.json()["authenticated"] is True

        # Verify authenticated routes via cookie session_token
        res = client.get("/api/auth/status", cookies={"session_token": token})
        assert res.status_code == 200
        assert res.json()["authenticated"] is True

        # Verify authenticated routes via cookie karaoke_token
        res = client.get("/api/auth/status", cookies={"karaoke_token": token})
        assert res.status_code == 200
        assert res.json()["authenticated"] is True

        # Verify dual auth still supports direct raw passphrase
        res = client.get("/api/auth/status", headers={"X-App-Password": "production_studio_secret"})
        assert res.status_code == 200
        assert res.json()["authenticated"] is True

        # Logout deletes both cookies
        logout_res = client.post("/api/auth/logout")
        assert logout_res.status_code == 200
        set_cookie = logout_res.headers.get("set-cookie", "")
        assert "session_token" in set_cookie
        assert "karaoke_token" in set_cookie
    finally:
        config.APP_PASSWORD = orig_pwd


def test_get_client_ip_resolution():
    # 1. Comma-separated X-Forwarded-For: the last entry is the one our proxy appended
    req = Request(
        {
            "type": "http",
            "headers": [(b"x-forwarded-for", b"203.0.113.195, 70.41.3.18, 150.172.238.178")],
        }
    )
    assert get_client_ip(req) == "150.172.238.178"

    # 2. IPv4 with port
    req = Request({"type": "http", "headers": [(b"x-forwarded-for", b"198.51.100.22:443")]})
    assert get_client_ip(req) == "198.51.100.22"

    # 3. IPv6 with brackets
    req = Request({"type": "http", "headers": [(b"x-forwarded-for", b"[2001:db8::1]:8080")]})
    assert get_client_ip(req) == "2001:db8::1"

    # 4. Fallback to client host
    req = Request({"type": "http", "headers": [], "client": ("192.168.1.50", 4321)})
    assert get_client_ip(req) == "192.168.1.50"

    # 5. Fallback to 127.0.0.1
    req = Request({"type": "http", "headers": []})
    assert get_client_ip(req) == "127.0.0.1"


def test_login_rate_limit_exceeded_returns_429():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = "test_passphrase_rl"
        headers = {"X-Forwarded-For": "198.51.100.55"}

        # Attempts 1 through 5 fail with 401
        for i in range(5):
            res = client.post(
                "/api/auth/login",
                json={"password": f"wrong_{i}", "username": "BadActor"},
                headers=headers,
            )
            assert res.status_code == 401
            assert res.json()["detail"] == "Incorrect studio passphrase"

        # 6th attempt is rate-limited: HTTP 429
        res = client.post(
            "/api/auth/login",
            json={"password": "any_password", "username": "BadActor"},
            headers=headers,
        )
        assert res.status_code == 429
        assert "Too many failed login attempts" in res.json()["detail"]
        assert "Retry-After" in res.headers
        retry_after = int(res.headers["Retry-After"])
        assert 1 <= retry_after <= 60
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_login_rate_limit_ignores_forged_forwarded_for_entries():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = "test_passphrase_forged"

        # A new fake address in front each time; the proxy's own entry stays the same
        for i in range(5):
            res = client.post(
                "/api/auth/login",
                json={"password": f"wrong_{i}", "username": "Spoofer"},
                headers={"X-Forwarded-For": f"10.0.0.{i}, 198.51.100.99"},
            )
            assert res.status_code == 401

        res = client.post(
            "/api/auth/login",
            json={"password": "test_passphrase_forged", "username": "Spoofer"},
            headers={"X-Forwarded-For": "10.0.0.250, 198.51.100.99"},
        )
        assert res.status_code == 429
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_login_rate_limit_reset_on_success():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = "correct_passphrase"
        headers = {"X-Forwarded-For": "198.51.100.77"}

        # 4 failed attempts
        for _ in range(4):
            res = client.post(
                "/api/auth/login",
                json={"password": "wrong", "username": "User"},
                headers=headers,
            )
            assert res.status_code == 401

        # 5th attempt is successful
        res = client.post(
            "/api/auth/login",
            json={"password": "correct_passphrase", "username": "User"},
            headers=headers,
        )
        assert res.status_code == 200

        # After success, client can fail again up to threshold without immediate 429
        res = client.post(
            "/api/auth/login",
            json={"password": "wrong_again", "username": "User"},
            headers=headers,
        )
        assert res.status_code == 401
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_login_rate_limit_ip_isolation():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = "shared_secret"
        ip_a_headers = {"X-Forwarded-For": "10.0.0.1"}
        ip_b_headers = {"X-Forwarded-For": "10.0.0.2"}

        # 5 failed attempts from IP A
        for _ in range(5):
            res = client.post(
                "/api/auth/login",
                json={"password": "bad", "username": "Attacker"},
                headers=ip_a_headers,
            )
            assert res.status_code == 401

        # IP A is blocked
        res_a = client.post(
            "/api/auth/login",
            json={"password": "bad", "username": "Attacker"},
            headers=ip_a_headers,
        )
        assert res_a.status_code == 429

        # IP B is NOT blocked
        res_b = client.post(
            "/api/auth/login",
            json={"password": "shared_secret", "username": "GoodUser"},
            headers=ip_b_headers,
        )
        assert res_b.status_code == 200
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_login_rate_limit_sliding_window_expiration():
    client_ip = "192.0.2.100"
    clear_all_login_failures()
    now = 1000000.0

    # Record 5 failures at t = 1000000.0
    for _ in range(5):
        record_login_failure(client_ip, now=now)

    # Within window (60s), check raises 429
    with pytest.raises(HTTPException) as exc_info:
        check_login_rate_limit(client_ip, now=now + 30.0)
    assert exc_info.value.status_code == 429

    # After window (e.g. t = 1000065.0), check passes without error
    check_login_rate_limit(client_ip, now=now + 65.0)
    clear_all_login_failures()


def test_login_rate_limit_empty_password_counts_as_failure():
    client = TestClient(app)
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = "secret_pwd"
        headers = {"X-Forwarded-For": "192.0.2.150"}

        # Empty password rejected with 401 and counts toward limit
        for _ in range(5):
            res = client.post(
                "/api/auth/login",
                json={"password": "   ", "username": "User"},
                headers=headers,
            )
            assert res.status_code == 401

        # 6th attempt is 429
        res = client.post(
            "/api/auth/login",
            json={"password": "secret_pwd", "username": "User"},
            headers=headers,
        )
        assert res.status_code == 429
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()
