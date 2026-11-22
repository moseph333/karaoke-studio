"""Unit and integration tests for CSS-to-ASS color conversion, font size scaling, and ASS subtitle export styling propagation."""

import re
import uuid

import pytest

from backend.project_store import projects, save_projects
from backend.services.ass_draw import LookStyle
from backend.services.ass_generator import (
    css_to_ass_color,
    generate_ass_content,
    generate_ass_subtitles,
)
from backend.services.stage_looks import LOOKS
from backend.tests.helpers.ass_script import AssEvent, ass_events

# The two-row look sets a short line at one size, which the lyric size scales exactly
ROWS_LOOK = "ktv"


def lyric_rows(ass: str, line: int = 0) -> list[AssEvent]:
    """The events of a line while it is sung: one per row."""
    return [e for e in ass_events(ass) if e.role == f"lyric:{line}"]


def lyric_size(ass: str) -> float:
    """The font size (\\fs) the first line is drawn at."""
    sizes = {float(re.search(r"\\fs([\d.]+)", row.tags).group(1)) for row in lyric_rows(ass)}
    (size,) = sizes
    return size


def cue_kinds(ass: str) -> set[str]:
    """Which of the countdown's events a file has: the count-in, the break marker."""
    return {e.kind for e in ass_events(ass)} & {"countin", "break"}


class TestCssToAssColor:
    """Verifies hex to ASS BGR conversion and boundary handling."""

    def test_six_digit_hex_with_hash(self):
        # Amber / Gold: R=FB, G=BF, B=24 -> BGR: 24, BF, FB
        assert css_to_ass_color("#fbbf24") == "&H0024BFFB"
        assert css_to_ass_color("#FBBF24") == "&H0024BFFB"

    def test_six_digit_hex_without_hash(self):
        assert css_to_ass_color("fbbf24") == "&H0024BFFB"

    def test_cyan_conversion(self):
        # Cyan: R=06, G=B6, B=D4 -> BGR: D4, B6, 06
        assert css_to_ass_color("#06b6d4") == "&H00D4B606"

    def test_primary_channels(self):
        # Red: R=FF, G=00, B=00 -> BGR: 00, 00, FF
        assert css_to_ass_color("#ff0000") == "&H000000FF"
        # Green: R=00, G=FF, B=00 -> BGR: 00, FF, 00
        assert css_to_ass_color("#00ff00") == "&H0000FF00"
        # Blue: R=00, G=00, B=FF -> BGR: FF, 00, 00
        assert css_to_ass_color("#0000ff") == "&H00FF0000"

    def test_white_and_black(self):
        assert css_to_ass_color("#ffffff") == "&H00FFFFFF"
        assert css_to_ass_color("#000000") == "&H00000000"

    def test_three_digit_hex_expansion(self):
        # #f00 -> #ff0000 -> &H000000FF
        assert css_to_ass_color("#f00") == "&H000000FF"
        assert css_to_ass_color("#fff") == "&H00FFFFFF"

    def test_ass_format_passthrough(self):
        # Already ASS format
        assert css_to_ass_color("&H0000D7FF") == "&H0000D7FF"
        assert css_to_ass_color("&h00ffffff") == "&H00FFFFFF"
        assert css_to_ass_color("&HFFFFFF") == "&HFFFFFF"
        assert css_to_ass_color("&H00FFFFFF&") == "&H00FFFFFF"

    def test_text_dressed_as_an_ass_color_falls_back(self):
        for bad in ("&H00FF00FF,Arial,1", "&H00FFFFFF\nDialogue: 0", "&HGGGGGG", "&H12345"):
            assert css_to_ass_color(bad, default="&H00FFFFFF") == "&H00FFFFFF"

    def test_invalid_input_fallback(self):
        assert css_to_ass_color("") == "&H0000D7FF"
        assert css_to_ass_color("not_a_color") == "&H0000D7FF"
        assert css_to_ass_color("zzz", default="&H00FFFFFF") == "&H00FFFFFF"


