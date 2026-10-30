"""Adversarial stress and boundary fuzzing suite for Karaoke Studio backend.

Empirically tests:
1. Audio Stem Exports (GET /api/project/{id}/export/audio/{stem_type}):
   - Malformed and nonexistent project IDs (404)
   - Projects in unready states (400)
   - Invalid stem types and path traversal attempts (400)
   - Missing or 0-byte stem files on disk (400)
   - Header encoding for international/Unicode titles, diacritics, RTL, emojis, and header injection attempts
2. In-Studio Lyric Realignment (POST /api/project/{id}/realign-lyrics):
   - Nonexistent project IDs (404)
   - Missing or 0-byte vocal stems (400)
   - Blank or whitespace-only custom lyrics (400)
   - Malformed LRC strings and syntax corruptions (handled safely without server crash)
   - Massive payload injection (>50,000 chars triggers 422; high line counts handled cleanly)
   - Concurrent realignment requests under thread competition (concurrency safety)
3. Subtitle Formatting & Video Rendering:
   - Exhaustive fuzzing of css_to_ass_color with corrupt, non-hex, partial hex, CSS rgb/hsl, and injection strings
   - Extreme font_size_scale values (negative, zero, extreme positive, NaN, Inf)
   - ASS subtitle rendering with extreme timestamps, inverted bounds, and ASS control character injection
"""

import concurrent.futures
import math
import os
import re
import urllib.parse
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import backend.main as main_mod
from backend.main import app, projects, save_projects
from backend.services.ass_generator import (
    css_to_ass_color,
    format_ass_time,
    generate_ass_content,
    safe_time,
)


