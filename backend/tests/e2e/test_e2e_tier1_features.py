"""
E2E Test Suite - Tier 1: Feature Coverage
Verifies core user-facing functionality across all 8 major functional areas:
1. Audio Intake
2. Stem Separation
3. Lyrics Processing & Ingestion
4. Timeline Alignment
5. Audio Mixing & Transposition
6. Video Rendering & Visual Presets
7. Security & Passphrase Auth
8. Project Persistence & Multi-Tenant Scoping

Derives assertions strictly from public API routes and contracts defined in PROJECT.md.
"""

import io
import json
import os
import re
import subprocess
from pathlib import Path

import pytest
from PIL import Image

import backend.main as main_mod
from backend import config
from backend.services.aligner import AudioAligner
from backend.services.lyrics import LyricsService
from backend.services.video_renderer import VideoRenderer
from backend.tests.helpers.media import generate_sine_wave_wav, generate_test_image

# ==============================================================================
# Feature 1: Audio Intake
# ==============================================================================


def test_audio_intake_valid_url_queues_and_completes_pipeline(client):
    """Submitting a standard YouTube URL queues the pipeline and transitions state to ready."""
    payload = {"url_or_id": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "project_id" in data
    assert data["status"] in ["queued", "ready"]

    # Poll / verify project state
    proj_resp = client.get(f"/api/project/{data['project_id']}")
    assert proj_resp.status_code == 200
    proj = proj_resp.json()
    assert proj["status"] in ["queued", "ready"]
    assert "Mock Title" in proj["title"]
    assert proj["artist"] == "Mock Artist"
    assert proj["audio_url"].startswith("/static/downloads/")


def test_audio_intake_direct_11char_video_id(client):
    """Submitting a raw 11-character video ID is parsed without errors."""
    payload = {"url_or_id": "dQw4w9WgXcQ"}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["project_id"] == "dQw4w9WgXcQ"


def test_audio_intake_with_custom_lyrics_payload(client):
    """Submitting process request with custom plain lyrics bypasses external lyric search."""
    custom_text = "Never gonna give you up\nNever gonna let you down"
    payload = {"url_or_id": "customlyr11x", "custom_lyrics": custom_text}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["lyric_source"] == "custom"
    assert proj["is_synced"] is False
    assert len(proj["lines"]) >= 2
    assert "Never gonna give you up" in proj["lines"][0]["text"]


def test_audio_intake_with_custom_lrc_lyrics_synced(client):
    """Submitting process request with custom LRC lyrics preserves line timings, sets is_synced=True, and strips tags."""
    lrc_text = (
        "[00:04.20] First line of the song\n"
        "[00:08.50] Second line with more words\n"
        "[00:14.00] Final chorus line\n"
    )
    payload = {"url_or_id": "customlrc11x", "custom_lyrics": lrc_text}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["lyric_source"] == "custom"
    assert proj["is_synced"] is True
    assert len(proj["lines"]) == 3

    # Line start times must be preserved within tight alignment tolerance
    assert abs(proj["lines"][0]["start_time"] - 4.20) < 0.05
    assert abs(proj["lines"][1]["start_time"] - 8.50) < 0.05
    assert abs(proj["lines"][2]["start_time"] - 14.00) < 0.05

    # Ensure no raw timestamp tags leak into line text or word tokens
    for line in proj["lines"]:
        assert not re.search(r"\[\d{1,2}:\d{2}", line["text"])
        assert not re.search(r"<\d{1,2}:\d{2}", line["text"])
        assert len(line["words"]) > 0
        for w in line["words"]:
            assert not re.search(r"\[\d{1,2}:\d{2}", w["word"])
            assert not re.search(r"<\d{1,2}:\d{2}", w["word"])
            assert w["start_time"] <= w["end_time"]


def test_audio_intake_with_custom_lrc_multi_timestamp(client):
    """Submitting process request with repeated timestamps on a line creates chronologically sorted distinct lines."""
    lrc_text = "[00:02.00] Intro verse\n[00:06.00][00:12.00] Catchy hook phrase\n"
    payload = {"url_or_id": "multilrc11xx", "custom_lyrics": lrc_text}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["is_synced"] is True
    assert len(proj["lines"]) == 3
    assert abs(proj["lines"][0]["start_time"] - 2.00) < 0.05
    assert abs(proj["lines"][1]["start_time"] - 6.00) < 0.05
    assert abs(proj["lines"][2]["start_time"] - 12.00) < 0.05
    assert proj["lines"][1]["text"] == "Catchy hook phrase"
    assert proj["lines"][2]["text"] == "Catchy hook phrase"


def test_audio_intake_with_custom_lyrics_section_headings(client):
    """Submitting plain custom lyrics with bracketed section headers does not falsely trigger LRC detection."""
    custom_text = "[Verse 1]\nOpening lines of poetry\n[Chorus]\nLoud and clear refrains\n"
    payload = {"url_or_id": "sectionlyr1x", "custom_lyrics": custom_text}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["lyric_source"] == "custom"
    assert proj["is_synced"] is False


def test_audio_intake_creator_attribution(client):
    """Intake records the author/user nickname for project ownership scoping."""
    payload = {"url_or_id": "author11test", "created_by": "KaraokeHost99"}
    response = client.post("/api/process", json=payload)
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["created_by"] == "KaraokeHost99"


def test_audio_intake_idempotent_ready_cached_reuse(client, project_factory):
    """Submitting an already-ready video ID returns status 'ready' immediately."""
    vid = "cached11rdy"
    project_factory(project_id=vid, status="ready")

    response = client.post("/api/process", json={"url_or_id": vid})
    assert response.status_code == 200
    data = response.json()
    assert data["project_id"] == vid
    assert data["status"] == "ready"


def test_audio_intake_track_search(client):
    """Search endpoint queries tracks and returns structured search entries."""
    response = client.post("/api/search", json={"query": "Bohemian Rhapsody", "limit": 4})
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert len(data["results"]) == 4
    first = data["results"][0]
    assert "id" in first
    assert "title" in first
    assert "artist" in first
    assert "url" in first


def test_audio_intake_local_audio_track_full_pipeline(client, sample_wav):
    """Uploading a local audio track processes through full pipeline to ready status."""
    with open(sample_wav, "rb") as f:
        wav_bytes = f.read()

    response = client.post(
        "/api/upload-track",
        data={"title": "Studio Jam", "artist": "Local Heroes", "created_by": "Singer42"},
        files={"file": ("jam.wav", io.BytesIO(wav_bytes), "audio/wav")},
    )
    assert response.status_code == 200
    data = response.json()
    assert "project_id" in data
    pid = data["project_id"]
    assert pid.startswith("local_")

    # Poll project state
    proj_resp = client.get(f"/api/project/{pid}")
    assert proj_resp.status_code == 200
    proj = proj_resp.json()
    assert proj["status"] in ["queued", "ready"]
    assert proj["title"] == "Studio Jam"
    assert proj["artist"] == "Local Heroes"
    assert proj["created_by"] == "Singer42"
    assert proj["audio_url"] == f"/static/downloads/{pid}.wav"
    assert proj["vocals_url"].startswith("/static/stems/")
    assert proj["instrumental_url"].startswith("/static/stems/")
    assert proj["master_audio_url"].startswith("/static/output/")


def test_audio_intake_local_audio_track_with_custom_lrc_lyrics(client, sample_wav):
    """Uploading a local track with custom LRC lyrics preserves timestamps and sets is_synced=True."""
    with open(sample_wav, "rb") as f:
        wav_bytes = f.read()

    lrc_text = (
        "[00:00.20] First local acoustic verse\n"
        "[00:00.60] Second line of singing\n"
        "[00:01.10] Final crescendo\n"
    )

    response = client.post(
        "/api/upload-track",
        data={
            "title": "Local Ballad",
            "artist": "Acoustic Band",
            "custom_lyrics": lrc_text,
        },
        files={"file": ("ballad.wav", io.BytesIO(wav_bytes), "audio/wav")},
    )
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["lyric_source"] == "custom"
    assert proj["is_synced"] is True
    assert len(proj["lines"]) == 3
    assert abs(proj["lines"][0]["start_time"] - 0.20) < 0.05
    assert abs(proj["lines"][1]["start_time"] - 0.60) < 0.05
    assert abs(proj["lines"][2]["start_time"] - 1.10) < 0.05

    # Ensure no raw timestamp tags leak into line text or words
    for line in proj["lines"]:
        assert not re.search(r"\[\d{1,2}:\d{2}", line["text"])
        assert len(line["words"]) > 0
        for w in line["words"]:
            assert not re.search(r"\[\d{1,2}:\d{2}", w["word"])


def test_audio_intake_local_audio_rejections_leave_zero_orphans(client):
    """Rejection conditions (0-byte, unsupported extension, spoofed header) leave zero orphaned files."""
    downloads_before = set(main_mod.DOWNLOADS_DIR.iterdir())

    # 1. 0-byte file
    res1 = client.post(
        "/api/upload-track", files={"file": ("empty.wav", io.BytesIO(b""), "audio/wav")}
    )
    assert res1.status_code == 400

    # 2. Unsupported extension
    res2 = client.post(
        "/api/upload-track",
        files={"file": ("script.py", io.BytesIO(b"print('hello')"), "text/plain")},
    )
    assert res2.status_code == 400

    # 3. Spoofed magic bytes
    res3 = client.post(
        "/api/upload-track",
        files={"file": ("fake.wav", io.BytesIO(b"not a valid wav file"), "audio/wav")},
    )
    assert res3.status_code == 400

    downloads_after = set(main_mod.DOWNLOADS_DIR.iterdir())
    assert downloads_before == downloads_after


def test_audio_intake_local_mp3_transcodes_and_completes_pipeline(client, tmp_path, sample_wav):
    """Uploading a local MP3 track transcodes via ffmpeg to standard WAV and completes pipeline."""
    mp3_path = tmp_path / "test_song.mp3"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(sample_wav), "-vn", "-b:a", "128k", str(mp3_path)],
        check=True,
        capture_output=True,
    )
    with open(mp3_path, "rb") as f:
        mp3_bytes = f.read()

    response = client.post(
        "/api/upload-track",
        data={"title": "MP3 Track", "artist": "Transcode Artist"},
        files={"file": ("test_song.mp3", io.BytesIO(mp3_bytes), "audio/mpeg")},
    )
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["status"] in ["queued", "ready"]
    assert proj["audio_url"] == f"/static/downloads/{pid}.wav"
    assert proj["vocals_url"].startswith("/static/stems/")
    assert proj["instrumental_url"].startswith("/static/stems/")
    assert proj["master_audio_url"].startswith("/static/output/")


