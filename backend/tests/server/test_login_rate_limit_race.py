"""Parallel wrong passphrases at POST /api/auth/login cannot get past the login limit."""

import asyncio
import inspect
import time

import httpx
import pytest

import backend.routers.auth as auth_router
from backend import auth, config
from backend.main import app

PASSPHRASE = "login-race-passphrase"
CLIENT = {"X-Forwarded-For": "198.51.100.77"}


@pytest.fixture(autouse=True)
def limits(monkeypatch):
    monkeypatch.setattr(config, "APP_PASSWORD", PASSPHRASE)
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_MAX_ATTEMPTS", 5)
    monkeypatch.setattr(config, "LOGIN_RATE_LIMIT_WINDOW_SECONDS", 60.0)


def test_the_login_handler_runs_on_the_event_loop():
    assert inspect.iscoroutinefunction(auth_router.auth_login)


def test_a_burst_of_wrong_passphrases_is_counted_up_to_the_limit(monkeypatch):
    real_check = auth_router.check_login_rate_limit

    def slow_check(client_ip, *args, **kwargs):
        # Widens the gap between the check and the count: handled in worker threads, every
        # request would pass the check before any failure was recorded
        time.sleep(0.01)
        return real_check(client_ip, *args, **kwargs)

    monkeypatch.setattr(auth_router, "check_login_rate_limit", slow_check)

    async def burst():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as ac:
            return await asyncio.gather(
                *(
                    ac.post("/api/auth/login", json={"password": f"guess-{i}"}, headers=CLIENT)
                    for i in range(20)
                )
            )

    responses = asyncio.run(burst())
    codes = sorted(res.status_code for res in responses)
    assert codes.count(401) == config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS
    assert codes.count(429) == 20 - config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS
    assert len(auth._login_failures["198.51.100.77"]) == config.LOGIN_RATE_LIMIT_MAX_ATTEMPTS
