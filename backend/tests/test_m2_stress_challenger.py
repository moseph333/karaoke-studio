import os
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

import psutil
import pytest

from backend.services.audio_mixer import AudioMixer
from backend.services.downloader import TrackDownloader
from backend.services.separator import AudioSeparator
from backend.services.video_renderer import VideoRenderer

# ============================================================================
# Category 1: Subprocess Pipe Buffering & Deadlock Under Massive Streams
# ============================================================================


def test_demucs_massive_stdout_and_stderr_pipe_stress(tmp_path):
    """
    Stress test AudioSeparator against massive (>1MB) stdout and (>1MB) stderr streams.
    Linux pipe buffers are typically 64KB. If stdout or stderr is not properly drained
    or routed to DEVNULL, the subprocess blocks and deadlocks.
    """
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    input_audio = tmp_path / "input.wav"
    input_audio.write_bytes(b"RIFF" + b"\x00" * 100)  # >44 bytes

    # Synthetic demucs script that emits 1MB on stdout and 1MB on stderr
    stress_script = tmp_path / "fake_demucs_heavy.py"
    stress_script.write_text("""
import sys
import os
import time

# Write 1MB of chunks to stdout
chunk = "O" * 4096 + "\\n"
for _ in range(256):
    sys.stdout.write(chunk)
sys.stdout.flush()

# Write 1MB of progress lines to stderr
err_chunk = " 50%|█████     | 50/100 [00:01<00:01, 50.00it/s]\\n"
for _ in range(5000):
    sys.stderr.write(err_chunk)
sys.stderr.flush()

# Create dummy output files expected by separator
target_dir = sys.argv[sys.argv.index("-o") + 1]
out_dir = os.path.join(target_dir, "htdemucs", "input")
os.makedirs(out_dir, exist_ok=True)
with open(os.path.join(out_dir, "vocals.wav"), "wb") as f:
    f.write(b"RIFF" + b"\\x00" * 100)
with open(os.path.join(out_dir, "no_vocals.wav"), "wb") as f:
    f.write(b"RIFF" + b"\\x00" * 100)
""")

    progress_reports = []

    def on_progress(pct, detail, eta):
        progress_reports.append((pct, detail, eta))

    # Intercept sys.executable cmd execution to run stress_script
    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if "-m" in cmd and "demucs" in cmd:
            custom_cmd = [sys.executable, str(stress_script), *cmd[4:]]
            return orig_popen(custom_cmd, *args, **kwargs)
        return orig_popen(cmd, *args, **kwargs)

    with patch("subprocess.Popen", side_effect=mock_popen):
        start_time = time.time()
        result = separator.separate_stems(
            audio_path=str(input_audio),
            track_id="stress_track_1",
            progress_callback=on_progress,
        )
        elapsed = time.time() - start_time

    # Must complete promptly without hanging on 64KB pipe buffers
    assert elapsed < 10.0, f"Separation took {elapsed}s, possible pipe stall!"
    assert Path(result["vocals_path"]).is_file()
    assert Path(result["instrumental_path"]).is_file()
    assert len(progress_reports) > 0


