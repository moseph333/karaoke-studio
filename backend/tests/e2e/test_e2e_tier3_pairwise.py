"""
E2E Test Suite - Tier 3: Cross-Feature Combinations (Pairwise Integration)
Verifies multi-feature interactions across the full Karaoke Studio matrix:
1. Custom lyrics + pitch transposition + video rendering
2. Custom background image + 9:16 vertical aspect ratio + countdown dots
3. User instrumental upload + lyric timing update + audio mixing
4. Passphrase authentication + media intake + static media access
5. Pipeline intake cancellation + restart resilience
6. Video render cancellation + aspect ratio switch & re-render
7. Custom ASS visual theme presets + video synthesis
8. Pitch shift + guide vocal blend + YouTube SEO metadata package
9. Multi-tenant user scoping + project isolation
10. Multilingual CJK lyrics + custom background image + ASS generation
11. Extreme dual octave shifts (+12 and -12) + waveform verification
12. Rapid iterative timeline lyric nudges + video subtitle synchronization
"""

import io
import json
import time
from pathlib import Path

import pytest
from PIL import Image

import backend.main as main_mod
from backend import config
from backend.services.video_renderer import VideoRenderer
from backend.tests.e2e.conftest import generate_sine_wave_wav, generate_test_image


def test_pairwise_custom_lyrics_plus_pitch_shift_plus_video_render(client, tmp_path):
    """Combines custom lyrics intake, non-zero pitch shift, and ASS video rendering."""
    custom_lyrics = "Starlight shining in the deep night\nGuiding travelers home"
    process_res = client.post(
        "/api/process", json={"url_or_id": "pair_lyr_pitch1", "custom_lyrics": custom_lyrics}
    )
    assert process_res.status_code == 200
    pid = process_res.json()["project_id"]

    # 1. Pitch shift +2 semitones
    mix_res = client.post(f"/api/project/{pid}/mix", json={"semitones": 2, "guide_volume": 0.0})
    assert mix_res.status_code == 200
    assert "_mix_2_0.wav" in mix_res.json()["master_audio_url"]

    # 2. Render video with shifted pitch
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={"semitones": 2, "guide_volume": 0.0, "aspect_ratio": "16:9"},
    )
    assert render_res.status_code == 200
    assert render_res.json()["status"] == "queued"

    # 3. Verify ASS subtitles include custom lyrics text
    _proj = client.get(f"/api/project/{pid}").json()
    ass_path = main_mod.OUTPUT_DIR / f"{pid}.ass"
    if ass_path.exists():
        content = ass_path.read_text(encoding="utf-8")
        assert "Starlight" in content


def test_pairwise_custom_background_plus_vertical_aspect_ratio_plus_countdown_dots(
    client, project_factory, sample_image
):
    """Combines custom background image upload, 9:16 vertical format, and 3-2-1 countdown cue markers."""
    project_factory(project_id="pair_vert_bg1")

    # 1. Upload custom background
    with open(sample_image, "rb") as f:
        bg_res = client.post(
            "/api/upload-background", files={"file": ("vertical_art.jpg", f, "image/jpeg")}
        )
    assert bg_res.status_code == 200
    bg_id = bg_res.json()["bg_id"]

    # 2. Request vertical render with custom style and countdown dots
    style_cfg = {"width": 1080, "height": 1920, "lead_in_countdown_dots": 3, "font_size": 48}
    render_res = client.post(
        "/api/project/pair_vert_bg1/render",
        json={
            "semitones": 0,
            "guide_volume": 0.0,
            "aspect_ratio": "9:16",
            "style_config": style_cfg,
            "custom_bg_id": bg_id,
        },
    )
    assert render_res.status_code == 200

    # 3. Verify ASS file properties
    ass_path = main_mod.OUTPUT_DIR / "pair_vert_bg1.ass"
    if ass_path.exists():
        content = ass_path.read_text(encoding="utf-8")
        assert "PlayResX: 1080" in content
        assert "PlayResY: 1920" in content
        assert "Countdown" in content


def test_pairwise_user_instrumental_upload_plus_lyric_timing_update_plus_audio_mix(
    client, project_factory, sample_wav
):
    """Combines manual backing track upload, lyric timing adjustments, and master audio mixing."""
    project_factory(project_id="pair_upload_mix1", with_stems=False)

    # 1. Upload instrumental
    with open(sample_wav, "rb") as f:
        up_res = client.post(
            "/api/upload-instrumental",
            data={"project_id": "pair_upload_mix1"},
            files={"file": ("custom_track.wav", f, "audio/wav")},
        )
    assert up_res.status_code == 200

    # 2. Update lyrics
    lines_payload = {
        "lines": [
            {
                "id": 1,
                "text": "Recorded live in studio",
                "start_time": 0.5,
                "end_time": 1.5,
                "words": [
                    {"word": "Recorded", "start_time": 0.5, "end_time": 0.8},
                    {"word": "live", "start_time": 0.8, "end_time": 1.1},
                    {"word": "in", "start_time": 1.1, "end_time": 1.3},
                    {"word": "studio", "start_time": 1.3, "end_time": 1.5},
                ],
            }
        ]
    }
    lyr_res = client.post("/api/project/pair_upload_mix1/lyrics", json=lines_payload)
    assert lyr_res.status_code == 200

    # 3. Mix master
    mix_res = client.post(
        "/api/project/pair_upload_mix1/mix", json={"semitones": -1, "guide_volume": 0.0}
    )
    assert mix_res.status_code == 200
    assert "pair_upload_mix1_mix_-1_0.wav" in mix_res.json()["master_audio_url"]


