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
# Wrong credentials already counted, per client IP: fingerprint -> when it was counted. A stale
# token resent by every request then costs one attempt per window, not one per request.
_counted_guesses: dict[str, dict[str, float]] = {}
# Fingerprints are keyed with a per-process secret, so no plain hash of a guess is kept
_GUESS_FINGERPRINT_KEY = secrets.token_bytes(32)
# When each client IP's refusal was last logged. Every request a limited client sends with
# credentials (polling, saves, media) is refused, so it is logged at most once per window.
_rate_limit_logged: dict[str, float] = {}


def get_client_ip(request: Request) -> str:
    # Each proxy appends the address it received the request from. With N trusted proxies in
    # front of us (FORWARDED_TRUSTED_HOPS), the Nth entry from the end was written by the
    # outermost one; entries before it come from the client and could be forged to dodge the
    # rate limit. 0 ignores the header; a shorter header than expected uses its first entry.
    hops = config.FORWARDED_TRUSTED_HOPS
    xff = request.headers.get("x-forwarded-for") if hops > 0 else None
    if xff:
        entries = [entry.strip() for entry in xff.split(",") if entry.strip()]
        if entries:
            client_ip = entries[-hops] if len(entries) >= hops else entries[0]
            if client_ip.startswith("[") and "]" in client_ip:
                client_ip = client_ip[1 : client_ip.index("]")]
            elif ":" in client_ip and client_ip.count(":") == 1:
                client_ip = client_ip.split(":")[0]
            if client_ip:
                return client_ip
    if request.client and request.client.host:
        return request.client.host.strip()
    return "127.0.0.1"


def _prune_stale_rate_limits_locked(now: float, window: float) -> None:
    global _last_rate_limit_cleanup
    import backend.main as main_mod

    last_cleanup = getattr(main_mod, "_last_rate_limit_cleanup", _last_rate_limit_cleanup)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    if (now - last_cleanup < 300.0) and len(failures) < 1000 and len(_counted_guesses) < 1000:
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
    for ip in list(_counted_guesses):
        fresh = {fp: t for fp, t in _counted_guesses[ip].items() if (now - t) < window}
        if fresh:
            _counted_guesses[ip] = fresh
        else:
            del _counted_guesses[ip]
    for ip in [ip for ip, t in _rate_limit_logged.items() if (now - t) >= window]:
        del _rate_limit_logged[ip]


