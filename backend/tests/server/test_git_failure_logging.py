"""A git command behind the update check that fails says why in the log, once per distinct
failure (the check runs on every health poll)."""

import logging
import subprocess
import types

import pytest

from backend import config


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(config, "_git_failures_logged", set())


def _warnings(caplog):
    return [r for r in caplog.records if r.levelno == logging.WARNING]


def test_a_failing_git_command_warns_once(monkeypatch, caplog):
    monkeypatch.setattr(
        config.subprocess,
        "run",
        lambda *a, **k: types.SimpleNamespace(returncode=128, stdout="", stderr="fatal: bad"),
    )
    caplog.set_level(logging.DEBUG, logger="karaoke_backend")
    if not (config.BASE_DIR / ".git").exists():
        pytest.skip("needs a git checkout")

    assert config._git_cmd(["ls-remote", "origin"]) == ""
    assert config._git_cmd(["ls-remote", "origin"]) == ""

    (warning,) = _warnings(caplog)
    assert "git ls-remote origin failed: fatal: bad" in warning.getMessage()
    assert any(
        r.levelno == logging.DEBUG and "fatal: bad" in r.getMessage() for r in caplog.records
    )


def test_a_timeout_is_reported(monkeypatch, caplog):
    def slow(*args, **kwargs):
        raise subprocess.TimeoutExpired(cmd="git", timeout=3)

    monkeypatch.setattr(config.subprocess, "run", slow)
    caplog.set_level(logging.WARNING, logger="karaoke_backend")
    if not (config.BASE_DIR / ".git").exists():
        pytest.skip("needs a git checkout")

    assert config._git_cmd(["fetch"]) == ""
    assert "TimeoutExpired" in _warnings(caplog)[0].getMessage()
