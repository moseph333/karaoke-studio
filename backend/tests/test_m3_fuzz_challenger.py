import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend import config
from backend.main import app, projects


@pytest.fixture
def test_project_with_stem(tmp_path: Path):
    """Creates a mock project with a valid dummy WAV stem."""
    wav_path = tmp_path / "valid_stem.wav"
    wav_path.write_bytes(
        b"RIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00D\xac\x00\x00"
    )

    proj_id = "test_fuzz_proj"
    projects[proj_id] = {
        "id": proj_id,
        "instrumental_path": str(wav_path),
        "vocals_path": str(wav_path),
        "status": "ready",
        "lines": [],
    }
    return proj_id


class TestMixEndpointAdversarialFuzzing:
    """Adversarial stress-testing of /api/project/{id}/mix boundary conditions and schemas."""

    @pytest.mark.parametrize("semitones", [-13, 13, 100, -100, "abc", [], {}, None, 1.5])
    def test_mix_invalid_semitones_rejected(
        self, client: TestClient, test_project_with_stem: str, semitones
    ):
        """Verifies semitones outside [-12, 12] or non-integer types are rejected with HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/mix",
            json={"semitones": semitones, "guide_volume": 0.0},
        )
        assert res.status_code == 422
        errors = res.json().get("detail", [])
        assert any("semitones" in str(err.get("loc", [])) for err in errors)

    @pytest.mark.parametrize("guide_volume", [-0.01, 1.01, -10.0, 10.0, "abc", [], {}, None])
    def test_mix_invalid_guide_volume_rejected(
        self, client: TestClient, test_project_with_stem: str, guide_volume
    ):
        """Verifies guide_volume outside [0.0, 1.0] or non-float types are rejected with HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/mix",
            json={"semitones": 0, "guide_volume": guide_volume},
        )
        assert res.status_code == 422
        errors = res.json().get("detail", [])
        assert any("guide_volume" in str(err.get("loc", [])) for err in errors)

    @pytest.mark.parametrize("guide_str", ["NaN", "Infinity", "-Infinity"])
    def test_mix_string_nonfinite_floats_rejected(
        self, client: TestClient, test_project_with_stem: str, guide_str
    ):
        """Verifies string representations of non-finite floats are rejected with HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/mix",
            json={"semitones": 0, "guide_volume": guide_str},
        )
        assert res.status_code == 422

    def test_empirical_repro_nan_inf_crashes_with_500(
        self, test_project_with_stem: str, auth_headers
    ):
        """
        REMEDIATED DEFECT VERIFICATION:
        Feeding raw non-finite float tokens (NaN, Infinity, -Infinity) in JSON payloads is sanitized
        by FastAPI's RequestValidationError handler returning structured HTTP 422 instead of crashing
        Starlette JSONResponse with HTTP 500.
        """
        raw_client = TestClient(app, raise_server_exceptions=False)
        for token in [b"NaN", b"Infinity", b"-Infinity"]:
            raw_payload = b'{"semitones": 0, "guide_volume": ' + token + b"}"
            res = raw_client.post(
                f"/api/project/{test_project_with_stem}/mix",
                content=raw_payload,
                headers={**auth_headers, "Content-Type": "application/json"},
            )
            # Sanitized handler returns strict HTTP 422 with structured detail
            assert res.status_code == 422, (
                f"Expected HTTP 422 for {token.decode()}, got {res.status_code}"
            )
            errors = res.json().get("detail", [])
            assert any("guide_volume" in str(err.get("loc", [])) for err in errors)


class TestProcessEndpointAdversarialFuzzing:
    """Adversarial stress-testing of /api/process intake URLs and video IDs."""

    @pytest.mark.parametrize(
        "malformed_url",
        [
            "",
            "   ",
            "\t\n  ",
            "vimeo.com",
            "https://vimeo.com/12345678",
            "notyoutube.com",
            "http://",
            "https://",
            "ftp://youtube.com",
            "https://soundcloud.com/artist/track",
            "https://evil-youtube.com/watch?v=12345678901",
            "https://youtube.com.attacker.com/watch?v=12345678901",
            "http://localhost:8000",
            "../etc/passwd",
            "12345",  # Too short (<11 chars)
            "toolongvideoidtoolongvideoidtoolongvideoid",  # Too long (>32 chars)
            "id with spaces",
            "id$with%symbols",
            None,
        ],
    )
    def test_process_malformed_urls_rejected(self, client: TestClient, malformed_url):
        """Verifies empty strings, unsupported domains, and invalid identifiers return strict HTTP 422."""
        res = client.post("/api/process", json={"url_or_id": malformed_url})
        assert res.status_code == 422

    @pytest.mark.parametrize(
        "valid_identifier",
        [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://youtube.com/shorts/dQw4w9WgXcQ",
            "dQw4w9WgXcQ",
            "pair_lyr_pitch1",
        ],
    )
    def test_process_valid_identifiers_accepted(
        self, client: TestClient, valid_identifier, monkeypatch
    ):
        """Verifies valid YouTube URLs and 11-32 char alphanumeric IDs pass schema validation."""
        # Mock run_pipeline to prevent background thread execution
        import backend.main as main_mod

        monkeypatch.setattr(main_mod, "run_pipeline", lambda *args, **kwargs: None)

        res = client.post("/api/process", json={"url_or_id": valid_identifier})
        assert res.status_code == 200
        assert res.json().get("status") in ["queued", "ready"]


class TestRenderEndpointAdversarialFuzzing:
    """Adversarial stress-testing of /api/project/{id}/render aspect ratios and bounds."""

    @pytest.mark.parametrize(
        "invalid_ar",
        ["4:3", "1:1", "vertical", "", "16:10", "9:18", "horizontal", None, 169, [], {}],
    )
    def test_render_invalid_aspect_ratio_rejected(
        self, client: TestClient, test_project_with_stem: str, invalid_ar
    ):
        """Verifies non-16:9/9:16 aspect ratios return strict HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/render",
            json={"aspect_ratio": invalid_ar},
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("valid_ar", ["16:9", "9:16"])
    def test_render_valid_aspect_ratio_accepted(
        self, client: TestClient, test_project_with_stem: str, valid_ar, monkeypatch
    ):
        """Verifies 16:9 and 9:16 aspect ratios pass schema validation."""
        import backend.main as main_mod

        monkeypatch.setattr(main_mod, "run_video_render", lambda *args, **kwargs: None)

        res = client.post(
            f"/api/project/{test_project_with_stem}/render",
            json={"aspect_ratio": valid_ar},
        )
        assert res.status_code == 200
        assert res.json().get("status") == "queued"


