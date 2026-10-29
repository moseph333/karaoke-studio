"""1080p60 MP4 karaoke video rendering engine orchestrating FFmpeg filters, background scaling, and progressive subtitle burn-in.

Every background feeds the filter graph at a genuine RENDER_FPS, so the lyric sweep is drawn for
each output frame. Still images (a custom image, or the song's blurred thumbnail) are processed
once before the render instead of on every frame. The generated styles (drifting art, aurora,
spectrum) are built in stage_backgrounds. With RENDER_REMOTE set, FFmpeg runs on a cloud CPU
(remote_render) and a failed or unavailable cloud render falls back to a local one.
"""

import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend.config import OUTPUT_DIR
from backend.services import remote_render, stage_backgrounds
from backend.services.ass_generator import (
    DEFAULT_THEME_ID,
    VISUAL_THEMES,
    escape_ass_text,
    format_ass_time,
    generate_ass_content,
    generate_ass_subtitles,
    safe_time,
)

logger = logging.getLogger(__name__)


DEFAULT_BACKGROUND_COLOR = "0x0f111a"
# Theme fonts shipped with the app (e.g. Sora for Afterglow) so renders match the stage
FONTS_DIR = Path(__file__).resolve().parents[1] / "assets" / "fonts"


def _escape_filter_path(path: str | Path) -> str:
    """A path quoted for an FFmpeg filter option value."""
    return str(path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")


def ffmpeg_color(value: Any, default: str = DEFAULT_BACKGROUND_COLOR) -> str:
    """Converts a CSS hex color (#RRGGBB or RRGGBB) to FFmpeg's 0xRRGGBB form.

    Anything else falls back to ``default`` so user input never reaches the filter graph.
    """
    if not isinstance(value, str):
        return default
    hex_part = value.strip().lstrip("#")
    if re.fullmatch(r"[0-9a-fA-F]{6}", hex_part):
        return f"0x{hex_part.lower()}"
    return default


RENDER_FPS = 60
VIDEO_BACKGROUND_EXTS = frozenset({".mp4", ".webm"})
# The song's thumbnail as a background: blurred and darkened so the lyrics stand out
THUMBNAIL_LOOK = "boxblur=45:5,eq=brightness=-0.25:contrast=1.1"


def encoder_preset() -> str:
    """libx264 preset: FFMPEG_PRESET, else veryfast (ultrafast under pytest)."""
    return os.environ.get(
        "FFMPEG_PRESET", "ultrafast" if "PYTEST_CURRENT_TEST" in os.environ else "veryfast"
    )


@dataclass(frozen=True)
class RenderBackground:
    """The filter graph's first input (a still image looped at RENDER_FPS, a looping video, a
    still decoded once for the drift, or a generated colour) and the chain that turns it into [bg]."""

    kind: str  # image | video | drift | color | generated
    path: Path | None = None
    graph: str = "[0:v]null[bg];"
    color: str = DEFAULT_BACKGROUND_COLOR
    # Size of the colour source when it differs from the output (generated styles draw small)
    size: tuple[int, int] | None = None

    def input_args(self, path_arg: str | None, width: int, height: int) -> list[str]:
        if self.kind == "image":
            return ["-loop", "1", "-framerate", str(RENDER_FPS), "-i", str(path_arg)]
        if self.kind == "video":
            return ["-stream_loop", "-1", "-i", str(path_arg)]
        if self.kind == "drift":
            # One frame: the graph's loop filter repeats it instead of decoding it every frame
            return ["-framerate", str(RENDER_FPS), "-i", str(path_arg)]
        w, h = self.size or (width, height)
        return ["-f", "lavfi", "-i", f"color=c={self.color}:s={w}x{h}:r={RENDER_FPS}"]


@dataclass(frozen=True)
class RenderJob:
    background: RenderBackground
    audio_path: Path
    ass_path: Path
    output_path: Path
    width: int
    height: int
    duration: float
    include_visualizer: bool = False


def _fill(width: int, height: int) -> str:
    return f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"


def artwork_still(width: int, height: int, drift: bool = False) -> tuple[int, int, str]:
    """Size and chain that turn the song's thumbnail into its backdrop still: filled, blurred and
    darkened at the output size, or at the larger overscan size the drift pans across. The stage
    preview is served this same still (the backdrop route), so the two cannot look different."""
    if drift:
        width, height = stage_backgrounds.overscan_size(width, height)
    return width, height, f"{_fill(width, height)},{THUMBNAIL_LOOK}"


def render_still(source: Path, chain: str, target: Path) -> None:
    """Runs chain over one still image into target; raises RuntimeError when that fails."""
    cmd = ["ffmpeg", "-nostdin", "-y", "-loglevel", "error", "-i", str(source)]
    cmd += ["-vf", chain, "-frames:v", "1", str(target)]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if done.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        raise RuntimeError((done.stderr or "").strip()[-200:] or f"exit {done.returncode}")


def prepare_background(
    work_dir: Path,
    width: int,
    height: int,
    thumbnail_path: str | None,
    custom_bg_path: str | None,
    background_color: Any = None,
    background_style: Any = None,
    background_palette: Any = None,
    background_tone: Any = None,
) -> RenderBackground:
    """A custom video loops and is resampled to RENDER_FPS; a custom image is processed once into
    work_dir. Otherwise the style decides: aurora and spectrum are generated over the stage
    colour, the song's thumbnail (blurred and darkened, processed once) is still or drifting, and
    a song without one, or the plain style, gets the colour."""
    fill = _fill(width, height)
    if custom_bg_path and os.path.exists(custom_bg_path):
        source = Path(custom_bg_path)
        if source.suffix.lower() in VIDEO_BACKGROUND_EXTS:
            return RenderBackground("video", source, f"[0:v]{fill},fps={RENDER_FPS}[bg];")
        return _still_background(source, fill, work_dir)
    style = stage_backgrounds.normalize_style(background_style)
    color = ffmpeg_color(background_color)
    if style in stage_backgrounds.GENERATED_STYLES:
        return _generated_background(
            style, width, height, color, background_palette, background_tone
        )
    if style != "color" and thumbnail_path and os.path.exists(thumbnail_path):
        if style == "drift":
            return _drift_background(Path(thumbnail_path), width, height, work_dir)
        return _still_background(Path(thumbnail_path), f"{fill},{THUMBNAIL_LOOK}", work_dir)
    return RenderBackground("color", color=color)


def _generated_background(
    style: str, width: int, height: int, color: str, palette: Any, tone: Any
) -> RenderBackground:
    colours = stage_backgrounds.normalize_palette(palette)
    light = stage_backgrounds.is_light_tone(tone)
    if style == "aurora":
        graph = stage_backgrounds.aurora_graph(width, height, colours, light)
    else:
        graph = stage_backgrounds.spectrum_graph(width, height, color, colours, light, RENDER_FPS)
    size = stage_backgrounds.low_res_size(width, height)
    return RenderBackground("generated", graph=graph, color=color, size=size)


def _still_background(source: Path, chain: str, work_dir: Path) -> RenderBackground:
    """Runs chain over a still image once instead of on every frame; when that fails the
    image is processed per frame instead."""
    target = work_dir / "background.png"
    try:
        render_still(source, chain, target)
        return RenderBackground("image", target)
    except Exception as exc:  # only an optimisation: fall back to the per-frame chain
        reason = str(exc)
    logger.warning(f"Could not prepare the background once ({reason}); processing it per frame")
    return RenderBackground("image", source, f"[0:v]{chain}[bg];")


def _drift_background(source: Path, width: int, height: int, work_dir: Path) -> RenderBackground:
    """The thumbnail processed once at the overscan size, then panned each frame; when that step
    fails the thumbnail is processed per frame before the pan."""
    _, _, chain = artwork_still(width, height, drift=True)
    target = work_dir / "background.png"
    try:
        render_still(source, chain, target)
        graph = stage_backgrounds.drift_graph(width, height, RENDER_FPS)
        return RenderBackground("drift", target, graph)
    except Exception as exc:  # only an optimisation: fall back to the per-frame chain
        reason = str(exc)
    logger.warning(f"Could not prepare the drifting background ({reason}); processing it per frame")
    crop = stage_backgrounds.drift_crop(width, height)
    return RenderBackground("image", source, f"[0:v]{chain},{crop}[bg];")


def ffmpeg_args(
    job: RenderJob,
    bg_arg: str | None,
    audio_arg: str,
    ass_arg: str,
    fonts_dir: str | Path | None,
    output_arg: str,
) -> list[str]:
    """FFmpeg arguments (without the program name) for one render. The paths are local ones,
    or the names a cloud render uploads the files under."""
    subtitles = f"subtitles='{_escape_filter_path(ass_arg)}'"
    if fonts_dir:
        subtitles += f":fontsdir='{_escape_filter_path(fonts_dir)}'"
    bg = job.background
    if job.include_visualizer:
        vis_h = 240
        graph = (
            f"{bg.graph}"
            f"[1:a]showfreqs=s={job.width}x{vis_h}:mode=bar:fscale=log:colors=cyan|magenta[vis];"
            f"[bg][vis]overlay=0:H-{vis_h}:format=auto[bgvis];"
            f"[bgvis]{subtitles}[v]"
        )
    else:
        graph = f"{bg.graph}[bg]{subtitles}[v]"
    return [
        "-y",
        "-loglevel",
        "warning",
        "-progress",
        "pipe:1",
        "-nostats",
        *bg.input_args(bg_arg, job.width, job.height),
        "-i",
        audio_arg,
        "-filter_complex",
        graph,
        "-map",
        "[v]",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-preset",
        encoder_preset(),
        "-crf",
        "18",
        "-r",
        str(RENDER_FPS),
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "320k",
        "-shortest",
        *(["-t", str(job.duration)] if job.duration and job.duration > 0 else []),
        output_arg,
    ]


class RenderProgress:
    """Turns FFmpeg -progress key=value lines into throttled (percent, detail, eta) updates."""

    def __init__(self, duration: float, callback: Any | None, where: str = ""):
        self.duration = duration
        self.callback = callback
        self.where = where
        self.frame = 0
        self.fps = 0.0
        self.speed = 1.0
        self.out_time = 0.0
        self.last_callback = 0.0

    def feed(self, line: str) -> None:
        line = line.strip()
        if not line or "=" not in line:
            return
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()

        if key == "frame":
            try:
                self.frame = int(val)
            except ValueError:
                pass
        elif key == "fps":
            try:
                self.fps = float(val)
            except ValueError:
                pass
        elif key == "speed":
            try:
                self.speed = float(val.replace("x", "").strip())
            except ValueError:
                pass
        elif key in ("out_time_us", "out_time_ms"):
            try:
                # In FFmpeg -progress output, both out_time_us and out_time_ms are in microseconds
                self.out_time = float(val) / 1_000_000
            except ValueError:
                pass
        elif key == "progress" and val in ("continue", "end"):
            now = time.time()
            if now - self.last_callback >= 0.25 or val == "end":
                self.last_callback = now
                eff_time = self.out_time if self.out_time > 0 else (self.frame / RENDER_FPS)
                pct = (
                    100.0
                    if val == "end"
                    else min(99.0, max(0.0, (eff_time / self.duration) * 100.0))
                )
                eta_sec = None
                if val != "end" and self.speed > 0.05 and self.duration > eff_time:
                    eta_sec = max(0, int((self.duration - eff_time) / self.speed))
                detail = (
                    f"Encoding 1080p60{self.where}: frame {self.frame} "
                    f"({self.fps:.0f} fps, {self.speed:.1f}x speed)"
                )
                if self.callback:
                    self.callback(pct, detail, eta_sec)


class VideoRenderer:
    _safe_time = staticmethod(safe_time)
    _format_ass_time = staticmethod(format_ass_time)
    _escape_ass_text = staticmethod(escape_ass_text)

    def __init__(self, output_dir: Path = OUTPUT_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def generate_ass_content(
        self,
        lines: list[dict[str, Any]],
        aspect_ratio: str = "16:9",
        theme_id: str | None = None,
        primary_color: str | None = None,
        secondary_color: str | None = None,
        title: str = "",
        style_config: dict[str, Any] | None = None,
        font_size_scale: float = 1.0,
        include_countdown: bool = True,
        chords: list[dict[str, Any]] | None = None,
        include_chords: bool = False,
        semitones: int = 0,
        key: str | None = None,
        sync_mode: str = "word",
    ) -> str:
        """Generates Advanced SubStation Alpha (.ass) subtitle file content

        with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
        """
        return generate_ass_content(
            lines=lines,
            aspect_ratio=aspect_ratio,
            theme_id=theme_id,
            primary_color=primary_color,
            secondary_color=secondary_color,
            title=title,
            style_config=style_config,
            font_size_scale=font_size_scale,
            include_countdown=include_countdown,
            chords=chords,
            include_chords=include_chords,
            semitones=semitones,
            key=key,
            sync_mode=sync_mode,
        )

    def generate_ass_subtitles(
        self,
        lines: list[dict[str, Any]],
        output_ass_path: Path,
        style_config: dict[str, Any] | None = None,
        aspect_ratio: str = "16:9",
        theme_id: str | None = None,
        primary_color: str | None = None,
        secondary_color: str | None = None,
        title: str = "",
        include_countdown: bool = True,
        chords: list[dict[str, Any]] | None = None,
        include_chords: bool = False,
        semitones: int = 0,
        key: str | None = None,
        sync_mode: str = "word",
    ) -> str:
        """Generates Advanced SubStation Alpha (.ass) subtitle file

        with smooth progressive karaoke sweep tags (\\kf) or instant line illumination.
        """
        return generate_ass_subtitles(
            lines=lines,
            output_ass_path=output_ass_path,
            style_config=style_config,
            aspect_ratio=aspect_ratio,
            theme_id=theme_id,
            primary_color=primary_color,
            secondary_color=secondary_color,
            title=title,
            include_countdown=include_countdown,
            chords=chords,
            include_chords=include_chords,
            semitones=semitones,
            key=key,
            sync_mode=sync_mode,
        )

    def render_video(
        self,
        audio_path: str,
        ass_subtitles_path: str,
        output_mp4_path: Path,
        thumbnail_path: str | None = None,
        custom_bg_path: str | None = None,
        title: str = "Karaoke Track",
        artist: str = "Artist",
        aspect_ratio: str = "16:9",
        duration: float | None = None,
        progress_callback: Any | None = None,
        cancel_event: Any | None = None,
        include_visualizer: bool = False,
        include_chords: bool = False,
        semitones: int = 0,
        **kwargs: Any,
    ) -> str:
        """Synthesizes final karaoke video using FFmpeg and libass.

        Streams FFmpeg output with -progress pipe:1 to calculate real-time percentage and ETA.
        Supports cancellation via cancel_event and optional beat-reactive audio visualizer.
        Renders on a cloud CPU when RENDER_REMOTE is set, falling back to a local render.
        """
        width, height = (1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)

        # If duration was not provided, probe audio file
        if not duration or duration <= 0:
            try:
                import soundfile as sf

                info = sf.info(audio_path)
                duration = float(info.duration)
            except Exception:
                duration = 200.0  # safe fallback if probe fails

        work_dir = Path(tempfile.mkdtemp(prefix="karaoke-render-"))
        try:
            job = RenderJob(
                background=prepare_background(
                    work_dir,
                    width,
                    height,
                    thumbnail_path,
                    custom_bg_path,
                    kwargs.get("background_color"),
                    kwargs.get("background_style"),
                    kwargs.get("background_palette"),
                    kwargs.get("background_tone"),
                ),
                audio_path=Path(audio_path),
                ass_path=Path(ass_subtitles_path),
                output_path=Path(output_mp4_path),
                width=width,
                height=height,
                duration=duration,
                include_visualizer=include_visualizer,
            )
            if remote_render.enabled() and self._render_remote(
                job, progress_callback, cancel_event
            ):
                return str(output_mp4_path)
            self._render_local(job, progress_callback, cancel_event)
            return str(output_mp4_path)
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)

    def _render_remote(self, job: RenderJob, progress_callback, cancel_event) -> bool:
        """Renders on the cloud CPU; False means the caller should render locally instead."""
        files: dict[str, Path] = {}
        bg_arg = None
        if job.background.path is not None:
            bg_arg = f"background{job.background.path.suffix.lower() or '.png'}"
            files[bg_arg] = job.background.path
        audio_arg = f"audio{job.audio_path.suffix.lower() or '.wav'}"
        files[audio_arg] = job.audio_path
        files["subtitles.ass"] = job.ass_path
        args = ffmpeg_args(
            job,
            bg_arg,
            audio_arg,
            "subtitles.ass",
            remote_render.FONTS_DIR,
            remote_render.OUTPUT_NAME,
        )
        progress = RenderProgress(job.duration, progress_callback, where=" on a cloud CPU")

        def report(detail: str) -> None:
            if progress_callback:
                progress_callback(0.0, detail, None)

        report("Waiting for a cloud CPU…")
        try:
            remote_render.render(
                files,
                args,
                job.output_path,
                progress.feed,
                cancel_event,
                on_started=lambda: report("Rendering on a cloud CPU…"),
                on_waiting=lambda waited: report(f"Waiting for a cloud CPU… {waited:.0f} s"),
            )
            return True
        except remote_render.RenderCancelled as exc:
            raise RuntimeError("Video rendering was cancelled by user") from exc
        except (RuntimeError, OSError) as exc:
            if cancel_event is not None and cancel_event.is_set():
                raise RuntimeError("Video rendering was cancelled by user") from exc
            logger.warning(f"Cloud render failed, rendering here instead: {exc}")
            report("Cloud render unavailable, rendering here…")
            return False

    def _render_local(self, job: RenderJob, progress_callback, cancel_event) -> None:
        bg_arg = str(job.background.path) if job.background.path is not None else None
        cmd = [
            "ffmpeg",
            *ffmpeg_args(
                job,
                bg_arg,
                str(job.audio_path),
                str(job.ass_path),
                FONTS_DIR if FONTS_DIR.is_dir() else None,
                str(job.output_path),
            ),
        ]

        logger.info(f"Rendering video with FFmpeg: {' '.join(cmd)}")
        process = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1
        )

        stderr_lines: list[str] = []

        def _drain_stderr():
            if process.stderr:
                try:
                    for err_line in process.stderr:
                        stderr_lines.append(err_line)
                except Exception:
                    pass

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()
        progress = RenderProgress(job.duration, progress_callback)

        try:
            for line in process.stdout:
                if cancel_event and cancel_event.is_set():
                    logger.warning("Video rendering cancelled by user.")
                    raise RuntimeError("Video rendering was cancelled by user")
                progress.feed(line)

            process.wait()

        except Exception as e:
            if process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=2)
                except (subprocess.TimeoutExpired, Exception):
                    try:
                        process.kill()
                        process.wait(timeout=1)
                    except Exception:
                        pass
            raise e

        finally:
            if process.poll() is None:
                try:
                    process.terminate()
                    process.wait(timeout=2)
                except (subprocess.TimeoutExpired, Exception):
                    try:
                        process.kill()
                        process.wait(timeout=1)
                    except Exception:
                        pass
            if hasattr(process, "stdout") and process.stdout and hasattr(process.stdout, "close"):
                try:
                    process.stdout.close()
                except Exception:
                    pass
            if hasattr(process, "stderr") and process.stderr and hasattr(process.stderr, "close"):
                try:
                    process.stderr.close()
                except Exception:
                    pass
            stderr_thread.join(timeout=1.0)

        if process.returncode != 0:
            stderr_out = "".join(stderr_lines).strip()
            logger.error(f"Video rendering failed: {stderr_out}")
            raise RuntimeError(f"FFmpeg video render error: {stderr_out}")


__all__ = [
    "DEFAULT_THEME_ID",
    "RENDER_FPS",
    "VISUAL_THEMES",
    "RenderBackground",
    "RenderJob",
    "RenderProgress",
    "VideoRenderer",
    "artwork_still",
    "encoder_preset",
    "escape_ass_text",
    "ffmpeg_args",
    "format_ass_time",
    "generate_ass_content",
    "generate_ass_subtitles",
    "prepare_background",
    "render_still",
    "safe_time",
]
