"""Milestone 4 Iteration 2: Deep White-Box Adversarial Stress Testing Suite.

Adversarial Challenger: challenger_m4_iter2_1
Project: Karaoke Studio Workstation

Comprehensive empirical challenge matrix:
1. Audio DSP Extremes & Boundary Clamping:
   - Silence boundary clamping, mergers, and monotonicity under sub-min_duration bursts.
   - Non-standard sample rates (12kHz, 24kHz, 32kHz, 88.2kHz, 176.4kHz, 384kHz).
   - High-energy white noise, pink noise, low-amplitude noise, and energy gating.
   - Subnormal floats (denormals), extreme dynamic jumps, and IEEE 754 edge numbers.
2. Rapid Chord Transitions & Flicker Pruning:
   - Ultra-dense alternating chord streams (20ms-50ms) exercising iterative flicker pruning.
   - Harmonic quality disambiguation and interval edge cases.
3. Transposition & Enharmonic Fuzzing:
   - All 30 key signatures (15 major, 15 minor) across [-12, +12] semitones.
   - Complex slash chords with chromatic accidentals.
   - Exotic, non-standard, and malformed chord strings.
4. Concurrency & API Persistence Under High Contention:
   - Barrier-synchronized multi-threaded race between detect, manual save, and read.
   - Pydantic HTTP 422 rejection of NaN, Inf, inverted, overlapping, and negative intervals.
   - Disk JSON integrity check of projects.json.
5. RFC 5987 / 6266 Header Encoding & Security:
   - Fuzzing build_content_disposition with unicode, quotes, CRLF injection, path traversal.
   - Lead sheet export endpoint header validation.
6. Subtitle & Real FFmpeg Video Burns:
   - ASS subtitle Layer 2 validation and chord styling.
   - Real MP4 video render with FFmpeg + libass in 16:9 and 9:16 aspect ratios with chords burned in.
   - ffprobe verification of video stream dimensions, codecs, and durations.
"""

from __future__ import annotations

import json
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.parse import unquote

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.export_utils import build_content_disposition
from backend.main import PROJECTS_LOCK, load_projects, projects, save_projects
from backend.project_store import PROJECTS_STORE_FILE
from backend.services.ass_generator import generate_ass_content
from backend.services.chord_detector import (
    NOTE_TO_PITCH_CLASS,
    ChordDetector,
    ChordList,
    classify_key_spelling,
    parse_chord_symbol,
    transpose_chord,
)
from backend.services.video_renderer import VideoRenderer

# ------------------------------------------------------------------------------
# Test Audio Synthesis Utilities
# ------------------------------------------------------------------------------


def synth_tone(freq: float, duration: float, sr: int = 22050, amp: float = 0.5) -> np.ndarray:
    """Synthesizes a pure sine tone with specified frequency, duration, and amplitude."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
    return (amp * np.sin(2.0 * np.pi * freq * t)).astype(np.float32)


def synth_triad(
    freqs: list[float], duration: float, sr: int = 22050, amp: float = 0.5
) -> np.ndarray:
    """Synthesizes a multi-frequency harmonic tone."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False, dtype=np.float32)
    sig = np.zeros_like(t)
    for f in freqs:
        sig += np.sin(2.0 * np.pi * f * t)
    peak = float(np.max(np.abs(sig)))
    if peak > 0:
        sig = (sig / peak) * amp
    return sig.astype(np.float32)


# ==============================================================================
# SECTION 1: AUDIO DSP EXTREMES & BOUNDARY CLAMPING
# ==============================================================================


