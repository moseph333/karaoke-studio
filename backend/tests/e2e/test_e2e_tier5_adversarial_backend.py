"""
E2E Test Suite - Tier 5: White-Box Adversarial Coverage Hardening
Empirical challenger tests targeting untested branches, unusual error conditions,
resource limits, boundary parameters, and concurrent edge cases across:
- backend/main.py (validation sanitization, auth edge cases, background pipelines, uploads, storage)
- backend/services/aligner.py (boundary timings, silent audio, corrupted inputs, syllabic onsets)
- backend/services/audio_mixer.py (dynamic sample rate inspection, FFmpeg errors, timeout cleanups)
- backend/services/downloader.py (URL regex edge cases, cached audio thumbnail fallback, profile exhausts)
- backend/services/lyrics.py (syncedlyrics fallback, LRCLIB search, LRC parser boundary lines)
- backend/services/separator.py (cached stem validation, stderr parsing, force kills, directory cleanups)
- backend/services/video_renderer.py (ASS time formatting, gradient backgrounds, FFmpeg drain and errors)
- backend/services/youtube_uploader.py (chapter generation with/without lyrics, oauth status)
- backend/config.py (origins parsing, environment variable fallbacks)
"""

import io
import math
import os
import subprocess
import threading
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import numpy as np
import pytest
import soundfile as sf
from fastapi import HTTPException, UploadFile
from PIL import Image

import backend.main as main_mod
from backend import config
from backend.main import (
    LyricLineSchema,
    ProcessRequest,
    WordTimingSchema,
    active_cancellations,
    app,
    find_project,
    get_project_or_404,
    is_authenticated,
    load_projects,
    projects,
    run_pipeline,
    run_video_render,
    sanitize_upload_filename,
    sanitize_validation_errors,
    save_projects,
    save_upload_file_bounded,
    validate_image_header,
)
from backend.services.aligner import AudioAligner
from backend.services.audio_mixer import AudioMixer
from backend.services.downloader import TrackDownloader
from backend.services.lyrics import LyricsService
from backend.services.separator import AudioSeparator
from backend.services.video_renderer import VideoRenderer
from backend.services.youtube_uploader import YouTubeMetadataService
from backend.tests.e2e.conftest import generate_sine_wave_wav, generate_test_image

# ==============================================================================
# 1. Main Application & API Route Adversarial Tests
# ==============================================================================


def test_sanitize_validation_errors_adversarial_types():
    """Validates sanitize_validation_errors handling of non-finite floats, exceptions, and containers."""
    payload = {
        "nan_val": float("nan"),
        "inf_val": float("inf"),
        "neginf_val": float("-inf"),
        "finite_val": 42.5,
        "error_obj": ValueError("Sample failure"),
        "nested_dict": {"key": float("nan")},
        "items_list": [float("inf"), "regular_str", None],
        "tuple_items": (1, float("nan")),
        "set_items": {10, 20},
    }
    sanitized = sanitize_validation_errors(payload)
    assert sanitized["nan_val"] == "nan"
    assert sanitized["inf_val"] == "inf"
    assert sanitized["neginf_val"] == "-inf"
    assert sanitized["finite_val"] == 42.5
    assert sanitized["error_obj"] == "Sample failure"
    assert sanitized["nested_dict"]["key"] == "nan"
    assert sanitized["items_list"][0] == "inf"
    assert sanitized["items_list"][1] == "regular_str"
    assert sanitized["items_list"][2] is None
    assert isinstance(sanitized["tuple_items"], list)


def test_is_authenticated_edge_cases():
    """Tests is_authenticated with empty studio password, header token variations, and exceptions."""
    # When app_pwd is empty string, all requests are authenticated
    mock_req = MagicMock()
    assert is_authenticated(mock_req, "") is True

    # When app_pwd is set
    mock_req.headers.get.side_effect = lambda k: {
        "X-App-Password": "secret_pass",
        "Authorization": None,
    }.get(k)
    mock_req.cookies.get.return_value = None
    assert is_authenticated(mock_req, "secret_pass") is True
    assert is_authenticated(mock_req, "wrong_pass") is False

    # Exception inside hmac.compare_digest
    with patch("hmac.compare_digest", side_effect=TypeError("Comparison error")):
        assert is_authenticated(mock_req, "secret_pass") is False


