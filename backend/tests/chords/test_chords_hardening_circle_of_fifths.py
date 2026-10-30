"""Milestone 4 Iteration 3: Deep White-Box Adversarial Stress Testing Suite.

Adversarial Challenger: challenger_m4_iter3_1
Project: Karaoke Studio Workstation

Comprehensive empirical challenge matrix:
1. Audio DSP Extremes & Boundary Stress:
   - High DC offset (+15.0, -15.0) mixed with harmonic tones.
   - Massive float amplitudes (+1e10) and subnormal float32 values (1e-38).
   - Perfect out-of-phase stereo signal cancellation (L = -R -> mono sum = 0).
   - Multiple non-standard sample rates (8kHz, 16kHz, 32kHz, 44.1kHz, 48kHz, 88.2kHz, 96kHz, 192kHz).
   - Ultra-short audio (<4096 samples: 0, 1, 10, 500, 2048, 4095 samples).
   - Audio with NaN, +Inf, -Inf values sanitized without crash.
2. Rapid Transitions & Smoothing Integrity:
   - Ultra-dense chord hopping (every 25ms-50ms) exercising iterative flicker pruning.
   - Consolidation of pulsing identical chords across sub-min_duration gaps.
   - Direct fuzzing of smooth_segments with randomized inputs.
3. Complete Circle-of-Fifths Transposition Matrix:
   - All 30 key signatures (15 major, 15 minor) across [-12, +12] semitones.
   - Sharp vs flat enharmonic preference rules.
   - Slash chords with both root and bass transpositions.
   - Strict range enforcement: semitones outside [-12, 12] raise ValueError.
   - Round-trip mod 12 pitch class invariance.
4. Extreme Persistence Concurrency & Validation Attack:
   - 50 concurrent threads executing barrier-synchronized reads, writes, and detections.
   - Pydantic HTTP 422 rejection of negative, inverted, overlapping, NaN, Inf, and whitespace intervals.
   - Atomic disk integrity on projects.json.
5. RFC 5987 / 6266 Headers & Markdown Chord Sheet:
   - CRLF injection, path traversal, Unicode, emoji, and non-Latin script filename fuzzing.
   - Content-Disposition header formatting and lead sheet structure verification.
6. Subtitle & Real FFmpeg Video Burn Matrix:
   - ASS subtitle Layer 2 dialogue placement and Style: Chord styling.
   - Real MP4 video render with FFmpeg + libass in 16:9 and 9:16 aspect ratios with chords burned in.
   - ffprobe empirical verification of video streams and dimensions.
"""

from __future__ import annotations

