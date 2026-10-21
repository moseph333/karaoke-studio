import re

import numpy as np
import soundfile as sf

from backend.services.aligner import (
    AudioAligner,
    calculate_word_weight,
    count_syllables,
    enforce_monotonic_words,
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
    aligned = aligner.align_lyrics(str(vocal_file), lines)

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
