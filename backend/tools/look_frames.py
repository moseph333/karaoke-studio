"""Renders sample frames and a short clip of every stage look, through the same code a real
export uses (the subtitle generator, the look's cover-art treatment and FFmpeg with libass).

    python -m backend.tools.look_frames --out /tmp/look-frames
    python -m backend.tools.look_frames --out /tmp/look-frames --looks marquee,ktv --clips

Each look gets one still per moment worth looking at (the title card, the count-in, a line
half sung, a duet change, a long line, a Japanese line with romaji, a break, the end card), in
16:9 and 9:16, plus a contact sheet per look and format. ``--clips`` adds the song's first
seconds as a video. The song is made up; ``--art`` uses your own cover image, and
``--background`` an image or a looping video (an upload, or a song loop) in place of the
cover art: every look then shows its treatment of an upload, and a video's first frame
stands in every still. Needs FFmpeg.
"""

import argparse
import subprocess
import tempfile
import wave
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFilter

from backend.services.ass_draw import LookStyle
from backend.services.ass_look import generate_look_ass
from backend.services.stage_looks import ASPECTS, LOOKS
from backend.services.video_renderer import (
    FONTS_DIR,
    VideoRenderer,
    _escape_filter_path,
    prepare_background,
)

SONG_TITLE = "Paper Lanterns"
SONG_ARTIST = "The Night Buses"
SONG_SECONDS = 76.0
PART_NAMES = {"singer1": "Mara", "singer2": "Theo"}
# The moments a still is taken at, in seconds
MOMENTS: tuple[tuple[str, float], ...] = (
    ("title", 3.0),
    ("count-in", 10.4),
    ("first-line", 13.4),
    ("duet", 21.2),
    ("long-line", 28.6),
    ("ad-lib", 33.4),
    ("romaji", 37.6),
    ("break", 47.0),
    ("after-break", 58.3),
    ("end", 72.0),
)
CLIP_SECONDS = 24.0


def _timed(text: str, start: float, end: float, singer: str = "singer1", **more: Any) -> dict:
    tokens = text.split()
    step = (end - start) / max(1, len(tokens))
    words = [
        {
            "word": token,
            "start_time": round(start + i * step, 2),
            "end_time": round(start + (i + 1) * step - 0.06, 2),
        }
        for i, token in enumerate(tokens)
    ]
    return {
        "text": text,
        "start_time": start,
        "end_time": end,
        "singer": singer,
        "words": words,
        **more,
    }


def _japanese(text: str, romaji: str, start: float, end: float) -> dict:
    step = (end - start) / len(text)
    words = [
        {
            "word": char,
            "start_time": round(start + i * step, 2),
            "end_time": round(start + (i + 1) * step - 0.03, 2),
        }
        for i, char in enumerate(text)
    ]
    return {
        "text": text,
        "romaji": romaji,
        "start_time": start,
        "end_time": end,
        "singer": "singer1",
        "words": words,
    }


def demo_lines() -> list[dict]:
    """A made-up song with what a look must cope with: a duet, a long line, an ad-lib, a
    Japanese line with romaji, a one-word line and a long break."""
    return [
        _timed("Paper lanterns on the water", 12.0, 15.4),
        _timed("Drifting where the river bends", 15.8, 19.2),
        _timed("Tell me where the night bus goes", 19.6, 23.2, "singer2"),
        _timed("Anywhere but home again", 23.6, 26.6, "singer2"),
        _timed(
            "We could ride it till the morning finds us sleeping at the end of the line",
            27.0,
            32.0,
            "both",
        ),
        _timed("Hold on (hold on) till the light", 32.4, 35.8),
        _japanese("夜のバスに乗って", "yoru no basu ni notte", 36.2, 39.6),
        _timed("Oh!", 40.0, 41.0),
        _timed("Paper lanterns in the rain", 56.0, 59.6),
        _timed("Carry me across again", 60.0, 63.6, "both"),
    ]