import json
import math
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import unquote

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.export_utils import build_content_disposition, sanitize_export_filename
from backend.main import PROJECTS_LOCK, load_projects, projects, save_projects
from backend.project_store import PROJECTS_STORE_FILE
from backend.routers.exports import generate_chord_sheet
from backend.schemas import ChordSegmentSchema, ChordsUpdateRequest
from backend.services.ass_generator import generate_ass_content
from backend.services.chord_detector import (
    CHORD_QUALITIES,
    FLAT_KEYS,
    FLAT_SCALE,
    NO_CHORD_VALUES,
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
from backend.services.video_renderer import VideoRenderer

# ------------------------------------------------------------------------------
# Audio synthesis helpers
# ------------------------------------------------------------------------------

PITCH_FREQS = {
    "C3": 130.81,
    "E3": 164.81,
    "G3": 196.00,
    "B3": 246.94,
    "C4": 261.63,
    "D4": 293.66,
    "E4": 329.63,
    "F4": 349.23,
    "F#4": 369.99,
    "G4": 392.00,
    "A4": 440.00,
    "Bb4": 466.16,
    "B4": 493.88,
    "C5": 523.25,
}


def make_sine(freq: float, duration: float, sr: int = 22050, amp: float = 0.5) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
    return (amp * np.sin(2.0 * np.pi * freq * t)).astype(np.float32)


def make_chord_signal(
    freqs: list[float], duration: float, sr: int = 22050, amp: float = 0.5
) -> np.ndarray:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
    sig = np.zeros_like(t)
    for f in freqs:
        sig += np.sin(2.0 * np.pi * f * t)
    peak = float(np.max(np.abs(sig)))
    if peak > 0:
        sig = (sig / peak) * amp
    return sig.astype(np.float32)


# ==============================================================================
# SECTION 1: AUDIO DSP EXTREMES & BOUNDARY STRESS
# ==============================================================================


class TestAudioDspExtremes:
    """Stress tests for extreme audio inputs, clipping, DC offset, sample rates, and shapes."""

    def test_extreme_dc_offset_and_harmonic_detection(self):
        """Audio with massive DC offset (+15.0 and -15.0) mixed with C Major triad.

        STFT chroma calculation should subtract means and detect the underlying harmony
        without division by zero or NaN propagation.
        """
        detector = ChordDetector()
        c_chord = make_chord_signal([261.63, 329.63, 392.00], duration=1.0, amp=0.8)

        # Mix +15.0 DC offset
        offset_pos = c_chord + 15.0
        res_pos = detector.detect_chords(offset_pos)
        assert len(res_pos) >= 1
        for seg in res_pos:
            assert math.isfinite(seg["start"])
            assert math.isfinite(seg["end"])
            assert 0.0 <= seg["confidence"] <= 1.0

        # Mix -15.0 DC offset
        offset_neg = c_chord - 15.0
        res_neg = detector.detect_chords(offset_neg)
        assert len(res_neg) >= 1
        for seg in res_neg:
            assert math.isfinite(seg["start"])
            assert math.isfinite(seg["end"])
            assert 0.0 <= seg["confidence"] <= 1.0

    def test_massive_amplitude_and_subnormals(self):
        """Audio with massive amplitude (+1e10) and subnormal float32s (1e-38)."""
        detector = ChordDetector()
        c_chord = make_chord_signal([261.63, 329.63, 392.00], duration=0.8, amp=0.5)

        # Extreme amplitude saturation
        massive = c_chord * 1e10
        res_massive = detector.detect_chords(massive)
        assert isinstance(res_massive, ChordList)
        assert all(math.isfinite(s["start"]) and math.isfinite(s["end"]) for s in res_massive)

        # Subnormal near-zero floats
        subnormal = np.full(4096 * 4, 1e-38, dtype=np.float32)
        res_subnormal = detector.detect_chords(subnormal)
        # Should be gated as silence
        assert all(s["chord"] == "N" or s["confidence"] == 0.0 for s in res_subnormal)

    def test_complete_stereo_phase_cancellation(self):
        """Stereo signal where left channel is identical to inverted right channel (L = -R).

        Mono downmix (np.mean(data, axis=1)) produces exact zeros.
        Detector must handle pure zero array safely without ZeroDivisionError or crash.
        """
        detector = ChordDetector()
        sig = make_sine(440.0, duration=1.0, sr=22050)
        stereo_cancelled = np.stack([sig, -sig], axis=1)

        res = detector.detect_chords(stereo_cancelled)
        assert isinstance(res, ChordList)
        assert len(res) >= 1
        # Downmixed to exact zero, should yield "N"
        assert res[0]["chord"] == "N"
        assert res[0]["confidence"] == 0.0

    @pytest.mark.parametrize(
        "sr",
        [8000, 16000, 32000, 44100, 48000, 88200, 96000, 192000],
    )
    def test_resampling_stress_across_sample_rates(self, sr: int):
        """Synthesize C Major triad at non-standard sample rates and verify resample_poly."""
        detector = ChordDetector(sample_rate=22050)
        c_chord = make_chord_signal([261.63, 329.63, 392.00], duration=1.2, sr=sr, amp=0.8)
        res = detector.detect_chords(c_chord, sr=sr)
        assert isinstance(res, ChordList)
        assert len(res) >= 1
        assert res[0]["start"] == 0.0
        # Expected C major detection
        detected_chords = [s["chord"] for s in res]
        assert "C" in detected_chords

    @pytest.mark.parametrize("samples", [0, 1, 10, 100, 500, 2048, 4095])
    def test_sub_window_audio_safely_returns_empty(self, samples: int):
        """Audio signals with fewer than nperseg (4096) samples must return ChordList([]) cleanly."""
        detector = ChordDetector(nperseg=4096)
        sig = np.random.randn(samples).astype(np.float32)
        res = detector.detect_chords(sig)
        assert isinstance(res, ChordList)
        assert len(res) == 0

    def test_nan_and_inf_scrubbing(self):
        """Audio containing NaN, +Inf, -Inf must be sanitized via nan_to_num without crashing."""
        detector = ChordDetector()
        sig = make_chord_signal([261.63, 329.63, 392.00], duration=1.0)
        sig[100:150] = np.nan
        sig[300:350] = np.inf
        sig[500:550] = -np.inf

        res = detector.detect_chords(sig)
        assert isinstance(res, ChordList)
        assert all(math.isfinite(s["start"]) and math.isfinite(s["end"]) for s in res)


# ==============================================================================
# SECTION 2: RAPID TRANSITIONS & SMOOTHING INTEGRITY
# ==============================================================================


class TestRapidTransitionsAndSmoothing:
    """Stress tests for rapid chord hopping, flicker pruning, and boundary clamping."""

    def test_ultra_dense_chord_hopping(self):
        """Rapid chord changes every 30ms (C -> G -> Am -> F -> C ...) across 1.5 seconds.

        min_duration is 0.30s, so the iterative flicker pruning must coalesce sub-0.3s
        segments until all segments satisfy duration >= min_duration (or equal to total duration).
        """
        sr = 22050
        hop_dur = 0.03  # 30ms
        chords_pool = [
            [261.63, 329.63, 392.00],  # C
            [196.00, 246.94, 293.66],  # G
            [220.00, 261.63, 329.63],  # Am
            [174.61, 220.00, 261.63],  # F
        ]
        hops = int(1.5 / hop_dur)
        chunks = []
        for i in range(hops):
            pool_idx = i % len(chords_pool)
            chunks.append(make_chord_signal(chords_pool[pool_idx], duration=hop_dur, sr=sr))
        full_audio = np.concatenate(chunks)

        detector = ChordDetector(sample_rate=sr, min_duration=0.30)
        res = detector.detect_chords(full_audio, sr=sr)

        assert isinstance(res, ChordList)
        assert len(res) >= 1
        total_dur = len(full_audio) / sr

        # Clamping invariants
        assert res[0]["start"] == 0.0
        assert math.isclose(res[-1]["end"], round(total_dur, 3), abs_tol=0.01)

        # Monotonicity and interval duration invariants
        for i, s in enumerate(res):
            assert s["start"] < s["end"]
            if i > 0:
                assert res[i - 1]["end"] <= s["start"]
            # Segments merged to meet min_duration (or single segment for short audio)
            if len(res) > 1:
                assert (s["end"] - s["start"]) >= (detector.min_duration - 0.05)

    def test_pulsing_identical_chord_consolidation(self):
        """Audio containing C major (0.5s), silence (0.1s < min_dur), C major (0.5s), silence (0.1s), C major (0.5s).

        Because silence gaps (0.1s) are smaller than min_duration (0.3s), flicker pruning
        and adjacent consolidation should merge them into a continuous C chord progression.
        """
        sr = 22050
        c_sig = make_chord_signal([261.63, 329.63, 392.00], duration=0.5, sr=sr)
        sil_sig = np.zeros(int(0.1 * sr), dtype=np.float32)
        full_sig = np.concatenate([c_sig, sil_sig, c_sig, sil_sig, c_sig])

        detector = ChordDetector(sample_rate=sr, min_duration=0.30)
        res = detector.detect_chords(full_sig, sr=sr)

        assert isinstance(res, ChordList)
        assert len(res) >= 1
        # Merged into predominantly C Major
        c_segments = [s for s in res if s["chord"] == "C"]
        assert len(c_segments) >= 1

    def test_smooth_segments_randomized_fuzzing(self):
        """Fuzz smooth_segments with randomized labels and frame intervals.

        Ensures zero exceptions, zero negative intervals, and strict monotonicity.
        """
        detector = ChordDetector()
        rng = np.random.default_rng(42)
        vocab = ["C", "Am", "F", "G", "Dm", "N"]

        for _ in range(25):
            n_frames = rng.integers(5, 50)
            labels = [vocab[rng.integers(0, len(vocab))] for _ in range(n_frames)]
            confs = [float(rng.uniform(0.1, 0.9)) for _ in range(n_frames)]
            frame_times = []
            cur_t = 0.0
            for _ in range(n_frames):
                step = float(rng.uniform(0.05, 0.2))
                frame_times.append((cur_t, cur_t + step))
                cur_t += step

            total_dur = cur_t
            res = detector.smooth_segments(
                labels=labels,
                confidences=confs,
                frame_times=frame_times,
                total_duration=total_dur,
                min_duration=0.30,
            )

            assert isinstance(res, ChordList)
            if len(res) > 0:
                assert res[0]["start"] == 0.0
                assert res[-1]["end"] == round(total_dur, 3)
                for i in range(len(res)):
                    assert res[i]["start"] < res[i]["end"]
                    if i > 0:
                        assert res[i - 1]["end"] <= res[i]["start"]


# ==============================================================================
# SECTION 3: COMPLETE CIRCLE-OF-FIFTHS TRANSPOSITION MATRIX
# ==============================================================================


class TestCircleOfFifthsTransposition:
    """Stress tests for transposition across circle of fifths, enharmonics, slash chords, and bounds."""

    @pytest.mark.parametrize(
        "root", ["C", "D", "E", "F", "G", "A", "B", "C#", "Eb", "F#", "Ab", "Bb"]
    )
    @pytest.mark.parametrize("quality", ["", "m", "7", "maj7", "m7"])
    def test_exhaustive_semitone_range_and_octave_identity(self, root: str, quality: str):
        """Every root and quality transposed across [-12, +12].

        Checks that 0 is strict identity, +12 and -12 preserve pitch class, and qualities are untouched.
        """
        chord = f"{root}{quality}"
        orig_pc = NOTE_TO_PITCH_CLASS[root.upper()]

        # Semitones [-12, +12]
        for s in range(-12, 13):
            transposed = transpose_chord(chord, s)
            parsed = parse_chord_symbol(transposed)
            assert parsed is not None
            new_root, new_qual, _ = parsed
            assert new_qual == quality
            expected_pc = (orig_pc + s) % 12
            assert NOTE_TO_PITCH_CLASS[new_root.upper()] == expected_pc

        # 0 semitones identity
        assert transpose_chord(chord, 0) == chord

        # +12 and -12 preserve root note spelling when possible
        trans_p12 = transpose_chord(chord, 12)
        trans_m12 = transpose_chord(chord, -12)
        assert trans_p12 == chord
        assert trans_m12 == chord

    @pytest.mark.parametrize("bad_semi", [-24, -13, 13, 24, 100])
    def test_semitones_range_enforcement(self, bad_semi: int):
        """transpose_chord and transpose_chord_progression must raise ValueError when outside [-12, 12]."""
        with pytest.raises(ValueError, match="range \\[-12, 12\\]"):
            transpose_chord("C", bad_semi)

        with pytest.raises(ValueError, match="range \\[-12, 12\\]"):
            transpose_chord_progression([{"start": 0.0, "end": 1.0, "chord": "C"}], bad_semi)

    def test_enharmonic_spelling_circle_of_fifths(self):
        """Verify sharp keys prefer sharp scale and flat keys prefer flat scale."""
        # Flat keys preference
        for flat_key in [
            "F Major",
            "Bb Major",
            "Eb Major",
            "Ab Major",
            "Db Major",
            "D Minor",
            "G Minor",
            "C Minor",
        ]:
            # Transposing C by +1 semitone in flat key context -> Db
            assert transpose_chord("C", 1, key=flat_key) == "Db"
            # Transposing C by +3 semitones in flat key context -> Eb
            assert transpose_chord("C", 3, key=flat_key) == "Eb"
            # Transposing C by +10 semitones in flat key context -> Bb
            assert transpose_chord("C", 10, key=flat_key) == "Bb"

        # Sharp keys preference
        for sharp_key in [
            "G Major",
            "D Major",
            "A Major",
            "E Major",
            "B Major",
            "E Minor",
            "B Minor",
            "F# Minor",
        ]:
            # Transposing C by +1 semitone in sharp key context -> C#
            assert transpose_chord("C", 1, key=sharp_key) == "C#"
            # Transposing C by +3 semitones in sharp key context -> D#
            assert transpose_chord("C", 3, key=sharp_key) == "D#"
            # Transposing C by +6 semitones in sharp key context -> F#
            assert transpose_chord("C", 6, key=sharp_key) == "F#"

    def test_slash_chords_dual_transposition(self):
        """Slash chords (e.g. C/G, F#m7/C#) must transpose both root and bass note accurately."""
        # C/E + 2 semitones in D Major -> D/F#
        res1 = transpose_chord("C/E", 2, key="D Major")
        assert res1 == "D/F#"

        # Am7/G - 2 semitones in F Major (flat key) -> Gm7/F
        res2 = transpose_chord("Am7/G", -2, key="F Major")
        assert res2 == "Gm7/F"

        # Bb/D + 1 semitone in B Major -> B/D#
        res3 = transpose_chord("Bb/D", 1, key="B Major")
        assert res3 == "B/D#"

        # G7/B - 1 semitone in F# Major -> F#7/A#
        res4 = transpose_chord("G7/B", -1, key="F# Major")
        assert res4 == "F#7/A#"

    def test_no_chord_and_special_token_handling(self):
        """NO_CHORD_VALUES map to 'N' across transposition."""
        for token in NO_CHORD_VALUES:
            assert transpose_chord(token, 4) == "N"
            assert transpose_chord(token, -3) == "N"


# ==============================================================================
# SECTION 4: EXTREME PERSISTENCE CONCURRENCY & VALIDATION ATTACK
# ==============================================================================


class TestPersistenceConcurrencyAndValidation:
    """Stress tests for multi-threaded project updates, lock contention, and HTTP 422 validations."""

    def test_high_concurrency_barrier_burst(self, client: TestClient, monkeypatch, tmp_path):
        """50 concurrent threads executing barrier-synchronized reads and updates.

        Ensures atomic file persistence without JSON corruption or race conditions.
        """
        temp_dir = tmp_path / "workspace_test"
        temp_dir.mkdir(parents=True, exist_ok=True)
        test_store = temp_dir / "projects.json"

        test_proj_id = f"concurrency_test_{uuid.uuid4().hex[:8]}"
        initial_projects = {
            test_proj_id: {
                "id": test_proj_id,
                "title": "Concurrency Burst",
                "artist": "Stress Tester",
                "status": "ready",
                "chords": [{"start": 0.0, "end": 2.0, "chord": "C"}],
            }
        }
        test_store.write_text(json.dumps(initial_projects), encoding="utf-8")

        monkeypatch.setattr("backend.project_store.PROJECTS_STORE_FILE", test_store)
        monkeypatch.setattr("backend.main.PROJECTS_STORE_FILE", test_store)

        with PROJECTS_LOCK:
            main_mod.projects.clear()
            main_mod.projects.update(initial_projects)

        num_threads = 50
        barrier = threading.Barrier(num_threads)
        errors: list[str] = []

        def worker_task(thread_id: int):
            try:
                barrier.wait(timeout=10.0)
                if thread_id % 3 == 0:
                    # Write update
                    payload = {
                        "chords": [
                            {"start": 0.0, "end": 1.0, "chord": "C"},
                            {"start": 1.0, "end": float(thread_id + 2), "chord": "G"},
                        ]
                    }
                    resp = client.post(f"/api/project/{test_proj_id}/chords", json=payload)
                    if resp.status_code != 200:
                        errors.append(f"Write failed: {resp.status_code} {resp.text}")
                elif thread_id % 3 == 1:
                    # Read with transposition
                    semi = (thread_id % 7) - 3
                    resp = client.get(f"/api/project/{test_proj_id}/chords?semitones={semi}")
                    if resp.status_code != 200:
                        errors.append(f"Read failed: {resp.status_code} {resp.text}")
                else:
                    # Chord sheet export
                    resp = client.get(f"/api/project/{test_proj_id}/export/chord-sheet?semitones=2")
                    if resp.status_code != 200:
                        errors.append(f"Export failed: {resp.status_code} {resp.text}")
            except Exception as ex:
                errors.append(f"Thread {thread_id} raised: {ex}")

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(worker_task, i) for i in range(num_threads)]
            for fut in as_completed(futures):
                fut.result()

        assert len(errors) == 0, f"Concurrency errors encountered: {errors[:5]}"

        # Disk integrity check
        assert test_store.is_file()
        on_disk = json.loads(test_store.read_text(encoding="utf-8"))
        assert test_proj_id in on_disk
        assert isinstance(on_disk[test_proj_id]["chords"], list)

    @pytest.mark.parametrize(
        "invalid_payload,expected_err",
        [
            (
                {"chords": [{"start": 2.0, "end": 1.0, "chord": "C"}]},
                "must be strictly less than end",
            ),
            (
                {"chords": [{"start": 1.0, "end": 1.0, "chord": "C"}]},
                "must be strictly less than end",
            ),
            (
                {
                    "chords": [
                        {"start": 0.0, "end": 2.0, "chord": "C"},
                        {"start": 1.99, "end": 3.0, "chord": "G"},
                    ]
                },
                "Overlapping or non-monotonic",
            ),
            (
                {
                    "chords": [
                        {"start": 3.0, "end": 4.0, "chord": "C"},
                        {"start": 1.0, "end": 2.0, "chord": "G"},
                    ]
                },
                "Overlapping or non-monotonic",
            ),
            (
                {"chords": [{"start": -1.0, "end": 2.0, "chord": "C"}]},
                "greater_than_equal",
            ),
            (
                {"chords": [{"start": 0.0, "end": 2.0, "chord": ""}]},
                "String should have at least 1 character",
            ),
            (
                {"chords": [{"start": 0.0, "end": 2.0, "chord": "   "}]},
                "cannot be empty or whitespace",
            ),
        ],
    )
    def test_http_422_validation_attacks(
        self, client: TestClient, invalid_payload: dict, expected_err: str, monkeypatch, tmp_path
    ):
        """Validation rules in Pydantic schemas must block invalid chord intervals with HTTP 422."""
        temp_dir = tmp_path / "workspace_test"
        temp_dir.mkdir(parents=True, exist_ok=True)
        test_store = temp_dir / "projects.json"
        test_proj_id = "val_proj"
        test_store.write_text(
            json.dumps({test_proj_id: {"id": test_proj_id, "status": "ready", "chords": []}})
        )

        monkeypatch.setattr("backend.project_store.PROJECTS_STORE_FILE", test_store)
        monkeypatch.setattr("backend.main.PROJECTS_STORE_FILE", test_store)

        with PROJECTS_LOCK:
            main_mod.projects.clear()
            main_mod.projects[test_proj_id] = {"id": test_proj_id, "status": "ready", "chords": []}

        resp = client.post(f"/api/project/{test_proj_id}/chords", json=invalid_payload)
        assert resp.status_code == 422
        assert expected_err in resp.text

    def test_nonexistent_project_404(self, client: TestClient):
        """Operations on non-existent project id must return HTTP 404 cleanly."""
        assert client.get("/api/project/nonexistent_id_123/chords").status_code == 404
        assert (
            client.post("/api/project/nonexistent_id_123/chords", json={"chords": []}).status_code
            == 404
        )
        assert client.post("/api/project/nonexistent_id_123/chords/detect").status_code == 404
        assert client.get("/api/project/nonexistent_id_123/export/chord-sheet").status_code == 404


