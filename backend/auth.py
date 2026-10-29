"""Authentication helpers, HMAC-SHA256 session token generation and verification, client IP resolution, and sliding-window rate limiting."""

import base64
import hashlib
import hmac
import json
import logging
import math
import secrets
import threading
import time

from fastapi import HTTPException, Request

from backend import config

logger = logging.getLogger("karaoke_backend")

# Client IP login rate limiting state
LOGIN_RATE_LIMIT_LOCK = threading.Lock()
_login_failures: dict[str, list[float]] = {}
_last_rate_limit_cleanup: float = 0.0


def get_client_ip(request: Request) -> str:
    # Proxies append the address they received the request from, so only the last
    # X-Forwarded-For entry was written by the proxy in front of us. Earlier entries
    # come from the client and could be forged to dodge the login rate limit.
    xff = request.headers.get("x-forwarded-for")
    if xff:
        last_ip = xff.split(",")[-1].strip()
        if last_ip:
            if last_ip.startswith("[") and "]" in last_ip:
                last_ip = last_ip[1 : last_ip.index("]")]
            elif ":" in last_ip and last_ip.count(":") == 1:
                last_ip = last_ip.split(":")[0]
            if last_ip:
                return last_ip
    if request.client and request.client.host:
        return request.client.host.strip()
    return "127.0.0.1"


def _prune_stale_rate_limits_locked(now: float, window: float) -> None:
    global _last_rate_limit_cleanup
    import backend.main as main_mod

    last_cleanup = getattr(main_mod, "_last_rate_limit_cleanup", _last_rate_limit_cleanup)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    if (now - last_cleanup < 300.0) and len(failures) < 1000:
        return
    _last_rate_limit_cleanup = now
    main_mod._last_rate_limit_cleanup = now
    stale_ips = []
    for ip, timestamps in failures.items():
        valid = [t for t in timestamps if (now - t) < window]
        if valid:
            failures[ip] = valid
        else:
            stale_ips.append(ip)
    for ip in stale_ips:
        failures.pop(ip, None)


def check_login_rate_limit(client_ip: str, now: float | None = None) -> None:
    import backend.main as main_mod

    if now is None:
        now = time.time()
    window = config.LOGIN_RATE_LIMIT_WINDOW_SECONDS
    max_attempts = config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS
    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    with lock:
        _prune_stale_rate_limits_locked(now, window)
        timestamps = failures.get(client_ip, [])
        valid_timestamps = [t for t in timestamps if (now - t) < window]

        if len(valid_timestamps) != len(timestamps):
            if valid_timestamps:
                failures[client_ip] = valid_timestamps
            else:
                failures.pop(client_ip, None)

        if len(valid_timestamps) >= max_attempts:
            oldest_ts = valid_timestamps[0]
            retry_after = max(1, math.ceil(oldest_ts + window - now))
            logger.warning(
                f"Rate limit exceeded for client IP: {client_ip} "
                f"({len(valid_timestamps)} failed attempts). Retry-After: {retry_after}s"
            )
            raise HTTPException(
                status_code=429,
                detail="Too many failed login attempts. Please try again later.",
                headers={"Retry-After": str(retry_after)},
            )


def record_login_failure(client_ip: str, now: float | None = None) -> None:
    import backend.main as main_mod

    if now is None:
        now = time.time()
    window = config.LOGIN_RATE_LIMIT_WINDOW_SECONDS
    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    with lock:
        timestamps = failures.get(client_ip, [])
        valid_timestamps = [t for t in timestamps if (now - t) < window]
        valid_timestamps.append(now)
        failures[client_ip] = valid_timestamps


def reset_login_failures(client_ip: str) -> None:
    import backend.main as main_mod

    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    with lock:
        failures.pop(client_ip, None)


def clear_all_login_failures() -> None:
    import backend.main as main_mod

    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    with lock:
        failures.clear()


