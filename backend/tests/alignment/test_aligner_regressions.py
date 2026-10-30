"""Regressions for the DSP aligner: final lines past the end of the audio, the untimed
fallback layout, and the block-wise energy helpers."""

import itertools

import numpy as np
import pytest
import soundfile as sf

from backend.services import aligner as aligner_mod
from backend.services.aligner import AudioAligner, align_words_spectral

SR = 16000


def _bursts(duration: float, spans: list[tuple[float, float, float]]) -> np.ndarray:
    t = np.arange(int(SR * duration)) / SR
    audio = np.zeros_like(t, dtype=np.float32)
    for start, end, freq in spans:
        mask = (t >= start) & (t < end)
        audio[mask] = 0.5 * np.sin(2 * np.pi * freq * t[mask])
    return audio


def test_a_final_line_ending_after_the_audio_is_aligned_to_its_own_audio():
    # Singing at the very start of the song must not be mistaken for the last line
    audio = _bursts(6.0, [(0.0, 0.3, 220), (4.8, 5.0, 300), (5.6, 5.95, 330)])
    words = align_words_spectral(audio, SR, ["hold", "on"], line_start=4.8, line_end=6.6)
    assert words[0]["start_time"] == pytest.approx(4.8, abs=0.05)
    assert words[1]["start_time"] == pytest.approx(5.6, abs=0.08)


def test_a_line_that_starts_after_the_audio_gets_proportional_timing():
    audio = _bursts(3.0, [(0.2, 1.0, 300)])
    words = align_words_spectral(audio, SR, ["late", "line"], line_start=5.0, line_end=7.0)
    assert words[0]["start_time"] == 5.0
    assert words[-1]["end_time"] <= 7.0
    assert words[0]["end_time"] <= words[1]["start_time"]


def test_line_local_segments_still_use_the_line_start_as_their_origin():
    segment = _bursts(2.0, [(0.0, 0.8, 300), (1.2, 2.0, 330)])
    words = align_words_spectral(segment, SR, ["one", "two"], line_start=10.0, line_end=12.0)
    assert words[1]["start_time"] == pytest.approx(11.2, abs=0.1)


def test_unreadable_audio_spreads_plain_lyrics_line_after_line():
    lines = [
        {"id": i, "text": f"plain line number {i}", "start_time": 0.0, "end_time": 0.0}
        for i in range(6)
    ]
    aligned = AudioAligner().align_lyrics("/missing/vocals.wav", lines)
    assert len(aligned) == 6
    for previous, line in itertools.pairwise(aligned):
        assert line["start_time"] >= previous["end_time"]
    assert aligned[-1]["start_time"] > 5.0  # not stacked on the first second
    for line in aligned:
        assert line["words"][0]["start_time"] == line["start_time"]
        assert line["words"][-1]["end_time"] <= line["end_time"]


def test_a_failure_after_loading_stretches_plain_lyrics_over_the_track(tmp_path, monkeypatch):
    path = tmp_path / "vocals.wav"
    sf.write(str(path), _bursts(60.0, [(1.0, 50.0, 300)]), SR)

    def boom(*args, **kwargs):
        raise RuntimeError("phrase detection failed")

    monkeypatch.setattr(AudioAligner, "_detect_vocal_phrases", boom)
    lines = [
        {"id": i, "text": "la la la la", "start_time": 0.0, "end_time": 0.0} for i in range(10)
    ]
    aligned = AudioAligner().align_lyrics(str(path), lines)
    assert aligned[0]["start_time"] == 0.0
    assert aligned[-1]["end_time"] == pytest.approx(60.0 * 0.95, rel=0.05)


def test_timed_lines_keep_their_times_in_the_fallback():
    lines = [{"id": 0, "text": "Hello world", "start_time": 3.0, "end_time": 5.0}]
    aligned = AudioAligner().align_lyrics("/missing/vocals.wav", lines)
    assert (aligned[0]["start_time"], aligned[0]["end_time"]) == (3.0, 5.0)


@pytest.mark.parametrize("size", [0, 10, 882, 3_000_001])
def test_blockwise_energy_matches_a_running_sum(size, monkeypatch):
    monkeypatch.setattr(aligner_mod, "_ENERGY_BLOCK", 65536)
    signal = (np.random.default_rng(size).standard_normal(size) * 0.2).astype(np.float32)
    frame, hop = 320, 160
    frames = max(0, (size - frame) // hop)
    if frames:
        cumulative = np.concatenate(([0.0], np.cumsum(signal.astype(np.float64) ** 2)))
        starts = np.arange(frames) * hop
        expected = (cumulative[starts + frame] - cumulative[starts]) / frame
        got = aligner_mod.frame_mean_square(signal, frame, hop, frames)
        np.testing.assert_allclose(got, expected.astype(np.float32), rtol=1e-5, atol=1e-9)
    assert aligner_mod._signal_variance(signal) == pytest.approx(
        float(np.var(signal.astype(np.float64))) if size else 0.0, rel=1e-6, abs=1e-12
    )
