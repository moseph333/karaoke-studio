"""Adversarial Fuzzing, Auto-Backfill, and Monotonicity Challenger Test Suite.

Milestone: Milestone 1 Iteration 4
Agent: Challenger 2 (API Fuzzing, Auto-Backfill & Monotonicity Challenger)

Scope of Challenge:
1. Systematic Fuzzing of POST /api/project/{id}/chords:
   - Inverted timestamps (start > end, sub-millisecond inversions, extreme bounds)
   - Zero durations (start == end, origin, non-zero timestamps, intra-sequence)
   - Negative start timestamps (microscopic underflow, large negatives, negative ends)
   - Sub-millisecond and microscopic overlaps (epsilons down to 1e-7s, full enclosures, reverse order)
   - Non-finite floats (NaN, +Infinity, -Infinity as strings and raw JSON bytes tokens)
   - Non-numeric types (strings, lists, dicts, nulls, invalid confidence, whitespace/overlong chord symbols)
   - Malformed root payloads (non-dict roots, malformed chords arrays, truncated JSON bytes, binary junk)
   - Verification that ALL invalid payloads return strictly HTTP 422 with structured error details (NEVER HTTP 500).
2. Auto-Backfill & Monotonicity Verification:
   - End-to-end auto-backfill on synthetic multi-harmonic WAV signals verifies strict monotonicity:
     0.0 <= start < end and end_{i-1} <= start_i for all segments.
   - Auto-backfill on pure silence audio produces monotonic or empty chords without NaN/Inf.
   - Auto-backfill error handling on missing/0-byte stems strictly returns HTTP 400 (never HTTP 500).
   - Semitones transposition parameter fuzzing on GET /api/project/{id}/chords strictly rejects out-of-bounds
     or malformed values with HTTP 422.
3. Check-Then-Act Race Condition Verification (Worker Remediation):
   - In-flight auto-backfill never clobbers concurrent POST updates (both custom chords and empty [] chords).
4. Scale & Stress:
   - 2,000 monotonic chord segments accepted with HTTP 200 and persisted cleanly.
   - Single microscopic overlap at index 1,999 cleanly rejected with HTTP 422 and structured details.
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend import config
from backend.main import PROJECTS_LOCK, projects, save_projects
from backend.schemas import ChordSegmentSchema, ChordsUpdateRequest

# ==============================================================================
# Helper Verification Functions & Fixtures
# ==============================================================================


def create_synthetic_audio(
    file_path: Path,
    duration: float = 3.0,
    sr: int = 22050,
    freq: float = 440.0,
    silent: bool = False,
) -> Path:
    """Creates a deterministic synthetic WAV file for hermetic testing."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    n_samples = int(sr * duration)
    if silent or n_samples == 0:
        data = np.zeros(n_samples, dtype=np.float32)
    else:
        t = np.linspace(0, duration, n_samples, endpoint=False)
        data = (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    sf.write(str(file_path), data, sr)
    return file_path


@pytest.fixture
def test_project(tmp_path: Path):
    """Sets up a clean ready project with a synthetic instrumental stem."""
    pid = "m1_iter4_fuzz_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    inst_file = stems_dir / "instrumental.wav"
    create_synthetic_audio(inst_file, duration=4.0, sr=22050, freq=440.0)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "progress": 100,
            "title": "Iteration 4 Fuzzing Test Track",
            "artist": "Challenger 2",
            "instrumental_path": str(inst_file),
            "vocals_path": str(inst_file),
            "vocal_range": {"estimated_key": "C Major"},
            "chords": None,
        }
        save_projects()

    return pid, inst_file


def assert_structured_422(res) -> None:
    """Verifies that an HTTP response is strictly 422 with a structured error details list (never 500)."""
    assert res.status_code == 422, (
        f"Expected strictly HTTP 422, but received HTTP {res.status_code}. Body: {res.text}"
    )
    assert res.status_code != 500, "CRITICAL DEFECT: Endpoint raised unhandled HTTP 500"
    data = res.json()
    assert "detail" in data, f"Missing 'detail' in 422 error response: {data}"
    detail = data["detail"]
    assert isinstance(detail, list), (
        f"Expected 'detail' to be a list of error objects, got {type(detail)}: {detail}"
    )
    assert len(detail) > 0, "Expected at least one structured error detail item in 422 response"
    for item in detail:
        assert isinstance(item, dict), (
            f"Expected error detail item to be dict, got {type(item)}: {item}"
        )
        assert "loc" in item, f"Error detail item missing 'loc': {item}"
        assert "msg" in item, f"Error detail item missing 'msg': {item}"
        assert "type" in item, f"Error detail item missing 'type': {item}"