class TestLyricsEndpointAdversarialFuzzing:
    """Adversarial stress-testing of /api/project/{id}/lyrics timestamps and ordering."""

    def test_lyrics_negative_timestamps_rejected(
        self, client: TestClient, test_project_with_stem: str
    ):
        """Verifies negative start or end times return HTTP 422."""
        res1 = client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            json={"lines": [{"start_time": -1.0, "end_time": 5.0, "text": "test"}]},
        )
        assert res1.status_code == 422

        res2 = client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            json={"lines": [{"start_time": 0.0, "end_time": -0.5, "text": "test"}]},
        )
        assert res2.status_code == 422

    def test_lyrics_inverted_line_timestamps_rejected(
        self, client: TestClient, test_project_with_stem: str
    ):
        """Verifies end_time < start_time returns HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            json={"lines": [{"start_time": 5.0, "end_time": 2.0, "text": "inverted"}]},
        )
        assert res.status_code == 422
        assert "earlier than start_time" in res.text

    def test_lyrics_inverted_word_timestamps_rejected(
        self, client: TestClient, test_project_with_stem: str
    ):
        """Verifies word end_time < start_time returns HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            json={
                "lines": [
                    {
                        "start_time": 0.0,
                        "end_time": 5.0,
                        "text": "bad word",
                        "words": [{"word": "bad", "start_time": 3.0, "end_time": 1.0}],
                    }
                ]
            },
        )
        assert res.status_code == 422
        assert "earlier than start_time" in res.text

    def test_lyrics_non_monotonic_word_progressions_rejected(
        self, client: TestClient, test_project_with_stem: str
    ):
        """Verifies out-of-order word progression within a line returns HTTP 422."""
        res = client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            json={
                "lines": [
                    {
                        "start_time": 0.0,
                        "end_time": 5.0,
                        "text": "first second",
                        "words": [
                            {"word": "first", "start_time": 2.5, "end_time": 3.0},
                            {"word": "second", "start_time": 1.5, "end_time": 4.0},
                        ],
                    }
                ]
            },
        )
        assert res.status_code == 422
        assert "Non-monotonic word timing" in res.text

    def test_empirical_repro_infinite_timestamps_cause_dos(
        self, test_project_with_stem: str, auth_headers
    ):
        """
        REMEDIATED DEFECT VERIFICATION:
        LyricLineSchema enforces finiteness (math.isfinite / allow_inf_nan=False, le=86400.0).
        Posting Infinity end_time is rejected with HTTP 422, preventing project state corruption
        and persistent DoS on subsequent GET requests.
        """
        raw_client = TestClient(app, raise_server_exceptions=False, headers=auth_headers)
        # 1. Update lyrics with Infinity end_time is rejected with 422
        res_post = raw_client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            json={"lines": [{"start_time": 1.0, "end_time": "Infinity", "text": "infinite"}]},
        )
        assert res_post.status_code == 422, (
            f"Expected HTTP 422 rejection for infinite timestamp, got {res_post.status_code}"
        )

        # 1b. Raw Infinity token is also rejected with 422
        res_raw = raw_client.post(
            f"/api/project/{test_project_with_stem}/lyrics",
            content=b'{"lines": [{"start_time": 1.0, "end_time": Infinity, "text": "infinite"}]}',
            headers={"Content-Type": "application/json"},
        )
        assert res_raw.status_code == 422, (
            f"Expected HTTP 422 rejection for raw Infinity token, got {res_raw.status_code}"
        )

        # 2. Subsequent GET /api/project/{id} succeeds with 200 without corruption or DoS
        res_get = raw_client.get(f"/api/project/{test_project_with_stem}")
        assert res_get.status_code == 200, (
            f"Expected HTTP 200 on project retrieval, got {res_get.status_code}"
        )


