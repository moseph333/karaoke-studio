"""Backend Theme & Export Pipeline Parity Test Suite (Milestone 3).

Verifies:
1. Inventory completeness of all 9 visual themes (4 legacy + 4 app-matched + afterglow) in VISUAL_THEMES.
2. Valid ASS header, styles block, and BGR color code generation across all 9 presets.
3. Punk Rock DIY preset attributes (Impact font, flyer yellow &H0015CCFA, paper unsung &H00F5F5F5, black outline/shadow).
4. New distinct theme attributes (tape_70s, crt_ktv, clean_paper).
5. Custom color overrides (primary_color, secondary_color) overriding preset defaults.
6. Custom font_name in style_config overriding preset font.
7. Aspect ratio 9:16 vertical shorts layout with new themes.
8. VideoRenderer delegation with new themes.
9. FastAPI GET /api/project/{id}/export/ass endpoint accepting all 9 theme IDs with HTTP 200.
10. FastAPI GET /api/project/{id}/export/ass rejecting unknown theme IDs with HTTP 400.
11. FastAPI GET /api/project/{id}/export/ass combining theme preset with direct color overrides.
"""

import uuid

import pytest

from backend.main import projects
from backend.project_store import save_projects
from backend.services.ass_generator import (
    VISUAL_THEMES,
    generate_ass_content,
)
from backend.services.video_renderer import VideoRenderer

# All expected theme IDs
LEGACY_THEMES = ["modern_gold", "cyber_cyan", "neon_pink", "classic_ktv"]
NEW_THEMES = ["punk_diy", "tape_70s", "crt_ktv", "clean_paper"]
FLAGSHIP_THEMES = ["afterglow"]
ALL_THEMES = LEGACY_THEMES + NEW_THEMES + FLAGSHIP_THEMES

SAMPLE_LINES = [
    {
        "id": 1,
        "start_time": 1.0,
        "end_time": 3.0,
        "text": "Singing underground punk zine lyrics",
        "words": [
            {"word": "Singing", "start_time": 1.0, "end_time": 1.5},
            {"word": "underground", "start_time": 1.5, "end_time": 2.2},
            {"word": "punk", "start_time": 2.2, "end_time": 2.6},
            {"word": "zine", "start_time": 2.6, "end_time": 3.0},
        ],
    }
]


@pytest.fixture
def test_project():
    """Create a temporary ready project with lyric lines for export endpoint testing."""
    pid = f"proj_parity_{uuid.uuid4().hex[:8]}"
    proj_data = {
        "id": pid,
        "track_id": pid,
        "title": "Parity Anthem",
        "artist": "The Anarchists",
        "duration": 180.0,
        "status": "ready",
        "progress": 100,
        "created_by": "ParityTester",
        "lines": SAMPLE_LINES,
        "semitones": 0,
        "guide_volume": 0.0,
        "render_status": "idle",
    }
    projects[pid] = proj_data
    save_projects()
    yield proj_data
    projects.pop(pid, None)
    save_projects()


class TestVisualThemesRegistry:
    """Verifies VISUAL_THEMES dictionary structure and registry completeness."""

    def test_theme_inventory_contains_all_9_presets(self):
        """VISUAL_THEMES must contain exactly 9 presets: 4 legacy, 4 app-matched, 1 flagship."""
        assert len(VISUAL_THEMES) == 9
        for tid in ALL_THEMES:
            assert tid in VISUAL_THEMES, f"Missing preset '{tid}' in VISUAL_THEMES"

    def test_legacy_presets_strictly_preserved(self):
        """Legacy presets modern_gold, cyber_cyan, neon_pink, classic_ktv are unmodified."""
        assert VISUAL_THEMES["modern_gold"]["primary_color"] == "&H0000D7FF"
        assert VISUAL_THEMES["modern_gold"]["secondary_color"] == "&H00FFFFFF"

        assert VISUAL_THEMES["cyber_cyan"]["primary_color"] == "&H00FFFF00"
        assert VISUAL_THEMES["cyber_cyan"]["secondary_color"] == "&H00FFFFFF"

        assert VISUAL_THEMES["neon_pink"]["primary_color"] == "&H00B300FF"
        assert VISUAL_THEMES["neon_pink"]["secondary_color"] == "&H00FFFFFF"

        assert VISUAL_THEMES["classic_ktv"]["primary_color"] == "&H0000FFFF"
        assert VISUAL_THEMES["classic_ktv"]["secondary_color"] == "&H00FFFFFF"

    def test_new_presets_have_required_metadata(self):
        """Every new preset must define id, name, description, primary_color, secondary_color."""
        for tid in NEW_THEMES:
            theme = VISUAL_THEMES[tid]
            assert theme["id"] == tid
            assert len(theme["name"]) > 0
            assert len(theme["description"]) > 0
            assert theme["primary_color"].startswith("&H00")
            assert theme["secondary_color"].startswith("&H00")

    def test_punk_diy_preset_definition(self):
        """punk_diy defines Impact font, flyer yellow, paper off-white, and bold borders."""
        punk = VISUAL_THEMES["punk_diy"]
        assert punk["primary_color"] == "&H0015CCFA"  # #facc15 in BGR
        assert punk["secondary_color"] == "&H00F5F5F5"  # #f5f5f5 in BGR
        assert punk["font_name"] == "Impact"
        assert punk["outline_color"] == "&H00000000"  # Black outline
        assert punk["shadow_color"] == "&H00000000"  # Solid black shadow