def test_audio_intake_local_flac_transcodes_and_completes_pipeline(client, tmp_path, sample_wav):
    """Uploading a local FLAC track transcodes via ffmpeg to standard WAV and completes pipeline."""
    flac_path = tmp_path / "test_song.flac"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(sample_wav), "-vn", str(flac_path)],
        check=True,
        capture_output=True,
    )
    with open(flac_path, "rb") as f:
        flac_bytes = f.read()

    response = client.post(
        "/api/upload-track",
        data={"title": "FLAC Track", "artist": "Lossless Artist"},
        files={"file": ("test_song.flac", io.BytesIO(flac_bytes), "audio/flac")},
    )
    assert response.status_code == 200
    pid = response.json()["project_id"]

    proj = client.get(f"/api/project/{pid}").json()
    assert proj["status"] in ["queued", "ready"]
    assert proj["audio_url"] == f"/static/downloads/{pid}.wav"


# ==============================================================================
# Feature 2: Stem Separation
# ==============================================================================


def test_stem_separation_generates_vocals_and_instrumental_files(client, project_factory):
    """Pipeline ensures vocal and instrumental stems exist on disk with valid headers."""
    proj = project_factory(project_id="stemstest1", status="ready")

    vocals_path = Path(proj["vocals_path"])
    inst_path = Path(proj["instrumental_path"])
    assert vocals_path.exists()
    assert inst_path.exists()
    assert vocals_path.stat().st_size > 1000
    assert inst_path.stat().st_size > 1000