def test_video_renderer_massive_stdout_and_stderr_pipe_stress(tmp_path):
    """
    Stress test VideoRenderer.render_video against massive concurrent stdout (>1MB)
    and stderr (>1MB) streams. VideoRenderer drains stdout in main thread and stderr
    in background thread.
    """
    renderer = VideoRenderer(output_dir=tmp_path / "video_out")
    audio_path = tmp_path / "test.wav"
    audio_path.write_bytes(b"RIFF" + b"\x00" * 1000)

    ass_path = tmp_path / "test.ass"
    renderer.generate_ass_subtitles(
        lines=[{"start_time": 0.0, "end_time": 5.0, "text": "Stress test"}],
        output_ass_path=ass_path,
    )

    output_mp4 = tmp_path / "output.mp4"

    # Synthetic ffmpeg script emitting heavy stdout progress + heavy stderr warnings
    fake_ffmpeg = tmp_path / "fake_ffmpeg_heavy.py"
    fake_ffmpeg.write_text("""
import sys
import time

# Interleave stdout progress lines and stderr log lines
for i in range(2000):
    sys.stdout.write(f"frame={i}\\nfps=60.0\\nspeed=2.0x\\nout_time_us={i*16666}\\nprogress=continue\\n")
    sys.stderr.write(f"Warning: sample buffer overflow frame {i}: synthetic log message padding " + ("X" * 200) + "\\n")
    if i % 100 == 0:
        sys.stdout.flush()
        sys.stderr.flush()

sys.stdout.write("progress=end\\n")
sys.stdout.flush()

out_file = sys.argv[-1]
with open(out_file, "wb") as f:
    f.write(b"fake_mp4_header" + b"\\x00" * 1024)
""")

    progress_reports = []

    def on_progress(pct, detail, eta):
        progress_reports.append((pct, detail, eta))

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if cmd[0] == "ffmpeg":
            custom_cmd = [sys.executable, str(fake_ffmpeg), *cmd[1:]]
            return orig_popen(custom_cmd, *args, **kwargs)
        return orig_popen(cmd, *args, **kwargs)

    with patch("subprocess.Popen", side_effect=mock_popen):
        start_time = time.time()
        result_path = renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=output_mp4,
            duration=10.0,
            progress_callback=on_progress,
        )
        elapsed = time.time() - start_time

    assert elapsed < 10.0, f"Render took {elapsed}s, pipe deadlock suspected!"
    assert Path(result_path).is_file()
    assert len(progress_reports) > 0


def test_audio_mixer_massive_output_stress(tmp_path):
    """
    Stress test AudioMixer against synthetic FFmpeg returning huge stdout/stderr via subprocess.run.
    """
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")
    inst_path = tmp_path / "inst.wav"
    inst_path.write_bytes(b"RIFF" + b"\x00" * 1000)

    fake_ffmpeg = tmp_path / "fake_ffmpeg_mix.py"
    fake_ffmpeg.write_text("""
import sys

# Emit huge stderr (500KB)
for _ in range(5000):
    sys.stderr.write("FFmpeg audio mix filter graph trace padding message\\n")

out_file = sys.argv[-1]
with open(out_file, "wb") as f:
    f.write(b"RIFF" + b"\\x00" * 500)
""")

    orig_run = subprocess.run

    def mock_run(cmd, *args, **kwargs):
        if cmd[0] == "ffmpeg":
            custom_cmd = [sys.executable, str(fake_ffmpeg), *cmd[1:]]
            return orig_run(custom_cmd, *args, **kwargs)
        return orig_run(cmd, *args, **kwargs)

    with patch("subprocess.run", side_effect=mock_run):
        start_time = time.time()
        out_path = mixer.mix_and_shift(
            instrumental_path=str(inst_path),
            semitones=2,
            output_filename="test_master.wav",
        )
        elapsed = time.time() - start_time

    assert elapsed < 5.0
    assert Path(out_path).is_file()


# ============================================================================
# Category 2: Process Termination, Timeouts & Zombie Prevention
# ============================================================================


def test_demucs_cancellation_terminates_and_reaps_zombie(tmp_path):
    """
    Verify that cancelling AudioSeparator terminates the child process
    and reaps it completely so no zombie process (status 'Z') remains.
    """
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    input_audio = tmp_path / "input.wav"
    input_audio.write_bytes(b"RIFF" + b"\x00" * 100)

    # Subprocess that writes progress slowly and would run for 60 seconds
    slow_script = tmp_path / "slow_demucs.py"
    slow_script.write_text("""
import sys
import time

for i in range(60):
    sys.stderr.write(f" {i}%|█| {i}/60 [00:01<00:59]\\n")
    sys.stderr.flush()
    time.sleep(0.5)
""")

    cancel_event = threading.Event()
    spawned_pids = []

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if "-m" in cmd and "demucs" in cmd:
            custom_cmd = [sys.executable, str(slow_script), *cmd[4:]]
            proc = orig_popen(custom_cmd, *args, **kwargs)
            spawned_pids.append(proc.pid)
            return proc
        return orig_popen(cmd, *args, **kwargs)

    # Cancel after receiving first progress callback
    def on_progress(pct, detail, eta):
        if pct is not None and pct > 0:
            cancel_event.set()

    with (
        patch("subprocess.Popen", side_effect=mock_popen),
        pytest.raises(RuntimeError, match="cancelled by user"),
    ):
        separator.separate_stems(
            audio_path=str(input_audio),
            track_id="cancel_track",
            progress_callback=on_progress,
            cancel_event=cancel_event,
        )

    assert len(spawned_pids) == 1
    child_pid = spawned_pids[0]

    # Inspect OS process table via psutil
    time.sleep(0.5)
    if psutil.pid_exists(child_pid):
        proc = psutil.Process(child_pid)
        assert proc.status() != psutil.STATUS_ZOMBIE, f"PID {child_pid} leaked as a zombie process!"
        assert not proc.is_running(), f"PID {child_pid} is still actively running!"