# ==============================================================================
# 1. FUZZING: Inverted Timestamps (start > end)
# ==============================================================================


@pytest.mark.parametrize(
    "start,end,case_name",
    [
        (2.0, 1.0, "simple_inverted"),
        (1.00001, 1.0, "sub_ms_inverted"),
        (1.0 + 1e-9, 1.0, "float_epsilon_inverted"),
        (86400.0, 0.0, "max_bound_inverted"),
        (500.0, 499.999, "large_sub_ms_inverted"),
        (-1.0, -2.0, "negative_inverted"),
    ],
)
def test_fuzz_inverted_timestamps_strictly_returns_422(
    client: TestClient, test_project, start: float, end: float, case_name: str
):
    """POST /api/project/{id}/chords with inverted timestamps must return strictly HTTP 422 with structured detail."""
    pid, _ = test_project
    payload = {"chords": [{"start": start, "end": end, "chord": "C"}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)


def test_fuzz_inverted_timestamps_deep_in_sequence(client: TestClient, test_project):
    """POST /api/project/{id}/chords with an inverted timestamp in the middle of valid chords."""
    pid, _ = test_project
    payload = {
        "chords": [
            {"start": 0.0, "end": 1.0, "chord": "C"},
            {"start": 1.0, "end": 2.0, "chord": "G"},
            {"start": 5.0, "end": 3.0, "chord": "Am"},  # Inverted!
            {"start": 6.0, "end": 7.0, "chord": "F"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)


# ==============================================================================
# 2. FUZZING: Zero Durations (start == end)
# ==============================================================================


@pytest.mark.parametrize(
    "timestamp,case_name",
    [
        (0.0, "origin_zero_duration"),
        (1.0, "integer_zero_duration"),
        (123.456789, "fractional_zero_duration"),
        (86400.0, "max_boundary_zero_duration"),
    ],
)
def test_fuzz_zero_duration_strictly_returns_422(
    client: TestClient, test_project, timestamp: float, case_name: str
):
    """POST /api/project/{id}/chords with zero duration (start == end) must return strictly HTTP 422."""
    pid, _ = test_project
    payload = {"chords": [{"start": timestamp, "end": timestamp, "chord": "Dm"}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)


def test_fuzz_zero_duration_in_sequence(client: TestClient, test_project):
    """POST /api/project/{id}/chords with a zero duration segment within a list of valid chords."""
    pid, _ = test_project
    payload = {
        "chords": [
            {"start": 0.0, "end": 1.0, "chord": "C"},
            {"start": 1.0, "end": 1.0, "chord": "G"},  # Zero duration
            {"start": 1.0, "end": 2.0, "chord": "Am"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)


# ==============================================================================
# 3. FUZZING: Negative Start Timestamps
# ==============================================================================


@pytest.mark.parametrize(
    "start,end,case_name",
    [
        (-1e-9, 1.0, "sub_nano_negative_start"),
        (-1e-6, 1.0, "sub_micro_negative_start"),
        (-0.001, 1.0, "sub_milli_negative_start"),
        (-1.0, 1.0, "negative_one_start"),
        (-1000.0, 1.0, "large_negative_start"),
        (-1e20, 1.0, "extreme_negative_start"),
        (0.0, -1.0, "negative_end"),
        (-5.0, -2.0, "both_negative"),
    ],
)
def test_fuzz_negative_timestamps_strictly_returns_422(
    client: TestClient, test_project, start: float, end: float, case_name: str
):
    """POST /api/project/{id}/chords with negative start/end timestamps must return strictly HTTP 422."""
    pid, _ = test_project
    payload = {"chords": [{"start": start, "end": end, "chord": "Em"}]}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)


# ==============================================================================
# 4. FUZZING: Sub-Millisecond & Microscopic Overlaps
# ==============================================================================


@pytest.mark.parametrize(
    "epsilon",
    [1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 1e-7],
)
def test_fuzz_sub_millisecond_overlaps_strictly_returns_422(
    client: TestClient, test_project, epsilon: float
):
    """Consecutive chord intervals where chord[0].end exceeds chord[1].start by epsilon must reject with 422."""
    pid, _ = test_project
    payload = {
        "chords": [
            {"start": 0.0, "end": 1.0 + epsilon, "chord": "C"},
            {"start": 1.0, "end": 2.0, "chord": "G"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)
    assert "Overlapping or non-monotonic" in str(res.json()["detail"])


@pytest.mark.parametrize(
    "epsilon",
    [1e-1, 1e-3, 1e-5, 1e-7],
)
def test_fuzz_sub_millisecond_start_underflow_overlaps_strictly_returns_422(
    client: TestClient, test_project, epsilon: float
):
    """Consecutive chord intervals where chord[1].start precedes chord[0].end by epsilon must reject with 422."""
    pid, _ = test_project
    payload = {
        "chords": [
            {"start": 0.0, "end": 1.0, "chord": "C"},
            {"start": 1.0 - epsilon, "end": 2.0, "chord": "G"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)
    assert "Overlapping or non-monotonic" in str(res.json()["detail"])


def test_fuzz_microscopic_overlap_deep_in_chain(client: TestClient, test_project):
    """100-segment progression with a microscopic 0.0001s overlap at index 73."""
    pid, _ = test_project
    chords = [{"start": float(i), "end": float(i + 1), "chord": "C"} for i in range(100)]
    # Overlap at index 73
    chords[73]["end"] = 74.0001
    payload = {"chords": chords}
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert_structured_422(res)
    assert "Overlapping or non-monotonic" in str(res.json()["detail"])


def test_exact_abutting_chords_accepted_as_valid_monotonic(client: TestClient, test_project):
    """Exact boundary abutting (end_i == start_{i+1}) is strictly monotonic and MUST return HTTP 200."""
    pid, _ = test_project
    payload = {
        "chords": [
            {"start": 0.0, "end": 1.5, "chord": "C"},
            {"start": 1.5, "end": 3.0, "chord": "Am"},
            {"start": 3.0, "end": 4.5, "chord": "F"},
            {"start": 4.5, "end": 6.0, "chord": "G7"},
        ]
    }
    res = client.post(f"/api/project/{pid}/chords", json=payload)
    assert res.status_code == 200, f"Expected 200, got {res.status_code}: {res.text}"
    assert res.json()["chords_count"] == 4


def test_fuzz_full_interval_containment_and_reversal(client: TestClient, test_project):
    """Enclosure ([1.0, 10.0] containing [2.0, 3.0]) and reverse order ([5.0, 6.0] before [1.0, 2.0])."""
    pid, _ = test_project

    # Enclosure
    res_enc = client.post(
        f"/api/project/{pid}/chords",
        json={
            "chords": [
                {"start": 1.0, "end": 10.0, "chord": "C"},
                {"start": 2.0, "end": 3.0, "chord": "G"},
            ]
        },
    )
    assert_structured_422(res_enc)

    # Reversal
    res_rev = client.post(
        f"/api/project/{pid}/chords",
        json={
            "chords": [
                {"start": 5.0, "end": 6.0, "chord": "C"},
                {"start": 1.0, "end": 2.0, "chord": "G"},
            ]
        },
    )
    assert_structured_422(res_rev)


# ==============================================================================
# 5. FUZZING: Non-Finite Floats (NaN, +Infinity, -Infinity)
# ==============================================================================


@pytest.mark.parametrize(
    "field,value",
    [
        ("start", "NaN"),
        ("start", "nan"),
        ("start", "Infinity"),
        ("start", "+Infinity"),
        ("start", "-Infinity"),
        ("end", "NaN"),
        ("end", "Infinity"),
        ("end", "-Infinity"),
        ("confidence", "NaN"),
        ("confidence", "Infinity"),
        ("confidence", "-Infinity"),
    ],
)
def test_fuzz_non_finite_float_strings_strictly_returns_422(
    client: TestClient, test_project, field: str, value: str
):
    """Non-finite float string tokens in start, end, or confidence must return HTTP 422 (never 500)."""
    pid, _ = test_project
    chord_dict: dict[str, Any] = {"start": 0.0, "end": 1.0, "chord": "C"}
    chord_dict[field] = value
    res = client.post(f"/api/project/{pid}/chords", json={"chords": [chord_dict]})
    assert_structured_422(res)


@pytest.mark.parametrize(
    "raw_json_bytes,case_name",
    [
        (b'{"chords": [{"start": NaN, "end": 2.0, "chord": "C"}]}', "raw_nan_start"),
        (b'{"chords": [{"start": 0.0, "end": NaN, "chord": "C"}]}', "raw_nan_end"),
        (b'{"chords": [{"start": Infinity, "end": 2.0, "chord": "C"}]}', "raw_inf_start"),
        (b'{"chords": [{"start": 0.0, "end": Infinity, "chord": "C"}]}', "raw_inf_end"),
        (b'{"chords": [{"start": -Infinity, "end": 2.0, "chord": "C"}]}', "raw_neginf_start"),
        (
            b'{"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": NaN}]}',
            "raw_nan_conf",
        ),
        (
            b'{"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": Infinity}]}',
            "raw_inf_conf",
        ),
        (b'{"chords": [{"start": 1e999, "end": 2.0, "chord": "C"}]}', "raw_overflow_float_start"),
        (b'{"chords": [{"start": 0.0, "end": 1e999, "chord": "C"}]}', "raw_overflow_float_end"),
    ],
)
def test_fuzz_raw_bytes_non_finite_and_overflow_floats_strictly_returns_422(
    client: TestClient, test_project, raw_json_bytes: bytes, case_name: str
):
    """Raw byte non-finite / float overflow tokens must return strictly HTTP 422 with structured detail (never 500)."""
    pid, _ = test_project
    res = client.post(
        f"/api/project/{pid}/chords",
        content=raw_json_bytes,
        headers={"Content-Type": "application/json"},
    )
    assert_structured_422(res)


# ==============================================================================
# 6. FUZZING: Non-Numeric Types & Malformed Payloads
# ==============================================================================


@pytest.mark.parametrize(
    "bad_payload,case_name",
    [
        # Non-numeric timestamps
        ({"chords": [{"start": "not_a_num", "end": 1.0, "chord": "C"}]}, "start_string"),
        ({"chords": [{"start": [1, 2], "end": 1.0, "chord": "C"}]}, "start_list"),
        ({"chords": [{"start": {"time": 0.0}, "end": 1.0, "chord": "C"}]}, "start_dict"),
        ({"chords": [{"start": None, "end": 1.0, "chord": "C"}]}, "start_null"),
        ({"chords": [{"start": 0.0, "end": "not_a_num", "chord": "C"}]}, "end_string"),
        ({"chords": [{"start": 0.0, "end": [2.0], "chord": "C"}]}, "end_list"),
        ({"chords": [{"start": 0.0, "end": {"time": 1.0}, "chord": "C"}]}, "end_dict"),
        ({"chords": [{"start": 0.0, "end": None, "chord": "C"}]}, "end_null"),
        # Invalid confidence
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": "high"}]},
            "conf_string",
        ),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": [0.5]}]}, "conf_list"),
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": 1.00001}]},
            "conf_out_of_bounds_high",
        ),
        (
            {"chords": [{"start": 0.0, "end": 1.0, "chord": "C", "confidence": -0.00001}]},
            "conf_out_of_bounds_low",
        ),
        # Non-string or invalid chord symbols
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": 123}]}, "chord_integer"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": None}]}, "chord_null"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": []}]}, "chord_list"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": {}}]}, "chord_dict"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": ""}]}, "chord_empty_string"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": "   \t\n"}]}, "chord_whitespace_only"),
        ({"chords": [{"start": 0.0, "end": 1.0, "chord": "A" * 33}]}, "chord_overlong_length_33"),
        # Invalid id types
        ({"chords": [{"id": [1, 2], "start": 0.0, "end": 1.0, "chord": "C"}]}, "id_list"),
        ({"chords": [{"id": {"key": 1}, "start": 0.0, "end": 1.0, "chord": "C"}]}, "id_dict"),
        # Timestamp limits > 86400.0s (24h)
        ({"chords": [{"start": 86401.0, "end": 86405.0, "chord": "C"}]}, "start_exceeds_24h"),
        ({"chords": [{"start": 0.0, "end": 86400.001, "chord": "C"}]}, "end_exceeds_24h"),
        # Malformed root payloads
        ("not_a_json_dict", "root_is_string"),
        (12345, "root_is_int"),
        ([], "root_is_empty_list"),
        ([{"start": 0.0, "end": 1.0, "chord": "C"}], "root_is_chord_list"),
        ({"chords": "not_a_list"}, "chords_field_is_string"),
        ({"chords": 42}, "chords_field_is_int"),
        ({"chords": None}, "chords_field_is_null"),
        ({"chords": {}}, "chords_field_is_dict"),
        ({"chords": [None]}, "chords_contains_null"),
        ({"chords": [123]}, "chords_contains_int"),
        ({"chords": ["C"]}, "chords_contains_string"),
        ({"chords": [{}]}, "chords_contains_empty_dict"),
    ],
)
def test_fuzz_non_numeric_and_malformed_payloads_strictly_returns_422(
    client: TestClient, test_project, bad_payload: Any, case_name: str
):
    """All non-numeric types and malformed schemas must return strictly HTTP 422 with structured details."""
    pid, _ = test_project
    res = client.post(f"/api/project/{pid}/chords", json=bad_payload)
    assert_structured_422(res)