def test_auth_login_when_no_password_configured(client, monkeypatch):
    """When config.APP_PASSWORD is not set, login succeeds without issuing auth cookies."""
    monkeypatch.setattr(config, "APP_PASSWORD", "")
    resp = client.post("/api/auth/login", json={"password": "any", "username": "Singer"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["token"] == "ok"
    assert data["username"] == "Singer"
    assert "karaoke_token" not in resp.cookies


def test_auth_status_open_mode(client, monkeypatch):
    """When config.APP_PASSWORD is empty, auth status reports open mode."""
    monkeypatch.setattr(config, "APP_PASSWORD", "")
    resp = client.get("/api/auth/status")
    assert resp.status_code == 200
    assert resp.json() == {"auth_required": False, "authenticated": True}


def test_find_project_by_track_id_fallback(project_factory):
    """Validates find_project resolves a project when queried by track_id rather than project_id."""
    proj = project_factory(project_id="p_unique_id", status="ready")
    proj["track_id"] = "track_distinct_id"
    save_projects()

    found = find_project("track_distinct_id")
    assert found is not None
    assert found["id"] == "p_unique_id"

    # Non-existent project
    assert find_project("non_existent_id") is None
    with pytest.raises(HTTPException) as exc_info:
        get_project_or_404("non_existent_id")
    assert exc_info.value.status_code == 404


def test_projects_backup_recovery_and_corrupt_files(monkeypatch, tmp_path):
    """Tests load_projects recovery from backup when primary file is corrupt, and when both are corrupt."""
    store_file = tmp_path / "projects.json"
    bak_file = tmp_path / "projects.json.bak"
    monkeypatch.setattr(main_mod, "PROJECTS_STORE_FILE", store_file)
    monkeypatch.setattr(main_mod, "PROJECTS_BACKUP_FILE", bak_file)

    # 1. Primary is corrupt, backup is valid
    store_file.write_text("{invalid json!!", encoding="utf-8")
    bak_file.write_text('{"proj_recovered": {"id": "proj_recovered"}}', encoding="utf-8")
    recovered = load_projects()
    assert "proj_recovered" in recovered

    # 2. Both primary and backup are corrupt
    bak_file.write_text("also corrupt!!", encoding="utf-8")
    empty_result = load_projects()
    assert empty_result == {}

    # 3. Exception during backup copy in save_projects does not crash saving
    projects.clear()
    projects["p1"] = {"id": "p1", "title": "Song"}
    store_file.write_text('{"p1": {"id": "p1"}}', encoding="utf-8")
    with patch.object(Path, "write_bytes", side_effect=OSError("Disk write error")):
        save_projects()  # Should not raise
    assert store_file.exists()


def test_process_track_concurrent_active_pipeline_deduplication(client, project_factory):
    """If a project is already active in memory, /api/process returns its current state rather than re-queueing."""
    vid_id = "actv_11_vid"
    project_factory(project_id=vid_id, status="downloading")
    # Simulate active cancellation token in memory
    active_cancellations[vid_id] = threading.Event()

    resp = client.post("/api/process", json={"url_or_id": vid_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == vid_id
    assert data["status"] == "downloading"


def test_process_track_stale_session_pipeline_resume(client, project_factory):
    """If a project has status 'downloading' but no active thread (e.g. server restart), it is resumed."""
    vid_id = "stle_11_vid"
    project_factory(project_id=vid_id, status="downloading")
    active_cancellations.pop(vid_id, None)

    resp = client.post("/api/process", json={"url_or_id": vid_id})
    assert resp.status_code == 200
    data = resp.json()
    assert data["project_id"] == vid_id
    assert data["status"] == "queued"


def test_run_pipeline_cancellation_during_download_hook(monkeypatch, tmp_path):
    """Tests run_pipeline transitions to 'cancelled' when cancel_event is set during dl_hook."""
    pid = "pipe_cancel_dl"
    projects[pid] = {"id": pid, "status": "queued"}
    save_projects()

    def fake_extract_info(url, progress_hook=None):
        if progress_hook:
            # Set cancellation event and trigger hook
            if pid in active_cancellations:
                active_cancellations[pid].set()
            progress_hook({"status": "downloading", "total_bytes": 100, "downloaded_bytes": 10})
        return {"id": pid, "title": "Track", "artist": "Artist", "audio_path": "a.wav"}

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", fake_extract_info)
    run_pipeline(pid, pid)

    proj = find_project(pid)
    assert proj["status"] == "cancelled"
    assert "Processing was cancelled by user" in proj["status_detail"]


def test_run_pipeline_unexpected_exception_transitions_to_error(monkeypatch):
    """Tests run_pipeline transitions to 'error' when an unhandled exception occurs."""
    pid = "pipe_error_test"
    projects[pid] = {"id": pid, "status": "queued"}
    save_projects()

    def failing_download(url, progress_hook=None):
        raise RuntimeError("Network disconnected unexpectedly")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", failing_download)
    run_pipeline(pid, pid)

    proj = find_project(pid)
    assert proj["status"] == "error"
    assert "Network disconnected unexpectedly" in proj["error"]


def test_run_video_render_unexpected_exception_transitions_to_error(project_factory, monkeypatch):
    """Tests run_video_render transitions render_status to 'error' on unexpected failure."""
    pid = "render_error_test"
    project_factory(project_id=pid, status="ready")

    req = main_mod.RenderRequest(aspect_ratio="16:9")

    def failing_render(*args, **kwargs):
        raise RuntimeError("FFmpeg crashed due to corrupted frame")

    monkeypatch.setattr(main_mod.video_renderer, "render_video", failing_render)
    run_video_render(pid, req)

    proj = find_project(pid)
    assert proj["render_status"] == "error"
    assert "FFmpeg crashed" in proj["render_error"]


def test_cancel_endpoints_when_project_not_found(client):
    """Calling /cancel or /cancel-render on a non-existent project returns 200 without crashing."""
    resp1 = client.post("/api/project/ghost_project_1/cancel")
    assert resp1.status_code == 200
    assert resp1.json() == {"status": "ok"}

    resp2 = client.post("/api/project/ghost_project_2/cancel-render")
    assert resp2.status_code == 200
    assert resp2.json() == {"status": "ok"}


def test_search_tracks_internal_error_returns_500(client, monkeypatch):
    """When downloader search raises an unexpected exception, /api/search returns HTTP 500."""

    def crash_search(query, limit=5):
        raise RuntimeError("Internal search provider failure")

    monkeypatch.setattr(main_mod.downloader, "search_tracks", crash_search)
    resp = client.post("/api/search", json={"query": "test query"})
    assert resp.status_code == 500
    assert "Internal search provider failure" in resp.json()["detail"]


def test_save_upload_file_bounded_oserror_during_cleanup(tmp_path):
    """save_upload_file_bounded handles OSError cleanly when unlinking temporary files."""
    import anyio

    target_file = tmp_path / "bounded_target.wav"
    upload = UploadFile(filename="test.wav", file=io.BytesIO(b""))

    # When total_bytes < min_bytes (1), raises HTTPException(400)
    with patch.object(Path, "unlink", side_effect=OSError("Unlink permission error")):
        with pytest.raises(HTTPException) as exc:
            anyio.run(save_upload_file_bounded, upload, target_file, 1000, 1)
        assert exc.value.status_code == 400


def test_validate_image_header_adversarial_payloads():
    """Exhaustively tests validate_image_header across short payloads, WebP RIFF variants, JPEG, and PNG."""
    # Length < 2
    assert validate_image_header(b"", ".jpg") is False
    assert validate_image_header(b"\xff", ".jpg") is False

    # JPEG
    assert validate_image_header(b"\xff\xd8\xff\xe0", ".jpg") is True
    assert validate_image_header(b"\xff\xd8\xff\xe0", ".jpeg") is True
    assert validate_image_header(b"\x00\x00\xff\xd8", ".jpg") is False

    # PNG
    assert validate_image_header(b"\x89PNG\r\n\x1a\n\x00\x00", ".png") is True
    assert validate_image_header(b"\x89PNG\x00\x00", ".png") is False

    # WebP: valid RIFF....WEBP
    valid_webp = b"RIFF\x20\x00\x00\x00WEBPVP8 "
    assert validate_image_header(valid_webp, ".webp") is True

    # WebP: RIFF but length < 12
    assert validate_image_header(b"RIFF\x10\x00\x00\x00", ".webp") is False

    # WebP: RIFF but tag is WAVE instead of WEBP
    assert validate_image_header(b"RIFF\x20\x00\x00\x00WAVEfmt ", ".webp") is False

    # Unsupported extension
    assert validate_image_header(b"GIF89a", ".gif") is False
    assert validate_image_header(b"BM\x00\x00", ".bmp") is False


def test_sanitize_upload_filename_edge_cases():
    """Tests sanitize_upload_filename with empty names, null bytes, and traversal characters."""
    assert sanitize_upload_filename(None, default_stem="fallback.wav") == "fallback.wav"
    assert sanitize_upload_filename("", default_stem="fallback.wav") == "fallback.wav"
    assert sanitize_upload_filename("\x00\x00", default_stem="fallback.wav") == "fallback.wav"
    assert sanitize_upload_filename("../../../etc/passwd", default_stem="file") == "passwd"
    assert sanitize_upload_filename("test space & symbols!.png") == "test_space___symbols_.png"


def test_pydantic_schema_adversarial_boundaries():
    """Stresses Pydantic models with non-finite floats and non-monotonic word sequences."""
    # WordTimingSchema: end_time earlier than start_time
    with pytest.raises(ValueError):
        WordTimingSchema(word="sing", start_time=2.0, end_time=1.0)

    # WordTimingSchema: non-finite float
    with pytest.raises(ValueError):
        WordTimingSchema(word="sing", start_time=float("nan"), end_time=1.0)

    # LyricLineSchema: non-monotonic word sequence
    words = [
        WordTimingSchema(word="word1", start_time=1.0, end_time=1.5),
        WordTimingSchema(word="word2", start_time=0.8, end_time=2.0),
    ]
    with pytest.raises(ValueError, match="Non-monotonic word timing"):
        LyricLineSchema(text="word1 word2", start_time=0.0, end_time=3.0, words=words)

    # ProcessRequest: invalid bare ID format (invalid characters)
    with pytest.raises(ValueError, match="Invalid YouTube video ID"):
        ProcessRequest(url_or_id="invalid@id!")


# ==============================================================================
# 2. AudioAligner Adversarial White-Box Hardening
# ==============================================================================


def test_aligner_empty_lines_and_silent_audio():
    """Tests align_lyrics returns [] for empty lines, and handles pure silent audio gracefully."""
    aligner = AudioAligner()
    assert aligner.align_lyrics("dummy.wav", []) == []

    # Corrupted audio file read error falls back to _fallback_distribute_words
    corrupt_lines = [{"id": 0, "text": "Hello world", "start_time": 1.0, "end_time": 3.0}]
    fallback_res = aligner.align_lyrics("/non/existent/path.wav", corrupt_lines)
    assert len(fallback_res) == 1
    assert len(fallback_res[0]["words"]) == 2
    assert fallback_res[0]["words"][0]["word"] == "Hello"
    assert fallback_res[0]["words"][1]["word"] == "world"


def test_aligner_all_zero_timestamps_variations(tmp_path):
    """Tests align_lyrics all-zero timestamps across short, long, and 0-duration audio."""
    aligner = AudioAligner()

    # 1. Audio duration > 10.0 seconds
    long_wav = tmp_path / "long_silence.wav"
    generate_sine_wave_wav(long_wav, duration=12.0, freq=0.0)
    lines = [
        {"id": 0, "text": "Line one", "start_time": 0.0, "end_time": 0.0},
        {"id": 1, "text": "Line two", "start_time": 0.0, "end_time": 0.0},
    ]
    res_long = aligner.align_lyrics(str(long_wav), lines)
    assert len(res_long) == 2
    assert res_long[0]["start_time"] >= 0.0
    assert res_long[1]["end_time"] > res_long[0]["end_time"]

    # 2. Audio duration between 0 and 10.0 seconds
    short_wav = tmp_path / "short_silence.wav"
    generate_sine_wave_wav(short_wav, duration=3.0, freq=0.0)
    res_short = aligner.align_lyrics(str(short_wav), lines)
    assert len(res_short) == 2

    # 3. Line where l_end <= l_start
    invalid_lines = [{"id": 0, "text": "Single line", "start_time": 5.0, "end_time": 2.0}]
    res_clamped = aligner.align_lyrics(str(short_wav), invalid_lines)
    assert res_clamped[0]["end_time"] > res_clamped[0]["start_time"]

    # 4. Line with empty text / no words
    empty_text_lines = [{"id": 0, "text": "   ", "start_time": 1.0, "end_time": 2.0}]
    res_empty = aligner.align_lyrics(str(short_wav), empty_text_lines)
    assert res_empty[0]["words"] == []


def test_aligner_syllable_weights_and_onset_nudging(tmp_path):
    """Tests AudioAligner onset nudging and vowel-aware syllable weighting with active audio."""
    aligner = AudioAligner()
    # Generate 4.0s sine wave audio with a burst
    wav_path = tmp_path / "burst.wav"
    generate_sine_wave_wav(wav_path, duration=4.0, freq=440.0)

    lines = [
        {
            "id": 0,
            "text": "Supercalifragilistic is wonderful",
            "start_time": 0.5,
            "end_time": 3.5,
        }
    ]
    aligned = aligner.align_lyrics(str(wav_path), lines)
    words = aligned[0]["words"]
    assert len(words) == 3
    # First word has many vowels, should receive longer duration than 'is'
    dur_word1 = words[0]["end_time"] - words[0]["start_time"]
    dur_word2 = words[1]["end_time"] - words[1]["start_time"]
    assert dur_word1 > dur_word2


def test_aligner_internal_exception_triggers_fallback(monkeypatch):
    """When an unexpected exception occurs inside align_lyrics, it falls back to _fallback_distribute_words."""
    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Resilience test", "start_time": 1.0, "end_time": 2.0}]

    with patch("soundfile.read", side_effect=Exception("Corrupted memory decode")):
        result = aligner.align_lyrics("dummy.wav", lines)
    assert len(result) == 1
    assert result[0]["text"] == "Resilience test"
    assert len(result[0]["words"]) == 2


# ==============================================================================
# 3. AudioMixer Dynamic Sample Rate & Error Cleanups
# ==============================================================================


def test_audio_mixer_sample_rate_inspection(tmp_path):
    """Tests _get_sample_rate with soundfile failure and ffprobe fallback."""
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")
    valid_wav = tmp_path / "sample.wav"
    generate_sine_wave_wav(valid_wav, duration=0.5, sr=48000)

    # 1. Normal inspection via soundfile.info
    assert mixer._get_sample_rate(str(valid_wav)) == 48000

    # 2. soundfile.info fails, ffprobe fallback succeeds
    with patch("soundfile.info", side_effect=RuntimeError("Format unknown")):
        probe_mock = MagicMock()
        probe_mock.returncode = 0
        probe_mock.stdout = "48000\n"
        with patch("subprocess.run", return_value=probe_mock):
            rate = mixer._get_sample_rate(str(valid_wav))
            assert rate == 48000

    # 3. Both soundfile.info and ffprobe fail -> returns default 44100
    with (
        patch("soundfile.info", side_effect=RuntimeError("Fail")),
        patch("subprocess.run", side_effect=FileNotFoundError("No ffprobe")),
    ):
        assert mixer._get_sample_rate(str(valid_wav), default=44100) == 44100


def test_audio_mixer_invalid_guide_volume_type_fallback(tmp_path):
    """Passing non-numeric objects to guide_volume safely falls back to 0.0."""
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")
    inst_wav = tmp_path / "inst.wav"
    generate_sine_wave_wav(inst_wav, duration=0.5)

    # guide_volume as invalid string or object
    out = mixer.mix_and_shift(str(inst_wav), semitones=0, guide_volume="invalid_volume")
    assert Path(out).exists()


def test_audio_mixer_ffmpeg_failure_and_temp_file_cleanup(tmp_path):
    """FFmpeg failure unlinks temporary file and raises structured RuntimeError."""
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")
    inst_wav = tmp_path / "inst.wav"
    generate_sine_wave_wav(inst_wav, duration=0.5)

    fail_res = MagicMock()
    fail_res.returncode = 1
    fail_res.stderr = "FFmpeg: Invalid filter complex syntax"

    with (
        patch("subprocess.run", return_value=fail_res),
        pytest.raises(RuntimeError, match="FFmpeg audio mixing failed"),
    ):
        mixer.mix_and_shift(str(inst_wav), semitones=2)


def test_audio_mixer_ffmpeg_timeout_cleanup(tmp_path):
    """FFmpeg timeout unlinks temporary file and raises structured RuntimeError."""
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")
    inst_wav = tmp_path / "inst.wav"
    generate_sine_wave_wav(inst_wav, duration=0.5)

    with (
        patch("subprocess.run", side_effect=subprocess.TimeoutExpired(cmd="ffmpeg", timeout=5)),
        pytest.raises(RuntimeError, match="FFmpeg audio mixing timed out"),
    ):
        mixer.mix_and_shift(str(inst_wav), semitones=0, timeout=5)


# ==============================================================================
# 4. TrackDownloader White-Box URL Parsing & Client Profile Fallback
# ==============================================================================


def test_downloader_extract_video_id_adversarial_paths():
    """Tests extract_video_id against shortlinks, malformed paths, and non-YouTube URLs."""
    dl = TrackDownloader()

    # youtu.be with no ID or invalid chars
    assert dl.extract_video_id("https://youtu.be/") is None
    assert dl.extract_video_id("https://youtu.be/too_short") is None

    # youtube.com/shorts with insufficient path parts
    assert dl.extract_video_id("https://www.youtube.com/shorts") is None
    assert dl.extract_video_id("https://www.youtube.com/shorts/") is None
    assert dl.extract_video_id("https://www.youtube.com/shorts/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    # youtube.com/embed
    assert dl.extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert dl.extract_video_id("https://www.youtube.com/embed/") is None

    # youtube.com/v/
    assert dl.extract_video_id("https://www.youtube.com/v/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert dl.extract_video_id("https://www.youtube.com/v/") is None

    # youtube.com/live/
    assert dl.extract_video_id("https://www.youtube.com/live/dQw4w9WgXcQ") == "dQw4w9WgXcQ"
    assert dl.extract_video_id("https://www.youtube.com/live/") is None

    # Non-YouTube hosts
    assert dl.extract_video_id("https://vimeo.com/12345678901") is None
    assert dl.extract_video_id("https://notyoutube.com/watch?v=dQw4w9WgXcQ") is None

    # Exception inside urlparse
    with patch("backend.services.downloader.urlparse", side_effect=Exception("Parsing error")):
        assert dl.extract_video_id("https://youtube.com/watch?v=dQw4w9WgXcQ") is None


def test_downloader_search_tracks_empty_and_corrupt_entries(tmp_path):
    """Tests search_tracks when yt-dlp returns no entries or empty elements."""
    dl = TrackDownloader(output_dir=tmp_path / "dl")

    # yt-dlp extract_info returns None or no entries
    with patch("backend.services.downloader.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = mock_ydl_cls.return_value.__enter__.return_value
        mock_ydl.extract_info.return_value = {"entries": None}
        assert dl.search_tracks("some query") == []

    # yt-dlp entries contain None elements
    with patch("backend.services.downloader.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = mock_ydl_cls.return_value.__enter__.return_value
        mock_ydl.extract_info.return_value = {
            "entries": [None, {"id": "12345678901", "title": "Song", "duration": 100}]
        }
        results = dl.search_tracks("some query")
        assert len(results) == 1
        assert results[0]["id"] == "12345678901"

    # yt-dlp raises exception
    with patch("backend.services.downloader.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = mock_ydl_cls.return_value.__enter__.return_value
        mock_ydl.extract_info.side_effect = Exception("Network down")
        assert dl.search_tracks("query") == []


def test_downloader_cached_audio_thumbnail_fallback(tmp_path):
    """Tests cached audio reuse finds candidate thumbnails and falls back when metadata refresh fails."""
    dl = TrackDownloader(output_dir=tmp_path / "dl")
    vid_id = "cached_trk1"
    cached_wav = tmp_path / "dl" / f"{vid_id}.wav"
    cached_thumb = tmp_path / "dl" / f"{vid_id}.png"
    generate_sine_wave_wav(cached_wav, duration=0.5)
    generate_test_image(cached_thumb)

    # When metadata refresh raises exception, falls back to Track {id}
    with patch("backend.services.downloader.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = mock_ydl_cls.return_value.__enter__.return_value
        mock_ydl.extract_info.side_effect = Exception("Metadata offline")
        info = dl.extract_info_and_download(vid_id)
        assert info["id"] == vid_id
        assert info["title"] == f"Track {vid_id}"
        assert info["audio_path"] == str(cached_wav)
        assert info["thumbnail_path"] == str(cached_thumb)


def test_downloader_all_client_profiles_fail_raises_runtime_error(tmp_path):
    """Tests extract_info_and_download raises RuntimeError when all client profiles fail."""
    dl = TrackDownloader(output_dir=tmp_path / "dl")
    with patch("backend.services.downloader.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = mock_ydl_cls.return_value.__enter__.return_value
        mock_ydl.extract_info.side_effect = Exception("Sign in required")
        with pytest.raises(RuntimeError, match="across all client profiles"):
            dl.extract_info_and_download("https://www.youtube.com/watch?v=dQw4w9WgXcQ")


def test_downloader_thumbnail_download_via_requests(tmp_path):
    """Tests direct thumbnail download via requests.get fallback when thumb file is not on disk."""
    dl = TrackDownloader(output_dir=tmp_path / "dl")
    vid_id = "thumb_dl_trk"
    wav_path = tmp_path / "dl" / f"{vid_id}.wav"
    generate_sine_wave_wav(wav_path, duration=0.5)

    mock_meta = {
        "id": vid_id,
        "title": "Artist - Song (Official Video)",
        "artist": "Artist",
        "duration": 120,
        "thumbnail": "https://img.youtube.com/vi/thumb.jpg",
    }

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.content = b"\xff\xd8\xff\xe0dummy_jpeg"

    with patch("backend.services.downloader.yt_dlp.YoutubeDL") as mock_ydl_cls:
        mock_ydl = mock_ydl_cls.return_value.__enter__.return_value
        mock_ydl.extract_info.return_value = mock_meta
        with patch("requests.get", return_value=mock_resp):
            info = dl.extract_info_and_download(f"https://www.youtube.com/watch?v={vid_id}")
            assert info["id"] == vid_id
            assert info["title"] == "Song"
            assert info["artist"] == "Artist"
            assert info["thumbnail_path"] is not None


# ==============================================================================
# 5. LyricsService Fallback Paths & LRC Parser Boundary Hardening
# ==============================================================================


def test_lyrics_syncedlyrics_fallback_and_timeout():
    """Tests LyricsService syncedlyrics fallback when LRCLIB returns None, and timeout handling."""
    svc = LyricsService()

    # 1. LRCLIB returns None, syncedlyrics succeeds
    with (
        patch.object(svc, "_fetch_from_lrclib", return_value=None),
        patch("syncedlyrics.search", return_value="[00:01.00] Fallback line"),
    ):
        res = svc.fetch_lyrics("Song", "Artist")
        assert res["source"] == "syncedlyrics"
        assert res["synced"] is True
        assert len(res["lines"]) == 1

    # 2. LRCLIB returns None, syncedlyrics fails / returns None -> returns source='none'
    with (
        patch.object(svc, "_fetch_from_lrclib", return_value=None),
        patch("syncedlyrics.search", return_value=None),
    ):
        res_none = svc.fetch_lyrics("Song", "Artist")
        assert res_none["source"] == "none"
        assert res_none["synced"] is False
        assert res_none["lines"] == []


def test_lyrics_lrclib_search_endpoint_fallback():
    """When exact LRCLIB match returns 404, falls back to search endpoint."""
    svc = LyricsService()

    def mock_requests_get(url, params=None, timeout=5):
        mock_r = MagicMock()
        if "/get" in url:
            mock_r.status_code = 404
        elif "/search" in url:
            mock_r.status_code = 200
            mock_r.json.return_value = [
                {"syncedLyrics": "[00:02.00] Search match", "plainLyrics": "Search match"}
            ]
        return mock_r

    with patch("requests.get", side_effect=mock_requests_get):
        res = svc._fetch_from_lrclib("Song", "Artist", duration=180)
        assert res is not None
        assert res["source"] == "lrclib_search"
        assert res["synced"] is True
        assert len(res["lines"]) == 1


def test_lyrics_parse_lrc_boundary_time_gaps():
    """Tests parse_lrc caps long time gaps (>8.0s) between consecutive lines to 4.5s."""
    svc = LyricsService()
    lrc_content = (
        "[00:01.00] Line one\n"
        "[00:20.00] Line two after a 19 second guitar solo\n"
        "[00:25.00] Final line\n"
    )
    lines = svc.parse_lrc(lrc_content)
    assert len(lines) == 3
    # Line 1 start is 1.0; since next line is at 20.0 (gap > 8s), end_time is capped to 1.0 + 4.5 = 5.5
    assert lines[0]["start_time"] == 1.0
    assert lines[0]["end_time"] == 5.5
    # Final line end_time is start + 4.0 = 29.0
    assert lines[2]["end_time"] == 29.0


# ==============================================================================
# 6. AudioSeparator Cache Invalidation & Force-Kill Hardening
# ==============================================================================


def test_separator_is_valid_stem_oserror_handling(tmp_path):
    """_is_valid_stem returns False when stat() encounters an OSError."""
    sep = AudioSeparator(output_base_dir=tmp_path / "stems")
    stem = tmp_path / "stem.wav"
    stem.write_bytes(b"RIFF" + b"\x00" * 50)

    with patch.object(Path, "stat", side_effect=OSError("I/O error")):
        assert sep._is_valid_stem(stem) is False


def test_separator_cached_stems_reuse(tmp_path):
    """Valid cached stems are returned immediately without running Demucs."""
    sep = AudioSeparator(output_base_dir=tmp_path / "stems")
    track_id = "cached_demucs_trk"
    target_dir = tmp_path / "stems" / track_id
    target_dir.mkdir(parents=True)
    vocals = target_dir / "vocals.wav"
    inst = target_dir / "instrumental.wav"
    generate_sine_wave_wav(vocals, duration=0.5)
    generate_sine_wave_wav(inst, duration=0.5)

    input_wav = tmp_path / "input.wav"
    generate_sine_wave_wav(input_wav, duration=0.5)

    cb_mock = MagicMock()
    res = sep.separate_stems(str(input_wav), track_id, progress_callback=cb_mock)
    assert res["vocals_path"] == str(vocals)
    assert res["instrumental_path"] == str(inst)
    cb_mock.assert_called_with(100.0, "Found cached vocal stems", 0)


def test_separator_corrupt_cached_stems_purged(tmp_path):
    """Corrupt 0-byte stems in cache are deleted prior to running separation."""
    sep = AudioSeparator(output_base_dir=tmp_path / "stems")
    track_id = "corrupt_cache_trk"
    target_dir = tmp_path / "stems" / track_id
    target_dir.mkdir(parents=True)
    vocals = target_dir / "vocals.wav"
    inst = target_dir / "instrumental.wav"
    vocals.write_bytes(b"")  # 0 bytes
    inst.write_bytes(b"")

    input_wav = tmp_path / "input.wav"
    generate_sine_wave_wav(input_wav, duration=0.5)

    # When Demucs runs, simulate creating valid stems
    def mock_popen(*args, **kwargs):
        proc = MagicMock()
        proc.stderr = iter(["100%|██████████| 1/1 [00:01<00:00, 1.00it/s]\n"])
        proc.poll.return_value = 0
        proc.returncode = 0
        proc.wait.return_value = 0

        # Create output in Demucs format
        out_sub = target_dir / "htdemucs" / "input"
        out_sub.mkdir(parents=True, exist_ok=True)
        generate_sine_wave_wav(out_sub / "vocals.wav", duration=0.5)
        generate_sine_wave_wav(out_sub / "no_vocals.wav", duration=0.5)
        return proc

    with patch("subprocess.Popen", side_effect=mock_popen):
        res = sep.separate_stems(str(input_wav), track_id)
        assert Path(res["vocals_path"]).stat().st_size > 0
        assert Path(res["instrumental_path"]).stat().st_size > 0


def test_separator_process_hanging_triggers_force_kill(tmp_path):
    """If Demucs subprocess hangs on termination, force kill is invoked."""
    sep = AudioSeparator(output_base_dir=tmp_path / "stems")
    input_wav = tmp_path / "input.wav"
    generate_sine_wave_wav(input_wav, duration=0.5)

    hang_proc = MagicMock()
    hang_proc.poll.return_value = None  # Process still alive
    hang_proc.stderr = iter(["Error in model forward pass\n"])
    hang_proc.returncode = 1
    # terminate wait times out
    hang_proc.wait.side_effect = [0, subprocess.TimeoutExpired(cmd="demucs", timeout=2), 0]

    with patch("subprocess.Popen", return_value=hang_proc), pytest.raises(RuntimeError):
        sep.separate_stems(str(input_wav), "hang_trk")
    hang_proc.kill.assert_called_once()


# ==============================================================================
# 7. VideoRenderer ASS Formatting & Ambient Gradient Fallback
# ==============================================================================


def test_video_renderer_format_ass_time_boundary():
    """Tests _format_ass_time clamping when centiseconds reach 100."""
    # 0.999 seconds should produce .99 instead of .100
    formatted = VideoRenderer._format_ass_time(0.999)
    assert formatted.endswith(".99")

    # Hours formatting
    formatted_hr = VideoRenderer._format_ass_time(3665.25)
    assert formatted_hr == "1:01:05.25"


def test_video_renderer_escape_ass_text_newlines_and_braces():
    """Tests _escape_ass_text replaces literal newlines with spaces and escapes ASS tags."""
    assert VideoRenderer._escape_ass_text(None) == ""
    assert VideoRenderer._escape_ass_text("") == ""
    text = "Line with\r\nnewline and {override} \\slash"
    escaped = VideoRenderer._escape_ass_text(text)
    assert "\r" not in escaped and "\n" not in escaped
    assert "\\{" in escaped
    assert "\\}" in escaped
    assert "\\\\" in escaped


def test_video_renderer_generate_ass_plain_text_lines(tmp_path):
    """Tests generate_ass_subtitles when lines have text but words list is empty."""
    renderer = VideoRenderer(output_dir=tmp_path / "render_out")
    ass_path = tmp_path / "render_out" / "plain.ass"
    lines = [
        {
            "id": 0,
            "text": "Plain lyric line without tokens",
            "start_time": 4.0,
            "end_time": 7.0,
            "words": [],
        }
    ]
    renderer.generate_ass_subtitles(lines, ass_path)
    assert ass_path.exists()
    content = ass_path.read_text(encoding="utf-8")
    assert "Plain lyric line without tokens" in content
    # First line starts at 4.0s (>= 3.0s), so Countdown style cue is included
    assert "Countdown" in content


def test_video_renderer_ambient_gradient_fallback_when_no_images(tmp_path):
    """When neither custom background nor thumbnail exists, FFmpeg renders with lavfi color gradient."""
    renderer = VideoRenderer(output_dir=tmp_path / "render_out")
    audio_wav = tmp_path / "audio.wav"
    ass_path = tmp_path / "subs.ass"
    out_mp4 = tmp_path / "render_out" / "out.mp4"
    generate_sine_wave_wav(audio_wav, duration=0.5)
    ass_path.write_text("[Script Info]\nTitle: Test\n", encoding="utf-8")

    captured_cmd = []

    def mock_popen(cmd, *args, **kwargs):
        captured_cmd.extend(cmd)
        proc = MagicMock()
        proc.stdout = iter(["progress=end\n"])
        proc.stderr = iter([])
        proc.poll.return_value = 0
        proc.returncode = 0
        proc.wait.return_value = 0
        return proc

    with patch("subprocess.Popen", side_effect=mock_popen):
        renderer.render_video(
            audio_path=str(audio_wav),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=out_mp4,
            thumbnail_path=None,
            custom_bg_path=None,
        )

    # Verify lavfi color input was used as background
    assert "lavfi" in captured_cmd
    assert any("color=c=0x0f111a" in arg for arg in captured_cmd)


def test_video_renderer_cancellation_terminates_ffmpeg(tmp_path):
    """Video rendering terminates FFmpeg immediately when cancel_event is signaled."""
    renderer = VideoRenderer(output_dir=tmp_path / "render_out")
    audio_wav = tmp_path / "audio.wav"
    ass_path = tmp_path / "subs.ass"
    out_mp4 = tmp_path / "render_out" / "cancelled.mp4"
    generate_sine_wave_wav(audio_wav, duration=0.5)
    ass_path.write_text("[Script Info]\n", encoding="utf-8")

    cancel_ev = threading.Event()
    cancel_ev.set()  # Signal cancellation immediately

    mock_proc = MagicMock()
    mock_proc.stdout = iter(["frame=1\n", "progress=continue\n"])
    mock_proc.stderr = iter([])
    mock_proc.poll.return_value = None

    with (
        patch("subprocess.Popen", return_value=mock_proc),
        pytest.raises(RuntimeError, match="cancelled by user"),
    ):
        renderer.render_video(
            audio_path=str(audio_wav),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=out_mp4,
            cancel_event=cancel_ev,
        )
    mock_proc.terminate.assert_called()


# ==============================================================================
# 8. YouTube Metadata Package Generator & Config Origins Parsing
# ==============================================================================


def test_youtube_metadata_package_generator_edge_cases():
    """Tests generate_youtube_package with empty lines, negative semitones, and guide vocals."""
    # 1. Empty lines list
    pkg_empty = YouTubeMetadataService.generate_youtube_package(
        title="Empty Track",
        artist="Solo Singer",
        lines=[],
        semitones=-3,
        has_guide_vocal=True,
    )
    assert "-3 Semitones" in pkg_empty["key_note"]
    assert "Instrumental with Backing/Guide" in pkg_empty["description"]
    # Only Intro chapter should be present
    assert "00:00 - Intro" in pkg_empty["description"]
    assert "Lyrics Start" not in pkg_empty["description"]

    # 2. Lines with timestamp
    pkg_with_lines = YouTubeMetadataService.generate_youtube_package(
        title="Filled Track",
        artist="Solo Singer",
        lines=[{"text": "First verse", "start_time": 65.0}],
        semitones=0,
        has_guide_vocal=False,
    )
    assert "Original Key" in pkg_with_lines["key_note"]
    assert "01:05 - Lyrics Start" in pkg_with_lines["description"]

    # 3. OAuth configuration status
    assert YouTubeMetadataService.is_oauth_configured() is False


def test_config_allowed_origins_parsing(monkeypatch):
    """Tests parsing of comma-separated ALLOWED_ORIGINS environment variable."""
    import importlib

    monkeypatch.setenv("ALLOWED_ORIGINS", "https://studio.example.com, https://app.example.com")
    import backend.config as cfg

    importlib.reload(cfg)
    assert "https://studio.example.com" in cfg.ALLOWED_ORIGINS
    assert "https://app.example.com" in cfg.ALLOWED_ORIGINS
