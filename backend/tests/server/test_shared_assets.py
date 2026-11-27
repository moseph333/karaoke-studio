"""The values the backend shares with the studio come from backend/assets/shared (the
studio imports the same files as @shared/<name>.json): each file loads, and the backend's
looks, singer labels, limits and thresholds are the shared ones."""

import json

import pytest

from backend import upload_utils
from backend.schemas import (
    AlbumSongPick,
    AlbumSongsRequest,
    LoginRequest,
    LyricLineSchema,
    ProcessRequest,
    ProjectMetadataUpdate,
    RealignLyricsRequest,
)
from backend.services import lyric_sync, stage_backgrounds
from backend.services.ass_generator import singer_part
from backend.services.stage_looks import DEFAULT_LOOK_ID, LEGACY_IDS, LOOKS
from backend.shared_assets import SHARED_DIR, load
from backend.tests.helpers.media import generate_sine_wave_wav


@pytest.mark.parametrize("path", sorted(SHARED_DIR.glob("*.json")), ids=lambda path: path.name)
def test_every_shared_file_loads(path):
    assert load(path.stem) == json.loads(path.read_text(encoding="utf-8"))


def test_the_exports_looks_are_the_shared_ones():
    shared = load("stage_looks")
    assert list(LOOKS) == [look["id"] for look in shared["looks"]]
    assert shared["default_look"] == DEFAULT_LOOK_ID
    assert all(LOOKS[look["id"]] is look for look in shared["looks"])
    assert LEGACY_IDS is shared["legacy_ids"]
    assert {entry["look"] for entry in LEGACY_IDS.values()} <= set(LOOKS)


def test_a_singer_label_means_the_same_part_when_saved_and_exported():
    for label, part in load("singer_aliases").items():
        line = LyricLineSchema(text="Hi", start_time=0.0, end_time=1.0, singer=label)
        assert line.singer == part, label
        assert singer_part({"singer": label}) == part, label


def test_limits_thresholds_and_motion_are_the_shared_ones():
    mb = 1024 * 1024
    assert load("upload_limits") == {
        "track_mb": upload_utils.MAX_TRACK_UPLOAD_BYTES // mb,
        "instrumental_mb": upload_utils.MAX_INSTRUMENTAL_UPLOAD_BYTES // mb,
        "background_video_mb": upload_utils.MAX_BACKGROUND_UPLOAD_BYTES // mb,
        "background_image_mb": upload_utils.MAX_IMAGE_BACKGROUND_UPLOAD_BYTES // mb,
    }
    assert load("upload_limits")["track_mb"] == 100
    assert lyric_sync.LOW_CONFIDENCE == load("confidence_thresholds")["low"] == 0.6
    assert stage_backgrounds.BACKGROUND_MOTION is load("background_motion")


def _longest(model, field: str) -> int:
    """The max_length a request model gives one of its fields."""
    return next(
        m.max_length for m in model.model_fields[field].metadata if hasattr(m, "max_length")
    )


def test_text_fields_are_refused_past_the_shared_lengths():
    limits = load("text_limits")
    assert limits == {"title": 300, "artist": 300, "singer": 64, "lyrics": 50000}
    assert _longest(ProcessRequest, "custom_lyrics") == limits["lyrics"]
    assert _longest(RealignLyricsRequest, "custom_lyrics") == limits["lyrics"]
    assert _longest(ProcessRequest, "created_by") == limits["singer"]
    assert _longest(AlbumSongsRequest, "created_by") == limits["singer"]
    assert _longest(LoginRequest, "username") == limits["singer"]
    assert _longest(ProjectMetadataUpdate, "title") == limits["title"]
    assert _longest(AlbumSongPick, "title") == limits["title"]
    assert _longest(ProjectMetadataUpdate, "artist") == limits["artist"]
    assert _longest(AlbumSongsRequest, "artist") == limits["artist"]


@pytest.mark.parametrize(
    ("field", "limit"),
    [
        ("title", "title"),
        ("artist", "artist"),
        ("created_by", "singer"),
        ("custom_lyrics", "lyrics"),
    ],
)
def test_an_upload_is_refused_past_the_shared_lengths(client, monkeypatch, field, limit):
    import backend.main as main_mod

    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args: None)
    wav = generate_sine_wave_wav(main_mod.DOWNLOADS_DIR / "source.wav", duration=0.1).read_bytes()
    longest = load("text_limits")[limit]

    def upload(length: int):
        return client.post(
            "/api/upload-track",
            files={"file": ("song.wav", wav, "audio/wav")},
            data={field: "x" * length},
        )

    assert upload(longest).status_code == 200
    assert upload(longest + 1).status_code == 422