def _create_dummy_wav(path: Path, duration: float = 0.5, sr: int = 22050) -> str:
    """Create a minimal valid WAV file for offline testing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.2 * np.sin(2 * np.pi * 440.0 * t)
    stereo = np.column_stack((sine, sine))
    sf.write(str(path), stereo, sr)
    return str(path)


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def auth_headers():
    return {"X-App-Password": "sluggos"}


# ============================================================================
# Section 1: Audio Stem Exports Stress & Boundary Tests
# ============================================================================


class TestAudioStemExportsAdversarial:
    """Stress tests for GET /api/project/{id}/export/audio/{stem_type}."""

    @pytest.mark.parametrize(
        "bad_id",
        [
            "nonexistent_uuid_12345",
            "../secret",
            "../../etc/passwd",
            "%2e%2e%2fpasswd",
            "!@#$%^&*()",
            "proj with spaces",
            "null\x00byte",
            "very_long_project_id_" + ("x" * 200),
        ],
    )
    def test_audio_stem_export_malformed_or_missing_id_returns_404(
        self, client: TestClient, auth_headers: dict, bad_id: str
    ):
        """Malformed or nonexistent project IDs must return 404 and never raise 500."""
        # URL encode bad_id for path parameter safety
        escaped_id = urllib.parse.quote(bad_id, safe="")
        resp = client.get(
            f"/api/project/{escaped_id}/export/audio/instrumental", headers=auth_headers
        )
        assert resp.status_code in (404, 400)
        assert "detail" in resp.json()

    @pytest.mark.parametrize(
        "unready_status",
        [
            "queued",
            "downloading",
            "separating",
            "fetching_lyrics",
            "aligning",
            "mixing",
            "error",
            "cancelled",
            "idle",
            "unknown_state",
        ],
    )
    def test_audio_stem_export_unready_project_states_return_400(
        self, client: TestClient, auth_headers: dict, unready_status: str, tmp_path: Path
    ):
        """Projects in any state other than 'ready' must be rejected with HTTP 400."""
        pid = f"stress_unready_{unready_status}_{uuid.uuid4().hex[:6]}"
        wav_file = _create_dummy_wav(tmp_path / f"{pid}.wav")
        projects[pid] = {
            "id": pid,
            "title": "Unready Song",
            "artist": "Artist",
            "status": unready_status,
            "instrumental_path": wav_file,
            "vocals_path": wav_file,
            "master_audio_path": wav_file,
        }
        try:
            for stem in ["instrumental", "vocals", "master"]:
                resp = client.get(f"/api/project/{pid}/export/audio/{stem}", headers=auth_headers)
                assert resp.status_code == 400, (
                    f"Expected 400 for status {unready_status} on stem {stem}, got {resp.status_code}"
                )
                assert "not ready" in resp.json()["detail"].lower()
        finally:
            projects.pop(pid, None)

    @pytest.mark.parametrize(
        "invalid_stem",
        [
            "drums",
            "bass",
            "piano",
            "synth",
            "lead_vocal",
            "../../etc/passwd",
            "..%2F..%2Fevil",
            "instrumental/../vocals",
            "master.wav",
            "instrumental\x00",
            "INSTRUMENTAL",  # strictly case-sensitive check
            "",
            "   ",
        ],
    )
    def test_audio_stem_export_invalid_stem_types_return_400(
        self, client: TestClient, auth_headers: dict, invalid_stem: str, tmp_path: Path
    ):
        """Unsupported stem types or path-traversal attempts must return HTTP 400."""
        pid = f"stress_stem_{uuid.uuid4().hex[:6]}"
        wav_file = _create_dummy_wav(tmp_path / f"{pid}.wav")
        projects[pid] = {
            "id": pid,
            "title": "Stem Test",
            "status": "ready",
            "instrumental_path": wav_file,
        }
        try:
            escaped_stem = urllib.parse.quote(invalid_stem, safe="")
            resp = client.get(
                f"/api/project/{pid}/export/audio/{escaped_stem}", headers=auth_headers
            )
            # If path traversal causes routing failure it may be 404, otherwise 400
            assert resp.status_code in (400, 404)
            if resp.status_code == 400:
                assert "invalid stem type" in resp.json()["detail"].lower()
        finally:
            projects.pop(pid, None)

    def test_audio_stem_export_missing_or_empty_disk_files(
        self, client: TestClient, auth_headers: dict, tmp_path: Path
    ):
        """Missing files, directories, and 0-byte files must return HTTP 400."""
        pid = f"stress_missing_files_{uuid.uuid4().hex[:6]}"
        empty_file = tmp_path / "empty_stem.wav"
        empty_file.touch()  # 0 bytes
        dir_as_file = tmp_path / "directory_stem"
        dir_as_file.mkdir(exist_ok=True)
        missing_file = tmp_path / "does_not_exist_9999.wav"

        projects[pid] = {
            "id": pid,
            "title": "Missing Files Test",
            "status": "ready",
            "instrumental_path": str(missing_file),
            "vocals_path": str(empty_file),
            "master_audio_path": str(dir_as_file),
        }
        try:
            # 1. Non-existent file
            r1 = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)
            assert r1.status_code == 400
            assert "not found on disk" in r1.json()["detail"]

            # 2. 0-byte file
            r2 = client.get(f"/api/project/{pid}/export/audio/vocals", headers=auth_headers)
            assert r2.status_code == 400
            assert "not found on disk" in r2.json()["detail"]

            # 3. Directory instead of file
            r3 = client.get(f"/api/project/{pid}/export/audio/master", headers=auth_headers)
            assert r3.status_code == 400
            assert "not found on disk" in r3.json()["detail"]
        finally:
            projects.pop(pid, None)

    @pytest.mark.parametrize(
        "title,artist,check_sub",
        [
            ("夜に駆ける 🚀", "YOASOBI 🎵", "%E5%A4%9C%E3%81%AB%E9%A7%86%E3%81%91%E3%82%8B"),
            ("Группа крови", "Кино 🎸", "%D0%93%D1%80%D1%83%D0%BF%D0%BF%D0%B0"),
            ("يا مسافر وحدك", "محمد عبد الوهاب", "%D9%8A%D8%A7"),
            ("Café & Crème / Naïve", "Zoë & François", "Cafe"),
            ('He said "Hello" \\ / : * ? < > |', "EdgeArtist", "He said"),
            ("Injected\r\nHeader: Evil\r\n", "BadActor", "Injected"),
            ("   \t\n   ", "   ", "karaoke"),
        ],
    )
    def test_audio_stem_export_header_encoding_rfc6266_compliance(
        self,
        client: TestClient,
        auth_headers: dict,
        title: str,
        artist: str,
        check_sub: str,
        tmp_path: Path,
    ):
        """Content-Disposition header must be strictly ASCII encodable with RFC 5987 UTF-8 params."""
        pid = f"stress_header_{uuid.uuid4().hex[:6]}"
        wav_file = _create_dummy_wav(tmp_path / f"{pid}.wav")
        projects[pid] = {
            "id": pid,
            "title": title,
            "artist": artist,
            "status": "ready",
            "instrumental_path": wav_file,
        }
        try:
            resp = client.get(f"/api/project/{pid}/export/audio/instrumental", headers=auth_headers)
            assert resp.status_code == 200

            cd = resp.headers.get("content-disposition", "")
            assert cd, "Missing Content-Disposition header"

            # Strict ASCII and Latin-1 compliance (ensures Starlette / uvicorn never throw UnicodeEncodeError)
            cd.encode("ascii")
            cd.encode("latin-1")

            assert "\r" not in cd
            assert "\n" not in cd
            assert 'filename="' in cd
            assert "filename*=UTF-8''" in cd

            # Verify UTF-8 percent-encoded part
            m_utf8 = re.search(r"filename\*=UTF-8''([^;\s]+)", cd)
            assert m_utf8 is not None
            encoded_part = m_utf8.group(1)
            decoded_utf8 = urllib.parse.unquote(encoded_part)
            assert "Instrumental" in decoded_utf8
            assert decoded_utf8.endswith(".wav")
        finally:
            projects.pop(pid, None)


# ============================================================================
# Section 2: In-Studio Lyric Realignment Stress & Boundary Tests
# ============================================================================


class TestLyricRealignmentAdversarial:
    """Stress tests for POST /api/project/{id}/realign-lyrics."""

    def test_realign_lyrics_nonexistent_project_id(self, client: TestClient, auth_headers: dict):
        """Non-existent project ID returns 404."""
        resp = client.post(
            "/api/project/nonexistent_project_abc123/realign-lyrics",
            json={"custom_lyrics": "Some test line"},
            headers=auth_headers,
        )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_realign_lyrics_missing_or_empty_vocals_stem(
        self, client: TestClient, auth_headers: dict, tmp_path: Path
    ):
        """Project with missing, unconfigured, or 0-byte vocal stem returns 400."""
        # 1. No vocals_path key
        pid1 = f"realign_no_stem_{uuid.uuid4().hex[:6]}"
        projects[pid1] = {"id": pid1, "status": "ready"}

        # 2. 0-byte vocal file
        pid2 = f"realign_empty_stem_{uuid.uuid4().hex[:6]}"
        empty_stem = tmp_path / "empty_vocal.wav"
        empty_stem.touch()
        projects[pid2] = {
            "id": pid2,
            "status": "ready",
            "vocals_path": str(empty_stem),
        }

        try:
            r1 = client.post(
                f"/api/project/{pid1}/realign-lyrics",
                json={"custom_lyrics": "Hello world"},
                headers=auth_headers,
            )
            assert r1.status_code == 400
            assert "vocal stem missing" in r1.json()["detail"].lower()

            r2 = client.post(
                f"/api/project/{pid2}/realign-lyrics",
                json={"custom_lyrics": "Hello world"},
                headers=auth_headers,
            )
            assert r2.status_code == 400
            assert "vocal stem missing" in r2.json()["detail"].lower()
        finally:
            projects.pop(pid1, None)
            projects.pop(pid2, None)

    @pytest.mark.parametrize(
        "blank_lyrics",
        [
            "",
            "   ",
            "\t\t\t",
            "\n\n\r\n  \t  \n",
            None,
        ],
    )
    def test_realign_lyrics_blank_or_whitespace_without_lrclib_returns_400(
        self, client: TestClient, auth_headers: dict, tmp_path: Path, blank_lyrics
    ):
        """Blank or whitespace-only custom lyrics when fetch_lrclib=False returns 400."""
        pid = f"realign_blank_{uuid.uuid4().hex[:6]}"
        vocal_file = _create_dummy_wav(tmp_path / f"{pid}_vocals.wav")
        projects[pid] = {"id": pid, "status": "ready", "vocals_path": vocal_file}

        try:
            payload = {"fetch_lrclib": False}
            if blank_lyrics is not None:
                payload["custom_lyrics"] = blank_lyrics

            resp = client.post(
                f"/api/project/{pid}/realign-lyrics", json=payload, headers=auth_headers
            )
            assert resp.status_code == 400
            assert "either custom_lyrics or fetch_lrclib" in resp.json()["detail"]
        finally:
            projects.pop(pid, None)

    @pytest.mark.parametrize(
        "malformed_lrc",
        [
            # Corrupted timestamp formats
            "[99:99:99] Bad timestamp format\n[ab:cd.ef] Letters in timestamp\n",
            # Missing brackets and mismatched syntax
            "00:01.00 Missing left bracket\n[00:02.00 Missing right bracket\n",
            # HTML / XML tags mixed with lyrics
            "<root><line timestamp='1.0'>Hello <b>World</b></line></root>\n",
            # Decreasing / unordered timestamps
            "[00:20.00] Out of order later line\n[00:05.00] Out of order earlier line\n",
            # Negative timestamps and non-numeric garbage
            "[-01:00.00] Negative timestamp\n[NaN:NaN.NaN] Non-finite timestamp\n",
            # Mixed empty brackets and noise
            "[] Empty brackets\n[::.] Colons and dots\n[00:01.50] Valid line among noise\n",
        ],
    )
    def test_realign_lyrics_malformed_lrc_strings_handled_safely(
        self, client: TestClient, auth_headers: dict, tmp_path: Path, malformed_lrc: str
    ):
        """Malformed LRC strings must not cause unhandled 500 exceptions."""
        pid = f"realign_malformed_{uuid.uuid4().hex[:6]}"
        vocal_file = _create_dummy_wav(tmp_path / f"{pid}_vocals.wav")
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": vocal_file,
            "duration": 60.0,
        }

        try:
            resp = client.post(
                f"/api/project/{pid}/realign-lyrics",
                json={"custom_lyrics": malformed_lrc, "fetch_lrclib": False},
                headers=auth_headers,
            )
            # Response must be either 200 (if lines parsed safely) or 400 (if no usable lines found),
            # but NEVER 500 unhandled internal error.
            assert resp.status_code in (200, 400)
            if resp.status_code == 200:
                data = resp.json()
                assert data["status"] == "ok"
                assert isinstance(data["lines"], list)
            elif resp.status_code == 400:
                assert "no lyric lines found" in resp.json()["detail"].lower()
        finally:
            projects.pop(pid, None)

    def test_realign_lyrics_oversized_payload_boundary(
        self, client: TestClient, auth_headers: dict, tmp_path: Path
    ):
        """Payload exceeding Pydantic max_length (50,000 characters) is rejected with 422."""
        pid = f"realign_huge_{uuid.uuid4().hex[:6]}"
        vocal_file = _create_dummy_wav(tmp_path / f"{pid}_vocals.wav")
        projects[pid] = {"id": pid, "status": "ready", "vocals_path": vocal_file}

        try:
            # Construct payload with 50,001 chars
            oversized = "A" * 50001
            resp = client.post(
                f"/api/project/{pid}/realign-lyrics",
                json={"custom_lyrics": oversized, "fetch_lrclib": False},
                headers=auth_headers,
            )
            assert resp.status_code == 422
            errors = resp.json().get("detail", [])
            assert any("custom_lyrics" in str(err.get("loc", [])) for err in errors)
        finally:
            projects.pop(pid, None)

    def test_realign_lyrics_high_line_count_within_size_limit(
        self, client: TestClient, auth_headers: dict, tmp_path: Path
    ):
        """A 1,000-line payload within the 50,000 character limit executes safely."""
        pid = f"realign_1000lines_{uuid.uuid4().hex[:6]}"
        vocal_file = _create_dummy_wav(tmp_path / f"{pid}_vocals.wav", duration=2.0)
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": vocal_file,
            "duration": 120.0,
        }

        try:
            # 1,000 lines of plain text, ~15,000 chars total
            lines = [f"Verse line {i} in epic studio performance" for i in range(1000)]
            large_text = "\n".join(lines)
            assert len(large_text) < 50000

            resp = client.post(
                f"/api/project/{pid}/realign-lyrics",
                json={"custom_lyrics": large_text, "fetch_lrclib": False},
                headers=auth_headers,
            )
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "ok"
            assert len(data["lines"]) == 1000
        finally:
            projects.pop(pid, None)

    def test_realign_lyrics_concurrent_requests_safety(
        self, client: TestClient, auth_headers: dict, tmp_path: Path
    ):
        """Simultaneous concurrent realignment requests on the same project maintain data consistency."""
        pid = f"realign_concurrency_{uuid.uuid4().hex[:6]}"
        vocal_file = _create_dummy_wav(tmp_path / f"{pid}_vocals.wav", duration=1.0)
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "vocals_path": vocal_file,
            "duration": 60.0,
        }

        try:

            def _send_realign(req_index: int):
                lyrics = f"[00:0{req_index}.00] Concurrent line {req_index}\n"
                return client.post(
                    f"/api/project/{pid}/realign-lyrics",
                    json={"custom_lyrics": lyrics, "fetch_lrclib": False},
                    headers=auth_headers,
                )

            with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                futures = [executor.submit(_send_realign, i) for i in range(1, 6)]
                results = [f.result() for f in futures]

            # All concurrent requests should succeed (200) without crashing the server
            assert all(r.status_code == 200 for r in results)

            # Store state should remain valid and consistent
            final_proj = projects.get(pid)
            assert final_proj is not None
            assert len(final_proj.get("lines", [])) >= 1
            assert final_proj.get("is_synced") is True
        finally:
            projects.pop(pid, None)


# ============================================================================
# Section 3: Subtitle Formatting & Video Rendering Fuzzing
# ============================================================================


class TestSubtitleFormattingFuzzing:
    """Fuzzing and stress testing of css_to_ass_color, font_size_scale, and ASS rendering."""

    @pytest.mark.parametrize(
        "corrupt_input",
        [
            "",
            "   ",
            None,
            "#",
            "##",
            "#1",
            "#12",
            "#1234",
            "#12345",
            "#1234567",
            "#12345678",  # 8-char RGBA
            "#123456789",
            "#GGGGGG",  # invalid hex digits
            "#ZZZZZZ",
            "not_a_hex",
            "rgb(255, 0, 0)",
            "rgba(0, 0, 0, 0.5)",
            "hsl(120, 100%, 50%)",
            "linear-gradient(red, yellow)",
            "&H",
            "&h",
            "&HZZZZZZ",
            "&H00GGFFFF",
            "; DROP TABLE users; --",
            "<script>alert(1)</script>",
            "\x00\x01\x1f\x7f",
            "🎉🔥🚀",
            123456,  # int
            12.34,  # float
            [],  # list
            {},  # dict
            float("nan"),
            float("inf"),
        ],
    )
    def test_fuzz_css_to_ass_color_never_crashes(self, corrupt_input):
        """css_to_ass_color must NEVER raise an uncaught exception on any pathological input."""
        fallback = "&H00CUSTOM"
        result = css_to_ass_color(corrupt_input, default=fallback)  # type: ignore
        assert isinstance(result, str)
        assert len(result) > 0

    @pytest.mark.parametrize(
        "valid_css,expected_ass",
        [
            ("#000000", "&H00000000"),
            ("#ffffff", "&H00FFFFFF"),
            ("#FFFFFF", "&H00FFFFFF"),
            ("#ff0000", "&H000000FF"),  # R=FF, G=00, B=00 -> BGR 00, 00, FF
            ("#00ff00", "&H0000FF00"),  # R=00, G=FF, B=00 -> BGR 00, FF, 00
            ("#0000ff", "&H00FF0000"),  # R=00, G=00, B=FF -> BGR FF, 00, 00
            ("#f00", "&H000000FF"),
            ("#0f0", "&H0000FF00"),
            ("#00f", "&H00FF0000"),
            ("&H00AABBCC", "&H00AABBCC"),
            ("&h00aabbcc", "&H00AABBCC"),
        ],
    )
    def test_css_to_ass_color_correctness(self, valid_css: str, expected_ass: str):
        """Valid CSS hex colors must convert to expected ASS BGR format."""
        assert css_to_ass_color(valid_css) == expected_ass

    @pytest.mark.parametrize(
        "scale_in,expected_min_fontsize",
        [
            (0.001, 12),  # extremely small positive -> clamped to minimum 12
            (0.0, 52),  # 0.0 <= 0 -> resets to 1.0 (52)
            (-5.0, 52),  # negative <= 0 -> resets to 1.0 (52)
            (-0.0001, 52),  # negative -> resets to 1.0 (52)
            (100.0, 5200),  # huge positive -> scales cleanly without crash
            (float("nan"), 52),  # NaN -> resets to 1.0 (52)
            (float("inf"), 52),  # Inf -> resets to 1.0 (52)
            (float("-inf"), 52),  # -Inf -> resets to 1.0 (52)
        ],
    )
    def test_extreme_font_size_scale_in_generate_ass_content(
        self, scale_in: float, expected_min_fontsize: int
    ):
        """Extreme font_size_scale values in generate_ass_content must not crash or produce invalid syntax."""
        sample_lines = [
            {
                "start_time": 1.0,
                "end_time": 3.0,
                "text": "Fuzzing font scaling",
                "words": [
                    {"word": "Fuzzing", "start_time": 1.0, "end_time": 2.0},
                    {"word": "font", "start_time": 2.0, "end_time": 3.0},
                ],
            }
        ]

        ass = generate_ass_content(
            sample_lines,
            aspect_ratio="16:9",
            font_size_scale=scale_in,
        )
        assert "[Script Info]" in ass
        assert "[V4+ Styles]" in ass
        assert f",{expected_min_fontsize}," in ass

    def test_ass_export_endpoint_font_size_scale_bounds_rejection(
        self, client: TestClient, auth_headers: dict
    ):
        """GET /api/project/{id}/export/ass rejects out-of-range font_size_scale (<0.5, >3.0, NaN, Inf)."""
        pid = f"proj_scale_bounds_{uuid.uuid4().hex[:6]}"
        projects[pid] = {
            "id": pid,
            "status": "ready",
            "title": "Scale Song",
            "lines": [{"start_time": 1.0, "end_time": 2.0, "text": "Valid line"}],
        }

        try:
            # Below lower bound (ge=0.5)
            r_low = client.get(
                f"/api/project/{pid}/export/ass?font_size_scale=0.49", headers=auth_headers
            )
            assert r_low.status_code == 422

            # Above upper bound (le=3.0)
            r_high = client.get(
                f"/api/project/{pid}/export/ass?font_size_scale=3.01", headers=auth_headers
            )
            assert r_high.status_code == 422

            # Negative
            r_neg = client.get(
                f"/api/project/{pid}/export/ass?font_size_scale=-1.0", headers=auth_headers
            )
            assert r_neg.status_code == 422

            # String NaN / Inf
            r_nan = client.get(
                f"/api/project/{pid}/export/ass?font_size_scale=NaN", headers=auth_headers
            )
            assert r_nan.status_code == 422

            # Valid boundary values
            r_bound_low = client.get(
                f"/api/project/{pid}/export/ass?font_size_scale=0.5", headers=auth_headers
            )
            assert r_bound_low.status_code == 200
            assert ",26," in r_bound_low.text  # 52 * 0.5 = 26

            r_bound_high = client.get(
                f"/api/project/{pid}/export/ass?font_size_scale=3.0", headers=auth_headers
            )
            assert r_bound_high.status_code == 200
            assert ",156," in r_bound_high.text  # 52 * 3.0 = 156
        finally:
            projects.pop(pid, None)

    def test_ass_generation_with_extreme_values_and_control_injection(self):
        """ASS generator handles inverted timestamps, huge offsets, and control character injection."""
        adversarial_lines = [
            # Inverted line timestamps
            {"start_time": 10.0, "end_time": 5.0, "text": "Inverted Line"},
            # Extreme timestamp (100,000 seconds)
            {"start_time": 100000.0, "end_time": 100005.0, "text": "Far Future Line"},
            # Inverted word timestamps
            {
                "start_time": 20.0,
                "end_time": 25.0,
                "text": "Inverted words",
                "words": [
                    {"word": "First", "start_time": 25.0, "end_time": 22.0},
                    {"word": "Second", "start_time": 26.0, "end_time": 25.0},
                ],
            },
            # Control character injection in word tokens and line text
            {
                "start_time": 30.0,
                "end_time": 35.0,
                "text": r"Line with {\\b1} bold and \N newline and \h space",
                "words": [
                    {"word": r"{\c&H0000FF&}EvilWord", "start_time": 30.0, "end_time": 32.0},
                    {"word": "NormalWord", "start_time": 32.0, "end_time": 34.0},
                ],
            },
        ]

        ass = generate_ass_content(
            adversarial_lines,
            aspect_ratio="16:9",
            title=r"Adversarial Title {test} \N",
            primary_color="#fbbf24",
            secondary_color="#ffffff",
        )

        assert "[Script Info]" in ass
        assert "[Events]" in ass
        # Far future timestamp formatted cleanly: 100000s = 27h 46m 40s
        assert "27:46:40.00" in ass
        # Verify override curly braces are escaped
        assert r"\{\\c&H0000FF&\}EvilWord" in ass or r"\{\\c" in ass
