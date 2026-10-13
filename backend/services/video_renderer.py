import logging
import os
import subprocess
import threading
from pathlib import Path
from typing import Any

from backend.config import DEFAULT_VIDEO_CONFIG, OUTPUT_DIR

logger = logging.getLogger(__name__)


class VideoRenderer:
    def __init__(self, output_dir: Path = OUTPUT_DIR):
        self.output_dir = output_dir
        self.output_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _format_ass_time(seconds: float) -> str:
        """Converts float seconds to ASS timestamp format: H:MM:SS.cs"""
        hrs = int(seconds // 3600)
        mins = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        csec = round((seconds - int(seconds)) * 100)
        if csec >= 100:
            csec = 99
        return f"{hrs}:{mins:02d}:{secs:02d}.{csec:02d}"

    @staticmethod
    def _escape_ass_text(text: str) -> str:
        r"""
        Escapes ASS control characters ({, }, \) in lyric text
        to prevent corrupting ASS override blocks or injecting unintended formatting.
        """
        if not text:
            return ""
        text = str(text)
        # Escape backslashes first, then curly braces
        text = text.replace("\\", "\\\\")
        text = text.replace("{", "\\{")
        text = text.replace("}", "\\}")
        text = text.replace("\r\n", " ").replace("\n", " ").replace("\r", " ")
        return text

    def generate_ass_subtitles(
        self,
        lines: list[dict[str, Any]],
        output_ass_path: Path,
        style_config: dict[str, Any] | None = None,
        aspect_ratio: str = "16:9",
    ) -> str:
        """
        Generates Advanced SubStation Alpha (.ass) subtitle file
        with smooth progressive karaoke sweep tags (\\kf).
        Supports dynamic 16:9 and 9:16 layout adjustments and control character escaping.
        """
        # Determine aspect ratio and layout mode
        ar = (style_config or {}).get("aspect_ratio") or aspect_ratio
        is_vertical = ar == "9:16"
        if not is_vertical and style_config:
            w = style_config.get("width")
            h = style_config.get("height")
            if w is not None and h is not None and h > w:
                is_vertical = True

        default_width, default_height = (1080, 1920) if is_vertical else (1920, 1080)
        default_font_size = 46 if is_vertical else 52
        margin_v_line1 = (style_config or {}).get("margin_v_line1", 640 if is_vertical else 200)
        margin_v_line2 = (style_config or {}).get("margin_v_line2", 500 if is_vertical else 110)
        margin_v_countdown = (style_config or {}).get(
            "margin_v_countdown", 780 if is_vertical else 290
        )
        margin_lr = (style_config or {}).get("margin_lr", 60 if is_vertical else 80)
        margin_v_title = 300 if is_vertical else 180

        cfg = {**DEFAULT_VIDEO_CONFIG, **(style_config or {})}
        if is_vertical:
            if not style_config or "width" not in style_config:
                cfg["width"] = default_width
            if not style_config or "height" not in style_config:
                cfg["height"] = default_height
            if not style_config or "font_size" not in style_config:
                cfg["font_size"] = default_font_size

        font_name = cfg.get("font_name", "DejaVu Sans")
        font_size = cfg.get("font_size", default_font_size)
        primary_color = cfg.get("primary_color", "&H0022E5FF")  # Sung color (cyan/gold)
        secondary_color = cfg.get("secondary_color", "&H00FFFFFF")  # Unsung text (white)
        outline_color = cfg.get("outline_color", "&H00111111")
        shadow_color = cfg.get("shadow_color", "&H80000000")
        outline_width = cfg.get("outline_width", 3)
        shadow_width = cfg.get("shadow_width", 2)
        _lead_dots = cfg.get("lead_in_countdown_dots", 3)

        ass_content = [
            "[Script Info]",
            "Title: YouTube Karaoke Generator",
            "ScriptType: v4.00+",
            "WrapStyle: 0",
            "ScaledBorderAndShadow: yes",
            "YCbCr Matrix: TV.709",
            f"PlayResX: {cfg['width']}",
            f"PlayResY: {cfg['height']}",
            "",
            "[V4+ Styles]",
            "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
            # Alignment 2 = Bottom Center, 5 = Top Center
            f"Style: KaraokeLine1,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line1},1",
            f"Style: KaraokeLine2,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_line2},1",
            f"Style: Countdown,{font_name},{font_size + 10},{primary_color},{secondary_color},{outline_color},{shadow_color},-1,0,0,0,100,100,2,0,1,{outline_width},{shadow_width},2,{margin_lr},{margin_lr},{margin_v_countdown},1",
            f"Style: TitleCard,{font_name},64,&H00FFFFFF,&H00FFFFFF,{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,3,3,5,{margin_lr},{margin_lr},{margin_v_title},1",
            "",
            "[Events]",
            "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ]

        prev_end_time = 0.0

        for i, line in enumerate(lines):
            l_start = float(line.get("start_time", 0.0))
            l_end = float(line.get("end_time", l_start + 4.0))
            words = line.get("words", [])

            # Alternate between Line1 and Line2 styles for natural dual-line reading
            style_name = "KaraokeLine1" if (i % 2 == 0) else "KaraokeLine2"

            # Show line early on screen so the singer can prepare
            if i == 0:
                display_start = max(0.0, l_start - 2.5)
            elif l_start > prev_end_time:
                display_start = max(prev_end_time, l_start - 2.0)
            else:
                display_start = max(0.0, l_start - 2.0)

            display_start = max(0.0, min(l_start, display_start))
            display_end = max(display_start + 0.5, l_end + 1.2)

            # Visual countdown cue if there's a significant break (> 3 seconds)
            gap = l_start - prev_end_time
            if (i == 0 and l_start >= 3.0) or (i > 0 and gap >= 3.5):
                countdown_start = max(0.0, l_start - 3.0)
                dots_text = "{\\kf100}● {\\kf100}● {\\kf100}● "
                ass_content.append(
                    f"Dialogue: 1,{self._format_ass_time(countdown_start)},{self._format_ass_time(l_start)},Countdown,,0,0,0,,{dots_text}"
                )

            # Build line text with \\kf (progressive fill) tags
            karaoke_text_parts = []

            # Initial lead-in delay tag if display starts before line starts
            lead_in_cs = max(0, round((l_start - display_start) * 100))
            if lead_in_cs > 0:
                karaoke_text_parts.append(f"{{\\k{lead_in_cs}}}")

            if words:
                cur_word_time = l_start
                for w in words:
                    w_start = float(w.get("start_time", cur_word_time))
                    w_end = float(w.get("end_time", w_start + 0.4))
                    dur_cs = max(1, round((w_end - w_start) * 100))
                    raw_word = str(w.get("word", ""))
                    word_text = self._escape_ass_text(raw_word)

                    # Use \\kf for smooth progressive sweep
                    karaoke_text_parts.append(f"{{\\kf{dur_cs}}}{word_text} ")
                    cur_word_time = w_end
            elif line.get("text"):
                line_dur_cs = max(1, round((l_end - l_start) * 100))
                escaped_text = self._escape_ass_text(str(line.get("text", "")))
                karaoke_text_parts.append(f"{{\\kf{line_dur_cs}}}{escaped_text}")

            full_line_text = "".join(karaoke_text_parts).strip()

            ass_content.append(
                f"Dialogue: 0,{self._format_ass_time(display_start)},{self._format_ass_time(display_end)},{style_name},,0,0,0,,{full_line_text}"
            )

            prev_end_time = max(prev_end_time, l_end)

        output_ass_path.write_text("\n".join(ass_content), encoding="utf-8")
        return str(output_ass_path)

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
    ) -> str:
        """
        Synthesizes final karaoke video using FFmpeg and libass.
        Streams FFmpeg output with -progress pipe:1 to calculate real-time percentage and ETA.
        Supports cancellation via cancel_event.
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

        # Combined filter: background + ASS subtitles
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
            "fast",
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
