import math
import re

import numpy as np
import soundfile as sf

from backend.services.aligner import (
    AudioAligner,
    calculate_word_weight,
    count_syllables,
    enforce_monotonic_words,
    estimate_global_offset,
)


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

    aligned = aligner.align_lyrics(str(vocals_file), lines_with_tags, refine_line_boundaries=False)
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


def test_untimed_lyrics_multi_phrase_gap_avoidance(tmp_path):
    """
    Verifies that for un-timed (plain text) lyrics against multi-phrase vocal audio
    separated by >= 1.5s silent gaps, < 15% (and ideally < 5%) of total assigned word
    duration falls within silent intervals.
    """
    sr = 44100
    duration = 30.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)

    # 3 distinct singing phrases separated by > 1.5s silence:
    # Phrase 0: 3.0s - 7.0s (4s)
    # Gap 1: 7.0s - 10.0s (3s silence >= 1.5s)
    # Phrase 1: 10.0s - 16.0s (6s)
    # Gap 2: 16.0s - 20.0s (4s silence >= 1.5s)
    # Phrase 2: 20.0s - 26.0s (6s)
    # Outro: 26.0s - 30.0s (4s silence)
    vocals[(t >= 3.0) & (t <= 7.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 3.0) & (t <= 7.0)])
    vocals[(t >= 10.0) & (t <= 16.0)] = 0.5 * np.sin(2 * np.pi * 550 * t[(t >= 10.0) & (t <= 16.0)])
    vocals[(t >= 20.0) & (t <= 26.0)] = 0.5 * np.sin(2 * np.pi * 660 * t[(t >= 20.0) & (t <= 26.0)])

    vocal_file = tmp_path / "multi_phrase_vocals.wav"
    sf.write(str(vocal_file), vocals, sr)

    aligner = AudioAligner()
    plain_lines = [
        {"id": 0, "text": "First phrase singing loud", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Still singing first phrase", "start_time": 0.0, "end_time": 0.0},
        {"id": 2, "text": "Second phrase in the middle", "start_time": 0.0, "end_time": 0.0},
        {"id": 3, "text": "More words for second phrase", "start_time": 0.0, "end_time": 0.0},
        {"id": 4, "text": "Third phrase almost finished", "start_time": 0.0, "end_time": 0.0},
        {"id": 5, "text": "Final closing line tonight", "start_time": 0.0, "end_time": 0.0},
    ]

    aligned = aligner.align_lyrics(str(vocal_file), plain_lines)
    assert len(aligned) == 6

    # Calculate word duration falling within silent gaps
    silent_intervals = [(0.0, 3.0), (7.0, 10.0), (16.0, 20.0), (26.0, 30.0)]
    total_word_dur = 0.0
    silent_word_dur = 0.0

    for line in aligned:
        assert line["start_time"] < line["end_time"]
        words = line.get("words", [])
        assert len(words) > 0
        for i, w in enumerate(words):
            ws, we = w["start_time"], w["end_time"]
            assert ws < we
            if i + 1 < len(words):
                assert we <= words[i + 1]["start_time"] + 0.01

            wdur = we - ws
            total_word_dur += wdur
            for s_start, s_end in silent_intervals:
                overlap = max(0.0, min(we, s_end) - max(ws, s_start))
                silent_word_dur += overlap

    silent_gap_pct = (silent_word_dur / total_word_dur) * 100.0 if total_word_dur > 0 else 0.0
    # Acceptance criteria: < 15% word duration in silent gaps (typically < 3%)
    assert silent_gap_pct < 15.0, f"Silent gap word duration too high: {silent_gap_pct:.2f}%"
    assert silent_gap_pct < 5.0, f"Expected < 5% gap intrusion, got {silent_gap_pct:.2f}%"

    # Also assert that lines 0 and 1 are placed within phrase 0 (before gap 1 at 7.0s)
    assert aligned[0]["start_time"] >= 2.8
    assert aligned[1]["end_time"] <= 7.2
    # Lines 2 and 3 within phrase 1 (10.0s to 16.0s)
    assert aligned[2]["start_time"] >= 9.8
    assert aligned[3]["end_time"] <= 16.2
    # Lines 4 and 5 within phrase 2 (20.0s to 26.0s)
    assert aligned[4]["start_time"] >= 19.8
    assert aligned[5]["end_time"] <= 26.2


def test_untimed_lyrics_syllable_scaling(tmp_path):
    """
    Verifies that un-timed line durations scale with syllable and character/vowel content
    rather than being assigned uniform time slices.
    """
    sr = 44100
    duration = 14.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)
    # Continuous active singing between 1.0s and 13.0s (12.0s duration)
    active = (t >= 1.0) & (t <= 13.0)
    vocals[active] = 0.5 * np.sin(2 * np.pi * 500 * t[active])

    vocal_file = tmp_path / "long_phrase_vocals.wav"
    sf.write(str(vocal_file), vocals, sr)

    aligner = AudioAligner()
    lines = [
        {"id": 0, "text": "Hi", "start_time": 0.0, "end_time": 0.0},
        {
            "id": 1,
            "text": "Looking down at all the long shadows moving slowly across the valley tonight",
            "start_time": 0.0,
            "end_time": 0.0,
        },
    ]

    aligned = aligner.align_lyrics(str(vocal_file), lines)
    assert len(aligned) == 2

    dur_short = aligned[0]["end_time"] - aligned[0]["start_time"]
    dur_long = aligned[1]["end_time"] - aligned[1]["start_time"]

    # Content-weighted scaling: the 13-word line must receive substantially more duration than "Hi"
    assert dur_long > 3.0 * dur_short, (
        f"Line durations did not scale with syllable content: short={dur_short:.2f}s, long={dur_long:.2f}s"
    )