def test_stem_separation_static_stem_urls_accessible(client, project_factory):
    """Static stem URLs can be streamed/downloaded by the frontend."""
    proj = project_factory(project_id="stemurls1", status="ready")

    voc_res = client.get(proj["vocals_url"])
    assert voc_res.status_code == 200
    assert len(voc_res.content) > 1000

    inst_res = client.get(proj["instrumental_url"])
    assert inst_res.status_code == 200
    assert len(inst_res.content) > 1000


def test_stem_separation_user_instrumental_upload_wav(client, project_factory, sample_wav):
    """Users can upload an external WAV backing track to replace/provide instrumental stem."""
    _proj = project_factory(project_id="uploadinst1", with_stems=False)

    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/upload-instrumental",
            data={"project_id": "uploadinst1"},
            files={"file": ("my_backing.wav", f, "audio/wav")},
        )
    assert response.status_code == 200
    data = response.json()
    assert "instrumental_url" in data
    assert "custom_inst.wav" in data["instrumental_url"]

    # Verify project record updated
    updated_proj = client.get("/api/project/uploadinst1").json()
    assert updated_proj["instrumental_url"] == data["instrumental_url"]
    assert Path(updated_proj["instrumental_path"]).exists()


def test_stem_separation_user_instrumental_upload_mp3(client, project_factory, sample_wav):
    """Users can upload an external MP3 backing track."""
    _proj = project_factory(project_id="uploadmp3_1", with_stems=False)

    with open(sample_wav, "rb") as f:
        response = client.post(
            "/api/upload-instrumental",
            data={"project_id": "uploadmp3_1"},
            files={"file": ("my_backing.mp3", f, "audio/mpeg")},
        )
    assert response.status_code == 200
    assert "custom_inst.mp3" in response.json()["instrumental_url"]


