"""Which value an exported subtitle file uses when the function arguments, the request's
style_config, the stage look (theme preset) and the defaults disagree, one rule at a time."""

import re

import pytest

from backend.services.ass_generator import (
    DEFAULT_BOTH_COLOR,
    DEFAULT_SINGER2_COLOR,
    AssStyle,
    generate_ass_content,
    resolve_sync_mode,
    singer_part,
)

# A line after a 5 s intro (long enough for a countdown cue) and a chord under it
LINES = [
    {
        "text": "Hello there",
        "start_time": 5.0,
        "end_time": 7.0,
        "words": [
            {"word": "Hello", "start_time": 5.0, "end_time": 5.8},
            {"word": "there", "start_time": 6.0, "end_time": 7.0},
        ],
    }
]
C_CHORD = [{"start": 5.0, "end": 7.0, "chord": "C"}]
G_CHORD = [{"start": 5.0, "end": 7.0, "chord": "G"}]


def styles(ass: str) -> dict[str, dict[str, str]]:
    """Each style's fields by name, read with the file's own Format line."""
    found, fields = {}, []
    for line in ass.splitlines():
        if line.startswith("Format: Name,"):
            fields = [field.strip() for field in line[len("Format: ") :].split(",")]
        elif line.startswith("Style: "):
            values = line[len("Style: ") :].split(",")
            found[values[0]] = dict(zip(fields, values, strict=True))
    return found


def events(ass: str, style: str) -> list[str]:
    return [
        line.split(",,0,0,0,,", 1)[1]
        for line in ass.splitlines()
        if line.startswith("Dialogue:") and f",{style},," in line
    ]


def play_res(ass: str) -> tuple[int, int]:
    x = re.search(r"PlayResX: (\d+)", ass)
    y = re.search(r"PlayResY: (\d+)", ass)
    return int(x.group(1)), int(y.group(1))


# 1. Sync mode: the argument wins unless it is None or the "word" default


@pytest.mark.parametrize(
    "arg, cfg, mode",
    [
        ("line", {"sync_mode": "word"}, "line"),
        ("word", {"sync_mode": "line"}, "line"),
        (None, {"sync_mode": "line"}, "line"),
        ("word", None, "word"),
        ("LINE", None, "line"),
        ("karaoke", None, "word"),
    ],
)
def test_sync_mode(arg, cfg, mode):
    (text,) = events(generate_ass_content(LINES, style_config=cfg, sync_mode=arg), "KaraokeLine1")
    assert ("\\kf" in text) == (mode == "word")


# 2. Countdown: style_config wins, including its legacy name enable_gap_countdown


@pytest.mark.parametrize(
    "arg, cfg, shown",
    [
        (True, {"include_countdown": False}, False),
        (False, {"include_countdown": True}, True),
        (True, {"enable_gap_countdown": False}, False),
        (False, {"include_countdown": True, "enable_gap_countdown": False}, True),
        (True, None, True),
        (False, None, False),
    ],
)
def test_countdown(arg, cfg, shown):
    ass = generate_ass_content(LINES, style_config=cfg, include_countdown=arg)
    assert bool(events(ass, "Countdown")) == shown


# 3. Chords on/off, transposition and font scale: style_config wins when it has the key


@pytest.mark.parametrize(
    "arg, cfg, shown",
    [(False, {"include_chords": True}, True), (True, {"include_chords": False}, False)],
)
def test_include_chords(arg, cfg, shown):
    ass = generate_ass_content(LINES, style_config=cfg, include_chords=arg, chords=C_CHORD)
    assert ("Chord" in styles(ass)) == shown
    assert bool(events(ass, "Chord")) == shown


@pytest.mark.parametrize(
    "arg, cfg, chord", [(0, {"semitones": 2}, "D"), (2, {"semitones": 0}, "C")]
)
def test_semitones(arg, cfg, chord):
    ass = generate_ass_content(
        LINES, style_config=cfg, semitones=arg, chords=C_CHORD, include_chords=True
    )
    assert events(ass, "Chord") == ["{\\an8}" + chord]


@pytest.mark.parametrize(
    "arg, cfg, size",
    [
        (1.0, {"font_size_scale": 2.0}, "104"),
        (2.0, {}, "104"),
        (2.0, {"font_size_scale": 1.0}, "52"),
        (0.0, None, "52"),
        (-3.0, None, "52"),
    ],
)
def test_font_size_scale(arg, cfg, size):
    ass = generate_ass_content(LINES, style_config=cfg, font_size_scale=arg)
    assert styles(ass)["KaraokeLine1"]["Fontsize"] == size


# 4. Chords and key: the argument wins unless it is None


@pytest.mark.parametrize(
    "arg, cfg, chord", [(C_CHORD, {"chords": G_CHORD}, "C"), (None, {"chords": G_CHORD}, "G")]
)
def test_chords(arg, cfg, chord):
    ass = generate_ass_content(LINES, style_config=cfg, chords=arg, include_chords=True)
    assert events(ass, "Chord") == ["{\\an8}" + chord]


@pytest.mark.parametrize(
    "arg, cfg, chord",
    [
        ("F Major", None, "Db"),
        (None, {"key": "F Major"}, "Db"),
        ("C Major", {"key": "F Major"}, "C#"),
        (None, None, "C#"),
    ],
)
def test_key_spells_the_transposed_chord(arg, cfg, chord):
    ass = generate_ass_content(
        LINES, style_config=cfg, key=arg, chords=C_CHORD, include_chords=True, semitones=1
    )
    assert events(ass, "Chord") == ["{\\an8}" + chord]


# 5. Aspect ratio: style_config's wins, portrait also follows from its width and height, and
# portrait defaults only fill what style_config leaves out


