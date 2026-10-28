"""Lyric sync benchmark tool."""

import json

import numpy as np
import pytest
import soundfile as sf

from backend.tools import benchmark_sync

RATE = 16000
WORDS = [
    ("one", 1.0, 1.4),
    ("two", 1.7, 2.1),
    ("three", 2.5, 3.0),
    ("four", 4.0, 4.4),
    ("five", 4.8, 5.3),
]


@pytest.fixture
def song(tmp_path):
    t = np.arange(int(RATE * 7.0)) / RATE
    audio = np.zeros_like(t, dtype=np.float32)
    for _, start, end in WORDS:
        mask = (t >= start) & (t < end)
        audio[mask] = 0.4 * np.sin(2 * np.pi * 250 * t[mask])
    vocals = tmp_path / "vocals.wav"
    sf.write(str(vocals), audio, RATE)
    truth = [
        {
            "text": "one two three",
            "start_time": 1.0,
            "end_time": 3.0,
            "words": [{"word": w, "start_time": s, "end_time": e} for w, s, e in WORDS[:3]],
        },
        {
            "text": "four five",
            "start_time": 4.0,
            "end_time": 5.3,
            "words": [{"word": w, "start_time": s, "end_time": e} for w, s, e in WORDS[3:]],
        },
    ]
    truth_path = tmp_path / "truth.json"
    truth_path.write_text(json.dumps({"lines": truth}))
    return vocals, truth_path, truth


def test_benchmark_reports_word_errors(song, tmp_path, capsys):
    vocals, truth_path, _ = song
    out = tmp_path / "results.json"
    code = benchmark_sync.main(
        ["--vocals", str(vocals), "--truth", str(truth_path), "--engine", "dsp", "--json", str(out)]
    )
    assert code == 0
    results = json.loads(out.read_text())["dsp"]
    assert results["words"] == 5
    assert results["engine_used"] == "dsp"
    assert results["word_mae_ms"] < 150
    assert results["within_300ms"] >= 80
    assert "word_mae_ms" in capsys.readouterr().out


def test_plain_mode_hides_the_line_timing(song):
    _, _, truth = song
    lines = benchmark_sync.aligner_input(truth, "plain")
    assert all(line["start_time"] == line["end_time"] == 0.0 for line in lines)
    assert lines[0]["text"] == "one two three"
    timed = benchmark_sync.aligner_input(truth, "line")
    assert (timed[1]["start_time"], timed[1]["end_time"]) == (4.0, 5.3)


def test_scores_and_correlation_helpers(song):
    _, _, truth = song
    perfect = benchmark_sync.score(truth, truth)
    assert perfect["word_mae_ms"] == 0.0
    assert perfect["within_100ms"] == 100.0
    assert benchmark_sync.spearman([0.9, 0.5, 0.1], [0.01, 0.2, 0.5]) == -1.0
    assert benchmark_sync.spearman([1, 2], [1, 2]) is None


def test_truth_can_be_enhanced_lrc(tmp_path):
    lrc = tmp_path / "truth.lrc"
    lrc.write_text("[00:01.00]<00:01.00>one <00:01.70>two\n[00:04.00]<00:04.00>four\n")
    lines = benchmark_sync.load_truth(lrc)
    assert [w["word"] for w in lines[0]["words"]] == ["one", "two"]
    empty = tmp_path / "none.json"
    empty.write_text("[]")
    with pytest.raises(SystemExit):
        benchmark_sync.load_truth(empty)