@pytest.mark.parametrize(
    "malformed_bytes,case_name",
    [
        (b'{"chords": [', "truncated_array"),
        (b'{"chords": {"start": 0', "truncated_dict"),
        (b"{", "single_open_brace"),
        (b"", "empty_bytes"),
        (b"\x00\x01\x02\xff", "binary_junk"),
        (b"not json at all", "plain_text_junk"),
    ],
)
def test_fuzz_syntax_malformed_bytes_strictly_returns_422(
    client: TestClient, test_project, malformed_bytes: bytes, case_name: str
):
    """Syntactically broken JSON payloads must return strictly HTTP 422 with structured detail (never 500)."""
    pid, _ = test_project
    res = client.post(
        f"/api/project/{pid}/chords",
        content=malformed_bytes,
        headers={"Content-Type": "application/json"},
    )
    assert_structured_422(res)


# ==============================================================================
# 7. AUTO-BACKFILL & MONOTONICITY INDUCTION VERIFICATION
# ==============================================================================


def test_auto_backfill_produces_strictly_monotonic_intervals(client: TestClient, test_project):
    """GET /api/project/{id}/chords triggers CPU-bound detector and returns strictly monotonic intervals."""
    pid, _ = test_project
    # Pre-condition: project chords is None
    assert projects[pid]["chords"] is None

    res = client.get(f"/api/project/{pid}/chords")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["project_id"] == pid
    assert data["detected"] is True
    chords = data["chords"]
    assert len(chords) > 0, "Expected non-empty detected chords from synthetic 440Hz stem"

    # Verify strict interval monotonicity on every detected segment
    for i, seg in enumerate(chords):
        start = float(seg["start"])
        end = float(seg["end"])
        chord = seg["chord"]
        assert not np.isnan(start) and not np.isnan(end)
        assert not np.isinf(start) and not np.isinf(end)
        assert start >= 0.0, f"Segment {i} has negative start: {start}"
        assert start < end, f"Segment {i} violates start < end: [{start}, {end}]"
        assert isinstance(chord, str) and len(chord) > 0

        if i > 0:
            prev_end = float(chords[i - 1]["end"])
            assert prev_end <= start, (
                f"Auto-backfill segment {i} overlaps previous segment: prev_end={prev_end} > curr_start={start}"
            )

    # Verify persistence: store now has populated chords
    assert projects[pid]["chords"] is not None
    assert len(projects[pid]["chords"]) == len(chords)


