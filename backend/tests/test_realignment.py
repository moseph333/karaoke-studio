"""Re-timing lyrics after the fact: one line at a time, or the whole song in the background."""

import copy
import itertools
import threading
import time
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend import realignment
from backend.services import alignment_config, line_realign, lyric_sync
from backend.services.lyric_sync import (
    AlignmentCancelled,
    NeuralAlignmentFailed,
    neural_slot,
    prepare_existing_lines,
)

RATE = 16000
PHRASES = [(2.0, 4.0), (6.0, 8.2), (11.0, 12.5)]


def _sung(path: Path, phrases=PHRASES, seconds: float = 16.0) -> Path:
    """A vocal stem with four syllables per phrase and silence between the phrases."""
    t = np.arange(int(RATE * seconds)) / RATE
    audio = np.zeros_like(t, dtype=np.float32)
    for start, end in phrases:
        edges = np.linspace(start, end, 5)
        for a, b in itertools.pairwise(edges):
            mask = (t >= a) & (t < b - 0.06)
            audio[mask] = 0.3 * np.sin(2 * np.pi * 220 * t[mask])
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, RATE)
    return path


def _words(text: str, start: float, step: float = 0.5) -> list[dict]:
    return [
        {
            "word": word,
            "start_time": round(start + i * step, 3),
            "end_time": round(start + i * step + 0.4, 3),
        }
        for i, word in enumerate(text.split())
    ]


def _line(index: int, text: str, start: float, end: float, **extra) -> dict:
    return {
        "id": index,
        "text": text,
        "start_time": start,
        "end_time": end,
        "words": _words(text, start),
        **extra,
    }


@pytest.fixture
def song():
    vocals = _sung(main_mod.STEMS_DIR / "rl1" / "vocals.wav")
    proj = {
        "id": "rl1",
        "title": "Song",
        "artist": "Band",
        "status": "ready",
        "progress": 100,
        "duration": 16.0,
        "audio_path": str(_sung(main_mod.DOWNLOADS_DIR / "rl1.wav")),
        "vocals_path": str(vocals),
        "lines": [
            _line(1, "one two three four", 2.0, 4.0, align_method="lrc", confidence=0.95),
            _line(2, "five six seven eight", 5.0, 7.0, align_method="dsp", confidence=0.4),
            _line(3, "nine ten", 11.0, 12.5, align_method="manual"),
        ],
        "lyric_source": "lrclib",
        "is_synced": True,
        "lyric_timing": "aligned",
    }
    main_mod.projects["rl1"] = proj
    return proj


def _realign_line(client, line: dict, **body):
    return client.post("/api/project/rl1/realign-line", json={"line": line, **body})


def _neural_ready(monkeypatch, engine: str = "auto") -> None:
    monkeypatch.setenv("ALIGNMENT_ENGINE", engine)
    monkeypatch.setattr(alignment_config, "ctc_status", lambda: (True, None))


def _neural_words(*starts: float, score: float = 0.9) -> dict:
    words = [{"start": s, "end": s + 0.3, "score": score} for s in starts]
    return {"lines": [{"index": 0, "status": "ok", "line_score": score, "words": words}]}


# ==============================================================================
# One line
# ==============================================================================


def test_a_late_line_moves_to_the_phrase_it_belongs_to(client, song):
    res = _realign_line(client, song["lines"][1], prev_end=4.0, next_start=11.0)
    assert res.status_code == 200
    body = res.json()
    assert (body["status"], body["engine"], body["fallback_reason"]) == ("ok", "dsp", None)
    line = body["line"]
    assert line["start_time"] == pytest.approx(6.0, abs=0.05)
    assert line["end_time"] == pytest.approx(8.25, abs=0.1)
    starts = [w["start_time"] for w in line["words"]]
    assert [w["word"] for w in line["words"]] == ["five", "six", "seven", "eight"]
    assert starts == pytest.approx([6.0, 6.55, 7.1, 7.65], abs=0.08)
    assert line["align_method"] == "dsp"
    assert 0.6 < line["confidence"] <= 1.0
    assert line["id"] == 2
    assert body["window"] == [4.0, 8.5]
    # Nothing is saved: the studio applies the line as an undoable edit
    assert main_mod.projects["rl1"]["lines"][1]["start_time"] == 5.0


