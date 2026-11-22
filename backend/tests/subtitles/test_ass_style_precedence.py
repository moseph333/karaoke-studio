"""resolve_look_style: which of the arguments, the request's style_config and the look
decides each part of an export's look, including what a tab from before the looks sends."""

import pytest

from backend.services.ass_generator import generate_ass_content
from backend.services.ass_style import resolve_look_style, resolve_sync_mode
from backend.services.stage_looks import DEFAULT_LOOK_ID, LEGACY_IDS, LOOKS
from backend.tests.helpers.ass_script import ass_events, parse_ass

LINE = [
    {
        "text": "Hello there",
        "start_time": 2.0,
        "end_time": 4.0,
        "words": [
            {"word": "Hello", "start_time": 2.0, "end_time": 3.0},
            {"word": "there", "start_time": 3.0, "end_time": 4.0},
        ],
    }
]


# --- the look ----------------------------------------------------------------------------


def test_no_look_named_gives_the_default_look():
    assert resolve_look_style().look["id"] == DEFAULT_LOOK_ID == "marquee"
    assert resolve_look_style({}).look["id"] == "marquee"


def test_the_theme_id_argument_wins_over_style_configs():
    style = resolve_look_style({"theme_id": "ktv"}, theme_id="songbook")
    assert style.look["id"] == "songbook"
    assert resolve_look_style({"theme_id": "ktv"}).look["id"] == "ktv"


@pytest.mark.parametrize("old_id", list(LEGACY_IDS))
def test_a_replaced_presets_id_gives_the_look_nearest_it(old_id):
    assert resolve_look_style(theme_id=old_id).look["id"] == LEGACY_IDS[old_id]["look"]
    assert resolve_look_style({"theme_id": old_id}).look["id"] == LEGACY_IDS[old_id]["look"]


@pytest.mark.parametrize("unknown", ["nope", "", 7, None, ["ktv"]])
def test_an_unknown_look_gives_the_default(unknown):
    assert resolve_look_style({"theme_id": unknown}).look["id"] == "marquee"


# --- colours -----------------------------------------------------------------------------


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_with_nothing_chosen_the_colours_are_the_looks(look_id):
    style = resolve_look_style(theme_id=look_id)
    palette = LOOKS[look_id]["palette"]
    assert (style.sung, style.unsung, style.singer2, style.both) == (
        palette["sung"],
        palette["unsung"],
        palette["singer2"],
        palette["both"],
    )


def test_a_colour_argument_wins_over_style_config_which_wins_over_the_look():
    config = {"primary_color": "#111111", "secondary_color": "#222222"}
    style = resolve_look_style(config, theme_id="ktv", primary_color="#abcdef")
    assert style.sung == "#abcdef"
    assert style.unsung == "#222222"
    assert style.singer2 == LOOKS["ktv"]["palette"]["singer2"]


def test_colours_may_be_css_or_ass_and_come_out_as_css():
    style = resolve_look_style(
        theme_id="ktv",
        primary_color="&H00FF0000",
        secondary_color="ABC",
        singer2_color="&H0000FF&",
        both_color="#00FF00",
    )
    assert (style.sung, style.unsung, style.singer2, style.both) == (
        "#0000ff",
        "#aabbcc",
        "#ff0000",
        "#00ff00",
    )


@pytest.mark.parametrize("bad", ["", "   ", "red", "#12", "&HXYZ", "{\\fs200}", 12, None])
def test_a_value_that_is_not_a_colour_counts_as_not_chosen(bad):
    style = resolve_look_style({"primary_color": bad, "both_color": bad}, theme_id="ktv")
    assert style.sung == LOOKS["ktv"]["palette"]["sung"]
    assert style.both == LOOKS["ktv"]["palette"]["both"]


def test_a_bad_argument_falls_back_to_style_configs_colour():
    style = resolve_look_style({"primary_color": "#123456"}, theme_id="ktv", primary_color="nope")
    assert style.sung == "#123456"


# --- what a tab from before the looks sends -------------------------------------------------