def test_stem_separation_upload_unsupported_format_rejected(client, project_factory):
    """Uploading non-audio files is rejected with HTTP 400."""
    project_factory(project_id="badfile1")
    fake_txt = io.BytesIO(b"Hello I am text, not audio")

    response = client.post(
        "/api/upload-instrumental",
        data={"project_id": "badfile1"},
        files={"file": ("hacker.txt", fake_txt, "text/plain")},
    )
    assert response.status_code == 400
    assert "Unsupported audio format" in response.json()["detail"]


def test_stem_separation_cached_stems_reuse(tmp_path):
    """AudioSeparator reuses existing stems without re-running isolation."""
    from backend.services.separator import AudioSeparator

    stems_dir = tmp_path / "stems"
    separator = AudioSeparator(output_base_dir=stems_dir)

    track_id = "cached_test_track"
    target_dir = stems_dir / track_id
    target_dir.mkdir(parents=True)
    generate_sine_wave_wav(target_dir / "vocals.wav", duration=1.0)
    generate_sine_wave_wav(target_dir / "instrumental.wav", duration=1.0)

    # Calling separation with dummy audio path should immediately return cached paths
    res = separator.separate_stems(audio_path=str(target_dir / "vocals.wav"), track_id=track_id)
    assert res["vocals_path"] == str(target_dir / "vocals.wav")
    assert res["instrumental_path"] == str(target_dir / "instrumental.wav")


# ==============================================================================
# Feature 3: Lyrics Processing & Ingestion
# ==============================================================================