@pytest.mark.parametrize(
    "arg, cfg, res",
    [
        ("16:9", {"aspect_ratio": "9:16"}, (1080, 1920)),
        ("9:16", {"aspect_ratio": None}, (1080, 1920)),
        ("9:16", None, (1080, 1920)),
        ("16:9", {"width": 720, "height": 1280}, (720, 1280)),
        ("16:9", None, (1920, 1080)),
    ],
)
def test_aspect_ratio(arg, cfg, res):
    assert play_res(generate_ass_content(LINES, style_config=cfg, aspect_ratio=arg)) == res


def test_portrait_defaults_fill_only_what_style_config_leaves_out():
    portrait = styles(generate_ass_content(LINES, aspect_ratio="9:16"))["KaraokeLine1"]
    assert (portrait["Fontsize"], portrait["MarginV"]) == ("46", "640")

    custom = styles(
        generate_ass_content(
            LINES, aspect_ratio="9:16", style_config={"font_size": 60, "margin_v_line1": 500}
        )
    )["KaraokeLine1"]
    assert (custom["Fontsize"], custom["MarginV"]) == ("60", "500")


# 6. Stage look: the theme_id argument wins over style_config's; the preset fills only what
# style_config leaves out, and the defaults what neither sets


@pytest.mark.parametrize(
    "arg, cfg, font",
    [
        ("punk_diy", {"theme_id": "afterglow"}, "Impact"),
        (None, {"theme_id": "afterglow"}, "Sora"),
        ("punk_diy", {"font_name": "Courier New"}, "Courier New"),
        (None, None, "Montserrat"),
        ("no_such_look", None, "Montserrat"),
    ],
)
def test_theme_font(arg, cfg, font):
    assert (
        styles(generate_ass_content(LINES, theme_id=arg, style_config=cfg))["KaraokeLine1"][
            "Fontname"
        ]
        == font
    )


def test_theme_preset_colours_and_outline_fill_what_style_config_leaves_out():
    line = styles(
        generate_ass_content(LINES, theme_id="punk_diy", style_config={"outline_width": 5})
    )["KaraokeLine1"]
    assert line["PrimaryColour"] == "&H0015CCFA"
    assert line["SecondaryColour"] == "&H00F5F5F5"
    assert line["Outline"] == "5"
    assert line["Shadow"] == "3"


# 7. Sung and unsung colours: an argument that is not None wins; every source is normalised


@pytest.mark.parametrize(
    "kwargs, primary, secondary",
    [
        (
            {"primary_color": "#ff0000", "style_config": {"primary_color": "#00ff00"}},
            "&H000000FF",
            "&H00FFFFFF",
        ),
        ({"style_config": {"primary_color": "#00ff00"}}, "&H0000FF00", "&H00FFFFFF"),
        ({"theme_id": "punk_diy"}, "&H0015CCFA", "&H00F5F5F5"),
        ({"theme_id": "punk_diy", "secondary_color": "#000"}, "&H0015CCFA", "&H00000000"),
        ({"primary_color": "nonsense", "secondary_color": "nonsense"}, "&H0000D7FF", "&H00FFFFFF"),
        ({"primary_color": "&h00abcdef&"}, "&H00ABCDEF", "&H00FFFFFF"),
    ],
)
def test_sung_and_unsung_colours(kwargs, primary, secondary):
    line = styles(generate_ass_content(LINES, **kwargs))["KaraokeLine1"]
    assert (line["PrimaryColour"], line["SecondaryColour"]) == (primary, secondary)


# 8. Duet colours: a given argument > style_config > the preset > the defaults, and a value
# that is not a colour counts as not given


@pytest.mark.parametrize(
    "kwargs, singer2, both",
    [
        (
            {
                "theme_id": "afterglow",
                "singer2_color": "#00ff00",
                "both_color": "#ff0000",
                "style_config": {"singer2_color": "#0000ff", "both_color": "#0000ff"},
            },
            "&H0000FF00",
            "&H000000FF",
        ),
        (
            {
                "theme_id": "afterglow",
                "style_config": {"singer2_color": "#0000ff", "both_color": "#00ff00"},
            },
            "&H00FF0000",
            "&H0000FF00",
        ),
        ({"theme_id": "afterglow"}, "&H00B672F4", "&H00D4EA5E"),
        ({}, DEFAULT_SINGER2_COLOR, DEFAULT_BOTH_COLOR),
        (
            {"theme_id": "afterglow", "singer2_color": "bogus", "both_color": "bogus"},
            "&H00B672F4",
            "&H00D4EA5E",
        ),
        (
            {"singer2_color": "bogus", "both_color": "bogus"},
            DEFAULT_SINGER2_COLOR,
            DEFAULT_BOTH_COLOR,
        ),
    ],
)
def test_duet_colours(kwargs, singer2, both):
    found = styles(generate_ass_content(LINES, **kwargs))
    assert found["KaraokeLine1_Singer2"]["PrimaryColour"] == singer2
    assert found["KaraokeLine1_Both"]["PrimaryColour"] == both


def test_the_rules_are_one_resolve_call():
    style = AssStyle.resolve(theme_id="punk_diy", aspect_ratio="9:16", font_size_scale=2.0)

    assert (style.font_name, style.font_size, style.width, style.height) == (
        "Impact",
        92,
        1080,
        1920,
    )
    assert resolve_sync_mode("word", {"sync_mode": "line"}) == "line"


@pytest.mark.parametrize(
    "singer, part",
    [
        ("Singer 2", "singer2"),
        ("s2", "singer2"),
        ("partner", "singer2"),
        ("together", "both"),
        ("unison", "both"),
        (None, "singer1"),
        ("lead", "singer1"),
    ],
)
def test_singer_part(singer, part):
    assert singer_part({"singer": singer}) == part
