"""Generated stage backgrounds for exports: drifting cover art, aurora orbs and an audio spectrum.

Each style is an FFmpeg filter graph that ends in [bg]. Motion is a pure function of the song time
t, using the numbers in BACKGROUND_MOTION, which mirrors frontend/src/theme/backgroundMotion.json
(a test keeps them equal). The live stage computes the same functions, so a paused or scrubbed
preview shows the frame the export renders at that moment. Aurora and spectrum are drawn at a
quarter of the output size and upscaled, which keeps them cheap; both need no input files, so a
cloud render ships nothing extra for them.
"""

import re
from typing import Any

BACKGROUND_STYLES = ("artwork", "drift", "aurora", "spectrum", "color")
DEFAULT_BACKGROUND_STYLE = "artwork"
# Styles drawn entirely by FFmpeg (no song art or uploaded file needed)
GENERATED_STYLES = frozenset({"aurora", "spectrum"})

BACKGROUND_MOTION: dict[str, Any] = {
    "drift": {"overscan": 1.12, "periodX": 37, "periodY": 23, "phaseY": 1.3},
    "aurora": {
        "scale": 4,
        "sigma": 0.0917,
        "extent": 3.4,
        "alpha": {"dark": 1, "light": 0.6},
        "orbs": [
            {
                "x": 0.5,
                "y": 0.34,
                "ax": 0.31,
                "ay": 0.24,
                "periodX": 31,
                "periodY": 19,
                "phaseX": 0,
                "phaseY": 1,
            },
            {
                "x": 0.5,
                "y": 0.4,
                "ax": 0.33,
                "ay": 0.28,
                "periodX": 23,
                "periodY": 29,
                "phaseX": 2,
                "phaseY": 1.5708,
            },
            {
                "x": 0.5,
                "y": 0.37,
                "ax": 0.29,
                "ay": 0.22,
                "periodX": 37,
                "periodY": 17,
                "phaseX": 2.0708,
                "phaseY": 2,
            },
        ],
    },
    # Readability gradient (top, middle, bottom alpha), the same as the stage preview's scrim
    "scrim": {"dark": [0.1, 0.3, 0.75], "light": [0.05, 0.25, 0.75]},
    "spectrum": {
        "minHz": 30,
        "maxHz": 12000,
        "height": 0.6,
        "gamma": 2,
        "attack": 0.08,
        "blur": 0.011,
    },
}

# Afterglow's sung and duet colours, used for any palette entry that is missing or not a colour
DEFAULT_PALETTE = ("#fbbf24", "#f472b6", "#5eead4")

_HEX = re.compile(r"[0-9a-fA-F]{6}")

RGB = tuple[int, int, int]


def _rgb(value: Any) -> RGB | None:
    """(r, g, b) for "#RRGGBB", "RRGGBB" or "0xRRGGBB"; None for anything else."""
    if not isinstance(value, str):
        return None
    hex_part = value.strip()
    hex_part = hex_part[2:] if hex_part[:2].lower() == "0x" else hex_part.lstrip("#")
    if not _HEX.fullmatch(hex_part):
        return None
    return int(hex_part[0:2], 16), int(hex_part[2:4], 16), int(hex_part[4:6], 16)


def normalize_style(value: Any) -> str:
    """A known background style, else the cover-art default (unknown input never reaches FFmpeg)."""
    return value if value in BACKGROUND_STYLES else DEFAULT_BACKGROUND_STYLE


def normalize_palette(value: Any) -> tuple[RGB, RGB, RGB]:
    """Three colours from a list of CSS hex strings; each missing or invalid entry falls back to
    the matching default, so user input never reaches the filter graph."""
    entries = list(value) if isinstance(value, (list, tuple)) else []
    colours = []
    for i, default in enumerate(DEFAULT_PALETTE):
        colour = _rgb(entries[i]) if i < len(entries) else None
        colours.append(colour or _rgb(default))
    return colours[0], colours[1], colours[2]


def is_light_tone(value: Any) -> bool:
    """Light presets (paper-white stages) get a white scrim and darkening spectrum bars."""
    return value == "light"


def overscan_size(width: int, height: int) -> tuple[int, int]:
    """The drifting art's still size: the output size times the overscan, rounded to even pixels
    (half up, as the stage preview rounds it)."""
    overscan = BACKGROUND_MOTION["drift"]["overscan"]
    return int(width * overscan / 2 + 0.5) * 2, int(height * overscan / 2 + 0.5) * 2


def low_res_size(width: int, height: int) -> tuple[int, int]:
    """The size aurora and spectrum are drawn at before the upscale (480x270 for 1080p)."""
    scale = BACKGROUND_MOTION["aurora"]["scale"]
    return width // scale // 2 * 2, height // scale // 2 * 2


def _num(value: float) -> str:
    return f"{value:g}"


def drift_crop(width: int, height: int) -> str:
    """Pans a width x height window across the overscan still along a slow Lissajous path."""
    drift = BACKGROUND_MOTION["drift"]
    x = f"(iw-ow)/2*(1+sin(2*PI*t/{_num(drift['periodX'])}))"
    y = f"(ih-oh)/2*(1+sin(2*PI*t/{_num(drift['periodY'])}+{_num(drift['phaseY'])}))"
    return f"crop={width}:{height}:x='{x}':y='{y}'"


def drift_graph(width: int, height: int, fps: int) -> str:
    """The prepared overscan still, decoded once and repeated at fps, panned by drift_crop."""
    return f"[0:v]loop=loop=-1:size=1,fps={fps},{drift_crop(width, height)}[bg];"