def test_a_line_never_moves_past_its_neighbours(client, song):
    body = _realign_line(client, song["lines"][1], prev_end=4.0, next_start=7.5).json()
    assert body["status"] == "ok"
    assert body["line"]["start_time"] == pytest.approx(6.0, abs=0.05)
    assert body["line"]["end_time"] <= 7.5
    assert all(w["end_time"] <= 7.5 for w in body["line"]["words"])

    early = _line(2, "five six seven eight", 6.0, 8.2)
    body = _realign_line(client, early, prev_end=6.5, next_start=11.0).json()
    assert body["line"]["start_time"] >= 6.5


def test_an_untimed_line_is_found_and_split_into_words(client, song):
    line = {"text": "five six seven eight", "start_time": 6.1, "end_time": 6.1}
    body = _realign_line(client, line, prev_end=4.0, next_start=11.0).json()
    assert body["status"] == "ok"
    assert [w["word"] for w in body["line"]["words"]] == ["five", "six", "seven", "eight"]
    assert body["line"]["start_time"] == pytest.approx(6.0, abs=0.05)
    assert body["line"]["end_time"] == pytest.approx(8.25, abs=0.1)


def test_a_line_with_no_singing_nearby_is_left_alone(client, song):
    line = _line(4, "la la", 14.0, 15.0)
    body = _realign_line(client, line, prev_end=12.5).json()
    assert body["status"] == "not_found"
    assert "No singing found within 1.5 s" in body["detail"]
    assert body["line"]["start_time"] == 14.0
    assert body["line"]["words"] == line["words"]

    squeezed = _realign_line(client, song["lines"][1], prev_end=6.0, next_start=6.1).json()
    assert squeezed["status"] == "not_found"
    assert "no room" in squeezed["detail"]


def test_realign_line_rejects_bad_requests(client, song):
    line = song["lines"][1]
    assert client.post("/api/project/nope/realign-line", json={"line": line}).status_code == 404
    assert _realign_line(client, line, search_window=5).status_code == 422
    assert _realign_line(client, line, engine="whisper").status_code == 422
    assert _realign_line(client, line, prev_end=8.0, next_start=7.0).status_code == 422
    assert _realign_line(client, {"start_time": 1.0}).status_code == 422

    empty = _realign_line(client, {"text": "  ", "start_time": 5.0, "end_time": 7.0})
    assert empty.status_code == 400
    assert empty.json()["detail"] == "This line has no words to align"

    Path(song["vocals_path"]).unlink()
    missing = _realign_line(client, line)
    assert missing.status_code == 400
    assert "vocal stem missing" in missing.json()["detail"]


def test_the_neural_aligner_can_find_a_line_the_dsp_search_missed(client, song, monkeypatch):
    _neural_ready(monkeypatch)
    requests = []

    def fake_pass(vocals_path, request_lines, progress=None, cancel_event=None):
        requests.append(request_lines)
        return _neural_words(3.55, 3.7, 3.8, 3.9)

    monkeypatch.setattr(line_realign, "run_neural_pass", fake_pass)
    body = _realign_line(client, song["lines"][1]).json()

    assert requests == [
        [
            {
                "index": 0,
                "window_start": 3.5,
                "window_end": 8.5,
                "words": ["five", "six", "seven", "eight"],
            }
        ]
    ]
    assert (body["status"], body["engine"]) == ("ok", "ctc")
    line = body["line"]
    assert line["align_method"] == "ctc"
    assert line["start_time"] == pytest.approx(3.55)
    # The model's placement wins outright; it is not stretched over the DSP guess at 6 s
    assert line["end_time"] < 5.0
    assert [w["start_time"] for w in line["words"]] == pytest.approx([3.55, 3.7, 3.8, 3.9])


