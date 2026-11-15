"""The API reference page loads its viewer only if the CDN file matches the pinned hash."""

import re

from backend.routers.api_docs import SCALAR_INTEGRITY, SCALAR_SCRIPT, SCALAR_VERSION


def test_the_viewer_script_carries_its_integrity_hash(client):
    html = client.get("/api/docs").text
    tag = re.search(r"<script src=\"([^\"]+)\"([^>]*)>", html)
    assert tag and tag.group(1) == SCALAR_SCRIPT
    assert f'integrity="{SCALAR_INTEGRITY}"' in tag.group(2)
    assert 'crossorigin="anonymous"' in tag.group(2)


def test_the_hash_names_one_exact_file():
    # A hash is only stable for an exact file of an exact version, never a package default
    assert SCALAR_SCRIPT.endswith(f"@{SCALAR_VERSION}/dist/browser/standalone.js")
    assert re.fullmatch(r"sha384-[A-Za-z0-9+/]{64}", SCALAR_INTEGRITY)