def create_session_token(app_pwd: str, client_id: str = "user") -> str:
    """Generate a stateless HMAC-SHA256 signed session token.

    Token format: <base64_payload>.<base64_sig>
    Guaranteed to never equal raw app_pwd.
    """
    if not app_pwd:
        return ""

    payload = {
        "u": str(client_id or "user"),
        "t": int(time.time()),
        "s": secrets.token_hex(8),
    }
    payload_json = json.dumps(payload, separators=(",", ":"), sort_keys=True)
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode("utf-8")).decode("utf-8").rstrip("=")

    sig = hmac.new(
        app_pwd.encode("utf-8"),
        payload_b64.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    sig_b64 = base64.urlsafe_b64encode(sig).decode("utf-8").rstrip("=")

    token = f"{payload_b64}.{sig_b64}"
    if token == app_pwd:
        raise ValueError("Session token must not match raw password")
    return token


def verify_session_token(token: str, app_pwd: str, max_age: int = 86400 * 7) -> bool:
    """Verify HMAC-SHA256 signed session token:

    1. Validates string format and extracts payload and signature.
    2. Performs constant-time signature comparison using hmac.compare_digest.
    3. Validates payload JSON, timestamp freshness (max_age), and future clock skew.
    Returns True if valid and unexpired; False otherwise.
    """
    if not token or not app_pwd:
        return False
    if not isinstance(token, str) or not isinstance(app_pwd, str):
        return False
    token = token.strip()
    if not token:
        return False

    parts = token.split(".")
    if len(parts) != 2:
        return False
    payload_b64, sig_b64 = parts
    if not payload_b64 or not sig_b64:
        return False

    try:
        # 1. Verify HMAC signature in constant time
        expected_sig = (
            base64.urlsafe_b64encode(
                hmac.new(
                    app_pwd.encode("utf-8"),
                    payload_b64.encode("utf-8"),
                    hashlib.sha256,
                ).digest()
            )
            .decode("utf-8")
            .rstrip("=")
        )

        if not hmac.compare_digest(sig_b64, expected_sig):
            return False

        # 2. Decode payload (restore base64 padding if needed)
        pad = len(payload_b64) % 4
        padded = payload_b64 + ("=" * ((4 - pad) % 4))
        raw_json = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        payload = json.loads(raw_json)

        # 3. Check timestamp
        t = payload.get("t")
        if not isinstance(t, (int, float)):
            return False

        now = time.time()
        # Prevent tokens from far future (>300s clock skew)
        if t > now + 300:
            return False
        # Expiry check
        return not (max_age is not None and (now - t) > max_age)

    except Exception:
        return False


def is_authenticated(request: Request, app_pwd: str) -> bool:
    if not app_pwd:
        return True

    header_candidates: list[str] = []

    # 1. X-Session-Token
    x_sess = request.headers.get("X-Session-Token")
    if x_sess is not None:
        header_candidates.append(x_sess.strip())

    # 2. X-App-Password
    x_pwd = request.headers.get("X-App-Password")
    if x_pwd is not None:
        header_candidates.append(x_pwd.strip())

    # 3. Authorization: Bearer <token>
    auth_header = request.headers.get("Authorization") or ""
    if auth_header.startswith("Bearer "):
        bearer_token = auth_header[7:].strip()
        if bearer_token:
            header_candidates.append(bearer_token)

    # If explicit header credentials were provided, evaluate them exclusively
    if header_candidates:
        for cand in header_candidates:
            if not cand:
                continue
            try:
                if verify_session_token(cand, app_pwd):
                    return True
                if hmac.compare_digest(cand.encode("utf-8"), app_pwd.encode("utf-8")):
                    return True
            except Exception:
                continue
        return False

    # Otherwise, check cookie credentials
    cookie_candidates: list[str] = []
    cookie_sess = request.cookies.get("session_token")
    if cookie_sess is not None:
        cookie_candidates.append(cookie_sess.strip())
    cookie_karaoke = request.cookies.get("karaoke_token")
    if cookie_karaoke is not None:
        cookie_candidates.append(cookie_karaoke.strip())

    for cand in cookie_candidates:
        if not cand:
            continue
        try:
            if verify_session_token(cand, app_pwd):
                return True
            if hmac.compare_digest(cand.encode("utf-8"), app_pwd.encode("utf-8")):
                return True
        except Exception:
            continue

    return False