def test_untimed_lyrics_fewer_lines_than_phrases(tmp_path):
    """
    Verifies handling of M < K (e.g. 2 lines across 4 active vocal phrases).
    Closest adjacent phrases are merged, preserving large instrumental pauses.
    """
    sr = 44100
    duration = 24.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)

    # 4 phrases: (2-4s), (5-7s) [gap=1s], (15-17s) [gap=8s], (18-20s) [gap=1s]
    vocals[(t >= 2.0) & (t <= 4.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 2.0) & (t <= 4.0)])
    vocals[(t >= 5.0) & (t <= 7.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 5.0) & (t <= 7.0)])
    vocals[(t >= 15.0) & (t <= 17.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 15.0) & (t <= 17.0)])
    vocals[(t >= 18.0) & (t <= 20.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 18.0) & (t <= 20.0)])

    vocal_file = tmp_path / "four_phrases.wav"
    sf.write(str(vocal_file), vocals, sr)

    aligner = AudioAligner()
    lines = [
        {"id": 0, "text": "First section sung here", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Second section sung here", "start_time": 0.0, "end_time": 0.0},
    ]

    aligned = aligner.align_lyrics(str(vocal_file), lines)
    assert len(aligned) == 2

    # Line 0 should be in the first half (ends before 8.0s)
    assert aligned[0]["end_time"] <= 8.0
    # Line 1 should be in the second half (starts after 14.0s)
    assert aligned[1]["start_time"] >= 14.0
    # The 8-second instrumental gap (8.0s - 14.0s) contains zero words
    for line in aligned:
        for w in line.get("words", []):
            assert not (8.0 < w["start_time"] < 14.0)
            assert not (8.0 < w["end_time"] < 14.0)


def test_detect_vocal_phrases_bridging_and_pruning():
    """
    Unit test for _detect_vocal_phrases:
    - Micro-pauses (< 1.25s) within a phrase are bridged.
    - Silent intervals (>= 1.5s) are preserved as distinct phrase boundaries.
    - Transient blips (< 0.35s) are pruned.
    """
    aligner = AudioAligner()
    sr = 1000
    hop = 10  # 10ms per frame
    num_frames = 2000  # 20 seconds
    energy = np.zeros(num_frames, dtype=np.float32)

    # Phrase 1 with 0.6s micro-pause: (2.0-4.0s) and (4.6-6.0s)
    energy[200:400] = 0.8
    energy[460:600] = 0.8

    # Transient blip of 0.2s: (8.0-8.2s)
    energy[800:820] = 0.8

    # Phrase 2: (12.0-16.0s)
    energy[1200:1600] = 0.8

    phrases = aligner._detect_vocal_phrases(energy, sample_rate=sr, hop_length=hop)

    # Should detect 2 phrases (the micro-pause is bridged; the blip is pruned)
    assert len(phrases) == 2
    # Phrase 0 spans ~2.0 to ~6.0
    assert 1.8 <= phrases[0][0] <= 2.2
    assert 5.8 <= phrases[0][1] <= 6.2
    # Phrase 1 spans ~12.0 to ~16.0
    assert 11.8 <= phrases[1][0] <= 12.2
    assert 15.8 <= phrases[1][1] <= 16.2


def test_partition_lines_into_phrases_fallback_and_edge_cases():
    """Verifies edge cases in _partition_lines_into_phrases."""
    aligner = AudioAligner()

    # K == 0 fallback: silent audio duration = 20.0s
    lines = [
        {"id": 0, "text": "Silent song verse one", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Silent song verse two", "start_time": 0.0, "end_time": 0.0},
    ]
    res_silent = aligner._partition_lines_into_phrases(lines, phrases=[], duration=20.0)
    assert len(res_silent) == 2
    assert res_silent[0]["start_time"] < res_silent[0]["end_time"]
    assert res_silent[1]["start_time"] < res_silent[1]["end_time"]
    assert res_silent[0]["end_time"] <= res_silent[1]["start_time"] + 0.1

    # Empty text line handling
    empty_lines = [
        {"id": 0, "text": "   ", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Normal text", "start_time": 0.0, "end_time": 0.0},
    ]
    res_empty = aligner._partition_lines_into_phrases(
        empty_lines, phrases=[(2.0, 5.0), (7.0, 10.0)], duration=12.0
    )
    assert len(res_empty) == 2
    assert res_empty[0]["start_time"] < res_empty[0]["end_time"]
    assert res_empty[1]["start_time"] < res_empty[1]["end_time"]


def test_count_syllables_and_word_weights():
    """Verifies rule-based syllable counting and weighting heuristic."""
    assert count_syllables("a") == 1
    assert count_syllables("the") == 1
    assert count_syllables("world") == 1
    assert count_syllables("Hello") == 2
    assert count_syllables("Singing") == 2
    assert count_syllables("tonight") == 2
    assert count_syllables("Mississippi") == 4
    assert count_syllables("supercalifragilistic") >= 7

    # Weight of 4-syllable word must exceed single-syllable word
    w_short = calculate_word_weight("the")
    w_long = calculate_word_weight("Mississippi")
    assert w_long > 2.5 * w_short

    # Punctuation bonus
    w_plain = calculate_word_weight("hello")
    w_comma = calculate_word_weight("hello,")
    assert w_comma == w_plain + 1.0


def test_enforce_monotonic_words_overlap_and_gap_handling():
    """Verifies forward sweep resolves overlaps and preserves valid intra-line gaps."""
    words = ["WordA", "WordB", "WordC"]

    # 1. Overlapping raw spans: WordA ends at 1.5, WordB candidate starts at 1.2
    raw_overlapping = [(1.0, 1.5), (1.2, 2.0), (1.9, 2.8)]
    res_overlap = enforce_monotonic_words(words, raw_overlapping, l_start=1.0, l_end=3.0)
    assert len(res_overlap) == 3
    for i in range(len(res_overlap)):
        assert res_overlap[i]["start_time"] < res_overlap[i]["end_time"]
        if i + 1 < len(res_overlap):
            assert res_overlap[i]["end_time"] <= res_overlap[i + 1]["start_time"]

    # 2. Gapped raw spans: WordA ends at 1.5, WordB candidate starts at 2.2 (0.7s gap)
    raw_gapped = [(1.0, 1.5), (2.2, 2.7), (2.7, 3.2)]
    res_gap = enforce_monotonic_words(words, raw_gapped, l_start=1.0, l_end=3.5)
    assert len(res_gap) == 3
    # Gap between WordA and WordB is preserved (WordB starts >= 2.2)
    assert res_gap[1]["start_time"] >= 2.2
    assert res_gap[0]["end_time"] <= 1.51


def test_trailing_silence_snapping_behavior(tmp_path):
    """Verifies that trailing silence >= 0.25s snaps final word end_time to cessation while preserving line boundary."""
    sr = 44100
    duration = 5.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)

    # Singing burst active only between 1.0s and 2.5s (trailing silence: 4.0 - 2.5 = 1.5s >= 0.25s)
    active = (t >= 1.0) & (t <= 2.5)
    vocals[active] = 0.5 * np.sin(2 * np.pi * 440 * t[active])

    vocal_file = tmp_path / "trailing_silence.wav"
    sf.write(str(vocal_file), vocals, sr)

    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Quick singing phrase", "start_time": 1.0, "end_time": 4.0}]
    aligned = aligner.align_lyrics(str(vocal_file), lines, refine_line_boundaries=False)

    assert len(aligned) == 1
    # Line boundaries preserved
    assert aligned[0]["start_time"] == 1.0
    assert aligned[0]["end_time"] == 4.0

    words = aligned[0]["words"]
    assert len(words) == 3
    # Final word must end near active cessation (~2.58s with 80ms hangover) and NOT stretch to 4.0s
    assert words[-1]["end_time"] < 3.0
    assert words[-1]["end_time"] >= 2.45
    assert words[-1]["end_time"] <= aligned[0]["end_time"]


def test_intra_line_pause_preservation(tmp_path):
    """Verifies intra-line vocal pause (>= 0.25s) between words is preserved rather than unconditionally chained."""
    sr = 44100
    duration = 6.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)

    # Burst 1: 1.0s to 1.8s
    # Pause: 1.8s to 2.8s (1.0s pause)
    # Burst 2: 2.8s to 3.8s
    vocals[(t >= 1.0) & (t <= 1.8)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 1.0) & (t <= 1.8)])
    vocals[(t >= 2.8) & (t <= 3.8)] = 0.5 * np.sin(2 * np.pi * 550 * t[(t >= 2.8) & (t <= 3.8)])

    vocal_file = tmp_path / "intra_pause.wav"
    sf.write(str(vocal_file), vocals, sr)

    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Burst one, burst two", "start_time": 1.0, "end_time": 5.0}]
    aligned = aligner.align_lyrics(str(vocal_file), lines)

    assert len(aligned) == 1
    words = aligned[0]["words"]
    assert len(words) == 4

    # Words 0 & 1 belong to burst 1, words 2 & 3 belong to burst 2
    # There should be an intra-line pause between words[1] and words[2]
    pause_gap = words[2]["start_time"] - words[1]["end_time"]
    assert pause_gap >= 0.5, f"Expected intra-line pause >= 0.5s, got {pause_gap:.3f}s"


