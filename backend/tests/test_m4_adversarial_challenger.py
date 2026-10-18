import base64
import concurrent.futures
import hashlib
import hmac
import json
import math
import secrets
import string
import time

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from starlette.requests import Request

import backend.config as config
from backend.main import (
    LOGIN_RATE_LIMIT_LOCK,
    _login_failures,
    _prune_stale_rate_limits_locked,
    app,
    check_login_rate_limit,
    clear_all_login_failures,
    create_session_token,
    get_client_ip,
    record_login_failure,
    reset_login_failures,
    verify_session_token,
)


@pytest.fixture(autouse=True)
def clean_rate_limit_state():
    clear_all_login_failures()
    yield
    clear_all_login_failures()


# ============================================================================
# 1. Cryptographic Integrity & Signature Forgery Stress Tests
# ============================================================================


def test_adversarial_bit_flipping_exhaustive():
    """
    Exhaustively flips every single bit across both payload and signature bytes,
    as well as character-level mutations in base64 encodings.
    Verifies that verify_session_token returns False for 100% of mutations.
    """
    secret = "adversarial_hmac_secret_key_#987"
    valid_token = create_session_token(secret, "adversary")
    assert verify_session_token(valid_token, secret) is True

    payload_b64, sig_b64 = valid_token.split(".")

    # Character-level mutations in base64 payload
    for idx in range(len(payload_b64)):
        orig_char = payload_b64[idx]
        for replacement in ["A", "z", "0", "-", "_"]:
            if replacement != orig_char:
                mutated_payload = payload_b64[:idx] + replacement + payload_b64[idx + 1 :]
                mutated_token = f"{mutated_payload}.{sig_b64}"
                assert verify_session_token(mutated_token, secret) is False

    # Character-level mutations in base64 signature
    for idx in range(len(sig_b64)):
        orig_char = sig_b64[idx]
        for replacement in ["B", "y", "9", "-", "_"]:
            if replacement != orig_char:
                mutated_sig = sig_b64[:idx] + replacement + sig_b64[idx + 1 :]
                mutated_token = f"{payload_b64}.{mutated_sig}"
                assert verify_session_token(mutated_token, secret) is False

    # Bit-level flipping on decoded 32-byte HMAC signature
    pad = len(sig_b64) % 4
    padded_sig = sig_b64 + ("=" * ((4 - pad) % 4))
    raw_sig = bytearray(base64.urlsafe_b64decode(padded_sig.encode()))
    assert len(raw_sig) == 32

    for byte_idx in range(len(raw_sig)):
        for bit_idx in range(8):
            flipped = bytearray(raw_sig)
            flipped[byte_idx] ^= 1 << bit_idx
            corrupted_sig_b64 = base64.urlsafe_b64encode(flipped).decode("utf-8").rstrip("=")
            corrupted_token = f"{payload_b64}.{corrupted_sig_b64}"
            assert verify_session_token(corrupted_token, secret) is False