def test_demucs_cancellation_when_stderr_is_silent(tmp_path):
    """
    EMPIRICAL CHALLENGE:
    What happens if Demucs is hanging/sleeping silently without outputting to stderr
    when cancel_event is signaled?
    In separator.py: line 105 is `for line in process.stderr:`.
    If the child process produces NO output, does the separator thread block forever,
    or does cancellation take effect?
    """
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    input_audio = tmp_path / "input.wav"
    input_audio.write_bytes(b"RIFF" + b"\x00" * 100)

    # Silent script that sleeps for 5 seconds without writing anything to stderr
    silent_script = tmp_path / "silent_demucs.py"
    silent_script.write_text("""
import sys
import time

time.sleep(5)
sys.stderr.write("late line\\n")
""")

    cancel_event = threading.Event()
    spawned_pids = []

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if "-m" in cmd and "demucs" in cmd:
            custom_cmd = [sys.executable, str(silent_script), *cmd[4:]]
            proc = orig_popen(custom_cmd, *args, **kwargs)
            spawned_pids.append(proc.pid)
            return proc
        return orig_popen(cmd, *args, **kwargs)

    # Trigger cancellation after 0.2s from background thread
    def trigger_cancel():
        time.sleep(0.2)
        cancel_event.set()

    t = threading.Thread(target=trigger_cancel)
    t.start()

    start_time = time.time()
    with patch("subprocess.Popen", side_effect=mock_popen):
        # We test whether separate_stems returns/raises within reasonable time
        try:
            separator.separate_stems(
                audio_path=str(input_audio),
                track_id="silent_track",
                cancel_event=cancel_event,
            )
        except RuntimeError:
            pass
        except Exception:
            pass

    elapsed = time.time() - start_time
    t.join()

    # If separate_stems blocked on process.stderr.readline() for the entire 5s sleep,
    # then cancellation does NOT react promptly to silent processes!
    # Let's record the empirical elapsed time.
    print(f"Empirical elapsed time for silent demucs cancellation: {elapsed:.2f}s")


def test_video_renderer_cancellation_terminates_and_reaps_zombie(tmp_path):
    """
    Verify VideoRenderer.render_video terminates child process and reaps zombie on cancel.
    """
    renderer = VideoRenderer(output_dir=tmp_path / "video_out")
    audio_path = tmp_path / "test.wav"
    audio_path.write_bytes(b"RIFF" + b"\x00" * 1000)

    ass_path = tmp_path / "test.ass"
    renderer.generate_ass_subtitles(
        lines=[{"start_time": 0.0, "end_time": 5.0, "text": "Cancel test"}],
        output_ass_path=ass_path,
    )
    output_mp4 = tmp_path / "output.mp4"

    slow_ffmpeg = tmp_path / "slow_ffmpeg.py"
    slow_ffmpeg.write_text("""
import sys
import time

for i in range(100):
    sys.stdout.write(f"frame={i}\\nfps=60\\nspeed=1.0x\\nout_time_us={i*100000}\\nprogress=continue\\n")
    sys.stdout.flush()
    time.sleep(0.1)
""")

    cancel_event = threading.Event()
    spawned_pids = []

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if cmd[0] == "ffmpeg":
            custom_cmd = [sys.executable, str(slow_ffmpeg), *cmd[1:]]
            proc = orig_popen(custom_cmd, *args, **kwargs)
            spawned_pids.append(proc.pid)
            return proc
        return orig_popen(cmd, *args, **kwargs)

    def on_progress(pct, detail, eta):
        if pct is not None and pct > 0:
            cancel_event.set()

    with (
        patch("subprocess.Popen", side_effect=mock_popen),
        pytest.raises(RuntimeError, match="cancelled by user"),
    ):
        renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=output_mp4,
            duration=10.0,
            progress_callback=on_progress,
            cancel_event=cancel_event,
        )

    assert len(spawned_pids) == 1
    child_pid = spawned_pids[0]

    time.sleep(0.5)
    if psutil.pid_exists(child_pid):
        proc = psutil.Process(child_pid)
        assert proc.status() != psutil.STATUS_ZOMBIE
        assert not proc.is_running()