def test_estimate_global_offset_positive_and_negative_shifts():
    """Verifies estimate_global_offset recovers positive and negative shifts (+-1s, +-3s, +-8s) within 150ms MAE."""
    sr = 44100
    base_events = [
        (9.0, 11.0),
        (13.0, 15.0),
        (17.0, 19.0),
    ]
    lines = [
        {"id": 0, "text": "First line phrase", "start_time": 9.0, "end_time": 11.0},
        {"id": 1, "text": "Second line phrase", "start_time": 13.0, "end_time": 15.0},
        {"id": 2, "text": "Third line phrase", "start_time": 17.0, "end_time": 19.0},
    ]

    test_shifts = [1.0, -1.0, 3.0, -3.0, 8.0, -8.0]
    errors = []

    for shift in test_shifts:
        # Ground truth audio events shifted by `shift`
        shifted_events = [(s + shift, e + shift) for s, e in base_events]
        total_dur = max(32.0, max(e for _, e in shifted_events) + 3.0)
        n_samples = int(total_dur * sr)
        audio = np.zeros(n_samples, dtype=np.float32)
        t = np.linspace(0, total_dur, n_samples, endpoint=False)

        for s_ev, e_ev in shifted_events:
            idx_s = max(0, int(s_ev * sr))
            idx_e = min(n_samples, int(e_ev * sr))
            if idx_e > idx_s:
                audio[idx_s:idx_e] = 0.5 * np.sin(2 * np.pi * 440 * t[idx_s:idx_e])

        # Positive shift means audio is at t + shift, lyrics say t -> lyrics lead by shift
        est_offset, confidence = estimate_global_offset(audio, sr, lines, max_offset=15.0)
        err = abs(est_offset - shift)
        errors.append(err)
        assert err <= 0.150, f"Shift {shift}s: estimated {est_offset}s, error {err:.3f}s > 0.150s"
        assert confidence >= 0.20, f"Shift {shift}s: low confidence {confidence:.3f}"

    mae = float(np.mean(errors))
    assert mae <= 0.080, f"Mean absolute error {mae * 1000:.1f}ms exceeds target 80ms"