def test_an_unsure_neural_result_keeps_the_dsp_timing(client, song, monkeypatch):
    _neural_ready(monkeypatch)
    monkeypatch.setattr(
        line_realign,
        "run_neural_pass",
        lambda *a, **k: _neural_words(3.6, 3.7, 3.8, 3.9, score=0.2),
    )
    body = _realign_line(client, song["lines"][1]).json()
    assert (body["status"], body["engine"]) == ("ok", "dsp")
    assert body["line"]["start_time"] == pytest.approx(6.0, abs=0.05)


def test_a_busy_neural_aligner_falls_back_to_dsp(client, song, monkeypatch):
    _neural_ready(monkeypatch)
    calls = []
    monkeypatch.setattr(line_realign, "run_neural_pass", lambda *a, **k: calls.append(a))
    held = threading.BoundedSemaphore(1)
    held.acquire()
    monkeypatch.setattr(lyric_sync, "ALIGN_SEMAPHORE", held)

    body = _realign_line(client, song["lines"][1]).json()
    assert (body["status"], body["engine"]) == ("ok", "dsp")
    assert "busy" in body["fallback_reason"]
    assert calls == []


def test_neural_failures_and_server_settings_fall_back_to_dsp(client, song, monkeypatch):
    _neural_ready(monkeypatch)

    def broken(*args, **kwargs):
        raise NeuralAlignmentFailed("neural aligner exited with 3: weights missing")

    monkeypatch.setattr(line_realign, "run_neural_pass", broken)
    body = _realign_line(client, song["lines"][1]).json()
    assert (body["status"], body["engine"]) == ("ok", "dsp")
    assert "weights missing" in body["fallback_reason"]

    # The request can ask for the fast aligner, but cannot override a server pinned to it
    calls = []
    monkeypatch.setattr(line_realign, "run_neural_pass", lambda *a, **k: calls.append(a))
    assert _realign_line(client, song["lines"][1], engine="dsp").json()["engine"] == "dsp"
    monkeypatch.setenv("ALIGNMENT_ENGINE", "dsp")
    assert _realign_line(client, song["lines"][1], engine="ctc").json()["engine"] == "dsp"
    assert calls == []


def test_locate_phrase_prefers_phrase_starts_near_the_current_timing(tmp_path):
    from backend.services.sync_confidence import load_evidence

    evidence = load_evidence(_sung(tmp_path / "v.wav", phrases=[(4.5, 7.0), (7.3, 9.0)]))
    # Starting mid-phrase: snaps back to where the phrase starts, and ends where the last
    # syllable (6.94 s) dies away
    assert line_realign.locate_phrase(evidence, 5.0, 7.0, 3.5, 7.3, 4) == pytest.approx(
        (4.5, 7.04), abs=0.03
    )
    # Already in place: the next phrase 2.3 s away does not tempt it
    assert line_realign.locate_phrase(evidence, 4.5, 7.0, 3.0, 9.0, 4)[0] == pytest.approx(
        4.5, abs=0.02
    )
    assert line_realign.locate_phrase(evidence, 12.0, 13.0, 11.0, 14.0, 2) is None
    assert line_realign.search_bounds(5.0, 7.0, 16.0, 1.5) == (3.5, 8.5)
    assert line_realign.search_bounds(5.0, 7.0, 7.5, 3.0, prev_end=4.0, next_start=9.0) == (
        4.0,
        7.5,
    )


# ==============================================================================
# The whole song in the background
# ==============================================================================


def _custom(client, **body):
    payload = {"custom_lyrics": "[00:02.00]one two three four\n[00:06.00]five six seven eight"}
    return client.post("/api/project/rl1/realign-lyrics", json={**payload, **body})


