import re

import numpy as np
import soundfile as sf

from backend.services.aligner import AudioAligner


def test_align_lyrics_with_audio(tmp_path):
    """Verifies standard word alignment against simulated vocals burst."""
    sr = 44100
    duration = 6.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    # Simulate vocals burst between 1.0s and 4.0s
    vocals = np.zeros_like(t)
    active_mask = (t >= 1.0) & (t <= 4.0)
    vocals[active_mask] = 0.5 * np.sin(2 * np.pi * 500 * t[active_mask])

    vocals_file = tmp_path / "vocals_sim.wav"
    sf.write(str(vocals_file), vocals, sr)

    aligner = AudioAligner()
    raw_lines = [
        {"id": 0, "text": "Sing a song for me", "start_time": 1.0, "end_time": 4.0, "words": []}
    ]

    aligned = aligner.align_lyrics(str(vocals_file), raw_lines)
    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 5

    # Check that word boundaries are strictly monotonic
    words = aligned[0]["words"]
    for i in range(len(words)):
        assert words[i]["start_time"] < words[i]["end_time"]
        if i + 1 < len(words):
            assert words[i]["end_time"] <= words[i + 1]["start_time"] + 0.05


def test_align_lyrics_empty_audio_file(tmp_path):
    """Verifies that an audio file with 0 samples does not cause scalar division warnings or NaN."""
    aligner = AudioAligner()
    empty_file = tmp_path / "empty_vocals.wav"
    sf.write(str(empty_file), np.zeros((0,), dtype=np.float32), 44100)

    lines = [{"id": 0, "text": "Empty audio test line", "start_time": 0.0, "end_time": 2.0}]
    aligned = aligner.align_lyrics(str(empty_file), lines)

    assert len(aligned) == 1
    words = aligned[0]["words"]
    assert len(words) == 4
    for w in words:
        assert isinstance(w["start_time"], (int, float))
        assert not np.isnan(w["start_time"])
        assert not np.isnan(w["end_time"])
        assert w["start_time"] < w["end_time"]


def test_align_lyrics_silent_audio(tmp_path):
    """Verifies pure silence audio produces normalized zero energy without NaN propagation."""
    aligner = AudioAligner()
    silent_file = tmp_path / "silent_vocals.wav"
    sf.write(str(silent_file), np.zeros(44100 * 3, dtype=np.float32), 44100)

    lines = [{"id": 0, "text": "Silent night peaceful night", "start_time": 0.5, "end_time": 2.5}]
    aligned = aligner.align_lyrics(str(silent_file), lines)

    assert len(aligned) == 1
    words = aligned[0]["words"]
    assert len(words) == 4
    for i, w in enumerate(words):
        assert not np.isnan(w["start_time"])
        assert not np.isnan(w["end_time"])
        assert w["start_time"] < w["end_time"]
        if i + 1 < len(words):
            assert words[i]["end_time"] <= words[i + 1]["start_time"] + 0.05


def test_align_lyrics_stereo_to_mono(tmp_path):
    """Verifies stereo and multi-channel vocal audio are safely downmixed to mono."""
    aligner = AudioAligner()
    stereo_file = tmp_path / "stereo_vocals.wav"
    sr = 44100
    t = np.linspace(0, 2.0, sr * 2, endpoint=False)
    # 2 channels with different content
    ch1 = 0.5 * np.sin(2 * np.pi * 440 * t)
    ch2 = 0.3 * np.cos(2 * np.pi * 880 * t)
    stereo_data = np.stack([ch1, ch2], axis=-1)
    sf.write(str(stereo_file), stereo_data, sr)

    lines = [{"id": 0, "text": "Stereo channels mixed down", "start_time": 0.2, "end_time": 1.8}]
    aligned = aligner.align_lyrics(str(stereo_file), lines)

    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 4
    for w in aligned[0]["words"]:
        assert w["start_time"] < w["end_time"]


def test_align_lyrics_all_zero_timestamps(tmp_path):
    """Verifies un-timed plain text lines (0.0 to 0.0) are distributed across active singing span."""
    sr = 44100
    duration = 8.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)
    # Active vocal region between 2.0s and 6.0s
    active = (t >= 2.0) & (t <= 6.0)
    vocals[active] = 0.4 * np.sin(2 * np.pi * 400 * t[active])

    vocals_file = tmp_path / "timed_burst.wav"
    sf.write(str(vocals_file), vocals, sr)

    aligner = AudioAligner()
    plain_lines = [
        {"id": 0, "text": "First untimed line", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Second untimed line", "start_time": 0.0, "end_time": 0.0},
    ]

    aligned = aligner.align_lyrics(str(vocals_file), plain_lines)
    assert len(aligned) == 2
    assert aligned[0]["start_time"] < aligned[0]["end_time"]
    assert aligned[1]["start_time"] < aligned[1]["end_time"]
    assert aligned[0]["end_time"] <= aligned[1]["start_time"] + 0.1
    # Line 0 starts near active region onset
    assert aligned[0]["start_time"] >= 1.5


def test_align_lyrics_energy_boundary_refinement(tmp_path):
    """Verifies word boundaries nudge toward acoustic onset rather than uniform split."""
    sr = 44100
    duration = 5.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)

    # First word starts late in line window (burst starts at 1.5s while line starts at 1.0s)
    active = (t >= 1.5) & (t <= 3.5)
    vocals[active] = 0.6 * np.sin(2 * np.pi * 600 * t[active])

    vocals_file = tmp_path / "delayed_onset.wav"
    sf.write(str(vocals_file), vocals, sr)

    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Delayed vocal onset", "start_time": 1.0, "end_time": 4.0}]
    aligned = aligner.align_lyrics(str(vocals_file), lines)

    words = aligned[0]["words"]
    assert len(words) == 3
    # Word 0 should have nudged past 1.0s towards acoustic onset
    assert words[0]["start_time"] > 1.0
    for i in range(len(words)):
        assert words[i]["start_time"] < words[i]["end_time"]
        if i + 1 < len(words):
            assert words[i]["end_time"] <= words[i + 1]["start_time"] + 0.05


