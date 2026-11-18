"""scripts/update_when_idle.sh moves to a new commit only once its CI run passed, builds the new
image first, pauses new jobs, waits until the server reports none running (or stops answering,
or the limit passes), and only then recreates the container. Runs the real script against a
throwaway git origin with a fake compose command and a fake GitHub API."""

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
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

    def push_new_commit(self, content: str = "v2") -> str:
        (self.upstream / "app.txt").write_text(f"{content}\n")
        _git(self.upstream, "commit", "--quiet", "-am", content)
        _git(self.upstream, "push", "--quiet", "origin", "HEAD:main")
        return _git(self.upstream, "rev-parse", "HEAD")

    def tag_origin_head(self, name: str) -> None:
        _git(self.upstream, "tag", name)
        _git(self.upstream, "push", "--quiet", "origin", name)

    def deployed(self) -> str:
        return (self.checkout / "app.txt").read_text().strip()

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


# --- The CI check -----------------------------------------------------------------------------


def _run_reply(status: str | None, conclusion: str | None = None, compact: bool = False) -> str:
    """GitHub's reply to "list this workflow's runs for a commit", with the keys in its order.
    status None is a commit without a run."""
    runs = []
    if status is not None:
        runs.append(
            {
                "id": 1,
                "name": "CI",
                "head_branch": "main",
                # A commit subject that looks like the fields the script reads
                "display_title": 'fix: report "status": "completed" and "conclusion": "success"',
                "event": "push",
                "status": status,
                "conclusion": conclusion,
                "workflow_id": 7,
                "pull_requests": [],
                "actor": {"login": "someone", "type": "User"},
                "head_commit": {"id": "abc", "message": "v2"},
                "repository": {"name": "app", "private": False},
            }
        )
    body = {"total_count": len(runs), "workflow_runs": runs}
    return json.dumps(body) if compact else json.dumps(body, indent=2)


PASSED = _run_reply("completed", "success")
FAILED = _run_reply("completed", "failure")
RUNNING = _run_reply("in_progress")
QUEUED = _run_reply("queued")
NO_RUN = _run_reply(None)


class FakeGitHub:
    """Answers the Actions API with the given replies in turn (the last one repeats). A reply
    is a JSON body (200) or an HTTP status code."""

    def __init__(self, *replies: str | int):
        self.replies = list(replies)
        self.requests: list[str] = []
        self.auth: list[str | None] = []
        self.on_request = None
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                fake.requests.append(self.path)
                fake.auth.append(self.headers.get("Authorization"))
                if fake.on_request:
                    fake.on_request(len(fake.requests))
                reply = fake.replies.pop(0) if len(fake.replies) > 1 else fake.replies[0]
                code, body = (reply, "{}") if isinstance(reply, int) else (200, reply)
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body.encode())

            def log_message(self, *_args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self._thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def env(self, **extra: str) -> dict[str, str]:
        return {
            "UPDATE_CI_API_URL": self.url,
            "UPDATE_CI_REPO": "acme/app",
            "UPDATE_CI_POLL_SEC": "0.1",
            **extra,
        }

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *_exc):
        self.server.shutdown()
        self.server.server_close()
        self._thread.join()


def test_a_commit_whose_ci_passed_is_deployed(install):
    sha = install.push_new_commit()

    with FakeGitHub(PASSED) as github:
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert f"CI passed for {sha[:7]}" in res.stdout
    assert install.deployed() == "v2"
    assert install.compose_calls() == ["build marker=absent", "up -d marker=present"]
    assert github.requests == [
        f"/repos/acme/app/actions/workflows/ci.yml/runs?head_sha={sha}&per_page=1"
    ]
    assert github.auth == [None]


def test_a_commit_whose_ci_failed_is_not_deployed(install):
    sha = install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert f"CI did not pass for {sha[:7]} (failure)" in res.stdout
    assert "UPDATE_REQUIRE_CI=0" in res.stdout
    assert install.deployed() == "v1"
    assert install.compose_calls() == []
    assert not (install.data / ".update_draining").exists()


@pytest.mark.parametrize("conclusion", ["cancelled", "timed_out", "skipped", "action_required"])
def test_only_a_successful_run_counts_as_passed(install, conclusion):
    install.push_new_commit()

    with FakeGitHub(_run_reply("completed", conclusion)) as github:
        res = install.run(**github.env())

    assert f"({conclusion})" in res.stdout
    assert install.deployed() == "v1"