def test_background_realign_retimes_the_song_and_records_a_report(client, song, monkeypatch):
    engines = []
    real_sync = realignment.sync_lyrics

    def spy(vocals_path, lines, **kwargs):
        engines.append(kwargs.get("engine"))
        return real_sync(vocals_path, lines, **kwargs)

    monkeypatch.setattr(realignment, "sync_lyrics", spy)
    res = _custom(client, background=True)
    assert res.status_code == 202
    queued = res.json()["job"]
    assert (queued["status"], queued["mode"], queued["progress"]) == ("queued", "custom", 0)

    proj = client.get("/api/project/rl1").json()
    job = proj["sync_job"]
    assert (job["id"], job["status"], job["progress"]) == (queued["id"], "done", 100)
    assert job["engine"] == "dsp"
    assert job["detail"] == "Lyrics re-aligned with the fast aligner"
    assert engines == [None]  # the server's configured engine, not the in-request DSP pin
    assert [line["text"] for line in proj["lines"]] == [
        "one two three four",
        "five six seven eight",
    ]
    assert proj["lines"][1]["start_time"] == pytest.approx(6.0, abs=0.1)
    assert proj["lyric_source"] == "custom"
    assert proj["lyric_timing"] == "source_line"
    assert proj["sync_report"]["lines_total"] == 2
    assert realignment.cancel_key("rl1") not in main_mod.active_cancellations


def test_background_realign_of_the_current_lines_keeps_where_they_came_from(client, song):
    lines = [dict(line) for line in song["lines"]]
    res = client.post("/api/project/rl1/realign-lyrics", json={"lines": lines, "background": True})
    assert res.status_code == 202
    assert res.json()["job"]["mode"] == "lines"

    proj = client.get("/api/project/rl1").json()
    assert proj["sync_job"]["status"] == "done"
    assert (proj["lyric_source"], proj["is_synced"], proj["lyric_timing"]) == (
        "lrclib",
        True,
        "aligned",
    )
    first, second, third = proj["lines"]
    # Word timing that came with the lyrics stays; the others are timed again
    assert first["align_method"] == "lrc"
    assert first["words"] == song["lines"][0]["words"]
    assert second["align_method"] == "dsp"
    assert second["start_time"] == pytest.approx(6.0, abs=0.15)
    assert third["align_method"] == "dsp"
    assert proj["sync_report"]["lyric_source"] == "lrclib"


def test_current_lines_can_be_retimed_within_the_request(client, song):
    lines = [dict(line) for line in song["lines"]]
    res = client.post("/api/project/rl1/realign-lyrics", json={"lines": lines})
    assert res.status_code == 200
    body = res.json()
    assert body["lyric_timing"] == "aligned"
    assert body["source"] == "lrclib"
    assert body["lines"][1]["start_time"] == pytest.approx(6.0, abs=0.15)
    assert "sync_job" not in main_mod.projects["rl1"]

    empty = client.post("/api/project/rl1/realign-lyrics", json={"lines": []})
    assert empty.status_code == 400
    assert empty.json()["detail"] == "Must provide either custom_lyrics or fetch_lrclib=True"