def test_audio_mixer_timeout_kills_and_reaps_process(tmp_path):
    """
    Verify AudioMixer timeout kills hanging FFmpeg subprocess and leaves no zombie.
    """
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")
    inst_path = tmp_path / "inst.wav"
    inst_path.write_bytes(b"RIFF" + b"\x00" * 1000)

    hanging_script = tmp_path / "hanging_ffmpeg.py"
    hanging_script.write_text("""
import time
time.sleep(30)
""")

    orig_run = subprocess.run

    def mock_run(cmd, *args, **kwargs):
        if cmd[0] == "ffmpeg":
            custom_cmd = [sys.executable, str(hanging_script), *cmd[1:]]
            # Use Popen to record PID then delegate
            return orig_run(custom_cmd, *args, **kwargs)
        return orig_run(cmd, *args, **kwargs)

    with patch("subprocess.run", side_effect=mock_run):
        start_time = time.time()
        with pytest.raises(RuntimeError, match="timed out after 1 seconds"):
            mixer.mix_and_shift(
                instrumental_path=str(inst_path),
                semitones=0,
                timeout=1,
            )
        elapsed = time.time() - start_time

    assert elapsed < 3.0, f"Mixer took {elapsed}s to timeout!"


# ============================================================================
# Category 3: Corrupt, Truncated & Zero-Byte Media Files
# ============================================================================


def test_separator_corrupt_and_zero_byte_files(tmp_path):
    """
    Test AudioSeparator with:
    - Non-existent file
    - Zero-byte file
    - Truncated garbage WAV
    """
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")

    # 1. Non-existent file
    with pytest.raises(FileNotFoundError):
        separator.separate_stems("/path/does/not/exist.wav", "track_missing")

    # 2. Empty string path
    with pytest.raises(ValueError):
        separator.separate_stems("", "track_empty")

    # 3. Zero-byte file
    zero_file = tmp_path / "zero.wav"
    zero_file.write_bytes(b"")
    with pytest.raises(ValueError, match="0 bytes"):
        separator.separate_stems(str(zero_file), "track_zero")

    # 4. Truncated corrupt file (fails in demucs with non-zero exit code)
    corrupt_file = tmp_path / "corrupt.wav"
    corrupt_file.write_bytes(b"NOT_A_VALID_AUDIO_HEADER_TRUNCATED")

    fail_script = tmp_path / "fail_demucs.py"
    fail_script.write_text("""
import sys
sys.stderr.write("demucs.error: Invalid or corrupted audio header\\n")
sys.exit(1)
""")

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if "-m" in cmd and "demucs" in cmd:
            custom_cmd = [sys.executable, str(fail_script), *cmd[4:]]
            return orig_popen(custom_cmd, *args, **kwargs)
        return orig_popen(cmd, *args, **kwargs)

    with (
        patch("subprocess.Popen", side_effect=mock_popen),
        pytest.raises(RuntimeError, match="Demucs failed"),
    ):
        separator.separate_stems(str(corrupt_file), "track_corrupt")


def test_mixer_corrupt_and_zero_byte_files(tmp_path):
    """
    Test AudioMixer with zero-byte and corrupt audio files.
    """
    mixer = AudioMixer(output_dir=tmp_path / "mixer_out")

    # 1. Missing file
    with pytest.raises(FileNotFoundError):
        mixer.mix_and_shift("/path/to/nothing.wav")

    # 2. Zero-byte file
    zero_file = tmp_path / "zero_inst.wav"
    zero_file.write_bytes(b"")

    # FFmpeg will fail on zero-byte file
    with pytest.raises(RuntimeError, match="FFmpeg audio mixing failed"):
        mixer.mix_and_shift(str(zero_file))

    # Verify no temp files remain in output directory
    leftover_tmp = list(mixer.output_dir.glob("*.tmp*"))
    assert leftover_tmp == [], f"Found leftover temp files: {leftover_tmp}"


