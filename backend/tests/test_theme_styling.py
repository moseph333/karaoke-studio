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
