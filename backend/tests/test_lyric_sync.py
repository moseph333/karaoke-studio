"""Lyric sync orchestrator: DSP pass, neural pass through a fake CTC worker, merging,
confidence and the sync report."""

import itertools
import json
import subprocess
import sys
import threading
import time
import types
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend.pipeline import sync_project_lyrics
from backend.services import alignment_config, lyric_sync
from backend.services.lyric_sync import (
    AlignmentCancelled,
    fill_missing,
    finish_neural_words,
    merge_line,
    source_timing,
    sync_lyrics,
)

RATE = 16000


def _vocals(path: Path, spans: list[tuple[float, float]], duration: float = 12.0) -> str:
    t = np.arange(int(RATE * duration)) / RATE
    audio = np.zeros_like(t, dtype=np.float32)
    for start, end in spans:
        mask = (t >= start) & (t < end)
        audio[mask] = 0.4 * np.sin(2 * np.pi * 220 * t[mask])
    sf.write(str(path), audio, RATE)
    return str(path)


def _line(i, text, start, end, words=None, **extra):
    line = {"id": i, "text": text, "start_time": start, "end_time": end, **extra}
    if words is not None:
        line["words"] = [{"word": w, "start_time": s, "end_time": e} for w, s, e in words]
    return line


# ==============================================================================
# Pure helpers
# ==============================================================================


def test_neural_words_get_sung_lengths():
    raw = [
        {"start": 1.00, "end": 1.03, "score": 0.9},  # shorter than the minimum
        {"start": 1.30, "end": 1.50, "score": 0.9},  # 0.27 s after the first: joined
        None,
        {"start": 2.40, "end": 2.45, "score": 0.9},  # last word: held for 0.25 s
    ]
    spans = finish_neural_words(raw, window_end=2.6)
    assert spans[0] == (1.0, pytest.approx(1.29))
    assert spans[1] == (1.3, 1.5)  # 0.9 s gap to the next placed word stays a pause
    assert spans[2] is None
    assert spans[3] == (2.4, pytest.approx(2.6))  # held, but not past the window


def test_missing_words_are_shared_out_by_length():
    words = ["a", "longword", "bb", "c"]
    spans = fill_missing(words, [None, None, (2.0, 2.5), None], line_start=1.0, line_end=3.5)
    assert spans[0] == (1.0, pytest.approx(1.0 + 1.0 / 9))
    assert spans[1][1] == pytest.approx(2.0)
    assert spans[3] == (2.5, 3.5)


def test_merge_prefers_confident_neural_timing_inside_its_window():
    dsp = _line(
        0, "one two three", 5.0, 7.0, [("one", 5.0, 5.6), ("two", 5.6, 6.3), ("three", 6.3, 7.0)]
    )
    neural = {
        "status": "ok",
        "line_score": 0.8,
        "words": [
            {"start": 4.7, "end": 5.0, "score": 0.9},
            {"start": 5.5, "end": 5.8, "score": 0.8},
            {"start": 6.4, "end": 6.9, "score": 0.7},
        ],
    }
    merged, method, score = merge_line(dsp, neural, window=(4.6, 7.5), alignable=3)
    assert (method, score) == ("ctc", 0.8)
    assert merged["start_time"] == 4.7  # the first word was earlier than the DSP line start
    assert [w["start_time"] for w in merged["words"]] == [4.7, 5.5, 6.4]
    assert merged["words"][0]["end_time"] == 5.0  # a 0.5 s pause before "two" is kept

    low = dict(neural, line_score=0.2)
    assert merge_line(dsp, low, (4.6, 7.5), 3)[1:] == ("dsp", 0.2)
    sparse = dict(neural, words=[neural["words"][0], None, None])
    assert merge_line(dsp, sparse, (4.6, 7.5), 3)[1] == "dsp"
    assert merge_line(dsp, {"status": "failed"}, (4.6, 7.5), 3)[1] == "dsp"
    assert merge_line(dsp, None, (4.6, 7.5), 3) == (dsp, "dsp", None)