def test_it_waits_for_a_run_that_is_still_going(install):
    install.push_new_commit()

    with FakeGitHub(QUEUED, RUNNING, RUNNING, PASSED) as github:
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert len(github.requests) == 4
    assert install.deployed() == "v2"


def test_a_run_still_going_at_the_limit_leaves_the_update_for_the_next_call(install):
    sha = install.push_new_commit()

    with FakeGitHub(RUNNING) as github:
        held = install.run(**github.env(UPDATE_CI_WAIT_SEC="1"))
        assert held.returncode == 0, held.stderr
        assert f"CI is still running for {sha[:7]}" in held.stdout
        assert install.deployed() == "v1"
        assert install.compose_calls() == []

        github.replies = [PASSED]
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert install.deployed() == "v2"


def test_the_first_reply_in_a_compact_body_is_read_too(install):
    install.push_new_commit()

    with FakeGitHub(_run_reply("completed", "failure", compact=True)) as github:
        res = install.run(**github.env())

    assert "(failure)" in res.stdout
    assert install.deployed() == "v1"


@pytest.mark.parametrize("code", [403, 404, 500])
def test_an_api_that_gives_no_result_does_not_hold_the_update(install, code):
    install.push_new_commit()

    with FakeGitHub(code) as github:
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert f"answered HTTP {code}" in res.stdout
    assert "updating without it" in res.stdout
    assert install.deployed() == "v2"


def test_an_api_that_cannot_be_reached_does_not_hold_the_update(install):
    install.push_new_commit()
    with FakeGitHub(PASSED) as github:
        env = github.env()  # the port is closed again once the block ends

    res = install.run(**env)

    assert res.returncode == 0, res.stderr
    assert "did not answer" in res.stdout
    assert install.deployed() == "v2"


@pytest.mark.parametrize("unreadable", [500, 403, NO_RUN])
def test_a_commit_seen_failing_is_not_deployed_when_a_later_call_reads_no_result(
    install, unreadable
):
    sha = install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        install.run(**github.env())
        assert install.deployed() == "v1"

        github.replies = [unreadable]
        res = install.run(**github.env(UPDATE_CI_WAIT_SEC="1"))

    assert res.returncode == 0, res.stderr
    assert "an earlier call saw" in res.stdout
    assert sha[:7] in res.stdout
    assert install.deployed() == "v1"
    assert install.compose_calls() == []


def test_a_commit_seen_failing_is_not_deployed_when_the_api_is_down_later(install):
    install.push_new_commit()
    with FakeGitHub(FAILED) as github:
        env = github.env()
        install.run(**env)

    res = install.run(**env)  # the port is closed now

    assert res.returncode == 0, res.stderr
    assert "did not answer" in res.stdout
    assert install.deployed() == "v1"
    assert install.compose_calls() == []


def test_a_run_left_going_is_not_deployed_when_a_later_call_reads_no_result(install):
    install.push_new_commit()

    with FakeGitHub(RUNNING) as github:
        install.run(**github.env(UPDATE_CI_WAIT_SEC="1"))
        github.replies = [500]
        res = install.run(**github.env())
        assert install.deployed() == "v1"
        assert install.compose_calls() == []

        github.replies = [PASSED]
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert install.deployed() == "v2"
    assert not (install.data / ".update_ci_hold").exists()


def test_a_fix_pushed_after_a_failed_commit_is_judged_on_its_own(install):
    install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        install.run(**github.env())
        install.push_new_commit("v3")
        github.replies = [500]
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert "updating without it" in res.stdout
    assert install.deployed() == "v3"


def test_the_check_switched_off_deploys_a_commit_seen_failing(install):
    install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        install.run(**github.env())
        res = install.run(**github.env(UPDATE_REQUIRE_CI="0"))

    assert res.returncode == 0, res.stderr
    assert install.deployed() == "v2"


def test_a_lost_connection_while_a_run_is_going_keeps_waiting(install):
    install.push_new_commit()

    with FakeGitHub(RUNNING, 500) as github:
        res = install.run(**github.env(UPDATE_CI_WAIT_SEC="1"))

    assert res.returncode == 0, res.stderr
    assert "CI is still running" in res.stdout
    assert install.deployed() == "v1"


