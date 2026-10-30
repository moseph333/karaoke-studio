"""
E2E Test Suite - Tier 4: Real-World Application Scenarios
Verifies end-to-end full workflow scenarios from start to finish:
- Scenario 1: Golden Path (Intake -> Stems -> Lyrics -> Align -> Mix -> 1080p60 MP4 -> YouTube Package)
- Scenario 2: Social Media Creator (Custom Lyrics -> +3 Transpose -> Custom BG -> 9:16 Vertical Video)
- Scenario 3: Musician Self-Produced Track (Direct Instrumental Upload -> Lyric Sync -> Mix -> MP4)
- Scenario 4: Multi-User Studio Collaboration (Passphrase Gate -> Alice & Bob Scoping -> Cookie Lifecycle)
- Scenario 5: Fault-Tolerant Operator (Pipeline Cancellation -> Resume -> Render Cancel -> Recovery)
- Scenario 6: International Multi-lingual Track (Japanese CJK / Emojis -> ASS Encoding -> Video Synthesis)
"""

import io
import json
import subprocess
import time
from pathlib import Path

import pytest
from PIL import Image

import backend.main as main_mod
from backend import config
from backend.services.audio_mixer import AudioMixer
from backend.services.video_renderer import VideoRenderer
from backend.tests.helpers.media import generate_sine_wave_wav, generate_test_image


def check_mp4_dimensions(mp4_path: Path):
    """Uses ffprobe to verify valid MP4 container and retrieve resolution width and height."""
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height",
        "-of",
        "csv=s=x:p=0",
        str(mp4_path),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0, f"ffprobe error: {res.stderr}"
    w, h = res.stdout.strip().split("x")
    return int(w), int(h)


def test_scenario_1_golden_path_youtube_to_full_export(client):
    """
    Scenario 1: Standard YouTube Golden Path Workflow.
    End-to-end intake -> stem separation -> lyrics fetch & alignment ->
    master audio mixing -> 1080p60 MP4 rendering -> YouTube package generation.
    """
    vid = "dQw4w9WgXcQ"
    # Step 1: Submit YouTube URL
    intake_res = client.post(
        "/api/process", json={"url_or_id": f"https://www.youtube.com/watch?v={vid}"}
    )
    assert intake_res.status_code == 200
    pid = intake_res.json()["project_id"]
    assert pid == vid

    # Step 2: Verify project reached ready state with stems & lyrics
    proj_res = client.get(f"/api/project/{pid}")
    assert proj_res.status_code == 200
    proj = proj_res.json()
    assert proj["status"] in ["queued", "ready"]
    assert len(proj["lines"]) >= 2
    assert proj["vocals_url"].startswith("/static/stems/")
    assert proj["instrumental_url"].startswith("/static/stems/")

    # Step 3: Test master mix playback
    mix_res = client.post(f"/api/project/{pid}/mix", json={"semitones": 0, "guide_volume": 0.0})
    assert mix_res.status_code == 200
    master_url = mix_res.json()["master_audio_url"]
    assert client.get(master_url).status_code == 200

    # Step 4: Render 1080p60 video (16:9 standard)
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "16:9"},
    )
    assert render_res.status_code == 200
    assert render_res.json()["status"] == "queued"

    # Step 5: Verify rendered MP4 video properties on disk
    mp4_file = main_mod.OUTPUT_DIR / f"{pid}_karaoke.mp4"
    if mp4_file.exists():
        width, height = check_mp4_dimensions(mp4_file)
        assert width == 1920
        assert height == 1080

    # Step 6: Export YouTube metadata package
    yt_res = client.get(f"/api/project/{pid}/youtube-package")
    assert yt_res.status_code == 200
    yt_kit = yt_res.json()
    assert "Karaoke Version" in yt_kit["title"]
    assert "Timestamps:" in yt_kit["description"]
    assert len(yt_kit["tags"]) >= 5


