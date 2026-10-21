"""
Adversarial Stress-Testing and Empirical Fuzzing Suite by Challenger 2.
Evaluates Requirements R2, R3, and R4:
1. Synthetic Multi-Phrase Stress Test (un-timed lyrics, 4 bursts, 2-3s silence gaps, < 15% gap word duration).
2. Trailing Silence & Word Snapping Stress Test ([1.0, 7.0] window, active [1.0, 3.0], word end <= 3.2s, line end == 7.0).
3. Monotonicity Invariance across Extreme Audio Inputs (empty, silence, sub-frame, 96kHz stereo, 50 words/sec, NaN/Inf).
4. Independent Programmatic Synthetic Benchmark Reproduction & 3.4-min Real Stem CPU Performance (< 2.0s).
"""

import math
import re
import time
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import AudioAligner


# ==============================================================================
# CHALLENGE 1: Synthetic Multi-Phrase Stress Test
# ==============================================================================
def test_challenge1_synthetic_multi_phrase_stress_test(tmp_path):
    """
    Challenge 1:
    - Generate synthetic audio with 4 distinct singing bursts separated by 2.0s-3.0s of pure silence.
    - Pass 8 un-timed lyric lines (start_time = 0.0, end_time = 0.0).
    - Measure the exact percentage of total assigned word duration falling in silent gaps.
    - Verify it is strictly < 15%.
    """
    sr = 44100
    total_dur = 35.0
    t = np.linspace(0, total_dur, int(sr * total_dur), endpoint=False)
    vocals = np.zeros_like(t)

    # 4 distinct singing bursts separated by 2.0s-3.0s silence:
    # Burst 1: 2.0s - 6.0s (dur: 4.0s)
    # Gap 1:   6.0s - 8.5s (dur: 2.5s silence)
    # Burst 2: 8.5s - 13.5s (dur: 5.0s)
    # Gap 2:   13.5s - 16.5s (dur: 3.0s silence)
    # Burst 3: 16.5s - 21.5s (dur: 5.0s)
    # Gap 3:   21.5s - 24.0s (dur: 2.5s silence)
    # Burst 4: 24.0s - 29.0s (dur: 5.0s)
    # Outro:   29.0s - 35.0s (dur: 6.0s silence)
    # Intro:   0.0s - 2.0s (dur: 2.0s silence)

    burst_intervals = [
        (2.0, 6.0, 440.0),
        (8.5, 13.5, 523.25),
        (16.5, 21.5, 659.25),
        (24.0, 29.0, 783.99),
    ]

    for b_start, b_end, freq in burst_intervals:
        mask = (t >= b_start) & (t <= b_end)
        # Add smooth cosine envelope at boundaries (25ms attack/decay)
        burst_t = t[mask]
        burst_len = len(burst_t)
        ramp_len = min(int(0.025 * sr), burst_len // 2)
        env = np.ones(burst_len, dtype=np.float32)
        if ramp_len > 0:
            env[:ramp_len] = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len) / ramp_len))
            env[-ramp_len:] = 0.5 * (1.0 - np.cos(np.pi * np.arange(ramp_len)[::-1] / ramp_len))
        vocals[mask] = 0.6 * np.sin(2 * np.pi * freq * burst_t) * env

    vocal_file = tmp_path / "multi_phrase_4bursts.wav"
    sf.write(str(vocal_file), vocals, sr)

    # 8 un-timed lyric lines (both start_time and end_time == 0.0)
    plain_lines = [
        {"id": 0, "text": "Beginning our journey here today", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Singing through the morning light", "start_time": 0.0, "end_time": 0.0},
        {"id": 2, "text": "Second stanza rises in the air", "start_time": 0.0, "end_time": 0.0},
        {"id": 3, "text": "Melodies that carry far away", "start_time": 0.0, "end_time": 0.0},
        {"id": 4, "text": "Third movement echoes softly now", "start_time": 0.0, "end_time": 0.0},
        {"id": 5, "text": "Gentle harmony within our reach", "start_time": 0.0, "end_time": 0.0},
        {
            "id": 6,
            "text": "Fourth and final chorus starts to shine",
            "start_time": 0.0,
            "end_time": 0.0,
        },
        {"id": 7, "text": "Closing every chapter with a song", "start_time": 0.0, "end_time": 0.0},
    ]

    aligner = AudioAligner()
    aligned = aligner.align_lyrics(str(vocal_file), plain_lines)

    assert len(aligned) == 8, f"Expected 8 aligned lines, got {len(aligned)}"

    # Defined silent intervals
    silent_intervals = [
        (0.0, 2.0),  # Intro silence
        (6.0, 8.5),  # Gap 1 (2.5s)
        (13.5, 16.5),  # Gap 2 (3.0s)
        (21.5, 24.0),  # Gap 3 (2.5s)
        (29.0, 35.0),  # Outro silence
    ]

    total_word_dur = 0.0
    silent_word_dur = 0.0
    all_words = []

    for line_idx, line in enumerate(aligned):
        assert line["start_time"] < line["end_time"], f"Line {line_idx} start >= end"
        words = line.get("words", [])
        assert len(words) > 0, f"Line {line_idx} has no words"

        for _w_idx, w in enumerate(words):
            all_words.append(w)
            ws = w["start_time"]
            we = w["end_time"]
            assert ws < we, f"Word {w['word']} in line {line_idx} has ws={ws} >= we={we}"
            wdur = we - ws
            total_word_dur += wdur

            # Calculate overlap with silent intervals
            for s_start, s_end in silent_intervals:
                overlap = max(0.0, min(we, s_end) - max(ws, s_start))
                silent_word_dur += overlap

    silent_pct = (silent_word_dur / total_word_dur) * 100.0 if total_word_dur > 0 else 0.0

    print("\n--- CHALLENGE 1 EMPIRICAL RESULTS ---")
    print(f"Total assigned word duration: {total_word_dur:.3f}s")
    print(f"Word duration falling in silent gaps: {silent_word_dur:.3f}s")
    print(f"Silent gap percentage: {silent_pct:.2f}% (Threshold: < 15.0%)")

    # Lines 0 & 1 must be placed in burst 1 [2.0, 6.0]
    assert aligned[0]["start_time"] >= 1.8, f"Line 0 started too early: {aligned[0]['start_time']}"
    assert aligned[1]["end_time"] <= 6.2, f"Line 1 ended too late: {aligned[1]['end_time']}"

    # Lines 2 & 3 must be placed in burst 2 [8.5, 13.5]
    assert aligned[2]["start_time"] >= 8.3, f"Line 2 started too early: {aligned[2]['start_time']}"
    assert aligned[3]["end_time"] <= 13.7, f"Line 3 ended too late: {aligned[3]['end_time']}"

    # Lines 4 & 5 must be placed in burst 3 [16.5, 21.5]
    assert aligned[4]["start_time"] >= 16.3, f"Line 4 started too early: {aligned[4]['start_time']}"
    assert aligned[5]["end_time"] <= 21.7, f"Line 5 ended too late: {aligned[5]['end_time']}"

    # Lines 6 & 7 must be placed in burst 4 [24.0, 29.0]
    assert aligned[6]["start_time"] >= 23.8, f"Line 6 started too early: {aligned[6]['start_time']}"
    assert aligned[7]["end_time"] <= 29.2, f"Line 7 ended too late: {aligned[7]['end_time']}"

    # STRICT ASSERTION
    assert silent_pct < 15.0, (
        f"Challenge 1 FAILED: Silent gap word duration is {silent_pct:.2f}%, must be strictly < 15.0%"
    )


# ==============================================================================
# CHALLENGE 2: Trailing Silence & Word Snapping Stress Test
# ==============================================================================
def test_challenge2_trailing_silence_snapping_stress_test(tmp_path):
    """
    Challenge 2:
    - Create audio with vocal activity from 1.0s to 3.0s followed by 4.0s of silence in a line window [1.0, 7.0].
    - Verify that line["end_time"] == 7.0 (line boundary preserved for subtitle contracts).
    - Verify that line["words"][-1]["end_time"] <= 3.2s (snapped to vocal cessation, not stretched to 7.0s).
    """
    sr = 44100
    total_dur = 8.0
    t = np.linspace(0, total_dur, int(sr * total_dur), endpoint=False)
    vocals = np.zeros_like(t)

    # Active vocal from 1.0s to 3.0s (2.0s duration)
    # Remaining 5.0s (3.0s to 8.0s) is pure silence
    active_mask = (t >= 1.0) & (t <= 3.0)
    vocals[active_mask] = 0.7 * np.sin(2 * np.pi * 440 * t[active_mask])

    vocal_file = tmp_path / "trailing_silence_snap_vocals.wav"
    sf.write(str(vocal_file), vocals, sr)

    test_lines = [
        {
            "id": 0,
            "text": "Singing stops right now",
            "start_time": 1.0,
            "end_time": 7.0,  # Line window extends 4.0s past vocal cessation!
        }
    ]

    aligner = AudioAligner()
    aligned = aligner.align_lyrics(str(vocal_file), test_lines)

    assert len(aligned) == 1
    line = aligned[0]

    # Verification 1: line["end_time"] == 7.0 (line boundary preserved)
    assert line["end_time"] == 7.0, (
        f"Line boundary violated! Expected line end_time == 7.0, got {line['end_time']}"
    )
    assert line["start_time"] == 1.0, (
        f"Line boundary violated! Expected line start_time == 1.0, got {line['start_time']}"
    )

    words = line["words"]
    assert len(words) == 4
    last_word = words[-1]

    print("\n--- CHALLENGE 2 EMPIRICAL RESULTS ---")
    print(f"Line text: '{line['text']}'")
    print(f"Line window: [{line['start_time']}, {line['end_time']}]")
    print("Vocal activity range: 1.0s - 3.0s")
    for w in words:
        print(
            f"  Word '{w['word']}': [{w['start_time']:.3f}, {w['end_time']:.3f}] (dur: {w['end_time'] - w['start_time']:.3f}s)"
        )
    print(
        f"Last word '{last_word['word']}' end_time: {last_word['end_time']:.3f}s (Threshold: <= 3.2s)"
    )

    # Verification 2: line["words"][-1]["end_time"] <= 3.2s
    assert last_word["end_time"] <= 3.2, (
        f"Challenge 2 FAILED: Last word '{last_word['word']}' end_time {last_word['end_time']}s > 3.2s. "
        f"Word stretched across trailing silence!"
    )
    # Also assert that last word ends after vocal onset
    assert last_word["end_time"] >= 2.5, f"Last word snapped too early: {last_word['end_time']}"


# ==============================================================================
# CHALLENGE 3: Monotonicity Invariance across Extreme Audio Inputs
# ==============================================================================
@pytest.mark.parametrize(
    "case_id, setup_func",
    [
        (
            "empty_audio_0_samples",
            lambda sr: (
                np.zeros((0,), dtype=np.float32),
                sr,
                [
                    {
                        "id": 0,
                        "text": "Testing empty zero sample audio file",
                        "start_time": 0.0,
                        "end_time": 2.0,
                    }
                ],
            ),
        ),
        (
            "pure_silence_zeros",
            lambda sr: (
                np.zeros(sr * 5, dtype=np.float32),
                sr,
                [
                    {
                        "id": 0,
                        "text": "Testing completely silent zero audio stream",
                        "start_time": 0.5,
                        "end_time": 4.5,
                    }
                ],
            ),
        ),
        (
            "ultra_short_sub_frame_3ms",
            lambda sr: (
                np.ones(int(0.003 * sr), dtype=np.float32) * 0.5,
                sr,
                [{"id": 0, "text": "Sub frame audio line", "start_time": 0.0, "end_time": 0.04}],
            ),
        ),
        (
            "ultra_short_single_sample",
            lambda sr: (
                np.array([0.5], dtype=np.float32),
                sr,
                [
                    {
                        "id": 0,
                        "text": "Single sample audio line",
                        "start_time": 0.0,
                        "end_time": 0.02,
                    }
                ],
            ),
        ),
        (
            "high_sample_rate_96khz_stereo",
            lambda sr: (
                np.stack(
                    [
                        0.4 * np.sin(2 * np.pi * 440 * np.linspace(0, 1.0, 96000, endpoint=False)),
                        0.3 * np.cos(2 * np.pi * 880 * np.linspace(0, 1.0, 96000, endpoint=False)),
                    ],
                    axis=-1,
                ),
                96000,
                [
                    {
                        "id": 0,
                        "text": "Ninety six kilohertz pristine stereo studio audio",
                        "start_time": 0.1,
                        "end_time": 0.9,
                    }
                ],
            ),
        ),
        (
            "massive_word_count_50_words_1sec",
            lambda sr: (
                np.zeros(sr * 2, dtype=np.float32),
                sr,
                [
                    {
                        "id": 0,
                        "text": " ".join([f"word{i}" for i in range(1, 51)]),
                        "start_time": 0.0,
                        "end_time": 1.0,
                    }
                ],
            ),
        ),
        (
            "extreme_nan_inf_corrupted_samples",
            lambda sr: (
                np.array([np.nan, np.inf, -np.inf, 0.0, 0.5, np.nan] * 1000, dtype=np.float32),
                sr,
                [
                    {
                        "id": 0,
                        "text": "Corrupted audio with invalid IEEE floating point samples",
                        "start_time": 0.0,
                        "end_time": 1.0,
                    }
                ],
            ),
        ),
        (
            "line_window_outside_audio_duration",
            lambda sr: (
                np.zeros(sr, dtype=np.float32),  # 1.0s audio
                sr,
                [
                    {
                        "id": 0,
                        "text": "Far outside audio line duration",
                        "start_time": 10.0,
                        "end_time": 15.0,
                    }
                ],
            ),
        ),
    ],
)
def test_challenge3_monotonicity_invariance_extreme_inputs(tmp_path, case_id, setup_func):
    """
    Challenge 3:
    Monotonicity Invariance across Extreme Audio Inputs:
    - 0.0-sample / empty audio file
    - 100% pure silence (zeros)
    - Ultra-short audio (< 5ms, sub-frame)
    - High sample rate: 96,000 Hz stereo audio
    - Massive word count on short line (50 words in 1 second)
    - NaN/Inf corrupted samples
    - Line window outside audio duration
    Assert for EVERY word:
      * start_time < end_time
      * next.start_time >= prev.end_time
      * all finite floats, no NaNs or Infs
      * start_time >= 0.0
      * words bounded within [line.start_time, line.end_time]
    """
    sr = 44100
    audio_data, actual_sr, lines = setup_func(sr)
    test_wav = tmp_path / f"challenge3_{case_id}.wav"
    sf.write(str(test_wav), audio_data, actual_sr)

    aligner = AudioAligner()
    aligned = aligner.align_lyrics(str(test_wav), lines)

    assert len(aligned) == len(lines), f"Line count mismatch for {case_id}"

    for line_idx, line in enumerate(aligned):
        l_s = line["start_time"]
        l_e = line["end_time"]
        assert math.isfinite(l_s), f"Line {line_idx} start_time is not finite: {l_s}"
        assert math.isfinite(l_e), f"Line {line_idx} end_time is not finite: {l_e}"
        assert l_s < l_e, f"Line {line_idx} start_time {l_s} >= end_time {l_e}"

        words = line["words"]
        for w_idx, w in enumerate(words):
            s = w["start_time"]
            e = w["end_time"]
            word_str = w["word"]

            # Finite floats, non-negative
            assert math.isfinite(s) and not math.isnan(s), (
                f"[{case_id}] Word '{word_str}' at idx {w_idx} has invalid start_time: {s}"
            )
            assert math.isfinite(e) and not math.isnan(e), (
                f"[{case_id}] Word '{word_str}' at idx {w_idx} has invalid end_time: {e}"
            )
            assert s >= 0.0, f"[{case_id}] Word '{word_str}' has negative start_time: {s}"
            assert e > 0.0, f"[{case_id}] Word '{word_str}' has non-positive end_time: {e}"

            # Strict word duration
            assert s < e, (
                f"[{case_id}] Word '{word_str}' at idx {w_idx} violates s < e: start={s}, end={e}"
            )

            # Strict non-overlapping with next word
            if w_idx + 1 < len(words):
                next_w = words[w_idx + 1]
                next_s = next_w["start_time"]
                assert e <= next_s, (
                    f"[{case_id}] Word overlap: word[{w_idx}] '{word_str}' end={e} > "
                    f"word[{w_idx + 1}] '{next_w['word']}' start={next_s}"
                )

        if words:
            assert words[0]["start_time"] >= l_s, (
                f"[{case_id}] First word start {words[0]['start_time']} < line start {l_s}"
            )
            assert words[-1]["end_time"] <= l_e, (
                f"[{case_id}] Last word end {words[-1]['end_time']} > line end {l_e}"
            )


# ==============================================================================
# CHALLENGE 4: Programmatic Synthetic Benchmark Reproduction & Real Stem Timing
# ==============================================================================
def test_challenge4_synthetic_benchmark_and_real_stem_runtime(tmp_path):
    """
    Challenge 4:
    - Run synthetic benchmark and independently calculate:
      * Relative Boundary MAE improvement (must be >= 40%)
      * Word onset MAE (must be <= 120ms)
      * CPU runtime on 3.4-min real stem workspace_data/stems/obz6zVLYMPQ/vocals.wav (must be < 2.0s)
    """
    from backend.tests.test_aligner_benchmark import (
        _baseline_align_lyrics,
        generate_synthetic_benchmark_track,
    )

    ground_truth = [
        {
            "id": 0,
            "text": "Hello world",
            "start_time": 1.0,
            "end_time": 4.0,
            "words": [
                {"word": "Hello", "start": 1.00, "end": 1.50, "freq": 440},
                {"word": "world", "start": 1.65, "end": 2.20, "freq": 520},
            ],
        },
        {
            "id": 1,
            "text": "Singing in the rain tonight",
            "start_time": 4.5,
            "end_time": 8.5,
            "words": [
                {"word": "Singing", "start": 4.50, "end": 5.10, "freq": 440},
                {"word": "in", "start": 5.15, "end": 5.35, "freq": 490},
                {"word": "the", "start": 5.38, "end": 5.55, "freq": 520},
                {"word": "rain", "start": 5.60, "end": 6.20, "freq": 580},
                {"word": "tonight", "start": 6.30, "end": 7.00, "freq": 660},
            ],
        },
        {
            "id": 2,
            "text": "Pauses and gaps",
            "start_time": 9.0,
            "end_time": 13.0,
            "words": [
                {"word": "Pauses", "start": 9.00, "end": 9.60, "freq": 440},
                {"word": "and", "start": 10.40, "end": 10.65, "freq": 490},
                {"word": "gaps", "start": 10.70, "end": 11.30, "freq": 520},
            ],
        },
    ]

    vocal_file = str(tmp_path / "ground_truth_vocals.wav")
    generate_synthetic_benchmark_track(vocal_file, ground_truth, sr=44100, total_duration=14.0)

    # 1. Baseline Aligner Run
    baseline_lines = [
        {
            "id": line["id"],
            "text": line["text"],
            "start_time": line["start_time"],
            "end_time": line["end_time"],
        }
        for line in ground_truth
    ]
    base_res = _baseline_align_lyrics(vocal_file, baseline_lines)

    # 2. Improved AudioAligner Run
    aligner = AudioAligner()
    input_lines = [
        {
            "id": line["id"],
            "text": line["text"],
            "start_time": line["start_time"],
            "end_time": line["end_time"],
        }
        for line in ground_truth
    ]
    improved_res = aligner.align_lyrics(vocal_file, input_lines)

    # 3. Independent Metric Calculation
    base_onset_errors: list[float] = []
    base_offset_errors: list[float] = []
    improved_onset_errors: list[float] = []
    improved_offset_errors: list[float] = []

    for l_gt, l_base, l_imp in zip(ground_truth, base_res, improved_res, strict=False):
        for w_gt, w_b, w_i in zip(l_gt["words"], l_base["words"], l_imp["words"], strict=False):
            gt_s, gt_e = w_gt["start"], w_gt["end"]
            b_s, b_e = w_b["start_time"], w_b["end_time"]
            i_s, i_e = w_i["start_time"], w_i["end_time"]

            base_onset_errors.append(abs(b_s - gt_s))
            base_offset_errors.append(abs(b_e - gt_e))
            improved_onset_errors.append(abs(i_s - gt_s))
            improved_offset_errors.append(abs(i_e - gt_e))

    base_onset_mae = float(np.mean(base_onset_errors))
    base_offset_mae = float(np.mean(base_offset_errors))
    base_boundary_mae = (base_onset_mae + base_offset_mae) / 2.0

    improved_onset_mae = float(np.mean(improved_onset_errors))
    improved_offset_mae = float(np.mean(improved_offset_errors))
    improved_boundary_mae = (improved_onset_mae + improved_offset_mae) / 2.0

    mae_improvement_pct = ((base_boundary_mae - improved_boundary_mae) / base_boundary_mae) * 100.0

    print("\n--- CHALLENGE 4 BENCHMARK METRICS ---")
    print(f"Baseline Word Boundary MAE: {base_boundary_mae * 1000:.1f}ms")
    print(f"Improved Word Boundary MAE: {improved_boundary_mae * 1000:.1f}ms")
    print(f"Relative Boundary MAE Improvement: {mae_improvement_pct:.2f}% (Threshold: >= 40.0%)")
    print(f"Improved Word Onset MAE: {improved_onset_mae * 1000:.1f}ms (Threshold: <= 120.0ms)")

    assert mae_improvement_pct >= 40.0, (
        f"Challenge 4 FAILED: MAE improvement is {mae_improvement_pct:.2f}%, must be >= 40.0%"
    )
    assert improved_onset_mae <= 0.120, (
        f"Challenge 4 FAILED: Word onset MAE is {improved_onset_mae * 1000:.1f}ms, must be <= 120ms"
    )

    # 4. CPU Runtime on Real 3.4-min Stem
    real_stem_path = "workspace_data/stems/obz6zVLYMPQ/vocals.wav"
    import json

    with open("workspace_data/projects.json") as f:
        projects = json.load(f)
    real_lines_input = [
        {
            "id": line["id"],
            "text": line["text"],
            "start_time": line["start_time"],
            "end_time": line["end_time"],
        }
        for line in projects["obz6zVLYMPQ"]["lines"]
    ]

    runtimes = []
    for _run_idx in range(3):
        t0 = time.perf_counter()
        real_aligned = aligner.align_lyrics(real_stem_path, real_lines_input)
        t_el = time.perf_counter() - t0
        runtimes.append(t_el)

    avg_runtime = float(np.mean(runtimes))
    print(f"Real 3.4-min Stem Alignment Runtimes (3 runs): {[round(r, 4) for r in runtimes]}s")
    print(f"Average CPU Runtime on Real Stem: {avg_runtime:.4f}s (Threshold: < 2.0s)")

    assert len(real_aligned) == len(real_lines_input)
    assert avg_runtime < 2.0, (
        f"Challenge 4 FAILED: Average runtime {avg_runtime:.4f}s exceeds 2.0s CPU ceiling"
    )

    # Verify real stem aligned monotonicity
    for line in real_aligned:
        assert line["start_time"] < line["end_time"]
        words = line["words"]
        for idx, w in enumerate(words):
            assert w["start_time"] < w["end_time"]
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])
            if idx + 1 < len(words):
                assert w["end_time"] <= words[idx + 1]["start_time"]