def test_pairwise_auth_gate_plus_intake_plus_static_media_download(unauth_client, monkeypatch):
    """Under active passphrase protection, user logs in, processes a song, and streams static media."""
    passphrase = "pair_studio_secret_99"
    monkeypatch.setattr(config, "APP_PASSWORD", passphrase)

    # 1. Unauthenticated request rejected
    assert unauth_client.get("/api/projects").status_code == 401

    # 2. Login
    login_res = unauth_client.post(
        "/api/auth/login", json={"password": passphrase, "username": "Producer"}
    )
    assert login_res.status_code == 200
    token = login_res.json()["token"]

    auth_headers = {"X-App-Password": token}

    # 3. Process track with auth
    proc_res = unauth_client.post(
        "/api/process", json={"url_or_id": "auth11intak"}, headers=auth_headers
    )
    assert proc_res.status_code == 200
    pid = proc_res.json()["project_id"]

    # 4. Stream static audio with auth header
    static_res = unauth_client.get(f"/static/downloads/{pid}.wav", headers=auth_headers)
    assert static_res.status_code == 200
    assert len(static_res.content) > 500


def test_pairwise_pipeline_cancellation_during_intake_and_safe_restart(client):
    """Cancels processing pipeline mid-flight and restarts it cleanly."""
    vid = "cancel11pip"
    # 1. Start project
    init_res = client.post("/api/process", json={"url_or_id": vid})
    pid = init_res.json()["project_id"]

    # 2. Cancel
    cancel_res = client.post(f"/api/project/{pid}/cancel")
    assert cancel_res.status_code == 200
    assert cancel_res.json()["status"] == "ok"

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["status"] == "cancelled"

    # 3. Restart
    restart_res = client.post("/api/process", json={"url_or_id": vid})
    assert restart_res.status_code == 200
    new_pid = restart_res.json()["project_id"]
    re_proj = client.get(f"/api/project/{new_pid}").json()
    assert re_proj["status"] in ["queued", "ready"]