class TestGenerateAssContentStyling:
    """Verifies typography scaling and color injection into ASS document headers."""

    @pytest.fixture
    def sample_lines(self):
        return [
            {
                "start_time": 1.0,
                "end_time": 3.0,
                "text": "Hello karaoke stage",
                "words": [
                    {"word": "Hello", "start_time": 1.0, "end_time": 1.5},
                    {"word": "karaoke", "start_time": 1.6, "end_time": 2.2},
                    {"word": "stage", "start_time": 2.3, "end_time": 3.0},
                ],
            }
        ]

    def test_font_size_scaling_factor(self, sample_lines):
        plain = lyric_size(generate_ass_content(sample_lines, theme_id=ROWS_LOOK))
        for scale in (1.5, 0.8):
            ass = generate_ass_content(sample_lines, theme_id=ROWS_LOOK, font_size_scale=scale)
            assert lyric_size(ass) == pytest.approx(plain * scale, rel=0.01)

    def test_font_size_scale_in_style_config(self, sample_lines):
        # Via style_config dictionary, which wins over the argument
        plain = lyric_size(generate_ass_content(sample_lines, theme_id=ROWS_LOOK))
        ass = generate_ass_content(
            sample_lines,
            theme_id=ROWS_LOOK,
            font_size_scale=2.0,
            style_config={"font_size_scale": 1.2},
        )
        assert lyric_size(ass) == pytest.approx(plain * 1.2, rel=0.01)

    def test_custom_color_overrides_conversion(self, sample_lines):
        ass = generate_ass_content(
            sample_lines,
            primary_color="#fbbf24",
            secondary_color="#ffffff",
        )
        # BGR format: &H24BFFB& for primary (sung), &HFFFFFF& for secondary (still to sing)
        rows = lyric_rows(ass)
        assert rows and all("\\1c&H24BFFB&\\2c&HFFFFFF&" in row.tags for row in rows)

    def test_generate_ass_subtitles_delegation(self, sample_lines, tmp_path):
        out_file = tmp_path / "test.ass"
        generate_ass_subtitles(
            sample_lines,
            out_file,
            theme_id=ROWS_LOOK,
            primary_color="#06b6d4",
            font_size_scale=1.5,
        )
        content = out_file.read_text(encoding="utf-8")
        assert content == generate_ass_content(
            sample_lines, theme_id=ROWS_LOOK, primary_color="#06b6d4", font_size_scale=1.5
        )
        assert all("\\1c&HD4B606&" in row.tags for row in lyric_rows(content))
        plain = lyric_size(generate_ass_content(sample_lines, theme_id=ROWS_LOOK))
        assert lyric_size(content) == pytest.approx(plain * 1.5, rel=0.01)


