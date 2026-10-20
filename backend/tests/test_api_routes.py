"""
backend/tests/test_api_routes.py

Comprehensive route integration test suite for Karaoke Studio.
Validates HTTP status codes, Pydantic input schemas (422), route pre-flight checks (400),
authentication/authorization gates (401), upload validation (400/413), and happy paths.
"""

import io
import json
import threading
import uuid
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import backend.main as main_mod
from backend import config
from backend.main import projects, save_projects

# ==============================================================================
# Helper Utilities & Fixtures
# ==============================================================================


def create_synthetic_wav(
    file_path: Path, duration: float = 1.0, sr: int = 44100, freq: float = 440.0
) -> Path:
    """Generate a valid stereo sine-wave WAV file on disk for fast, offline media testing."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    sine = 0.3 * np.sin(2 * np.pi * freq * t)
    stereo = np.column_stack((sine, sine))
    file_path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(file_path), stereo, sr)
    return file_path


@pytest.fixture
def test_project_factory(tmp_path: Path):
    """
    Factory creating hermetic projects with optional synthetic stems and metadata.
    Ensures test isolation and reproducible pre-flight verification states.
    """

    def _create_project(
        project_id: str | None = None,
        title: str = "Test Anthem",
        artist: str = "Studio Artist",
        status: str = "ready",
        with_stems: bool = True,
        with_master: bool = True,
        created_by: str = "StudioTester",
        lines: list | None = None,
    ) -> dict:
        pid = project_id or f"proj_{uuid.uuid4().hex[:8]}"

        proj_data = {
            "id": pid,
            "track_id": pid,
            "title": title,
            "artist": artist,
            "duration": 120.0,
            "status": status,
            "progress": 100 if status == "ready" else 50,
            "created_by": created_by,
            "lines": (
                lines
                if lines is not None
                else [
                    {
                        "id": 1,
                        "text": "Singing along with the track",
                        "start_time": 1.0,
                        "end_time": 4.0,
                        "words": [
                            {"word": "Singing", "start_time": 1.0, "end_time": 1.8},
                            {"word": "along", "start_time": 1.8, "end_time": 2.5},
                            {"word": "with", "start_time": 2.5, "end_time": 3.0},
                            {"word": "the", "start_time": 3.0, "end_time": 3.4},
                            {"word": "track", "start_time": 3.4, "end_time": 4.0},
                        ],
                    }
                ]
            ),
            "semitones": 0,
            "guide_volume": 0.0,
        }

        if with_stems:
            stem_dir = main_mod.STEMS_DIR / pid
            stem_dir.mkdir(parents=True, exist_ok=True)
            vocal_path = stem_dir / "vocals.wav"
            inst_path = stem_dir / "instrumental.wav"
            create_synthetic_wav(vocal_path, duration=1.0, freq=880.0)
            create_synthetic_wav(inst_path, duration=1.0, freq=440.0)
            proj_data["vocals_path"] = str(vocal_path)
            proj_data["instrumental_path"] = str(inst_path)
            proj_data["vocals_url"] = f"/static/stems/{pid}/vocals.wav"
            proj_data["instrumental_url"] = f"/static/stems/{pid}/instrumental.wav"

        if with_master:
            master_file = main_mod.OUTPUT_DIR / f"{pid}_master.wav"
            create_synthetic_wav(master_file, duration=1.0, freq=440.0)
            proj_data["master_audio_path"] = str(master_file)
            proj_data["master_audio_url"] = f"/static/output/{pid}_master.wav"

        projects[pid] = proj_data
        save_projects()
        return proj_data

    return _create_project


# ==============================================================================
# 1. Validation Errors (HTTP 422 Unprocessable Entity)
# ==============================================================================


class TestRouteValidationErrors:
    """Validates that malformed payloads and out-of-range parameters are rejected with HTTP 422."""

    # --- /api/process validation ---

    @pytest.mark.parametrize("empty_input", ["", "   ", "\t\n  "])
    def test_process_empty_url_or_id_rejected_422(self, client, empty_input):
        """Reject empty or whitespace-only YouTube URLs/IDs with HTTP 422."""
        res = client.post("/api/process", json={"url_or_id": empty_input})
        assert res.status_code == 422
        assert "detail" in res.json()

    @pytest.mark.parametrize(
        "invalid_target",
        [
            "https://vimeo.com/12345678",
            "https://soundcloud.com/artist/track",
            "invalid_non_youtube_protocol://something",
            "short",
            "too_long_string_with_illegal_characters_$$$###",
        ],
    )
    def test_process_invalid_url_format_rejected_422(self, client, invalid_target):
        """Reject non-YouTube URLs and malformed video IDs with HTTP 422."""
        res = client.post("/api/process", json={"url_or_id": invalid_target})
        assert res.status_code == 422
        assert "detail" in res.json()

    def test_process_missing_required_url_or_id_422(self, client):
        """Reject requests omitting the required url_or_id field with HTTP 422."""
        res = client.post("/api/process", json={"custom_lyrics": "Some lyrics"})
        assert res.status_code == 422

    def test_process_wrong_field_types_422(self, client):
        """Reject requests with non-string url_or_id types with HTTP 422."""
        res = client.post("/api/process", json={"url_or_id": 12345678})
        assert res.status_code == 422

    # --- /api/project/{id}/mix validation ---

    @pytest.mark.parametrize("out_of_bounds_semitones", [-100, -13, 13, 24, 100])
    def test_mix_semitones_out_of_bounds_rejected_422(
        self, client, test_project_factory, out_of_bounds_semitones
    ):
        """Enforce semitones constraint [-12, 12]; out-of-bounds inputs return HTTP 422."""
        proj = test_project_factory()
        res = client.post(
            f"/api/project/{proj['id']}/mix",
            json={"semitones": out_of_bounds_semitones, "guide_volume": 0.0},
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("out_of_bounds_guide_volume", [-1.0, -0.01, 1.01, 2.0, 50.0])
    def test_mix_guide_volume_out_of_bounds_rejected_422(
        self, client, test_project_factory, out_of_bounds_guide_volume
    ):
        """Enforce guide_volume constraint [0.0, 1.0]; out-of-bounds inputs return HTTP 422."""
        proj = test_project_factory()
        res = client.post(
            f"/api/project/{proj['id']}/mix",
            json={"semitones": 0, "guide_volume": out_of_bounds_guide_volume},
        )
        assert res.status_code == 422

    def test_mix_invalid_data_types_rejected_422(self, client, test_project_factory):
        """Reject non-numeric strings or malformed payloads for mix endpoint with HTTP 422."""
        proj = test_project_factory()
        res = client.post(
            f"/api/project/{proj['id']}/mix",
            json={"semitones": "zero", "guide_volume": "loud"},
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("raw_nonfinite", [b"NaN", b"Infinity", b"-Infinity"])
    def test_mix_raw_nan_inf_payloads_return_422_not_500(
        self, client, test_project_factory, raw_nonfinite
    ):
        """Raw non-finite float tokens in JSON payload return HTTP 422 with sanitized errors, not 500."""
        proj = test_project_factory()
        payload = b'{"semitones": 0, "guide_volume": ' + raw_nonfinite + b"}"
        res = client.post(
            f"/api/project/{proj['id']}/mix",
            content=payload,
            headers={"Content-Type": "application/json"},
        )
        assert res.status_code == 422
        assert "detail" in res.json()

    # --- /api/project/{id}/render validation ---

    @pytest.mark.parametrize(
        "bad_aspect_ratio", ["4:3", "1:1", "21:9", "vertical", "16-9", "", "INVALID"]
    )
    def test_render_aspect_ratio_unsupported_rejected_422(
        self, client, test_project_factory, bad_aspect_ratio
    ):
        """Enforce aspect_ratio constraint in {'16:9', '9:16'}; other values return HTTP 422."""
        proj = test_project_factory()
        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": bad_aspect_ratio, "semitones": 0, "guide_volume": 0.0},
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("bad_semitones", [-15, 15])
    def test_render_semitones_out_of_bounds_rejected_422(
        self, client, test_project_factory, bad_semitones
    ):
        """RenderRequest semitones outside [-12, 12] returns HTTP 422."""
        proj = test_project_factory()
        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": "16:9", "semitones": bad_semitones, "guide_volume": 0.0},
        )
        assert res.status_code == 422

    @pytest.mark.parametrize("bad_vol", [-0.5, 1.5])
    def test_render_guide_volume_out_of_bounds_rejected_422(
        self, client, test_project_factory, bad_vol
    ):
        """RenderRequest guide_volume outside [0.0, 1.0] returns HTTP 422."""
        proj = test_project_factory()
        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": "16:9", "semitones": 0, "guide_volume": bad_vol},
        )
        assert res.status_code == 422

    # --- /api/project/{id}/lyrics validation ---

    def test_lyrics_negative_start_time_rejected_422(self, client, test_project_factory):
        """Reject lyric line with negative start_time with HTTP 422."""
        proj = test_project_factory()
        payload = {
            "lines": [
                {"id": 1, "text": "Hello world", "start_time": -1.5, "end_time": 2.0, "words": []}
            ]
        }
        res = client.post(f"/api/project/{proj['id']}/lyrics", json=payload)
        assert res.status_code == 422

    def test_lyrics_end_time_before_start_time_rejected_422(self, client, test_project_factory):
        """Reject lyric line where end_time < start_time with HTTP 422."""
        proj = test_project_factory()
        payload = {
            "lines": [
                {"id": 1, "text": "Hello world", "start_time": 5.0, "end_time": 2.0, "words": []}
            ]
        }
        res = client.post(f"/api/project/{proj['id']}/lyrics", json=payload)
        assert res.status_code == 422

    def test_lyrics_word_timing_invalid_rejected_422(self, client, test_project_factory):
        """Reject word timestamps where word end_time < word start_time with HTTP 422."""
        proj = test_project_factory()
        payload = {
            "lines": [
                {
                    "id": 1,
                    "text": "Hello world",
                    "start_time": 1.0,
                    "end_time": 4.0,
                    "words": [{"word": "Hello", "start_time": 3.0, "end_time": 1.5}],
                }
            ]
        }
        res = client.post(f"/api/project/{proj['id']}/lyrics", json=payload)
        assert res.status_code == 422

    def test_lyrics_word_timing_negative_start_rejected_422(self, client, test_project_factory):
        """Reject word with negative start_time with HTTP 422."""
        proj = test_project_factory()
        payload = {
            "lines": [
                {
                    "id": 1,
                    "text": "Hello world",
                    "start_time": 0.0,
                    "end_time": 2.0,
                    "words": [{"word": "Hello", "start_time": -0.5, "end_time": 1.0}],
                }
            ]
        }
        res = client.post(f"/api/project/{proj['id']}/lyrics", json=payload)
        assert res.status_code == 422

    def test_lyrics_missing_lines_field_rejected_422(self, client, test_project_factory):
        """Reject lyrics update missing the required lines list with HTTP 422."""
        proj = test_project_factory()
        res = client.post(f"/api/project/{proj['id']}/lyrics", json={})
        assert res.status_code == 422

    @pytest.mark.parametrize("bad_time", ["Infinity", "-Infinity", "NaN", 100000.0])
    def test_lyrics_infinite_or_out_of_bounds_timestamp_rejected_422(
        self, client, test_project_factory, bad_time
    ):
        """Reject lyric line with infinite, NaN, or >86400s timestamp with HTTP 422."""
        proj = test_project_factory()
        payload = {
            "lines": [
                {
                    "id": 1,
                    "text": "Out of bounds line",
                    "start_time": 1.0,
                    "end_time": bad_time,
                    "words": [],
                }
            ]
        }
        res = client.post(f"/api/project/{proj['id']}/lyrics", json=payload)
        assert res.status_code == 422

    def test_lyrics_raw_infinity_payload_returns_422_not_500(self, client, test_project_factory):
        """Raw Infinity token in lyrics payload is sanitized and returns HTTP 422, not 500."""
        proj = test_project_factory()
        raw_payload = b'{"lines": [{"id": 1, "text": "Inf", "start_time": 1.0, "end_time": Infinity, "words": []}]}'
        res = client.post(
            f"/api/project/{proj['id']}/lyrics",
            content=raw_payload,
            headers={"Content-Type": "application/json"},
        )
        assert res.status_code == 422
        assert "detail" in res.json()

    # --- /api/search validation ---

    def test_search_missing_query_field_rejected_422(self, client):
        """Reject search request omitting query with HTTP 422."""
        res = client.post("/api/search", json={"limit": 5})
        assert res.status_code == 422


# ==============================================================================
# 2. Pre-Flight Stem Checks & Resource Preconditions (HTTP 400 & 404)
# ==============================================================================


class TestRoutePreFlightChecks:
    """Validates pre-flight stem checks, resource existence, and structured error responses."""

    def test_render_preflight_missing_instrumental_stem_returns_400(
        self, client, test_project_factory
    ):
        """POST /render must reject requests if the project lacks an instrumental stem with HTTP 400."""
        # Create project without stems
        proj = test_project_factory(with_stems=False)
        assert "instrumental_path" not in proj

        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": "16:9", "semitones": 0, "guide_volume": 0.0},
        )
        assert res.status_code == 400
        detail = res.json().get("detail", "").lower()
        assert "instrumental stem" in detail or "stem not ready" in detail

    def test_render_preflight_stem_path_missing_on_disk_returns_400(
        self, client, test_project_factory
    ):
        """POST /render must verify that the instrumental stem file actually exists on disk."""
        proj = test_project_factory(with_stems=False)
        # Point to a non-existent disk path
        proj["instrumental_path"] = str(main_mod.STEMS_DIR / proj["id"] / "nonexistent_inst.wav")
        save_projects()

        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": "16:9", "semitones": 0, "guide_volume": 0.0},
        )
        assert res.status_code == 400
        detail = res.json().get("detail", "").lower()
        assert "stem" in detail

    def test_mix_preflight_missing_instrumental_stem_returns_400(
        self, client, test_project_factory
    ):
        """POST /mix must reject requests if instrumental stem is missing with HTTP 400."""
        proj = test_project_factory(with_stems=False)
        assert "instrumental_path" not in proj

        res = client.post(
            f"/api/project/{proj['id']}/mix",
            json={"semitones": 2, "guide_volume": 0.1},
        )
        assert res.status_code == 400
        assert "instrumental stem not ready" in res.json().get("detail", "").lower()

    @pytest.mark.parametrize(
        "endpoint_pattern,method,payload",
        [
            ("/api/project/{id}", "get", None),
            ("/api/project/{id}/mix", "post", {"semitones": 0, "guide_volume": 0.0}),
            (
                "/api/project/{id}/render",
                "post",
                {"aspect_ratio": "16:9", "semitones": 0, "guide_volume": 0.0},
            ),
            ("/api/project/{id}/lyrics", "post", {"lines": []}),
            ("/api/project/{id}/youtube-package", "get", None),
            ("/api/project/{id}/export/lrc", "get", None),
            ("/api/project/{id}/export/ass", "get", None),
        ],
    )
    def test_nonexistent_project_id_returns_404(self, client, endpoint_pattern, method, payload):
        """Operations targeting a non-existent project ID consistently return HTTP 404."""
        nonexistent_id = "nonexistent_proj_9999"
        url = endpoint_pattern.format(id=nonexistent_id)
        res = client.get(url) if method == "get" else client.post(url, json=payload)

        assert res.status_code == 404
        assert "project not found" in res.json().get("detail", "").lower()


# ==============================================================================
# 3. Authentication & Studio Passphrase Gate (HTTP 401 & Channels)
# ==============================================================================


class TestRouteAuthenticationAndSecurity:
    """Validates studio passphrase gating, timing-safe authentication, and header/cookie mechanics."""

    @pytest.mark.parametrize(
        "protected_path,method,json_body",
        [
            ("/api/projects", "get", None),
            ("/api/project/test_proj", "get", None),
            ("/api/project/test_proj/mix", "post", {"semitones": 0, "guide_volume": 0.0}),
            ("/api/project/test_proj/render", "post", {"aspect_ratio": "16:9"}),
            ("/api/project/test_proj/lyrics", "post", {"lines": []}),
            ("/api/project/test_proj/youtube-package", "get", None),
            ("/api/project/test_proj/export/lrc", "get", None),
            ("/api/project/test_proj/export/ass", "get", None),
            ("/static/downloads/track.wav", "get", None),
            ("/static/stems/track/vocals.wav", "get", None),
        ],
    )
    def test_unauthenticated_request_to_protected_routes_returns_401(
        self, unauth_client, monkeypatch, protected_path, method, json_body
    ):
        """When studio passphrase is required, unauthenticated requests return HTTP 401."""
        monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_passphrase")

        if method == "get":
            res = unauth_client.get(protected_path)
        else:
            res = unauth_client.post(protected_path, json=json_body)

        assert res.status_code == 401
        assert "passphrase" in res.json().get("detail", "").lower()

    def test_incorrect_passphrase_rejected_401(self, unauth_client, monkeypatch):
        """Supplying an incorrect passphrase via any channel returns HTTP 401."""
        monkeypatch.setattr(config, "APP_PASSWORD", "correct_passphrase")

        # Wrong X-App-Password header
        res_hdr = unauth_client.get("/api/projects", headers={"X-App-Password": "wrong_password"})
        assert res_hdr.status_code == 401

        # Wrong Authorization Bearer token
        res_bearer = unauth_client.get(
            "/api/projects", headers={"Authorization": "Bearer wrong_password"}
        )
        assert res_bearer.status_code == 401

        # Wrong cookie
        res_cookie = unauth_client.get("/api/projects", cookies={"karaoke_token": "wrong_cookie"})
        assert res_cookie.status_code == 401

        # Wrong login password
        res_login = unauth_client.post("/api/auth/login", json={"password": "wrong_password"})
        assert res_login.status_code == 401

    def test_authenticated_request_succeeds_via_all_channels(self, unauth_client, monkeypatch):
        """Passphrase is correctly accepted via X-App-Password, Bearer, or cookie."""
        pwd = "studio_super_secret"
        monkeypatch.setattr(config, "APP_PASSWORD", pwd)

        # 1. Header X-App-Password
        res1 = unauth_client.get("/api/projects", headers={"X-App-Password": pwd})
        assert res1.status_code == 200

        # 2. Authorization Bearer
        res2 = unauth_client.get("/api/projects", headers={"Authorization": f"Bearer {pwd}"})
        assert res2.status_code == 200

        # 3. Cookie
        res3 = unauth_client.get("/api/projects", cookies={"karaoke_token": pwd})
        assert res3.status_code == 200

    def test_unicode_passphrase_rejected_401_not_500(self, unauth_client, monkeypatch):
        """Non-ASCII Unicode login attempt returns HTTP 401 instead of crashing with HTTP 500."""
        monkeypatch.setattr(config, "APP_PASSWORD", "studio_ascii_secret")
        res = unauth_client.post("/api/auth/login", json={"password": "pàsswörd_test"})
        assert res.status_code == 401
        assert "passphrase" in res.json().get("detail", "").lower()

    def test_unicode_app_password_matches_successfully_200(self, unauth_client, monkeypatch):
        """Setting Unicode APP_PASSWORD and matching Unicode password returns HTTP 200."""
        unicode_pwd = "k@raöke_päss"
        monkeypatch.setattr(config, "APP_PASSWORD", unicode_pwd)

        # 1. Login with matching Unicode password returns 200
        login_res = unauth_client.post(
            "/api/auth/login", json={"password": unicode_pwd, "username": "UnicodeUser"}
        )
        assert login_res.status_code == 200
        assert login_res.json()["status"] == "ok"

        # 2. Login with wrong Unicode password returns 401
        res_wrong = unauth_client.post(
            "/api/auth/login", json={"password": "wröng_pass", "username": "UnicodeUser"}
        )
        assert res_wrong.status_code == 401
        assert "passphrase" in res_wrong.json().get("detail", "").lower()

        # 3. Protected route access when Unicode APP_PASSWORD is configured handles token safely
        res_ascii_hdr = unauth_client.get(
            "/api/projects", headers={"X-App-Password": "ascii_token"}
        )
        assert res_ascii_hdr.status_code == 401

        # 4. Also test multibyte Unicode emoji passphrase via login body
        emoji_pwd = "k@raöke_secret_🔑"
        monkeypatch.setattr(config, "APP_PASSWORD", emoji_pwd)
        login_emoji = unauth_client.post(
            "/api/auth/login", json={"password": emoji_pwd, "username": "EmojiUser"}
        )
        assert login_emoji.status_code == 200
        assert login_emoji.json()["status"] == "ok"

    def test_public_endpoints_accessible_without_auth(self, unauth_client, monkeypatch):
        """Public endpoints (/api/health and /api/auth/status) remain accessible without credentials."""
        monkeypatch.setattr(config, "APP_PASSWORD", "studio_super_secret")

        res_health = unauth_client.get("/api/health")
        assert res_health.status_code == 200

        res_status = unauth_client.get("/api/auth/status")
        assert res_status.status_code == 200
        body = res_status.json()
        assert body["auth_required"] is True
        assert body["authenticated"] is False

    def test_auth_status_when_no_password_configured(self, unauth_client, monkeypatch):
        """When no passphrase is set, auth_required is False and authenticated is True."""
        monkeypatch.setattr(config, "APP_PASSWORD", "")

        res = unauth_client.get("/api/auth/status")
        assert res.status_code == 200
        assert res.json()["auth_required"] is False
        assert res.json()["authenticated"] is True

    def test_security_headers_present_on_all_responses(self, client):
        """All responses include modern HTTP security headers."""
        res = client.get("/api/health")
        assert res.status_code == 200
        assert res.headers.get("X-Content-Type-Options") == "nosniff"
        assert res.headers.get("X-Frame-Options") == "DENY"
        assert res.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


# ==============================================================================
# 4. Upload Validation (HTTP 400, 413, & Path Traversal Sanitization)
# ==============================================================================


class TestRouteUploadValidation:
    """Validates background image and instrumental stem upload boundaries and security."""

    # --- Background Upload ---

    def test_upload_background_empty_file_rejected_400(self, client):
        """0-byte background upload must be rejected with HTTP 400 Bad Request."""
        empty_payload = io.BytesIO(b"")
        res = client.post(
            "/api/upload-background",
            files={"file": ("empty.jpg", empty_payload, "image/jpeg")},
        )
        assert res.status_code == 400
        assert "empty" in res.json().get("detail", "").lower()

    @pytest.mark.parametrize(
        "bad_ext", ["malware.exe", "script.sh", "page.html", "vector.svg", "image.gif", "doc.pdf"]
    )
    def test_upload_background_invalid_extension_rejected_400(self, client, bad_ext):
        """Reject unapproved background image extensions with HTTP 400."""
        payload = io.BytesIO(b"\x00\x01\x02\x03fakecontent")
        res = client.post(
            "/api/upload-background",
            files={"file": (bad_ext, payload, "application/octet-stream")},
        )
        assert res.status_code == 400
        assert "unsupported image format" in res.json().get("detail", "").lower()

    def test_upload_background_oversized_file_rejected_413(self, client, monkeypatch):
        """Background upload exceeding maximum permitted byte size returns HTTP 413."""
        monkeypatch.setattr(main_mod, "MAX_BACKGROUND_UPLOAD_BYTES", 256)
        oversized = io.BytesIO(b"X" * 512)
        res = client.post(
            "/api/upload-background",
            files={"file": ("huge.jpg", oversized, "image/jpeg")},
        )
        assert res.status_code == 413
        assert "exceeds maximum permitted size" in res.json().get("detail", "").lower()

    def test_upload_background_valid_file_accepted_200(self, client):
        """Valid image file upload is saved and returns bg_id and static bg_url."""
        valid_jpeg = io.BytesIO(b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 32)
        res = client.post(
            "/api/upload-background",
            files={"file": ("stage_lighting.jpg", valid_jpeg, "image/jpeg")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "bg_id" in data
        assert data["bg_url"].startswith("/static/backgrounds/")

        # Verify file is stored in BACKGROUNDS_DIR
        target = main_mod.BACKGROUNDS_DIR / data["bg_id"]
        assert target.exists()

    def test_upload_background_path_traversal_sanitized(self, client):
        """Path traversal characters in upload filename are strictly sanitized."""
        payload = io.BytesIO(b"\xff\xd8\xff\xe0\x00\x10JFIF" + b"\x00" * 16)
        res = client.post(
            "/api/upload-background",
            files={"file": ("../../../../etc/malicious.jpg", payload, "image/jpeg")},
        )
        assert res.status_code == 200
        bg_id = res.json()["bg_id"]
        assert ".." not in bg_id
        assert "/" not in bg_id
        assert "\\" not in bg_id
        assert (
            main_mod.BACKGROUNDS_DIR / bg_id
        ).resolve().parent == main_mod.BACKGROUNDS_DIR.resolve()

    def test_upload_background_invalid_magic_bytes_rejected_400(self, client):
        """Reject non-image payload with .jpg extension with HTTP 400."""
        text_payload = io.BytesIO(b"this is plain text content not an image")
        res = client.post(
            "/api/upload-background",
            files={"file": ("fake.jpg", text_payload, "image/jpeg")},
        )
        assert res.status_code == 400
        assert "invalid magic bytes" in res.json().get("detail", "").lower()

    def test_upload_background_valid_mp4_accepted_200(self, client):
        """Valid MP4 video background upload is saved and returns bg_id and static bg_url."""
        valid_mp4 = io.BytesIO(b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00isommp42" + b"\x00" * 32)
        res = client.post(
            "/api/upload-background",
            files={"file": ("clip.mp4", valid_mp4, "video/mp4")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "bg_id" in data
        assert data["bg_id"].endswith("clip.mp4")
        assert data["bg_url"].startswith("/static/backgrounds/")

        target = main_mod.BACKGROUNDS_DIR / data["bg_id"]
        assert target.exists()

    def test_upload_background_valid_webm_accepted_200(self, client):
        """Valid WebM video background upload is saved and returns bg_id and static bg_url."""
        valid_webm = io.BytesIO(
            b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01\x42\xf7\x81\x01\x42\x82\x88matroska"
            + b"\x00" * 32
        )
        res = client.post(
            "/api/upload-background",
            files={"file": ("visuals.webm", valid_webm, "video/webm")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "bg_id" in data
        assert data["bg_id"].endswith("visuals.webm")
        assert data["bg_url"].startswith("/static/backgrounds/")

        target = main_mod.BACKGROUNDS_DIR / data["bg_id"]
        assert target.exists()

    def test_upload_background_invalid_magic_bytes_mp4_rejected_400(self, client):
        """Reject corrupted/spoofed .mp4 payload with HTTP 400 and ensure file deletion."""
        text_payload = io.BytesIO(b"this is plain text claiming to be an mp4 video")
        res = client.post(
            "/api/upload-background",
            files={"file": ("spoofed.mp4", text_payload, "video/mp4")},
        )
        assert res.status_code == 400
        assert "invalid magic bytes" in res.json().get("detail", "").lower()

        # Verify no orphaned file in BACKGROUNDS_DIR
        for p in main_mod.BACKGROUNDS_DIR.iterdir():
            assert not p.name.endswith("spoofed.mp4")

    def test_upload_background_invalid_magic_bytes_webm_rejected_400(self, client):
        """Reject corrupted/spoofed .webm payload with HTTP 400 and ensure file deletion."""
        fake_webm = io.BytesIO(b"NOT_EBML_HEADER_FAKE_WEBM_CONTENT")
        res = client.post(
            "/api/upload-background",
            files={"file": ("spoofed.webm", fake_webm, "video/webm")},
        )
        assert res.status_code == 400
        assert "invalid magic bytes" in res.json().get("detail", "").lower()

        # Verify no orphaned file in BACKGROUNDS_DIR
        for p in main_mod.BACKGROUNDS_DIR.iterdir():
            assert not p.name.endswith("spoofed.webm")

    def test_validate_background_header_direct_unit(self):
        """Direct unit testing of validate_background_header and validate_image_header alias."""
        from backend.main import validate_background_header, validate_image_header

        assert validate_background_header == validate_image_header

        # Valid headers
        assert validate_background_header(b"\xff\xd8\xff\xe0", ".jpg") is True
        assert validate_background_header(b"\xff\xd8\xff\xe0", ".jpeg") is True
        assert validate_background_header(b"\x89PNG\r\n\x1a\n", ".png") is True
        assert validate_background_header(b"RIFF\x20\x00\x00\x00WEBPVP8 ", ".webp") is True
        assert validate_background_header(b"\x00\x00\x00\x18ftypmp42", ".mp4") is True
        assert validate_background_header(b"\x1a\x45\xdf\xa3\x01\x02", ".webm") is True

        # Short payloads
        assert validate_background_header(b"", ".mp4") is False
        assert validate_background_header(b"ftyp", ".mp4") is False
        assert validate_background_header(b"\x1a\x45", ".webm") is False
        assert validate_background_header(b"", ".webm") is False

        # Corrupt headers
        assert validate_background_header(b"\x00\x00\x00\x18moovmp42", ".mp4") is False
        assert validate_background_header(b"EBML\x00\x00\x00\x00", ".webm") is False
        assert validate_background_header(b"GIF89a", ".gif") is False

    # --- Instrumental Stem Upload ---

    def test_upload_instrumental_empty_file_handled(self, client, test_project_factory):
        """0-byte instrumental audio upload is rejected with HTTP 400."""
        proj = test_project_factory()
        empty_payload = io.BytesIO(b"")
        res = client.post(
            "/api/upload-instrumental",
            data={"project_id": proj["id"]},
            files={"file": ("empty.wav", empty_payload, "audio/wav")},
        )
        assert res.status_code == 400
        assert "uploaded file is empty (0 bytes)" in res.json().get("detail", "").lower()

    @pytest.mark.parametrize("bad_ext", ["track.exe", "track.txt", "cover.jpg", "script.py"])
    def test_upload_instrumental_invalid_audio_extension_rejected_400(
        self, client, test_project_factory, bad_ext
    ):
        """Reject unapproved audio extensions for instrumental upload with HTTP 400."""
        proj = test_project_factory()
        payload = io.BytesIO(b"RIFF\x00\x00\x00\x00WAVE")
        res = client.post(
            "/api/upload-instrumental",
            data={"project_id": proj["id"]},
            files={"file": (bad_ext, payload, "application/octet-stream")},
        )
        assert res.status_code == 400
        assert "unsupported audio format" in res.json().get("detail", "").lower()

    def test_upload_instrumental_nonexistent_project_returns_404(self, client):
        """Instrumental upload targeting a non-existent project returns HTTP 404."""
        payload = io.BytesIO(b"RIFF\x00\x00\x00\x00WAVEfmt ")
        res = client.post(
            "/api/upload-instrumental",
            data={"project_id": "nonexistent_pid_1234"},
            files={"file": ("custom.wav", payload, "audio/wav")},
        )
        assert res.status_code == 404

    def test_upload_instrumental_valid_accepted_200(self, client, test_project_factory):
        """Valid audio upload updates project instrumental_path and returns URL."""
        proj = test_project_factory(with_stems=False)
        audio_payload = io.BytesIO(
            b"RIFF$ \x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x02\x00\x44\xac\x00\x00data\x00 "
        )
        res = client.post(
            "/api/upload-instrumental",
            data={"project_id": proj["id"]},
            files={"file": ("backing_track.wav", audio_payload, "audio/wav")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "instrumental_url" in data

        # Check updated project state
        updated = projects[proj["id"]]
        assert "instrumental_path" in updated
        assert Path(updated["instrumental_path"]).exists()


# ==============================================================================
# 5. Happy Paths & Full Route Integration Workflows
# ==============================================================================


class TestRouteHappyPaths:
    """Validates successful execution of all API routes, lifecycle transitions, and data integrity."""

    def test_health_check_happy_path(self, client, monkeypatch, tmp_path):
        """GET and POST /api/health return status, version, update check, and trigger update."""
        monkeypatch.setattr(config, "DATA_DIR", tmp_path)
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "Karaoke Studio" in data["service"]
        assert isinstance(data.get("version"), str) and len(data["version"]) > 0

        monkeypatch.setenv("APP_VERSION", "v1.6.0-test")
        res_override = client.get("/api/health")
        assert res_override.json()["version"] == "v1.6.0-test"

        # POST check action
        res_check = client.post("/api/health", json={"action": "check"})
        assert res_check.status_code == 200
        assert "update_available" in res_check.json()

        # POST update action writes .update_requested trigger file
        res_update = client.post("/api/health", json={"action": "update"})
        assert res_update.status_code == 200
        upd_data = res_update.json()
        assert upd_data["updating"] is True
        assert upd_data["status"] == "updating"
        assert (tmp_path / ".update_requested").exists()

    def test_auth_login_logout_lifecycle_happy_path(self, unauth_client, monkeypatch):
        """Login sets authentication cookie; logout removes it."""
        pwd = "studio_secret_key"
        monkeypatch.setattr(config, "APP_PASSWORD", pwd)

        # Login
        login_res = unauth_client.post(
            "/api/auth/login", json={"password": pwd, "username": "KaraokeStar"}
        )
        assert login_res.status_code == 200
        assert login_res.json()["status"] == "ok"
        assert login_res.json()["username"] == "KaraokeStar"
        assert "karaoke_token" in login_res.cookies

        # Logout
        logout_res = unauth_client.post("/api/auth/logout")
        assert logout_res.status_code == 200
        set_cookie = logout_res.headers.get("set-cookie", "")
        assert 'karaoke_token=""' in set_cookie or "Max-Age=0" in set_cookie

    def test_search_tracks_happy_path(self, client, monkeypatch):
        """POST /api/search returns list of tracks from downloader service."""
        mock_results = [
            {
                "id": "dQw4w9WgXcQ",
                "title": "Never Gonna Give You Up",
                "artist": "Rick Astley",
                "duration": 213,
                "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
                "thumbnail": "https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
            }
        ]
        monkeypatch.setattr(main_mod.downloader, "search_tracks", lambda q, limit=5: mock_results)

        res = client.post("/api/search", json={"query": "Rick Astley", "limit": 1})
        assert res.status_code == 200
        data = res.json()
        assert "results" in data
        assert len(data["results"]) == 1
        assert data["results"][0]["id"] == "dQw4w9WgXcQ"

    def test_search_tracks_empty_query_returns_empty_results(self, client, monkeypatch):
        """Searching with pure whitespace returns empty result list without errors."""
        monkeypatch.setattr(main_mod.downloader, "search_tracks", lambda q, limit=5: [])
        res = client.post("/api/search", json={"query": "   ", "limit": 5})
        assert res.status_code == 200
        assert res.json()["results"] == []

    def test_process_valid_url_queues_pipeline(self, client, monkeypatch):
        """Submitting a valid 11-char YouTube ID or URL creates a queued project."""
        # Prevent actual download thread execution
        monkeypatch.setattr(main_mod, "run_pipeline", lambda pid, url, lyrics=None: None)

        valid_url = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        res = client.post("/api/process", json={"url_or_id": valid_url, "created_by": "TestUser"})
        assert res.status_code == 200
        data = res.json()
        assert data["project_id"] == "dQw4w9WgXcQ"
        assert data["status"] == "queued"

        # Verify project record created in store
        assert "dQw4w9WgXcQ" in projects
        assert projects["dQw4w9WgXcQ"]["created_by"] == "TestUser"

    def test_process_cached_ready_project_immediate_return(
        self, client, test_project_factory, monkeypatch
    ):
        """Submitting an 11-char track ID that is already in 'ready' status returns cached project immediately."""
        monkeypatch.setattr(main_mod, "run_pipeline", lambda pid, url, lyrics=None: None)
        test_project_factory(project_id="readytrack1", status="ready")

        res = client.post("/api/process", json={"url_or_id": "readytrack1"})
        assert res.status_code == 200
        assert res.json()["project_id"] == "readytrack1"
        assert res.json()["status"] == "ready"

    def test_projects_list_and_scoped_filtering(self, client, test_project_factory):
        """GET /api/projects lists all projects and supports scope=my filtering."""
        test_project_factory(project_id="proj_alice", created_by="Alice")
        test_project_factory(project_id="proj_bob", created_by="Bob")

        # All projects
        res_all = client.get("/api/projects")
        assert res_all.status_code == 200
        all_data = res_all.json()
        assert "proj_alice" in all_data
        assert "proj_bob" in all_data

        # Scoped to Alice
        res_alice = client.get("/api/projects?scope=my&user=Alice")
        assert res_alice.status_code == 200
        alice_data = res_alice.json()
        assert "proj_alice" in alice_data
        assert "proj_bob" not in alice_data

    def test_get_project_detail_happy_path(self, client, test_project_factory):
        """GET /api/project/{id} returns comprehensive project status and metadata."""
        test_project_factory(project_id="proj_detail_1", title="Detail Song")
        res = client.get("/api/project/proj_detail_1")
        assert res.status_code == 200
        data = res.json()
        assert data["id"] == "proj_detail_1"
        assert data["title"] == "Detail Song"
        assert data["status"] == "ready"
        assert len(data["lines"]) > 0

    def test_update_lyrics_happy_path(self, client, test_project_factory):
        """POST /api/project/{id}/lyrics updates project lyric lines and word timings."""
        proj = test_project_factory()
        updated_lines = [
            {
                "id": 1,
                "text": "Refined lyric line",
                "start_time": 2.0,
                "end_time": 5.0,
                "words": [
                    {"word": "Refined", "start_time": 2.0, "end_time": 2.8},
                    {"word": "lyric", "start_time": 2.8, "end_time": 3.6},
                    {"word": "line", "start_time": 3.6, "end_time": 5.0},
                ],
            }
        ]
        res = client.post(f"/api/project/{proj['id']}/lyrics", json={"lines": updated_lines})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["lines_count"] == 1

        # Check persistence
        stored_lines = projects[proj["id"]]["lines"]
        assert len(stored_lines) == 1
        assert stored_lines[0]["text"] == "Refined lyric line"

    def test_update_lyrics_syncs_duration_and_youtube_package(self, client, test_project_factory):
        """POST /api/project/{id}/lyrics updates duration if lines expand and regenerates youtube_package."""
        proj = test_project_factory()
        # Set baseline duration to 10.0 and attach a dummy youtube_package
        projects[proj["id"]]["duration"] = 10.0
        projects[proj["id"]]["youtube_package"] = {"title": "Old", "chapters": []}
        save_projects()

        updated_lines = [
            {
                "id": 1,
                "text": "Extended line",
                "start_time": 5.0,
                "end_time": 15.5,
                "words": [
                    {"word": "Extended", "start_time": 5.0, "end_time": 10.0},
                    {"word": "line", "start_time": 10.0, "end_time": 15.5},
                ],
            }
        ]
        res = client.post(f"/api/project/{proj['id']}/lyrics", json={"lines": updated_lines})
        assert res.status_code == 200

        stored = projects[proj["id"]]
        assert stored["duration"] == 15.5
        assert "youtube_package" in stored
        assert stored["youtube_package"] is not None

    def test_mix_audio_happy_path(self, client, test_project_factory, monkeypatch):
        """POST /api/project/{id}/mix shifts pitch, blends guide vocals, and returns master URL."""
        proj = test_project_factory()

        # Mock audio mixer execution
        def mock_mix_and_shift(
            instrumental_path, vocals_path=None, semitones=0, guide_volume=0.0, output_filename=None
        ):
            out_file = main_mod.OUTPUT_DIR / output_filename
            create_synthetic_wav(out_file, duration=1.0)
            return str(out_file)

        monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", mock_mix_and_shift)

        res = client.post(
            f"/api/project/{proj['id']}/mix",
            json={"semitones": 3, "guide_volume": 0.2},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "master_audio_url" in data

        # Verify state updated in project
        assert projects[proj["id"]]["semitones"] == 3
        assert projects[proj["id"]]["guide_volume"] == 0.2

    def test_render_video_happy_path(self, client, test_project_factory, monkeypatch):
        """POST /api/project/{id}/render queues video synthesis job with verified stems."""
        proj = test_project_factory()
        # Mock background video task
        monkeypatch.setattr(main_mod, "run_video_render", lambda pid, req: None)

        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": "16:9", "semitones": 0, "guide_volume": 0.0},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "queued"

        # Check render_status queued
        assert projects[proj["id"]]["render_status"] == "queued"

    def test_render_video_vertical_9_16_aspect_ratio_accepted(
        self, client, test_project_factory, monkeypatch
    ):
        """POST /api/project/{id}/render accepts valid vertical '9:16' aspect ratio."""
        proj = test_project_factory()
        monkeypatch.setattr(main_mod, "run_video_render", lambda pid, req: None)

        res = client.post(
            f"/api/project/{proj['id']}/render",
            json={"aspect_ratio": "9:16", "semitones": 0, "guide_volume": 0.0},
        )
        assert res.status_code == 200
        assert res.json()["status"] == "queued"

    def test_cancel_endpoints_happy_path(self, client, test_project_factory):
        """Cancel endpoints trigger cancellation events and update project status."""
        proj = test_project_factory()

        # Cancel pipeline
        res_cancel = client.post(f"/api/project/{proj['id']}/cancel")
        assert res_cancel.status_code == 200
        assert res_cancel.json()["status"] == "ok"
        assert projects[proj["id"]]["status"] == "cancelled"

        # Cancel render
        res_render = client.post(f"/api/project/{proj['id']}/cancel-render")
        assert res_render.status_code == 200
        assert res_render.json()["status"] == "ok"
        assert projects[proj["id"]]["render_status"] == "idle"

    def test_youtube_package_happy_path(self, client, test_project_factory):
        """GET /api/project/{id}/youtube-package generates SEO metadata package."""
        proj = test_project_factory(title="Bohemian Rhapsody", artist="Queen")
        res = client.get(f"/api/project/{proj['id']}/youtube-package")
        assert res.status_code == 200
        data = res.json()
        assert "title" in data
        assert "description" in data
        assert "tags" in data
        assert "Queen" in data["title"]


class TestTrackUploadRoutes:
    """Test suite for local audio track intake (POST /api/upload-track and /api/upload-audio)."""

    def test_validate_audio_header_direct_unit(self):
        """Direct unit testing of validate_audio_header across all allowed formats and edge cases."""
        from backend.main import validate_audio_header

        # WAV
        valid_wav = b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00"
        assert validate_audio_header(valid_wav, ".wav") is True
        assert validate_audio_header(b"RIFFshort", ".wav") is False
        assert validate_audio_header(b"RIFF$\x00\x00\x00NOTW", ".wav") is False

        # MP3 ID3 & Frame Sync
        valid_mp3_id3 = b"ID3\x03\x00\x00\x00\x00\x00\x00"
        valid_mp3_sync = b"\xff\xfb\x90d"
        assert validate_audio_header(valid_mp3_id3, ".mp3") is True
        assert validate_audio_header(valid_mp3_sync, ".mp3") is True
        assert validate_audio_header(b"\xff\x00fake", ".mp3") is False

        # FLAC
        valid_flac = b'fLaC\x00\x00\x00"'
        assert validate_audio_header(valid_flac, ".flac") is True
        assert validate_audio_header(b"flac", ".flac") is False

        # OGG
        valid_ogg = b"OggS\x00\x02\x00\x00"
        assert validate_audio_header(valid_ogg, ".ogg") is True
        assert validate_audio_header(b"OGGS", ".ogg") is False

        # M4A & AAC
        valid_m4a = b"\x00\x00\x00\x20ftypM4A "
        valid_aac_adts = b"\xff\xf1\x50\x80"
        assert validate_audio_header(valid_m4a, ".m4a") is True
        assert validate_audio_header(valid_aac_adts, ".aac") is True
        assert validate_audio_header(valid_m4a, ".aac") is True

        # Edge cases: short buffers and unsupported extensions
        assert validate_audio_header(b"", ".wav") is False
        assert validate_audio_header(b"R", ".wav") is False
        assert validate_audio_header(valid_wav, ".unknown") is False

    def test_upload_track_empty_file_rejected_400(self, client):
        """0-byte track upload must be rejected with HTTP 400 Bad Request."""
        empty_payload = io.BytesIO(b"")
        res = client.post(
            "/api/upload-track",
            files={"file": ("empty.wav", empty_payload, "audio/wav")},
        )
        assert res.status_code == 400
        assert "empty" in res.json().get("detail", "").lower()

    @pytest.mark.parametrize(
        "bad_ext", ["script.sh", "video.mp4", "app.exe", "image.png", "doc.pdf", "text.txt"]
    )
    def test_upload_track_invalid_extension_rejected_400(self, client, bad_ext):
        """Reject unapproved audio extensions with HTTP 400."""
        payload = io.BytesIO(b"RIFF$\x00\x00\x00WAVEfmt ")
        res = client.post(
            "/api/upload-track",
            files={"file": (bad_ext, payload, "application/octet-stream")},
        )
        assert res.status_code == 400
        assert "unsupported audio format" in res.json().get("detail", "").lower()

    def test_upload_track_oversized_file_rejected_413(self, client, monkeypatch):
        """Track upload exceeding maximum permitted byte size returns HTTP 413."""
        monkeypatch.setattr(main_mod, "MAX_TRACK_UPLOAD_BYTES", 256)
        oversized = io.BytesIO(b"X" * 512)
        res = client.post(
            "/api/upload-track",
            files={"file": ("huge.wav", oversized, "audio/wav")},
        )
        assert res.status_code == 413
        assert "exceeds maximum permitted size" in res.json().get("detail", "").lower()

    def test_upload_track_spoofed_magic_bytes_rejected_400(self, client):
        """Reject non-audio payload disguised with audio extension with HTTP 400 and clean up."""
        fake_wav = io.BytesIO(b"this is plain text claiming to be a wav file")
        res = client.post(
            "/api/upload-track",
            files={"file": ("spoofed.wav", fake_wav, "audio/wav")},
        )
        assert res.status_code == 400
        assert "invalid magic bytes" in res.json().get("detail", "").lower()

        # Verify no orphaned file in DOWNLOADS_DIR
        for p in main_mod.DOWNLOADS_DIR.iterdir():
            assert not p.name.endswith("spoofed.wav")

    def test_upload_track_valid_wav_accepted_200(self, client, monkeypatch):
        """Valid WAV file upload is accepted, queued, and initializes project record."""
        monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
        valid_wav = io.BytesIO(b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"\x00" * 32)
        res = client.post(
            "/api/upload-track",
            data={"title": "Custom Anthem", "artist": "Studio Artist", "created_by": "Tester"},
            files={"file": ("anthem.wav", valid_wav, "audio/wav")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "queued"
        assert data["project_id"].startswith("local_")

        proj = projects[data["project_id"]]
        assert proj["title"] == "Custom Anthem"
        assert proj["artist"] == "Studio Artist"
        assert proj["created_by"] == "Tester"
        assert proj["audio_url"] == f"/static/downloads/{data['project_id']}.wav"

    def test_upload_track_valid_mp3_accepted_200(self, client, monkeypatch):
        """Valid MP3 file upload with ID3 header is accepted with HTTP 200."""
        monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
        valid_mp3 = io.BytesIO(b"ID3\x03\x00\x00\x00\x00\x00\x00" + b"\x00" * 32)
        res = client.post(
            "/api/upload-track",
            files={"file": ("track.mp3", valid_mp3, "audio/mpeg")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "queued"
        assert data["project_id"].startswith("local_")

    def test_upload_track_valid_flac_accepted_200(self, client, monkeypatch):
        """Valid FLAC file upload with fLaC header is accepted with HTTP 200."""
        monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
        valid_flac = io.BytesIO(b'fLaC\x00\x00\x00"' + b"\x00" * 32)
        res = client.post(
            "/api/upload-track",
            files={"file": ("acoustic.flac", valid_flac, "audio/flac")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "queued"

    def test_upload_track_alias_upload_audio(self, client, monkeypatch):
        """POST /api/upload-audio works as an alias for /api/upload-track."""
        monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
        valid_wav = io.BytesIO(b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"\x00" * 32)
        res = client.post(
            "/api/upload-audio",
            files={"file": ("alias.wav", valid_wav, "audio/wav")},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "queued"
        assert data["project_id"].startswith("local_")

    def test_upload_track_path_traversal_sanitized(self, client, monkeypatch):
        """Path traversal characters in filename are safely sanitized."""
        monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args, **kwargs: None)
        valid_wav = io.BytesIO(b"RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00" + b"\x00" * 32)
        res = client.post(
            "/api/upload-track",
            files={"file": ("../../../../etc/malicious.wav", valid_wav, "audio/wav")},
        )
        assert res.status_code == 200
        pid = res.json()["project_id"]
        assert ".." not in pid


class TestProjectDeletionLifecycle:
    """Verifies DELETE /api/project/{project_id}, task cancellation, and safe disk cleanup."""

    def test_delete_project_success(self, client, test_project_factory):
        """Deleting an existing project removes it from state, projects.json, and cleans disk."""
        proj = test_project_factory(
            title="To Delete", artist="Eraser", with_stems=True, with_master=True
        )
        pid = proj["id"]

        download_file = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
        create_synthetic_wav(download_file)
        render_file = main_mod.OUTPUT_DIR / f"{pid}_karaoke.mp4"
        render_file.write_bytes(b"dummy mp4 data")

        assert (main_mod.STEMS_DIR / pid).exists()
        assert (main_mod.OUTPUT_DIR / f"{pid}_master.wav").exists()
        assert download_file.exists()
        assert render_file.exists()

        res = client.delete(f"/api/project/{pid}")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "deleted"
        assert data["project_id"] == pid

        # In-memory and disk verification
        assert pid not in main_mod.projects
        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert pid not in disk_projects

        # Disk files removed
        assert not (main_mod.STEMS_DIR / pid).exists()
        assert not (main_mod.OUTPUT_DIR / f"{pid}_master.wav").exists()
        assert not download_file.exists()
        assert not render_file.exists()

    def test_delete_project_404(self, client):
        """Deleting a non-existent project returns 404."""
        res = client.delete("/api/project/non_existent_project_id")
        assert res.status_code == 404
        assert "project not found" in res.json()["detail"].lower()

    def test_delete_project_cancels_active_job(self, client, test_project_factory):
        """Deleting an active project sets cancellation events for pipeline and render."""
        proj = test_project_factory(title="In Flight", artist="Racer")
        pid = proj["id"]

        pipe_event = threading.Event()
        render_event = threading.Event()
        main_mod.active_cancellations[pid] = pipe_event
        main_mod.active_cancellations[f"{pid}_render"] = render_event

        res = client.delete(f"/api/project/{pid}")
        assert res.status_code == 200
        assert pipe_event.is_set() is True
        assert render_event.is_set() is True

    def test_delete_project_disk_cleanup_preserves_others(self, client, test_project_factory):
        """Deleting Project A preserves files of Project B and prevents prefix substring collision."""
        test_project_factory(project_id="p1", title="Prefix One", with_stems=True, with_master=True)
        test_project_factory(
            project_id="p10", title="Prefix Ten", with_stems=True, with_master=True
        )
        test_project_factory(project_id="p2", title="Prefix Two", with_stems=True, with_master=True)

        p1_download = main_mod.DOWNLOADS_DIR / "p1.wav"
        create_synthetic_wav(p1_download)
        p10_download = main_mod.DOWNLOADS_DIR / "p10.wav"
        create_synthetic_wav(p10_download)

        p10_master = main_mod.OUTPUT_DIR / "p10_master.wav"
        p2_master = main_mod.OUTPUT_DIR / "p2_master.wav"

        assert p1_download.exists()
        assert p10_download.exists()
        assert p10_master.exists()
        assert p2_master.exists()

        res = client.delete("/api/project/p1")
        assert res.status_code == 200

        # p1 removed
        assert not p1_download.exists()
        assert not (main_mod.STEMS_DIR / "p1").exists()
        assert not (main_mod.OUTPUT_DIR / "p1_master.wav").exists()

        # p10 and p2 completely preserved
        assert p10_download.exists()
        assert p10_master.exists()
        assert (main_mod.STEMS_DIR / "p10").exists()
        assert p2_master.exists()
        assert (main_mod.STEMS_DIR / "p2").exists()
        assert "p10" in main_mod.projects
        assert "p2" in main_mod.projects

    def test_delete_project_with_track_id_alias(self, client, test_project_factory):
        """Deleting via track_id alias cleans both canonical id and alias."""
        proj = test_project_factory(project_id="canon_123", title="Alias Test")
        proj["track_id"] = "alias_yt_789"
        main_mod.projects["alias_yt_789"] = proj
        main_mod.save_projects()

        res = client.delete("/api/project/alias_yt_789")
        assert res.status_code == 200
        assert "canon_123" not in main_mod.projects
        assert "alias_yt_789" not in main_mod.projects

    def test_delete_project_shared_track_id_isolation(self, client, test_project_factory):
        """If two projects share a track_id, stems are preserved until the last project is deleted."""
        p_alpha = test_project_factory(project_id="alpha", title="Alpha")
        p_beta = test_project_factory(project_id="beta", title="Beta")
        p_alpha["track_id"] = "shared_yt_track"
        p_beta["track_id"] = "shared_yt_track"

        shared_stem_dir = main_mod.STEMS_DIR / "shared_yt_track"
        shared_stem_dir.mkdir(parents=True, exist_ok=True)
        create_synthetic_wav(shared_stem_dir / "vocals.wav")
        p_alpha["vocals_path"] = str(shared_stem_dir / "vocals.wav")
        p_beta["vocals_path"] = str(shared_stem_dir / "vocals.wav")
        main_mod.save_projects()

        res1 = client.delete("/api/project/alpha")
        assert res1.status_code == 200
        assert (shared_stem_dir / "vocals.wav").exists()

        res2 = client.delete("/api/project/beta")
        assert res2.status_code == 200
        assert not shared_stem_dir.exists()

    def test_pipeline_does_not_resurrect_deleted_project(self, monkeypatch):
        """Background pipeline exception handler does not resurrect deleted project."""
        pid = "ghost_test_project"
        cancel_event = threading.Event()
        main_mod.active_cancellations[pid] = cancel_event

        main_mod.projects.pop(pid, None)
        main_mod.save_projects()

        def mock_download(*args, **kwargs):
            raise RuntimeError("Download aborted")

        monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", mock_download)

        main_mod.run_pipeline(pid, "https://www.youtube.com/watch?v=dQw4w9WgXcQ")

        assert pid not in main_mod.projects
        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert pid not in disk_projects


class TestProjectMetadataUpdate:
    """Verifies PATCH /api/project/{project_id} and POST /api/project/{project_id}/metadata."""

    def test_patch_project_metadata_success(self, client, test_project_factory):
        """Updating title and artist via PATCH updates in-memory and disk state."""
        proj = test_project_factory(title="Original Song", artist="Original Singer")
        pid = proj["id"]

        res = client.patch(
            f"/api/project/{pid}",
            json={"title": "Updated Song", "artist": "Updated Singer"},
        )
        assert res.status_code == 200
        data = res.json()
        assert data["title"] == "Updated Song"
        assert data["artist"] == "Updated Singer"

        disk_projects = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
        assert disk_projects[pid]["title"] == "Updated Song"
        assert disk_projects[pid]["artist"] == "Updated Singer"

    def test_patch_project_metadata_partial(self, client, test_project_factory):
        """Updating only title or only artist preserves the other field."""
        proj = test_project_factory(title="Keep My Singer", artist="Original Singer")
        pid = proj["id"]

        res1 = client.patch(f"/api/project/{pid}", json={"title": "New Title Only"})
        assert res1.status_code == 200
        assert res1.json()["title"] == "New Title Only"
        assert res1.json()["artist"] == "Original Singer"

        res2 = client.patch(f"/api/project/{pid}", json={"artist": "New Singer Only"})
        assert res2.status_code == 200
        assert res2.json()["title"] == "New Title Only"
        assert res2.json()["artist"] == "New Singer Only"

    def test_patch_project_metadata_empty_rejected(self, client, test_project_factory):
        """Missing or whitespace-only fields are rejected with 400."""
        proj = test_project_factory(title="Valid", artist="Valid")
        pid = proj["id"]

        res1 = client.patch(f"/api/project/{pid}", json={})
        assert res1.status_code == 400
        assert "at least one" in res1.json()["detail"].lower()

        res2 = client.patch(f"/api/project/{pid}", json={"title": ""})
        assert res2.status_code == 400
        assert "title cannot be empty" in res2.json()["detail"].lower()

        res3 = client.patch(f"/api/project/{pid}", json={"title": "   "})
        assert res3.status_code == 400
        assert "title cannot be empty" in res3.json()["detail"].lower()

        res4 = client.patch(f"/api/project/{pid}", json={"artist": ""})
        assert res4.status_code == 400
        assert "artist cannot be empty" in res4.json()["detail"].lower()

        res5 = client.patch(f"/api/project/{pid}", json={"artist": "   "})
        assert res5.status_code == 400
        assert "artist cannot be empty" in res5.json()["detail"].lower()

    def test_patch_project_metadata_404(self, client):
        """Updating non-existent project returns 404."""
        res = client.patch("/api/project/non_existent_id", json={"title": "Ghost"})
        assert res.status_code == 404
        assert "project not found" in res.json()["detail"].lower()

    def test_patch_project_metadata_youtube_package_reflection(self, client, test_project_factory):
        """Updating metadata dynamically reflects in GET /api/project/{id}/youtube-package."""
        proj = test_project_factory(title="Old Song", artist="Old Artist")
        pid = proj["id"]

        pkg_before = client.get(f"/api/project/{pid}/youtube-package").json()
        assert "Old Song" in pkg_before["title"]
        assert "Old Artist" in pkg_before["title"]

        res = client.patch(
            f"/api/project/{pid}", json={"title": "Brand New Anthem", "artist": "Superstar"}
        )
        assert res.status_code == 200

        pkg_after = client.get(f"/api/project/{pid}/youtube-package").json()
        assert pkg_after["title"] == "Superstar - Brand New Anthem (Karaoke Version / With Lyrics)"
        assert "Brand New Anthem" in pkg_after["description"]
        assert "superstar" in pkg_after["tags"]

    def test_update_project_metadata_post_alias(self, client, test_project_factory):
        """POST /api/project/{id}/metadata works identically to PATCH."""
        proj = test_project_factory(title="Post Song", artist="Post Singer")
        pid = proj["id"]

        res = client.post(
            f"/api/project/{pid}/metadata",
            json={"title": "Updated via POST", "artist": "Updated via POST Artist"},
        )
        assert res.status_code == 200
        assert res.json()["title"] == "Updated via POST"
        assert res.json()["artist"] == "Updated via POST Artist"

    def test_update_project_metadata_strips_whitespace(self, client, test_project_factory):
        """Leading and trailing whitespace is trimmed on save."""
        proj = test_project_factory(title="Raw Song", artist="Raw Artist")
        pid = proj["id"]

        res = client.patch(
            f"/api/project/{pid}",
            json={"title": "   Trimmed Title   ", "artist": "   Trimmed Artist   "},
        )
        assert res.status_code == 200
        assert res.json()["title"] == "Trimmed Title"
        assert res.json()["artist"] == "Trimmed Artist"

    def test_update_project_metadata_updates_embedded_package(self, client, test_project_factory):
        """Pre-existing embedded proj['youtube_package'] is regenerated with new title and artist."""
        proj = test_project_factory(title="Cached Song", artist="Cached Artist")
        pid = proj["id"]
        main_mod.projects[pid]["youtube_package"] = {"title": "Stale Package"}

        res = client.patch(
            f"/api/project/{pid}",
            json={"title": "Refreshed Song", "artist": "Refreshed Artist"},
        )
        assert res.status_code == 200
        assert (
            main_mod.projects[pid]["youtube_package"]["title"]
            == "Refreshed Artist - Refreshed Song (Karaoke Version / With Lyrics)"
        )

    def test_update_project_metadata_with_track_id_alias(self, client, test_project_factory):
        """Accessing metadata update endpoint via track_id alias updates canonical project."""
        proj = test_project_factory(project_id="canon_meta", title="Original Title")
        main_mod.projects["alias_meta_yt"] = proj
        main_mod.save_projects()

        res = client.patch("/api/project/alias_meta_yt", json={"title": "Alias Updated Title"})
        assert res.status_code == 200
        assert main_mod.projects["canon_meta"]["title"] == "Alias Updated Title"


# ==============================================================================
# Subtitle Export Routes: .lrc and .ass (Milestone 2)
# ==============================================================================


class TestSubtitleExportLrc:
    """Test suite for GET /api/project/{project_id}/export/lrc."""

    def test_export_lrc_success_200(self, client, test_project_factory):
        """Exporting .lrc returns HTTP 200, UTF-8 text/plain, Content-Disposition, and accurate LRC lines."""
        proj = test_project_factory(
            title="Bohemian Rhapsody",
            artist="Queen",
            lines=[
                {
                    "id": 1,
                    "text": "Is this the real life?",
                    "start_time": 2.5,
                    "end_time": 5.0,
                    "words": [],
                },
                {
                    "id": 2,
                    "text": "Is this just fantasy?",
                    "start_time": 6.0,
                    "end_time": 9.0,
                    "words": [],
                },
            ],
        )
        pid = proj["id"]
        res = client.get(f"/api/project/{pid}/export/lrc")
        assert res.status_code == 200
        assert "text/plain" in res.headers["content-type"]
        assert "charset=utf-8" in res.headers["content-type"].lower()
        assert (
            'attachment; filename="Queen - Bohemian Rhapsody.lrc"'
            in res.headers["content-disposition"]
        )
        content = res.text
        assert "[ti:Bohemian Rhapsody]" in content
        assert "[ar:Queen]" in content
        assert "[00:02.50]Is this the real life?" in content
        assert "[00:06.00]Is this just fantasy?" in content

    def test_export_lrc_project_not_found_404(self, client):
        """Requesting export for non-existent project ID returns HTTP 404."""
        res = client.get("/api/project/nonexistent_proj_9999/export/lrc")
        assert res.status_code == 404
        assert "project not found" in res.json().get("detail", "").lower()

    def test_export_lrc_no_lyrics_returns_400(self, client, test_project_factory):
        """Projects without lyric lines return HTTP 400."""
        proj = test_project_factory(lines=[])
        pid = proj["id"]
        res = client.get(f"/api/project/{pid}/export/lrc")
        assert res.status_code == 400
        assert "no lyric lines" in res.json().get("detail", "").lower()

    def test_export_lrc_whitespace_only_lyrics_returns_400(self, client, test_project_factory):
        """Projects with lines containing only whitespace return HTTP 400."""
        proj = test_project_factory(
            lines=[{"id": 1, "text": "   ", "start_time": 1.0, "end_time": 2.0}]
        )
        pid = proj["id"]
        res = client.get(f"/api/project/{pid}/export/lrc")
        assert res.status_code == 400
        assert "no lyric lines" in res.json().get("detail", "").lower()

    def test_export_lrc_independent_of_render_status(self, client, test_project_factory):
        """Exporting .lrc succeeds even if project status is downloading and video render has never run."""
        proj = test_project_factory(
            status="downloading",
            with_stems=False,
            with_master=False,
            lines=[{"id": 1, "text": "Early lyrics export", "start_time": 1.0, "end_time": 3.0}],
        )
        pid = proj["id"]
        assert "video_url" not in proj or proj.get("video_url") is None
        res = client.get(f"/api/project/{pid}/export/lrc")
        assert res.status_code == 200
        assert "[00:01.00]Early lyrics export" in res.text

    def test_export_lrc_unauthenticated_returns_401(
        self, unauth_client, test_project_factory, monkeypatch
    ):
        """When studio passphrase is set, unauthenticated export requests return HTTP 401."""
        monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_passphrase")
        proj = test_project_factory()
        res = unauth_client.get(f"/api/project/{proj['id']}/export/lrc")
        assert res.status_code == 401

    def test_export_lrc_filename_sanitization(self, client, test_project_factory):
        """Export filename sanitizes dangerous quotes, slashes, and control characters."""
        import re

        proj = test_project_factory(
            title='Song / With "Quotes" & <Brackets>: Final',
            artist="Artist / Rock",
            lines=[
                {"id": 1, "text": "Sanitized filename test", "start_time": 1.0, "end_time": 2.0}
            ],
        )
        pid = proj["id"]
        res = client.get(f"/api/project/{pid}/export/lrc")
        assert res.status_code == 200
        disposition = res.headers["content-disposition"]
        filename_match = re.search(r'filename="([^"]+)"', disposition)
        assert filename_match is not None
        filename = filename_match.group(1)
        assert "/" not in filename
        assert "\\" not in filename
        assert '"' not in filename
        assert filename.endswith(".lrc")

    def test_export_lrc_non_latin1_cjk_title_content_disposition(
        self, client, test_project_factory
    ):
        """LRC export with CJK characters in title/artist does not crash Starlette header encoding."""
        proj = test_project_factory(
            title="夜に駆ける",
            artist="YOASOBI",
            lines=[
                {"id": 0, "text": "沈むように溶けてゆくように", "start_time": 1.0, "end_time": 4.0}
            ],
        )
        res = client.get(f"/api/project/{proj['id']}/export/lrc")
        assert res.status_code == 200
        cd = res.headers["content-disposition"]
        # Header must be strictly encodable in latin-1 (verified by lack of Starlette 500 error)
        cd.encode("latin-1")
        # Must contain ASCII fallback
        assert 'filename="YOASOBI.lrc"' in cd
        # Must contain RFC 5987 UTF-8 parameter
        assert "filename*=UTF-8''" in cd
        assert "YOASOBI" in cd
        # Content must retain UTF-8 Japanese lyrics
        assert "[ti:夜に駆ける]" in res.text
        assert "[ar:YOASOBI]" in res.text
        assert "沈むように溶けてゆくように" in res.text

    def test_export_lrc_100_plus_minute_track_returns_200(self, client, test_project_factory):
        """Exporting .lrc for a track >= 100 minutes returns HTTP 200 (not false 400)."""
        proj = test_project_factory(
            title="Extended Symphony",
            artist="Orchestra",
            lines=[
                {
                    "id": 0,
                    "text": "Movement at 100 minutes",
                    "start_time": 6000.0,
                    "end_time": 6005.0,
                },
                {
                    "id": 1,
                    "text": "Movement at two hours",
                    "start_time": 7200.0,
                    "end_time": 7205.0,
                },
            ],
        )
        res = client.get(f"/api/project/{proj['id']}/export/lrc")
        assert res.status_code == 200
        assert "[100:00.00]Movement at 100 minutes" in res.text
        assert "[120:00.00]Movement at two hours" in res.text


class TestExportAssSubtitles:
    """Verifies GET /api/project/{project_id}/export/ass route."""

    def test_export_ass_success_200_16_9(self, client, test_project_factory):
        """Export ASS subtitle in 16:9 widescreen returns 200 with valid ASS document."""
        proj = test_project_factory(title="My Song", artist="My Artist")
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass?aspect_ratio=16:9")
        assert res.status_code == 200
        assert "text/x-ssa" in res.headers["content-type"]
        assert (
            'attachment; filename="My Artist - My Song.ass"' in res.headers["content-disposition"]
        )

        body = res.text
        assert "[Script Info]" in body
        assert "PlayResX: 1920" in body
        assert "PlayResY: 1080" in body
        assert "Style: KaraokeLine1" in body
        assert "\\kf" in body

    def test_export_ass_success_200_9_16(self, client, test_project_factory):
        """Export ASS subtitle in 9:16 vertical shorts returns 200 with mobile dimensions."""
        proj = test_project_factory()
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass?aspect_ratio=9:16")
        assert res.status_code == 200
        body = res.text
        assert "PlayResX: 1080" in body
        assert "PlayResY: 1920" in body
        assert ",60,60,640,1" in body

    @pytest.mark.parametrize(
        "theme_id,expected_bgr",
        [
            ("modern_gold", "&H0000D7FF"),
            ("cyber_cyan", "&H00FFFF00"),
            ("neon_pink", "&H00B300FF"),
            ("classic_ktv", "&H0000FFFF"),
        ],
    )
    def test_export_ass_with_visual_theme(
        self, client, test_project_factory, theme_id, expected_bgr
    ):
        """Theme parameter correctly sets primary karaoke fill color."""
        proj = test_project_factory()
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass?theme_id={theme_id}")
        assert res.status_code == 200
        assert expected_bgr in res.text

    def test_export_ass_with_direct_color_override(self, client, test_project_factory):
        """Custom primary_color and secondary_color query parameters override theme colors."""
        proj = test_project_factory()
        pid = proj["id"]

        res = client.get(
            f"/api/project/{pid}/export/ass?primary_color=%26H00112233&secondary_color=%26H00445566"
        )
        assert res.status_code == 200
        assert "&H00112233" in res.text
        assert "&H00445566" in res.text

    def test_export_ass_without_video_render(self, client, test_project_factory):
        """Ready project with render_status='idle' exports ASS immediately without requiring render."""
        proj = test_project_factory()
        pid = proj["id"]
        main_mod.projects[pid]["render_status"] = "idle"
        main_mod.projects[pid]["video_url"] = None

        res = client.get(f"/api/project/{pid}/export/ass")
        assert res.status_code == 200
        assert "[Script Info]" in res.text

    def test_export_ass_invalid_aspect_ratio_400(self, client, test_project_factory):
        """Unsupported aspect ratio returns 400."""
        proj = test_project_factory()
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass?aspect_ratio=4:3")
        assert res.status_code == 400
        assert "invalid aspect ratio" in res.json()["detail"].lower()

    def test_export_ass_invalid_theme_id_400(self, client, test_project_factory):
        """Non-existent theme_id returns 400."""
        proj = test_project_factory()
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass?theme_id=hologram_matrix")
        assert res.status_code == 400
        assert "invalid theme_id" in res.json()["detail"].lower()

    def test_export_ass_project_not_found_404(self, client):
        """Exporting ASS for nonexistent project ID returns 404."""
        res = client.get("/api/project/missing_project_xyz/export/ass")
        assert res.status_code == 404
        assert "project not found" in res.json()["detail"].lower()

    def test_export_ass_unready_project_without_lyrics_400(self, client, test_project_factory):
        """Project in active intake without lines returns 400."""
        proj = test_project_factory(status="separating", lines=[])
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass")
        assert res.status_code == 400
        assert "lyrics are not ready" in res.json()["detail"].lower()

    def test_export_ass_filename_sanitization(self, client, test_project_factory):
        """Unsafe characters in title/artist are sanitized in Content-Disposition header."""
        proj = test_project_factory(
            title='Bad/Slash "Quotes" and \r\n Newline',
            artist="Artist/Slash",
        )
        pid = proj["id"]

        res = client.get(f"/api/project/{pid}/export/ass")
        assert res.status_code == 200
        cd = res.headers["content-disposition"]
        assert "\r" not in cd
        assert "\n" not in cd
        assert "/" not in cd.split('filename="')[1].split('"')[0]

    def test_export_ass_via_track_id_alias(self, client, test_project_factory):
        """Export endpoint resolves track_id alias to canonical project."""
        proj = test_project_factory(project_id="canon_ass")
        main_mod.projects["alias_ass_yt"] = proj
        main_mod.save_projects()

        res = client.get("/api/project/alias_ass_yt/export/ass")
        assert res.status_code == 200
        assert "[Script Info]" in res.text

    def test_export_ass_auth_protected_when_configured(
        self, client, test_project_factory, monkeypatch
    ):
        """When APP_PASSWORD is set, unauthenticated export returns 401, authenticated returns 200."""
        monkeypatch.setattr(config, "APP_PASSWORD", "studio_secret_phrase")
        proj = test_project_factory()
        pid = proj["id"]

        # Unauthenticated -> 401
        res_unauth = client.get(f"/api/project/{pid}/export/ass")
        assert res_unauth.status_code == 401

        # Authenticated via X-App-Password -> 200
        res_auth = client.get(
            f"/api/project/{pid}/export/ass",
            headers={"X-App-Password": "studio_secret_phrase"},
        )
        assert res_auth.status_code == 200

    def test_export_ass_non_latin1_cjk_title_content_disposition(
        self, client, test_project_factory
    ):
        """ASS export with CJK characters does not crash Starlette header encoding."""
        proj = test_project_factory(
            title="夜に駆ける",
            artist="YOASOBI",
            lines=[
                {"id": 0, "text": "沈むように溶けてゆくように", "start_time": 1.0, "end_time": 4.0}
            ],
        )
        res = client.get(f"/api/project/{proj['id']}/export/ass")
        assert res.status_code == 200
        cd = res.headers["content-disposition"]
        cd.encode("latin-1")
        assert 'filename="YOASOBI.ass"' in cd
        assert "filename*=UTF-8''" in cd
        assert "Title: YOASOBI - 夜に駆ける" in res.text

    def test_export_lrc_and_ass_emojis_and_cyrillic(self, client, test_project_factory):
        """LRC and ASS exports safely handle emojis and Cyrillic script in titles."""
        proj = test_project_factory(
            title="Катюша 🎵 🎤",
            artist="Хор",
            lines=[
                {"id": 0, "text": "Расцветали яблони и груши", "start_time": 2.0, "end_time": 5.0}
            ],
        )
        res_lrc = client.get(f"/api/project/{proj['id']}/export/lrc")
        assert res_lrc.status_code == 200
        res_lrc.headers["content-disposition"].encode("latin-1")

        res_ass = client.get(f"/api/project/{proj['id']}/export/ass")
        assert res_ass.status_code == 200
        res_ass.headers["content-disposition"].encode("latin-1")

    def test_export_ass_100_plus_minute_track_returns_200(self, client, test_project_factory):
        """Exporting .ass for a track >= 100 minutes returns HTTP 200 with formatted timecodes."""
        proj = test_project_factory(
            title="Extended Symphony",
            artist="Orchestra",
            lines=[
                {
                    "id": 0,
                    "text": "Movement at 100 minutes",
                    "start_time": 6000.0,
                    "end_time": 6005.0,
                }
            ],
        )
        res = client.get(f"/api/project/{proj['id']}/export/ass")
        assert res.status_code == 200
        assert "1:40:00.00" in res.text

    def test_export_ass_malformed_timestamps_in_project_returns_200(
        self, client, test_project_factory
    ):
        """Exporting .ass for a project with None/NaN timestamps returns HTTP 200 (not 500 crash)."""
        proj = test_project_factory(
            title="Faulty Timestamps",
            artist="Tester",
            lines=[
                {
                    "id": 0,
                    "text": "Corrupted timestamps",
                    "start_time": None,
                    "end_time": float("nan"),
                },
                {"id": 1, "text": "Negative timestamps", "start_time": -10.0, "end_time": -5.0},
            ],
        )
        res = client.get(f"/api/project/{proj['id']}/export/ass")
        assert res.status_code == 200
        assert "Corrupted timestamps" in res.text
        assert "Negative timestamps" in res.text