def _scrim(width: int, height: int, light: bool, label: str) -> str:
    """A one-frame RGBA gradient (repeated by overlay) that darkens, or for light presets
    whitens, the frame towards the bottom where the lyrics sit."""
    top, mid, bottom = BACKGROUND_MOTION["scrim"]["light" if light else "dark"]
    level = 255 if light else 0
    alpha = (
        f"255*({_num(top)}+{_num(mid - top)}*clip(Y/H/0.5,0,1)"
        f"+{_num(bottom - mid)}*clip((Y/H-0.5)/0.5,0,1))"
    )
    return (
        f"color=c=black:s={width}x{height}:r=1:d=1,format=rgba,"
        f"geq=r={level}:g={level}:b={level}:a='{alpha}'[{label}]"
    )


def aurora_graph(width: int, height: int, palette: tuple[RGB, RGB, RGB], light: bool) -> str:
    """Soft Gaussian orbs in the palette colours drifting over the base colour (input 0, a lavfi
    colour source at low_res_size), then the scrim, then the upscale to width x height.

    Each orb is a one-frame sprite that overlay keeps repeating, so its Gaussian is computed
    once. Overlay in RGB places orbs on whole low-res pixels (yuv420 would snap to even ones).
    """
    aurora = BACKGROUND_MOTION["aurora"]
    lw, lh = low_res_size(width, height)
    sigma = aurora["sigma"] * max(lw, lh)
    half = round(aurora["extent"] * sigma)
    peak = 255 * aurora["alpha"]["light" if light else "dark"]
    parts: list[str] = []
    for i in range(len(aurora["orbs"])):
        r, g, b = palette[i]
        parts.append(
            f"color=c=black:s={2 * half}x{2 * half}:r=1:d=1,format=rgba,"
            f"geq=r={r}:g={g}:b={b}:"
            f"a='{_num(peak)}*exp(-(pow(X-{half},2)+pow(Y-{half},2))/{_num(2 * sigma * sigma)})'"
            f"[orb{i}]"
        )
    parts.append(_scrim(lw, lh, light, "scrim"))
    chain = "[0:v]"
    for i, orb in enumerate(aurora["orbs"]):
        x = (
            f"W*({_num(orb['x'])}+{_num(orb['ax'])}"
            f"*sin(2*PI*t/{_num(orb['periodX'])}+{_num(orb['phaseX'])}))-w/2"
        )
        y = (
            f"H*({_num(orb['y'])}+{_num(orb['ay'])}"
            f"*sin(2*PI*t/{_num(orb['periodY'])}+{_num(orb['phaseY'])}))-h/2"
        )
        chain += f"[orb{i}]overlay=x='{x}':y='{y}':eval=frame:format=rgb[aurora{i}];[aurora{i}]"
    chain += "[scrim]overlay=eval=init:format=rgb,format=yuv420p,"
    chain += f"scale={width}:{height}:flags=bicubic[bg];"
    return ";".join(parts) + ";" + chain


def spectrum_graph(
    width: int,
    height: int,
    base_color: str,
    palette: tuple[RGB, RGB, RGB],
    light: bool,
    fps: int,
) -> str:
    """A constant-Q spectrum of the song (audio input 1) rising from the bottom: bar intensity
    blends the base colour (an FFmpeg 0xRRGGBB colour) towards a gradient from palette[0] (bass)
    to palette[1] (treble), brightening dark presets and darkening light ones. Then a glow blur,
    the scrim and the upscale. Input 0 (the base colour) supplies the one-frame gradient image.
    """
    base = _rgb(base_color) or (0, 0, 0)
    spectrum = BACKGROUND_MOTION["spectrum"]
    lw, lh = low_res_size(width, height)
    bars_h = int(lh * spectrum["height"] / 2 + 0.5) * 2
    blur = max(1, round(spectrum["blur"] * lh))

    # The gradient image holds |gradient(x) - base| per channel; lutrgb adds it to (or, for
    # light presets, subtracts it from) the base, scaled by bar intensity through the multiply.
    channels = {}
    lut = {}
    for name, b0, a0, c0 in zip("rgb", base, palette[0], palette[1], strict=True):
        gradient = f"({a0}+({c0 - a0})*X/W)"
        diff = f"{b0}-{gradient}" if light else f"{gradient}-{b0}"
        channels[name] = f"clip({diff},0,255)"
        lut[name] = f"{b0}-val" if light else f"{b0}+val"

    return (
        f"[1:a]showcqt=s={lw}x{bars_h}:r={fps}:axis=0:sono_h=0:bar_h={bars_h}"
        f":bar_g={_num(spectrum['gamma'])}:attack={_num(spectrum['attack'])}"
        f":basefreq={_num(spectrum['minHz'])}:endfreq={_num(spectrum['maxHz'])}"
        f":cscheme=1|1|1|1|1|1,format=rgb24,format=gbrp,pad={lw}:{lh}:0:{lh - bars_h}[bars];"
        f"[0:v]trim=end_frame=1,format=gbrp,"
        f"geq=r='{channels['r']}':g='{channels['g']}':b='{channels['b']}'[tint];"
        f"{_scrim(lw, lh, light, 'scrim')};"
        f"[bars][tint]blend=all_mode=multiply,"
        f"lutrgb=r='{lut['r']}':g='{lut['g']}':b='{lut['b']}',boxblur={blur}:1[spectrum];"
        f"[spectrum][scrim]overlay=eval=init:format=gbrp,format=yuv420p,"
        f"scale={width}:{height}:flags=bicubic[bg];"
    )
