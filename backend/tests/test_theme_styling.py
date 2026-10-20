"""Unit and integration tests for CSS-to-ASS color conversion, font size scaling, and ASS subtitle export styling propagation."""

import uuid

import pytest

from backend.project_store import projects, save_projects
from backend.services.ass_generator import (
    css_to_ass_color,
    generate_ass_content,
    generate_ass_subtitles,
)


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

    def test_default_font_size_16_9(self, sample_lines):
        ass = generate_ass_content(sample_lines, aspect_ratio="16:9")
        assert "Style: KaraokeLine1," in ass
        assert ",52," in ass
        assert "Style: Countdown," in ass
        assert ",62," in ass

    def test_default_font_size_9_16(self, sample_lines):
        ass = generate_ass_content(sample_lines, aspect_ratio="9:16")
        assert "Style: KaraokeLine1," in ass
        assert ",46," in ass
        assert "Style: Countdown," in ass
        assert ",56," in ass

    def test_font_size_scaling_factor(self, sample_lines):
        # 16:9 base font size is 52. 52 * 1.5 = 78
        ass = generate_ass_content(sample_lines, aspect_ratio="16:9", font_size_scale=1.5)
        assert ",78," in ass
        assert ",88," in ass  # Countdown is font_size + 10

        # 52 * 0.8 = 41.6 -> round(41.6) = 42
        ass_compact = generate_ass_content(sample_lines, aspect_ratio="16:9", font_size_scale=0.8)
        assert ",42," in ass_compact

    def test_font_size_scale_in_style_config(self, sample_lines):
        # Via style_config dictionary
        ass = generate_ass_content(
            sample_lines,
            aspect_ratio="16:9",
            style_config={"font_size_scale": 1.2},
        )
        # 52 * 1.2 = 62.4 -> 62
        assert ",62," in ass

    def test_custom_color_overrides_conversion(self, sample_lines):
        ass = generate_ass_content(
            sample_lines,
            primary_color="#fbbf24",
            secondary_color="#ffffff",
        )
        # BGR format: &H0024BFFB for primary, &H00FFFFFF for secondary
        assert "&H0024BFFB,&H00FFFFFF," in ass

    def test_generate_ass_subtitles_delegation(self, sample_lines, tmp_path):
        out_file = tmp_path / "test.ass"
        generate_ass_subtitles(
            sample_lines,
            out_file,
            primary_color="#06b6d4",
            font_size_scale=1.5,
        )
        content = out_file.read_text(encoding="utf-8")
        assert "&H00D4B606" in content
        assert ",78," in content


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
        res = client.get(
            f"/api/project/{project_with_lyrics['id']}/export/ass",
            params={
                "aspect_ratio": "16:9",
                "primary_color": "#fbbf24",
                "secondary_color": "#ffffff",
                "font_size_scale": 1.5,
            },
        )
        assert res.status_code == 200
        assert res.headers["content-type"].startswith("text/x-ssa")
        body = res.text
        # Converted BGR: &H0024BFFB
        assert "&H0024BFFB" in body
        assert "&H00FFFFFF" in body
        # Scaled font size: 52 * 1.5 = 78
        assert ",78,&H0024BFFB,&H00FFFFFF," in body

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


def test_generate_ass_content_multi_singer_styles_and_events():
    """generate_ass_content defines multi-singer styles and assigns them matching singer roles."""
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

    ass = generate_ass_content(sample_lines)

    # 1. Verify all 6 line styles are defined in [V4+ Styles]
    assert "Style: KaraokeLine1," in ass
    assert "Style: KaraokeLine2," in ass
    assert "Style: KaraokeLine1_Singer2," in ass
    assert "Style: KaraokeLine2_Singer2," in ass
    assert "Style: KaraokeLine1_Both," in ass
    assert "Style: KaraokeLine2_Both," in ass

    # 2. Verify default colors (&H00B300FF for Singer 2, &H0050FA7B for Both)
    assert "&H00B300FF" in ass  # Neon Pink
    assert "&H0050FA7B" in ass  # Emerald

    # 3. Verify dialogue style mapping
    assert ",KaraokeLine1," in ass
    assert ",KaraokeLine2_Singer2," in ass
    assert ",KaraokeLine1_Both," in ass
    assert "{\\kf" in ass


def test_generate_ass_content_multi_singer_custom_color_overrides():
    """Custom singer colors override defaults for Singer 2 and Both styles."""
    sample_lines = [
        {"id": 0, "text": "Test", "start_time": 1.0, "end_time": 2.0, "singer": "singer2"}
    ]
    ass = generate_ass_content(
        sample_lines,
        singer2_color="#ff1493",  # DeepPink -> &H009314FF
        both_color="#00fa9a",  # MediumSpringGreen -> &H009AFA00
    )
    assert "&H009314FF" in ass
    assert "&H009AFA00" in ass


def test_generate_ass_content_with_gap_countdown_enabled():
    """generate_ass_content generates Countdown style and dialogue events for qualifying gaps >= 4.0s."""
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
    # Countdown style definition
    assert "Style: Countdown," in ass
    # Dialogue events using Countdown style
    assert ",Countdown,,0,0,0,," in ass
    # Countdown dots with \\kf tags
    assert "{\\kf100}● {\\kf100}● {\\kf100}●" in ass


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

    ass = generate_ass_content(sample_lines, include_countdown=False)
    assert ",Countdown,,0,0,0,," not in ass


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
        assert ",Countdown,,0,0,0,," in res_true.text

        # 2. Explicitly false excludes countdown dialogue
        res_false = client.get(
            f"/api/project/{pid}/export/ass", params={"include_countdown": False}
        )
        assert res_false.status_code == 200
        assert ",Countdown,,0,0,0,," not in res_false.text
    finally:
        projects.pop(pid, None)
        save_projects()