class TestExportAssEndpointStyling:
    """Verifies GET /api/project/{id}/export/ass query parameters integration."""

    @pytest.fixture
    def project_with_lyrics(self):
        pid = f"proj_test_theme_{uuid.uuid4().hex[:8]}"
        proj_data = {
            "id": pid,
            "track_id": pid,
            "title": "Theme Symphony",
            "artist": "Color Maestro",
            "duration": 120.0,
            "status": "ready",
            "progress": 100,
            "created_by": "ThemeTester",
            "lines": [
                {
                    "start_time": 0.5,
                    "end_time": 2.5,
                    "text": "Sing in vibrant colors",
                    "words": [
                        {"word": "Sing", "start_time": 0.5, "end_time": 1.0},
                        {"word": "in", "start_time": 1.0, "end_time": 1.3},
                        {"word": "vibrant", "start_time": 1.3, "end_time": 1.8},
                        {"word": "colors", "start_time": 1.8, "end_time": 2.5},
                    ],
                }
            ],
            "semitones": 0,
            "guide_volume": 0.0,
        }
        projects[pid] = proj_data
        save_projects()
        yield proj_data
        projects.pop(pid, None)
        save_projects()

    def test_export_ass_with_custom_colors_and_scale(self, client, project_with_lyrics):
        url = f"/api/project/{project_with_lyrics['id']}/export/ass"
        res = client.get(
            url,
            params={
                "aspect_ratio": "16:9",
                "theme_id": ROWS_LOOK,
                "primary_color": "#fbbf24",
                "secondary_color": "#ffffff",
                "font_size_scale": 1.5,
            },
        )
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/x-ssa")
        body = res.text
        # Converted BGR: &H24BFFB& sung, &HFFFFFF& still to sing
        rows = lyric_rows(body)
        assert rows and all("\\1c&H24BFFB&\\2c&HFFFFFF&" in row.tags for row in rows)
        # Scaled font size: one and a half times the look's own
        plain = client.get(url, params={"aspect_ratio": "16:9", "theme_id": ROWS_LOOK})
        assert lyric_size(body) == pytest.approx(lyric_size(plain.text) * 1.5, rel=0.01)

    def test_export_ass_invalid_font_scale_bounds(self, client, project_with_lyrics):
        # Scale too small (< 0.5)
        res_small = client.get(
            f"/api/project/{project_with_lyrics['id']}/export/ass",
            params={"font_size_scale": 0.2},
        )
        assert res_small.status_code == 422

        # Scale too large (> 3.0)
        res_large = client.get(
            f"/api/project/{project_with_lyrics['id']}/export/ass",
            params={"font_size_scale": 4.5},
        )
        assert res_large.status_code == 422


@pytest.mark.parametrize("look_id", list(LOOKS))
def test_generate_ass_content_multi_singer_styles_and_events(look_id):
    """generate_ass_content draws each line in its part's colours and names a part where the
    singer changes."""
    sample_lines = [
        {
            "id": 0,
            "text": "Singer one solo",
            "start_time": 1.0,
            "end_time": 3.0,
            "singer": "singer1",
            "words": [{"word": "Singer", "start_time": 1.0, "end_time": 2.0}],
        },
        {
            "id": 1,
            "text": "Singer two solo",
            "start_time": 4.0,
            "end_time": 6.0,
            "singer": "singer2",
            "words": [{"word": "Singer", "start_time": 4.0, "end_time": 5.0}],
        },
        {
            "id": 2,
            "text": "Duet harmony",
            "start_time": 7.0,
            "end_time": 9.0,
            "singer": "both",
            "words": [{"word": "Duet", "start_time": 7.0, "end_time": 8.0}],
        },
    ]

    ass = generate_ass_content(sample_lines, theme_id=look_id)
    look = LookStyle.of(look_id)

    # 1. Every part has colours of its own
    colours = {part: look.sweep_colors(part) for part in ("singer1", "singer2", "both")}
    assert len(set(colours.values())) == 3

    # 2. Each line is filled in the colours of the part that sings it
    for index, part in enumerate(("singer1", "singer2", "both")):
        sung, unsung = colours[part]
        rows = lyric_rows(ass, index)
        assert rows and all(f"\\1c{sung}\\2c{unsung}" in row.tags for row in rows)
        assert all("{\\kf" in row.text for row in rows)

    # 3. A part is named where the singer changes
    named = {e.line: e.plain.casefold() for e in ass_events(ass) if e.kind == "part"}
    assert named == {0: "singer 1", 1: "singer 2", 2: "both"}


def test_generate_ass_content_multi_singer_custom_color_overrides():
    """Custom singer colors override defaults for Singer 2 and Both lines."""
    sample_lines = [
        {"id": 0, "text": "Test", "start_time": 1.0, "end_time": 2.0, "singer": "singer2"},
        {"id": 1, "text": "Together", "start_time": 3.0, "end_time": 4.0, "singer": "both"},
    ]
    ass = generate_ass_content(
        sample_lines,
        singer2_color="#ff1493",  # DeepPink -> &H9314FF&
        both_color="#00fa9a",  # MediumSpringGreen -> &H9AFA00&
    )
    assert all("\\1c&H9314FF&" in row.tags for row in lyric_rows(ass, 0))
    assert all("\\1c&H9AFA00&" in row.tags for row in lyric_rows(ass, 1))
    assert lyric_rows(ass, 0) and lyric_rows(ass, 1)
    named = {e.line: e.tags for e in ass_events(ass) if e.kind == "part"}
    assert "\\1c&H9314FF&" in named[0] and "\\1c&H9AFA00&" in named[1]