def test_align_lyrics_single_word_and_empty_line(tmp_path):
    """Verifies edge cases with single-word lines and empty lines."""
    aligner = AudioAligner()
    vocal_file = tmp_path / "dummy.wav"
    sf.write(str(vocal_file), np.zeros(44100), 44100)

    lines = [
        {"id": 0, "text": "Solo", "start_time": 0.5, "end_time": 1.5},
        {"id": 1, "text": "   ", "start_time": 1.5, "end_time": 2.5},
    ]
    aligned = aligner.align_lyrics(str(vocal_file), lines)

    assert len(aligned) == 2
    assert len(aligned[0]["words"]) == 1
    assert aligned[0]["words"][0]["word"] == "Solo"
    assert aligned[0]["words"][0]["start_time"] == 0.5
    assert aligned[0]["words"][0]["end_time"] == 1.5
    assert len(aligned[1]["words"]) == 0


def test_align_lyrics_missing_audio_fallback():
    """Verifies non-existent audio file falls back gracefully without crashing."""
    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Fallback without file", "start_time": 1.0, "end_time": 3.0}]
    aligned = aligner.align_lyrics("/tmp/nonexistent_audio_path_12345.wav", lines)

    assert len(aligned) == 1
    words = aligned[0]["words"]
    assert len(words) == 3
    assert words[0]["start_time"] == 1.0
    assert words[-1]["end_time"] == 3.0


def test_align_lyrics_sub_frame_audio(tmp_path):
    """Verifies very short audio (<20ms frame length) does not raise IndexError or ZeroDivisionError."""
    aligner = AudioAligner()
    short_file = tmp_path / "short.wav"
    # 5ms of audio at 44.1kHz = 220 samples < 882 frame_length
    sf.write(str(short_file), np.ones(220, dtype=np.float32) * 0.1, 44100)

    lines = [{"id": 0, "text": "Fast chirp", "start_time": 0.0, "end_time": 0.05}]
    aligned = aligner.align_lyrics(str(short_file), lines)

    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 2


def test_align_lyrics_high_sample_rate(tmp_path):
    """Verifies 96kHz studio audio operates cleanly with scaled hop/frame sizes."""
    aligner = AudioAligner()
    high_sr_file = tmp_path / "high_sr.wav"
    sr = 96000
    t = np.linspace(0, 1.0, sr, endpoint=False)
    sf.write(str(high_sr_file), 0.5 * np.sin(2 * np.pi * 1000 * t), sr)

    lines = [{"id": 0, "text": "Studio master audio alignment", "start_time": 0.1, "end_time": 0.9}]
    aligned = aligner.align_lyrics(str(high_sr_file), lines)

    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 4
    for w in aligned[0]["words"]:
        assert w["start_time"] < w["end_time"]


def test_align_lyrics_strips_stray_tags_and_preserves_line_timings(tmp_path):
    """Verifies align_lyrics strips raw timestamp tags and preserves line start/end boundaries."""
    sr = 44100
    duration = 8.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)
    # Energy burst around 4.5s - 6.5s
    active_mask = (t >= 4.5) & (t <= 6.5)
    vocals[active_mask] = 0.5 * np.sin(2 * np.pi * 440 * t[active_mask])

    vocals_file = tmp_path / "vocals_tags.wav"
    sf.write(str(vocals_file), vocals, sr)

    aligner = AudioAligner()
    lines_with_tags = [
        {
            "id": 0,
            "text": "[00:04.20] Clean text line <00:05.10> without tags [00:07.00]",
            "start_time": 4.20,
            "end_time": 7.00,
            "words": [],
        }
    ]

    aligned = aligner.align_lyrics(str(vocals_file), lines_with_tags)
    assert len(aligned) == 1
    line = aligned[0]
    assert line["start_time"] == 4.20
    assert line["end_time"] == 7.00
    assert line["text"] == "Clean text line without tags"

    # Verify no word contains brackets or angle tags
    assert len(line["words"]) == 5
    for w in line["words"]:
        assert not re.search(r"\[\d{1,2}:\d{2}", w["word"])
        assert not re.search(r"<\d{1,2}:\d{2}", w["word"])
        assert w["start_time"] >= 4.20
        assert w["end_time"] <= 7.00


def test_fallback_distribute_words_strips_stray_tags():
    """Verifies _fallback_distribute_words strips tags even when audio analysis is bypassed."""
    aligner = AudioAligner()
    lines_with_tags = [
        {
            "id": 0,
            "text": "[00:01.00] Fallback line <00:02.00> testing",
            "start_time": 1.0,
            "end_time": 4.0,
        }
    ]
    res = aligner._fallback_distribute_words(lines_with_tags)
    assert len(res) == 1
    assert res[0]["text"] == "Fallback line testing"
    words = res[0]["words"]
    assert len(words) == 3
    for w in words:
        assert not re.search(r"\[\d{1,2}:\d{2}", w["word"])
        assert not re.search(r"<\d{1,2}:\d{2}", w["word"])
