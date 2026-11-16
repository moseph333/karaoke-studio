"""Repeats a lyric file leaves out are added where the neural aligner hears them sung."""

import itertools
import json
import types

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.services.repeat_fill import MAX_ROUNDS, fill_repeats, repeat_candidates
from backend.tests.helpers.audio_signals import write_test_wav
from backend.tests.helpers.fake_ctc_worker import install_fake_ctc


def line(idx: int, text: str, start: float, end: float) -> dict:
    words = text.split()
    step = (end - start) / len(words)
    return {
        "id": idx,
        "text": text,
        "start_time": start,
        "end_time": end,
        "words": [
            {"word": w, "start_time": start + i * step, "end_time": start + (i + 1) * step}
            for i, w in enumerate(words)
        ],
    }


SONG = [
    line(0, "I get metaphysical", 33.0, 37.0),
    line(1, "It's a good day", 39.9, 43.0),
    line(2, "Investor's toxic fumigation symmetry cochlear resort", 62.8, 65.7),
    line(3, "It's a good day", 89.2, 92.0),
    line(4, "I get metaphysical", 133.2, 137.0),
    line(5, "It's a good day", 138.9, 142.0),
]


def stem(tmp_path) -> str:
    return write_test_wav(str(tmp_path / "v.wav"), 150.0, [{"start": 33, "end": 63, "freq": 300}])


def test_only_short_lines_the_song_repeats_are_candidates():
    assert repeat_candidates(SONG) == [0, 1]


def test_a_hook_is_repeated_through_a_stretch_with_no_lyrics(tmp_path, monkeypatch):
    install_fake_ctc(tmp_path, monkeypatch)
    lines, added = fill_repeats(stem(tmp_path), SONG, [{"start": 44.0, "end": 62.5}])
    assert added == MAX_ROUNDS
    repeats = [entry for entry in lines if entry.get("added") == "repeat"]
    assert len(repeats) == added
    assert all(r["start_time"] >= 44.0 and r["end_time"] <= 62.5 for r in repeats)
    assert all(r["align_method"] == "ctc" and r["confidence"] >= 0.7 for r in repeats)
    starts = [entry["start_time"] for entry in lines]
    assert starts == sorted(starts)
    assert len({entry["id"] for entry in lines}) == len(lines)
    for a, b in itertools.pairwise(repeats):
        assert a["end_time"] < b["start_time"]


def test_an_unsure_match_adds_nothing(tmp_path, monkeypatch):
    install_fake_ctc(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_CTC_MODE", "lowscore")
    lines, added = fill_repeats(stem(tmp_path), SONG, [{"start": 44.0, "end": 62.5}])
    assert (lines, added) == (SONG, 0)


def test_a_failed_neural_pass_or_nothing_to_fill_adds_nothing(tmp_path, monkeypatch):
    install_fake_ctc(tmp_path, monkeypatch)
    monkeypatch.setenv("FAKE_CTC_MODE", "fail")
    assert fill_repeats(stem(tmp_path), SONG, [{"start": 44.0, "end": 62.5}]) == (SONG, 0)
    assert fill_repeats(stem(tmp_path), SONG, []) == (SONG, 0)
    unique = [line(0, "One line only", 1, 3), line(1, "Another line", 4, 6)]
    assert fill_repeats(stem(tmp_path), unique, [{"start": 10, "end": 20}]) == (unique, 0)


def test_a_new_song_aligned_by_the_neural_aligner_gets_its_repeats(tmp_path, monkeypatch):
    install_fake_ctc(tmp_path, monkeypatch)
    report = {
        "engine": "ctc",
        "vocal_regions": [[33.0, 62.5]],
        "uncovered_vocals": [{"start": 44.0, "end": 62.5}],
    }
    monkeypatch.setattr(
        pipeline,
        "sync_lyrics",
        lambda *a, **k: types.SimpleNamespace(lines=SONG, report=report, lyric_timing="line"),
    )
    main_mod.projects["hooks"] = {"id": "hooks", "track_id": "hooks", "lines": []}
    try:
        pipeline.sync_project_lyrics(
            "hooks", stem(tmp_path), {"lines": SONG}, lambda *a: None, None
        )
        proj = main_mod.projects["hooks"]
        assert proj["sync_report"]["lines_added_repeats"] == MAX_ROUNDS
        assert sum(1 for entry in proj["lines"] if entry.get("added") == "repeat") == MAX_ROUNDS
        assert proj["sync_report"]["uncovered_vocals"] != report["uncovered_vocals"]
        json.dumps(proj)  # stays storable
    finally:
        main_mod.projects.pop("hooks", None)


def test_a_song_aligned_without_the_neural_aligner_is_left_as_it_was(tmp_path, monkeypatch):
    report = {"engine": "dsp", "uncovered_vocals": [{"start": 44.0, "end": 62.5}]}
    monkeypatch.setattr(
        pipeline,
        "sync_lyrics",
        lambda *a, **k: types.SimpleNamespace(lines=SONG, report=report, lyric_timing="line"),
    )
    main_mod.projects["dsp"] = {"id": "dsp", "track_id": "dsp", "lines": []}
    try:
        pipeline.sync_project_lyrics("dsp", stem(tmp_path), {"lines": SONG}, lambda *a: None, None)
        assert len(main_mod.projects["dsp"]["lines"]) == len(SONG)
    finally:
        main_mod.projects.pop("dsp", None)


def test_an_added_repeat_keeps_its_mark_when_the_studio_saves_it():
    from backend.schemas import LyricLineSchema

    marked = LyricLineSchema(**{**SONG[1], "added": "repeat"}).model_dump()
    assert marked["added"] == "repeat"
    assert "added" not in LyricLineSchema(**SONG[1]).model_dump()
