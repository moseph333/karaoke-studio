"""The release automation's files agree with the repository: release-please bumps the version
in files that exist and carry the version it thinks is current, and the updater's CI check
looks for a workflow that exists and runs for commits on main."""

import json
import re
from pathlib import Path

from backend.config import DEFAULT_APP_VERSION

REPO = Path(__file__).resolve().parents[3]
CONFIG = json.loads((REPO / "release-please-config.json").read_text())
MANIFEST = json.loads((REPO / ".release-please-manifest.json").read_text())
PACKAGE = CONFIG["packages"]["."]


def test_every_version_file_carries_the_manifest_version():
    version = MANIFEST["."]
    package = json.loads((REPO / "frontend" / "package.json").read_text())
    lock = json.loads((REPO / "frontend" / "package-lock.json").read_text())

    assert re.fullmatch(r"\d+\.\d+\.\d+", version)
    assert f"v{version}" == DEFAULT_APP_VERSION
    assert package["version"] == version
    assert lock["version"] == version
    assert lock["packages"][""]["version"] == version


def test_release_please_updates_exactly_those_files():
    paths = [entry if isinstance(entry, str) else entry["path"] for entry in PACKAGE["extra-files"]]

    assert set(paths) == {
        "backend/config.py",
        "frontend/package.json",
        "frontend/package-lock.json",
    }
    for path in paths:
        assert (REPO / path).is_file(), path
    # Both places the lock states the app's own version
    lock_paths = {
        entry["jsonpath"]
        for entry in PACKAGE["extra-files"]
        if isinstance(entry, dict) and entry["path"] == "frontend/package-lock.json"
    }
    assert lock_paths == {"$.version", "$.packages[''].version"}


def test_the_default_version_line_is_the_one_marked_for_release_please():
    marked = [
        line
        for line in (REPO / "backend" / "config.py").read_text().splitlines()
        if "x-release-please-version" in line
    ]

    assert marked == [f'DEFAULT_APP_VERSION = "{DEFAULT_APP_VERSION}"  # x-release-please-version']


def test_tags_keep_the_plain_v_prefix_of_earlier_releases():
    assert CONFIG["include-component-in-tag"] is False
    assert PACKAGE["release-type"] == "simple"
    # The simple type would also bump a version.txt; the repository has none
    assert not (REPO / "version.txt").exists()


def test_the_release_workflow_runs_on_main_with_the_default_file_names():
    workflow = (REPO / ".github" / "workflows" / "release-please.yml").read_text()

    assert "googleapis/release-please-action@v4" in workflow
    assert re.search(r"on:\s*\n\s+push:\s*\n\s+branches: \[main\]", workflow)
    for permission in ("contents: write", "pull-requests: write"):
        assert permission in workflow
    # No config-file / manifest-file inputs: the action reads the two default names
    assert "config-file" not in workflow and "manifest-file" not in workflow


def test_the_updater_checks_a_ci_workflow_that_runs_for_commits_on_main():
    script = (REPO / "scripts" / "update_when_idle.sh").read_text()
    name = re.search(r'CI_WORKFLOW="\$\{UPDATE_CI_WORKFLOW:-([^}]+)\}"', script).group(1)
    workflow = (REPO / ".github" / "workflows" / name).read_text()

    assert re.search(r"on:\s*\n\s+push:\s*\n\s+branches: \[main\]", workflow)
