"""scripts/update_when_idle.sh builds the new image first, pauses new jobs, waits until the server
reports none running (or stops answering, or the limit passes), and only then recreates the
container. Runs the real script against a throwaway git origin with a fake compose command."""

import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[3] / "scripts" / "update_when_idle.sh"

pytestmark = pytest.mark.skipif(
    shutil.which("bash") is None or shutil.which("git") is None, reason="needs bash and git"
)

GIT_ENV = {
    "GIT_AUTHOR_NAME": "test",
    "GIT_AUTHOR_EMAIL": "test@example.invalid",
    "GIT_COMMITTER_NAME": "test",
    "GIT_COMMITTER_EMAIL": "test@example.invalid",
    "GIT_CONFIG_GLOBAL": os.devnull,
    "GIT_CONFIG_SYSTEM": os.devnull,
}


def _git(cwd: Path, *args: str) -> str:
    env = {**os.environ, **GIT_ENV}
    return subprocess.run(
        ["git", *args], cwd=cwd, env=env, check=True, capture_output=True, text=True
    ).stdout.strip()


class Install:
    """A checkout like /opt/karaoke-studio, its origin, a data folder and a fake compose."""

    def __init__(self, root: Path):
        self.origin = root / "origin.git"
        self.checkout = root / "checkout"
        self.upstream = root / "upstream"
        self.data = root / "data"
        self.calls = root / "compose_calls.log"
        self.compose = root / "fake_compose.sh"
        _git(root, "init", "--quiet", "--bare", "-b", "main", str(self.origin))
        _git(root, "clone", "--quiet", str(self.origin), str(self.upstream))
        (self.upstream / "scripts").mkdir()
        shutil.copy(SCRIPT, self.upstream / "scripts" / "update_when_idle.sh")
        (self.upstream / "app.txt").write_text("v1\n")
        _git(self.upstream, "add", ".")
        _git(self.upstream, "commit", "--quiet", "-m", "v1")
        _git(self.upstream, "push", "--quiet", "origin", "HEAD:main")
        _git(root, "clone", "--quiet", str(self.origin), str(self.checkout))
        # Logs each call with whether the drain marker existed at that moment
        self.compose.write_text(
            "#!/usr/bin/env bash\n"
            f'marker="{self.data}/.update_draining"\n'
            'state=absent; [[ -f "$marker" ]] && state=present\n'
            f'echo "$* marker=$state" >> "{self.calls}"\n'
            '[[ "$1" == build && -n "${FAIL_BUILD:-}" ]] && exit 1\n'
            "exit 0\n"
        )
        self.compose.chmod(0o755)

    def push_new_commit(self) -> None:
        (self.upstream / "app.txt").write_text("v2\n")
        _git(self.upstream, "commit", "--quiet", "-am", "v2")
        _git(self.upstream, "push", "--quiet", "origin", "HEAD:main")

    def run(self, *args: str, timeout: float = 30, **env: str) -> subprocess.CompletedProcess:
        full_env = {
            **os.environ,
            **GIT_ENV,
            "KARAOKE_DATA_DIR": str(self.data),
            "COMPOSE_CMD": str(self.compose),
            "UPDATE_DRAIN_POLL_SEC": "0.1",
            **env,
        }
        return subprocess.run(
            ["bash", str(self.checkout / "scripts" / "update_when_idle.sh"), *args],
            env=full_env,
            capture_output=True,
            text=True,
            timeout=timeout,
        )

    def compose_calls(self) -> list[str]:
        return self.calls.read_text().splitlines() if self.calls.exists() else []

    def write_jobs(self, count: int) -> None:
        self.data.mkdir(exist_ok=True)
        tmp = self.data / ".jobs_active.tmp"
        tmp.write_text(f'{{"count": {count}, "kinds": {{}}, "updated_at": {time.time()}}}')
        os.replace(tmp, self.data / ".jobs_active")


class FakeServer:
    """Rewrites .jobs_active like the server's heartbeat, with a count the test can change."""

    def __init__(self, install: Install, count: int):
        self.install = install
        self.count = count
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._beat, daemon=True)

    def _beat(self):
        while not self._stop.is_set():
            self.install.write_jobs(self.count)
            self._stop.wait(0.2)

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self._stop.set()
        self._thread.join()


@pytest.fixture
def install(tmp_path):
    return Install(tmp_path)


def test_nothing_new_means_no_build_and_no_restart(install):
    res = install.run()

    assert res.returncode == 0, res.stderr
    assert "nothing to update" in res.stdout
    assert install.compose_calls() == []


def test_force_rebuilds_without_a_new_commit(install):
    res = install.run("--force")

    assert res.returncode == 0, res.stderr
    assert install.compose_calls() == ["build marker=absent", "up -d marker=present"]


def test_an_unknown_argument_is_refused(install):
    res = install.run("--now")

    assert res.returncode == 2
    assert install.compose_calls() == []


def test_it_builds_before_pausing_jobs_and_restarts_when_idle(install):
    install.push_new_commit()

    with FakeServer(install, count=0):
        res = install.run()

    assert res.returncode == 0, res.stderr
    assert "no jobs are running" in res.stdout
    assert install.compose_calls() == ["build marker=absent", "up -d marker=present"]
    assert (install.checkout / "app.txt").read_text() == "v2\n"
    assert not (install.data / ".update_draining").exists()


def test_it_waits_for_a_running_job_to_finish(install):
    install.push_new_commit()

    with FakeServer(install, count=1) as server:
        threading.Timer(2.5, lambda: setattr(server, "count", 0)).start()
        started = time.monotonic()
        res = install.run()
        waited = time.monotonic() - started

    assert res.returncode == 0, res.stderr
    assert waited >= 2.0
    assert "no jobs are running" in res.stdout
    assert install.compose_calls()[-1] == "up -d marker=present"


def test_it_restarts_anyway_once_the_limit_passes(install):
    install.push_new_commit()

    with FakeServer(install, count=2):
        res = install.run(UPDATE_DRAIN_MAX_SEC="1")

    assert res.returncode == 0, res.stderr
    assert "the limit" in res.stdout
    assert "2 job(s) will be interrupted" in res.stdout
    assert install.compose_calls()[-1] == "up -d marker=present"


def test_a_server_that_stopped_reporting_does_not_hold_the_update(install):
    install.push_new_commit()
    install.write_jobs(3)
    old = time.time() - 600
    os.utime(install.data / ".jobs_active", (old, old))

    res = install.run()

    assert res.returncode == 0, res.stderr
    assert "has not reported its jobs" in res.stdout
    assert install.compose_calls()[-1] == "up -d marker=present"


def test_a_server_without_the_job_report_is_updated_at_once(install):
    install.push_new_commit()

    res = install.run()

    assert res.returncode == 0, res.stderr
    assert "does not report its jobs" in res.stdout


def test_a_failed_build_keeps_the_old_container_and_pauses_nothing(install):
    install.push_new_commit()

    res = install.run(FAIL_BUILD="1")

    assert res.returncode != 0
    assert install.compose_calls() == ["build marker=absent"]
    assert not (install.data / ".update_draining").exists()


def test_the_limit_is_read_from_the_env_file(install):
    install.push_new_commit()
    (install.checkout / ".env").write_text('UPDATE_DRAIN_MAX_SEC="1"\n')

    with FakeServer(install, count=1):
        res = install.run()

    assert res.returncode == 0, res.stderr
    assert "waiting up to 1s" in res.stdout