def test_neural_windows_never_overlap():
    lines = [_line(0, "a", 1.0, 3.0), _line(1, "b", 3.4, 5.0), _line(2, "c", 9.0, 10.0)]
    windows = lyric_sync._windows(lines)
    assert windows[0] == (0.25, 3.2)
    assert windows[1] == (3.2, 5.75)
    assert windows[2] == (8.25, 10.75)
    for (_, hi), (lo, _) in itertools.pairwise(windows):
        assert hi <= lo


def test_source_timing_kinds():
    assert source_timing([_line(0, "x", 0.0, 0.0)]) == "none"
    assert source_timing([_line(0, "x", 1.0, 2.0)]) == "line"
    assert source_timing([_line(0, "x", 1.0, 2.0, [("x", 1.0, 2.0)], has_word_sync=True)]) == "word"


# ==============================================================================
# DSP only
# ==============================================================================


def test_dsp_sync_scores_lines_against_the_vocals(tmp_path):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0), (5.0, 7.0)])
    lines = [_line(0, "hello there friend", 1.0, 3.0), _line(1, "singing all along", 5.0, 7.0)]
    result = sync_lyrics(vocals, lines, lyric_data={"source": "lrclib", "lines": lines})

    assert result.methods == ["dsp", "dsp"]
    assert all(line["align_method"] == "dsp" for line in result.lines)
    assert all(0.5 <= line["confidence"] <= 1.0 for line in result.lines)
    report = result.report
    assert report["engine"] == report["requested_engine"] == "dsp"
    assert (report["lyric_source"], report["source_timing"]) == ("lrclib", "line")
    assert (report["lines_total"], report["lines_dsp"], report["lines_ctc"]) == (2, 2, 0)
    assert report["low_confidence_lines"] == 0
    assert report["global_offset"] == {"applied": 0.0}
    assert result.lyric_timing == "source_line"
    assert lines[0].get("confidence") is None  # the input is not modified


def test_words_placed_in_silence_get_low_confidence(tmp_path):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0)])
    lines = [_line(0, "sung line here", 1.0, 3.0), _line(1, "nobody sings this", 6.0, 8.0)]
    result = sync_lyrics(vocals, lines)
    sung, silent = result.lines
    assert sung["confidence"] > silent["confidence"]
    assert silent["confidence"] < 0.5
    assert result.report["low_confidence_lines"] == 1


def test_lyrics_with_word_timing_keep_it(tmp_path):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0)])
    words = [("keep", 1.0, 1.7), ("my", 1.7, 2.2), ("timing", 2.2, 3.0)]
    lines = [_line(0, "keep my timing", 1.0, 3.0, words, has_word_sync=True)]
    result = sync_lyrics(vocals, lines)
    line = result.lines[0]
    assert line["align_method"] == "lrc"
    assert line["confidence"] >= 0.9
    assert [w["start_time"] for w in line["words"]] == [1.0, 1.7, 2.2]
    assert result.lyric_timing == "source_word"


def test_unreadable_vocals_mark_lines_as_fallback(tmp_path):
    lines = [_line(0, "no audio", 0.0, 0.0), _line(1, "at all", 0.0, 0.0)]
    result = sync_lyrics(str(tmp_path / "missing.wav"), lines)
    assert result.methods == ["fallback", "fallback"]
    assert all(line["confidence"] == 0.2 for line in result.lines)
    assert result.lyric_timing == "aligned"
    assert result.report["lines_fallback"] == 2


def test_plain_lyrics_get_a_second_snapping_pass(tmp_path, monkeypatch):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0), (5.0, 7.0)])
    calls = []
    real = main_mod.aligner.align_lyrics

    def spy(path, lines):
        calls.append([(x.get("start_time"), x.get("end_time")) for x in lines])
        return real(path, lines)

    monkeypatch.setattr(main_mod.aligner, "align_lyrics", spy)
    lines = [_line(0, "first plain line", 0.0, 0.0), _line(1, "second plain line", 0.0, 0.0)]
    sync_lyrics(vocals, lines)
    assert len(calls) == 2
    assert calls[0] == [(0.0, 0.0), (0.0, 0.0)]
    assert all(end > start for start, end in calls[1])

    calls.clear()
    monkeypatch.setenv("ALIGN_REFINE_PLAIN", "0")
    sync_lyrics(vocals, lines)
    assert len(calls) == 1