def test_auto_backfill_on_pure_silence_produces_monotonic_chords(
    tmp_path: Path, client: TestClient
):
    """GET /api/project/{id}/chords on silent stem succeeds without NaN/Inf and remains monotonic."""
    pid = "silent_fuzz_proj"
    stems_dir = config.STEMS_DIR / pid
    stems_dir.mkdir(parents=True, exist_ok=True)
    inst_file = stems_dir / "instrumental.wav"
    create_synthetic_audio(inst_file, duration=3.0, sr=22050, silent=True)

    with PROJECTS_LOCK:
        projects[pid] = {
            "id": pid,
            "track_id": pid,
            "status": "ready",
            "progress": 100,
            "title": "Silent Fuzz Track",
            "artist": "Challenger 2",
            "instrumental_path": str(inst_file),
            "vocals_path": str(inst_file),
            "chords": None,
        }
        save_projects()

    res = client.get(f"/api/project/{pid}/chords")
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["detected"] is True

    # Any returned chords must satisfy strict monotonicity
    for i, seg in enumerate(data["chords"]):
        start = float(seg["start"])
        end = float(seg["end"])
        assert start >= 0.0 and start < end
        if i > 0:
            assert float(data["chords"][i - 1]["end"]) <= start


def test_auto_backfill_missing_or_empty_stem_returns_400_not_500(client: TestClient, test_project):
    """Auto-backfill on missing or 0-byte audio stem must return HTTP 400 (never HTTP 500)."""
    pid, inst_file = test_project

    # Case A: Missing stem file
    inst_file.unlink(missing_ok=True)
    with PROJECTS_LOCK:
        projects[pid]["chords"] = None
        save_projects()

    res_missing = client.get(f"/api/project/{pid}/chords")
    assert res_missing.status_code == 400
    assert res_missing.status_code != 500
    assert "missing or not ready" in res_missing.json()["detail"]

    # Case B: 0-byte stem file
    inst_file.write_bytes(b"")
    res_empty = client.get(f"/api/project/{pid}/chords")
    assert res_empty.status_code == 400
    assert res_empty.status_code != 500
    assert "missing or not ready" in res_empty.json()["detail"]