def test_generate_ass_content_with_gap_countdown_enabled():
    """generate_ass_content counts in every line that follows a qualifying gap >= 4.0s."""
    sample_lines = [
        {
            "id": 0,
            "text": "Intro after long gap",
            "start_time": 6.0,
            "end_time": 9.0,
            "singer": "singer1",
            "words": [{"word": "Intro", "start_time": 6.0, "end_time": 7.0}],
        },
        {
            "id": 1,
            "text": "Line after inter-line gap",
            "start_time": 15.0,
            "end_time": 18.0,
            "singer": "singer2",
            "words": [{"word": "Line", "start_time": 15.0, "end_time": 16.0}],
        },
    ]

    ass = generate_ass_content(sample_lines, include_countdown=True)
    for index, sung_at in ((0, 6.0), (1, 15.0)):
        cue = [e for e in ass_events(ass) if e.role == f"countin:{index}"]
        # A numeral a second over the last three seconds before the line
        assert [(e.start, e.end, e.plain) for e in cue] == [
            (sung_at - 3.0, sung_at - 2.0, "3"),
            (sung_at - 2.0, sung_at - 1.0, "2"),
            (sung_at - 1.0, sung_at, "1"),
        ]
        assert {e.layer for e in cue} == {1}
    assert cue_kinds(ass) == {"countin", "break"}


def test_generate_ass_content_with_gap_countdown_disabled():
    """generate_ass_content omits countdown dialogue events when include_countdown is False."""
    sample_lines = [
        {
            "id": 0,
            "text": "Intro after long gap",
            "start_time": 6.0,
            "end_time": 9.0,
            "singer": "singer1",
            "words": [{"word": "Intro", "start_time": 6.0, "end_time": 7.0}],
        },
    ]

    assert cue_kinds(generate_ass_content(sample_lines, include_countdown=True)) == {"countin"}
    ass = generate_ass_content(sample_lines, include_countdown=False)
    assert cue_kinds(ass) == set()
    assert lyric_rows(ass)


def test_export_ass_endpoint_include_countdown_query_parameter(client):
    """GET /api/project/{id}/export/ass respects include_countdown query flag."""
    pid = f"proj_test_countdown_{uuid.uuid4().hex[:8]}"
    proj_data = {
        "id": pid,
        "track_id": pid,
        "title": "Countdown Track",
        "artist": "Timer Master",
        "duration": 60.0,
        "status": "ready",
        "progress": 100,
        "created_by": "Tester",
        "lines": [
            {
                "start_time": 5.5,
                "end_time": 8.0,
                "text": "Singing starts at 5.5s",
                "words": [{"word": "Singing", "start_time": 5.5, "end_time": 6.5}],
            }
        ],
        "semitones": 0,
        "guide_volume": 0.0,
    }
    projects[pid] = proj_data
    save_projects()

    try:
        # 1. Default (or explicitly true) includes countdown dialogue
        res_true = client.get(f"/api/project/{pid}/export/ass", params={"include_countdown": True})
        assert res_true.status_code == 200
        assert cue_kinds(res_true.text) == {"countin", "break"}
        assert client.get(f"/api/project/{pid}/export/ass").text == res_true.text

        # 2. Explicitly false excludes countdown dialogue
        res_false = client.get(
            f"/api/project/{pid}/export/ass", params={"include_countdown": False}
        )
        assert res_false.status_code == 200
        assert cue_kinds(res_false.text) == set()
        assert lyric_rows(res_false.text)
    finally:
        projects.pop(pid, None)
        save_projects()
