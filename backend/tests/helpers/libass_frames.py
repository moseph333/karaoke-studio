"""Draws one frame of a subtitle file with FFmpeg's libass, for tests that check what is
really drawn. Tests that use it skip when FFmpeg has no subtitles filter."""

import shutil
import subprocess
from functools import cache
from pathlib import Path

import pytest
from PIL import Image

from backend.services.video_renderer import FONTS_DIR, _escape_filter_path


@cache
def libass_available() -> bool:
    if not shutil.which("ffmpeg"):
        return False
    listing = subprocess.run(
        ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, check=False
    )
    return " subtitles " in listing.stdout


needs_libass = pytest.mark.skipif(not libass_available(), reason="FFmpeg with libass is needed")


def draw_frame(
    script: Path,
    at: float,
    size: tuple[int, int] = (1920, 1080),
    ground: str = "black",
    verbose: bool = False,
) -> tuple[Image.Image, str]:
    """The frame at ``at`` seconds over a plain ground, and FFmpeg's log (with ``verbose``,
    libass's font choices are in it)."""
    width, height = size
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "verbose" if verbose else "error"]
    cmd += ["-f", "lavfi", "-i", f"color=c={ground}:s={width}x{height}:r=25"]
    subtitles = (
        f"subtitles='{_escape_filter_path(script)}':fontsdir='{_escape_filter_path(FONTS_DIR)}'"
    )
    cmd += ["-vf", f"setpts=PTS+{at}/TB,{subtitles}", "-frames:v", "1"]
    cmd += ["-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    done = subprocess.run(cmd, capture_output=True, check=True)
    return Image.frombytes("RGB", (width, height), done.stdout), done.stderr.decode(
        errors="replace"
    )


def ink_box(image: Image.Image, color: tuple[int, int, int], tolerance: int = 40) -> tuple | None:
    """The bounding box of the pixels within ``tolerance`` of ``color``, or None."""
    red, green, blue = image.split()
    mask = None
    for channel, value in zip((red, green, blue), color, strict=True):
        near = channel.point(lambda v, value=value: 255 if abs(v - value) <= tolerance else 0)
        mask = near if mask is None else Image.composite(near, Image.new("L", image.size, 0), mask)
    return mask.getbbox() if mask else None