def test_estimate_global_offset_uncorrelated_candidate_rejection():
    """Verifies that mismatched lyrics temporal structure produces confidence < 0.15 and returns offset 0.0."""
    sr = 44100
    duration = 14.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = np.zeros_like(t)

    # Audio only has singing at the very end: 10.0 to 12.0s
    active = (t >= 10.0) & (t <= 12.0)
    audio[active] = 0.5 * np.sin(2 * np.pi * 440 * t[active])

    # LRC has 4 lines distributed early and mid song (completely mismatched structure)
    mismatched_lines = [
        {"id": 0, "text": "Line one early", "start_time": 0.5, "end_time": 2.0},
        {"id": 1, "text": "Line two early mid", "start_time": 2.5, "end_time": 4.0},
        {"id": 2, "text": "Line three mid", "start_time": 4.5, "end_time": 6.0},
        {"id": 3, "text": "Line four late mid", "start_time": 6.5, "end_time": 8.0},
    ]

    offset, confidence = estimate_global_offset(audio, sr, mismatched_lines, max_offset=15.0)
    assert confidence < 0.15, (
        f"Expected confidence < 0.15 for mismatched lyrics, got {confidence:.3f}"
    )
    assert offset == 0.0, f"Expected offset 0.0 for rejected candidate, got {offset}"


