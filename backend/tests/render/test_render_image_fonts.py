"""A cloud render draws the same lyrics as a local one: the Modal render image installs the
system fonts the app image does, Noto CJK above all, without which Japanese, Chinese or
Korean lyrics come out as empty boxes."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def font_packages(text: str) -> set[str]:
    return set(re.findall(r"\bfonts-[a-z0-9-]+", text))


def test_the_cloud_render_image_installs_the_app_images_fonts():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    modal_app = (ROOT / "gpu" / "modal_app.py").read_text(encoding="utf-8")
    render_image = modal_app[modal_app.index("render_image =") :].split("\n\n", 1)[0]
    assert "fonts-noto-cjk" in font_packages(dockerfile)
    assert font_packages(dockerfile) <= font_packages(render_image)
