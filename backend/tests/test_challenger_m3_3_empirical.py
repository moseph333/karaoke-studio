"""
Empirical Challenge & Verification Test Suite for Milestone 3 (Line Boundary Snapping & Robustness).
Written by Challenger M3_3.

Adversarially tests:
1. Onset snapping at t=0.0s (exact, lagging start 0.05s-1.1s, negative raw start, sub-frame onset)
2. Forward sustained note preservation past raw_e (0.2s-1.9s extensions, tight inter-line gaps, extreme sustain)
3. 2D (N, 1) single-channel audio across refine_line_boundaries and align_lyrics (including (0, 1), (50, 1), NaN/Inf)
4. Empirical MAE sweep across 30 randomized multi-line audio tracks verifying MAE <= 120ms target
"""

import math
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import AudioAligner, refine_line_boundaries
from backend.tests.test_e2e_lyrics_aligner_sync import create_synthetic_vocal_signal


class TestOnsetSnappingAtZeroEmpirical:
    """Rigorous empirical verification of onset snapping when singing starts at or near t=0.0s."""

    def test_vocal_onset_exact_zero_raw_at_zero(self):
        """Singing starts at t=0.000s, raw LRC starts at 0.000s."""
        sr = 44100
        events = [{"start": 0.00, "end": 2.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=4.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 0.00, "end_time": 2.50, "text": "Exact zero start"}]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 1
        snapped_s = refined[0]["start_time"]
        assert snapped_s == 0.0
        assert refined[0]["start_time"] < refined[0]["end_time"]

    @pytest.mark.parametrize("lag_sec", [0.05, 0.10, 0.20, 0.40, 0.60, 0.80, 1.00])
    def test_vocal_onset_at_zero_lagging_raw_starts(self, lag_sec: float):
        """
        Singing starts at t=0.000s, but raw LRC start lags behind at 0.05s..1.00s.
        The algorithm must trace backwards through contiguous active frames and snap to 0.000s.
        """
        sr = 44100
        events = [{"start": 0.00, "end": 3.00, "freq": 380.0}]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        lines = [{"start_time": lag_sec, "end_time": 3.00, "text": f"Lagging by {lag_sec}s"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        err = abs(snapped_s - 0.00)
        assert err <= 0.050, (
            f"Lag {lag_sec}s failed to snap backward to 0.0s; snapped to {snapped_s}s (error={err * 1000:.1f}ms)"
        )

    def test_vocal_onset_at_zero_negative_raw_start(self):
        """
        Singing starts at t=0.000s, raw LRC has negative start_time (e.g. -0.40s).
        Must be clamped to >= 0.0 and correctly snapped to 0.000s without crashing.
        """
        sr = 44100
        events = [{"start": 0.00, "end": 2.00, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=4.0, vocal_events=events, sr=sr)
        lines = [{"start_time": -0.40, "end_time": 2.00, "text": "Negative start"}]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 1
        assert refined[0]["start_time"] == 0.0
        assert refined[0]["end_time"] > 0.05

    def test_vocal_onset_near_zero_forward_search(self):
        """
        Singing starts shortly after t=0 (e.g. at 0.04s), raw LRC starts at 0.00s.
        Frame 0 is silent, so algorithm searches forward and snaps to ~0.04s.
        """
        sr = 44100
        gt_onset = 0.04
        events = [{"start": gt_onset, "end": 2.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=4.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 0.00, "end_time": 2.50, "text": "Near zero onset"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_s = refined[0]["start_time"]
        err = abs(snapped_s - gt_onset)
        assert err <= 0.060, f"Forward snapping near zero failed: error={err * 1000:.1f}ms"

    def test_multi_line_with_first_line_at_zero(self):
        """
        Multi-line track where Line 0 starts at t=0.0s (lagged raw at 0.35s),
        followed by Line 1 at 3.0s and Line 2 at 6.0s.
        """
        sr = 44100
        events = [
            {"start": 0.00, "end": 2.00, "freq": 350.0},
            {"start": 3.00, "end": 5.00, "freq": 400.0},
            {"start": 6.00, "end": 8.00, "freq": 450.0},
        ]
        audio = create_synthetic_vocal_signal(duration=10.0, vocal_events=events, sr=sr)
        lines = [
            {"start_time": 0.35, "end_time": 2.00, "text": "Line 0 at zero"},
            {"start_time": 3.20, "end_time": 5.00, "text": "Line 1"},
            {"start_time": 5.70, "end_time": 8.00, "text": "Line 2"},
        ]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 3
        assert abs(refined[0]["start_time"] - 0.00) <= 0.050
        assert abs(refined[1]["start_time"] - 3.00) <= 0.080
        assert abs(refined[2]["start_time"] - 6.00) <= 0.080
        # Check non-overlapping order
        assert refined[0]["end_time"] <= refined[1]["start_time"]
        assert refined[1]["end_time"] <= refined[2]["start_time"]


class TestForwardSustainedNotePreservationEmpirical:
    """Rigorous empirical verification of forward sustained note preservation past raw_e."""

    @pytest.mark.parametrize("extension_sec", [0.20, 0.40, 0.70, 1.00, 1.40, 1.80])
    def test_sustained_note_extension_sweep(self, extension_sec: float):
        """
        Vocal note continues past raw_e by extension_sec.
        raw_e = 3.00s, actual singing ends at 3.00 + extension_sec.
        Algorithm must trace forward through active frames and preserve the sustained note (+0.10s hangover).
        """
        sr = 44100
        raw_e = 3.00
        gt_release = raw_e + extension_sec
        events = [{"start": 1.00, "end": gt_release, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=gt_release + 2.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": raw_e, "text": f"Sustained +{extension_sec}s"}]

        refined = refine_line_boundaries(audio, sr, lines)
        snapped_e = refined[0]["end_time"]
        expected_e = gt_release + 0.10
        err = abs(snapped_e - expected_e)
        assert err <= 0.120, (
            f"Extension {extension_sec}s failed: snapped_e={snapped_e:.3f}s, expected={expected_e:.3f}s (err={err * 1000:.1f}ms)"
        )

    def test_sustained_note_bounded_by_next_line(self):
        """
        Line 0 has raw_e = 3.00s, but singer sustains note to 3.40s.
        Line 1 starts at raw_s = 3.60s (vocal starts at 3.65s).
        Line 0 must extend without colliding with Line 1.
        """
        sr = 44100
        events = [
            {"start": 1.00, "end": 3.40, "freq": 350.0},
            {"start": 3.65, "end": 5.50, "freq": 420.0},
        ]
        audio = create_synthetic_vocal_signal(duration=7.0, vocal_events=events, sr=sr)
        lines = [
            {"start_time": 1.00, "end_time": 3.00, "text": "Line 0 sustained"},
            {"start_time": 3.60, "end_time": 5.50, "text": "Line 1 next"},
        ]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 2
        # Line 0 should extend to ~3.50s (3.40 + 0.10)
        assert abs(refined[0]["end_time"] - 3.50) <= 0.120
        # Line 0 must not exceed Line 1 start
        assert refined[0]["end_time"] <= refined[1]["start_time"]
        assert refined[0]["start_time"] < refined[0]["end_time"]
        assert refined[1]["start_time"] < refined[1]["end_time"]

    def test_extreme_sustained_note_past_2s_window(self):
        """
        Singer holds a very long note extending 2.5s past raw_e (beyond max forward window +2.0s).
        Algorithm caps extension safely at raw_e + 2.0s without crashing or non-finite values.
        """
        sr = 44100
        events = [{"start": 1.00, "end": 6.00, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=8.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": 3.00, "text": "Very long note"}]

        refined = refine_line_boundaries(audio, sr, lines)
        assert len(refined) == 1
        snapped_e = refined[0]["end_time"]
        # Must be extended to at least 4.9s (near raw_e + 2.0s)
        assert snapped_e >= 4.90
        assert math.isfinite(snapped_e)

    def test_unextended_when_silent_at_raw_end(self):
        """
        If singing stopped 0.5s before raw_e (and silence gap is only 0.5s < 1.0s min_silence_gap),
        algorithm does not extend forward because audio is silent at raw_e.
        """
        sr = 44100
        events = [{"start": 1.00, "end": 2.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=5.0, vocal_events=events, sr=sr)
        lines = [{"start_time": 1.00, "end_time": 3.00, "text": "Silent at raw end"}]

        refined = refine_line_boundaries(audio, sr, lines, min_silence_gap=1.0)
        # Gap is 0.5s (< 1.0s min gap), so raw_e remains at 3.00s
        assert refined[0]["end_time"] == pytest.approx(3.00, abs=0.05)


class Test2DSingleChannelAudioEmpirical:
    """Rigorous verification of 2D (N, 1) single-channel audio support."""

    def test_refine_line_boundaries_with_n_by_1_audio(self):
        """Passes (N, 1) float32 audio to refine_line_boundaries."""
        sr = 44100
        dur = 5.0
        events = [{"start": 1.00, "end": 3.50, "freq": 440.0}]
        audio_1d = create_synthetic_vocal_signal(duration=dur, vocal_events=events, sr=sr)
        audio_2d_mono = audio_1d[:, np.newaxis]
        assert audio_2d_mono.ndim == 2
        assert audio_2d_mono.shape[1] == 1
        assert audio_2d_mono.shape[0] == len(audio_1d)

        lines = [
            {"start_time": 0.60, "end_time": 5.00, "text": "2D mono line 1"},
        ]
        refined = refine_line_boundaries(audio_2d_mono, sr, lines)
        assert len(refined) == 1
        # Snapped start must be near 1.00s
        assert abs(refined[0]["start_time"] - 1.00) <= 0.100
        # Snapped end must be near 3.60s (3.50 + 0.10)
        assert abs(refined[0]["end_time"] - 3.60) <= 0.120

    def test_align_lyrics_with_n_by_1_wav_file(self, tmp_path):
        """Writes an (N, 1) 2D wav file and calls AudioAligner.align_lyrics."""
        sr = 44100
        dur = 4.0
        events = [{"start": 1.00, "end": 2.80, "freq": 400.0}]
        audio_1d = create_synthetic_vocal_signal(duration=dur, vocal_events=events, sr=sr)
        audio_2d = audio_1d.reshape(-1, 1)

        wav_path = str(tmp_path / "mono_2d.wav")
        sf.write(wav_path, audio_2d, sr)

        # Verify sf.read returns (N,) or (N, 1)
        _data, file_sr = sf.read(wav_path)
        assert file_sr == sr

        aligner = AudioAligner()
        lines = [{"start_time": 0.60, "end_time": 3.80, "text": "Hello 2D audio"}]
        aligned = aligner.align_lyrics(wav_path, lines)
        assert len(aligned) == 1
        assert abs(aligned[0]["start_time"] - 1.00) <= 0.120
        assert len(aligned[0]["words"]) == 3
        for w in aligned[0]["words"]:
            assert w["start_time"] >= aligned[0]["start_time"]
            assert w["end_time"] <= aligned[0]["end_time"]

    def test_2d_mono_sub_frame_and_empty(self):
        """Tests (0, 1) empty array and (50, 1) sub-frame array."""
        sr = 44100
        lines = [{"start_time": 1.00, "end_time": 3.00, "text": "Tiny audio"}]

        # (0, 1)
        empty_2d = np.zeros((0, 1), dtype=np.float32)
        res_empty = refine_line_boundaries(empty_2d, sr, lines)
        assert len(res_empty) == 1
        assert res_empty[0]["start_time"] == 1.00
        assert res_empty[0]["end_time"] == 3.00

        # (50, 1) -> less than frame_len (int(0.02 * 44100) = 882)
        short_2d = np.zeros((50, 1), dtype=np.float32)
        res_short = refine_line_boundaries(short_2d, sr, lines)
        assert len(res_short) == 1
        assert res_short[0]["start_time"] == 1.00
        assert res_short[0]["end_time"] == 3.00

    def test_2d_mono_nan_and_inf(self):
        """Tests (N, 1) audio containing NaNs and Infs."""
        sr = 44100
        events = [{"start": 1.00, "end": 2.50, "freq": 440.0}]
        audio = create_synthetic_vocal_signal(duration=4.0, vocal_events=events, sr=sr)
        audio_2d = audio.reshape(-1, 1)
        audio_2d[50:100, 0] = np.nan
        audio_2d[200:250, 0] = np.inf
        audio_2d[300:350, 0] = -np.inf

        lines = [{"start_time": 0.50, "end_time": 3.50, "text": "Corrupted 2D"}]
        refined = refine_line_boundaries(audio_2d, sr, lines)
        assert len(refined) == 1
        assert math.isfinite(refined[0]["start_time"])
        assert math.isfinite(refined[0]["end_time"])
        assert abs(refined[0]["start_time"] - 1.00) <= 0.120


class TestEmpiricalMAESweepAndMonteCarlo:
    """
    Monte Carlo stress test generating 30 diverse synthetic vocal tracks with multiple phrases,
    noisy offsets, lead/lag starts, premature/bleeding ends, and t=0.0s onsets.
    Demonstrates that boundary snapping achieves MAE <= 120ms across all scenarios.
    """

    def test_monte_carlo_line_snapping_mae(self):
        sr = 44100
        rng = np.random.RandomState(1337)
        num_tracks = 30
        all_start_errors: list[float] = []
        all_end_errors: list[float] = []

        for track_idx in range(num_tracks):
            # Decide if track starts singing at t=0.0s (in ~30% of tracks)
            starts_at_zero = (track_idx % 3) == 0

            # 3 to 5 phrases per track
            num_phrases = rng.randint(3, 6)
            events = []
            raw_lines = []
            cur_time = 0.0 if starts_at_zero else rng.uniform(0.5, 2.0)

            for p_idx in range(num_phrases):
                phrase_dur = rng.uniform(1.2, 3.0)
                gt_start = cur_time
                gt_end = gt_start + phrase_dur
                freq = rng.uniform(220.0, 500.0)
                events.append({"start": gt_start, "end": gt_end, "freq": freq})

                # Perturb raw start: lead (-0.6s to 0.0s) or lag (0.0s to +0.8s)
                # If gt_start == 0.0, lead is limited or raw starts lagging
                if gt_start == 0.0:
                    raw_start = rng.uniform(0.1, 0.7)  # lagging start
                else:
                    shift = rng.uniform(-0.5, 0.5)
                    raw_start = max(0.0, gt_start + shift)

                # Next phrase gap (1.2s to 2.5s silence gap)
                gap = rng.uniform(1.2, 2.5)
                next_cur_time = gt_end + gap

                # Perturb raw end:
                # 50% bleed into silence (+1.0s to +2.0s, bounded by inter-phrase gap), 50% premature end (-0.4s to -0.1s)
                if rng.rand() > 0.5:
                    max_bleed = min(2.0, gap - 0.10)
                    raw_end = gt_end + rng.uniform(1.0, max(1.05, max_bleed))
                    expected_end = gt_end + 0.10
                    eval_end = True
                else:
                    raw_end = gt_end - rng.uniform(0.2, 0.6)  # premature (sustained note)
                    expected_end = gt_end + 0.10
                    eval_end = True

                raw_lines.append(
                    {
                        "start_time": round(raw_start, 3),
                        "end_time": round(raw_end, 3),
                        "text": f"Track {track_idx} Line {p_idx}",
                        "_gt_start": gt_start,
                        "_expected_end": expected_end,
                        "_eval_end": eval_end,
                    }
                )

                cur_time = next_cur_time

            track_dur = cur_time + 1.0
            audio = create_synthetic_vocal_signal(
                duration=track_dur,
                vocal_events=events,
                sr=sr,
                noise_level=0.002,
            )

            refined = refine_line_boundaries(audio, sr, raw_lines, min_silence_gap=1.0)
            assert len(refined) == num_phrases

            # Verify non-overlapping monotonicity
            for i in range(len(refined)):
                assert refined[i]["start_time"] < refined[i]["end_time"], (
                    f"Track {track_idx} Line {i}: start {refined[i]['start_time']} >= end {refined[i]['end_time']}"
                )
                if i + 1 < len(refined):
                    assert refined[i]["end_time"] <= refined[i + 1]["start_time"], (
                        f"Track {track_idx}: Overlap between line {i} and {i + 1}"
                    )

                # Calculate errors
                gt_s = raw_lines[i]["_gt_start"]
                s_err = abs(refined[i]["start_time"] - gt_s)
                all_start_errors.append(s_err)

                if raw_lines[i]["_eval_end"]:
                    exp_e = raw_lines[i]["_expected_end"]
                    e_err = abs(refined[i]["end_time"] - exp_e)
                    all_end_errors.append(e_err)
                    if e_err > 0.120:
                        print(
                            f"FAIL Line: raw_s={raw_lines[i]['start_time']:.2f}, raw_e={raw_lines[i]['end_time']:.2f}, "
                            f"gt_s={gt_s:.2f}, gt_e={raw_lines[i]['_gt_start'] + (raw_lines[i]['_expected_end'] - raw_lines[i]['_gt_start'] - 0.10):.2f}, "
                            f"snapped_e={refined[i]['end_time']:.3f}, exp_e={exp_e:.3f}, err={e_err * 1000:.1f}ms"
                        )

        total_start_mae = float(np.mean(all_start_errors))
        total_end_mae = float(np.mean(all_end_errors))
        combined_mae = float(np.mean(all_start_errors + all_end_errors))

        print(
            f"\n================ EMPIRICAL MAE BENCHMARK (N={len(all_start_errors)} lines) ================"
        )
        print(f"Start Snapping MAE: {total_start_mae * 1000:.2f} ms")
        print(f"End Trimming/Extension MAE: {total_end_mae * 1000:.2f} ms")
        print(f"Combined Boundary MAE: {combined_mae * 1000:.2f} ms")
        print("==========================================================================")

        assert total_start_mae <= 0.120, (
            f"Start MAE {total_start_mae * 1000:.1f}ms exceeds 120ms limit"
        )
        assert total_end_mae <= 0.120, f"End MAE {total_end_mae * 1000:.1f}ms exceeds 120ms limit"
        assert combined_mae <= 0.120, (
            f"Combined MAE {combined_mae * 1000:.1f}ms exceeds 120ms limit"
        )