def test_estimate_global_offset_silent_and_empty_audio():
    """Verifies that silent, zero-length, or flat DC audio signals return 0 offset and low confidence."""
    sr = 44100
    lines = [{"id": 0, "text": "Some lyrics", "start_time": 1.0, "end_time": 3.0}]

    # 1. Pure silence
    silent_audio = np.zeros(sr * 4, dtype=np.float32)
    off, conf = estimate_global_offset(silent_audio, sr, lines)
    assert off == 0.0
    assert conf < 0.15

    # 2. Empty audio array
    empty_audio = np.zeros(0, dtype=np.float32)
    off, conf = estimate_global_offset(empty_audio, sr, lines)
    assert off == 0.0
    assert conf == 0.0

    # 3. Pure DC offset signal (variance = 0)
    dc_audio = np.full(sr * 3, 0.35, dtype=np.float32)
    off, conf = estimate_global_offset(dc_audio, sr, lines)
    assert off == 0.0
    assert conf < 0.15

    # 4. Empty lines list
    off, conf = estimate_global_offset(silent_audio, sr, [])
    assert off == 0.0
    assert conf == 0.0


def test_estimate_global_offset_nan_and_inf_handling():
    """Verifies that audio corrupted with NaNs and Infs is sanitized without raising exceptions."""
    sr = 44100
    corrupt_audio = np.zeros(sr * 4, dtype=np.float32)
    corrupt_audio[50:150] = np.nan
    corrupt_audio[200:300] = np.inf
    corrupt_audio[400:500] = -np.inf
    lines = [{"id": 0, "text": "Corrupt test", "start_time": 1.0, "end_time": 2.5}]

    off, conf = estimate_global_offset(corrupt_audio, sr, lines)
    assert isinstance(off, float)
    assert isinstance(conf, float)
    assert not np.isnan(off)
    assert not np.isnan(conf)