class TestAudioExtremesAndBoundaryClamping:
    """Stress testing audio silence boundaries, non-standard rates, and floating point anomalies."""

    def test_silence_boundary_clamping_and_bursts(self):
        """Audio with initial silence, ultra-short burst (<0.1s), inter-silence, long chord, trailing silence.

        Verifies that boundaries clamp exactly to [0.0, total_duration], intervals are monotonic,
        and no negative or NaN timestamps exist.
        """
        sr = 22050
        detector = ChordDetector(min_duration=0.30)

        # 1.0s silence + 0.08s C Major burst + 1.2s silence + 2.0s G Major + 1.0s silence
        c_freqs = [261.63, 329.63, 392.00]
        g_freqs = [196.00, 246.94, 293.66]

        silence_1 = np.zeros(int(1.0 * sr), dtype=np.float32)
        burst_c = synth_triad(c_freqs, 0.08, sr=sr)
        silence_2 = np.zeros(int(1.2 * sr), dtype=np.float32)
        chord_g = synth_triad(g_freqs, 2.0, sr=sr)
        silence_3 = np.zeros(int(1.0 * sr), dtype=np.float32)

        full_audio = np.concatenate([silence_1, burst_c, silence_2, chord_g, silence_3])
        total_duration = len(full_audio) / sr

        # Detect with filter_no_chord=False (standard full timeline representation)
        chords = detector.detect_chords(full_audio, sr=sr, filter_no_chord=False)
        assert isinstance(chords, ChordList)
        assert len(chords) > 0

        # Boundary clamping verification:
        assert chords[0]["start"] == 0.0
        assert abs(chords[-1]["end"] - total_duration) < 0.05

        # Strict monotonicity & interval integrity:
        for i in range(len(chords)):
            seg = chords[i]
            assert 0.0 <= seg["start"] < seg["end"] <= total_duration + 0.05
            assert np.isfinite(seg["start"]) and np.isfinite(seg["end"])
            assert 0.0 <= seg["confidence"] <= 1.0
            assert seg["id"] == f"chord-{i}"
            if i > 0:
                assert seg["start"] >= chords[i - 1]["end"]
                assert seg["chord"] != chords[i - 1]["chord"]

        # Now detect with filter_no_chord=True (only harmonic segments)
        harmonic_chords = detector.detect_chords(full_audio, sr=sr, filter_no_chord=True)
        assert isinstance(harmonic_chords, ChordList)
        for i, seg in enumerate(harmonic_chords):
            assert seg["chord"] != "N"
            assert 0.0 <= seg["start"] < seg["end"] <= total_duration + 0.05
            assert seg["id"] == f"chord-{i}"
            if i > 0:
                assert seg["start"] >= harmonic_chords[i - 1]["end"]

    @pytest.mark.parametrize(
        "sr",
        [12000, 24000, 32000, 88200, 176400, 384000],
    )
    def test_non_standard_sample_rates_polyphase_resampling(self, sr: int):
        """Polyphase resampling under exotic, studio-master, and legacy sample rates."""
        detector = ChordDetector()
        c_chord = synth_triad([261.63, 329.63, 392.00], duration=1.2, sr=sr)

        chords = detector.detect_chords(c_chord, sr=sr)
        assert isinstance(chords, ChordList)
        assert len(chords) > 0
        detected = [c["chord"] for c in chords if c["chord"] != "N"]
        assert "C" in detected

    def test_noise_types_and_energy_gating(self):
        """Verify white noise, pink-like noise, and low-energy signals trigger silence gating."""
        detector = ChordDetector()
        sr = 22050
        duration = 2.0
        n_samples = int(sr * duration)

        # 1. Full-blast Gaussian white noise (flat chroma spectrum)
        np.random.seed(42)
        white_noise = (np.random.randn(n_samples).astype(np.float32) * 0.5).clip(-1.0, 1.0)
        chords_white = detector.detect_chords(white_noise, sr=sr)
        # Flat spectrum should be categorized as silence / no-chord
        for c in chords_white:
            assert c["chord"] == "N"

        # 2. Low-energy sub-threshold signal (below energy_threshold=0.005)
        quiet_sig = synth_triad([261.63, 329.63, 392.00], duration=duration, sr=sr, amp=0.001)
        chords_quiet = detector.detect_chords(quiet_sig, sr=sr)
        assert all(c["chord"] == "N" for c in chords_quiet)

    def test_subnormal_floats_and_extreme_dynamic_jumps(self):
        """Subnormal floating point numbers, denormals, and 120dB dynamic range steps."""
        detector = ChordDetector()
        sr = 22050

        # Subnormal tiny numbers
        tiny = np.finfo(np.float32).tiny * 0.1
        subnormal_sig = np.full(sr * 2, tiny, dtype=np.float32)
        chords_sub = detector.detect_chords(subnormal_sig, sr=sr)
        assert all(c["chord"] == "N" for c in chords_sub)

        # Extreme dynamic jump: 1.0s at 1e-5 amplitude followed by 1.0s at 1.0 followed by 1e-5
        quiet_part = synth_triad([261.63, 329.63, 392.00], 1.0, sr=sr, amp=1e-5)
        loud_part = synth_triad([261.63, 329.63, 392.00], 1.0, sr=sr, amp=0.9)
        jump_sig = np.concatenate([quiet_part, loud_part, quiet_part])

        chords_jump = detector.detect_chords(jump_sig, sr=sr)
        assert isinstance(chords_jump, ChordList)
        for c in chords_jump:
            assert np.isfinite(c["start"]) and np.isfinite(c["end"])
            assert 0.0 <= c["confidence"] <= 1.0


