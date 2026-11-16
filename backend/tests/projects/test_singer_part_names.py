"""A song can name its singer parts ("Rapper", "Miho"); an emptied name goes back to the
default label."""

import json

import pytest

import backend.main as main_mod
from backend.main import projects
from backend.project_store import save_projects


@pytest.fixture
def song():
    projects["named"] = {
        "id": "named",
        "track_id": "named",
        "title": "Metaphysical (A Good Day)",
        "artist": "Handsome Boy Modeling School",
        "status": "ready",
        "lines": [],
    }
    save_projects()
    yield "named"
    projects.pop("named", None)


def test_parts_can_be_named_without_touching_title_or_artist(client, song):
    res = client.patch(
        f"/api/project/{song}", json={"part_names": {"singer1": " Rapper ", "singer2": "Miho"}}
    )
    assert res.status_code == 200
    assert res.json()["part_names"] == {"singer1": "Rapper", "singer2": "Miho"}
    assert res.json()["title"] == "Metaphysical (A Good Day)"
    stored = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))[song]
    assert stored["part_names"] == {"singer1": "Rapper", "singer2": "Miho"}


def test_an_emptied_name_goes_back_to_the_default(client, song):
    client.patch(
        f"/api/project/{song}", json={"part_names": {"singer1": "Rapper", "singer2": "Miho"}}
    )
    res = client.patch(f"/api/project/{song}", json={"part_names": {"singer1": ""}})
    assert res.json()["part_names"] == {"singer2": "Miho"}
    res = client.patch(f"/api/project/{song}", json={"part_names": {"singer2": "  "}})
    assert "part_names" not in res.json()


def test_unknown_parts_and_long_names_are_refused(client, song):
    assert (
        client.patch(f"/api/project/{song}", json={"part_names": {"singer3": "X"}}).status_code
        == 422
    )
    too_long = {"part_names": {"singer2": "M" * 41}}
    assert client.patch(f"/api/project/{song}", json=too_long).status_code == 422


def test_an_empty_request_is_still_refused(client, song):
    assert client.patch(f"/api/project/{song}", json={}).status_code == 400