def test_a_commit_without_a_ci_run_is_deployed_and_says_so(install):
    sha = install.push_new_commit()

    with FakeGitHub(NO_RUN) as github:
        res = install.run(**github.env(UPDATE_CI_WAIT_SEC="1"))

    assert res.returncode == 0, res.stderr
    assert f"No CI run exists for {sha[:7]}" in res.stdout
    assert len(github.requests) > 1  # it gave the run a moment to appear
    assert install.deployed() == "v2"


def test_a_run_that_appears_a_moment_after_the_push_is_followed(install):
    install.push_new_commit()

    with FakeGitHub(NO_RUN, QUEUED, FAILED) as github:
        res = install.run(**github.env())

    assert "CI did not pass" in res.stdout
    assert install.deployed() == "v1"


def test_the_check_can_be_switched_off(install):
    install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        res = install.run(**github.env(UPDATE_REQUIRE_CI="0"))

    assert res.returncode == 0, res.stderr
    assert github.requests == []
    assert install.deployed() == "v2"


def test_the_switch_and_the_token_are_read_from_the_env_file(install):
    install.push_new_commit()
    (install.checkout / ".env").write_text("UPDATE_CI_TOKEN=ghp_example\n")

    with FakeGitHub(PASSED) as github:
        res = install.run(**github.env())
        assert res.returncode == 0, res.stderr
        assert github.auth == ["Bearer ghp_example"]

        install.push_new_commit("v3")
        (install.checkout / ".env").write_text("UPDATE_REQUIRE_CI=0\n")
        github.requests.clear()
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert github.requests == []
    assert install.deployed() == "v3"


def test_a_forced_rebuild_of_the_running_commit_is_not_checked(install):
    with FakeGitHub(FAILED) as github:
        res = install.run("--force", **github.env())

    assert res.returncode == 0, res.stderr
    assert github.requests == []
    assert install.compose_calls() == ["build marker=absent", "up -d marker=present"]


def test_force_does_not_skip_the_check_for_a_new_commit(install):
    install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        res = install.run("--force", **github.env())

    assert res.returncode == 0, res.stderr
    assert install.deployed() == "v1"
    assert install.compose_calls() == []


def test_it_deploys_the_commit_it_checked_even_if_the_branch_moved_meanwhile(install):
    checked = install.push_new_commit()

    with FakeGitHub(RUNNING, PASSED) as github:
        # Another commit lands while CI for the first is still going
        github.on_request = lambda n: install.push_new_commit("v3") if n == 1 else None
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert install.deployed() == "v2"
    assert _git(install.checkout, "rev-parse", "HEAD") == checked
    assert all(checked in path for path in github.requests)


def test_a_release_tag_arrives_with_the_commit_even_when_it_was_made_during_the_wait(install):
    install.push_new_commit()

    with FakeGitHub(RUNNING, PASSED) as github:
        github.on_request = lambda n: install.tag_origin_head("v9.9.9") if n == 1 else None
        res = install.run(**github.env())

    assert res.returncode == 0, res.stderr
    assert _git(install.checkout, "describe", "--tags", "--always") == "v9.9.9"


def test_the_repository_is_read_from_a_github_origin(install):
    sha = install.push_new_commit()
    # The checkout names GitHub as its origin; git fetches from the local one behind it
    for url in ("https://github.com/acme/app.git", "git@github.com:acme/app"):
        _git(install.checkout, "config", f"url.{install.origin}.insteadOf", url)
        _git(install.checkout, "config", "remote.origin.url", url)
        with FakeGitHub(FAILED) as github:
            env = github.env()
            del env["UPDATE_CI_REPO"]
            res = install.run(**env)
        assert res.returncode == 0, res.stderr
        assert github.requests[0].startswith(
            f"/repos/acme/app/actions/workflows/ci.yml/runs?head_sha={sha}"
        )


def test_an_origin_that_is_not_on_github_is_updated_without_a_check(install):
    install.push_new_commit()

    with FakeGitHub(FAILED) as github:
        env = github.env()
        del env["UPDATE_CI_REPO"]
        res = install.run(**env)

    assert res.returncode == 0, res.stderr
    assert "origin is not a GitHub repository" in res.stdout
    assert github.requests == []
    assert install.deployed() == "v2"