def test_estimate_global_offset_stereo_multichannel():
    """Verifies stereo and multi-channel audio inputs are cleanly downmixed to mono."""
    sr = 44100
    duration = 8.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)

    # Singing burst active between 4.0s and 6.0s
    active = (t >= 4.0) & (t <= 6.0)
    ch1 = np.zeros_like(t)
    ch2 = np.zeros_like(t)
    ch1[active] = 0.6 * np.sin(2 * np.pi * 440 * t[active])
    ch2[active] = 0.4 * np.cos(2 * np.pi * 880 * t[active])
    stereo_audio = np.stack([ch1, ch2], axis=-1)

    # Lyrics assume singing starts at 1.0s (offset = +3.0s)
    lines = [{"id": 0, "text": "Stereo phrase", "start_time": 1.0, "end_time": 3.0}]

    off, conf = estimate_global_offset(stereo_audio, sr, lines, max_offset=15.0)
    assert abs(off - 3.0) <= 0.150, f"Stereo offset recovery error: {off}"
    assert conf >= 0.20


def test_align_lyrics_auto_offset_correction_toggle(tmp_path):
    """Verifies AudioAligner.align_lyrics auto_offset_correction shifts timestamps when True and preserves them when False."""
    sr = 44100
    duration = 8.0
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    vocals = np.zeros_like(t)

    # Audio singing starts at 4.0s, ends at 7.0s
    active = (t >= 4.0) & (t <= 7.0)
    vocals[active] = 0.5 * np.sin(2 * np.pi * 440 * t[active])
    wav_path = str(tmp_path / "offset_toggle.wav")
    sf.write(wav_path, vocals, sr)

    raw_lines = [{"id": 0, "text": "Shifted phrase line", "start_time": 1.0, "end_time": 4.0}]
    aligner = AudioAligner()

    # Case 1: auto_offset_correction=True (default) -> line start should shift from 1.0 toward 4.0
    aligned_on = aligner.align_lyrics(wav_path, raw_lines, auto_offset_correction=True)
    assert len(aligned_on) == 1
    assert aligned_on[0]["start_time"] >= 3.5, (
        f"Expected start_time >= 3.5, got {aligned_on[0]['start_time']}"
    )

    # Case 2: auto_offset_correction=False -> line boundaries remain at raw input (1.0)
    aligned_off = aligner.align_lyrics(wav_path, raw_lines, auto_offset_correction=False)
    assert len(aligned_off) == 1
    assert aligned_off[0]["start_time"] == 1.0


def test_align_lyrics_executes_refine_line_boundaries_without_singer_key(tmp_path):
    """Verifies that AudioAligner.align_lyrics genuinely runs refine_line_boundaries without requiring 'singer'."""
    sr = 44100
    dur = 6.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    vocals = np.zeros_like(t)
    # Singing active between 1.5s and 3.0s (trailing silence: 5.0 - 3.0 = 2.0s >= 1.0s)
    active = (t >= 1.5) & (t <= 3.0)
    vocals[active] = 0.5 * np.sin(2 * np.pi * 440 * t[active])

    wav_file = tmp_path / "snapping_test.wav"
    sf.write(str(wav_file), vocals, sr)

    aligner = AudioAligner()
    # Explicitly do NOT include 'singer' in the line dict
    lines = [{"id": 0, "text": "Snapping line test", "start_time": 1.0, "end_time": 5.0}]
    aligned = aligner.align_lyrics(
        str(wav_file), lines, auto_offset_correction=False, refine_line_boundaries=True
    )

    assert len(aligned) == 1
    # Start time snapped from 1.0 toward 1.5
    assert aligned[0]["start_time"] >= 1.45
    # End time trimmed from 5.0 toward 3.1
    assert aligned[0]["end_time"] <= 3.3
    # Verify words are aligned and within the refined line boundaries
    assert len(aligned[0]["words"]) == 3
    for w in aligned[0]["words"]:
        assert w["start_time"] >= aligned[0]["start_time"]
        assert w["end_time"] <= aligned[0]["end_time"]


