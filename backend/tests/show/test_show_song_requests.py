"""Song requests: a show's host files the songs it could not find, and the owner sees them in
the studio.

A request is the words the host typed, with who asked and the name of the night. It is kept
in the data folder, so it is there after a restart; a song asked for again is one request
counted again; the list is limited, and the studio removes a request once its song is made
or will not be."""

import errno
import json

import pytest

from backend.project_store import SAVE_FAILED_DETAIL
from backend.routers.show import NO_SONG_DETAIL
from backend.services import show_requests


def ask(client, song, singer=None, show=None):
    body = {"song": song}
    if singer is not None:
        body["singer"] = singer
    if show is not None:
        body["show"] = show
    return client.post("/api/show/requests", json=body)


def songs(client):
    return [entry["song"] for entry in client.get("/api/show/requests").json()["requests"]]


def test_no_song_has_been_asked_for_yet(client):
    assert client.get("/api/show/requests").json() == {"requests": []}


def test_a_request_keeps_the_song_who_asked_and_the_night(client, monkeypatch):
    monkeypatch.setattr(show_requests.time, "time", lambda: 1_800_000_000.7)

    res = ask(client, "Pink Pony Club", singer="Ana", show="Friday at Sluggos")

    assert res.status_code == 200
    entry = res.json()["request"]
    assert entry == {
        "id": entry["id"],
        "song": "Pink Pony Club",
        "singers": ["Ana"],
        "show": "Friday at Sluggos",
        "count": 1,
        "requested_at": 1_800_000_000,
    }
    assert entry["id"]
    assert res.json()["requests"] == [entry]
    assert client.get("/api/show/requests").json()["requests"] == [entry]


def test_a_request_needs_only_the_song(client):
    entry = ask(client, "Halo").json()["request"]

    assert (entry["song"], entry["singers"], entry["show"], entry["count"]) == ("Halo", [], "", 1)


def test_the_latest_song_asked_for_comes_first(client):
    for song in ("Halo", "Jolene", "Valerie"):
        ask(client, song)

    assert songs(client) == ["Valerie", "Jolene", "Halo"]


def test_a_song_asked_for_again_is_one_request_counted_again(client):
    first = ask(client, "Pink Pony Club", singer="Ana", show="Friday").json()["request"]
    ask(client, "Jolene", singer="Bo")

    again = ask(client, "  pink  PONY club ", singer="Cy", show="Saturday").json()["request"]

    assert again["id"] == first["id"]
    assert again["song"] == "Pink Pony Club"
    assert again["count"] == 2
    assert again["singers"] == ["Ana", "Cy"]
    assert again["show"] == "Saturday"
    # And it is the latest asked for
    assert songs(client) == ["Pink Pony Club", "Jolene"]


def test_a_singer_who_asks_twice_is_named_once(client):
    ask(client, "Halo", singer="Ana")

    entry = ask(client, "Halo", singer="ana").json()["request"]

    assert (entry["count"], entry["singers"]) == (2, ["Ana"])


def test_a_request_names_only_the_first_singers_who_asked(client):
    for number in range(show_requests.SINGERS_KEPT + 3):
        entry = ask(client, "Halo", singer=f"Singer {number}").json()["request"]

    assert entry["count"] == show_requests.SINGERS_KEPT + 3
    assert entry["singers"] == [f"Singer {n}" for n in range(show_requests.SINGERS_KEPT)]


def test_typed_words_are_tidied_and_cut_to_length(client):
    entry = ask(
        client,
        "  Total\tEclipse\nof the\x00 Heart  " + "x" * 400,
        singer=" Bonnie \n Tyler " + "y" * 100,
        show="z" * 150,
    ).json()["request"]

    assert entry["song"].startswith("Total Eclipse of the Heart x")
    assert len(entry["song"]) == show_requests.SONG_MAX
    assert entry["singers"][0].startswith("Bonnie Tyler y")
    assert len(entry["singers"][0]) == show_requests.SINGER_MAX
    assert len(entry["show"]) == show_requests.SHOW_MAX


@pytest.mark.parametrize("song", ["", "   ", "\n\t", "\x00\x07"])
def test_a_request_without_a_song_is_refused(client, song):
    res = ask(client, song, singer="Ana")

    assert res.status_code == 422
    assert res.json()["detail"] == NO_SONG_DETAIL
    assert songs(client) == []


