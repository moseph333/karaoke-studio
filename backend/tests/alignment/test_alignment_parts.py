"""Pieces of neural lyric alignment: confidence scoring, tokenization, the CTC worker's
maths and exit codes, alignment settings and the lyric line schema."""

import json
import os
import sys
import types
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf
from pydantic import ValidationError

from backend.schemas import LyricLineSchema
from backend.services import alignment_config, sync_confidence
from backend.services.lyric_tokenize import normalize_for_mms, tokenize_lyric_text
from backend.services.sync_confidence import evidence_score, line_confidence, load_evidence
from backend.shared_assets import load
from backend.workers import ctc_align_worker as worker

RATE = 16000


def _bursts(path: Path, spans, duration: float = 6.0) -> Path:
    t = np.arange(int(RATE * duration)) / RATE
    audio = np.zeros_like(t, dtype=np.float32)
    for start, end in spans:
        mask = (t >= start) & (t < end)
        audio[mask] = 0.4 * np.sin(2 * np.pi * 300 * t[mask])
    sf.write(str(path), audio, RATE)
    return path


def _words(*spans):
    return [{"word": f"w{i}", "start_time": s, "end_time": e} for i, (s, e) in enumerate(spans)]


# ==============================================================================
# Confidence
# ==============================================================================


def test_evidence_rewards_words_on_sung_onsets(tmp_path):
    evidence = load_evidence(_bursts(tmp_path / "v.wav", [(1.0, 1.6), (2.0, 2.6)]))
    assert evidence is not None
    assert list(np.round(evidence.onsets, 2))[:2] == pytest.approx([1.0, 2.0], abs=0.03)

    on_time = evidence_score(_words((1.0, 1.6), (2.0, 2.6)), evidence)
    late = evidence_score(_words((1.25, 1.85), (2.25, 2.85)), evidence)
    in_silence = evidence_score(_words((3.5, 4.0), (4.2, 4.8)), evidence)
    assert on_time > 0.9
    assert on_time > late > in_silence
    assert in_silence < 0.2


def test_words_inside_a_sustained_phrase_need_no_onset(tmp_path):
    evidence = load_evidence(_bursts(tmp_path / "v.wav", [(1.0, 3.0)]))
    legato = _words((1.0, 1.5), (1.5, 2.0), (2.0, 3.0))
    assert evidence_score(legato, evidence) > 0.9


def test_no_evidence_without_audio_or_words(tmp_path):
    assert load_evidence(tmp_path / "missing.wav") is None
    assert load_evidence(None) is None
    garbage = tmp_path / "garbage.wav"
    garbage.write_bytes(b"not audio" * 20)
    assert load_evidence(garbage) is None
    evidence = load_evidence(_bursts(tmp_path / "v.wav", [(1.0, 2.0)]))
    assert evidence_score([], evidence) is None
    assert evidence_score(_words((1.0, 1.0)), evidence) is None
    assert evidence_score(_words((1.0, 1.5)), None) is None


def test_silent_vocals_give_no_support(tmp_path):
    evidence = load_evidence(_bursts(tmp_path / "v.wav", []))
    assert evidence is not None and len(evidence.onsets) == 0
    assert evidence_score(_words((1.0, 2.0)), evidence) == 0.0


def test_evidence_is_cached_until_the_file_changes(tmp_path, monkeypatch):
    path = _bursts(tmp_path / "v.wav", [(1.0, 2.0)])
    calls = []
    real = sync_confidence._analyze
    monkeypatch.setattr(sync_confidence, "_analyze", lambda p: calls.append(p) or real(p))
    first = load_evidence(path)
    assert load_evidence(path) is first
    _bursts(path, [(3.0, 4.0)])
    os.utime(path, (os.path.getmtime(path) + 5,) * 2)
    second = load_evidence(path)
    assert len(calls) == 2
    assert second.onsets[0] == pytest.approx(3.0, abs=0.03)


@pytest.mark.parametrize(
    ("method", "evidence", "ctc", "expected"),
    [
        ("lrc", 0.4, None, 0.9),
        ("lrc", 0.97, None, 0.97),
        ("ctc", 0.5, 0.9, 0.74),
        ("ctc", None, 0.8, 0.8),
        ("dsp", 0.65, None, 0.65),
        ("dsp", None, None, None),
        ("fallback", 0.9, None, 0.2),
        ("manual", 0.9, None, None),
    ],
)
def test_line_confidence_per_method(method, evidence, ctc, expected):
    assert line_confidence(method, evidence, ctc) == expected