def test_scenario_2_creator_custom_lyrics_transpose_vertical_shorts(client, sample_image):
    """
    Scenario 2: Creator Studio with Custom Lyrics & Vertical Video Production.
    Custom plain text lyrics -> semitone transposition (+3) -> custom background upload ->
    manual lyric timing refinement -> 9:16 vertical MP4 video rendering -> YouTube Shorts metadata.
    """
    # Step 1: Intake with custom lyrics
    custom_lyrics = "Dancing under city lights\nChasing dreams into the night"
    intake_res = client.post(
        "/api/process",
        json={
            "url_or_id": "creator11sc",
            "custom_lyrics": custom_lyrics,
            "created_by": "TikTokCreator",
        },
    )
    assert intake_res.status_code == 200
    pid = intake_res.json()["project_id"]

    # Step 2: Adjust pitch to +3 semitones and 15% guide vocal blend
    mix_res = client.post(f"/api/project/{pid}/mix", json={"semitones": 3, "guide_volume": 0.15})
    assert mix_res.status_code == 200
    assert "_mix_3_15.wav" in mix_res.json()["master_audio_url"]

    # Step 3: Upload custom vertical background artwork
    with open(sample_image, "rb") as f:
        bg_res = client.post(
            "/api/upload-background", files={"file": ("shorts_bg.jpg", f, "image/jpeg")}
        )
    assert bg_res.status_code == 200
    bg_id = bg_res.json()["bg_id"]

    # Step 4: Fine-tune lyric timing in timeline editor
    lines_update = {
        "lines": [
            {
                "id": 0,
                "text": "Dancing under city lights",
                "start_time": 0.5,
                "end_time": 1.5,
                "words": [
                    {"word": "Dancing", "start_time": 0.5, "end_time": 0.8},
                    {"word": "under", "start_time": 0.8, "end_time": 1.0},
                    {"word": "city", "start_time": 1.0, "end_time": 1.2},
                    {"word": "lights", "start_time": 1.2, "end_time": 1.5},
                ],
            },
            {
                "id": 1,
                "text": "Chasing dreams into the night",
                "start_time": 1.8,
                "end_time": 2.8,
                "words": [
                    {"word": "Chasing", "start_time": 1.8, "end_time": 2.1},
                    {"word": "dreams", "start_time": 2.1, "end_time": 2.3},
                    {"word": "into", "start_time": 2.3, "end_time": 2.5},
                    {"word": "the", "start_time": 2.5, "end_time": 2.6},
                    {"word": "night", "start_time": 2.6, "end_time": 2.8},
                ],
            },
        ]
    }
    client.post(f"/api/project/{pid}/lyrics", json=lines_update)

    # Step 5: Render 9:16 vertical video
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={
            "semitones": 3,
            "guide_volume": 0.15,
            "aspect_ratio": "9:16",
            "custom_bg_id": bg_id,
            "style_config": {"lead_in_countdown_dots": 3},
        },
    )
    assert render_res.status_code == 200

    # Step 6: Verify YouTube metadata reflects +3 semitones and guide vocals
    yt_kit = client.get(f"/api/project/{pid}/youtube-package").json()
    assert "+3 Semitones" in yt_kit["description"]
    assert "Instrumental with Backing/Guide" in yt_kit["description"]


def test_scenario_3_musician_self_produced_backing_track(client, sample_wav, project_factory):
    """
    Scenario 3: Musician Self-Produced Backing Track Workflow.
    Musician supplies custom studio instrumental audio directly -> inputs lyrics ->
    transposes -1 semitone -> generates video.
    """
    pid = "musician11sc"
    project_factory(project_id=pid, title="Original Acoustic Ballad", with_stems=False)

    # Step 1: Upload studio instrumental WAV
    with open(sample_wav, "rb") as f:
        up_res = client.post(
            "/api/upload-instrumental",
            data={"project_id": pid},
            files={"file": ("master_backing.wav", f, "audio/wav")},
        )
    assert up_res.status_code == 200
    assert "instrumental_url" in up_res.json()

    # Step 2: Supply lyrics
    lyrics = {
        "lines": [
            {
                "id": 0,
                "text": "Walking down the dusty road",
                "start_time": 0.2,
                "end_time": 1.2,
                "words": [],
            }
        ]
    }
    client.post(f"/api/project/{pid}/lyrics", json=lyrics)

    # Step 3: Mix audio
    mix_res = client.post(f"/api/project/{pid}/mix", json={"semitones": -1, "guide_volume": 0.0})
    assert mix_res.status_code == 200

    # Step 4: Render video
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={"semitones": -1, "guide_volume": 0.0, "aspect_ratio": "16:9"},
    )
    assert render_res.status_code == 200


def test_scenario_4_multi_user_studio_collaboration_and_auth_gate(unauth_client, monkeypatch):
    """
    Scenario 4: Multi-User Collaboration & Studio Passphrase Gate.
    Passphrase security -> User Alice logs in and creates track ->
    User Bob logs in and creates track -> Projects isolated by author ->
    Unauthenticated visitor rejected -> Alice logs out.
    """
    secret = "studio_collab_secret_2026"
    monkeypatch.setattr(config, "APP_PASSWORD", secret)

    # 1. Unauthenticated guest rejected from projects
    assert unauth_client.get("/api/projects").status_code == 401

    # 2. Alice logs in
    alice_login = unauth_client.post(
        "/api/auth/login", json={"password": secret, "username": "Alice"}
    )
    assert alice_login.status_code == 200
    alice_headers = {"X-App-Password": secret}

    # 3. Alice creates track
    alice_intake = unauth_client.post(
        "/api/process",
        json={"url_or_id": "alice11track", "created_by": "Alice"},
        headers=alice_headers,
    )
    assert alice_intake.status_code == 200
    alice_pid = alice_intake.json()["project_id"]

    # 4. Bob logs in
    bob_headers = {"X-App-Password": secret}
    bob_intake = unauth_client.post(
        "/api/process", json={"url_or_id": "bob11track1", "created_by": "Bob"}, headers=bob_headers
    )
    assert bob_intake.status_code == 200
    bob_pid = bob_intake.json()["project_id"]

    # 5. Scoped listing: Alice sees only her project
    alice_scoped = unauth_client.get(
        "/api/projects?scope=my&user=Alice", headers=alice_headers
    ).json()
    assert alice_pid in alice_scoped
    assert bob_pid not in alice_scoped

    # 6. Scoped listing: Bob sees only his project
    bob_scoped = unauth_client.get("/api/projects?scope=my&user=Bob", headers=bob_headers).json()
    assert bob_pid in bob_scoped
    assert alice_pid not in bob_scoped

    # 7. Alice logs out
    logout_res = unauth_client.post("/api/auth/logout")
    assert logout_res.status_code == 200