def test_lyrics_update_endpoint_persists_lines(client, project_factory):
    """POST /api/project/{id}/lyrics updates line data and returns line count."""
    project_factory(project_id="lyrupdate1")

    payload = {
        "lines": [
            {
                "id": 1,
                "text": "First customized line",
                "start_time": 1.0,
                "end_time": 2.5,
                "words": [
                    {"word": "First", "start_time": 1.0, "end_time": 1.5},
                    {"word": "customized", "start_time": 1.5, "end_time": 2.0},
                    {"word": "line", "start_time": 2.0, "end_time": 2.5},
                ],
            },
            {
                "id": 2,
                "text": "Second line following",
                "start_time": 3.0,
                "end_time": 4.5,
                "words": [
                    {"word": "Second", "start_time": 3.0, "end_time": 3.6},
                    {"word": "line", "start_time": 3.6, "end_time": 4.0},
                    {"word": "following", "start_time": 4.0, "end_time": 4.5},
                ],
            },
        ]
    }
    response = client.post("/api/project/lyrupdate1/lyrics", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["lines_count"] == 2

    # Verify retrieval
    proj = client.get("/api/project/lyrupdate1").json()
    assert len(proj["lines"]) == 2
    assert proj["lines"][0]["text"] == "First customized line"


def test_lyrics_plain_text_parsing():
    """LyricsService splits plain text into lines with estimated word tokens."""
    service = LyricsService()
    raw = "Sweet child o' mine\nWhere do we go now"
    lines = service.parse_plain_text(raw)
    assert len(lines) == 2
    assert lines[0]["text"] == "Sweet child o' mine"
    assert len(lines[0]["words"]) == 4
    assert lines[1]["text"] == "Where do we go now"
    assert len(lines[1]["words"]) == 5


def test_lyrics_lrc_parsing_with_timecodes():
    """LyricsService correctly parses standard LRC timecodes and calculates line bounds."""
    service = LyricsService()
    lrc = (
        "[00:04.20] First lyric in the verse\n"
        "[00:08.50] Second lyric answering back\n"
        "[00:15.00] Third lyric ending"
    )
    lines = service.parse_lrc(lrc)
    assert len(lines) == 3
    assert abs(lines[0]["start_time"] - 4.20) < 0.05
    assert abs(lines[0]["end_time"] - 8.50) < 0.05
    assert abs(lines[1]["start_time"] - 8.50) < 0.05
    assert len(lines[0]["words"]) == 5


def test_lyrics_fetch_standard_schema():
    """LyricsService.fetch_lyrics returns consistent keys and formats."""
    service = LyricsService()
    # Mocking is active in conftest
    res = service.fetch_lyrics("Test Song", "Test Artist")
    assert "source" in res
    assert "synced" in res
    assert "lines" in res
    assert isinstance(res["lines"], list)


def test_lyrics_update_empty_lines(client, project_factory):
    """Submitting an empty lines array clears project lines cleanly."""
    project_factory(project_id="lyrempty1")
    response = client.post("/api/project/lyrempty1/lyrics", json={"lines": []})
    assert response.status_code == 200
    assert response.json()["lines_count"] == 0

    proj = client.get("/api/project/lyrempty1").json()
    assert proj["lines"] == []


# ==============================================================================
# Feature 4: Timeline Alignment
# ==============================================================================


def test_alignment_acoustic_envelope_refinement(sample_wav):
    """AudioAligner refines rough timing into precise acoustic energy boundaries."""
    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Singing along with the audio", "start_time": 0.0, "end_time": 0.9}]
    aligned = aligner.align_lyrics(str(sample_wav), lines)
    assert len(aligned) == 1
    assert "words" in aligned[0]
    assert len(aligned[0]["words"]) > 0


def test_alignment_word_token_generation(sample_wav):
    """Every line produces non-empty words with start and end times."""
    aligner = AudioAligner()
    lines = [{"id": 0, "text": "Alpha beta gamma", "start_time": 0.1, "end_time": 0.8}]
    aligned = aligner.align_lyrics(str(sample_wav), lines)
    words = aligned[0]["words"]
    assert len(words) == 3
    for w in words:
        assert w["word"] in ["Alpha", "beta", "gamma"]
        assert w["start_time"] <= w["end_time"]


def test_alignment_silent_audio_fallback(tmp_path):
    """AudioAligner handles completely silent audio without crashing or NaN values."""
    aligner = AudioAligner()
    silent_wav = tmp_path / "silent.wav"
    generate_sine_wave_wav(silent_wav, duration=1.0, freq=0.0)

    lines = [{"id": 0, "text": "Silent night holy night", "start_time": 0.0, "end_time": 0.8}]
    aligned = aligner.align_lyrics(str(silent_wav), lines)
    assert len(aligned) == 1
    assert not any(w["start_time"] is None for w in aligned[0]["words"])


def test_alignment_monotonic_timestamps(sample_wav):
    """Aligned line and word timestamps maintain monotonic progression."""
    aligner = AudioAligner()
    lines = [
        {"id": 0, "text": "Line one here", "start_time": 0.1, "end_time": 0.4},
        {"id": 1, "text": "Line two follows", "start_time": 0.5, "end_time": 0.9},
    ]
    aligned = aligner.align_lyrics(str(sample_wav), lines)
    assert aligned[0]["start_time"] <= aligned[0]["end_time"]
    assert aligned[1]["start_time"] <= aligned[1]["end_time"]
    for line_item in aligned:
        for i in range(len(line_item["words"]) - 1):
            assert line_item["words"][i]["start_time"] <= line_item["words"][i + 1]["start_time"]


def test_alignment_stereo_vocal_conversion(tmp_path):
    """AudioAligner gracefully processes multi-channel stereo audio."""
    aligner = AudioAligner()
    stereo_wav = tmp_path / "stereo_voc.wav"
    generate_sine_wave_wav(stereo_wav, duration=1.0)

    lines = [{"id": 0, "text": "Stereo test vocal line", "start_time": 0.2, "end_time": 0.8}]
    aligned = aligner.align_lyrics(str(stereo_wav), lines)
    assert len(aligned) == 1
    assert len(aligned[0]["words"]) == 4


# ==============================================================================
# Feature 5: Audio Mixing & Transposition
# ==============================================================================


def test_mixing_valid_pitch_shift_semitones(client, project_factory):
    """POST /api/project/{id}/mix shifts pitch and returns master audio URL."""
    project_factory(project_id="mixpitch1")

    payload = {"semitones": 3, "guide_volume": 0.0}
    response = client.post("/api/project/mixpitch1/mix", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "master_audio_url" in data
    assert "_mix_3_0.wav" in data["master_audio_url"]


def test_mixing_guide_vocal_blend(client, project_factory):
    """POST /api/project/{id}/mix blends guide vocals at specified volume."""
    project_factory(project_id="mixblend1")

    payload = {"semitones": 0, "guide_volume": 0.25}
    response = client.post("/api/project/mixblend1/mix", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert "_mix_0_25.wav" in data["master_audio_url"]


def test_mixing_combined_pitch_shift_and_vocal_blend(client, project_factory):
    """Mixing simultaneously applies semitone shift and guide volume."""
    project_factory(project_id="mixboth1")

    payload = {"semitones": -2, "guide_volume": 0.15}
    response = client.post("/api/project/mixboth1/mix", json=payload)
    assert response.status_code == 200

    proj = client.get("/api/project/mixboth1").json()
    assert proj["semitones"] == -2
    assert proj["guide_volume"] == 0.15


def test_mixing_rejects_missing_instrumental(client, project_factory):
    """POST /api/project/{id}/mix rejects projects lacking an instrumental stem."""
    project_factory(project_id="mixnoinst1", with_stems=False)

    payload = {"semitones": 1, "guide_volume": 0.0}
    response = client.post("/api/project/mixnoinst1/mix", json=payload)
    assert response.status_code == 400
    assert "Instrumental stem not ready yet" in response.json()["detail"]


def test_mixing_static_master_audio_accessible(client, project_factory):
    """Generated master mix audio can be downloaded via static URL."""
    project_factory(project_id="mixstatic1")

    mix_res = client.post("/api/project/mixstatic1/mix", json={"semitones": 1, "guide_volume": 0.1})
    master_url = mix_res.json()["master_audio_url"]

    audio_res = client.get(master_url)
    assert audio_res.status_code == 200
    assert len(audio_res.content) > 1000


# ==============================================================================
# Feature 6: Video Rendering & Visual Presets
# ==============================================================================


def test_video_render_endpoint_queues_job(client, project_factory):
    """POST /api/project/{id}/render returns queued status immediately."""
    project_factory(project_id="renderq1")

    payload = {"semitones": 0, "guide_volume": 0.0, "aspect_ratio": "16:9"}
    response = client.post("/api/project/renderq1/render", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "queued"


def test_video_render_generates_ass_karaoke_subtitles(tmp_path):
    """VideoRenderer generates compliant ASS files with \\kf progressive wipes."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "subtitles.ass"

    lines = [
        {
            "id": 0,
            "text": "Hello world karaoke",
            "start_time": 0.5,
            "end_time": 1.5,
            "words": [
                {"word": "Hello", "start_time": 0.5, "end_time": 0.8},
                {"word": "world", "start_time": 0.8, "end_time": 1.1},
                {"word": "karaoke", "start_time": 1.1, "end_time": 1.5},
            ],
        }
    ]
    renderer.generate_ass_subtitles(lines, ass_path)
    assert ass_path.exists()
    content = ass_path.read_text(encoding="utf-8")
    assert "[Script Info]" in content
    assert "\\kf" in content
    assert "Hello" in content


def test_video_render_aspect_ratio_16_9(tmp_path):
    """16:9 aspect ratio generates 1920x1080 ASS canvas resolution."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "ar_16_9.ass"

    renderer.generate_ass_subtitles([], ass_path, style_config={"width": 1920, "height": 1080})
    content = ass_path.read_text(encoding="utf-8")
    assert "PlayResX: 1920" in content
    assert "PlayResY: 1080" in content


def test_video_render_aspect_ratio_9_16(tmp_path):
    """9:16 aspect ratio generates 1080x1920 ASS canvas resolution."""
    renderer = VideoRenderer(output_dir=tmp_path)
    ass_path = tmp_path / "ar_9_16.ass"

    renderer.generate_ass_subtitles([], ass_path, style_config={"width": 1080, "height": 1920})
    content = ass_path.read_text(encoding="utf-8")
    assert "PlayResX: 1080" in content
    assert "PlayResY: 1920" in content


def test_video_render_custom_background_upload_jpeg(client, sample_image):
    """POST /api/upload-background accepts JPEG images and returns bg_id and URL."""
    with open(sample_image, "rb") as f:
        response = client.post(
            "/api/upload-background", files={"file": ("stage_bg.jpg", f, "image/jpeg")}
        )
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert "bg_id" in data
    assert data["bg_url"].startswith("/static/backgrounds/")


def test_video_render_custom_background_upload_png(client, tmp_path):
    """POST /api/upload-background accepts PNG images."""
    png_path = tmp_path / "stage.png"
    img = Image.new("RGB", (100, 100), color=(10, 20, 30))
    img.save(png_path, format="PNG")

    with open(png_path, "rb") as f:
        response = client.post(
            "/api/upload-background", files={"file": ("stage.png", f, "image/png")}
        )
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


# ==============================================================================
# Feature 7: Security & Passphrase Auth
# ==============================================================================


def test_auth_status_open_by_default(client, monkeypatch):
    """When APP_PASSWORD is empty, auth is marked not required and user authenticated."""
    monkeypatch.setattr(config, "APP_PASSWORD", "")
    response = client.get("/api/auth/status")
    assert response.status_code == 200
    assert response.json() == {"auth_required": False, "authenticated": True}


def test_auth_protected_routes_reject_unauthenticated(unauth_client, monkeypatch):
    """When APP_PASSWORD is set, protected API routes reject unauthenticated requests with 401."""
    monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_key")
    response = unauth_client.get("/api/projects")
    assert response.status_code == 401
    assert "Invalid or missing studio passphrase" in response.json()["detail"]


def test_auth_login_sets_cookie_and_returns_token(unauth_client, monkeypatch):
    """Valid login credentials yield authentication token and set secure cookie."""
    monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_key")
    payload = {"password": "studio_vault_key", "username": "Director"}
    response = unauth_client.post("/api/auth/login", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["username"] == "Director"
    assert "karaoke_token" in response.cookies


def test_auth_login_with_incorrect_password(unauth_client, monkeypatch):
    """Incorrect passphrase returns HTTP 401."""
    monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_key")
    response = unauth_client.post("/api/auth/login", json={"password": "wrong_password"})
    assert response.status_code == 401
    assert "Incorrect studio passphrase" in response.json()["detail"]


def test_auth_logout_clears_cookie(unauth_client, monkeypatch):
    """Logout request removes the session cookie."""
    monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_key")
    response = unauth_client.post("/api/auth/logout")
    assert response.status_code == 200
    # Cookie should be expired / removed
    cookie_header = response.headers.get("set-cookie", "")
    assert 'karaoke_token=""' in cookie_header or "Max-Age=0" in cookie_header


def test_auth_header_x_app_password_grants_access(unauth_client, monkeypatch):
    """Requests presenting the X-App-Password header bypass the cookie gate."""
    monkeypatch.setattr(config, "APP_PASSWORD", "studio_vault_key")
    headers = {"X-App-Password": "studio_vault_key"}
    response = unauth_client.get("/api/projects", headers=headers)
    assert response.status_code == 200


def test_auth_security_headers_enforced(client):
    """HTTP responses include strict security headers."""
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.headers.get("X-Content-Type-Options") == "nosniff"
    assert response.headers.get("X-Frame-Options") == "DENY"
    assert response.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin"


# ==============================================================================
# Feature 8: Project Persistence & Multi-Tenant Scoping
# ==============================================================================


def test_projects_atomic_save_and_disk_persistence(project_factory):
    """Saving projects creates valid JSON file on disk."""
    project_factory(project_id="persist1", title="Persisted Song")
    assert main_mod.PROJECTS_STORE_FILE.exists()
    content = json.loads(main_mod.PROJECTS_STORE_FILE.read_text(encoding="utf-8"))
    assert "persist1" in content
    assert content["persist1"]["title"] == "Persisted Song"


def test_projects_list_all_returns_all_projects(client, project_factory):
    """GET /api/projects lists all registered projects."""
    project_factory(project_id="list_p1")
    project_factory(project_id="list_p2")
    project_factory(project_id="list_p3")

    response = client.get("/api/projects")
    assert response.status_code == 200
    projects_dict = response.json()
    assert "list_p1" in projects_dict
    assert "list_p2" in projects_dict
    assert "list_p3" in projects_dict


def test_projects_list_scoped_by_user(client, project_factory):
    """GET /api/projects?scope=my&user=Alice filters out projects belonging to other users."""
    project_factory(project_id="alice_song", created_by="Alice")
    project_factory(project_id="bob_song", created_by="Bob")

    response = client.get("/api/projects?scope=my&user=Alice")
    assert response.status_code == 200
    data = response.json()
    assert "alice_song" in data
    assert "bob_song" not in data


def test_projects_get_project_by_id(client, project_factory):
    """GET /api/project/{id} retrieves complete metadata record."""
    project_factory(project_id="target_id", title="Exact Title")
    response = client.get("/api/project/target_id")
    assert response.status_code == 200
    assert response.json()["title"] == "Exact Title"


def test_projects_get_nonexistent_returns_404(client):
    """GET /api/project/{nonexistent} returns HTTP 404."""
    response = client.get("/api/project/does_not_exist_xyz")
    assert response.status_code == 404
    assert "Project not found" in response.json()["detail"]


def test_projects_backup_recovery_on_corrupted_primary(project_factory):
    """When primary projects.json is corrupt, recovery falls back to projects.json.bak."""
    project_factory(project_id="recoverable_p1", title="Saved In Backup")
    # A second save creates the .bak file from the first save
    project_factory(project_id="recoverable_p2", title="Second Project")
    assert main_mod.PROJECTS_BACKUP_FILE.exists()

    # Corrupt primary file
    main_mod.PROJECTS_STORE_FILE.write_text("{corrupt: json syntax error", encoding="utf-8")

    # Load should safely recover from backup
    recovered = main_mod.load_projects()
    assert "recoverable_p1" in recovered
    assert recovered["recoverable_p1"]["title"] == "Saved In Backup"