class TestAssGeneratorThemeParity:
    """Verifies generate_ass_content styling, font, and color injection."""

    @pytest.mark.parametrize("theme_id", ALL_THEMES)
    def test_all_8_themes_generate_valid_ass_styles(self, theme_id):
        """All 8 presets generate valid ASS scripts with primary/secondary theme colors."""
        content = generate_ass_content(SAMPLE_LINES, theme_id=theme_id)
        theme = VISUAL_THEMES[theme_id]

        assert "[Script Info]" in content
        assert "[V4+ Styles]" in content
        assert "[Events]" in content

        # Verify primary and secondary colors appear in KaraokeLine1 style
        expected_color_pair = f",{theme['primary_color']},{theme['secondary_color']},"
        assert expected_color_pair in content

    def test_punk_diy_generates_impact_font_and_colors(self):
        """punk_diy generates Style lines with Impact font and flyer yellow/paper colors."""
        content = generate_ass_content(SAMPLE_LINES, theme_id="punk_diy")
        assert "Style: KaraokeLine1,Impact,52,&H0015CCFA,&H00F5F5F5," in content
        assert "Style: KaraokeLine2,Impact,52,&H0015CCFA,&H00F5F5F5," in content

    def test_tape_70s_generates_amber_sepia_palette(self):
        """tape_70s generates warm amber VU primary and sepia cream secondary."""
        content = generate_ass_content(SAMPLE_LINES, theme_id="tape_70s")
        assert ",&H000B9EF5,&H00C7F3FE," in content
        assert "Style: KaraokeLine1,Georgia," in content

    def test_crt_ktv_generates_phosphor_green_palette(self):
        """crt_ktv generates phosphor green primary and mint secondary."""
        content = generate_ass_content(SAMPLE_LINES, theme_id="crt_ktv")
        assert ",&H005EC522,&H00ACEF86," in content
        assert "Style: KaraokeLine1,VT323," in content

    def test_clean_paper_generates_brutalist_palette(self):
        """clean_paper generates editorial red marker and monochrome ink."""
        content = generate_ass_content(SAMPLE_LINES, theme_id="clean_paper")
        assert ",&H002626DC,&H00111111," in content
        assert "Style: KaraokeLine1,Space Grotesk," in content

    def test_custom_primary_color_overrides_preset_sung_color(self):
        """Direct primary_color overrides the theme's preset sung color."""
        content = generate_ass_content(
            SAMPLE_LINES,
            theme_id="punk_diy",
            primary_color="#00ffff",  # Cyan override
        )
        # Cyan BGR: &H00FFFF00
        assert ",&H00FFFF00,&H00F5F5F5," in content
        assert "&H0015CCFA" not in content

    def test_custom_secondary_color_overrides_preset_unsung_color(self):
        """Direct secondary_color overrides the theme's preset unsung color."""
        content = generate_ass_content(
            SAMPLE_LINES,
            theme_id="punk_diy",
            secondary_color="#ff0000",  # Red unsung override
        )
        # Red BGR: &H000000FF
        assert ",&H0015CCFA,&H000000FF," in content
        assert "&H00F5F5F5" not in content

    def test_custom_colors_in_style_config_override_preset_colors(self):
        """Custom primary_color and secondary_color in style_config override preset defaults."""
        content = generate_ass_content(
            SAMPLE_LINES,
            style_config={
                "theme_id": "punk_diy",
                "primary_color": "#00FF00",
                "secondary_color": "#FF00FF",
            },
        )
        assert ",&H0000FF00,&H00FF00FF," in content
        assert "&H0000FF00" in content
        assert "&H00FF00FF" in content
        assert "&H0015CCFA" not in content
        assert "&H00F5F5F5" not in content

    def test_custom_font_name_in_style_config_overrides_preset_font(self):
        """Explicit font_name in style_config takes precedence over preset default font."""
        content = generate_ass_content(
            SAMPLE_LINES,
            theme_id="punk_diy",
            style_config={"font_name": "Comic Sans MS"},
        )
        assert "Style: KaraokeLine1,Comic Sans MS," in content
        assert "Style: KaraokeLine1,Impact," not in content

    def test_aspect_ratio_9_16_with_new_theme(self):
        """Vertical 9:16 layout adapts resolution and font sizes while preserving theme styling."""
        content = generate_ass_content(SAMPLE_LINES, aspect_ratio="9:16", theme_id="punk_diy")
        assert "PlayResX: 1080" in content
        assert "PlayResY: 1920" in content
        # Vertical base font size is 46
        assert "Style: KaraokeLine1,Impact,46,&H0015CCFA,&H00F5F5F5," in content

    def test_video_renderer_delegation_with_new_themes(self, tmp_path):
        """VideoRenderer delegates ASS subtitle creation with new theme IDs."""
        renderer = VideoRenderer(output_dir=tmp_path)
        out_file = tmp_path / "test_punk.ass"
        renderer.generate_ass_subtitles(SAMPLE_LINES, out_file, theme_id="punk_diy")

        assert out_file.is_file()
        content = out_file.read_text(encoding="utf-8")
        assert "&H0015CCFA" in content
        assert "Impact" in content