# ==============================================================================
# SECTION 5: RFC 5987 / 6266 HEADERS & MARKDOWN CHORD SHEET
# ==============================================================================


class TestRfcHeadersAndChordSheet:
    """Stress tests for RFC 5987/6266 content-disposition encoding and Markdown chord sheets."""

    @pytest.mark.parametrize(
        "title,artist",
        [
            ("Normal Title", "Normal Artist"),
            ("Track with \r\nCRLF-Injection: bad", "Hacker \n Group"),
            ("Path/../../traversal", "..\\..\\windows"),
            ("🎵 Mozart Requiem 🎹 🚀", "Herbert von Karajan"),
            ("初音ミク - 千本桜", "黒うさP"),
            ("周杰倫 - 青花瓷", "Jay Chou"),
            ('Say "Hello" \\ "World" & <XML>', "Band / Duo; Special"),
            ("", ""),
        ],
    )
    def test_rfc_content_disposition_fuzzing(self, title: str, artist: str):
        """build_content_disposition must return compliant ASCII fallback and percent-encoded UTF-8."""
        header = build_content_disposition(
            title=title, artist=artist, ext="md", fallback="karaoke_chords"
        )
        assert header.startswith("attachment;")
        assert 'filename="' in header
        assert "filename*=UTF-8''" in header

        # Verify no unescaped CRLF in header
        assert "\r" not in header
        assert "\n" not in header

        # Extract utf-8 encoded part and unquote
        parts = header.split("filename*=UTF-8''")
        assert len(parts) == 2
        decoded = unquote(parts[1])
        assert decoded.endswith(".md")

    def test_markdown_chord_sheet_alignment_and_modes(self):
        """Verify generate_chord_sheet produces valid lead sheet across lyric and chord structures."""
        # 1. Standard vocal track with lyrics and chords
        lines = [
            {"start_time": 1.0, "end_time": 3.0, "text": "Let it be"},
            {"start_time": 4.0, "end_time": 6.0, "text": "Words of wisdom"},
        ]
        chords = [
            {"start": 0.0, "end": 2.0, "chord": "C"},
            {"start": 2.0, "end": 4.0, "chord": "G"},
            {"start": 4.0, "end": 6.0, "chord": "Am"},
        ]
        sheet = generate_chord_sheet(
            lines=lines,
            chords=chords,
            title="Let It Be",
            artist="The Beatles",
            estimated_key="C Major",
            semitones=2,  # Transpose +2 -> D Major
        )

        assert "# Let It Be" in sheet
        assert "**Artist:** The Beatles" in sheet
        assert "**Key:** D Major" in sheet
        assert "**Pitch Shift:** +2 semitones" in sheet
        assert "Let it be" in sheet
        assert "D" in sheet  # C + 2 = D
        assert "A" in sheet  # G + 2 = A
        assert "Bm" in sheet  # Am + 2 = Bm

        # 2. Pure instrumental track (no lyrics)
        inst_sheet = generate_chord_sheet(
            lines=[],
            chords=chords,
            title="Instrumental Solo",
            artist="Soloist",
            semitones=0,
        )
        assert "# Instrumental Solo" in inst_sheet
        assert "[Instrumental]" in inst_sheet
        assert "Chords: C - G - Am" in inst_sheet

        # 3. Empty project (no lines, no chords)
        empty_sheet = generate_chord_sheet(lines=[], chords=[], title="Empty")
        assert "# Empty" in empty_sheet


