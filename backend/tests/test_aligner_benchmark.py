"""
Programmatic Synthetic Benchmark Suite for Word-Level and Line-Boundary Acoustic Alignment.
Measures Word Boundary MAE improvement (>= 40%), Word Onset MAE (<= 120ms),
CPU execution speed (< 2.0s on 3.4min tracks), and strict monotonicity across edge cases.
"""

import math
import re
import time
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import AudioAligner, calculate_word_weight, count_syllables


def _baseline_align_lyrics(vocals_path: str, lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Reference baseline implementation reflecting the pre-Milestone 3 aligner logic:
    - Character-length biased weighting: len(w) + (2 if vowel in w else 0)
    - Full-line window base duration allocation without pause detection
    - Back-to-back chaining: cur_time = w_end_r
    - Hardcoded final word stretching: if idx == len(words) - 1: w_end = max(w_start + min_word_dur, l_end)
    """
    audio_data, sample_rate = sf.read(vocals_path)
    mono_audio = np.mean(audio_data, axis=-1) if audio_data.ndim > 1 else audio_data
    mono_audio = np.nan_to_num(mono_audio, nan=0.0, posinf=0.0, neginf=0.0)

    frame_length = max(1, int(0.02 * sample_rate))
    hop_length = max(1, int(0.01 * sample_rate))
    sq_audio = mono_audio**2

    if len(sq_audio) == 0:
        norm_energy = np.zeros(0, dtype=np.float32)
    elif len(sq_audio) < frame_length:
        avg_val = float(np.mean(sq_audio)) if len(sq_audio) > 0 else 0.0
        norm_energy = np.array([avg_val], dtype=np.float32)
    else:
        num_frames = max(1, (len(sq_audio) - frame_length) // hop_length)
        cum_sq = np.concatenate(([0.0], np.cumsum(sq_audio, dtype=np.float64)))
        starts = np.arange(num_frames) * hop_length
        ends = starts + frame_length
        energy = ((cum_sq[ends] - cum_sq[starts]) / frame_length).astype(np.float32)
        if len(energy) >= 5:
            kernel = np.ones(5, dtype=np.float32) / 5.0
            energy = np.convolve(energy, kernel, mode="same")
        max_energy = float(np.nanmax(energy)) if len(energy) > 0 else 0.0
        norm_energy = (
            np.zeros_like(energy)
            if (np.isnan(max_energy) or max_energy <= 1e-9)
            else np.nan_to_num(energy / max_energy, nan=0.0, posinf=0.0, neginf=0.0)
        )

    aligned_lines = []
    for line in lines:
        l_start = float(line.get("start_time", 0.0))
        l_end = float(line.get("end_time", l_start + 4.0))
        if l_end <= l_start:
            l_end = l_start + 0.5

        text = str(line.get("text", "")).strip()
        text = re.sub(r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        words = [w for w in text.split() if w]
        if not words:
            aligned_lines.append(
                {
                    "id": line.get("id", len(aligned_lines)),
                    "text": text,
                    "start_time": round(l_start, 3),
                    "end_time": round(l_end, 3),
                    "words": [],
                }
            )
            continue

        if len(norm_energy) > 0 and sample_rate > 0 and hop_length > 0:
            f_start = int((l_start * sample_rate) / hop_length)
            f_end = int((l_end * sample_rate) / hop_length)
            f_start = max(0, min(len(norm_energy) - 1, f_start))
            f_end = max(f_start + 1, min(len(norm_energy), f_end))
            line_energy = norm_energy[f_start:f_end]
        else:
            line_energy = np.zeros(0, dtype=np.float32)
            f_start = 0

        # Baseline: Character count dominant
        word_weights = [
            max(1, len(w) + (2 if any(c in "aeiouyAEIOUY" for c in w) else 0)) for w in words
        ]
        total_weight = sum(word_weights)
        total_line_dur = max(0.1, l_end - l_start)
        min_word_dur = min(0.04, total_line_dur / len(words))

        aligned_words = []
        cur_time = l_start
        for idx, w in enumerate(words):
            w_weight = word_weights[idx]
            base_dur = (w_weight / total_weight) * total_line_dur
            w_start = cur_time

            if len(line_energy) > 0:
                w_f_start = max(
                    0,
                    min(
                        len(line_energy),
                        int((cur_time * sample_rate) / hop_length) - f_start,
                    ),
                )
                w_f_end = max(
                    w_f_start,
                    min(
                        len(line_energy),
                        int(((cur_time + base_dur) * sample_rate) / hop_length) - f_start,
                    ),
                )
                local_energy = line_energy[w_f_start:w_f_end]
                if len(local_energy) > 0 and float(np.mean(local_energy)) > 0.02:
                    active_indices = np.where(local_energy > 0.03)[0]
                    if len(active_indices) > 0:
                        onset_frame = active_indices[0]
                        onset_sec = (onset_frame * hop_length) / sample_rate
                        w_start = cur_time + min(onset_sec, base_dur * 0.25)

            w_start = max(cur_time, w_start)
            rem_words = len(words) - 1 - idx
            max_allowed_end = l_end - (rem_words * min_word_dur)
            w_end = min(max_allowed_end, w_start + base_dur)

            if w_end <= w_start:
                w_end = w_start + min_word_dur
            if idx == len(words) - 1:
                # ROOT CAUSE BUG in baseline: Stretches final word across trailing silence to l_end
                w_end = max(w_start + min_word_dur, l_end)

            w_start_r = round(w_start, 3)
            w_end_r = round(max(w_start + 0.001, w_end), 3)
            cur_time = w_end_r  # Back-to-back chaining eliminates intra-line gaps

            aligned_words.append({"word": w, "start_time": w_start_r, "end_time": w_end_r})

        aligned_lines.append(
            {
                "id": line.get("id", len(aligned_lines)),
                "text": text,
                "start_time": round(l_start, 3),
                "end_time": round(l_end, 3),
                "words": aligned_words,
            }
        )

    return aligned_lines


def generate_synthetic_benchmark_track(
    file_path: str,
    ground_truth: list[dict[str, Any]],
    sr: int = 44100,
    total_duration: float = 14.0,
) -> None:
    """Generates synthetic vocal audio with realistic sinusoidal bursts and cosine ramps matching ground truth."""
    t = np.linspace(0, total_duration, int(sr * total_duration), endpoint=False)
    audio = np.zeros_like(t)

    ramp_dur = 0.02  # 20ms attack/decay
    ramp_samples = int(ramp_dur * sr)
    window = np.hanning(ramp_samples * 2)
    attack = window[:ramp_samples]
    decay = window[ramp_samples:]

    for line in ground_truth:
        for w in line["words"]:
            w_s, w_e, freq = w["start"], w["end"], w["freq"]
            idx_s = int(w_s * sr)
            idx_e = int(w_e * sr)
            n_samples = idx_e - idx_s
            if n_samples <= 0:
                continue

            tone = 0.5 * np.sin(2 * np.pi * freq * t[idx_s:idx_e])
            if n_samples >= ramp_samples * 2:
                tone[:ramp_samples] *= attack
                tone[-ramp_samples:] *= decay

            audio[idx_s:idx_e] += tone

    audio = np.clip(audio, -0.95, 0.95)
    sf.write(file_path, audio, sr)


def test_benchmark_word_boundary_mae_and_onset_accuracy(tmp_path):
    """
    R3 Acceptance Benchmark:
    - On programmatic synthetic benchmark with known ground truth word bursts, intra-line pauses,
      and trailing silence, Word Boundary MAE improves by >= 40% compared to baseline aligner.
    - Word Onset MAE <= 120ms (0.120s).
    - Trailing silence >= 0.25s is snapped rather than stretching the final word to line end.
    - Intra-line pauses are preserved rather than back-to-back chained.
    - Outer line boundaries (start_time, end_time) are preserved for caller contracts.
    """
    ground_truth = [
        # Line 0: window [1.0, 4.0], active [1.0, 2.2], trailing silence: 1.8s
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
        # Line 1: window [4.5, 8.5], active [4.5, 7.0], trailing silence: 1.5s
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
        # Line 2: window [9.0, 13.0], active [9.0, 11.3], intra-line pause: 0.8s (9.60-10.40), trailing silence: 1.7s
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

    # 1. Run Baseline Aligner
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

    # 2. Run Improved AudioAligner
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

    # 3. Compute Metrics
    base_onset_errors: list[float] = []
    base_offset_errors: list[float] = []
    improved_onset_errors: list[float] = []
    improved_offset_errors: list[float] = []

    for l_gt, l_base, l_imp in zip(ground_truth, base_res, improved_res, strict=False):
        # Verify outer line boundary preservation
        assert l_imp["start_time"] == l_gt["start_time"]
        assert l_imp["end_time"] == l_gt["end_time"]

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

    print(f"\n{'=' * 70}")
    print("BENCHMARK RESULTS:")
    print(
        f"Baseline: Onset MAE = {base_onset_mae * 1000:.1f}ms, Offset MAE = {base_offset_mae * 1000:.1f}ms, Boundary MAE = {base_boundary_mae * 1000:.1f}ms"
    )
    print(
        f"Improved: Onset MAE = {improved_onset_mae * 1000:.1f}ms, Offset MAE = {improved_offset_mae * 1000:.1f}ms, Boundary MAE = {improved_boundary_mae * 1000:.1f}ms"
    )
    print(f"Relative Boundary MAE Improvement: {mae_improvement_pct:.1f}% (target >= 40.0%)")
    print(f"{'=' * 70}\n")

    # Assertions per Acceptance Criteria
    assert mae_improvement_pct >= 40.0, (
        f"Expected >= 40.0% MAE improvement, got {mae_improvement_pct:.2f}%"
    )
    assert improved_onset_mae <= 0.120, (
        f"Expected Onset MAE <= 120ms (0.120s), got {improved_onset_mae * 1000:.1f}ms"
    )

    # 4. Assert Trailing Silence Snapping (No stretching across trailing silence)
    # Line 0 ends at 4.0, vocal activity ceased at 2.2. Improved word 1 ends <= 2.45
    assert improved_res[0]["words"][-1]["end_time"] < 3.0
    assert improved_res[0]["words"][-1]["end_time"] <= improved_res[0]["end_time"]

    # Line 1 ends at 8.5, vocal activity ceased at 7.0. Improved word 4 ends <= 7.35
    assert improved_res[1]["words"][-1]["end_time"] < 7.5
    assert improved_res[1]["words"][-1]["end_time"] <= improved_res[1]["end_time"]

    # Line 2 ends at 13.0, vocal activity ceased at 11.3. Improved word 2 ends <= 11.65
    assert improved_res[2]["words"][-1]["end_time"] < 12.0
    assert improved_res[2]["words"][-1]["end_time"] <= improved_res[2]["end_time"]

    # 5. Assert Intra-Line Pause Preservation
    # Line 2: "Pauses" ends ~9.65s, "and" starts ~10.40s. Gap must be >= 0.4s
    line2_words = improved_res[2]["words"]
    pause_gap = line2_words[1]["start_time"] - line2_words[0]["end_time"]
    assert pause_gap >= 0.40, f"Expected intra-line pause >= 0.40s, got {pause_gap:.3f}s"


def test_benchmark_cpu_execution_speed_on_full_track(tmp_path):
    """
    R4 Acceptance Benchmark:
    Aligning a standard 3-5 minute track completes in < 2.0 seconds on CPU without network calls
    or external model downloads.
    """
    sr = 44100
    duration_sec = 204.0  # 3.4 minutes
    t = np.linspace(0, duration_sec, int(sr * duration_sec), endpoint=False)

    # Simulate realistic stereo vocal track with intermittent phrases
    ch1 = np.zeros_like(t)
    ch2 = np.zeros_like(t)

    # 40 lyric lines distributed across 204 seconds (approx 1 line every 5 seconds)
    synthetic_lines = []
    sample_phrases = [
        "In the quiet of the morning light",
        "We can see the future shining bright",
        "Take a step and leave the past behind",
        "Searching for the peace we hope to find",
        "Hear the music playing in the hall",
        "Echoing against the ancient wall",
        "Voices rising up into the sky",
        "As the moments slowly drift on by",
    ]

    for i in range(40):
        l_s = float(i * 5.0 + 1.0)
        l_e = float(l_s + 3.8)
        # 3.0s active vocal singing within the 3.8s window
        active_mask = (t >= l_s) & (t <= l_s + 3.0)
        ch1[active_mask] = 0.4 * np.sin(2 * np.pi * 440 * t[active_mask])
        ch2[active_mask] = 0.4 * np.sin(2 * np.pi * 550 * t[active_mask])

        synthetic_lines.append(
            {
                "id": i,
                "text": sample_phrases[i % len(sample_phrases)],
                "start_time": l_s,
                "end_time": l_e,
            }
        )

    stereo_audio = np.stack([ch1, ch2], axis=-1)
    track_path = str(tmp_path / "long_vocal_track_3_4min.wav")
    sf.write(track_path, stereo_audio, sr)

    aligner = AudioAligner()

    t_start = time.perf_counter()
    aligned = aligner.align_lyrics(track_path, synthetic_lines)
    elapsed = time.perf_counter() - t_start

    print(
        f"\nCPU Alignment Runtime for 3.4min track (40 lines): {elapsed:.4f} seconds (target < 2.0s)"
    )

    assert len(aligned) == 40
    # Must complete well below 2.0 seconds ceiling (typically ~0.20s - 0.35s)
    assert elapsed < 2.0, f"Alignment took {elapsed:.3f}s, exceeding 2.0s CPU performance ceiling"

    # Verify each line has valid words
    for line in aligned:
        words = line["words"]
        assert len(words) > 0
        for w in words:
            assert w["start_time"] < w["end_time"]
            assert math.isfinite(w["start_time"])
            assert math.isfinite(w["end_time"])


@pytest.mark.parametrize(
    "case_name",
    [
        "empty_audio",
        "pure_silence",
        "sub_frame_audio",
        "stereo_downmix",
        "high_sr_96khz",
        "high_word_density",
        "single_word",
        "whitespace_line",
    ],
)
def test_benchmark_strict_monotonicity_edge_cases(tmp_path, case_name):
    """
    R3 Strict Monotonicity Benchmark:
    Verifies strictly non-decreasing non-overlapping timestamps (start_time < end_time,
    finite floats) across all identified edge cases.
    """
    aligner = AudioAligner()
    audio_file = tmp_path / f"{case_name}.wav"
    sr = 44100

    if case_name == "empty_audio":
        sf.write(str(audio_file), np.zeros((0,), dtype=np.float32), sr)
        lines = [{"id": 0, "text": "Empty audio test", "start_time": 0.0, "end_time": 2.0}]

    elif case_name == "pure_silence":
        sf.write(str(audio_file), np.zeros(sr * 3, dtype=np.float32), sr)
        lines = [
            {
                "id": 0,
                "text": "Pure silence peaceful line",
                "start_time": 0.5,
                "end_time": 2.5,
            }
        ]

    elif case_name == "sub_frame_audio":
        # 5ms of audio = 220 samples < 20ms frame
        sf.write(str(audio_file), np.ones(220, dtype=np.float32) * 0.1, sr)
        lines = [{"id": 0, "text": "Micro burst line", "start_time": 0.0, "end_time": 0.05}]

    elif case_name == "stereo_downmix":
        t = np.linspace(0, 2.0, sr * 2, endpoint=False)
        ch1 = 0.5 * np.sin(2 * np.pi * 440 * t)
        ch2 = 0.3 * np.cos(2 * np.pi * 880 * t)
        sf.write(str(audio_file), np.stack([ch1, ch2], axis=-1), sr)
        lines = [
            {
                "id": 0,
                "text": "Stereo channels mixed cleanly",
                "start_time": 0.2,
                "end_time": 1.8,
            }
        ]

    elif case_name == "high_sr_96khz":
        sr = 96000
        t = np.linspace(0, 1.0, sr, endpoint=False)
        sf.write(str(audio_file), 0.5 * np.sin(2 * np.pi * 1000 * t), sr)
        lines = [
            {
                "id": 0,
                "text": "Ninety six kilohertz master audio",
                "start_time": 0.1,
                "end_time": 0.9,
            }
        ]

    elif case_name == "high_word_density":
        # 20 words crammed into 0.8s
        t = np.linspace(0, 2.0, sr * 2, endpoint=False)
        sf.write(str(audio_file), 0.5 * np.sin(2 * np.pi * 500 * t), sr)
        crammed_text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
        lines = [{"id": 0, "text": crammed_text, "start_time": 0.5, "end_time": 1.3}]

    elif case_name == "single_word":
        sf.write(str(audio_file), np.zeros(sr * 2, dtype=np.float32), sr)
        lines = [
            {"id": 0, "text": "Unison", "start_time": 0.5, "end_time": 1.5},
            {"id": 1, "text": "Solo", "start_time": 1.5, "end_time": 2.5},
        ]

    elif case_name == "whitespace_line":
        sf.write(str(audio_file), np.zeros(sr, dtype=np.float32), sr)
        lines = [
            {"id": 0, "text": "    \t \n  ", "start_time": 0.0, "end_time": 1.0},
            {"id": 1, "text": "Valid line", "start_time": 1.0, "end_time": 2.0},
        ]

    aligned = aligner.align_lyrics(str(audio_file), lines)
    assert len(aligned) == len(lines)

    for line in aligned:
        assert math.isfinite(line["start_time"])
        assert math.isfinite(line["end_time"])
        assert line["start_time"] < line["end_time"]

        words = line["words"]
        for i, w in enumerate(words):
            s = w["start_time"]
            e = w["end_time"]
            assert math.isfinite(s) and s >= 0.0
            assert math.isfinite(e) and e >= 0.0
            assert s < e, f"Word {w['word']} has invalid span: start={s}, end={e}"

            # Strictly non-overlapping with next word
            if i + 1 < len(words):
                next_s = words[i + 1]["start_time"]
                assert e <= next_s, (
                    f"Word overlap detected: {w['word']}(end={e}) vs {words[i + 1]['word']}(start={next_s})"
                )

        if words:
            assert words[0]["start_time"] >= line["start_time"]
            assert words[-1]["end_time"] <= line["end_time"]


def test_benchmark_syllable_vs_character_weight_scaling():
    """
    R3 Syllable Weighting Benchmark:
    Verifies rule-based syllable counting (`count_syllables(w) * 3.0 + len(clean) * 0.2`)
    correctly weights syllable density over character length.
    """
    # 1. Monosyllabic words of varying character lengths
    assert count_syllables("a") == 1
    assert count_syllables("the") == 1
    assert count_syllables("strengths") == 1

    w_a = calculate_word_weight("a")
    w_strengths = calculate_word_weight("strengths")
    # In baseline, strengths was 11 vs a was 3 (ratio 3.7x).
    # In proposed, strengths is ~4.8 vs a is 3.2 (ratio ~1.5x, reflecting they are both 1 syllable).
    assert w_strengths / w_a < 2.0

    # 2. Polysyllabic words vs monosyllabic
    assert count_syllables("Mississippi") == 4
    w_mississippi = calculate_word_weight("Mississippi")
    # Mississippi (4 syl) must receive > 3x weight of 'the' (1 syl)
    assert w_mississippi / calculate_word_weight("the") > 3.0

    # 3. Supercalifragilistic (8 syllables)
    assert count_syllables("supercalifragilistic") >= 7
    w_super = calculate_word_weight("supercalifragilistic")
    assert w_super > 20.0