def test_adversarial_signature_forgery_vectors():
    """
    Attempts cryptographic signature forgery using:
    - Empty secrets
    - Null bytes in secret and token
    - Common default passwords
    - Key prefix / suffix modifications
    - Signature swapping between tokens
    - Truncated / elongated signatures
    """
    real_secret = "CoRrEcT_HighEntropy_Secret_!@#$"
    valid_token = create_session_token(real_secret, "admin")
    payload_b64, valid_sig_b64 = valid_token.split(".")

    # 1. Forgery with empty secret
    forged_empty_sig = (
        base64.urlsafe_b64encode(hmac.new(b"", payload_b64.encode(), hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    assert verify_session_token(f"{payload_b64}.{forged_empty_sig}", real_secret) is False

    # 2. Forgery with single null byte secret
    forged_null_sig = (
        base64.urlsafe_b64encode(hmac.new(b"\x00", payload_b64.encode(), hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    assert verify_session_token(f"{payload_b64}.{forged_null_sig}", real_secret) is False

    # 3. Forgery with dictionary / weak default passwords
    weak_passwords = [
        "admin",
        "password",
        "123456",
        "root",
        "secret",
        "sluggos",
        "karaoke",
        "studio",
    ]
    for weak_pwd in weak_passwords:
        forged_sig = (
            base64.urlsafe_b64encode(
                hmac.new(weak_pwd.encode(), payload_b64.encode(), hashlib.sha256).digest()
            )
            .decode()
            .rstrip("=")
        )
        assert verify_session_token(f"{payload_b64}.{forged_sig}", real_secret) is False

    # 4. Forgery with real secret truncated or appended
    for bad_pwd in [real_secret[:-1], real_secret + "x", real_secret.upper(), real_secret.lower()]:
        forged_sig = (
            base64.urlsafe_b64encode(
                hmac.new(bad_pwd.encode(), payload_b64.encode(), hashlib.sha256).digest()
            )
            .decode()
            .rstrip("=")
        )
        assert verify_session_token(f"{payload_b64}.{forged_sig}", real_secret) is False

    # 5. Token signature swapping: bob's signature on alice's payload
    bob_token = create_session_token(real_secret, "bob")
    _bob_payload, bob_sig = bob_token.split(".")
    swapped_token = f"{payload_b64}.{bob_sig}"
    assert verify_session_token(swapped_token, real_secret) is False

    # 6. Signature truncation and elongation
    assert verify_session_token(f"{payload_b64}.{valid_sig_b64[:-4]}", real_secret) is False
    assert verify_session_token(f"{payload_b64}.{valid_sig_b64}AAAA", real_secret) is False
    assert verify_session_token(f"{payload_b64}.A", real_secret) is False

    # 7. Null-byte injection inside token
    assert verify_session_token(f"{payload_b64}\x00.{valid_sig_b64}", real_secret) is False
    assert verify_session_token(f"{payload_b64}.\x00{valid_sig_b64}", real_secret) is False
    assert verify_session_token(f"{payload_b64}.{valid_sig_b64}\x00", real_secret) is False


def test_adversarial_malformed_tokens_fuzzing():
    """
    Fuzzes verify_session_token with malformed tokens:
    - Missing dots, multiple dots, boundary dots
    - Non-base64 characters, punctuation, control chars
    - Multibyte Unicode in payloads
    - Malformed JSON payloads (syntax errors, non-dicts, bad field types)
    - Enormous payload strings (> 100KB, 500KB)
    - Non-string / invalid typed inputs
    Confirms that all return False and NONE raise unhandled exceptions.
    """
    secret = "fuzz_secret_passphrase_456"

    # Structural delimiter edge cases
    structural_malformed = [
        "",
        "   ",
        "\t\r\n",
        "nodotatall",
        ".",
        "..",
        "...",
        ".sigonly",
        "payloadonly.",
        ".payload.sig.",
        "p.s.extra",
        "p.s.extra.more",
        "p..s",
    ]
    for token in structural_malformed:
        assert verify_session_token(token, secret) is False

    # Non-base64 and special character payloads
    bad_chars = [
        "abc!@#$.def$%^&*",
        "payload with spaces.sig with spaces",
        "payload\nnewline.sig",
        "payload\x00null.sig\x00null",
        "===.===",
        "???.???",
    ]
    for token in bad_chars:
        assert verify_session_token(token, secret) is False

    # Valid base64 encoding of non-JSON or invalid JSON
    invalid_json_payloads = [
        b"this is not json at all",
        b"{unclosed json: 123",
        b"[1, 2, 3, 4]",
        b'"just a string"',
        b"12345678",
        b"true",
        b"null",
        b"",
        json.dumps({}).encode(),
        json.dumps({"u": "alice"}).encode(),  # missing 't'
        json.dumps({"u": "alice", "t": "not-a-number"}).encode(),
        json.dumps({"u": "alice", "t": None}).encode(),
        json.dumps({"u": "alice", "t": [123]}).encode(),
        json.dumps({"u": "alice", "t": {"nested": 123}}).encode(),
    ]
    for raw_p in invalid_json_payloads:
        p_b64 = base64.urlsafe_b64encode(raw_p).decode().rstrip("=")
        # Sign with secret
        sig = (
            base64.urlsafe_b64encode(
                hmac.new(secret.encode(), p_b64.encode(), hashlib.sha256).digest()
            )
            .decode()
            .rstrip("=")
        )
        token = f"{p_b64}.{sig}"
        # Even with valid HMAC signature, invalid payload structure MUST return False
        assert verify_session_token(token, secret) is False

    # Multibyte Unicode payloads (UTF-8 emojis, foreign scripts)
    unicode_payload = {
        "u": "🎵🎤 Singer 🎶 💥 漢字 العربية Русский",
        "t": int(time.time()),
        "s": "12345678abcdef",
    }
    raw_u = json.dumps(unicode_payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    u_b64 = base64.urlsafe_b64encode(raw_u).decode().rstrip("=")
    u_sig = (
        base64.urlsafe_b64encode(hmac.new(secret.encode(), u_b64.encode(), hashlib.sha256).digest())
        .decode()
        .rstrip("=")
    )
    valid_unicode_token = f"{u_b64}.{u_sig}"
    assert verify_session_token(valid_unicode_token, secret) is True

    # Enormous payload (> 100KB and > 500KB)
    huge_payload = {
        "u": "attacker" * 20000,  # ~160KB
        "t": int(time.time()),
        "s": "abc",
    }
    huge_json = json.dumps(huge_payload).encode("utf-8")
    huge_b64 = base64.urlsafe_b64encode(huge_json).decode().rstrip("=")
    huge_sig = (
        base64.urlsafe_b64encode(
            hmac.new(secret.encode(), huge_b64.encode(), hashlib.sha256).digest()
        )
        .decode()
        .rstrip("=")
    )
    huge_token = f"{huge_b64}.{huge_sig}"
    # Huge payload signed correctly parses safely without crash
    assert verify_session_token(huge_token, secret) is True
    # Tampering huge payload returns False safely
    assert verify_session_token(f"{huge_b64}X.{huge_sig}", secret) is False

    # Giant garbage token (> 500KB)
    giant_garbage = ("A" * 250000) + "." + ("B" * 250000)
    assert verify_session_token(giant_garbage, secret) is False

    # Extreme non-string types
    valid_sample_token = create_session_token(secret, "fuzz_user")
    for non_str in [None, 12345, 3.14, True, False, [], {}, b"bytes", object()]:
        assert verify_session_token(non_str, secret) is False
        assert verify_session_token(valid_sample_token, non_str) is False


# ============================================================================
# 2. Replay & Expiration Attacks
# ============================================================================


def test_adversarial_replay_and_expiration():
    """
    Stress-tests token timestamp boundary conditions:
    - Tokens expired by 1s, 1hr, 100 days
    - Negative timestamps, Epoch 0
    - Clock skew tolerance window boundary (300s)
    """
    secret = "replay_stress_secret_key"
    now = time.time()

    def make_signed_token(ts):
        payload = {"u": "victim", "t": ts, "s": "sec12345"}
        p_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
        p_b64 = base64.urlsafe_b64encode(p_json.encode()).decode().rstrip("=")
        sig = (
            base64.urlsafe_b64encode(
                hmac.new(secret.encode(), p_b64.encode(), hashlib.sha256).digest()
            )
            .decode()
            .rstrip("=")
        )
        return f"{p_b64}.{sig}"

    # Default max_age is 7 days (604800 seconds)
    max_age_7d = 86400 * 7

    # 1 second past expiration
    token_expired_1s = make_signed_token(now - max_age_7d - 1)
    assert verify_session_token(token_expired_1s, secret) is False

    # 1 second before expiration
    token_valid_edge = make_signed_token(now - max_age_7d + 5)
    assert verify_session_token(token_valid_edge, secret) is True

    # Ancient token: Epoch 0 (Jan 1, 1970)
    token_epoch_0 = make_signed_token(0)
    assert verify_session_token(token_epoch_0, secret) is False

    # Negative timestamp
    token_negative = make_signed_token(-100000)
    assert verify_session_token(token_negative, secret) is False

    # Future clock skew:
    # Within 300s window: valid
    token_future_250s = make_signed_token(now + 250)
    assert verify_session_token(token_future_250s, secret) is True

    # Beyond 300s window (301s): rejected
    token_future_301s = make_signed_token(now + 301)
    assert verify_session_token(token_future_301s, secret) is False

    # Far future: year 2099
    token_far_future = make_signed_token(now + 10**9)
    assert verify_session_token(token_far_future, secret) is False


# ============================================================================
# 3. Dual Verification Robustness & Precedence Attacks
# ============================================================================


def test_adversarial_all_five_extraction_vectors():
    """
    Verifies that all 5 authentication vectors successfully authenticate a request:
    1. X-Session-Token
    2. X-App-Password
    3. Authorization: Bearer <token>
    4. Cookie: session_token
    5. Cookie: karaoke_token
    Also verifies dual-auth versatility (raw passphrase accepted via Bearer, X-Session-Token, cookies).
    """
    client = TestClient(app)
    pwd = "adversarial_vector_secret_passphrase"
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = pwd
        token = create_session_token(pwd, "vector_user")

        # 1. X-Session-Token with signed token
        res1 = client.get("/api/auth/status", headers={"X-Session-Token": token})
        assert res1.status_code == 200
        assert res1.json()["authenticated"] is True

        # 2. X-App-Password with raw passphrase
        res2 = client.get("/api/auth/status", headers={"X-App-Password": pwd})
        assert res2.status_code == 200
        assert res2.json()["authenticated"] is True

        # 3. Authorization: Bearer with signed token
        res3 = client.get("/api/auth/status", headers={"Authorization": f"Bearer {token}"})
        assert res3.status_code == 200
        assert res3.json()["authenticated"] is True

        # 4. Cookie session_token with signed token
        res4 = client.get("/api/auth/status", cookies={"session_token": token})
        assert res4.status_code == 200
        assert res4.json()["authenticated"] is True

        # 5. Cookie karaoke_token with signed token
        res5 = client.get("/api/auth/status", cookies={"karaoke_token": token})
        assert res5.status_code == 200
        assert res5.json()["authenticated"] is True

        # Dual auth acceptance of raw password across other channels
        res_bearer_pwd = client.get("/api/auth/status", headers={"Authorization": f"Bearer {pwd}"})
        assert res_bearer_pwd.status_code == 200
        assert res_bearer_pwd.json()["authenticated"] is True

        res_sess_header_pwd = client.get("/api/auth/status", headers={"X-Session-Token": pwd})
        assert res_sess_header_pwd.status_code == 200
        assert res_sess_header_pwd.json()["authenticated"] is True

        res_cookie_pwd = client.get("/api/auth/status", cookies={"session_token": pwd})
        assert res_cookie_pwd.status_code == 200
        assert res_cookie_pwd.json()["authenticated"] is True

        res_karaoke_pwd = client.get("/api/auth/status", cookies={"karaoke_token": pwd})
        assert res_karaoke_pwd.status_code == 200
        assert res_karaoke_pwd.json()["authenticated"] is True
    finally:
        config.APP_PASSWORD = orig_pwd


def test_adversarial_header_vs_cookie_precedence_attacks():
    """
    Tests adversarial conflicting credentials across headers and cookies:
    - Invalid header + valid cookie MUST be rejected (HTTP 401).
      Header exclusivity prevents fallback to insecure or poisoned browser cookies.
    - Valid header + invalid cookie MUST succeed (HTTP 200).
    - Blank / empty header + valid cookie MUST be rejected (HTTP 401).
    - Invalid session_token cookie + valid karaoke_token cookie succeeds (HTTP 200).
    """
    client = TestClient(app)
    pwd = "precedence_master_secret"
    orig_pwd = config.APP_PASSWORD
    try:
        config.APP_PASSWORD = pwd
        valid_token = create_session_token(pwd, "good_user")
        invalid_token = "invalid.forged_signature_token"

        # Scenario 1: Bad X-Session-Token header + Valid session_token cookie -> MUST 401
        res = client.get(
            "/api/projects",
            headers={"X-Session-Token": invalid_token},
            cookies={"session_token": valid_token},
        )
        assert res.status_code == 401

        # Scenario 2: Bad X-App-Password header + Valid session_token cookie -> MUST 401
        res = client.get(
            "/api/projects",
            headers={"X-App-Password": "wrong_password_value"},
            cookies={"session_token": valid_token},
        )
        assert res.status_code == 401

        # Scenario 3: Bad Authorization Bearer + Valid karaoke_token cookie -> MUST 401
        res = client.get(
            "/api/projects",
            headers={"Authorization": f"Bearer {invalid_token}"},
            cookies={"karaoke_token": valid_token},
        )
        assert res.status_code == 401

        # Scenario 4: Empty X-Session-Token header + Valid cookie -> MUST 401
        # Explicit header was provided, so it takes exclusivity
        res = client.get(
            "/api/projects",
            headers={"X-Session-Token": "   "},
            cookies={"session_token": valid_token},
        )
        assert res.status_code == 401

        # Scenario 5: Valid X-Session-Token header + Bad session_token cookie -> MUST 200
        res = client.get(
            "/api/projects",
            headers={"X-Session-Token": valid_token},
            cookies={"session_token": invalid_token},
        )
        assert res.status_code == 200

        # Scenario 6: Valid Authorization Bearer header + Bad cookies -> MUST 200
        res = client.get(
            "/api/projects",
            headers={"Authorization": f"Bearer {valid_token}"},
            cookies={"session_token": invalid_token, "karaoke_token": invalid_token},
        )
        assert res.status_code == 200

        # Scenario 7: Conflicting cookies (invalid session_token, valid karaoke_token) -> MUST 200
        res = client.get(
            "/api/projects",
            cookies={"session_token": invalid_token, "karaoke_token": valid_token},
        )
        assert res.status_code == 200
    finally:
        config.APP_PASSWORD = orig_pwd


# ============================================================================
# 4. Brute Force & Sliding-Window Rate Limit Stress
# ============================================================================


def test_adversarial_burst_brute_force_50_attempts():
    """
    Sends a burst of 50 failed login attempts from a single IP.
    Verifies that:
    - Exactly attempts 1..5 return 401 (Incorrect studio passphrase).
    - Exactly attempts 6..50 return 429 (Too many failed login attempts).
    - Every 429 response contains a valid positive integer Retry-After header.
    """
    client = TestClient(app)
    pwd = "rate_limit_burst_secret"
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = pwd
        client_ip = "198.51.100.222"
        headers = {"X-Forwarded-For": client_ip}

        for attempt in range(1, 51):
            res = client.post(
                "/api/auth/login",
                json={"password": f"attempt_{attempt}_wrong", "username": "bruteforcer"},
                headers=headers,
            )
            if attempt <= 5:
                assert res.status_code == 401, (
                    f"Attempt {attempt} should return 401, got {res.status_code}"
                )
                assert res.json()["detail"] == "Incorrect studio passphrase"
            else:
                assert res.status_code == 429, (
                    f"Attempt {attempt} should return 429, got {res.status_code}"
                )
                assert "Too many failed login attempts" in res.json()["detail"]
                assert "Retry-After" in res.headers
                retry_after = int(res.headers["Retry-After"])
                assert 1 <= retry_after <= 60
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_adversarial_rate_limit_ip_isolation_multi_client():
    """
    Validates complete isolation across multiple client IPs:
    - Exhausting attempts on IP A does NOT block IP B, IP C, or IPv6 addresses.
    - Tests IP address normalization: port stripping (IPv4) and bracket stripping (IPv6).
    """
    client = TestClient(app)
    pwd = "isolation_secret_pwd"
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = pwd
        ip_a = "192.0.2.10"
        ip_b = "192.0.2.20"
        ipv6_a = "2001:db8::aaaa"
        ipv6_b = "2001:db8::bbbb"

        # Lock out IP A with 5 failures
        for i in range(5):
            res = client.post(
                "/api/auth/login",
                json={"password": f"bad_{i}", "username": "VictimA"},
                headers={"X-Forwarded-For": ip_a},
            )
            assert res.status_code == 401

        # 6th attempt from IP A is 429
        res_a = client.post(
            "/api/auth/login",
            json={"password": pwd, "username": "VictimA"},
            headers={"X-Forwarded-For": ip_a},
        )
        assert res_a.status_code == 429

        # IP B is completely unaffected: first bad attempt is 401, not 429
        res_b = client.post(
            "/api/auth/login",
            json={"password": "wrong", "username": "UserB"},
            headers={"X-Forwarded-For": ip_b},
        )
        assert res_b.status_code == 401

        # IP B with correct password succeeds immediately
        res_b_ok = client.post(
            "/api/auth/login",
            json={"password": pwd, "username": "UserB"},
            headers={"X-Forwarded-For": ip_b},
        )
        assert res_b_ok.status_code == 200

        # Lock out IPv6 A with 5 failures
        for i in range(5):
            res = client.post(
                "/api/auth/login",
                json={"password": f"bad_{i}", "username": "UserV6A"},
                headers={"X-Forwarded-For": f"[{ipv6_a}]:8443"},
            )
            assert res.status_code == 401

        # 6th attempt from IPv6 A is 429
        res_v6a = client.post(
            "/api/auth/login",
            json={"password": pwd, "username": "UserV6A"},
            headers={"X-Forwarded-For": ipv6_a},
        )
        assert res_v6a.status_code == 429

        # IPv6 B is unaffected: succeeds with 200
        res_v6b = client.post(
            "/api/auth/login",
            json={"password": pwd, "username": "UserV6B"},
            headers={"X-Forwarded-For": f"[{ipv6_b}]:443"},
        )
        assert res_v6b.status_code == 200

        # Port normalization verification: 192.0.2.10:9999 maps to locked IP A
        res_a_port = client.post(
            "/api/auth/login",
            json={"password": pwd, "username": "VictimA"},
            headers={"X-Forwarded-For": f"{ip_a}:9999"},
        )
        assert res_a_port.status_code == 429
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_adversarial_rate_limit_reset_clears_failures():
    """
    Verifies that a single successful login from a client IP immediately resets
    and clears all accumulated failure records for that client IP.
    """
    client = TestClient(app)
    pwd = "reset_test_secret_pwd"
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = pwd
        client_ip = "198.51.100.77"
        headers = {"X-Forwarded-For": client_ip}

        # 4 failed attempts (1 away from lockout)
        for _ in range(4):
            res = client.post(
                "/api/auth/login",
                json={"password": "bad", "username": "User"},
                headers=headers,
            )
            assert res.status_code == 401

        # Successful login
        res_ok = client.post(
            "/api/auth/login",
            json={"password": pwd, "username": "User"},
            headers=headers,
        )
        assert res_ok.status_code == 200

        # Client now has a clean slate: next 5 attempts must return 401, not 429
        for i in range(1, 6):
            res = client.post(
                "/api/auth/login",
                json={"password": "bad", "username": "User"},
                headers=headers,
            )
            assert res.status_code == 401, f"Attempt {i} after reset should be 401"

        # 6th attempt after reset is 429
        res_locked = client.post(
            "/api/auth/login",
            json={"password": "bad", "username": "User"},
            headers=headers,
        )
        assert res_locked.status_code == 429
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_adversarial_rate_limit_concurrency_stress():
    """
    Launches 20 concurrent threads attempting failed logins simultaneously from the same IP.
    Verifies:
    - Thread safety under LOGIN_RATE_LIMIT_LOCK (no race conditions, no deadlocks).
    - Every request returns either 401 or 429 (zero unhandled exceptions or 500s).
    - All failures are safely recorded.
    - Subsequent sequential request from the same IP returns 429.
    """
    client = TestClient(app)
    pwd = "concurrency_stress_pwd"
    orig_pwd = config.APP_PASSWORD
    clear_all_login_failures()
    try:
        config.APP_PASSWORD = pwd
        client_ip = "192.0.2.199"
        headers = {"X-Forwarded-For": client_ip}

        def attempt_login(thread_id: int):
            return client.post(
                "/api/auth/login",
                json={"password": f"wrong_{thread_id}", "username": f"thread_{thread_id}"},
                headers=headers,
            )

        num_threads = 20
        with concurrent.futures.ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(attempt_login, i) for i in range(num_threads)]
            results = [f.result() for f in concurrent.futures.as_completed(futures)]

        status_codes = [r.status_code for r in results]
        assert len(status_codes) == num_threads
        for code in status_codes:
            assert code in (401, 429), f"Unexpected status code under concurrency: {code}"

        # Under the lock, at least 5 failures were recorded
        with LOGIN_RATE_LIMIT_LOCK:
            failures_recorded = len(_login_failures.get(client_ip, []))
            assert failures_recorded >= 5

        # Subsequent attempt is guaranteed to be 429
        res_post = client.post(
            "/api/auth/login",
            json={"password": "bad", "username": "PostThread"},
            headers=headers,
        )
        assert res_post.status_code == 429
    finally:
        config.APP_PASSWORD = orig_pwd
        clear_all_login_failures()


def test_adversarial_rate_limit_pruning_memory_leak():
    """
    Tests _prune_stale_rate_limits_locked to verify stale IPs are evicted
    and active entries are preserved, preventing memory leaks.
    """
    import backend.main as main_mod

    clear_all_login_failures()
    now = main_mod._last_rate_limit_cleanup + 350.0
    window = 60.0

    with LOGIN_RATE_LIMIT_LOCK:
        # IP 1: stale timestamps (older than window)
        _login_failures["10.0.0.1"] = [now - 100.0, now - 80.0]
        # IP 2: active timestamps
        _login_failures["10.0.0.2"] = [now - 20.0, now - 10.0]

        _prune_stale_rate_limits_locked(now, window)

        assert "10.0.0.1" not in _login_failures
        assert "10.0.0.2" in _login_failures
        assert len(_login_failures["10.0.0.2"]) == 2
    clear_all_login_failures()