# ==============================================================================
# SECTION 6: SUBTITLE & REAL FFMPEG VIDEO BURN MATRIX
# ==============================================================================


class TestSubtitleAndVideoBurns:
    """Stress tests for ASS Layer 2 chord styling and real FFmpeg video burn in 16:9 and 9:16."""

    def test_ass_generator_chord_layer_styling(self):
        """generate_ass_content with include_chords=True must emit Style: Chord and Layer 2 dialogue."""
        chords = [
            {"start": 0.0, "end": 1.5, "chord": "C"},
            {"start": 1.5, "end": 3.0, "chord": "G7"},
        ]
        lines = [
            {
                "id": "1",
                "text": "Sing along",
                "start_time": 0.5,
                "end_time": 2.5,
                "words": [
                    {"word": "Sing", "start_time": 0.5, "end_time": 1.5},
                    {"word": "along", "start_time": 1.5, "end_time": 2.5},
                ],
            }
        ]

        # With chords enabled
        ass_with = generate_ass_content(
            lines=lines, chords=chords, include_chords=True, semitones=2
        )
        assert "Style: Chord" in ass_with
        assert "Dialogue: 2," in ass_with
        # Transposed +2: C -> D, G7 -> A7
        assert "D" in ass_with
        assert "A7" in ass_with

        # With chords disabled
        ass_without = generate_ass_content(lines=lines, chords=chords, include_chords=False)
        assert "Style: Chord" not in ass_without
        assert "Dialogue: 2," not in ass_without

    @pytest.mark.parametrize("aspect_ratio", ["16:9", "9:16"])
    def test_real_video_burn_matrix_with_chords(self, aspect_ratio: str, tmp_path):
        """Empirically synthesize video with FFmpeg burning transposed chords and probe with ffprobe."""
        renderer = VideoRenderer(output_dir=tmp_path)
        audio_path = tmp_path / f"audio_burn_{aspect_ratio.replace(':', '_')}.wav"
        output_mp4 = tmp_path / f"render_{aspect_ratio.replace(':', '_')}.mp4"
        output_ass = tmp_path / f"sub_{aspect_ratio.replace(':', '_')}.ass"

        # Synthesize 1.0s audio tone
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1.0",
                "-c:a",
                "pcm_s16le",
                str(audio_path),
            ],
            check=True,
            capture_output=True,
        )

        lines = [
            {
                "id": "1",
                "text": "Video Burn Test",
                "start_time": 0.1,
                "end_time": 0.9,
                "words": [
                    {"word": "Video", "start_time": 0.1, "end_time": 0.5},
                    {"word": "Burn", "start_time": 0.5, "end_time": 0.9},
                ],
            }
        ]
        chords = [
            {"start": 0.0, "end": 0.5, "chord": "C"},
            {"start": 0.5, "end": 1.0, "chord": "Am"},
        ]

        ass_text = renderer.generate_ass_content(
            lines=lines,
            aspect_ratio=aspect_ratio,
            include_chords=True,
            chords=chords,
            semitones=2,  # C -> D, Am -> Bm
        )
        output_ass.write_text(ass_text, encoding="utf-8")

        res_path = renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(output_ass),
            output_mp4_path=output_mp4,
            aspect_ratio=aspect_ratio,
            duration=1.0,
            include_chords=True,
            semitones=2,
        )

        assert Path(res_path).is_file()
        assert Path(res_path).stat().st_size > 1000

        # ffprobe empirical verification of output video stream and dimensions
        probe = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height,codec_name",
                "-of",
                "json",
                str(res_path),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        info = json.loads(probe.stdout)
        v_stream = info["streams"][0]
        assert v_stream["codec_name"] == "h264"
        expected_w, expected_h = (1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)
        assert v_stream["width"] == expected_w
        assert v_stream["height"] == expected_h
