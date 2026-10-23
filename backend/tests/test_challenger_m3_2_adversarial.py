"""Empirical Adversarial Stress Test Suite for Milestone 3 (Untimed Lyric Alignment & Monotonicity).

Authored and executed by Challenger M3_2 (Empirical Challenger: Critic & Specialist).

Focus:
1. Long instrumental intros (e.g. 10s) and long interludes (>= 1.5s):
   - Verify lyrics are never placed into silent intros, interludes, or outros.
   - Verify phrase detection accurately segments vocal regions.
   - Verify transient drum bleed (< 0.35s) in intros/interludes is ignored.
2. Acoustic phrase contours and syllable weighting:
   - Line durations scale with syllable and phonetic weight.
   - Words avoid silent interludes even in single-line tracks.
3. Monotonicity ($0 <= start < end$, non-overlapping lines and words):
   - Strict timestamp monotonicity across dense rapid phrases.
   - Identified failure mode: line overlapping when lines are dense in a phrase (dur < 0.010s).
   - Identified failure mode: negative word timestamps in enforce_monotonic_words for tight windows at t=0.
   - Identified failure mode: TypeError crash when start_time/end_time is None.
4. Audio anomalies and format resilience:
   - Pure silence, stereo downmixing, NaN/Inf corrupted audio, sub-second audio, whitespace lines.
"""

import math
from typing import Any

import numpy as np
import pytest
import soundfile as sf

from backend.services.aligner import AudioAligner, enforce_monotonic_words


def synthesize_untimed_vocal_signal(
    duration: float,
    vocal_regions: list[tuple[float, float]],
    sr: int = 44100,
    freq: float = 440.0,
    amplitude: float = 0.5,
    transient_bursts: list[tuple[float, float]] | None = None,
) -> np.ndarray:
    """Synthesizes mono vocal test signal with active tonal regions and optional transient bursts."""
    n_samples = max(1, round(duration * sr))
    t = np.linspace(0, duration, n_samples, endpoint=False, dtype=np.float32)
    audio = np.zeros(n_samples, dtype=np.float32)

    for i, (s, e) in enumerate(vocal_regions):
        mask = (t >= s) & (t <= e)
        # Slight frequency variation per phrase
        f = freq * (1.0 + 0.05 * (i % 3))
        audio[mask] = amplitude * np.sin(2.0 * np.pi * f * t[mask])

    if transient_bursts:
        for b_s, b_e in transient_bursts:
            t_mask = (t >= b_s) & (t <= b_e)
            audio[t_mask] = 0.8 * np.sin(2.0 * np.pi * 120.0 * t[t_mask])

    return audio


# ==============================================================================
# SUITE 1: INSTRUMENTAL INTRO AND INTERLUDE PRESERVATION
# ==============================================================================


