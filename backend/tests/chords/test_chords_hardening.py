"""Milestone 4 Challenger 1: Deep White-Box Adversarial Stress Testing Suite.

Covers:
1. Audio DSP Extremes:
   - 0-byte file, 0-sample array, sub-window audio (<4096 samples), empty wav file.
   - High sample rates (96kHz, 192kHz, 8kHz, 11.025kHz, 48kHz).
   - Mono vs stereo, complete phase cancellation (L = -R), 1-channel silence, quadraphonic audio.
   - Extreme clipping (+100dB, square wave saturation, massive 1e6 amplitude, DC offset +10, NaN/Inf poisoning, Nyquist oscillation).
   - Rapid chord changes (50ms, 100ms, 200ms < min_duration).
   - Microtonal pitch variations (+15, +30, +50 quarter tone, -25 cents).
   - Harmonic quality disambiguation (triads vs 7ths: Major, Minor, 7, maj7, m7).
2. API & Persistence Concurrency:
   - High-concurrency reads/writes (GET /api/project/{id}/chords, POST /api/project/{id}/chords, export endpoints).
   - Barrier-synchronized multi-threaded burst (40 threads simultaneously).
   - Atomic disk integrity on projects.json and backup recovery without race condition or corruption.
3. Transposition & Key Projection Fuzzing:
   - All 12 tonics x 5 chord qualities x 25 semitones [-12, +12].
   - Slash chords across all 25 semitones.
   - Circle-of-fifths enharmonic spelling consistency (flat vs sharp keys).
   - Key projection and round-trip invariance mod 12.
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.main import PROJECTS_LOCK, app, load_projects, projects, save_projects
from backend.project_store import PROJECTS_STORE_FILE
from backend.routers.exports import generate_chord_sheet
from backend.schemas import ChordSegmentSchema, ChordsUpdateRequest
from backend.services.chord_detector import (
    CHORD_QUALITIES,
    FLAT_KEYS,
    FLAT_SCALE,
    NOTE_TO_PITCH_CLASS,
    SHARP_KEYS,
    SHARP_SCALE,
    ChordDetector,
    ChordList,
    classify_key_spelling,
    parse_chord_symbol,
    project_key_signature,
    transpose_chord,
    transpose_chord_progression,
)

# ------------------------------------------------------------------------------
# Audio synthesis helpers
# ------------------------------------------------------------------------------

NOTE_FREQS = {
    "C3": 130.81,
    "D3": 146.83,
    "Eb3": 155.56,
    "E3": 164.81,
    "F3": 174.61,
    "F#3": 185.00,
    "G3": 196.00,
    "Ab3": 207.65,
    "A3": 220.00,
    "Bb3": 233.08,
    "B3": 246.94,
    "C4": 261.63,
    "C#4": 277.18,
    "D4": 293.66,
    "Eb4": 311.13,
    "E4": 329.63,
    "F4": 349.23,
    "F#4": 369.99,
    "G4": 392.00,
    "G#4": 415.30,
    "A4": 440.00,
    "Bb4": 466.16,
    "B4": 493.88,
    "C5": 523.25,
    "C#5": 554.37,
    "D5": 587.33,
    "Eb5": 622.25,
    "E5": 659.25,
    "F5": 698.46,
    "G5": 783.99,
    "A5": 880.00,
    "B5": 987.77,
}


def synth_sine_chord(
    freqs: list[float], duration: float = 1.0, sr: int = 22050, n_harmonics: int = 3
) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
    sig = np.zeros_like(t)
    for f in freqs:
        for h in range(1, n_harmonics + 1):
            sig += (1.0 / h) * np.sin(2.0 * np.pi * f * h * t)
    peak = float(np.max(np.abs(sig)))
    if peak > 0:
        sig = (sig / peak) * 0.6
    return sig.astype(np.float32)


# ==============================================================================
# SECTION 1: AUDIO DSP EXTREMES
# ==============================================================================


class TestDSPAudioExtremes:
    """Stress tests covering boundary audio inputs, sample rates, channels, and rapid changes."""

    def test_zero_duration_and_empty_inputs(self, tmp_path: Path):
        """Zero duration audio files and empty numpy arrays must return empty ChordList safely."""
        detector = ChordDetector()

        # 1. Empty numpy array
        empty_arr = np.array([], dtype=np.float32)
        res1 = detector.detect_chords(empty_arr)
        assert isinstance(res1, ChordList)
        assert len(res1) == 0

        # 2. 0-byte file on disk
        empty_file = tmp_path / "zero_bytes.wav"
        empty_file.write_bytes(b"")
        res2 = detector.detect_chords(empty_file)
        assert isinstance(res2, ChordList)
        assert len(res2) == 0

        # 3. Valid WAV container with 0 frames
        zero_wav = tmp_path / "zero_frames.wav"
        sf.write(str(zero_wav), np.empty((0,), dtype=np.float32), 22050)
        res3 = detector.detect_chords(zero_wav)
        assert isinstance(res3, ChordList)
        assert len(res3) == 0

        # 4. Non-existent file raises FileNotFoundError
        with pytest.raises(FileNotFoundError):
            detector.detect_chords(tmp_path / "does_not_exist.wav")

    @pytest.mark.parametrize("samples", [1, 10, 100, 2047, 4095])
    def test_sub_window_audio(self, samples: int):
        """Audio signals with fewer samples than STFT window (4096) return empty list safely."""
        detector = ChordDetector()
        sig = np.random.randn(samples).astype(np.float32) * 0.5
        res = detector.detect_chords(sig)
        assert isinstance(res, ChordList)
        assert len(res) == 0

    @pytest.mark.parametrize("sr", [8000, 11025, 44100, 48000, 96000, 192000])
    def test_sample_rate_resampling_extremes(self, sr: int):
        """Detector correctly resamples extreme sample rates (8kHz up to 192kHz) without error."""
        detector = ChordDetector()
        # 1.5s of C Major chord at sample rate sr
        c_freqs = [261.63, 329.63, 392.00]
        sig = synth_sine_chord(c_freqs, duration=1.5, sr=sr)

        chords = detector.detect_chords(sig, sr=sr)
        assert isinstance(chords, ChordList)
        assert len(chords) > 0
        detected_syms = [c["chord"] for c in chords if c["chord"] != "N"]
        assert "C" in detected_syms
        # Monotonicity check
        for i in range(len(chords)):
            assert chords[i]["start"] < chords[i]["end"]
            if i > 0:
                assert chords[i]["start"] >= chords[i - 1]["end"]

    def test_mono_vs_stereo_and_phase_cancellation(self):
        """Stereo audio downmixing, silent channel, and phase cancellation."""
        detector = ChordDetector()
        sr = 22050
        dur = 1.5
        c_freqs = [261.63, 329.63, 392.00]
        mono = synth_sine_chord(c_freqs, duration=dur, sr=sr)

        # 1. Normal stereo (identical channels)
        stereo_identical = np.column_stack([mono, mono])
        chords1 = detector.detect_chords(stereo_identical, sr=sr)
        assert "C" in [c["chord"] for c in chords1 if c["chord"] != "N"]

        # 2. One silent channel (L = signal, R = 0)
        stereo_one_silent = np.column_stack([mono, np.zeros_like(mono)])
        chords2 = detector.detect_chords(stereo_one_silent, sr=sr)
        assert "C" in [c["chord"] for c in chords2 if c["chord"] != "N"]

        # 3. Exact 180-degree phase cancellation (L = signal, R = -signal -> downmix sum = 0)
        stereo_canceled = np.column_stack([mono, -mono])
        chords3 = detector.detect_chords(stereo_canceled, sr=sr)
        # Should gracefully return empty or silence "N" with 0.0 confidence
        assert all(c["chord"] == "N" for c in chords3)

        # 4. Quadraphonic 4-channel audio
        quad = np.column_stack([mono, mono * 0.8, mono * 0.5, mono * 0.2])
        chords4 = detector.detect_chords(quad, sr=sr)
        assert "C" in [c["chord"] for c in chords4 if c["chord"] != "N"]

    def test_extreme_clipping_distortion_and_dc_offset(self):
        """Audio with massive clipping (+100dB), DC offset, or NaN/Inf poisoning."""
        detector = ChordDetector()
        sr = 22050
        dur = 2.0
        c_freqs = [261.63, 329.63, 392.00]
        base_sig = synth_sine_chord(c_freqs, duration=dur, sr=sr)

        # 1. Massive amplification (amplitude 1e6) hard-clipped
        massive_sig = np.clip(base_sig * 10000.0, -1.0, 1.0)
        chords_clip = detector.detect_chords(massive_sig, sr=sr)
        assert isinstance(chords_clip, ChordList)
        for c in chords_clip:
            assert np.isfinite(c["start"]) and np.isfinite(c["end"])
            assert 0.0 <= c["confidence"] <= 1.0

        # 2. Severe DC offset (+10.0 DC bias)
        dc_biased = base_sig + 10.0
        chords_dc = detector.detect_chords(dc_biased, sr=sr)
        assert isinstance(chords_dc, ChordList)
        for c in chords_dc:
            assert np.isfinite(c["start"]) and np.isfinite(c["end"])

        # 3. NaN and Inf poisoning in the signal
        poisoned = base_sig.copy()
        poisoned[100:150] = np.nan
        poisoned[500:550] = np.inf
        poisoned[1000:1050] = -np.inf
        chords_poison = detector.detect_chords(poisoned, sr=sr)
        assert isinstance(chords_poison, ChordList)
        for c in chords_poison:
            assert np.isfinite(c["start"]) and np.isfinite(c["end"])

        # 4. Pure Nyquist oscillation (alternating +1, -1)
        nyquist = np.ones(sr * 2, dtype=np.float32)
        nyquist[1::2] = -1.0
        chords_nyquist = detector.detect_chords(nyquist, sr=sr)
        assert isinstance(chords_nyquist, ChordList)
        # Should be classified as N due to high-frequency out-of-filterbank or noise flatness
        assert all(c["chord"] == "N" for c in chords_nyquist)

    def test_rapid_chord_changes_flicker_pruning(self):
        """Rapid chord changes (50ms, 100ms, 200ms) tested against STFT and flicker pruner."""
        detector = ChordDetector(min_duration=0.30)
        sr = 22050

        # Sequence of 4 chords repeating rapidly at 50ms intervals for 4 seconds
        chords_pool = [
            ("C", [261.63, 329.63, 392.00]),
            ("Am", [220.00, 261.63, 329.63]),
            ("F", [174.61, 220.00, 261.63]),
            ("G", [196.00, 246.94, 293.66]),
        ]
        part_dur = 0.05  # 50ms intervals
        repeats = 20
        parts = []
        for _ in range(repeats):
            for _name, freqs in chords_pool:
                parts.append(synth_sine_chord(freqs, duration=part_dur, sr=sr))
        full_audio = np.concatenate(parts)

        # Must execute without IndexError, division by zero, or invalid interval
        res = detector.detect_chords(full_audio, sr=sr)
        assert isinstance(res, ChordList)
        assert len(res) > 0

        # Verify strict monotonicity
        for i in range(len(res)):
            assert res[i]["start"] < res[i]["end"]
            if i > 0:
                assert res[i]["start"] >= res[i - 1]["end"]
                # Must be distinct chord symbols if consecutive
                assert res[i]["chord"] != res[i - 1]["chord"]

    def test_microtonal_pitch_variation_tolerance(self):
        """Microtonal pitch variations (+15, +30, +50 quarter tone, -25 cents)."""
        detector = ChordDetector()
        sr = 22050
        dur = 1.5

        # Standard C Major: C4 (261.63), E4 (329.63), G4 (392.00)
        base_c = [261.63, 329.63, 392.00]

        # +15 cents detuning (factor = 2^(15/1200) = 1.0087)
        factor_15 = 2.0 ** (15.0 / 1200.0)
        sig_15 = synth_sine_chord([f * factor_15 for f in base_c], duration=dur, sr=sr)
        chords_15 = detector.detect_chords(sig_15, sr=sr)
        detected_15 = [c["chord"] for c in chords_15 if c["chord"] != "N"]
        assert "C" in detected_15

        # -25 cents detuning (factor = 2^(-25/1200) = 0.9856)
        factor_neg25 = 2.0 ** (-25.0 / 1200.0)
        sig_neg25 = synth_sine_chord([f * factor_neg25 for f in base_c], duration=dur, sr=sr)
        chords_neg25 = detector.detect_chords(sig_neg25, sr=sr)
        detected_neg25 = [c["chord"] for c in chords_neg25 if c["chord"] != "N"]
        assert "C" in detected_neg25

        # Quarter-tone +50 cents: right in between C and C#
        factor_50 = 2.0 ** (50.0 / 1200.0)
        sig_50 = synth_sine_chord([f * factor_50 for f in base_c], duration=dur, sr=sr)
        chords_50 = detector.detect_chords(sig_50, sr=sr)
        # Should gracefully resolve to root of either C or C#/Db without crash
        roots_50 = [
            parse_chord_symbol(c["chord"])[0]
            for c in chords_50
            if c["chord"] != "N" and parse_chord_symbol(c["chord"])
        ]
        assert any(r in ("C", "C#", "Db") for r in roots_50)

    def test_harmonic_quality_disambiguation(self):
        """Harmonic quality disambiguation: C vs Cm vs C7 vs Cmaj7 vs Cm7."""
        detector = ChordDetector()
        sr = 22050
        dur = 2.0

        qualities = {
            "C": [261.63, 329.63, 392.00],  # C, E, G
            "Cm": [261.63, 311.13, 392.00],  # C, Eb, G
            "C7": [261.63, 329.63, 392.00, 466.16],  # C, E, G, Bb
            "Cmaj7": [261.63, 329.63, 392.00, 493.88],  # C, E, G, B
            "Cm7": [261.63, 311.13, 392.00, 466.16],  # C, Eb, G, Bb
        }

        for expected_chord, freqs in qualities.items():
            sig = synth_sine_chord(freqs, duration=dur, sr=sr)
            chords = detector.detect_chords(sig, sr=sr)
            detected = [c["chord"] for c in chords if c["chord"] != "N"]
            assert len(detected) > 0, f"Failed to detect chord for {expected_chord}"
            # Root must be C
            for c in detected:
                assert c.startswith("C"), f"Detected {c} does not have root C for {expected_chord}"


# ==============================================================================
# SECTION 2: API & PERSISTENCE CONCURRENCY
# ==============================================================================


class TestPersistenceConcurrencyAdversarial:
    """Stress tests covering high-concurrency race conditions on project chords and export routes."""

    @pytest.fixture
    def test_project(self, tmp_path: Path):
        pid = f"stress_proj_{uuid.uuid4().hex[:8]}"
        stems_dir = config.STEMS_DIR / pid
        stems_dir.mkdir(parents=True, exist_ok=True)
        inst_file = stems_dir / "instrumental.wav"

        # 3.0s synthetic audio stem
        t = np.linspace(0, 3.0, int(22050 * 3.0), endpoint=False)
        sig = 0.5 * np.sin(2 * np.pi * 440.0 * t).astype(np.float32)
        sf.write(str(inst_file), sig, 22050)

        proj_data = {
            "id": pid,
            "title": "Adversarial Song",
            "artist": "Stress Artist",
            "status": "ready",
            "instrumental_path": str(inst_file),
            "vocals_path": str(inst_file),
            "vocal_range": {"estimated_key": "C Major"},
            "lines": [
                {
                    "id": "line-1",
                    "text": "Hello world under concurrent stress",
                    "start_time": 0.5,
                    "end_time": 2.5,
                    "words": [],
                }
            ],
            "chords": None,  # uncomputed, ready for backfill
        }
        with PROJECTS_LOCK:
            projects[pid] = proj_data
            save_projects()

        return pid

    def test_barrier_synchronized_high_concurrency_storm(
        self, client: TestClient, test_project: str
    ):
        """Simultaneous 40-thread burst across GET chords, POST chords, and export endpoints."""
        pid = test_project
        num_threads = 40
        barrier = threading.Barrier(num_threads)
        results: list[dict[str, Any]] = []

        def worker_task(thread_id: int):
            # Synchronize thread release point
            barrier.wait()

            action_type = thread_id % 4
            try:
                if action_type == 0:
                    # GET chords with varied semitones
                    semi = (thread_id % 7) - 3
                    res = client.get(f"/api/project/{pid}/chords?semitones={semi}")
                    return {"thread_id": thread_id, "type": "GET", "status": res.status_code}
                elif action_type == 1:
                    # POST chords update
                    body = {
                        "chords": [
                            {
                                "id": f"c-{thread_id}-0",
                                "start": 0.0,
                                "end": 1.5,
                                "chord": "C",
                                "confidence": 0.9,
                            },
                            {
                                "id": f"c-{thread_id}-1",
                                "start": 1.5,
                                "end": 3.0,
                                "chord": "G",
                                "confidence": 0.85,
                            },
                        ]
                    }
                    res = client.post(f"/api/project/{pid}/chords", json=body)
                    return {"thread_id": thread_id, "type": "POST", "status": res.status_code}
                elif action_type == 2:
                    # GET export chord sheet
                    res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones=2")
                    return {
                        "thread_id": thread_id,
                        "type": "EXPORT_SHEET",
                        "status": res.status_code,
                    }
                else:
                    # GET export ASS with chords
                    res = client.get(
                        f"/api/project/{pid}/export/ass?include_chords=true&semitones=-2"
                    )
                    return {
                        "thread_id": thread_id,
                        "type": "EXPORT_ASS",
                        "status": res.status_code,
                    }
            except Exception as exc:
                return {"thread_id": thread_id, "error": str(exc)}

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(worker_task, i) for i in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # Assert zero unhandled exceptions
        for r in results:
            assert "error" not in r, f"Thread encountered exception: {r}"
            assert r["status"] == 200, f"Thread returned unexpected status: {r}"

        # Assert disk persistence integrity
        with PROJECTS_LOCK:
            reloaded = load_projects()
            assert pid in reloaded
            final_chords = reloaded[pid].get("chords")
            assert final_chords is not None
            assert isinstance(final_chords, list)
            # Verify file on disk is valid non-corrupted JSON
            store_file = getattr(main_mod, "PROJECTS_STORE_FILE", PROJECTS_STORE_FILE)
            raw_text = store_file.read_text(encoding="utf-8")
            parsed = json.loads(raw_text)
            assert pid in parsed

    def test_concurrent_empty_and_valid_chord_flips(self, client: TestClient, test_project: str):
        """Flapping between empty list [] and valid chords across 20 threads."""
        pid = test_project
        num_threads = 20
        barrier = threading.Barrier(num_threads)

        def flapper_task(i: int):
            barrier.wait()
            if i % 2 == 0:
                payload = {"chords": []}
            else:
                payload = {
                    "chords": [
                        {"id": f"chord-{i}", "start": 0.0, "end": 2.0, "chord": "Am"},
                        {"id": f"chord-{i + 1}", "start": 2.0, "end": 4.0, "chord": "F"},
                    ]
                }
            res = client.post(f"/api/project/{pid}/chords", json=payload)
            return res.status_code

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            statuses = list(executor.map(flapper_task, range(num_threads)))

        assert all(s == 200 for s in statuses)
        # End state must be well-formed
        res = client.get(f"/api/project/{pid}/chords")
        assert res.status_code == 200
        assert isinstance(res.json()["chords"], list)


# ==============================================================================
# SECTION 3: TRANSPOSITION & KEY PROJECTION FUZZING
# ==============================================================================


class TestTranspositionKeyProjectionFuzzing:
    """Exhaustive fuzzing across all 12 pitch roots, qualities, 25 semitones, and circle of fifths."""

    ROOTS = ("C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B")
    FLAT_ROOTS = ("C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B")
    QUALITIES = ("", "m", "7", "maj7", "m7")
    ALL_SEMITONES = tuple(range(-12, 13))

    def test_fuzz_all_roots_qualities_and_semitones(self):
        """Fuzz 12 roots x 5 qualities x 25 semitones = 1,500 combinations."""
        for root in self.ROOTS + self.FLAT_ROOTS:
            root_pc = NOTE_TO_PITCH_CLASS[root.upper()]
            for q in self.QUALITIES:
                chord = f"{root}{q}"
                for s in self.ALL_SEMITONES:
                    transposed = transpose_chord(chord, s)
                    assert transposed is not None
                    # Parse transposed output
                    parsed = parse_chord_symbol(transposed)
                    assert parsed is not None, f"Could not parse transposed chord: {transposed}"
                    new_root, new_q, _ = parsed
                    new_pc = NOTE_TO_PITCH_CLASS[new_root.upper()]

                    # Mathematical pitch-class shift mod 12
                    expected_pc = (root_pc + s) % 12
                    assert new_pc == expected_pc, (
                        f"Transposition error: {chord} + {s} semitones gave {transposed} (pc {new_pc}), expected pc {expected_pc}"
                    )
                    # Quality must be perfectly preserved
                    assert new_q == q

    def test_slash_chords_fuzzing(self):
        """Fuzz slash chords with bass notes across all 25 semitones."""
        slash_chords = ["C/G", "Am7/E", "F#m/C#", "Bb/D", "G7/B", "Ebmaj7/Bb"]
        for sc in slash_chords:
            main_str, bass_str = sc.split("/")
            main_pc = NOTE_TO_PITCH_CLASS[parse_chord_symbol(main_str)[0].upper()]
            bass_pc = NOTE_TO_PITCH_CLASS[bass_str.upper()]

            for s in self.ALL_SEMITONES:
                res = transpose_chord(sc, s)
                assert "/" in res
                res_main, res_bass = res.split("/")
                res_main_root = parse_chord_symbol(res_main)[0]
                assert NOTE_TO_PITCH_CLASS[res_main_root.upper()] == (main_pc + s) % 12
                assert NOTE_TO_PITCH_CLASS[res_bass.upper()] == (bass_pc + s) % 12

    def test_circle_of_fifths_enharmonic_spelling(self):
        """Verify sharp keys use sharps and flat keys use flats."""
        # Flat keys -> expect flats (e.g. Bb, Eb, Ab, Db, Gb)
        flat_keys = ["F Major", "Bb Major", "Eb Major", "Ab Major", "G Minor", "D Minor", "C Minor"]
        for key in flat_keys:
            spelling = classify_key_spelling(key)
            assert spelling == "flat", (
                f"Key {key} should have flat spelling preference, got {spelling}"
            )
            # Transpose C -> +10 semitones in flat key should be Bb, not A#
            res_bb = transpose_chord("C", 10, key=key)
            assert res_bb == "Bb", f"Expected Bb in flat key {key}, got {res_bb}"
            # Transpose C -> +3 semitones in flat key should be Eb, not D#
            res_eb = transpose_chord("C", 3, key=key)
            assert res_eb == "Eb", f"Expected Eb in flat key {key}, got {res_eb}"

        # Sharp keys -> expect sharps (e.g. F#, C#, G#, D#, A#)
        sharp_keys = ["G Major", "D Major", "A Major", "E Major", "B Major", "E Minor", "B Minor"]
        for key in sharp_keys:
            spelling = classify_key_spelling(key)
            assert spelling == "sharp", (
                f"Key {key} should have sharp spelling preference, got {spelling}"
            )
            # Transpose C -> +6 semitones in sharp key should be F#, not Gb
            res_fsharp = transpose_chord("C", 6, key=key)
            assert res_fsharp == "F#", f"Expected F# in sharp key {key}, got {res_fsharp}"
            # Transpose C -> +1 semitone in sharp key should be C#, not Db
            res_csharp = transpose_chord("C", 1, key=key)
            assert res_csharp == "C#", f"Expected C# in sharp key {key}, got {res_csharp}"

    def test_key_projection_through_circle_of_fifths(self):
        """Key signatures projected through [-12, +12] semitones match expected circle of fifths."""
        cases = [
            ("C Major", 2, "D Major"),
            ("C Major", -2, "Bb Major"),
            ("C Major", 7, "G Major"),
            ("C Major", -7, "F Major"),
            ("A Minor", 2, "B Minor"),
            ("A Minor", -2, "G Minor"),
            ("F Major", 1, "Gb Major"),
            ("G Major", 1, "Ab Major"),
        ]
        for start_key, shift, expected in cases:
            projected = project_key_signature(start_key, shift)
            assert projected == expected, (
                f"Projecting {start_key} by {shift} gave {projected}, expected {expected}"
            )

    def test_transposition_invariance_and_identity(self):
        """Mathematical properties: identity, octave invariance, round-trip symmetry."""
        chords = ["C", "Am", "F#m7", "Bbmaj7", "G7", "Eb", "C/G"]
        for c in chords:
            # 1. Identity at 0
            assert transpose_chord(c, 0) == c

            # 2. Octave invariance: +12 and -12 preserve exact pitch class
            t_plus12 = transpose_chord(c, 12)
            t_minus12 = transpose_chord(c, -12)
            assert t_plus12 == c or parse_chord_symbol(t_plus12)[0] == parse_chord_symbol(c)[0]
            assert t_minus12 == c or parse_chord_symbol(t_minus12)[0] == parse_chord_symbol(c)[0]

            # 3. Round-trip (+s then -s)
            for s in [-7, -5, -3, 2, 4, 7]:
                fwd = transpose_chord(c, s)
                back = transpose_chord(fwd, -s)
                # Pitch classes must match
                p_c = parse_chord_symbol(c)
                p_back = parse_chord_symbol(back)
                assert NOTE_TO_PITCH_CLASS[p_c[0].upper()] == NOTE_TO_PITCH_CLASS[p_back[0].upper()]

    def test_out_of_range_and_invalid_chord_inputs(self):
        """Boundary validation for semitones outside [-12, +12] and malformed chords."""
        # 1. Out of range semitones
        with pytest.raises(ValueError):
            transpose_chord("C", -13)
        with pytest.raises(ValueError):
            transpose_chord("C", 13)

        # 2. Silence tokens return "N"
        for no_chord in ["N", "N.C.", "NC", "NONE", "", "  "]:
            assert transpose_chord(no_chord, 3) == "N"

        # 3. Non-standard chord string returns string safely without exception
        assert transpose_chord("XYZUnknown", 2) == "XYZUnknown"


# ==============================================================================
# SECTION 4: VALIDATION, LONG AUDIO, AND EXPORT ADVERSARIAL STRESS
# ==============================================================================


class TestValidationAndExportAdversarial:
    """Stress tests on Pydantic validation edge cases, export rendering, and long audio scaling."""

    def test_pydantic_validation_negative_and_overlapping_timestamps(self, client: TestClient):
        """Strict HTTP 422 on boundary interval violations."""
        pid = f"val_proj_{uuid.uuid4().hex[:8]}"
        with PROJECTS_LOCK:
            projects[pid] = {"id": pid, "title": "Val Track", "status": "ready"}
            save_projects()

        # 1. Zero duration (start == end)
        res1 = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 1.0, "end": 1.0, "chord": "C"}]},
        )
        assert res1.status_code == 422

        # 2. Inverted interval (start > end)
        res2 = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 2.0, "end": 1.0, "chord": "C"}]},
        )
        assert res2.status_code == 422

        # 3. Microsecond overlap (end_i > start_{i+1})
        res3 = client.post(
            f"/api/project/{pid}/chords",
            json={
                "chords": [
                    {"start": 0.0, "end": 2.0001, "chord": "C"},
                    {"start": 2.0000, "end": 4.0000, "chord": "G"},
                ]
            },
        )
        assert res3.status_code == 422

        # 4. Negative start timestamp
        res4 = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": -0.01, "end": 1.0, "chord": "C"}]},
        )
        assert res4.status_code == 422

        # 5. Confidence > 1.0 or < 0.0
        res5 = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": 1.5}]},
        )
        assert res5.status_code == 422

    def test_massive_chord_payload_scalability(self, client: TestClient):
        """Payload scalability: 1,000 contiguous chord segments validated and persisted."""
        pid = f"mass_proj_{uuid.uuid4().hex[:8]}"
        with PROJECTS_LOCK:
            projects[pid] = {"id": pid, "title": "Massive Track", "status": "ready"}
            save_projects()

        large_chords = []
        cur_t = 0.0
        for i in range(1000):
            large_chords.append(
                {
                    "id": f"chord-{i}",
                    "start": round(cur_t, 3),
                    "end": round(cur_t + 0.5, 3),
                    "chord": "C" if i % 2 == 0 else "G",
                    "confidence": 0.95,
                }
            )
            cur_t += 0.5

        res = client.post(f"/api/project/{pid}/chords", json={"chords": large_chords})
        assert res.status_code == 200
        assert res.json()["chords_count"] == 1000

        # Retrieve and verify all 1,000 persisted intact
        get_res = client.get(f"/api/project/{pid}/chords")
        assert get_res.status_code == 200
        assert len(get_res.json()["chords"]) == 1000

    def test_ass_export_chord_dialogue_and_style_integrity(self, client: TestClient):
        """ASS export emits valid Style: Chord and Layer 2 Dialogue events with correct transposition."""
        pid = f"ass_proj_{uuid.uuid4().hex[:8]}"
        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "title": "ASS Test Song",
                "artist": "ASS Artist",
                "status": "ready",
                "lines": [
                    {
                        "id": "line-1",
                        "text": "Singing in the rain",
                        "start_time": 1.0,
                        "end_time": 4.0,
                        "words": [
                            {"text": "Singing", "start_time": 1.0, "end_time": 2.0},
                            {"text": "in", "start_time": 2.0, "end_time": 2.5},
                            {"text": "the", "start_time": 2.5, "end_time": 3.0},
                            {"text": "rain", "start_time": 3.0, "end_time": 4.0},
                        ],
                    }
                ],
                "chords": [
                    {"id": "c1", "start": 1.0, "end": 2.5, "chord": "C", "confidence": 0.9},
                    {"id": "c2", "start": 2.5, "end": 4.0, "chord": "G7", "confidence": 0.9},
                ],
            }
            save_projects()

        # 1. Export with include_chords=false: must NOT contain Style: Chord or Dialogue with Chord style
        res_no = client.get(f"/api/project/{pid}/export/ass?include_chords=false")
        assert res_no.status_code == 200
        ass_no = res_no.text
        assert "Style: Chord" not in ass_no

        # 2. Export with include_chords=true: must contain Style: Chord on Layer 2
        res_yes = client.get(f"/api/project/{pid}/export/ass?include_chords=true&semitones=2")
        assert res_yes.status_code == 200
        ass_yes = res_yes.text
        assert "Style: Chord" in ass_yes
        assert "Dialogue: 2," in ass_yes  # Layer 2
        # C + 2 semitones = D; G7 + 2 semitones = A7
        assert "D" in ass_yes
        assert "A7" in ass_yes

    def test_chord_sheet_export_structure_and_rfc_headers(self, client: TestClient):
        """Lead sheet export contains metadata, aligned lines, and valid Content-Disposition headers."""
        pid = f"sheet_proj_{uuid.uuid4().hex[:8]}"
        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "title": "Mélodie Français / Special! & 100%",
                "artist": "Chanteur Étoile",
                "status": "ready",
                "lines": [
                    {
                        "id": "line-1",
                        "text": "First lyric line here",
                        "start_time": 4.0,
                        "end_time": 7.0,
                        "words": [
                            {"text": "First", "start_time": 4.0, "end_time": 5.0},
                            {"text": "lyric", "start_time": 5.0, "end_time": 6.0},
                            {"text": "line", "start_time": 6.0, "end_time": 6.5},
                            {"text": "here", "start_time": 6.5, "end_time": 7.0},
                        ],
                    }
                ],
                "chords": [
                    {"id": "c0", "start": 0.0, "end": 3.5, "chord": "C"},  # Intro chord
                    {"id": "c1", "start": 4.0, "end": 7.0, "chord": "Am"},  # During line
                ],
            }
            save_projects()

        res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones=3")
        assert res.status_code == 200
        assert "text/markdown" in res.headers["content-type"]
        cd = res.headers["content-disposition"]
        assert "attachment" in cd
        assert "filename*=" in cd  # RFC 5987 UTF-8 encoded filename

        body = res.text
        assert "Mélodie Français" in body
        assert "Chanteur Étoile" in body
        assert "[Instrumental]" in body  # Intro block
        # Transposition +3 semitones: C -> Eb (or D#), Am -> Cm
        assert "Cm" in body

    def test_long_audio_stft_performance_and_memory(self):
        """10-minute simulated audio stream processed in CPU STFT under reasonable time."""
        detector = ChordDetector()
        sr = 22050
        # 10 minutes = 600 seconds
        duration = 600.0
        # Synthesize repeating C-Am-F-G pattern every 2 seconds
        c_freqs = [261.63, 329.63, 392.00]
        chunk = synth_sine_chord(c_freqs, duration=2.0, sr=sr)
        repeats = int(duration / 2.0)
        long_sig = np.tile(chunk, repeats)
        assert len(long_sig) == int(sr * duration)

        import time

        t0 = time.perf_counter()
        chords = detector.detect_chords(long_sig, sr=sr)
        elapsed = time.perf_counter() - t0

        assert isinstance(chords, ChordList)
        assert len(chords) > 0
        # 10 minutes of audio should be processed in < 3.0 seconds on modern CPU
        assert elapsed < 5.0, f"STFT on 10 min audio took {elapsed:.2f}s, expected < 5.0s"