def test_refine_line_boundaries_2d_single_channel_audio():
    """Verifies that refine_line_boundaries and align_lyrics support 2D single-channel (N, 1) audio without IndexError."""
    sr = 44100
    dur = 4.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    audio_1d = np.zeros_like(t)
    audio_1d[(t >= 1.0) & (t <= 3.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 1.0) & (t <= 3.0)])
    audio_2d_mono = audio_1d.reshape(-1, 1)
    assert audio_2d_mono.ndim == 2 and audio_2d_mono.shape[1] == 1

    lines = [{"id": 0, "text": "Testing single channel 2D", "start_time": 0.5, "end_time": 3.5}]
    refined = AudioAligner.refine_line_boundaries(audio_2d_mono, sr, lines)
    assert len(refined) == 1
    assert refined[0]["start_time"] >= 0.95


def test_align_lyrics_none_and_nonfinite_timestamps_resilience(tmp_path):
    """Verifies that align_lyrics safely sanitizes None, NaN, and Inf timestamps without TypeError or OverflowError."""
    sr = 44100
    audio = np.zeros(sr * 3, dtype=np.float32)
    wav_path = str(tmp_path / "none_nan_audio.wav")
    sf.write(wav_path, audio, sr)

    aligner = AudioAligner()
    lines = [
        {"id": 0, "text": "None line", "start_time": None, "end_time": None},
        {"id": 1, "text": "NaN line", "start_time": float("nan"), "end_time": float("nan")},
        {"id": 2, "text": "Inf line", "start_time": float("inf"), "end_time": float("inf")},
    ]
    aligned = aligner.align_lyrics(wav_path, lines)
    assert len(aligned) == 3
    for item in aligned:
        assert math.isfinite(item["start_time"]) and item["start_time"] >= 0.0
        assert math.isfinite(item["end_time"]) and item["end_time"] > item["start_time"]


def test_refine_line_boundaries_t_zero_onset_snapping():
    """Verifies that refine_line_boundaries snaps backward to 0.0s when singing begins at t=0.0s."""
    sr = 44100
    dur = 4.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    audio = np.zeros_like(t)
    # Singing starts at t=0.0s
    audio[(t >= 0.0) & (t <= 2.5)] = 0.6 * np.sin(2 * np.pi * 440 * t[(t >= 0.0) & (t <= 2.5)])

    # Raw line starts with lag at 0.40s
    lines = [{"id": 0, "text": "Starts at zero", "start_time": 0.40, "end_time": 2.50}]
    refined = AudioAligner.refine_line_boundaries(audio, sr, lines)
    assert len(refined) == 1
    # Must snap to 0.000s
    assert abs(refined[0]["start_time"] - 0.0) <= 0.05


def test_refine_line_boundaries_sustained_note_extension():
    """Verifies that refine_line_boundaries searches forward and does not clip notes sustained past raw_e."""
    sr = 44100
    dur = 6.0
    t = np.linspace(0, dur, int(sr * dur), endpoint=False)
    audio = np.zeros_like(t)
    # Vocal note extends up to 4.5s
    audio[(t >= 1.0) & (t <= 4.5)] = 0.6 * np.sin(2 * np.pi * 440 * t[(t >= 1.0) & (t <= 4.5)])

    # Raw line ends prematurely at 3.2s
    lines = [{"id": 0, "text": "Sustained note line", "start_time": 1.0, "end_time": 3.20}]
    refined = AudioAligner.refine_line_boundaries(audio, sr, lines)
    assert len(refined) == 1
    # Line end should have extended to actual release (~4.5s + 0.10s hangover = 4.60s)
    assert abs(refined[0]["end_time"] - 4.60) <= 0.120