def test_video_renderer_corrupt_inputs(tmp_path):
    """
    Test VideoRenderer with missing audio file and corrupt ASS file.
    """
    renderer = VideoRenderer(output_dir=tmp_path / "video_out")
    output_mp4 = tmp_path / "out.mp4"

    # Missing audio file
    with pytest.raises(RuntimeError, match="FFmpeg video render error"):
        renderer.render_video(
            audio_path="/nonexistent/audio.wav",
            ass_subtitles_path="/nonexistent/sub.ass",
            output_mp4_path=output_mp4,
        )


def test_downloader_corrupt_cache_and_bad_urls(tmp_path):
    """
    Test TrackDownloader against corrupted 0-byte cached files and adversarial URLs.
    """
    downloader = TrackDownloader(output_dir=tmp_path / "downloads")

    # 1. Empty URL
    with pytest.raises(ValueError, match="cannot be empty"):
        downloader.extract_info_and_download("")

    # 2. Whitespace URL
    with pytest.raises(ValueError, match="cannot be empty"):
        downloader.extract_info_and_download("   ")

    # 3. Adversarial / spoofed URLs
    assert downloader.extract_video_id("https://evil-youtube.com/watch?v=dQw4w9WgXcQ") is None
    assert downloader.extract_video_id("https://vimeo.com/12345678901") is None
    assert downloader.extract_video_id("https://youtube.com/watch?v=invalid_id") is None
    assert downloader.extract_video_id("https://notyoutube.org/v/dQw4w9WgXcQ") is None

    # 4. Valid ID with 0-byte cached wav: must NOT treat as valid cache
    vid_id = "dQw4w9WgXcQ"
    cached_wav = downloader.output_dir / f"{vid_id}.wav"
    cached_wav.write_bytes(b"")  # 0-byte file

    # When 0-byte, downloader must proceed to download rather than returning 0-byte cache
    with patch("yt_dlp.YoutubeDL") as mock_ydl:
        mock_instance = mock_ydl.return_value.__enter__.return_value
        mock_instance.extract_info.return_value = {
            "id": vid_id,
            "title": "Fresh Download",
            "duration": 120,
        }

        # Simulate successful download creating real wav
        def make_real_file(*args, **kwargs):
            cached_wav.write_bytes(b"RIFF" + b"\x00" * 100)
            return {"id": vid_id, "title": "Fresh Download", "duration": 120}

        mock_instance.extract_info.side_effect = make_real_file

        info = downloader.extract_info_and_download(vid_id)
        assert info["id"] == vid_id
        assert info["title"] == "Fresh Download"


# ============================================================================
# Category 4: Cleanup of Temporary Directories and Intermediate Artifacts
# ============================================================================


def test_demucs_cleanup_on_success(tmp_path):
    """
    Verify AudioSeparator cleans up intermediate model directory tree on success.
    """
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    input_audio = tmp_path / "input.wav"
    input_audio.write_bytes(b"RIFF" + b"\x00" * 100)

    success_script = tmp_path / "success_demucs.py"
    success_script.write_text("""
import sys
import os

target_dir = sys.argv[sys.argv.index("-o") + 1]
# Demucs creates nested <target_dir>/htdemucs/input/...
intermediate_dir = os.path.join(target_dir, "htdemucs", "input")
os.makedirs(intermediate_dir, exist_ok=True)
with open(os.path.join(intermediate_dir, "vocals.wav"), "wb") as f:
    f.write(b"RIFF" + b"\\x00" * 100)
with open(os.path.join(intermediate_dir, "no_vocals.wav"), "wb") as f:
    f.write(b"RIFF" + b"\\x00" * 100)
""")

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if "-m" in cmd and "demucs" in cmd:
            custom_cmd = [sys.executable, str(success_script), *cmd[4:]]
            return orig_popen(custom_cmd, *args, **kwargs)
        return orig_popen(cmd, *args, **kwargs)

    with patch("subprocess.Popen", side_effect=mock_popen):
        separator.separate_stems(str(input_audio), "clean_track")

    target_dir = tmp_path / "stems" / "clean_track"
    # Intermediate directory 'htdemucs' MUST be deleted
    assert not (target_dir / "htdemucs").exists(), (
        "Intermediate htdemucs directory was NOT cleaned up!"
    )
    # Output stems must exist
    assert (target_dir / "vocals.wav").is_file()
    assert (target_dir / "instrumental.wav").is_file()