def test_an_old_tabs_preset_colours_are_not_taken_for_a_choice():
    """The stage sent the preset's own colours with every request. Afterglow's gold and
    lavender are the preset's, so Marquee keeps its own colours."""
    old_request = {
        "theme_id": "afterglow",
        "primary_color": "&H0024BFFB",
        "secondary_color": "&H00FFEBED",
        "singer2_color": "#f472b6",
        "both_color": "#5eead4",
    }
    style = resolve_look_style(old_request)
    marquee = LOOKS["marquee"]["palette"]
    assert style.look["id"] == "marquee"
    assert (style.sung, style.unsung, style.singer2, style.both) == (
        marquee["sung"],
        marquee["unsung"],
        marquee["singer2"],
        marquee["both"],
    )


def test_an_old_tabs_default_duet_colours_are_not_a_choice_either():
    """Presets without duet colours of their own were sent the old defaults."""
    old_request = {
        "theme_id": "modern_gold",
        "primary_color": "&H0000D7FF",
        "secondary_color": "&H00FFFFFF",
        "singer2_color": "#ff00b3",
        "both_color": "#7bfa50",
    }
    style = resolve_look_style(old_request)
    ktv = LOOKS["ktv"]["palette"]
    assert (style.sung, style.singer2, style.both) == (ktv["sung"], ktv["singer2"], ktv["both"])


def test_a_colour_the_user_really_picked_under_an_old_preset_is_kept():
    style = resolve_look_style({"theme_id": "afterglow", "primary_color": "#00ff88"})
    assert style.sung == "#00ff88"
    assert style.unsung == LOOKS["marquee"]["palette"]["unsung"]


@pytest.mark.parametrize(
    ("old_id", "colour"), [("cyber_cyan", "#00ffff"), ("neon_pink", "#ff00b3")]
)
def test_a_preset_that_was_only_a_colour_carries_it_over(old_id, colour):
    """Cyber Cyan and Neon Sunset were the classic look in another colour: the colour is
    what their users chose, so KTV sweeps in it."""
    assert resolve_look_style({"theme_id": old_id}).sung == colour
    sent = {"theme_id": old_id, "primary_color": LEGACY_IDS[old_id]["was"]["sung"]}
    assert resolve_look_style(sent).sung == colour
    assert resolve_look_style({"theme_id": old_id, "primary_color": "#123456"}).sung == "#123456"


def test_the_same_colour_under_a_new_look_is_a_choice():
    """Afterglow's gold sent with a look's own id was picked on purpose."""
    style = resolve_look_style({"theme_id": "marquee", "primary_color": "#fbbf24"})
    assert style.sung == "#fbbf24"


# --- size, format, cues, sync mode ----------------------------------------------------------


def test_style_configs_lyric_size_wins_over_the_argument():
    assert resolve_look_style({"font_size_scale": 1.5}, font_size_scale=0.8).scale == 1.5
    assert resolve_look_style({}, font_size_scale=0.8).scale == 0.8


@pytest.mark.parametrize(
    ("given", "expected"),
    [(0, 0.1), (-3, 0.1), (99, 5.0), ("1.2", 1.2), ("big", 1.0), (float("nan"), 1.0), (True, 1.0)],
)
def test_a_lyric_size_is_clamped_and_a_bad_one_ignored(given, expected):
    assert resolve_look_style({"font_size_scale": given}).scale == pytest.approx(expected)


@pytest.mark.parametrize(
    ("given", "expected"),
    [(0.001, 0.1), (100, 5.0), (0, 1.0), (-2, 1.0), (float("inf"), 1.0), (float("nan"), 1.0)],
)
def test_the_lyric_size_argument_is_kept_in_the_same_range(given, expected):
    assert resolve_look_style(font_size_scale=given).scale == pytest.approx(expected)
    assert resolve_look_style({}, font_size_scale="big").scale == 1.0  # type: ignore[arg-type]


def test_the_format_is_style_configs_then_the_arguments():
    assert resolve_look_style({"aspect_ratio": "9:16"}).frame.aspect == "9:16"
    assert resolve_look_style({}, aspect_ratio="9:16").frame.aspect == "9:16"
    assert resolve_look_style({"aspect_ratio": "9:16"}, aspect_ratio="16:9").frame.aspect == "9:16"
    assert resolve_look_style({}).frame.aspect == "16:9"