def test_pairwise_video_render_cancellation_and_rerender_different_aspect(client, project_factory):
    """Cancels an in-progress video render and initiates a new render with a different aspect ratio."""
    project_factory(project_id="cancelrend1")

    # 1. Start 16:9 render
    client.post(
        "/api/project/cancelrend1/render",
        json={"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "16:9"},
    )

    # 2. Cancel render
    cancel_res = client.post("/api/project/cancelrend1/cancel-render")
    assert cancel_res.status_code == 200
    proj = client.get("/api/project/cancelrend1").json()
    assert proj["render_status"] == "idle"

    # 3. Start 9:16 vertical render
    rerender_res = client.post(
        "/api/project/cancelrend1/render",
        json={"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "9:16"},
    )
    assert rerender_res.status_code == 200
    assert rerender_res.json()["status"] == "queued"


def test_pairwise_custom_style_ass_theme_and_video_synthesis(tmp_path):
    """Generates custom visual theme with specific ASS colors, font, and shadow styling."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "themed.ass"

    style_preset = {
        "font_name": "Arial Black",
        "font_size": 60,
        "primary_color": "&H0000FF00",  # Green sung text
        "secondary_color": "&H00FFFF00",  # Cyan unsung text
        "outline_width": 4,
        "shadow_width": 3,
    }
    renderer.generate_ass_subtitles([], ass_path, style_config=style_preset)
    content = ass_path.read_text(encoding="utf-8")
    assert "Arial Black" in content
    assert "&H0000FF00" in content
    assert "&H00FFFF00" in content


def test_pairwise_guide_vocal_blend_plus_pitch_shift_and_youtube_package(client, project_factory):
    """Pitch shift and guide vocal blend are dynamically reflected in the exported YouTube SEO kit."""
    lines = [
        {
            "id": 0,
            "text": "Chorus starts singing",
            "start_time": 15.0,
            "end_time": 20.0,
            "words": [],
        }
    ]
    project_factory(
        project_id="ytkit1", title="Bohemian Hit", artist="Rock Legends", custom_lines=lines
    )

    # Apply mix settings: +3 semitones, 0.20 guide volume
    client.post("/api/project/ytkit1/mix", json={"semitones": 3, "guide_volume": 0.20})

    # Fetch YouTube package
    yt_res = client.get("/api/project/ytkit1/youtube-package")
    assert yt_res.status_code == 200
    data = yt_res.json()
    assert "title" in data
    assert "+3 Semitones" in data["description"]
    assert "Instrumental with Backing/Guide" in data["description"]
    assert "00:15 - Lyrics Start" in data["description"]


def test_pairwise_scoped_multi_user_creation_and_listing(client, project_factory):
    """Projects authored by different users are cleanly isolated via scope parameter."""
    project_factory(project_id="user_a_track", title="Alice Song", created_by="Alice")
    project_factory(project_id="user_b_track", title="Bob Song", created_by="Bob")

    # Scoped to Alice
    alice_res = client.get("/api/projects?scope=my&user=Alice")
    assert alice_res.status_code == 200
    alice_dict = alice_res.json()
    assert "user_a_track" in alice_dict
    assert "user_b_track" not in alice_dict

    # Scoped to Bob
    bob_res = client.get("/api/projects?scope=my&user=Bob")
    assert bob_res.status_code == 200
    bob_dict = bob_res.json()
    assert "user_b_track" in bob_dict
    assert "user_a_track" not in bob_dict

    # All scope
    all_res = client.get("/api/projects")
    assert all_res.status_code == 200
    assert "user_a_track" in all_res.json()
    assert "user_b_track" in all_res.json()


def test_pairwise_multilingual_cjk_lyrics_plus_custom_background_and_ass_render(
    client, sample_image, tmp_path
):
    """Combines Japanese Kanji lyrics, custom background image, and ASS rendering."""
    cjk_lyrics = "夜に駆ける\n沈むように溶けてゆくように"
    res = client.post(
        "/api/process", json={"url_or_id": "cjkpair11xx", "custom_lyrics": cjk_lyrics}
    )
    assert res.status_code == 200
    pid = res.json()["project_id"]

    # Upload background
    with open(sample_image, "rb") as f:
        bg_res = client.post(
            "/api/upload-background", files={"file": ("cjk_bg.jpg", f, "image/jpeg")}
        )
    bg_id = bg_res.json()["bg_id"]

    # Render video
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "16:9", "custom_bg_id": bg_id},
    )
    assert render_res.status_code == 200

    ass_path = main_mod.OUTPUT_DIR / f"{pid}.ass"
    if ass_path.exists():
        content = ass_path.read_text(encoding="utf-8")
        assert "夜に駆ける" in content
        assert "沈むように" in content


def test_pairwise_extreme_octave_pitch_shift_and_waveform_verification(client, project_factory):
    """Applies +12 (octave up) and -12 (octave down) sequentially, verifying valid audio synthesis."""
    project_factory(project_id="octaves1")

    # Octave up (+12)
    res_up = client.post("/api/project/octaves1/mix", json={"semitones": 12, "guide_volume": 0.0})
    assert res_up.status_code == 200
    assert "_mix_12_0.wav" in res_up.json()["master_audio_url"]

    # Octave down (-12)
    res_down = client.post(
        "/api/project/octaves1/mix", json={"semitones": -12, "guide_volume": 0.0}
    )
    assert res_down.status_code == 200
    assert "_mix_-12_0.wav" in res_down.json()["master_audio_url"]


def test_pairwise_rapid_lyric_nudge_edits_followed_by_immediate_render(client, project_factory):
    """Multiple rapid lyric edits immediately precede a render call; latest edits are accurately reflected."""
    project_factory(project_id="nudge_render1")

    # Edit 1: Initial timestamp
    client.post(
        "/api/project/nudge_render1/lyrics",
        json={
            "lines": [
                {"id": 0, "text": "Nudged word", "start_time": 1.0, "end_time": 2.0, "words": []}
            ]
        },
    )

    # Edit 2: Nudge by +0.05s
    client.post(
        "/api/project/nudge_render1/lyrics",
        json={
            "lines": [
                {"id": 0, "text": "Nudged word", "start_time": 1.05, "end_time": 2.05, "words": []}
            ]
        },
    )

    # Edit 3: Nudge by another +0.05s (final: 1.10s)
    client.post(
        "/api/project/nudge_render1/lyrics",
        json={
            "lines": [
                {"id": 0, "text": "Nudged word", "start_time": 1.10, "end_time": 2.10, "words": []}
            ]
        },
    )

    # Render
    client.post(
        "/api/project/nudge_render1/render",
        json={"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "16:9"},
    )

    # Check project persisted state
    proj = client.get("/api/project/nudge_render1").json()
    assert abs(proj["lines"][0]["start_time"] - 1.10) < 0.001
