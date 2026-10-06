import os
import subprocess
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from backend.config import OUTPUT_DIR, DEFAULT_VIDEO_CONFIG

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
        csec = int(round((seconds - int(seconds)) * 100))
        if csec >= 100:
            csec = 99
        return f"{hrs}:{mins:02d}:{secs:02d}.{csec:02d}"

    def generate_ass_subtitles(
        self,
        lines: List[Dict[str, Any]],
        output_ass_path: Path,
        style_config: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Generates Advanced SubStation Alpha (.ass) subtitle file
        with smooth progressive karaoke sweep tags (\\kf).
        """
        cfg = {**DEFAULT_VIDEO_CONFIG, **(style_config or {})}
        
        font_name = cfg.get("font_name", "DejaVu Sans")
        font_size = cfg.get("font_size", 54)
        primary_color = cfg.get("primary_color", "&H0022E5FF")    # Sung color (cyan/gold)
        secondary_color = cfg.get("secondary_color", "&H00FFFFFF")# Unsung text (white)
        outline_color = cfg.get("outline_color", "&H00111111")
        shadow_color = cfg.get("shadow_color", "&H80000000")
        lead_dots = cfg.get("lead_in_countdown_dots", 3)

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
            # Alignment 2 = Bottom Center, 5 = Top Center, 8 = Middle Top
            f"Style: KaraokeLine1,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{cfg['outline_width']},{cfg['shadow_width']},2,80,80,200,1",
            f"Style: KaraokeLine2,{font_name},{font_size},{primary_color},{secondary_color},{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,{cfg['outline_width']},{cfg['shadow_width']},2,80,80,110,1",
            f"Style: Countdown,{font_name},{font_size + 10},{primary_color},{secondary_color},{outline_color},{shadow_color},-1,0,0,0,100,100,2,0,1,3,2,2,80,80,290,1",
            f"Style: TitleCard,{font_name},64,&H00FFFFFF,&H00FFFFFF,{outline_color},{shadow_color},-1,0,0,0,100,100,1,0,1,3,3,5,60,60,180,1",
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
            display_start = max(0.0, l_start - 2.5) if i == 0 else max(prev_end_time, l_start - 2.0)
            display_end = l_end + 1.2

            # Visual countdown cue if there's a significant break (> 3 seconds)
            gap = l_start - prev_end_time
            if (i == 0 and l_start >= 3.0) or (i > 0 and gap >= 3.5):
                countdown_start = max(0.0, l_start - 3.0)
                dot_dur_cs = 100 # 1 second per dot
                # 3 countdown dots: ● ● ● with progressive fill
                dots_text = "{\\kf100}● {\\kf100}● {\\kf100}● "
                ass_content.append(
                    f"Dialogue: 1,{self._format_ass_time(countdown_start)},{self._format_ass_time(l_start)},Countdown,,0,0,0,,{dots_text}"
                )

            # Build line text with \\kf (progressive fill) tags
            karaoke_text_parts = []
            
            # Initial lead-in delay tag if display starts before line starts
            lead_in_cs = int(round((l_start - display_start) * 100))
            if lead_in_cs > 0:
                karaoke_text_parts.append(f"{{\\k{lead_in_cs}}}")

            cur_word_time = l_start
            for w in words:
                w_start = float(w.get("start_time", cur_word_time))
                w_end = float(w.get("end_time", w_start + 0.4))
                dur_cs = max(1, int(round((w_end - w_start) * 100)))
                word_text = w.get("word", "")
                
                # Use \\kf for smooth progressive sweep
                karaoke_text_parts.append(f"{{\\kf{dur_cs}}}{word_text} ")
                cur_word_time = w_end

            full_line_text = "".join(karaoke_text_parts).strip()

            ass_content.append(
                f"Dialogue: 0,{self._format_ass_time(display_start)},{self._format_ass_time(display_end)},{style_name},,0,0,0,,{full_line_text}"
            )

            prev_end_time = l_end

        output_ass_path.write_text("\n".join(ass_content), encoding="utf-8")
        return str(output_ass_path)

    def render_video(
        self,
        audio_path: str,
        ass_subtitles_path: str,
        output_mp4_path: Path,
        thumbnail_path: Optional[str] = None,
        custom_bg_path: Optional[str] = None,
        title: str = "Karaoke Track",
        artist: str = "Artist",
        aspect_ratio: str = "16:9",
        duration: Optional[float] = None,
        progress_callback: Optional[Any] = None,
        cancel_event: Optional[Any] = None
    ) -> str:
        """
        Synthesizes final karaoke video using FFmpeg and libass.
        Streams FFmpeg output with -progress pipe:1 to calculate real-time percentage and ETA.
        Supports cancellation via cancel_event.
        """
        import time
        width, height = (1920, 1080) if aspect_ratio == "16:9" else (1080, 1920)

        # If duration was not provided, probe audio file
        if not duration or duration <= 0:
            try:
                import soundfile as sf
                info = sf.info(audio_path)
                duration = float(info.duration)
            except Exception:
                duration = 200.0  # safe fallback if probe fails

        # Escape ASS path for FFmpeg subtitles filter
        escaped_ass = str(ass_subtitles_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")

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
            "ffmpeg", "-y",
            "-progress", "pipe:1",
            "-nostats",
            *bg_input,
            "-i", audio_path,
            "-filter_complex", filter_complex,
            "-map", "[v]",
            "-map", "1:a",
            "-c:v", "libx264",
            "-preset", "fast",
            "-crf", "18",
            "-r", "60",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "320k",
            "-shortest",
            str(output_mp4_path)
        ]

        logger.info(f"Rendering video with FFmpeg: {' '.join(cmd)}")
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        current_frame = 0
        current_fps = 0.0
        current_speed = 1.0
        out_time_sec = 0.0
        last_callback_time = 0.0

        try:
            for line in process.stdout:
                if cancel_event and cancel_event.is_set():
                    logger.warning("Video rendering cancelled by user.")
                    process.terminate()
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
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
                        div = 1_000_000 if key == "out_time_us" else 1_000
                        out_time_sec = float(val) / div
                    except ValueError:
                        pass
                elif key == "progress" and val in ("continue", "end"):
                    now = time.time()
                    if now - last_callback_time >= 0.25 or val == "end":
                        last_callback_time = now
                        pct = 100.0 if val == "end" else min(99.0, max(0.0, (out_time_sec / duration) * 100.0))
                        eta_sec = None
                        if val != "end" and current_speed > 0.05 and duration > out_time_sec:
                            eta_sec = max(0, int((duration - out_time_sec) / current_speed))
                        
                        detail = f"Encoding 1080p60: frame {current_frame} ({current_fps:.0f} fps, {current_speed:.1f}x speed)"
                        if progress_callback:
                            progress_callback(pct, detail, eta_sec)

            process.wait()

        except Exception as e:
            if cancel_event and cancel_event.is_set():
                process.terminate()
            raise e

        if process.returncode != 0:
            stderr_out = process.stderr.read() if process.stderr else ""
            logger.error(f"Video rendering failed: {stderr_out}")
            raise RuntimeError(f"FFmpeg video render error: {stderr_out}")

        return str(output_mp4_path)