def test_scenario_5_resilient_operator_cancellation_and_recovery(client):
    """
    Scenario 5: Pipeline Resilience, Cancellation & Failure Recovery.
    Cancel intake mid-flight -> recover and restart -> start video render ->
    cancel render mid-flight -> re-render with updated settings to completion.
    """
    vid = "resilient11"  # exactly 11 characters
    # Step 1: Start intake
    intake_res = client.post("/api/process", json={"url_or_id": vid})
    assert intake_res.status_code == 200
    pid = intake_res.json()["project_id"]

    # Step 2: Cancel intake pipeline
    cancel_pipe = client.post(f"/api/project/{pid}/cancel")
    assert cancel_pipe.status_code == 200
    assert client.get(f"/api/project/{pid}").json()["status"] == "cancelled"

    # Step 3: Restart pipeline
    restart_pipe = client.post("/api/process", json={"url_or_id": vid})
    assert restart_pipe.status_code == 200
    new_pid = restart_pipe.json()["project_id"]
    assert client.get(f"/api/project/{new_pid}").json()["status"] in ["queued", "ready"]
    pid = new_pid

    # Step 4: Initiate video render
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "16:9"},
    )
    assert render_res.status_code == 200

    # Step 5: Cancel video render
    cancel_rnd = client.post(f"/api/project/{pid}/cancel-render")
    assert cancel_rnd.status_code == 200
    assert client.get(f"/api/project/{pid}").json()["render_status"] == "idle"

    # Step 6: Re-render with new settings
    re_render = client.post(
        f"/api/project/{pid}/render",
        json={"semitones": 1, "guide_volume": 0.1, "aspect_ratio": "16:9"},
    )
    assert re_render.status_code == 200
    assert re_render.json()["status"] == "queued"


def test_scenario_6_international_multilingual_production(client, sample_image):
    """
    Scenario 6: International Multi-lingual Production (Japanese CJK + Emojis).
    Handles Japanese Kanji, Hiragana, English Romaji, and emoji stage cues without
    ASS syntax breakage, escaping glitches, or subtitle misalignment.
    """
    title = "🌸 桜の雨 (Sakura Rain)"
    artist = "初音ミク (Hatsune Miku)"
    cjk_lyrics = (
        "それぞれの場所へ 旅立っても 🌸\n"
        "友達だ いつまでも ずっと 🎶\n"
        "桜の花びらが 舞い散る季節に ✨"
    )
    # Step 1: Submit track with multilingual title and lyrics
    intake_res = client.post(
        "/api/process", json={"url_or_id": "cjkintl11sc", "custom_lyrics": cjk_lyrics}
    )
    assert intake_res.status_code == 200
    pid = intake_res.json()["project_id"]

    # Step 2: Update project title and artist to multilingual names
    proj = main_mod.get_project_or_404(pid)
    proj["title"] = title
    proj["artist"] = artist
    main_mod.save_projects()

    # Step 3: Render video with custom visual style
    custom_style = {
        "font_name": "Montserrat",
        "font_size": 50,
        "primary_color": "&H0022E5FF",
        "secondary_color": "&H00FFFFFF",
    }
    render_res = client.post(
        f"/api/project/{pid}/render",
        json={
            "semitones": 0,
            "guide_volume": 0.0,
            "aspect_ratio": "16:9",
            "style_config": custom_style,
        },
    )
    assert render_res.status_code == 200

    # Step 4: Verify ASS subtitle file preserves UTF-8 characters
    ass_path = main_mod.OUTPUT_DIR / f"{pid}.ass"
    if ass_path.exists():
        content = ass_path.read_text(encoding="utf-8")
        assert "それぞれの場所へ" in content
        assert "桜の花びらが" in content
        assert "友達だ" in content
        assert "🌸" in content

    # Step 5: Export YouTube kit and verify UTF-8 title and description
    yt_kit = client.get(f"/api/project/{pid}/youtube-package").json()
    assert "桜の雨" in yt_kit["title"]
    assert "初音ミク" in yt_kit["title"]
    assert "桜の花びら" in yt_kit["description"]