@pytest.mark.parametrize(
    "invalid_semitones",
    [-100, -13, 13, 100, "abc", "1.5", "NaN", "Infinity"],
)
def test_get_chords_semitones_parameter_fuzzing_strictly_returns_422(
    client: TestClient, test_project, invalid_semitones: Any
):
    """GET /api/project/{id}/chords?semitones=X strictly returns HTTP 422 on invalid semitones (never 500)."""
    pid, _ = test_project
    res = client.get(f"/api/project/{pid}/chords?semitones={invalid_semitones}")
    assert res.status_code == 422, f"Expected 422, got {res.status_code}: {res.text}"
    assert res.status_code != 500
    data = res.json()
    assert "detail" in data
    # detail can be a structured list (FastAPI int parser error) or descriptive string (range guard)
    detail = data["detail"]
    assert isinstance(detail, (list, str)) and len(detail) > 0


@pytest.mark.parametrize("valid_semitones", [-12, -7, 0, 5, 12])
def test_get_chords_valid_semitones_accepted(
    client: TestClient, test_project, valid_semitones: int
):
    """GET /api/project/{id}/chords?semitones=X accepts valid semitones in [-12, 12]."""
    pid, _ = test_project
    # Pre-populate chords
    client.post(
        f"/api/project/{pid}/chords",
        json={"chords": [{"start": 0.0, "end": 1.0, "chord": "C"}]},
    )
    res = client.get(f"/api/project/{pid}/chords?semitones={valid_semitones}")
    assert res.status_code == 200
    assert len(res.json()["chords"]) == 1