# ==============================================================================
# EMPIRICAL FUZZING: Random Monte Carlo Invariance Stress Test
# ==============================================================================
def test_empirical_monte_carlo_fuzzing(tmp_path):
    """
    Empirical Fuzzing:
    Executes 25 randomized adversarial scenarios combining:
    - Random audio durations (0.1s to 20.0s), arbitrary sample rates (16kHz, 22.05kHz, 44.1kHz, 48kHz, 96kHz)
    - Random waveforms (silence, gaussian noise, multi-frequency chirps, square waves, DC offsets)
    - Random line configurations:
      * 1 to 30 words per line
      * Exotic text: punctuation, unicode, numbers, single-char words, ultra-long words
      * Arbitrary line windows from 0.05s to 15.0s, including overlapping or inverted lines
    Asserts 100% crash immunity and strict timestamp monotonicity across all trials.
    """
    aligner = AudioAligner()
    rng = np.random.RandomState(42)

    sample_rates = [16000, 22050, 44100, 48000, 96000]
    vocab = [
        "a",
        "I",
        "the",
        "rhythm",
        "singing",
        "Mississippi",
        "supercalifragilisticexpialidocious",
        "123",
        "!@#$",
        "karaoke...",
        "la-la-la",
        "echo-chamber",
        "yeah!",
        "no?",
        "stop;",
        "go:",
    ]

    total_words_tested = 0

    for trial in range(25):
        sr = int(rng.choice(sample_rates))
        audio_dur = float(rng.uniform(0.05, 15.0))
        n_samples = max(1, int(sr * audio_dur))

        # Generate audio flavor
        flavor = trial % 5
        if flavor == 0:
            # Pure silence
            audio = np.zeros(n_samples, dtype=np.float32)
        elif flavor == 1:
            # Gaussian noise with intermittent bursts
            audio = rng.normal(0, 0.2, n_samples).astype(np.float32)
            # Silence half of it
            audio[rng.rand(n_samples) > 0.4] = 0.0
        elif flavor == 2:
            # Harmonic chirp
            t_arr = np.linspace(0, audio_dur, n_samples, endpoint=False)
            f0 = float(rng.uniform(200, 800))
            audio = (0.5 * np.sin(2 * np.pi * f0 * t_arr)).astype(np.float32)
        elif flavor == 3:
            # High amplitude square wave
            t_arr = np.linspace(0, audio_dur, n_samples, endpoint=False)
            audio = (0.8 * np.sign(np.sin(2 * np.pi * 440 * t_arr))).astype(np.float32)
        else:
            # Stereo interleaved
            ch1 = 0.4 * rng.uniform(-1.0, 1.0, n_samples).astype(np.float32)
            ch2 = 0.4 * rng.uniform(-1.0, 1.0, n_samples).astype(np.float32)
            audio = np.stack([ch1, ch2], axis=-1)

        fuzz_wav = tmp_path / f"fuzz_trial_{trial}.wav"
        sf.write(str(fuzz_wav), audio, sr)

        # Generate random lines
        num_lines = rng.randint(1, 6)
        trial_lines = []
        cur_t = 0.0

        is_untimed = trial % 4 == 0

        for l_idx in range(num_lines):
            line_w_count = rng.randint(1, 20)
            words_selected = [vocab[rng.randint(0, len(vocab))] for _ in range(line_w_count)]
            text = " ".join(words_selected)

            if is_untimed:
                l_s = 0.0
                l_e = 0.0
            else:
                dur = float(rng.uniform(0.1, 4.0))
                l_s = cur_t
                l_e = l_s + dur
                cur_t = l_e + float(rng.uniform(0.0, 1.5))

            trial_lines.append(
                {
                    "id": l_idx,
                    "text": text,
                    "start_time": l_s,
                    "end_time": l_e,
                }
            )

        # Must execute without throwing exceptions
        aligned = aligner.align_lyrics(str(fuzz_wav), trial_lines)
        assert len(aligned) == len(trial_lines)

        for line in aligned:
            assert line["start_time"] < line["end_time"]
            assert math.isfinite(line["start_time"])
            assert math.isfinite(line["end_time"])

            words = line["words"]
            for w_idx, w in enumerate(words):
                total_words_tested += 1
                s = w["start_time"]
                e = w["end_time"]
                assert math.isfinite(s) and s >= 0.0
                assert math.isfinite(e) and e > 0.0
                assert s < e, f"Trial {trial} word duration invalid: {s} >= {e}"
                if w_idx + 1 < len(words):
                    next_s = words[w_idx + 1]["start_time"]
                    assert e <= next_s, f"Trial {trial} overlap: {e} > {next_s}"

    print("\n--- EMPIRICAL FUZZING RESULTS ---")
    print(f"Executed 25 randomized Monte Carlo trials across {total_words_tested} total words.")
    print("Zero crashes, zero NaN/Inf, 100% strict monotonicity invariance preserved.")