def test_mocked_aligners_returning_nothing_are_fine(monkeypatch):
    monkeypatch.setattr(main_mod.aligner, "align_lyrics", lambda audio_path, lyrics: [])
    result = sync_lyrics("/nowhere.wav", [_line(0, "x", 0.0, 0.0)])
    assert result.lines == []
    assert result.lyric_timing == "none"
    assert result.report["mean_confidence"] is None


# ==============================================================================
# Neural pass (fake worker process)
# ==============================================================================

FAKE_CTC = r"""
import json, os, sys, time
args = sys.argv[1:]
request = json.load(open(args[args.index("--request") + 1]))
response_path = args[args.index("--response") + 1]
mode = os.environ.get("FAKE_CTC_MODE", "ok")
log = os.environ.get("FAKE_CTC_LOG")
if log:
    json.dump(request, open(log, "w"))

def event(**fields):
    sys.stderr.write(json.dumps(fields) + "\n")
    sys.stderr.flush()

if mode == "fail":
    event(event="error", code="import", detail="PyTorch/torchaudio could not be loaded: boom")
    sys.exit(4)
if mode == "silent":
    time.sleep(30)
if mode == "slow":
    for _ in range(300):
        event(event="stage", detail="Loading the neural aligner…")
        time.sleep(0.1)
event(event="download", detail="Downloading the MMS alignment model (first run only, ~1.2 GB)…")
lines = []
for n, line in enumerate(request["lines"], 1):
    words = []
    for i, w in enumerate(line["words"]):
        if not w:
            words.append(None)
            continue
        start = line["window_start"] + 0.8 + i * 0.4
        words.append({"start": round(start, 3), "end": round(start + 0.25, 3), "score": 0.9})
    score = 0.2 if mode == "lowscore" else 0.85
    lines.append({"index": line["index"], "status": "ok", "error": None, "line_score": score, "star_ratio": 0.3, "words": words})
    event(event="stage", done=n, total=len(request["lines"]), detail=f"Aligning words (neural) {n}/{len(request['lines'])}")
json.dump({"version": 1, "model": "MMS_FA", "lines": lines}, open(response_path, "w"))
"""


@pytest.fixture
def neural(tmp_path, monkeypatch):
    """Makes the neural engine available and routes its worker to a fake script."""
    script = tmp_path / "fake_ctc.py"
    script.write_text(FAKE_CTC)
    state = types.SimpleNamespace(calls=[], log=tmp_path / "request.json")
    monkeypatch.setenv("FAKE_CTC_LOG", str(state.log))
    monkeypatch.setenv("ALIGNMENT_ENGINE", "auto")
    monkeypatch.setattr(alignment_config, "ctc_status", lambda: (True, None))
    real_popen = subprocess.Popen

    def popen(cmd, *args, **kwargs):
        state.calls.append({"cmd": list(cmd), "kwargs": kwargs})
        if "backend.workers.ctc_align_worker" in cmd:
            cmd = [sys.executable, str(script), *cmd[4:]]
        return real_popen(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", popen)
    return state


def test_neural_timing_replaces_confident_lines(tmp_path, neural):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5), (5.0, 7.5)])
    lines = [_line(0, "Don't stop 2nite", 1.0, 3.5), _line(1, "keep on singing", 5.0, 7.5)]
    progress = []
    result = sync_lyrics(vocals, lines, progress=lambda pct, detail: progress.append((pct, detail)))

    request = json.loads(neural.log.read_text())
    assert request["version"] == 1
    assert request["allow_download"] is False  # the test env disables downloads
    assert [line["words"] for line in request["lines"]][1] == ["keep", "on", "singing"]
    assert request["lines"][0]["words"][0] == "don't"
    assert request["lines"][0]["window_end"] <= request["lines"][1]["window_start"]
    worker = neural.calls[0]
    assert worker["kwargs"]["stdout"] == subprocess.DEVNULL
    assert "env" in worker["kwargs"]

    assert result.report["engine"] == "ctc"
    assert result.methods == ["ctc", "ctc"]
    second = result.lines[1]
    window_start = request["lines"][1]["window_start"]
    assert second["words"][0]["start_time"] == pytest.approx(window_start + 0.8, abs=1e-3)
    assert all(0.0 <= line["confidence"] <= 1.0 for line in result.lines)
    assert result.report["lines_ctc"] == 2
    details = [d for _, d in progress]
    assert "Downloading the MMS alignment model (first run only, ~1.2 GB)…" in details
    assert "Aligning words (neural) 2/2" in details
    assert progress[-1] == (100, "Lyrics aligned")