# ==============================================================================
# 8. CHECK-THEN-ACT RACE CONDITION VERIFICATION (Worker Remediation)
# ==============================================================================


def test_race_condition_get_backfill_does_not_clobber_concurrent_post_custom(
    client: TestClient, test_project, monkeypatch
):
    """Verifies worker's fix: in-flight auto-backfill never overwrites concurrent POST with custom chords."""
    pid, _ = test_project

    # Create a slow detector mock that blocks inside detect_chords until signaled
    detector_started = threading.Event()
    post_completed = threading.Event()

    class SlowDetector:
        def detect_chords(self, audio_path, **kwargs):
            detector_started.set()
            # Wait for concurrent POST to complete before finishing detection
            post_completed.wait(timeout=5.0)
            return [
                {"id": "auto-0", "start": 0.0, "end": 2.0, "chord": "C", "confidence": 0.9},
                {"id": "auto-1", "start": 2.0, "end": 4.0, "chord": "G", "confidence": 0.9},
            ]

    monkeypatch.setattr(main_mod, "chord_detector", SlowDetector(), raising=False)

    get_result: dict[str, Any] = {}

    def run_get():
        r = client.get(f"/api/project/{pid}/chords")
        get_result["status"] = r.status_code
        get_result["data"] = r.json()

    # 1. Start GET thread (initiates backfill detection outside lock)
    t_get = threading.Thread(target=run_get)
    t_get.start()

    # Wait until detector is executing
    assert detector_started.wait(timeout=5.0), "Detector failed to start"

    # 2. Concurrently execute POST with custom chords while GET is in-flight
    custom_chords = [
        {"id": "user-0", "start": 0.0, "end": 1.0, "chord": "F#m", "confidence": 1.0},
        {"id": "user-1", "start": 1.0, "end": 3.0, "chord": "B7", "confidence": 1.0},
    ]
    r_post = client.post(f"/api/project/{pid}/chords", json={"chords": custom_chords})
    assert r_post.status_code == 200

    # 3. Allow slow detector to complete
    post_completed.set()
    t_get.join(timeout=5.0)

    # 4. Verify GET result and persistent state: custom chords must NOT be clobbered
    assert get_result["status"] == 200
    with PROJECTS_LOCK:
        persisted_chords = projects[pid]["chords"]

    assert len(persisted_chords) == 2
    assert persisted_chords[0]["chord"] == "F#m", (
        "Concurrent custom chord was clobbered by backfill!"
    )
    assert persisted_chords[1]["chord"] == "B7", (
        "Concurrent custom chord was clobbered by backfill!"
    )


