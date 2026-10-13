"""
backend/tests/test_api_routes.py

Comprehensive route integration test suite for YouTube Karaoke Studio.
Validates HTTP status codes, Pydantic input schemas (422), route pre-flight checks (400),
authentication/authorization gates (401), upload validation (400/413), and happy paths.
"""

import io
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
            "lines": lines
            or [
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
            ],
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

    def test_health_check_happy_path(self, client):
        """GET /api/health returns status ok and service identifier."""
        res = client.get("/api/health")
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert "YouTube Karaoke Studio" in data["service"]

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
