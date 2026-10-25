"""1080p60 MP4 karaoke video rendering engine orchestrating FFmpeg filters, background scaling, and progressive subtitle burn-in."""

import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Any

from backend.config import OUTPUT_DIR
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
        """
        import time

        width, height = (1080, 1920) if aspect_ratio == "9:16" else (1920, 1080)

        # If duration was not provided, probe audio file
        if not duration or duration <= 0:
            try:
                import soundfile as sf

                info = sf.info(audio_path)
                duration = float(info.duration)
            except Exception:
                duration = 200.0  # safe fallback if probe fails

        # Escape ASS path for FFmpeg subtitles filter
        escaped_ass = (
            str(ass_subtitles_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
        )

        # Determine background input
        if custom_bg_path and os.path.exists(custom_bg_path):
            bg_input = ["-stream_loop", "-1", "-i", custom_bg_path]
            filter_bg = f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}[bg];"
        elif thumbnail_path and os.path.exists(thumbnail_path):
            # Dynamic blurred album art background with subtle dark overlay
            bg_input = ["-loop", "1", "-i", thumbnail_path]
            filter_bg = (
                f"[0:v]scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                f"boxblur=45:5,eq=brightness=-0.25:contrast=1.1[bg];"
            )
        else:
            # Generate ambient dynamic gradient
            bg_input = ["-f", "lavfi", "-i", f"color=c=0x0f111a:s={width}x{height}"]
            filter_bg = "[0:v]null[bg];"

        # Combined filter: background + optional audio visualizer + ASS subtitles
        if include_visualizer:
            vis_h = 240
            filter_complex = (
                f"{filter_bg}"
                f"[1:a]showfreqs=s={width}x{vis_h}:mode=bar:fscale=log:colors=cyan|magenta[vis];"
                f"[bg][vis]overlay=0:H-{vis_h}:format=auto[bgvis];"
                f"[bgvis]subtitles='{escaped_ass}'[v]"
            )
        else:
            filter_complex = f"{filter_bg}[bg]subtitles='{escaped_ass}'[v]"

        cmd = [
            "ffmpeg",
            "-y",
            "-loglevel",
            "warning",
            "-progress",
            "pipe:1",
            "-nostats",
            *bg_input,
            "-i",
            audio_path,
            "-filter_complex",
            filter_complex,
            "-map",
            "[v]",
            "-map",
            "1:a",
            "-c:v",
            "libx264",
            "-preset",
            os.environ.get(
                "FFMPEG_PRESET",
                "ultrafast" if "PYTEST_CURRENT_TEST" in os.environ else "fast",
            ),
            "-crf",
            "18",
            "-r",
            "60",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "320k",
            "-shortest",
            *(["-t", str(duration)] if duration and duration > 0 else []),
            str(output_mp4_path),
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

        current_frame = 0
        current_fps = 0.0
        current_speed = 1.0
        out_time_sec = 0.0
        last_callback_time = 0.0

        try:
            for line in process.stdout:
                if cancel_event and cancel_event.is_set():
                    logger.warning("Video rendering cancelled by user.")
                    raise RuntimeError("Video rendering was cancelled by user")

                line = line.strip()
                if not line or "=" not in line:
                    continue

                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip()

                if key == "frame":
                    try:
                        current_frame = int(val)
                    except ValueError:
                        pass
                elif key == "fps":
                    try:
                        current_fps = float(val)
                    except ValueError:
                        pass
                elif key == "speed":
                    try:
                        speed_cleaned = val.replace("x", "").strip()
                        current_speed = float(speed_cleaned)
                    except ValueError:
                        pass
                elif key in ("out_time_us", "out_time_ms"):
                    try:
                        # In FFmpeg -progress output, both out_time_us and out_time_ms are in microseconds
                        out_time_sec = float(val) / 1_000_000
                    except ValueError:
                        pass
                elif key == "progress" and val in ("continue", "end"):
                    now = time.time()
                    if now - last_callback_time >= 0.25 or val == "end":
                        last_callback_time = now
                        eff_time = out_time_sec if out_time_sec > 0 else (current_frame / 60.0)
                        pct = (
                            100.0
                            if val == "end"
                            else min(99.0, max(0.0, (eff_time / duration) * 100.0))
                        )
                        eta_sec = None
                        if val != "end" and current_speed > 0.05 and duration > eff_time:
                            eta_sec = max(0, int((duration - eff_time) / current_speed))

                        detail = f"Encoding 1080p60: frame {current_frame} ({current_fps:.0f} fps, {current_speed:.1f}x speed)"
                        if progress_callback:
                            progress_callback(pct, detail, eta_sec)

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

        return str(output_mp4_path)


__all__ = [
    "DEFAULT_THEME_ID",
    "VISUAL_THEMES",
    "VideoRenderer",
    "escape_ass_text",
    "format_ass_time",
    "generate_ass_content",
    "generate_ass_subtitles",
    "safe_time",
]
