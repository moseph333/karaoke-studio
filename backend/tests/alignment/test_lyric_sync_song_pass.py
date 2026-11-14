"""sync_lyrics with the neural song pass (CTC worker protocol version 2), through the fake
worker in backend/tests/helpers/fake_ctc_worker.py: lines the DSP estimate put in the wrong
place are found where the song pass places them, timed lyrics made for another version are
corrected, and anything doubtful keeps today's timing."""

import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from backend.services import lyric_sync
from backend.services.lyric_sync import sync_lyrics
from backend.tests.helpers.fake_ctc_worker import install_fake_ctc

RATE = 16000
TEXTS = ["hold me closer now", "never let me go", "singing through the night", "till morning"]


@pytest.fixture
def neural(tmp_path, monkeypatch):
    return install_fake_ctc(tmp_path, monkeypatch)


def _vocals(path: Path, spans, duration: float) -> str:
    t = np.arange(int(RATE * duration)) / RATE
    audio = np.zeros_like(t, dtype=np.float32)
    for start, end in spans:
        mask = (t >= start) & (t < end)
        audio[mask] = 0.4 * np.sin(2 * np.pi * 220 * t[mask])
    sf.write(str(path), audio, RATE)
    return str(path)


def _plain(texts=TEXTS):
    return [{"id": i, "text": t, "start_time": 0.0, "end_time": 0.0} for i, t in enumerate(texts)]


def _timed(starts, length=2.0, texts=TEXTS):
    return [
        {"id": i, "text": t, "start_time": s, "end_time": s + length}
        for i, (t, s) in enumerate(zip(texts, starts, strict=True))
    ]


def _place(monkeypatch, starts, score=0.85):
    song = {str(i): {"start": s, "score": score} for i, s in enumerate(starts)}
    monkeypatch.setenv("FAKE_CTC_SONG", json.dumps(song))


def _first_words(result):
    return [line["words"][0]["start_time"] for line in result.lines]


def test_the_song_pass_finds_lines_the_dsp_estimate_misplaced(tmp_path, neural, monkeypatch):
    sung = [3.0, 9.0, 15.0, 21.0]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 2.0) for s in sung], duration=26.0)
    _place(monkeypatch, sung)
    result = sync_lyrics(vocals, _plain())

    request = json.loads(neural.log.read_text())
    assert request["version"] == 2
    assert [x["index"] for x in request["song"]["lines"]] == [0, 1, 2, 3]
    assert request["song"]["lines"][0]["words"] == ["hold", "me", "closer", "now"]
    report = result.report
    assert (report["song_pass"], report["song_pass_reason"]) == ("ok", None)
    assert report["lines_anchored"] == 4
    assert result.methods == ["ctc"] * 4
    assert _first_words(result) == pytest.approx(sung, abs=0.01)
    starts = [line["start_time"] for line in result.lines]
    assert starts == sorted(starts)
    assert all(0.0 <= line["confidence"] <= 1.0 for line in result.lines)


def test_lyrics_timed_for_another_version_are_moved_piece_by_piece(tmp_path, neural, monkeypatch):
    # The lyrics file is 20 s early (past the DSP aligner's +-15 s search) and, from the
    # fourth line on, 26 s early: made for a version with a shorter intro and bridge
    texts = [*TEXTS, "and then some more", "one last line here"]
    lrc = [2.0, 6.0, 10.0, 14.0, 18.0, 22.0]
    sung = [22.0, 26.0, 30.0, 40.0, 44.0, 48.0]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 2.0) for s in sung], duration=54.0)
    _place(monkeypatch, sung)
    result = sync_lyrics(vocals, _timed(lrc, texts=texts))

    report = result.report
    assert report["song_pass"] == "ok"
    assert _first_words(result) == pytest.approx(sung, abs=0.05)
    segments = [(s["first_line"], s["last_line"], s["offset"]) for s in report["offset_segments"]]
    assert segments == [(0, 2, pytest.approx(20.0)), (3, 5, pytest.approx(26.0))]
    assert report["lines_relocated"] == 6


def test_a_lone_far_placement_is_not_trusted(tmp_path, neural, monkeypatch):
    # The song pass put line 2 a verse early (a repeated phrase): it disagrees with the lines
    # around it, so the lyrics file's timing (confirmed by the others) wins there
    lrc = [3.0, 9.0, 15.0, 21.0]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 2.0) for s in lrc], duration=26.0)
    _place(monkeypatch, [3.0, 9.0, 9.9, 21.0])
    result = sync_lyrics(vocals, _timed(lrc))
    assert result.report["song_pass"] == "ok"
    assert result.report["lines_anchored"] == 3
    assert result.lines[2]["start_time"] == pytest.approx(15.0, abs=0.5)