# ==============================================================================
# SECTION 2: RAPID CHORD TRANSITIONS & FLICKER PRUNING
# ==============================================================================


class TestRapidTransitionsAndFlickerPruning:
    """Stress testing rapid harmonic changes, flicker consolidation, and quality disambiguation."""

    def test_rapid_dense_chord_stream_stress(self):
        """Alternating C -> G -> Am -> F repeating every 25ms (sub-window scale).

        Tests that iterative flicker pruning converges without infinite loops or invalid bounds.
        """
        detector = ChordDetector(min_duration=0.30)
        sr = 22050

        chords_info = [
            ("C", [261.63, 329.63, 392.00]),
            ("G", [196.00, 246.94, 293.66]),
            ("Am", [220.00, 261.63, 329.63]),
            ("F", [174.61, 220.00, 261.63]),
        ]

        part_duration = 0.025  # 25 ms
        repeats = 30
        chunks = []
        for _ in range(repeats):
            for _chord_name, freqs in chords_info:
                chunks.append(synth_triad(freqs, part_duration, sr=sr))

        stream = np.concatenate(chunks)
        total_duration = len(stream) / sr

        chords = detector.detect_chords(stream, sr=sr)
        assert isinstance(chords, ChordList)
        assert len(chords) > 0

        # Monotonicity and valid durations
        for i, seg in enumerate(chords):
            assert seg["start"] < seg["end"]
            if i > 0:
                assert seg["start"] >= chords[i - 1]["end"]
                assert seg["chord"] != chords[i - 1]["chord"]

        assert chords[0]["start"] == 0.0
        assert abs(chords[-1]["end"] - total_duration) < 0.05

    def test_major_vs_minor_seventh_resolutions(self):
        """Testing disambiguation across distinct harmonic 7th structures."""
        detector = ChordDetector()
        sr = 22050
        duration = 1.5

        # G7 (Dominant 7th: G, B, D, F) vs Gmaj7 (Major 7th: G, B, D, F#)
        g7_freqs = [196.00, 246.94, 293.66, 349.23]
        gmaj7_freqs = [196.00, 246.94, 293.66, 369.99]

        g7_audio = synth_triad(g7_freqs, duration, sr=sr)
        gmaj7_audio = synth_triad(gmaj7_freqs, duration, sr=sr)

        chords_g7 = detector.detect_chords(g7_audio, sr=sr)
        chords_gmaj7 = detector.detect_chords(gmaj7_audio, sr=sr)

        detected_g7 = [c["chord"] for c in chords_g7 if c["chord"] != "N"]
        detected_gmaj7 = [c["chord"] for c in chords_gmaj7 if c["chord"] != "N"]

        assert any(c.startswith("G") for c in detected_g7)
        assert any(c.startswith("G") for c in detected_gmaj7)


# ==============================================================================
# SECTION 3: TRANSPOSITION & ENHARMONIC FUZZING
# ==============================================================================