def demo_cover(path: Path) -> None:
    """A stand-in for cover art: lanterns over dark water."""
    size = 1000
    image = Image.new("RGB", (size, size), (18, 26, 52))
    draw = ImageDraw.Draw(image)
    for y in range(size):
        t = y / size
        draw.line(
            [(0, y), (size, y)],
            fill=(int(18 + 60 * t), int(26 + 30 * t), int(52 + 70 * (1 - t))),
        )
    lanterns = ((220, 300, 120), (540, 220, 150), (770, 420, 110), (380, 560, 90), (660, 700, 70))
    for x, y, r in lanterns:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=(255, 176, 64))
        draw.ellipse([x - r // 2, y - r // 2, x + r // 2, y + r // 2], fill=(255, 226, 150))
    image = image.filter(ImageFilter.GaussianBlur(6))
    draw = ImageDraw.Draw(image)
    for x, y, r in lanterns:
        draw.rectangle([x - r // 5, y + r - 4, x + r // 5, y + r + r // 3], fill=(40, 24, 20))
    image.save(path)


def silent_wav(path: Path, seconds: float) -> None:
    with wave.open(str(path), "wb") as out:
        out.setnchannels(2)
        out.setsampwidth(2)
        out.setframerate(22050)
        out.writeframes(b"\x00\x00\x00\x00" * int(22050 * seconds))


def look_script(look_id: str, aspect: str, lines: list[dict]) -> str:
    style = LookStyle.of(look_id, aspect, part_names=PART_NAMES)
    return generate_look_ass(
        lines, style, title=SONG_TITLE, artist=SONG_ARTIST, duration=SONG_SECONDS
    )


def render_still(
    look_id: str,
    aspect: str,
    script: Path,
    cover: Path,
    at: float,
    target: Path,
    work: Path,
    background_file: Path | None = None,
) -> None:
    """One frame at ``at`` seconds, drawn the way an export draws it (over
    ``background_file`` instead of the cover art when one is given)."""
    width, height = (1080, 1920) if aspect == "9:16" else (1920, 1080)
    look = LOOKS[look_id]
    upload = str(background_file) if background_file else None
    background = prepare_background(
        work, width, height, str(cover), upload, look["palette"]["ground"], None, look_id=look_id
    )
    path_arg = str(background.path) if background.path else None
    graph = (
        f"{background.graph}[bg]setpts=PTS+{at}/TB,"
        f"subtitles='{_escape_filter_path(script)}':fontsdir='{_escape_filter_path(FONTS_DIR)}'[v]"
    )
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error"]
    cmd += background.input_args(path_arg, width, height)
    cmd += ["-filter_complex", graph, "-map", "[v]", "-frames:v", "1", str(target)]
    subprocess.run(cmd, check=True)


def contact_sheet(stills: list[Path], target: Path, portrait: bool) -> None:
    tile = (270, 480) if portrait else (640, 360)
    columns = 5 if portrait else 3
    rows = (len(stills) + columns - 1) // columns
    gap = 10
    sheet = Image.new(
        "RGB",
        (columns * tile[0] + (columns + 1) * gap, rows * tile[1] + (rows + 1) * gap),
        (70, 70, 70),
    )
    for i, still in enumerate(stills):
        with Image.open(still) as frame:
            small = frame.convert("RGB").resize(tile, Image.Resampling.LANCZOS)
        sheet.paste(
            small, (gap + (i % columns) * (tile[0] + gap), gap + (i // columns) * (tile[1] + gap))
        )
    sheet.save(target)


def render_looks(
    out: Path,
    looks: list[str],
    clips: bool = False,
    art: Path | None = None,
    background: Path | None = None,
) -> list[Path]:
    """Writes the stills, sheets and (with ``clips``) videos into ``out``; returns the files."""
    out.mkdir(parents=True, exist_ok=True)
    lines = demo_lines()
    written: list[Path] = []
    with tempfile.TemporaryDirectory() as tmp:
        work = Path(tmp)
        cover = art or work / "cover.png"
        if not art:
            demo_cover(cover)
        audio = work / "silence.wav"
        if clips:
            silent_wav(audio, CLIP_SECONDS)
        for look_id in looks:
            for aspect in ASPECTS:
                tag = f"{look_id}_{aspect.replace(':', 'x')}"
                script = out / f"{tag}.ass"
                script.write_text(look_script(look_id, aspect, lines), encoding="utf-8")
                stills = []
                for name, at in MOMENTS:
                    still = out / f"{tag}_{name}.png"
                    render_still(look_id, aspect, script, cover, at, still, work, background)
                    stills.append(still)
                sheet = out / f"sheet_{tag}.png"
                contact_sheet(stills, sheet, portrait=aspect == "9:16")
                written += [script, *stills, sheet]
                if clips:
                    clip = out / f"{tag}.mp4"
                    VideoRenderer().render_video(
                        str(audio),
                        str(script),
                        clip,
                        thumbnail_path=str(cover),
                        custom_bg_path=str(background) if background else None,
                        aspect_ratio=aspect,
                        duration=CLIP_SECONDS,
                        background_color=LOOKS[look_id]["palette"]["ground"],
                        look_id=look_id,
                    )
                    written.append(clip)
    return written


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--out", type=Path, required=True, help="Folder to write into")
    parser.add_argument("--looks", default=",".join(LOOKS), help="Comma-separated look ids")
    parser.add_argument("--clips", action="store_true", help="Also render a short video per look")
    parser.add_argument("--art", type=Path, default=None, help="A cover image to use")
    parser.add_argument(
        "--background",
        type=Path,
        default=None,
        help="An image or looping video to draw instead of the cover art",
    )
    args = parser.parse_args()
    if args.background is not None and not args.background.is_file():
        parser.error(f"--background {args.background} is not a file")
    looks = [look for look in args.looks.split(",") if look in LOOKS]
    written = render_looks(
        args.out, looks, clips=args.clips, art=args.art, background=args.background
    )
    print(f"Wrote {len(written)} files to {args.out}")


if __name__ == "__main__":
    main()
