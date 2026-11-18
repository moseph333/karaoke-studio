"""Two requests for the same song at the same moment start one pipeline.

POST /api/process looked for a running song before it took the store lock, so a double
click (or two singers pasting the same link) passed the check twice and two pipelines
downloaded and separated into the same files."""

import threading

import pytest

import backend.main as main_mod
import backend.routers.projects as projects_router
from backend.main import active_cancellations, projects

VIDEO = "dQw4w9WgXcQ"


@pytest.fixture
def started(monkeypatch):
    runs = []
    monkeypatch.setattr(main_mod, "run_pipeline", lambda *args: runs.append(args))
    yield runs
    projects.pop(VIDEO, None)
    active_cancellations.pop(VIDEO, None)


def test_two_requests_at_once_start_one_pipeline(client, monkeypatch, started):
    # Each request stops after its "is it running already?" check until the other has
    # passed that check too, or for half a second when the other never gets there
    both_checked = threading.Barrier(2)

    def wait_for_the_other_request():
        try:
            both_checked.wait(timeout=0.5)
        except threading.BrokenBarrierError:
            pass

    monkeypatch.setattr(projects_router, "ensure_free_space", wait_for_the_other_request)
    answers = []

    def post():
        answers.append(client.post("/api/process", json={"url_or_id": VIDEO}))

    requests = [threading.Thread(target=post, daemon=True) for _ in range(2)]
    for request in requests:
        request.start()
    for request in requests:
        request.join(timeout=10)

    assert [res.status_code for res in answers] == [200, 200]
    assert {res.json()["project_id"] for res in answers} == {VIDEO}
    assert len(started) == 1


def test_a_second_request_still_joins_the_running_song(client, started):
    first = client.post("/api/process", json={"url_or_id": VIDEO}).json()
    second = client.post("/api/process", json={"url_or_id": VIDEO}).json()

    assert first == {"project_id": VIDEO, "status": "queued"}
    assert second == {"project_id": VIDEO, "status": "queued"}
    assert len(started) == 1