# ==============================================================================
# Tokenization
# ==============================================================================


def test_tokenizer_matches_the_studio_editor():
    # The same cases run against the studio's tokenizer (frontend tests/lyrics.test.ts)
    for case in load("tokenize_cases"):
        assert tokenize_lyric_text(case["text"]) == case["tokens"], case["text"]
    assert tokenize_lyric_text(None) == []


@pytest.mark.parametrize(
    ("token", "expected"),
    [
        ("Don\N{RIGHT SINGLE QUOTATION MARK}t!", "don't"),
        ("Caf\N{LATIN SMALL LETTER E WITH ACUTE}", "cafe"),
        ("ROCK", "rock"),
        ("'cause", "cause"),
        ("Hello,", "hello"),
        ("\N{EM DASH}", ""),
        ("", ""),
    ],
)
def test_tokens_are_normalized_to_mms_letters(token, expected):
    assert normalize_for_mms(token) == expected


def test_digits_and_other_scripts_use_the_optional_helpers(monkeypatch):
    from backend.services import lyric_tokenize

    lyric_tokenize._num2words.cache_clear()
    lyric_tokenize._uroman.cache_clear()
    fake_num2words = types.ModuleType("num2words")
    fake_num2words.num2words = lambda n, lang="en": {2: "two", 99: "ninety-nine"}[n]
    fake_uroman = types.ModuleType("uroman")
    fake_uroman.Uroman = lambda: types.SimpleNamespace(romanize_string=lambda s: "nihao")
    monkeypatch.setitem(sys.modules, "num2words", fake_num2words)
    monkeypatch.setitem(sys.modules, "uroman", fake_uroman)
    try:
        assert normalize_for_mms("2") == "two"
        assert normalize_for_mms("99") == "ninetynine"
        assert (
            normalize_for_mms("\N{CJK UNIFIED IDEOGRAPH-4F60}\N{CJK UNIFIED IDEOGRAPH-597D}")
            == "nihao"
        )
    finally:
        lyric_tokenize._num2words.cache_clear()
        lyric_tokenize._uroman.cache_clear()


# ==============================================================================
# CTC worker
# ==============================================================================


class Span:
    def __init__(self, start, end, score):
        self.start, self.end, self.score = start, end, score


def test_worker_maths_turns_token_spans_into_word_times():
    words = worker.spans_to_words(
        [[Span(10, 12, 0.9), Span(12, 16, 0.6)], [Span(20, 30, 1.0)]],
        seconds_per_frame=0.02,
        offset=5.0,
    )
    assert words[0] == {"start": 5.2, "end": 5.32, "score": 0.7, "frames": 6}
    assert words[1]["start"] == 5.4
    assert worker.line_summary(words, star_frames=8, total_frames=40) == (0.8875, 0.2)
    assert worker.line_summary([], 0, 0) == (0.0, 1.0)
    assert worker.count_repeats([3, 3, 5, 5, 5, 1]) == 3
    assert worker._unflatten([1, 2, 3, 4], [1, 2, 1]) == [[1], [2, 3], [4]]


def test_worker_skips_lines_it_cannot_align():
    waveform = types.SimpleNamespace(shape=(1, worker.SAMPLE_RATE * 10))
    empty = worker.align_line(None, waveform, {"index": 3, "words": ["", ""]}, {}, 28, None, None)
    assert (empty["status"], empty["words"]) == ("empty", [None, None])
    short = worker.align_line(
        None,
        waveform,
        {"index": 4, "window_start": 2.0, "window_end": 2.05, "words": ["a"]},
        {},
        28,
        None,
        None,
    )
    assert (short["status"], short["error"]) == ("failed", "window too short")


def _request(tmp_path, **overrides):
    request = {
        "version": 1,
        "audio": str(_bursts(tmp_path / "v.wav", [(1.0, 2.0)])),
        "model_dir": str(tmp_path / "models"),
        "allow_download": False,
        "lines": [{"index": 0, "window_start": 0.5, "window_end": 2.5, "words": ["hello"]}],
        **overrides,
    }
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request))
    return ["--request", str(path), "--response", str(tmp_path / "response.json")]


def _events(capsys):
    return [json.loads(x) for x in capsys.readouterr().err.splitlines() if x.startswith('{"event"')]