class TestExportsApiThemeParity:
    """Verifies FastAPI GET /api/project/{id}/export/ass endpoint behavior with themes."""

    @pytest.mark.parametrize("theme_id", ALL_THEMES)
    def test_export_ass_endpoint_accepts_all_8_themes(self, client, test_project, theme_id):
        """Endpoint accepts all 8 themes without HTTP 400/422 validation errors."""
        res = client.get(f"/api/project/{test_project['id']}/export/ass?theme_id={theme_id}")
        assert res.status_code == 200, (
            f"Theme '{theme_id}' rejected with status {res.status_code}: {res.text}"
        )
        assert res.headers["content-type"].startswith("text/x-ssa")

        expected_primary = VISUAL_THEMES[theme_id]["primary_color"]
        assert expected_primary in res.text

    def test_export_ass_endpoint_rejects_unknown_theme_400(self, client, test_project):
        """Unrecognized theme_id returns HTTP 400 listing valid options."""
        res = client.get(f"/api/project/{test_project['id']}/export/ass?theme_id=hologram_matrix")
        assert res.status_code == 400
        detail = res.json()["detail"].lower()
        assert "invalid theme_id" in detail
        # Ensure error message lists new allowed themes
        assert "punk_diy" in detail
        assert "tape_70s" in detail

    def test_export_ass_endpoint_theme_with_custom_color_overrides(self, client, test_project):
        """Endpoint respects custom color overrides combined with new stage preset."""
        res = client.get(
            f"/api/project/{test_project['id']}/export/ass",
            params={
                "theme_id": "punk_diy",
                "primary_color": "#00ff00",
                "secondary_color": "#ff00ff",
            },
        )
        assert res.status_code == 200
        body = res.text
        # Converted BGR: #00ff00 -> &H0000FF00, #ff00ff -> &H00FF00FF
        assert "&H0000FF00" in body
        assert "&H00FF00FF" in body
        # Impact font should still be present from punk_diy
        assert "Impact" in body


class TestAfterglowFlagshipPreset:
    """Verifies the Afterglow flagship preset shipped with the frontend default theme."""

    def test_afterglow_preset_colors_and_font(self):
        theme = VISUAL_THEMES["afterglow"]
        assert theme["primary_color"] == "&H0024BFFB"
        assert theme["secondary_color"] == "&H00FFEBED"
        assert theme["font_name"] == "Sora"

    def test_afterglow_preset_duet_colors_apply_without_overrides(self):
        content = generate_ass_content(lines=SAMPLE_LINES, theme_id="afterglow")
        assert "KaraokeLine1_Singer2,Sora" in content
        assert "&H00B672F4" in content
        assert "&H00D4EA5E" in content

    def test_explicit_duet_colors_override_preset(self):
        content = generate_ass_content(
            lines=SAMPLE_LINES,
            theme_id="afterglow",
            singer2_color="#00ff00",
            both_color="#0000ff",
        )
        assert "&H0000FF00" in content
        assert "&H00FF0000" in content
        assert "&H00B672F4" not in content

    def test_presets_without_duet_palette_keep_export_defaults(self):
        content = generate_ass_content(lines=SAMPLE_LINES, theme_id="punk_diy")
        assert "&H00B300FF" in content
        assert "&H0050FA7B" in content