class TestPreFlightAndSecurityHardeningFuzzing:
    """Adversarial stress-testing of pre-flight stem checks, upload filters, and auth."""

    def test_mix_and_render_preflight_missing_or_empty_stems(
        self, client: TestClient, tmp_path: Path
    ):
        """Verifies 400 Bad Request on missing, nonexistent, or 0-byte stem files."""
        # Missing key
        projects["p_nokey"] = {"id": "p_nokey"}
        assert (
            client.post(
                "/api/project/p_nokey/mix", json={"semitones": 0, "guide_volume": 0.0}
            ).status_code
            == 400
        )
        assert (
            client.post("/api/project/p_nokey/render", json={"aspect_ratio": "16:9"}).status_code
            == 400
        )

        # Nonexistent disk file
        projects["p_nofile"] = {"id": "p_nofile", "instrumental_path": "/path/to/missing.wav"}
        assert (
            client.post(
                "/api/project/p_nofile/mix", json={"semitones": 0, "guide_volume": 0.0}
            ).status_code
            == 400
        )
        assert (
            client.post("/api/project/p_nofile/render", json={"aspect_ratio": "16:9"}).status_code
            == 400
        )

        # Zero-byte disk file
        empty_file = tmp_path / "empty.wav"
        empty_file.touch()
        projects["p_empty"] = {"id": "p_empty", "instrumental_path": str(empty_file)}
        assert (
            client.post(
                "/api/project/p_empty/mix", json={"semitones": 0, "guide_volume": 0.0}
            ).status_code
            == 400
        )
        assert (
            client.post("/api/project/p_empty/render", json={"aspect_ratio": "16:9"}).status_code
            == 400
        )

    def test_upload_background_adversarial_rejections(self, client: TestClient):
        """Verifies 0-byte, invalid extension, spoofed magic bytes, and oversized uploads are rejected."""
        # Zero-byte
        assert (
            client.post(
                "/api/upload-background", files={"file": ("empty.jpg", b"", "image/jpeg")}
            ).status_code
            == 400
        )

        # Invalid extension
        assert (
            client.post(
                "/api/upload-background", files={"file": ("shell.php", b"<?php ?>", "text/plain")}
            ).status_code
            == 400
        )

        # Spoofed magic bytes
        assert (
            client.post(
                "/api/upload-background",
                files={"file": ("fake.jpg", b"NOT_A_JPEG_FILE", "image/jpeg")},
            ).status_code
            == 400
        )

        # Oversized (>10MB)
        huge = io.BytesIO(b"\xff\xd8" + b"A" * (10 * 1024 * 1024 + 1))
        assert (
            client.post(
                "/api/upload-background", files={"file": ("huge.jpg", huge, "image/jpeg")}
            ).status_code
            == 413
        )

    def test_passphrase_timing_safe_and_whitespace_auth(
        self, unauth_client: TestClient, monkeypatch
    ):
        """Verifies passphrase authentication channels and whitespace handling using a clean client."""
        monkeypatch.setattr(config, "APP_PASSWORD", "secret123")

        # Unauthenticated rejected with 401
        assert unauth_client.get("/api/projects", headers={}).status_code == 401

        # Header with whitespace accepted
        assert (
            unauth_client.get(
                "/api/projects", headers={"X-App-Password": "  secret123  "}
            ).status_code
            == 200
        )

        # Bearer token with whitespace accepted
        assert (
            unauth_client.get(
                "/api/projects", headers={"Authorization": "Bearer   secret123  "}
            ).status_code
            == 200
        )

        # Cookie accepted
        assert (
            unauth_client.get("/api/projects", cookies={"karaoke_token": "secret123"}).status_code
            == 200
        )

        # Wrong password rejected
        assert (
            unauth_client.get("/api/projects", headers={"X-App-Password": "wrong"}).status_code
            == 401
        )