def test_a_style_config_taller_than_wide_is_portrait():
    assert resolve_look_style({"width": 720, "height": 1280}).frame.aspect == "9:16"
    assert resolve_look_style({"width": 1280, "height": 720}).frame.aspect == "16:9"
    # The frame itself is always 1080p
    frame = resolve_look_style({"width": 720, "height": 1280}).frame
    assert (frame.width_px, frame.height_px) == (1080, 1920)


def test_cues_follow_style_config_then_its_legacy_name_then_the_argument():
    assert resolve_look_style({"include_countdown": False}).cues is False
    assert resolve_look_style({"enable_gap_countdown": False}).cues is False
    assert resolve_look_style({"include_countdown": True}, include_countdown=False).cues is True
    assert resolve_look_style({}, include_countdown=False).cues is False
    assert resolve_look_style({}).cues is True


def test_sync_mode_is_the_arguments_unless_it_is_the_default():
    assert resolve_sync_mode("line", {"sync_mode": "word"}) == "line"
    assert resolve_sync_mode("word", {"sync_mode": "line"}) == "line"
    assert resolve_sync_mode(None, {"sync_mode": "LINE "}) == "line"
    assert resolve_sync_mode("nonsense", None) == "word"
    assert resolve_look_style({"sync_mode": "line"}).sync_mode == "line"


def test_the_plain_download_is_drawn_without_the_progress_line():
    assert resolve_look_style(frame="subtitles").furniture is False
    assert resolve_look_style().furniture is True


def test_part_names_are_kept_only_when_they_are_a_mapping():
    assert resolve_look_style(part_names={"singer1": "Mara"}).part_names == {"singer1": "Mara"}
    assert resolve_look_style(part_names="Mara").part_names is None  # type: ignore[arg-type]


# --- through the generator -------------------------------------------------------------------


def test_the_generator_draws_the_resolved_look():
    text = generate_ass_content(
        LINE,
        style_config={"theme_id": "tape_70s", "font_size_scale": 2, "aspect_ratio": "9:16"},
        primary_color="#00ff00",
    )
    info = parse_ass(text)["info"]
    assert (info["PlayResX"], info["PlayResY"]) == ("1080", "1920")
    lyric = next(e for e in ass_events(text) if e.kind == "lyric")
    assert lyric.style == LOOKS["cinema"]["frames"]["9:16"]["lyric"]["face"]
    assert "\\1c&H00FF00&" in lyric.tags


def test_chords_semitones_and_key_follow_style_config_then_the_arguments():
    chords = [{"chord": "C", "start": 1.0, "end": 2.0}]

    def drawn(**kwargs) -> list[str]:
        return [
            e.plain for e in ass_events(generate_ass_content(LINE, **kwargs)) if e.kind == "chord"
        ]

    assert drawn(chords=chords) == []
    assert drawn(chords=chords, include_chords=True) == ["C"]
    assert drawn(chords=chords, include_chords=True, semitones=2) == ["D"]
    assert drawn(chords=chords, style_config={"include_chords": True, "semitones": 4}) == ["E"]
    assert drawn(style_config={"include_chords": True, "chords": chords}) == ["C"]
    assert drawn(chords=chords, include_chords=True, style_config={"include_chords": False}) == []


def test_the_cards_show_the_card_names_or_the_title_alone():
    def cards(**kwargs) -> list[str]:
        late = [{**LINE[0], "start_time": 20.0, "end_time": 22.0, "words": []}]
        text = generate_ass_content(late, theme_id="ktv", song_duration=40.0, **kwargs)
        return [e.plain for e in ass_events(text) if e.kind == "title"]

    assert cards(title="Queen - Song") == ["Queen - Song"]
    assert cards(title="Queen - Song", card_title="Song", card_artist="Queen") == ["Song", "Queen"]
    assert cards(title="Queen - Song", card_title="Song", card_artist="") == ["Song"]
