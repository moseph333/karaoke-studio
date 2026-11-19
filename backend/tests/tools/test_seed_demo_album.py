"""The demo library (``python -m backend.tools.seed_demo``) holds a whole album that the
album picker opens as it would a pasted one: its songs listed, the one made from it ready to
open, so the picker can be shown and photographed without a download."""

import backend.main as main_mod
from backend.tools import seed_demo


def test_the_demo_album_opens_in_the_album_picker(client, monkeypatch):
    for name in ("DATA_DIR", "DOWNLOADS_DIR", "STEMS_DIR", "OUTPUT_DIR"):
        monkeypatch.setattr(seed_demo, name, getattr(main_mod, name))
    seed_demo.main()

    listing = client.get("/api/project/demo_album/album")

    assert listing.status_code == 200, listing.text
    body = listing.json()
    assert body["title"] == "Lanterns & Static" and body["source"] == "chapters"
    assert [t["title"] for t in body["tracks"]] == [t for t, _ in seed_demo.DEMO_ALBUM_SONGS]
    made = [(t["number"], t["project_status"]) for t in body["tracks"] if t["project_id"]]
    assert made == [(2, "ready")]
    # Back to back, as chapters give them, ending with the recording
    ends = [t["end"] for t in body["tracks"]]
    assert [t["start"] for t in body["tracks"][1:]] == ends[:-1]
    assert ends[-1] == body["duration"]
    assert (main_mod.DOWNLOADS_DIR / "demo_album.jpg").is_file()