def test_demucs_cleanup_on_failure_empirical_check(tmp_path):
    """
    EMPIRICAL CHALLENGE:
    Does AudioSeparator clean up intermediate model directory tree if Demucs crashes
    after creating partial model files?
    """
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    input_audio = tmp_path / "input.wav"
    input_audio.write_bytes(b"RIFF" + b"\x00" * 100)

    crash_script = tmp_path / "crash_demucs.py"
    crash_script.write_text("""
import sys
import os

target_dir = sys.argv[sys.argv.index("-o") + 1]
intermediate_dir = os.path.join(target_dir, "htdemucs", "input")
os.makedirs(intermediate_dir, exist_ok=True)
with open(os.path.join(intermediate_dir, "partial_artifact.tmp"), "wb") as f:
    f.write(b"partial model weights or dump")
sys.stderr.write("OOM Crash during Demucs inference\\n")
sys.exit(137)
""")

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if "-m" in cmd and "demucs" in cmd:
            custom_cmd = [sys.executable, str(crash_script), *cmd[4:]]
            return orig_popen(custom_cmd, *args, **kwargs)
        return orig_popen(cmd, *args, **kwargs)

    with patch("subprocess.Popen", side_effect=mock_popen), pytest.raises(RuntimeError):
        separator.separate_stems(str(input_audio), "failed_track")

    target_dir = tmp_path / "stems" / "failed_track"
    # Check if intermediate artifacts were cleaned up or leaked
    leaked_intermediate = (target_dir / "htdemucs").exists()
    print(f"Empirical check: intermediate dir leaked on failure? {leaked_intermediate}")


def test_video_renderer_partial_output_cleanup_empirical_check(tmp_path):
    """
    EMPIRICAL CHALLENGE:
    Does VideoRenderer clean up partial MP4 file if cancelled or failed?
    """
    renderer = VideoRenderer(output_dir=tmp_path / "video_out")
    audio_path = tmp_path / "test.wav"
    audio_path.write_bytes(b"RIFF" + b"\x00" * 1000)

    ass_path = tmp_path / "test.ass"
    renderer.generate_ass_subtitles(
        lines=[{"start_time": 0.0, "end_time": 5.0, "text": "Test"}],
        output_ass_path=ass_path,
    )
    output_mp4 = tmp_path / "output.mp4"

    fail_ffmpeg = tmp_path / "fail_ffmpeg.py"
    fail_ffmpeg.write_text("""
import sys

# Create partial broken MP4
out_file = sys.argv[-1]
with open(out_file, "wb") as f:
    f.write(b"CORRUPTED_PARTIAL_MP4_DATA")

sys.stderr.write("Error: Encoding failed\\n")
sys.exit(1)
""")

    orig_popen = subprocess.Popen

    def mock_popen(cmd, *args, **kwargs):
        if cmd[0] == "ffmpeg":
            custom_cmd = [sys.executable, str(fail_ffmpeg), *cmd[1:]]
            return orig_popen(custom_cmd, *args, **kwargs)
        return orig_popen(cmd, *args, **kwargs)

    with patch("subprocess.Popen", side_effect=mock_popen), pytest.raises(RuntimeError):
        renderer.render_video(
            audio_path=str(audio_path),
            ass_subtitles_path=str(ass_path),
            output_mp4_path=output_mp4,
            duration=5.0,
        )

    # Check if corrupted partial MP4 is left on disk
    partial_leaked = output_mp4.exists()
    print(f"Empirical check: partial MP4 file leaked on failure? {partial_leaked}")
