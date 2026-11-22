"""The tool that draws sample frames of the looks through the real export path."""

import itertools

from PIL import Image

from backend.tests.helpers.libass_frames import needs_libass
from backend.tools import look_frames


@needs_libass
def test_the_tool_writes_a_still_per_moment_and_a_sheet_per_format(tmp_path):
    written = look_frames.render_looks(tmp_path, ["cinema"])
    names = {path.name for path in written}
    for aspect in ("16x9", "9x16"):
        assert f"cinema_{aspect}.ass" in names and f"sheet_cinema_{aspect}.png" in names
        for moment, _at in look_frames.MOMENTS:
            assert f"cinema_{aspect}_{moment}.png" in names
    with Image.open(tmp_path / "cinema_16x9_first-line.png") as still:
        assert still.size == (1920, 1080)
        # Cinema's bars are black, its picture is the cover art
        assert still.convert("RGB").getpixel((960, 20)) == (0, 0, 0)
        assert max(still.convert("RGB").getpixel((960, 500))) > 60
    with Image.open(tmp_path / "cinema_9x16_first-line.png") as still:
        assert still.size == (1080, 1920)


def test_the_demo_song_has_what_a_look_must_cope_with():
    lines = look_frames.demo_lines()
    assert {line["singer"] for line in lines} == {"singer1", "singer2", "both"}
    assert any(line.get("romaji") for line in lines)
    assert any("(" in line["text"] for line in lines)
    assert max(len(line["text"]) for line in lines) > 60
    gaps = [b["start_time"] - a["end_time"] for a, b in itertools.pairwise(lines)]
    assert max(gaps) >= 10
    assert all(at < look_frames.SONG_SECONDS for _name, at in look_frames.MOMENTS)