def check_login_rate_limit(client_ip: str, now: float | None = None) -> int:
    """Raise the 429 HTTPException while client_ip has used up its failures for the window;
    otherwise return how many more failures it has left. A refusal is logged at most once per
    client IP and window."""
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

        if len(valid_timestamps) < max_attempts:
            return max_attempts - len(valid_timestamps)
        retry_after = max(1, math.ceil(valid_timestamps[0] + window - now))
        log_refusal = (now - _rate_limit_logged.get(client_ip, -math.inf)) >= window
        if log_refusal:
            _rate_limit_logged[client_ip] = now

    if log_refusal:
        logger.warning(
            f"Rate limit exceeded for client IP: {client_ip} "
            f"({len(valid_timestamps)} failed attempts). Retry-After: {retry_after}s. "
            f"Further refusals for this IP are not logged for {window:g}s"
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


def _guess_fingerprint(credential: str) -> str:
    return hmac.new(_GUESS_FINGERPRINT_KEY, credential.encode("utf-8"), hashlib.sha256).hexdigest()


def _counted_this_window(client_ip: str, credentials: list[str]) -> set[str]:
    """The credentials already counted as wrong for client_ip in the current window."""
    import backend.main as main_mod

    now = time.time()
    window = config.LOGIN_RATE_LIMIT_WINDOW_SECONDS
    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    with lock:
        seen = _counted_guesses.get(client_ip, {})
        return {
            credential
            for credential in credentials
            if (now - seen.get(_guess_fingerprint(credential), -math.inf)) < window
        }


def record_credential_failure(client_ip: str, credential: str, now: float | None = None) -> bool:
    """Count a wrong credential against client_ip's login limit, once per distinct value per
    window. Returns whether it counted."""
    import backend.main as main_mod

    if now is None:
        now = time.time()
    window = config.LOGIN_RATE_LIMIT_WINDOW_SECONDS
    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    fingerprint = _guess_fingerprint(credential)

    with lock:
        seen = {
            fp: t for fp, t in _counted_guesses.get(client_ip, {}).items() if (now - t) < window
        }
        if fingerprint in seen:
            _counted_guesses[client_ip] = seen
            return False
        seen[fingerprint] = now
        _counted_guesses[client_ip] = seen
    # record_login_failure takes the same (non-reentrant) lock
    record_login_failure(client_ip, now=now)
    return True


def reset_login_failures(client_ip: str) -> None:
    import backend.main as main_mod

    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    with lock:
        failures.pop(client_ip, None)
        _counted_guesses.pop(client_ip, None)


def clear_all_login_failures() -> None:
    import backend.main as main_mod

    lock = getattr(main_mod, "LOGIN_RATE_LIMIT_LOCK", LOGIN_RATE_LIMIT_LOCK)
    failures = getattr(main_mod, "_login_failures", _login_failures)

    with lock:
        failures.clear()
        _counted_guesses.clear()
        _rate_limit_logged.clear()


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


def _token_status(token: str, app_pwd: str, max_age: int = 86400 * 7) -> str:
    """Classify a session token as "valid", "signed" or "invalid".

    "signed" means the HMAC matches the passphrase but the payload is unreadable, expired or
    more than 300 s in the future: whoever sent it knew the passphrase, so it is not a guess.
    "invalid" covers malformed tokens and wrong signatures.
    """
    if not token or not app_pwd:
        return "invalid"
    if not isinstance(token, str) or not isinstance(app_pwd, str):
        return "invalid"
    token = token.strip()
    if not token:
        return "invalid"

    parts = token.split(".")
    if len(parts) != 2:
        return "invalid"
    payload_b64, sig_b64 = parts
    if not payload_b64 or not sig_b64:
        return "invalid"

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
            return "invalid"
    except Exception:
        return "invalid"

    try:
        # 2. Decode payload (restore base64 padding if needed)
        pad = len(payload_b64) % 4
        padded = payload_b64 + ("=" * ((4 - pad) % 4))
        raw_json = base64.urlsafe_b64decode(padded.encode("utf-8")).decode("utf-8")
        payload = json.loads(raw_json)

        # 3. Check timestamp
        t = payload.get("t")
        if not isinstance(t, (int, float)):
            return "signed"

        now = time.time()
        # Prevent tokens from far future (>300s clock skew)
        if t > now + 300:
            return "signed"
        # Expiry check
        if max_age is not None and (now - t) > max_age:
            return "signed"
        return "valid"
    except Exception:
        return "signed"


def verify_session_token(token: str, app_pwd: str, max_age: int = 86400 * 7) -> bool:
    """Verify HMAC-SHA256 signed session token:

    1. Validates string format and extracts payload and signature.
    2. Performs constant-time signature comparison using hmac.compare_digest.
    3. Validates payload JSON, timestamp freshness (max_age), and future clock skew.
    Returns True if valid and unexpired; False otherwise.
    """
    return _token_status(token, app_pwd, max_age) == "valid"


def _presented_credentials(request: Request) -> tuple[list[str], bool]:
    """The credentials a request presents, and whether they came from cookies.

    Headers win: an X-Session-Token or X-App-Password header (even a blank one) or a non-blank
    Bearer value means only the non-blank header values count, so a bad header never falls
    back to a cookie. Otherwise the non-blank session_token and karaoke_token cookies count.
    """
    header_present = False
    header_values: list[str] = []

    # 1. X-Session-Token
    x_sess = request.headers.get("X-Session-Token")
    if x_sess is not None:
        header_present = True
        header_values.append(x_sess.strip())

    # 2. X-App-Password
    x_pwd = request.headers.get("X-App-Password")
    if x_pwd is not None:
        header_present = True
        header_values.append(x_pwd.strip())

    # 3. Authorization: Bearer <token>
    auth_header = request.headers.get("Authorization") or ""
    if auth_header.startswith("Bearer "):
        bearer_token = auth_header[7:].strip()
        if bearer_token:
            header_present = True
            header_values.append(bearer_token)

    if header_present:
        return [value for value in header_values if value], False

    cookie_values: list[str] = []
    for name in ("session_token", "karaoke_token"):
        value = request.cookies.get(name)
        if value is not None and value.strip():
            cookie_values.append(value.strip())
    return cookie_values, True


def _credential_status(cand: str, app_pwd: str) -> str:
    """ "valid" for a valid session token or the passphrase, "signed" for a token signed with
    the passphrase that is expired or unreadable, else "invalid"."""
    status = "invalid"
    try:
        status = _token_status(cand, app_pwd)
        if status == "valid":
            return "valid"
        if hmac.compare_digest(cand.encode("utf-8"), app_pwd.encode("utf-8")):
            return "valid"
    except Exception:
        pass
    return status


def _check_credentials(
    creds: list[str],
    app_pwd: str,
    allowance: int | None = None,
    known_wrong: frozenset[str] | set[str] = frozenset(),
) -> tuple[bool, list[str]]:
    """(authenticated, guesses): whether any credential is a valid session token or the
    passphrase, and the distinct failed ones that count as guesses (not those signed with the
    passphrase, which are only expired or unreadable).

    With an allowance, at most that many distinct values outside known_wrong (the ones already
    counted this window) are compared and the rest are skipped, so a request carrying several
    values cannot test more guesses than the rate limit has room for."""
    guesses: list[str] = []
    for cand in dict.fromkeys(creds):
        if allowance is not None and cand not in known_wrong:
            if allowance <= 0:
                continue
            allowance -= 1
        status = _credential_status(cand, app_pwd)
        if status == "valid":
            return True, []
        if status == "invalid":
            guesses.append(cand)
    return False, guesses


def is_authenticated(request: Request, app_pwd: str) -> bool:
    """Whether the request carries a valid session or the passphrase. Counts nothing against
    the rate limit; request handling goes through authenticate_request."""
    if not app_pwd:
        return True
    creds, _from_cookies = _presented_credentials(request)
    return _check_credentials(creds, app_pwd)[0]


def authenticate_request(request: Request, app_pwd: str) -> tuple[bool, bool]:
    """Check the request's credentials under the login rate limit.

    Returns (authenticated, stale_cookie), where stale_cookie means the failed credentials
    came from cookies. A client IP over the limit gets the 429 HTTPException before anything
    is compared, so even a right guess cannot get through. Each distinct wrong value counts
    once per window, and a request is compared on no more new values than the limit has left;
    requests without credentials and tokens signed with the passphrase do not count.
    """
    if not app_pwd:
        return True, False
    creds, from_cookies = _presented_credentials(request)
    if not creds:
        return False, False
    client_ip = get_client_ip(request)
    allowance = check_login_rate_limit(client_ip)
    known_wrong = _counted_this_window(client_ip, creds)
    authenticated, guesses = _check_credentials(creds, app_pwd, allowance, known_wrong)
    if not authenticated:
        for guess in guesses:
            record_credential_failure(client_ip, guess)
    return authenticated, not authenticated and from_cookies


def authenticated_within_limit(request: Request, app_pwd: str) -> bool:
    """authenticate_request for routes that answer either way: False while the client IP is
    over the limit."""
    try:
        return authenticate_request(request, app_pwd)[0]
    except HTTPException:
        return False