def test_retiming_within_the_request_stores_into_the_project_as_it_is_now(
    client, song, monkeypatch
):
    from backend.routers import projects as projects_router

    real_sync = projects_router.sync_lyrics

    def project_reloaded_meanwhile(*args, **kwargs):
        result = real_sync(*args, **kwargs)
        # Another request reloaded the projects from disk while this one was aligning
        main_mod.projects["rl1"] = copy.deepcopy(main_mod.projects["rl1"])
        return result

    monkeypatch.setattr(projects_router, "sync_lyrics", project_reloaded_meanwhile)
    lines = [dict(line) for line in song["lines"]]
    res = client.post("/api/project/rl1/realign-lyrics", json={"lines": lines})
    assert res.status_code == 200

    stored = main_mod.projects["rl1"]
    assert stored is not song
    assert stored["lines"][1]["start_time"] == pytest.approx(6.0, abs=0.15)
    assert stored["sync_report"] == res.json()["sync_report"]


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"sync_job": {"id": "s0", "status": "running"}}, "already being re-aligned"),
        ({"separation_job": {"id": "j0", "status": "queued"}}, "stems to finish"),
        ({"status": "aligning"}, "still being processed"),
    ],
)
def test_background_realign_refuses_to_overlap_other_jobs(client, song, change, message):
    song.update(change)
    for key in ("rl1_sync", "rl1_reseparate"):
        main_mod.active_cancellations[key] = threading.Event()
    res = _custom(client, background=True)
    assert res.status_code == 409
    assert message in res.json()["detail"]


def test_realigning_within_the_request_waits_for_background_jobs(client, song):
    song["sync_job"] = {"id": "s0", "status": "running"}
    main_mod.active_cancellations["rl1_sync"] = threading.Event()
    assert _custom(client).status_code == 409

    song["sync_job"]["status"] = "done"
    song["separation_job"] = {"id": "j0", "status": "running"}
    main_mod.active_cancellations["rl1_reseparate"] = threading.Event()
    res = _custom(client)
    assert res.status_code == 409
    assert "stems to finish" in res.json()["detail"]


def test_reseparation_waits_for_a_running_realignment(client, song):
    song["sync_job"] = {"id": "s0", "status": "queued"}
    main_mod.active_cancellations["rl1_sync"] = threading.Event()
    res = client.post("/api/project/rl1/reseparate", json={"quality": "fast"})
    assert res.status_code == 409
    assert "lyric re-alignment" in res.json()["detail"]


def test_cancelling_a_running_realignment(client, song, monkeypatch):
    started = threading.Event()

    def waits_for_cancel(vocals_path, lines, cancel_event=None, **kwargs):
        started.set()
        assert cancel_event.wait(5)
        raise AlignmentCancelled("Lyric alignment cancelled by user")

    monkeypatch.setattr(realignment, "sync_lyrics", waits_for_cancel)
    job = realignment.create_job(song, "lines")
    main_mod.active_cancellations[realignment.cancel_key("rl1")] = threading.Event()
    worker = threading.Thread(
        target=realignment.run_realignment,
        args=("rl1", job["id"], prepare_existing_lines(song["lines"]), {}, "lines"),
    )
    worker.start()
    assert started.wait(5)

    res = client.post("/api/project/rl1/realign-lyrics/cancel")
    assert res.json()["status"] == "cancelling"
    worker.join(5)
    assert not worker.is_alive()

    proj = client.get("/api/project/rl1").json()
    assert proj["sync_job"]["status"] == "cancelled"
    assert proj["sync_job"]["error"] is None
    assert proj["sync_job"]["detail"] == "Cancelled; the lyrics keep their previous timing"
    assert proj["lines"][1]["start_time"] == 5.0
    assert client.post("/api/project/rl1/realign-lyrics/cancel").json()["status"] == "idle"


def test_a_queued_realignment_can_be_cancelled_before_it_starts(song, monkeypatch):
    calls = []
    monkeypatch.setattr(realignment, "sync_lyrics", lambda *a, **k: calls.append(a))
    monkeypatch.setattr(main_mod, "WORKER_SEMAPHORE", threading.Semaphore(0))
    job = realignment.create_job(song, "lines")
    cancel = threading.Event()
    main_mod.active_cancellations[realignment.cancel_key("rl1")] = cancel
    threading.Timer(0.2, cancel.set).start()

    started = time.monotonic()
    realignment.run_realignment("rl1", job["id"], song["lines"], {}, "lines")
    assert time.monotonic() - started < 3
    assert song["sync_job"]["status"] == "cancelled"
    assert calls == []