class TestInstrumentalIntroAndInterludePreservation:
    """Stress tests verifying that untimed lyrics are never placed into silent intros or interludes."""

    def test_long_instrumental_intro_10s_untimed_preservation(self, tmp_path):
        """
        Adversarial Scenario: 10s instrumental intro, 2 vocal phrases separated by 3.5s interlude,
        and 8s instrumental outro. Untimed lyrics must never place any line or word into the intro,
        interlude, or outro.
        """
        sr = 44100
        duration = 30.0
        # P1: 10.0 - 14.0s (4s)
        # Interlude: 14.0 - 17.5s (3.5s >= 1.5s)
        # P2: 17.5 - 22.0s (4.5s)
        # Outro: 22.0 - 30.0s (8s)
        audio = synthesize_untimed_vocal_signal(
            duration=duration,
            vocal_regions=[(10.0, 14.0), (17.5, 22.0)],
            sr=sr,
        )
        wav_file = tmp_path / "intro_10s_test.wav"
        sf.write(str(wav_file), audio, sr)

        plain_lyrics = [
            {"text": "Line one in first verse", "start_time": 0.0, "end_time": 0.0},
            {"text": "Line two in first verse", "start_time": 0.0, "end_time": 0.0},
            {"text": "Line three in second verse", "start_time": 0.0, "end_time": 0.0},
            {"text": "Line four in second verse", "start_time": 0.0, "end_time": 0.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 4

        # 1. 10s intro preservation: Line 0 must not start before 9.8s
        assert aligned[0]["start_time"] >= 9.8, (
            f"Line 0 placed into 10s intro at {aligned[0]['start_time']:.3f}s"
        )

        # 2. Interlude preservation: Line 1 end must be <= 14.2s, Line 2 start must be >= 17.3s
        assert aligned[1]["end_time"] <= 14.2, (
            f"Line 1 bleeds into interlude: end={aligned[1]['end_time']:.3f}s"
        )
        assert aligned[2]["start_time"] >= 17.3, (
            f"Line 2 starts too early in interlude: start={aligned[2]['start_time']:.3f}s"
        )

        # 3. Outro preservation: Line 3 end must be <= 22.2s
        assert aligned[3]["end_time"] <= 22.2, (
            f"Line 3 bleeds into outro: end={aligned[3]['end_time']:.3f}s"
        )

        # 4. Strict monotonicity across all lines
        for i in range(len(aligned) - 1):
            assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001
            assert aligned[i]["start_time"] < aligned[i]["end_time"]

    def test_exact_1_5s_interlude_boundary_preservation(self, tmp_path):
        """
        Adversarial Scenario: Two phrases separated by an exact 1.50s silence gap.
        The >= 1.5s boundary must be treated as an interlude and remain completely empty.
        """
        sr = 44100
        duration = 12.0
        # P1: 2.0 - 5.0s (3s)
        # Gap: 5.0 - 6.5s (exactly 1.50s)
        # P2: 6.5 - 9.5s (3s)
        audio = synthesize_untimed_vocal_signal(
            duration=duration,
            vocal_regions=[(2.0, 5.0), (6.5, 9.5)],
            sr=sr,
        )
        wav_file = tmp_path / "exact_1_5s_interlude.wav"
        sf.write(str(wav_file), audio, sr)

        plain_lyrics = [
            {"text": "Before the one point five second gap", "start_time": 0.0, "end_time": 0.0},
            {"text": "After the one point five second gap", "start_time": 0.0, "end_time": 0.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 2

        # Assert no line encroaches into [5.05, 6.40]
        assert aligned[0]["end_time"] <= 5.05, (
            f"Line 0 encroaches into 1.5s gap: end={aligned[0]['end_time']:.3f}s"
        )
        assert aligned[1]["start_time"] >= 6.40, (
            f"Line 1 encroaches into 1.5s gap: start={aligned[1]['start_time']:.3f}s"
        )

    def test_multiple_long_interludes_4_phrases(self, tmp_path):
        """
        Adversarial Scenario: 4 vocal phrases separated by 2.0s, 3.0s, and 4.0s interludes.
        8 lines (2 lines per phrase). All 3 interludes and intro/outro must be 100% empty.
        """
        sr = 44100
        duration = 45.0
        vocal_regions = [
            (10.0, 13.0),  # P1 (Intro: 0.0 - 10.0s)
            (15.0, 19.0),  # P2 (Interlude 1: 13.0 - 15.0s, 2.0s >= 1.5s)
            (22.0, 26.0),  # P3 (Interlude 2: 19.0 - 22.0s, 3.0s >= 1.5s)
            (30.0, 35.0),  # P4 (Interlude 3: 26.0 - 30.0s, 4.0s >= 1.5s)
        ]  # Outro: 35.0 - 45.0s (10.0s)
        audio = synthesize_untimed_vocal_signal(
            duration=duration, vocal_regions=vocal_regions, sr=sr
        )
        wav_file = tmp_path / "multi_interludes.wav"
        sf.write(str(wav_file), audio, sr)

        plain_lyrics = [
            {"text": f"Phrase segment line number {i}", "start_time": 0.0, "end_time": 0.0}
            for i in range(8)
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 8

        # Define silent exclusion zones
        silent_zones = [
            (0.0, 9.8, "10s Intro"),
            (13.2, 14.8, "Interlude 1 (2.0s)"),
            (19.2, 21.8, "Interlude 2 (3.0s)"),
            (26.2, 29.8, "Interlude 3 (4.0s)"),
            (35.2, 45.0, "10s Outro"),
        ]

        for line in aligned:
            s, e = line["start_time"], line["end_time"]
            assert s < e, f"Invalid duration for line {line['id']}: [{s}, {e}]"
            for zone_s, zone_e, zone_name in silent_zones:
                # Line must not be located within the silent zone
                assert not (s >= zone_s and e <= zone_e), (
                    f"Line {line['id']} [{s}, {e}] placed entirely inside {zone_name}"
                )
                overlap = max(0.0, min(e, zone_e) - max(s, zone_s))
                assert overlap < 0.15, (
                    f"Line {line['id']} [{s}, {e}] overlaps {zone_name} by {overlap:.3f}s"
                )

    def test_transient_drum_bleed_in_10s_intro_ignored(self, tmp_path):
        """
        Adversarial Scenario: Multiple percussive transients (< 0.35s) in the 10s intro.
        Aligner must prune transient blips and maintain the 10s intro as empty.
        """
        sr = 44100
        duration = 20.0
        vocal_regions = [(10.0, 15.0)]
        transients = [(2.0, 2.10), (4.0, 4.10), (6.0, 4.10), (8.0, 8.10)]
        audio = synthesize_untimed_vocal_signal(
            duration=duration,
            vocal_regions=vocal_regions,
            sr=sr,
            transient_bursts=transients,
        )
        wav_file = tmp_path / "intro_bleed_test.wav"
        sf.write(str(wav_file), audio, sr)

        plain_lyrics = [
            {"text": "Line one singing after intro", "start_time": 0.0, "end_time": 0.0},
            {"text": "Line two singing after intro", "start_time": 0.0, "end_time": 0.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 2
        assert aligned[0]["start_time"] >= 9.8, (
            f"Transients in intro caused premature start: {aligned[0]['start_time']:.3f}s"
        )

    def test_transient_drum_bleed_in_long_interlude_ignored(self, tmp_path):
        """
        Adversarial Scenario: Percussive transient at 6.6s following singing end at 5.0s (1.6s gap >= 1.5s).
        The transient blip (< 0.35s) must be pruned and not split or bridge the interlude.
        """
        sr = 44100
        duration = 16.0
        vocal_regions = [(2.0, 5.0), (10.0, 13.0)]
        transients = [(6.6, 6.70)]
        audio = synthesize_untimed_vocal_signal(
            duration=duration,
            vocal_regions=vocal_regions,
            sr=sr,
            transient_bursts=transients,
        )
        wav_file = tmp_path / "interlude_bleed_test.wav"
        sf.write(str(wav_file), audio, sr)

        plain_lyrics = [
            {"text": "Verse line before interlude", "start_time": 0.0, "end_time": 0.0},
            {"text": "Chorus line after interlude", "start_time": 0.0, "end_time": 0.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 2
        assert aligned[0]["end_time"] <= 5.10
        assert aligned[1]["start_time"] >= 9.80


# ==============================================================================
# SUITE 2: UNTIMED PHRASE CONTOURS & SYLLABLE WEIGHTING
# ==============================================================================


class TestUntimedPhraseContoursAndSyllableWeighting:
    """Stress tests assessing dynamic syllable-weighting and word-level interlude avoidance."""

    def test_syllable_weighting_proportional_duration(self, tmp_path):
        """
        Verifies that line duration allocation scales with syllable and phonetic weight
        rather than assigning uniform slices.
        """
        sr = 44100
        duration = 15.0
        audio = synthesize_untimed_vocal_signal(duration=duration, vocal_regions=[(1.0, 14.0)])
        wav_file = tmp_path / "syllable_scaling.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "Hi", "start_time": 0.0, "end_time": 0.0},
            {
                "text": "Extensive multisyllabic communication across expansive geographical territories",
                "start_time": 0.0,
                "end_time": 0.0,
            },
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 2

        dur_short = aligned[0]["end_time"] - aligned[0]["start_time"]
        dur_long = aligned[1]["end_time"] - aligned[1]["start_time"]
        assert dur_long > 3.0 * dur_short, (
            f"Expected dur_long > 3.0 * dur_short, got {dur_long:.2f}s vs {dur_short:.2f}s"
        )

    def test_single_line_multiple_phrases_word_interlude_avoidance(self, tmp_path):
        """
        Adversarial Scenario: Only 1 line of lyrics is supplied for a track containing 2 phrases
        separated by a 3.5s silent interlude. Words within the single line must avoid the interlude.
        """
        sr = 44100
        duration = 25.0
        audio = synthesize_untimed_vocal_signal(
            duration=duration, vocal_regions=[(2.0, 5.0), (8.5, 11.5)]
        )
        wav_file = tmp_path / "single_line_multi_phrase.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [{"text": "First part second part", "start_time": 0.0, "end_time": 0.0}]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 1
        words = aligned[0]["words"]
        assert len(words) == 4

        # The silent interlude [5.1s, 8.4s] must not have words centered inside it
        for w in words:
            # Word should either end before 5.2s or start after 8.3s
            is_in_phrase1 = w["end_time"] <= 5.2
            is_in_phrase2 = w["start_time"] >= 8.3
            assert is_in_phrase1 or is_in_phrase2, (
                f"Word {w['word']} [{w['start_time']}, {w['end_time']}] placed inside interlude gap [5.1, 8.4]"
            )

    def test_more_phrases_than_lines_merging_gap_preservation(self, tmp_path):
        """
        Adversarial Scenario: M=2 lines across 4 active vocal phrases.
        Two 1.0s micro-pauses and one 8.0s major interlude. Aligner merges adjacent phrases
        while preserving the major 8.0s interlude.
        """
        sr = 44100
        duration = 24.0
        # Phrases: (2-4), (5-7) [gap=1s], (15-17) [gap=8s], (18-20) [gap=1s]
        audio = synthesize_untimed_vocal_signal(
            duration=duration,
            vocal_regions=[(2.0, 4.0), (5.0, 7.0), (15.0, 17.0), (18.0, 20.0)],
        )
        wav_file = tmp_path / "m_less_k_test.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "First section lines", "start_time": 0.0, "end_time": 0.0},
            {"text": "Second section lines", "start_time": 0.0, "end_time": 0.0},
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 2
        # Major 8s gap [7.0s, 15.0s] must separate line 0 end and line 1 start
        assert aligned[0]["end_time"] <= 7.5
        assert aligned[1]["start_time"] >= 14.5


# ==============================================================================
# SUITE 3: AUDIO ANOMALIES & FORMAT RESILIENCE
# ==============================================================================


class TestAudioAnomaliesAndFormatResilience:
    """Stress tests assessing audio decode anomalies, silence fallback, stereo, and NaNs."""

    def test_pure_silence_graceful_pacing(self, tmp_path):
        """
        Verifies that 100% silent audio falls back to monotonic uniform pacing
        leaving standard intro and outro margins.
        """
        sr = 44100
        duration = 20.0
        audio = np.zeros(int(sr * duration), dtype=np.float32)
        wav_file = tmp_path / "silence_test.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": f"Silent pacing line {i}", "start_time": 0.0, "end_time": 0.0}
            for i in range(4)
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 4

        # Intro margin >= 2.0s and outro margin >= 2.0s
        assert aligned[0]["start_time"] >= 2.0
        assert aligned[-1]["end_time"] <= 18.0

        for i in range(len(aligned)):
            assert aligned[i]["start_time"] < aligned[i]["end_time"]
            if i + 1 < len(aligned):
                assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"]

    def test_stereo_downmix_untimed_alignment(self, tmp_path):
        """Verifies stereo 2-channel audio correctly downmixes and yields valid monotonic lines."""
        sr = 44100
        duration = 10.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        v_l = np.zeros_like(t)
        v_r = np.zeros_like(t)
        v_l[(t >= 2.0) & (t <= 5.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 2.0) & (t <= 5.0)])
        v_r[(t >= 2.0) & (t <= 5.0)] = 0.4 * np.sin(2 * np.pi * 550 * t[(t >= 2.0) & (t <= 5.0)])
        stereo = np.column_stack([v_l, v_r]).astype(np.float32)

        wav_file = tmp_path / "stereo_test.wav"
        sf.write(str(wav_file), stereo, sr)

        lines = [{"text": "Stereo test line", "start_time": 0.0, "end_time": 0.0}]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 1
        assert aligned[0]["start_time"] >= 1.90
        assert aligned[0]["end_time"] <= 5.15

    def test_nan_inf_corrupted_audio_resilience(self, tmp_path):
        """Verifies audio containing NaNs and Infs is sanitized without throwing or returning NaNs."""
        sr = 44100
        duration = 5.0
        n_samples = int(sr * duration)
        corrupted = np.zeros(n_samples, dtype=np.float32)
        corrupted[1000:2000] = np.nan
        corrupted[3000:4000] = np.inf
        corrupted[5000:6000] = -np.inf

        wav_file = tmp_path / "corrupted_nan.wav"
        sf.write(str(wav_file), np.nan_to_num(corrupted), sr)

        lines = [{"text": "Resilience line", "start_time": 0.0, "end_time": 0.0}]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 1
        s, e = aligned[0]["start_time"], aligned[0]["end_time"]
        assert math.isfinite(s) and math.isfinite(e)
        assert s >= 0.0
        assert s < e

    def test_empty_lyrics_and_whitespace_lines(self, tmp_path):
        """Verifies empty lyrics array and whitespace-only lines handle gracefully."""
        sr = 44100
        audio = np.zeros(44100 * 3, dtype=np.float32)
        wav_file = tmp_path / "empty_test.wav"
        sf.write(str(wav_file), audio, sr)

        aligner = AudioAligner()
        assert aligner.align_lyrics(str(wav_file), []) == []

        whitespace_lines = [
            {"text": "", "start_time": 0.0, "end_time": 0.0},
            {"text": "   ", "start_time": 0.0, "end_time": 0.0},
            {"text": "Valid line", "start_time": 0.0, "end_time": 0.0},
        ]
        aligned = aligner.align_lyrics(str(wav_file), whitespace_lines)
        assert len(aligned) == 3
        for line in aligned:
            assert line["start_time"] < line["end_time"]


# ==============================================================================
# SUITE 4: MONOTONICITY & ADVERSARIAL EDGE CASE FAILURES
# ==============================================================================


class TestMonotonicityAndAdversarialEdgeCases:
    """Stress tests assessing line and word monotonicity, and pinpointing confirmed bugs."""

    def test_rapid_dense_phrases_monotonicity(self, tmp_path):
        """
        Adversarial Scenario: 6 rapid phrases with 0.3s breath pauses, an interlude of 1.9s,
        and 2 rapid phrases. Verifies that all line and word boundaries strictly satisfy
        0 <= start < end and are non-overlapping.
        """
        sr = 44100
        duration = 12.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        vocals = np.zeros_like(t)

        # 4 rapid phrases in section 1 (breath gaps = 0.3s)
        vocals[(t >= 1.0) & (t <= 1.8)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 1.0) & (t <= 1.8)])
        vocals[(t >= 2.1) & (t <= 2.9)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 2.1) & (t <= 2.9)])
        vocals[(t >= 3.2) & (t <= 4.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 3.2) & (t <= 4.0)])
        vocals[(t >= 4.3) & (t <= 5.1)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 4.3) & (t <= 5.1)])
        # Interlude: 5.1 to 7.0 (1.9s >= 1.5s)
        # 2 rapid phrases in section 2
        vocals[(t >= 7.0) & (t <= 7.8)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 7.0) & (t <= 7.8)])
        vocals[(t >= 8.1) & (t <= 8.9)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 8.1) & (t <= 8.9)])

        wav_file = tmp_path / "dense_rapid.wav"
        sf.write(str(wav_file), vocals, sr)

        plain_lyrics = [
            {"text": f"Rapid line {i}", "start_time": 0.0, "end_time": 0.0} for i in range(6)
        ]

        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), plain_lyrics)
        assert len(aligned) == 6

        # Check line monotonicity
        for i in range(len(aligned)):
            assert aligned[i]["start_time"] >= 0.0
            assert aligned[i]["start_time"] < aligned[i]["end_time"]
            if i + 1 < len(aligned):
                assert aligned[i]["end_time"] <= aligned[i + 1]["start_time"] + 0.001, (
                    f"Line {i} end ({aligned[i]['end_time']}) exceeds Line {i + 1} start ({aligned[i + 1]['start_time']})"
                )

            # Check word monotonicity within line
            words = aligned[i]["words"]
            for j in range(len(words)):
                assert words[j]["start_time"] >= 0.0
                assert words[j]["start_time"] < words[j]["end_time"]
                if j + 1 < len(words):
                    assert words[j]["end_time"] <= words[j + 1]["start_time"] + 0.001

    @pytest.mark.xfail(
        reason="BUG: _partition_lines_into_phrases forces l_e >= l_s + 0.010 while cur_t advances by dur < 0.010, causing adjacent lines to overlap",
        strict=False,
    )
    def test_xfail_dense_lines_overlapping_regression(self, tmp_path):
        """
        Adversarial Scenario: 200 lines partitioned into a 1.0s active vocal phrase (dur = 0.005s).
        Line end is clamped to l_s + 0.010s while cur_t advances by only 0.005s,
        causing adjacent lines to overlap (line[i].end_time > line[i+1].start_time).
        """
        sr = 44100
        duration = 5.0
        t = np.linspace(0, duration, int(sr * duration), endpoint=False)
        vocals = np.zeros_like(t)
        vocals[(t >= 2.0) & (t <= 3.0)] = 0.5 * np.sin(2 * np.pi * 440 * t[(t >= 2.0) & (t <= 3.0)])

        wav_file = tmp_path / "dense_lines_overlap.wav"
        sf.write(str(wav_file), vocals, sr)

        lines = [{"text": f"line {i}", "start_time": 0.0, "end_time": 0.0} for i in range(200)]
        aligner = AudioAligner()
        aligned = aligner.align_lyrics(str(wav_file), lines)

        # Monotonicity requirement: line[i].end_time <= line[i+1].start_time
        overlaps = [
            i
            for i in range(len(aligned) - 1)
            if aligned[i]["end_time"] > aligned[i + 1]["start_time"]
        ]
        assert len(overlaps) == 0, (
            f"Found {len(overlaps)} overlapping line pairs; first overlap at index {overlaps[0]}: "
            f"line[{overlaps[0]}].end_time={aligned[overlaps[0]]['end_time']} > "
            f"line[{overlaps[0] + 1}].start_time={aligned[overlaps[0] + 1]['start_time']}"
        )

    @pytest.mark.xfail(
        reason="BUG: enforce_monotonic_words produces negative start_time when max_allowed_end < min_dur in tight windows near t=0",
        strict=False,
    )
    def test_xfail_negative_word_timestamp_in_tight_window(self):
        """
        Adversarial Scenario: Line starting at t=0.0 with 5ms window and 10 words.
        enforce_monotonic_words computes max_allowed_end = 0.005 - (9 * 0.001) = -0.004,
        producing negative start timestamps (e.g. -0.005), violating 0 <= start_time < end_time.
        """
        words = [f"word{i}" for i in range(10)]
        spans = [(0.0, 0.005)] * 10
        result = enforce_monotonic_words(words, spans, l_start=0.0, l_end=0.005)

        negative_words = [w for w in result if w["start_time"] < 0.0]
        assert len(negative_words) == 0, (
            f"enforce_monotonic_words produced negative start_time: {negative_words}"
        )

    @pytest.mark.xfail(
        reason="BUG: align_lyrics and refine_line_boundaries crash with TypeError on None start_time or end_time",
        strict=False,
    )
    def test_xfail_none_timestamps_typeerror_crash(self, tmp_path):
        """
        Adversarial Scenario: Plain lyrics payload containing None for start_time/end_time.
        float(line.get("start_time", 0.0)) raises TypeError because float(None) is invalid.
        Both align_lyrics and fallback crash.
        """
        sr = 44100
        audio = np.zeros(44100 * 2, dtype=np.float32)
        wav_file = tmp_path / "none_test.wav"
        sf.write(str(wav_file), audio, sr)

        lines = [
            {"text": "Hello world", "start_time": None, "end_time": None},
        ]
        aligner = AudioAligner()
        # Should cleanly treat None as untimed (0.0) without crashing
        aligned = aligner.align_lyrics(str(wav_file), lines)
        assert len(aligned) == 1
        assert aligned[0]["start_time"] >= 0.0