def test_worker_exit_codes(tmp_path, capsys, monkeypatch):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json")
    assert (
        worker.main(["--request", str(bad), "--response", str(tmp_path / "r.json")])
        == worker.EXIT_USAGE
    )
    assert worker.main(_request(tmp_path, version=9)) == worker.EXIT_USAGE

    monkeypatch.setitem(sys.modules, "torch", None)
    assert worker.main(_request(tmp_path)) == worker.EXIT_IMPORT
    assert _events(capsys)[-1]["code"] == "import"

    # With PyTorch importable, a missing model and no downloads stop before loading anything
    torchaudio = types.ModuleType("torchaudio")
    torchaudio.functional = types.ModuleType("torchaudio.functional")
    torchaudio.pipelines = types.ModuleType("torchaudio.pipelines")
    torchaudio.pipelines.MMS_FA = object()
    for name, module in {
        "torch": types.ModuleType("torch"),
        "torchaudio": torchaudio,
        "torchaudio.functional": torchaudio.functional,
        "torchaudio.pipelines": torchaudio.pipelines,
    }.items():
        monkeypatch.setitem(sys.modules, name, module)
    assert worker.main(_request(tmp_path)) == worker.EXIT_WEIGHTS_MISSING
    assert _events(capsys)[-1]["code"] == "weights_missing"
    assert not (tmp_path / "response.json").exists()


# ==============================================================================
# Settings
# ==============================================================================


def test_alignment_settings(monkeypatch, tmp_path):
    monkeypatch.setenv("ALIGNMENT_ENGINE", " CTC ")
    assert alignment_config.requested_engine() == "ctc"
    monkeypatch.setenv("ALIGNMENT_ENGINE", "whisper")
    assert alignment_config.requested_engine() == "auto"
    monkeypatch.setenv("ALIGNMENT_MIN_CONFIDENCE", "7")
    assert alignment_config.min_confidence() == 1.0
    monkeypatch.setenv("ALIGNMENT_MODEL_DIR", str(tmp_path))
    assert alignment_config.model_dir() == tmp_path

    installed = {"torch": True, "torchaudio": True}
    monkeypatch.setattr(alignment_config, "package_available", lambda name: installed[name])
    monkeypatch.setattr(alignment_config, "package_version", lambda name: "2.9.1")
    assert alignment_config.ctc_status() == (
        False,
        "torchaudio 2.9.1 is too old (2.10 or newer is needed)",
    )
    monkeypatch.setattr(alignment_config, "package_version", lambda name: "2.11.0")
    monkeypatch.setenv("ALIGNMENT_ALLOW_DOWNLOAD", "0")
    ready, reason = alignment_config.ctc_status()
    assert not ready and "automatic download is disabled" in reason
    (tmp_path / alignment_config.WEIGHTS_FILE).write_bytes(b"weights")
    assert alignment_config.ctc_status() == (True, None)
    assert alignment_config.effective_engine("auto") == ("ctc", None)
    assert alignment_config.effective_engine("dsp") == ("dsp", None)
    installed["torch"] = False
    assert alignment_config.effective_engine("ctc") == ("dsp", "PyTorch is not installed")
    caps = alignment_config.alignment_capabilities()
    assert caps["ctc_available"] is False
    assert "CC-BY-NC" in caps["license_note"]


# ==============================================================================
# Schema
# ==============================================================================


def test_lyric_lines_carry_validated_timing_metadata():
    line = LyricLineSchema(start_time=1, end_time=2, text="x", confidence=0.75, align_method="ctc")
    assert line.model_dump()["confidence"] == 0.75
    plain = LyricLineSchema(start_time=1, end_time=2, text="x").model_dump()
    assert "confidence" not in plain and "align_method" not in plain
    with pytest.raises(ValidationError):
        LyricLineSchema(start_time=1, end_time=2, confidence=float("nan"))
    with pytest.raises(ValidationError):
        LyricLineSchema(start_time=1, end_time=2, align_method="guess")


def test_saving_lyrics_keeps_confidence(client):
    import backend.main as main_mod

    main_mod.projects["conf1"] = {"id": "conf1", "lines": []}
    body = {
        "lines": [
            {"text": "x", "start_time": 1, "end_time": 2, "confidence": 0.4, "align_method": "dsp"},
            {"text": "y", "start_time": 2, "end_time": 3, "align_method": "manual"},
        ]
    }
    assert client.post("/api/project/conf1/lyrics", json=body).status_code == 200
    saved = main_mod.projects["conf1"]["lines"]
    assert (saved[0]["confidence"], saved[0]["align_method"]) == (0.4, "dsp")
    assert "confidence" not in saved[1] and saved[1]["align_method"] == "manual"
