"""Turning a song's vocal levels into a mix plan: when the mixer's one guide level is
enough, when the vocals must be summed first, and how the plan names its mix."""

import os
import time
from pathlib import Path

import pytest

from backend.services import vocal_mix, vocal_parts
from backend.services.vocal_mix import normalize_levels, plan_mix
from backend.tests.helpers.split_songs import wav

LINES = [
    {"start_time": 1.0, "end_time": 2.0, "singer": "singer1", "text": "one"},
    {"start_time": 3.0, "end_time": 4.0, "singer": "singer2", "text": "two"},
]


@pytest.fixture
def vocals(tmp_path) -> str:
    return str(wav(tmp_path / "stems" / "vocals.wav", 0.3))


@pytest.fixture
def split(vocals) -> Path:
    """The song's vocals, split into lead and backing."""
    folder = Path(vocals).parent
    stamp = time.time() - 60
    os.utime(vocals, (stamp, stamp))
    vocal_parts.install(
        folder,
        "lead_backing",
        wav(folder / "work" / "a.wav", 0.2),
        wav(folder / "work" / "b.wav", 0.1),
        {"model": "m"},
    )
    return folder


def test_no_levels_is_the_guide_vocal_as_it_always_was(vocals):
    for levels in (None, {}, {"unknown": 1}, "nonsense"):
        plan = plan_mix(vocals, LINES, 0.3, levels)
        assert (plan.key, plan.guide_volume, plan.parts) == (None, 0.3, ())
    assert plan_mix(None, LINES, 0.3, {"backing": 1.0}).key is None


def test_a_backing_level_without_a_split_changes_nothing(vocals):
    plan = plan_mix(vocals, LINES, 0.2, {"backing": 1.0})

    assert (plan.key, plan.guide_volume) == (None, 0.2)


def test_backing_vocals_kept_while_the_lead_is_removed(split, vocals):
    plan = plan_mix(vocals, LINES, 0.0, {"backing": 1.0})

    assert plan.key is not None and len(plan.key) == 8
    [part] = plan.parts
    assert (Path(part.path).name, part.gain, part.gate) == ("vocals_backing.wav", 1.0, None)
    assert plan.sources == (str(split / "vocals_backing.wav"),)


def test_lead_and_backing_at_different_levels_are_both_summed(split, vocals):
    plan = plan_mix(vocals, LINES, 0.25, {"backing": 0.8})

    assert [(Path(p.path).name, p.gain) for p in plan.parts] == [
        ("vocals_lead.wav", 0.25),
        ("vocals_backing.wav", 0.8),
    ]


def test_lead_and_backing_at_one_level_are_the_whole_vocal_stem(split, vocals):
    plan = plan_mix(vocals, LINES, 0.4, {"backing": 0.4})

    assert (plan.key, plan.guide_volume) == (None, 0.4)
    # A backing level that was never set follows the guide
    assert plan_mix(vocals, LINES, 0.4, {"by": "lines"}).key is None


def test_every_vocal_at_zero_is_the_instrumental_alone(split, vocals):
    plan = plan_mix(vocals, LINES, 0.3, {"backing": 0.0, "by": "lines", "singer1": 0, "singer2": 0})

    assert (plan.key, plan.guide_volume) == (None, 0.0)


def test_singer_levels_gate_the_whole_vocal_stem_without_a_split(vocals):
    plan = plan_mix(vocals, LINES, 0.0, {"by": "lines", "singer2": 1.0})

    [part] = plan.parts
    assert part.path == vocals
    assert part.gate is not None and part.gain == 1.0
    assert plan.sources == (vocals,)


def test_singer_levels_gate_the_lead_and_leave_the_backing_alone(split, vocals):
    plan = plan_mix(vocals, LINES, 0.0, {"backing": 0.5, "by": "lines", "singer2": 1.0})

    lead, backing = plan.parts
    assert (Path(lead.path).name, lead.gate is not None) == ("vocals_lead.wav", True)
    assert (Path(backing.path).name, backing.gain, backing.gate) == (
        "vocals_backing.wav",
        0.5,
        None,
    )


def test_singer_levels_are_ignored_until_the_lead_is_divided_by_lines(vocals):
    assert plan_mix(vocals, LINES, 0.0, {"singer2": 1.0}).key is None


def test_one_level_for_every_singer_is_a_plain_guide_level(vocals):
    plan = plan_mix(vocals, LINES, 0.0, {"by": "lines", "singer1": 0.6, "singer2": 0.6})

    assert (plan.key, plan.guide_volume) == (None, 0.6)


def test_a_song_with_one_singer_keeps_the_guide_level_whatever_the_singer_levels(vocals):
    """The studio shows singer levels only for lines of more than one singer."""
    solo = [dict(line, singer="singer1") for line in LINES]

    plan = plan_mix(vocals, solo, 0.1, {"by": "lines", "singer1": 0.7, "singer2": 0.0})

    assert (plan.key, plan.guide_volume) == (None, 0.1)
    assert plan_mix(vocals, [], 0.1, {"by": "lines", "singer1": 0.7}).guide_volume == 0.1


def test_the_key_follows_the_levels_and_the_line_timing_but_not_the_words(vocals):
    levels = {"by": "lines", "singer2": 1.0}
    key = plan_mix(vocals, LINES, 0.0, levels).key

    reworded = [dict(line, text="new words") for line in LINES]
    assert plan_mix(vocals, reworded, 0.0, levels).key == key
    moved = [LINES[0], dict(LINES[1], start_time=3.2)]
    assert plan_mix(vocals, moved, 0.0, levels).key != key
    assert plan_mix(vocals, LINES, 0.0, {"by": "lines", "singer2": 0.9}).key != key
    # The same file name wherever the stems folder is
    assert plan_mix(vocals, LINES, 0.0, dict(levels)).key == key


def test_parts_older_than_the_vocals_are_not_mixed(split, vocals):
    os.utime(vocals)  # re-made after the split

    plan = plan_mix(vocals, LINES, 0.0, {"backing": 1.0})

    assert (plan.key, plan.guide_volume) == (None, 0.0)


def test_stored_levels_keep_known_keys_within_range():
    assert normalize_levels({"backing": 1.7, "singer1": -1, "both": 0.333, "by": "lines"}) == {
        "backing": 1.0,
        "singer1": 0.0,
        "both": 0.33,
        "by": "lines",
    }
    assert normalize_levels({"by": "voices", "male": 1, "backing": None}) == {}
    assert normalize_levels({"backing": True}) == {"backing": 0.0}
    assert normalize_levels(["backing"]) == {}


def test_whether_any_vocal_is_kept():
    assert vocal_mix.any_vocal_kept(0.0, None) is False
    assert vocal_mix.any_vocal_kept(0.2, None) is True
    assert vocal_mix.any_vocal_kept(0.0, {"backing": 1.0}) is True
    assert vocal_mix.any_vocal_kept(0.0, {"backing": 0.02, "by": "lines"}) is False