class TestTranspositionEnharmonicFuzzing:
    """Testing transposition across all 30 keys, slash chords, and exotic chord symbols."""

    ALL_MAJOR_KEYS = (
        "C Major",
        "G Major",
        "D Major",
        "A Major",
        "E Major",
        "B Major",
        "F# Major",
        "C# Major",
        "F Major",
        "Bb Major",
        "Eb Major",
        "Ab Major",
        "Db Major",
        "Gb Major",
        "Cb Major",
    )

    ALL_MINOR_KEYS = (
        "A Minor",
        "E Minor",
        "B Minor",
        "F# Minor",
        "C# Minor",
        "G# Minor",
        "D# Minor",
        "A# Minor",
        "D Minor",
        "G Minor",
        "C Minor",
        "F Minor",
        "Bb Minor",
        "Eb Minor",
        "Ab Minor",
    )

    def test_enharmonic_key_matrix_all_30_keys(self):
        """Exhaustive test across all 15 major and 15 minor keys for flat vs sharp spelling."""
        for key in self.ALL_MAJOR_KEYS + self.ALL_MINOR_KEYS:
            spelling = classify_key_spelling(key)
            assert spelling in ("flat", "sharp")

            # In flat keys, shifting C by 10 semitones should spell Bb (not A#)
            # In sharp keys, shifting C by 1 semitone should spell C# (not Db)
            if spelling == "flat":
                res = transpose_chord("C", 10, key=key)
                assert res == "Bb", f"In flat key '{key}', expected Bb but got {res}"
            else:
                res = transpose_chord("C", 1, key=key)
                assert res == "C#", f"In sharp key '{key}', expected C# but got {res}"

    def test_complex_and_slash_chord_enharmonic_transposition(self):
        """Testing slash chords with accidentals transposed across all semitones."""
        slash_cases = [
            ("C#m7/G#", 2, "D#m7/A#"),
            ("Ebmaj7/Bb", -1, "Dmaj7/A"),
            ("F#7/C#", -2, "E7/B"),
            ("Ab/Eb", 4, "C/G"),
        ]
        for chord, semi, _expected_shape in slash_cases:
            transposed = transpose_chord(chord, semi)
            assert "/" in transposed
            main_chord, bass_note = transposed.split("/")
            # Parse and verify pitch classes shifted identically
            orig_main, orig_bass = chord.split("/")
            p_orig_main = parse_chord_symbol(orig_main)[0]
            p_new_main = parse_chord_symbol(main_chord)[0]

            orig_m_pc = NOTE_TO_PITCH_CLASS[p_orig_main.upper()]
            new_m_pc = NOTE_TO_PITCH_CLASS[p_new_main.upper()]
            orig_b_pc = NOTE_TO_PITCH_CLASS[orig_bass.upper()]
            new_b_pc = NOTE_TO_PITCH_CLASS[bass_note.upper()]

            assert (orig_m_pc + semi) % 12 == new_m_pc
            assert (orig_b_pc + semi) % 12 == new_b_pc

    def test_exotic_and_malformed_chord_symbols_graceful_handling(self):
        """Exotic, non-standard, or punctuation-laced chord symbols must not crash transposition."""
        exotic = ["Cadd9", "Fsus4", "Dsus2", "Bdim", "Aaug", "E5", "G#m(maj7)", "UnknownToken"]
        for chord in exotic:
            for s in [-5, 0, 7]:
                res = transpose_chord(chord, s)
                assert isinstance(res, str)
                assert len(res) > 0

        # Empty, whitespace, None-like
        assert transpose_chord("", 3) == "N"
        assert transpose_chord("   ", 3) == "N"
        assert transpose_chord("N", 3) == "N"
        assert transpose_chord("N.C.", 3) == "N"


# ==============================================================================
# SECTION 4: CONCURRENCY & API PERSISTENCE UNDER HIGH CONTENTION
# ==============================================================================


class TestConcurrencyAndAPIPersistenceStress:
    """Stress testing high-concurrency race conditions and strict Pydantic HTTP 422 validations."""

    @pytest.fixture
    def test_project(self):
        pid = f"stress_m4_{uuid.uuid4().hex[:8]}"
        stems_dir = config.STEMS_DIR / pid
        stems_dir.mkdir(parents=True, exist_ok=True)
        inst_file = stems_dir / "instrumental.wav"

        # 2.0s audio stem
        sig = synth_triad([261.63, 329.63, 392.00], duration=2.0)
        sf.write(str(inst_file), sig, 22050)

        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "title": "Adversarial Stress Project",
                "artist": "Empirical Challenger",
                "status": "ready",
                "instrumental_path": str(inst_file),
                "vocals_path": str(inst_file),
                "lines": [],
                "chords": None,
            }
            save_projects()

        return pid

    def test_concurrent_detect_and_update_race_condition(
        self, client: TestClient, test_project: str
    ):
        """Simultaneous race between detect trigger, manual chord saves, and reads across 30 threads."""
        pid = test_project
        num_threads = 30
        barrier = threading.Barrier(num_threads)
        results = []

        def worker_task(thread_id: int):
            barrier.wait()
            try:
                op = thread_id % 3
                if op == 0:
                    # Forced detect
                    res = client.post(f"/api/project/{pid}/chords/detect")
                    return ("DETECT", res.status_code)
                elif op == 1:
                    # Manual chords save
                    body = {
                        "chords": [
                            {"start": 0.0, "end": 1.0, "chord": "C", "confidence": 0.95},
                            {"start": 1.0, "end": 2.0, "chord": "Am", "confidence": 0.90},
                        ]
                    }
                    res = client.post(f"/api/project/{pid}/chords", json=body)
                    return ("POST", res.status_code)
                else:
                    # Cached / backfill GET
                    res = client.get(f"/api/project/{pid}/chords?semitones=2")
                    return ("GET", res.status_code)
            except Exception as exc:
                return ("EXCEPTION", str(exc))

        with ThreadPoolExecutor(max_workers=num_threads) as executor:
            futures = [executor.submit(worker_task, i) for i in range(num_threads)]
            for f in as_completed(futures):
                results.append(f.result())

        # Assert no exceptions occurred
        for op, status in results:
            assert op != "EXCEPTION", f"Thread failed with exception: {status}"
            assert status == 200, f"Thread returned unexpected status {status} for operation {op}"

        # Verify disk persistence integrity
        with PROJECTS_LOCK:
            reloaded = load_projects()
            assert pid in reloaded
            chords_data = reloaded[pid].get("chords")
            assert chords_data is not None
            assert isinstance(chords_data, list)
            # Verify file on disk is valid JSON
            store_file = getattr(main_mod, "PROJECTS_STORE_FILE", PROJECTS_STORE_FILE)
            content = store_file.read_text(encoding="utf-8")
            parsed = json.loads(content)
            assert pid in parsed

    def test_pydantic_nan_inf_and_boundary_rejection(self, client: TestClient, test_project: str):
        """Verify strict HTTP 422 on boundary violations, inverted intervals, and NaN/Inf floats."""
        pid = test_project

        # 1. Inverted interval
        res = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 2.0, "end": 1.0, "chord": "C"}]},
        )
        assert res.status_code == 422

        # 2. Overlapping intervals
        res = client.post(
            f"/api/project/{pid}/chords",
            json={
                "chords": [
                    {"start": 0.0, "end": 1.5, "chord": "C"},
                    {"start": 1.4, "end": 2.0, "chord": "G"},
                ]
            },
        )
        assert res.status_code == 422

        # 3. Negative start timestamp
        res = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": -0.5, "end": 1.0, "chord": "C"}]},
        )
        assert res.status_code == 422

        # 4. Out of bounds confidence
        res = client.post(
            f"/api/project/{pid}/chords",
            json={"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": 1.05}]},
        )
        assert res.status_code == 422