def test_unsure_neural_lines_keep_the_dsp_timing(tmp_path, neural, monkeypatch):
    monkeypatch.setenv("FAKE_CTC_MODE", "lowscore")
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5)])
    result = sync_lyrics(vocals, [_line(0, "not so sure", 1.0, 3.5)])
    assert result.report["engine"] == "ctc"
    assert result.methods == ["dsp"]


def test_a_failing_neural_worker_falls_back_to_dsp(tmp_path, neural, monkeypatch):
    monkeypatch.setenv("FAKE_CTC_MODE", "fail")
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5)])
    result = sync_lyrics(vocals, [_line(0, "still timed", 1.0, 3.5)])
    assert result.report["engine"] == "dsp"
    assert result.report["requested_engine"] == "auto"
    assert "could not be loaded: boom" in result.report["fallback_reason"]
    assert result.methods == ["dsp"]


def test_a_silent_neural_worker_is_stopped(tmp_path, neural, monkeypatch):
    monkeypatch.setenv("FAKE_CTC_MODE", "silent")
    monkeypatch.setenv("ALIGNMENT_STALL_SEC", "0.5")
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5)])
    started = time.monotonic()
    result = sync_lyrics(vocals, [_line(0, "waiting", 1.0, 3.5)])
    assert time.monotonic() - started < 6
    assert "printed nothing for 0.5 seconds" in result.report["fallback_reason"]


def test_cancelling_during_the_neural_pass(tmp_path, neural, monkeypatch):
    monkeypatch.setenv("FAKE_CTC_MODE", "slow")
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5)])
    cancel = threading.Event()
    timer = threading.Timer(0.5, cancel.set)
    timer.start()
    try:
        with pytest.raises(AlignmentCancelled):
            sync_lyrics(vocals, [_line(0, "stop me", 1.0, 3.5)], cancel_event=cancel)
    finally:
        timer.cancel()


def test_dsp_engine_never_starts_the_worker(tmp_path, neural):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5)])
    result = sync_lyrics(vocals, [_line(0, "dsp only", 1.0, 3.5)], engine="dsp")
    assert neural.calls == []
    assert result.report["engine"] == "dsp"


def test_unavailable_neural_engine_is_reported(tmp_path, monkeypatch):
    monkeypatch.setenv("ALIGNMENT_ENGINE", "auto")
    monkeypatch.setattr(alignment_config, "ctc_status", lambda: (False, "PyTorch is not installed"))
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.5)])
    result = sync_lyrics(vocals, [_line(0, "no torch", 1.0, 3.5)])
    assert (result.report["engine"], result.report["fallback_reason"]) == (
        "dsp",
        "PyTorch is not installed",
    )


def test_pipeline_step_stores_lines_report_and_timing_kind(tmp_path):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0)])
    main_mod.projects["ps1"] = {"id": "ps1", "status": "aligning"}
    updates = []
    lyric_data = {"source": "custom", "synced": False, "lines": [_line(0, "plain words", 0.0, 0.0)]}
    sync_project_lyrics("ps1", vocals, lyric_data, lambda *a, **k: updates.append(a), None)

    proj = main_mod.projects["ps1"]
    assert proj["lyric_timing"] == "aligned"
    assert proj["sync_report"]["lyric_source"] == "custom"
    assert proj["lines"][0]["align_method"] == "dsp"
    assert updates[0] == (
        "aligning",
        82,
        "Aligning lyrics to vocal acoustic energy envelopes...",
        5,
    )
    assert all(82 <= u[1] <= 91 for u in updates)
    assert updates[-1][1:] == (91, "Lyrics aligned")
