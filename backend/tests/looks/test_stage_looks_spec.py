"""The shared spec of the five looks: complete, readable and backward compatible."""

import pytest

from backend.services import font_metrics
from backend.services.stage_looks import (
    ASPECTS,
    DEFAULT_LOOK_ID,
    LAYOUTS,
    LEGACY_IDS,
    LOOKS,
    fit_box,
    frame_for,
    is_known_look_id,
    resolve_look,
)
from backend.shared_assets import load

PRESETS_REPLACED = [preset["id"] for preset in load("stage_presets")["presets"]]


def test_there_are_five_looks_and_marquee_is_the_default():
    assert list(LOOKS) == ["marquee", "ktv", "songbook", "cinema", "prompter"]
    assert DEFAULT_LOOK_ID == "marquee"
    assert {look["layout"] for look in LOOKS.values()} == set(LAYOUTS)


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_every_look_places_every_part_in_both_formats(look_id):
    look = LOOKS[look_id]
    assert look["name"] and look["description"]
    assert look["tone"] in ("dark", "light")
    assert look["emphasis"] in ("sung", "unsung")
    for key in ("ground", "unsung", "sung", "quiet", "singer2", "both", "cue"):
        assert look["palette"][key].startswith("#") and len(look["palette"][key]) == 7
    for aspect in ASPECTS:
        frame = look["frames"][aspect]
        for part in ("lyric", "label", "cue", "title", "artist", "progress"):
            assert part in frame, f"{look_id} {aspect} has no {part}"
        if look["layout"] == "stack":
            assert "next" in frame
        if look["layout"] == "rows":
            assert len(frame["rows"]) == 2
        if look["layout"] == "column":
            column = frame["column"]
            assert len(column["after_alpha"]) == column["after"]


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_every_typeface_a_look_names_is_bundled(look_id):
    look = LOOKS[look_id]
    faces = {look["romaji"]["face"], look["adlib"]["face"]}
    for aspect in ASPECTS:
        frame = look["frames"][aspect]
        faces |= {frame[key]["face"] for key in ("lyric", "label", "cue", "title", "artist")}
        if frame.get("next"):
            faces.add(frame["next"]["face"])
    for face in faces - {None}:
        assert font_metrics.face(face)["file"]


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_everything_sits_inside_the_frame(look_id):
    look = LOOKS[look_id]
    for aspect in ASPECTS:
        frame = look["frames"][aspect]
        size = frame_for(aspect)
        for key in ("lyric", "next", "cue", "title"):
            box = frame.get(key)
            if not box:
                continue
            assert 0 < box["baseline"] < size.height, (aspect, key)
            assert 0 <= box["x"] <= size.width, (aspect, key)
            if "measure" in box:
                assert box["measure"] <= size.width, (aspect, key)
                assert fit_box(box).min <= fit_box(box).prefer <= fit_box(box).max
        picture = frame.get("picture")
        if picture:
            assert picture["x"] + picture["w"] <= size.width + 0.01
            assert picture["y"] + picture["h"] <= size.height + 0.01


def test_a_frame_is_1080p_and_one_u_is_a_hundredth_of_its_short_side():
    wide, tall = frame_for("16:9"), frame_for("9:16")
    assert (wide.width_px, wide.height_px) == (1920, 1080)
    assert (tall.width_px, tall.height_px) == (1080, 1920)
    assert wide.u == tall.u == 10.8
    assert wide.height == pytest.approx(100) and tall.width == pytest.approx(100)


def test_every_preset_the_looks_replaced_still_resolves():
    assert sorted(LEGACY_IDS) == sorted(PRESETS_REPLACED)
    for old_id in PRESETS_REPLACED:
        look, legacy = resolve_look(old_id)
        assert look["id"] in LOOKS
        assert legacy is LEGACY_IDS[old_id]
        assert is_known_look_id(old_id)


def test_a_dark_preset_never_lands_on_the_light_look():
    """Its users may have picked a pale unsung colour, unreadable on paper."""
    for old_id, legacy in LEGACY_IDS.items():
        if old_id != "clean_paper":
            assert LOOKS[legacy["look"]]["tone"] == "dark", old_id
    assert LOOKS[LEGACY_IDS["clean_paper"]["look"]]["tone"] == "light"


def test_the_colour_only_presets_carry_their_colour_over():
    assert LEGACY_IDS["cyber_cyan"]["carry_sung"] == "#00ffff"
    assert LEGACY_IDS["neon_pink"]["carry_sung"] == "#ff00b3"
    assert all("carry_sung" not in LEGACY_IDS[i] for i in ("afterglow", "modern_gold"))


def test_an_unknown_id_gives_the_default_look():
    for unknown in (None, "", "nope", 7, {"id": "ktv"}):
        look, legacy = resolve_look(unknown)
        assert look["id"] == DEFAULT_LOOK_ID and legacy is None
        assert not is_known_look_id(unknown)
    assert resolve_look("ktv")[0]["id"] == "ktv"


def test_a_fixed_size_may_shrink_before_text_is_condensed():
    box = fit_box({"size": 10, "measure": 80, "rows": 2}, scale=1.5)
    shrink = load("stage_looks")["fit"]["shrink"]
    assert (box.prefer, box.max, box.rows) == (15, 15, 2)
    assert box.min == pytest.approx(15 * shrink)
    ranged = fit_box({"min": 9, "prefer": 12, "max": 20, "measure": 80}, scale=0.5)
    assert (ranged.min, ranged.prefer, ranged.max, ranged.rows) == (4.5, 6, 10, 1)