def test_an_anchored_line_is_not_widened_to_its_estimated_span(tmp_path, neural, monkeypatch):
    sung = [3.0, 13.0, 23.0, 33.0]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 1.5) for s in sung], duration=40.0)
    _place(monkeypatch, [s + 0.0 for s in sung])
    # Each line was estimated from 6 s late to the next line's start, as LRC parsing used to
    lines = _timed([s + 6.0 for s in sung], length=9.5)
    result = sync_lyrics(vocals, lines)
    assert result.report["song_pass"] == "ok"
    for line, start in zip(result.lines, sung, strict=True):
        assert line["start_time"] == pytest.approx(start, abs=0.05)
        assert line["end_time"] < start + 3.0


def test_unsure_song_passes_keep_todays_timing(tmp_path, neural, monkeypatch):
    sung = [3.0, 9.0, 15.0, 21.0]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 2.0) for s in sung], duration=26.0)
    monkeypatch.setenv("FAKE_CTC_SONG", "lowscore")
    unsure = sync_lyrics(vocals, _timed(sung))
    assert unsure.report["song_pass"] == "rejected"
    assert unsure.report["lines_anchored"] == 0

    monkeypatch.setenv("ALIGNMENT_SONG_PASS", "0")
    off = sync_lyrics(vocals, _timed(sung))
    assert off.report["song_pass"] == "off"
    request = json.loads(neural.log.read_text())
    assert request["version"] == 1 and "song" not in request
    assert [x["start_time"] for x in unsure.lines] == [x["start_time"] for x in off.lines]
    assert unsure.methods == off.methods


@pytest.mark.parametrize(
    ("mode", "status"),
    [("omit", "failed"), ("failed", "failed"), ("skipped", "skipped"), ("malformed", "failed")],
)
def test_a_missing_or_failed_song_pass_keeps_the_line_results(
    tmp_path, neural, monkeypatch, mode, status
):
    sung = [3.0, 9.0, 15.0, 21.0]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 2.0) for s in sung], duration=26.0)
    monkeypatch.setenv("FAKE_CTC_SONG", mode)
    result = sync_lyrics(vocals, _timed(sung))
    assert result.report["engine"] == "ctc"
    assert result.report["song_pass"] == status
    assert result.report["song_pass_reason"]
    assert result.report["lines_anchored"] == 0
    assert "ctc" in result.methods


def test_lines_with_their_own_word_timing_stay_out_of_the_song_pass(tmp_path, neural, monkeypatch):
    sung = [3.0, 9.0, 15.0, 21.0, 27.0]
    texts = [*TEXTS, "word timed line"]
    vocals = _vocals(tmp_path / "v.wav", [(s, s + 2.0) for s in sung], duration=32.0)
    _place(monkeypatch, sung)
    lines = _timed(sung, texts=texts)
    words = [("word", 27.0, 27.4), ("timed", 27.5, 27.9), ("line", 28.0, 28.6)]
    lines[4]["words"] = [{"word": w, "start_time": s, "end_time": e} for w, s, e in words]
    lines[4]["has_word_sync"] = True
    result = sync_lyrics(vocals, lines)
    request = json.loads(neural.log.read_text())
    assert 4 not in [x["index"] for x in request["song"]["lines"]]
    assert 4 not in [x["index"] for x in request["lines"]]
    assert result.methods[4] == "lrc"
    assert result.lines[4]["words"][0]["start_time"] == pytest.approx(27.0, abs=0.05)


def test_too_few_lines_skip_the_song_pass(tmp_path, neural):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0), (5.0, 7.0)], duration=10.0)
    result = sync_lyrics(vocals, _timed([1.0, 5.0], texts=TEXTS[:2]))
    assert result.report["song_pass"] == "skipped"
    assert json.loads(neural.log.read_text())["version"] == 1


def test_the_dsp_engine_reports_no_song_pass(tmp_path):
    vocals = _vocals(tmp_path / "v.wav", [(1.0, 3.0)], duration=5.0)
    report = sync_lyrics(vocals, _timed([1.0], texts=TEXTS[:1]), engine="dsp").report
    assert report["song_pass"] is None
    assert (report["lines_anchored"], report["offset_segments"]) == (0, [])


def test_progress_follows_the_phases_of_a_song_pass():
    assert lyric_sync._stage_percent({"done": 1, "total": 2}) == 62.5
    assert lyric_sync._stage_percent({"phase": "emission", "done": 5, "total": 10}) == 55
    assert lyric_sync._stage_percent({"phase": "lines", "done": 1, "total": 1}) == 93
    assert lyric_sync._stage_percent({"phase": "song"}) == 93
    assert lyric_sync._stage_percent({"phase": "emission"}) is None
