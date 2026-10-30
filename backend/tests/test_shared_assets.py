"""The values the backend shares with the studio come from backend/assets/shared (the
studio imports the same files as @shared/<name>.json): each file loads, and the backend's
presets, singer labels, limits and thresholds are the shared ones."""

import json

import pytest

from backend import upload_utils
from backend.schemas import LyricLineSchema
from backend.services import lyric_sync, stage_backgrounds
from backend.services.ass_generator import (
    DEFAULT_BOTH_COLOR,
    DEFAULT_SINGER2_COLOR,
    VISUAL_THEMES,
    singer_part,
)
from backend.shared_assets import SHARED_DIR, load


@pytest.mark.parametrize("path", sorted(SHARED_DIR.glob("*.json")), ids=lambda path: path.name)
def test_every_shared_file_loads(path):
    assert load(path.stem) == json.loads(path.read_text(encoding="utf-8"))


def test_the_export_presets_carry_the_stage_names_and_colours():
    shared = load("stage_presets")
    assert list(VISUAL_THEMES) == [preset["id"] for preset in shared["presets"]]
    for preset in shared["presets"]:
        theme = VISUAL_THEMES[preset["id"]]
        assert (theme["name"], theme["description"]) == (preset["name"], preset["description"])
        assert (theme["primary_color"], theme["secondary_color"]) == (
            preset["primary_color"],
            preset["secondary_color"],
        )
    assert VISUAL_THEMES["punk_diy"]["name"] == "Basement Flyer"
    assert VISUAL_THEMES["clean_paper"]["name"] == "Monolith Press"
    assert VISUAL_THEMES["afterglow"]["singer2_color"] == "&H00B672F4"
    assert VISUAL_THEMES["afterglow"]["both_color"] == "&H00D4EA5E"
    assert (DEFAULT_SINGER2_COLOR, DEFAULT_BOTH_COLOR) == ("&H00B300FF", "&H0050FA7B")


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