def test_race_condition_get_backfill_does_not_clobber_concurrent_post_empty(
    client: TestClient, test_project, monkeypatch
):
    """Verifies worker's fix: in-flight auto-backfill never overwrites concurrent POST with empty chords []."""
    pid, _ = test_project

    detector_started = threading.Event()
    post_completed = threading.Event()

    class SlowDetector:
        def detect_chords(self, audio_path, **kwargs):
            detector_started.set()
            post_completed.wait(timeout=5.0)
            return [
                {"id": "auto-0", "start": 0.0, "end": 2.0, "chord": "C", "confidence": 0.9},
            ]

    monkeypatch.setattr(main_mod, "chord_detector", SlowDetector(), raising=False)

    get_result: dict[str, Any] = {}

    def run_get():
        r = client.get(f"/api/project/{pid}/chords")
        get_result["status"] = r.status_code
        get_result["data"] = r.json()

    t_get = threading.Thread(target=run_get)
    t_get.start()

    assert detector_started.wait(timeout=5.0), "Detector failed to start"

    # Concurrent POST []
    r_post = client.post(f"/api/project/{pid}/chords", json={"chords": []})
    assert r_post.status_code == 200

    post_completed.set()
    t_get.join(timeout=5.0)

    assert get_result["status"] == 200
    with PROJECTS_LOCK:
        persisted_chords = projects[pid]["chords"]

    # Explicit [] MUST be preserved
    assert persisted_chords == [], f"Empty chords [] was clobbered by backfill: {persisted_chords}"


# ==============================================================================
# 9. SCALE & STRESS: 2,000 Chords & Deep Monotonicity Violation
# ==============================================================================


def test_scale_large_chord_progression_and_single_deep_violation(client: TestClient, test_project):
    """Submits 2,000 valid segments (succeeds), then tampers with segment 1,999 (strictly 422)."""
    pid, _ = test_project

    # Generate 2,000 monotonic segments
    large_chords = [
        {"start": float(i), "end": float(i + 1), "chord": "C" if i % 2 == 0 else "Am"}
        for i in range(2000)
    ]
    res_valid = client.post(f"/api/project/{pid}/chords", json={"chords": large_chords})
    assert res_valid.status_code == 200
    assert res_valid.json()["chords_count"] == 2000
    assert len(projects[pid]["chords"]) == 2000

    # Tamper with segment 1,999: overlap segment 1,998 by 0.0001s
    large_chords[1999]["start"] = 1998.9999
    res_invalid = client.post(f"/api/project/{pid}/chords", json={"chords": large_chords})
    assert_structured_422(res_invalid)
    assert "Overlapping or non-monotonic" in str(res_invalid.json()["detail"])
