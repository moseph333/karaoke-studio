"""The case files the stage's tests run are what the backend's rules give today."""

import json

import pytest

from backend.services.ass_draw import LookStyle
from backend.shared_assets import SHARED_DIR
from backend.tools import stage_cases

FILES = stage_cases.case_files()


@pytest.mark.parametrize("name", list(FILES))
def test_a_case_file_is_what_the_tool_writes(name):
    """A rule or the looks spec changed without `python -m backend.tools.stage_cases`: the
    stage would be held to yesterday's answers."""
    assert (SHARED_DIR / name).read_text(encoding="utf-8") == FILES[name]
    assert json.loads(FILES[name])["cases"]


def test_a_scene_is_read_back_from_the_subtitle_file():
    script = "\n".join(
        [
            "Dialogue: 0,0:00:01.00,0:00:03.00,jost_medium,lyric:0,0,0,0,,"
            "{\\an8\\move(960,216,960,108,0,1000)\\fs156.06\\fscx90\\fade(255,0,0,0,1000,2000,2000)"
            "\\1c&H0000FF&\\2c&HFF0000&}{\\k50}{\\kf100}Hello {\\kf50}there",
            "Dialogue: 0,0:00:01.00,0:00:03.00,jost_medium,shadow:lyric:0,0,0,0,,{\\an8\\pos(1,1)}x",
            "Dialogue: 4,0:00:00.00,0:00:10.00,Shape,progress,0,0,0,,"
            "{\\an7\\pos(0,1074.6)\\1c&H1FD2FF&\\bord0\\shad0"
            "\\clip(0,1074.6,0,1080)\\t(0,10000,\\clip(0,1074.6,1920,1080))\\p1}m 0 0{\\p0}",
            "Dialogue: 0,0:00:05.00,0:00:06.00,jost_medium,lyric:1,0,0,0,,{\\an7\\pos(0,0)\\fs10}later",
        ]
    )
    scene = stage_cases.scene_of_script(script, 1.5, LookStyle.of("cinema").u)
    (text,) = scene["texts"]
    assert text == {
        "role": "lyric:0",
        "x": 88.889,
        "opacity": 0.5,
        "text": "Hello there",
        "align": "center",
        "top": 15.0,
        "face": "jost_medium",
        "size": 10.0,
        "condense": 0.9,
        "sung": "#ff0000",
        "unsung": "#0000ff",
    }
    (bar,) = scene["shapes"]
    assert bar == {
        "role": "progress",
        "x": 0.0,
        "opacity": 1.0,
        "y": 99.5,
        "color": "#ffd21f",
        "width": 26.667,
    }