def test_a_request_with_no_song_field_is_refused(client):
    assert client.post("/api/show/requests", json={"singer": "Ana"}).status_code == 422


def test_requests_are_kept_in_the_data_folder(client):
    ask(client, "Halo", singer="Ana")

    stored = json.loads(show_requests.requests_file().read_text(encoding="utf-8"))

    assert [entry["song"] for entry in stored["requests"]] == ["Halo"]
    # Nothing is held in memory: what the file says is what the list is
    stored["requests"][0]["song"] = "Halo (Beyoncé)"
    show_requests.requests_file().write_text(json.dumps(stored), encoding="utf-8")
    assert songs(client) == ["Halo (Beyoncé)"]


def test_a_full_list_takes_no_new_song_but_still_counts_the_ones_on_it(client, monkeypatch):
    monkeypatch.setattr(show_requests, "MAX_REQUESTS", 2)
    ask(client, "Halo")
    ask(client, "Jolene")

    full = ask(client, "Valerie")

    assert full.status_code == 409
    assert full.json()["detail"] == show_requests.FULL_DETAIL
    assert songs(client) == ["Jolene", "Halo"]
    assert ask(client, "halo").json()["request"]["count"] == 2


def test_the_studio_takes_a_request_off_the_list(client):
    halo = ask(client, "Halo").json()["request"]
    ask(client, "Jolene")

    res = client.delete(f"/api/show/requests/{halo['id']}")

    assert res.status_code == 200
    assert [entry["song"] for entry in res.json()["requests"]] == ["Jolene"]
    assert songs(client) == ["Jolene"]
    # Asked for after that, it is a new request
    assert ask(client, "Halo").json()["request"]["count"] == 1


def test_removing_a_request_that_is_not_there_is_a_404(client):
    ask(client, "Halo")

    assert client.delete("/api/show/requests/nope").status_code == 404
    assert songs(client) == ["Halo"]


def test_requests_need_a_sign_in(unauth_client):
    assert unauth_client.get("/api/show/requests").status_code == 401
    assert unauth_client.post("/api/show/requests", json={"song": "Halo"}).status_code == 401
    assert unauth_client.delete("/api/show/requests/abc").status_code == 401


def test_a_full_disk_refuses_the_request_and_keeps_the_list(client, monkeypatch):
    ask(client, "Halo")

    def full_disk(path, text, **kwargs):
        raise OSError(errno.ENOSPC, "No space left on device")

    monkeypatch.setattr(show_requests, "write_text_atomically", full_disk)

    res = ask(client, "Jolene")
    removed = client.delete(
        f"/api/show/requests/{client.get('/api/show/requests').json()['requests'][0]['id']}"
    )

    assert res.status_code == 507
    assert res.json()["detail"] == SAVE_FAILED_DETAIL
    assert removed.status_code == 507
    assert songs(client) == ["Halo"]


@pytest.mark.parametrize("contents", ["{not json", "[]", '{"requests": "none"}', ""])
def test_a_file_that_cannot_be_read_is_an_empty_list(client, contents):
    show_requests.requests_file().write_text(contents, encoding="utf-8")

    assert songs(client) == []
    assert ask(client, "Halo").status_code == 200
    assert songs(client) == ["Halo"]


def test_entries_that_are_not_requests_are_left_out(client):
    stored = {
        "requests": [
            {"id": "a1", "song": "Halo", "singers": ["Ana", 7, ""], "count": "many"},
            {"id": "a1", "song": "The same id again"},
            {"id": "", "song": "No id"},
            {"id": "b2", "song": "   "},
            "Jolene",
            {"id": "c3", "song": "Valerie", "singers": "Bo", "count": 3, "requested_at": 12},
        ]
    }
    show_requests.requests_file().write_text(json.dumps(stored), encoding="utf-8")

    listed = client.get("/api/show/requests").json()["requests"]

    assert listed == [
        {
            "id": "c3",
            "song": "Valerie",
            "singers": [],
            "show": "",
            "count": 3,
            "requested_at": 12,
        },
        {"id": "a1", "song": "Halo", "singers": ["Ana"], "show": "", "count": 1, "requested_at": 0},
    ]
