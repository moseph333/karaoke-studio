"""Two voices on a vocal stem are told apart line by line, and the one singing more becomes
Singer 1; one voice, or parts already assigned, leave the lines as they were."""

from backend.services.voice_parts import assign_voice_parts, detect_voice_parts
from backend.tests.helpers.voices import line, one_voice_song, two_voice_song


def test_a_rapper_and_a_singer_are_told_apart(tmp_path):
    path, lines, plan = two_voice_song(str(tmp_path / "duet.wav"))
    found = detect_voice_parts(path, lines)
    assert found.detected, found.reason
    expected = {i: ("singer1" if who == "rap" else "singer2") for i, who in enumerate(plan)}
    assert found.parts == expected
    assert found.confidence >= 0.35


def test_assigning_sets_the_singer_on_the_hook_lines_only(tmp_path):
    path, lines, plan = two_voice_song(str(tmp_path / "duet.wav"))
    assigned, found = assign_voice_parts(path, lines)
    assert found.detected
    assert [entry["singer"] for entry in assigned] == [
        "singer1" if who == "rap" else "singer2" for who in plan
    ]
    assert lines[3]["singer"] == "singer1"  # the input is not changed in place
    assert found.report()["lines_singer2"] == 3


def test_one_voice_is_left_alone(tmp_path):
    path, lines = one_voice_song(str(tmp_path / "solo.wav"))
    assigned, found = assign_voice_parts(path, lines)
    assert not found.detected
    assert assigned is lines


def test_parts_someone_assigned_are_never_overridden(tmp_path):
    path, lines, _ = two_voice_song(str(tmp_path / "duet.wav"))
    lines = [{**lines[0], "singer": "both"}, *lines[1:]]
    assigned, found = assign_voice_parts(path, lines)
    assert assigned is lines
    assert found.reason == "parts already assigned"


def test_too_few_lines_or_a_missing_stem_detect_nothing(tmp_path):
    path, lines, _ = two_voice_song(str(tmp_path / "duet.wav"))
    assert not detect_voice_parts(path, lines[:3]).detected
    missing = detect_voice_parts(str(tmp_path / "nope.wav"), [line(0, 0, 3)])
    assert not missing.detected and "could not read" in missing.reason


def test_the_studio_can_ask_for_parts_by_voice(client, tmp_path):
    import backend.main as main_mod

    path, lines, plan = two_voice_song(str(tmp_path / "duet.wav"))
    main_mod.projects["duet"] = {
        "id": "duet",
        "track_id": "duet",
        "title": "Metaphysical",
        "artist": "Handsome Boy Modeling School",
        "status": "ready",
        "lines": lines,
        "vocals_path": path,
    }
    try:
        res = client.get("/api/project/duet/voice-parts")
        assert res.status_code == 200
        body = res.json()
        assert body["detected"] is True
        assert body["lines_singer2"] == plan.count("sing")
        assert [p["singer"] for p in body["parts"]] == [
            "singer1" if who == "rap" else "singer2" for who in plan
        ]
        # Asking saves nothing
        assert all(line["singer"] == "singer1" for line in main_mod.projects["duet"]["lines"])
        assert client.get("/api/project/nope/voice-parts").status_code == 404
        main_mod.projects["duet"]["vocals_path"] = str(tmp_path / "missing.wav")
        assert client.get("/api/project/duet/voice-parts").status_code == 400
    finally:
        main_mod.projects.pop("duet", None)


def test_a_new_song_gets_its_parts_when_its_lyrics_are_timed(tmp_path, monkeypatch):
    import types

    import backend.main as main_mod
    import backend.pipeline as pipeline

    path, lines, plan = two_voice_song(str(tmp_path / "duet.wav"))
    monkeypatch.setattr(
        pipeline,
        "sync_lyrics",
        lambda *a, **k: types.SimpleNamespace(lines=lines, report={}, lyric_timing="line"),
    )
    main_mod.projects["newduet"] = {"id": "newduet", "track_id": "newduet", "lines": []}
    steps = []
    try:
        pipeline.sync_project_lyrics(
            "newduet", path, {"lines": lines}, lambda *a, **k: steps.append(a[0]), None
        )
        proj = main_mod.projects["newduet"]
        assert [line["singer"] for line in proj["lines"]] == [
            "singer1" if who == "rap" else "singer2" for who in plan
        ]
        assert proj["voice_parts"]["detected"] is True
        assert proj["voice_parts"]["lines_singer2"] == 3
    finally:
        main_mod.projects.pop("newduet", None)
