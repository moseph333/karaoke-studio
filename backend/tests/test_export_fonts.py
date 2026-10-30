"""Exported videos draw each stage look's lyrics in the font the stage shows: every look's
font has a file and a licence in backend/assets (except Impact and Georgia, which are not
free to redistribute), and libass picks that file when FFmpeg renders the subtitles."""

import shutil
import subprocess

import pytest

from backend.config import DEFAULT_VIDEO_CONFIG
from backend.services.ass_generator import VISUAL_THEMES, generate_ass_content
from backend.services.video_renderer import FONTS_DIR, _escape_filter_path

NOT_REDISTRIBUTABLE = {"Impact", "Georgia"}
LINE = [{"text": "Hello", "start_time": 0.0, "end_time": 0.4}]


def test_every_look_font_is_bundled_with_its_licence():
    families = {
        theme.get("font_name", DEFAULT_VIDEO_CONFIG["font_name"])
        for theme in VISUAL_THEMES.values()
    }
    assert {"Montserrat", "Sora", "Space Grotesk", "VT323"} <= families

    for family in families - NOT_REDISTRIBUTABLE:
        stem = family.replace(" ", "")
        assert sorted(FONTS_DIR.glob(f"{stem}-*.ttf")), f"no font file for {family}"
        assert (FONTS_DIR.parent / "licenses" / f"{stem}-OFL.txt").is_file(), family


def test_monolith_press_exports_in_space_grotesk():
    content = generate_ass_content(LINE, theme_id="clean_paper")
    assert "Style: KaraokeLine1,Space Grotesk," in content


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")
@pytest.mark.parametrize(
    "theme_id, face",
    [
        ("clean_paper", "SpaceGrotesk-Bold"),
        ("modern_gold", "Montserrat-Bold"),
        ("crt_ktv", "VT323-Regular"),
        ("afterglow", "Sora-Bold"),
    ],
)
def test_libass_draws_each_look_with_its_bundled_file(tmp_path, theme_id, face):
    subtitles = tmp_path / "look.ass"
    subtitles.write_text(generate_ass_content(LINE, theme_id=theme_id), encoding="utf-8")
    vf = f"subtitles='{_escape_filter_path(subtitles)}':fontsdir='{_escape_filter_path(FONTS_DIR)}'"

    black = "color=c=black:s=320x180:d=0.5"
    command = ["ffmpeg", "-hide_banner", "-loglevel", "verbose", "-f", "lavfi", "-i", black]
    result = subprocess.run(
        [*command, "-vf", vf, "-f", "null", "-"], capture_output=True, text=True, timeout=60
    )

    picks = [
        line.split("fontselect:", 1)[1]
        for line in result.stderr.splitlines()
        if "fontselect:" in line
    ]
    if not picks:
        pytest.skip("this FFmpeg has no subtitles filter, or its libass logs no font selection")
    assert any(f"-> {face}," in pick for pick in picks), picks