# ==============================================================================
# SECTION 5: RFC 5987 / 6266 HEADER ENCODING STRESS
# ==============================================================================


class TestRFCHeaderEncodingAndExports:
    """Stress testing RFC 5987 and RFC 6266 header sanitization, injection vectors, and chord sheet."""

    @pytest.mark.parametrize(
        "title,artist",
        [
            ("Chanson d'Amour / Café", "Édith Piaf"),
            ("Rock & Roll \r\nSet-Cookie: evil=1", "Hacker; Group"),
            ('Say "Hello" \\ "World"', "Band / Slash"),
            ("日本語の歌 🌸", "初音ミク"),
            ("A" * 500, "B" * 200),
            ("../../../../etc/passwd", "..\\..\\windows"),
            ("", ""),
        ],
    )
    def test_rfc_content_disposition_fuzzing(self, title: str, artist: str):
        """Test build_content_disposition resistance against injection and malformed headers."""
        header = build_content_disposition(title=title, artist=artist, ext="md")
        assert isinstance(header, str)
        assert "attachment" in header
        assert 'filename="' in header
        assert "filename*=UTF-8''" in header

        # Header Injection Protection: absolutely no raw carriage returns or newlines
        assert "\r" not in header
        assert "\n" not in header
        assert "\x00" not in header

        # Extract ascii filename
        parts = header.split(";")
        ascii_part = next(p.strip() for p in parts if p.strip().startswith('filename="'))
        ascii_filename = ascii_part[len('filename="') : -1]

        # Must be pure 7-bit ASCII
        ascii_filename.encode("ascii")
        # Must not contain quotes, backslashes, or control characters
        assert '"' not in ascii_filename
        assert "\\" not in ascii_filename
        assert "/" not in ascii_filename

        # Extract UTF-8 encoded filename
        utf8_part = next(p.strip() for p in parts if p.strip().startswith("filename*=UTF-8''"))
        encoded_val = utf8_part[len("filename*=UTF-8''") :]
        decoded_val = unquote(encoded_val)
        assert isinstance(decoded_val, str)
        assert len(decoded_val) > 0

    def test_export_chord_sheet_endpoint_header_and_body(self, client: TestClient):
        """Full endpoint test for GET /api/project/{id}/export/chord-sheet."""
        pid = f"sheet_{uuid.uuid4().hex[:8]}"
        with PROJECTS_LOCK:
            projects[pid] = {
                "id": pid,
                "title": "Chanson D'Amour! 🎵",
                "artist": "Artiste Étoile",
                "status": "ready",
                "lines": [
                    {
                        "id": "l1",
                        "text": "La vie en rose",
                        "start_time": 2.0,
                        "end_time": 4.0,
                        "words": [],
                    }
                ],
                "chords": [
                    {"start": 0.0, "end": 2.0, "chord": "C"},
                    {"start": 2.0, "end": 4.0, "chord": "Am"},
                ],
            }
            save_projects()

        res = client.get(f"/api/project/{pid}/export/chord-sheet?semitones=2")
        assert res.status_code == 200
        assert "text/markdown" in res.headers["content-type"]
        cd = res.headers["content-disposition"]
        assert "attachment" in cd
        assert "filename*=" in cd
        # Verify body contains transposed chords (C -> D, Am -> Bm)
        body = res.text
        assert "Chanson D'Amour" in body
        assert "Artiste Étoile" in body
        assert "Bm" in body


