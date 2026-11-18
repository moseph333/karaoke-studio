"""The server's own version and commit.

Two faults: config.APP_VERSION was worked out before the repo's .env was read, so an
APP_VERSION set there never reached it; and every GET /api/health asked git for the version
and the commit again, two processes per request on a route that browsers and health checks
poll."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from backend import config


@pytest.fixture
def git_calls(monkeypatch):
    """A git that answers describe and rev-parse, counting the questions; the remote was
    checked already, so nothing asks about it."""
    calls = []

    def fake_git(args, timeout=3.0):
        calls.append(args[0])
        return {"describe": "v9.9.9-3-gabc1234", "rev-parse": "abc1234" + "0" * 33}[args[0]]

    monkeypatch.setattr(config, "_git_cmd", fake_git)
    monkeypatch.setattr(config, "_LOCAL_GIT", {})
    monkeypatch.setitem(config._UPDATE_CACHE, "latest_version", "v9.9.9")
    monkeypatch.delenv("APP_VERSION", raising=False)
    return calls


def test_health_checks_ask_git_once_per_process(client, git_calls):
    answers = [client.get("/api/health").json() for _ in range(3)]

    assert [a["version"] for a in answers] == ["v9.9.9-3-gabc1234"] * 3
    assert sorted(git_calls) == ["describe", "rev-parse"]


def test_the_commit_is_the_one_the_process_started_with(git_calls, monkeypatch):
    first = config.check_for_updates()
    # The updater checks out the next commit while this process keeps running the old code
    monkeypatch.setattr(config, "_git_cmd", lambda args, timeout=3.0: "fff9999" + "0" * 33)

    assert config.check_for_updates()["local_commit"] == first["local_commit"]
    assert config.get_app_version() == "v9.9.9-3-gabc1234"


def test_a_git_that_failed_is_asked_again(monkeypatch):
    answers = iter(["", "v1.2.3"])
    monkeypatch.setattr(config, "_git_cmd", lambda args, timeout=3.0: next(answers))
    monkeypatch.setattr(config, "_LOCAL_GIT", {})
    monkeypatch.delenv("APP_VERSION", raising=False)

    assert config.get_app_version() == config.DEFAULT_APP_VERSION
    assert config.get_app_version() == "v1.2.3"


def test_app_version_in_the_environment_still_wins_on_every_call(git_calls, monkeypatch):
    assert config.get_app_version() == "v9.9.9-3-gabc1234"
    monkeypatch.setenv("APP_VERSION", "v1.6.0-test")
    assert config.get_app_version() == "v1.6.0-test"


def test_app_version_set_in_dot_env_reaches_the_module_constant(tmp_path):
    # A copy of config.py in a checkout of its own, whose .env names the version
    (tmp_path / "backend").mkdir()
    shutil.copy(Path(config.__file__), tmp_path / "backend" / "config.py")
    (tmp_path / ".env").write_text(
        f"APP_VERSION=v7.7.7-env\nKARAOKE_DATA_DIR={tmp_path / 'data'}\n", encoding="utf-8"
    )
    env = {k: v for k, v in os.environ.items() if k not in ("APP_VERSION", "PYTHONPATH")}

    out = subprocess.run(
        [sys.executable, "-c", "import backend.config as c; print(c.APP_VERSION)"],
        cwd=tmp_path,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )

    assert out.stdout.strip() == "v7.7.7-env"