def test_lyrics_saved_during_a_realignment_are_kept(client, song, monkeypatch):
    real_sync = realignment.sync_lyrics

    def user_saves_meanwhile(vocals_path, lines, **kwargs):
        result = real_sync(vocals_path, lines, **kwargs)
        main_mod.projects["rl1"]["lines"] = [_line(1, "edited by hand", 2.0, 4.0)]
        return result

    monkeypatch.setattr(realignment, "sync_lyrics", user_saves_meanwhile)
    assert _custom(client, background=True).status_code == 202

    proj = client.get("/api/project/rl1").json()
    assert proj["sync_job"]["status"] == "error"
    assert "your edits were kept" in proj["sync_job"]["detail"]
    assert [line["text"] for line in proj["lines"]] == ["edited by hand"]
    assert proj["lyric_source"] == "lrclib"


def test_a_failed_realignment_keeps_the_lyrics(client, song, monkeypatch):
    def broken(*args, **kwargs):
        raise RuntimeError("aligner blew up")

    monkeypatch.setattr(realignment, "sync_lyrics", broken)
    assert _custom(client, background=True).status_code == 202
    job = client.get("/api/project/rl1").json()["sync_job"]
    assert (job["status"], job["error"]) == ("error", "aligner blew up")
    assert job["detail"] == "Could not re-align the lyrics; they keep their previous timing"
    assert main_mod.projects["rl1"]["lines"][1]["start_time"] == 5.0


def test_a_realignment_left_running_by_a_restart_is_settled(client, song):
    song["sync_job"] = {"id": "old", "status": "running", "progress": 40}
    job = client.get("/api/project/rl1").json()["sync_job"]
    assert job["status"] == "error"
    assert "server restart" in job["detail"]
    # ... and no longer blocks a new request
    assert _custom(client, background=True).status_code == 202


def test_deleting_a_song_cancels_its_realignment(client, song):
    cancel = threading.Event()
    main_mod.active_cancellations[realignment.cancel_key("rl1")] = cancel
    assert client.delete("/api/project/rl1").status_code == 200
    assert cancel.is_set()


# ==============================================================================
# Shared pieces
# ==============================================================================


def test_neural_passes_wait_for_a_free_slot(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(lyric_sync, "ALIGN_SEMAPHORE", slots)
    slots.acquire()
    messages, entered = [], threading.Event()

    def worker():
        with neural_slot(lambda pct, detail: messages.append(detail)):
            entered.set()

    thread = threading.Thread(target=worker)
    thread.start()
    time.sleep(0.3)
    assert not entered.is_set()
    slots.release()
    thread.join(5)
    assert entered.is_set()
    assert messages == ["Waiting for the neural aligner to finish another song..."]
    assert slots.acquire(blocking=False)  # released again afterwards


def test_waiting_for_a_neural_slot_can_be_cancelled(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(lyric_sync, "ALIGN_SEMAPHORE", slots)
    slots.acquire()
    cancel = threading.Event()
    threading.Timer(0.2, cancel.set).start()
    with pytest.raises(AlignmentCancelled), neural_slot(cancel_event=cancel):
        pass
    with pytest.raises(NeuralAlignmentFailed, match="busy"), neural_slot(wait=False):
        pass


def test_existing_lines_keep_only_word_timing_from_the_lyrics():
    words = _words("a b", 1.0)
    lines = [
        {"text": "a b", "words": words, "align_method": "lrc"},
        {"text": "a b", "words": words, "align_method": "manual", "has_word_sync": True},
        {"text": "a b", "words": words, "has_word_sync": True},  # saved before align_method
        {"text": "a b", "words": [], "align_method": "lrc"},
        "not a line",
    ]
    prepared = prepare_existing_lines(lines)
    assert [line.get("has_word_sync", False) for line in prepared] == [True, False, True, False]
    assert "has_word_sync" not in lines[0]  # the originals are untouched