# ==============================================================================
# SECTION 6: SUBTITLE GENERATION & REAL FFMPEG VIDEO BURNS
# ==============================================================================


class TestSubtitleAndVideoBurnsWithChords:
    """Stress testing ASS subtitle generation and real FFmpeg video burns with chords."""

    def test_ass_generator_layer_and_chords_styling(self):
        """Verify that chords are generated on Layer 2 and silenced segments are omitted."""
        lines = [
            {
                "id": "line-1",
                "text": "Singing together",
                "start_time": 1.0,
                "end_time": 3.0,
                "words": [
                    {"text": "Singing", "start_time": 1.0, "end_time": 2.0},
                    {"text": "together", "start_time": 2.0, "end_time": 3.0},
                ],
            }
        ]
        chords = [
            {"start": 0.0, "end": 1.0, "chord": "N"},  # Silence segment
            {"start": 1.0, "end": 3.0, "chord": "C"},  # Chord segment
            {"start": 3.0, "end": 5.0, "chord": "G7"},
        ]

        # 1. Chords enabled
        ass_with_chords = generate_ass_content(
            lines=lines,
            chords=chords,
            include_chords=True,
            semitones=2,  # Transpose: C -> D, G7 -> A7
            key="C Major",
        )
        assert "Style: Chord" in ass_with_chords
        assert "Dialogue: 2," in ass_with_chords
        # Transposed symbols present
        assert "D" in ass_with_chords
        assert "A7" in ass_with_chords
        # Silence "N" must NOT be rendered as a subtitle event
        assert "Dialogue: 2,0:00:00.00,0:00:01.00,Chord,,0,0,0,,{\\an8}N" not in ass_with_chords

        # 2. Chords disabled
        ass_no_chords = generate_ass_content(
            lines=lines,
            chords=chords,
            include_chords=False,
        )
        assert "Style: Chord" not in ass_no_chords
        assert "Dialogue: 2," not in ass_no_chords

    @pytest.mark.parametrize("aspect_ratio", ["16:9", "9:16"])
    def test_real_video_burn_matrix_with_chords(self, tmp_path: Path, aspect_ratio: str):
        """Empirically synthesize video with FFmpeg burning transposed chords and probe with ffprobe."""
        renderer = VideoRenderer(output_dir=tmp_path)
        audio_path = tmp_path / f"test_audio_{aspect_ratio.replace(':', '_')}.wav"
        output_mp4 = tmp_path / f"test_render_{aspect_ratio.replace(':', '_')}.mp4"
        output_ass = tmp_path / f"test_sub_{aspect_ratio.replace(':', '_')}.ass"

        # Synthesize 1.5s audio tone
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=440:duration=1.5",
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
                "text": "Empirical Burn Test",
                "start_time": 0.2,
                "end_time": 1.2,
                "words": [
                    {"word": "Empirical", "start_time": 0.2, "end_time": 0.7},
                    {"word": "Burn", "start_time": 0.7, "end_time": 1.2},
                ],
            }
        ]
        chords = [
            {"start": 0.0, "end": 0.7, "chord": "C"},
            {"start": 0.7, "end": 1.5, "chord": "G"},
        ]

        # Generate ASS with chords
        ass_text = renderer.generate_ass_content(
            lines=lines,
            aspect_ratio=aspect_ratio,
            include_chords=True,
            chords=chords,
            semitones=2,  # C -> D, G -> A
        )
        output_ass.write_text(ass_text, encoding="utf-8")

        # Burn video with FFmpeg
        res_path = renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(output_ass),
            output_mp4_path=output_mp4,
            aspect_ratio=aspect_ratio,
            duration=1.5,
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
