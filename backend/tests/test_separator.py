import subprocess
import threading
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend.services.separator import AudioSeparator


def create_dummy_wav(path: Path, size_bytes: int = 100):
    """Helper to write a dummy WAV file with minimal header."""
    data = b"RIFF" + b"\x00" * max(0, size_bytes - 4)
    path.write_bytes(data)


# ==============================================================================
# 1. Stem Caching & Validation Unit Tests
# ==============================================================================


def test_separate_stems_cached_reuse(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    track_id = "cachedTrack1"
    target_dir = tmp_path / track_id
    target_dir.mkdir(parents=True)

    v_path = target_dir / "vocals.wav"
    i_path = target_dir / "instrumental.wav"
    create_dummy_wav(v_path, 200)
    create_dummy_wav(i_path, 200)

    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    progress_reports = []

    def cb(pct, detail, eta):
        progress_reports.append((pct, detail, eta))

    with patch("subprocess.Popen") as mock_popen:
        res = separator.separate_stems(
            audio_path=str(input_audio),
            track_id=track_id,
            progress_callback=cb,
        )
        assert res["vocals_path"] == str(v_path)
        assert res["instrumental_path"] == str(i_path)
        assert len(progress_reports) == 1
        assert progress_reports[0][0] == 100.0
        mock_popen.assert_not_called()


def test_separate_stems_corrupted_cached_files_purged_and_reprocessed(tmp_path):
    """
    If cached stem files are 0 bytes or corrupted (header <= 44 bytes),
    they must be purged and re-separated via Demucs.
    """
    separator = AudioSeparator(output_base_dir=tmp_path)
    track_id = "corruptCacheTrack"
    target_dir = tmp_path / track_id
    target_dir.mkdir(parents=True)

    v_path = target_dir / "vocals.wav"
    i_path = target_dir / "instrumental.wav"
    v_path.write_bytes(b"")  # 0-byte corrupt file
    i_path.write_bytes(b"")

    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    def fake_popen(cmd, **kwargs):
        # Create output inside demucs folder
        demucs_dir = target_dir / "htdemucs" / "input"
        demucs_dir.mkdir(parents=True, exist_ok=True)
        create_dummy_wav(demucs_dir / "vocals.wav", 500)
        create_dummy_wav(demucs_dir / "no_vocals.wav", 500)

        proc = MagicMock()
        proc.poll.return_value = 0
        proc.returncode = 0
        proc.stderr = iter([" 100%|██████████| 100/100 [00:10<00:00, 10.0it/s]\n"])
        return proc

    with patch("subprocess.Popen", side_effect=fake_popen):
        res = separator.separate_stems(audio_path=str(input_audio), track_id=track_id)
        assert res["vocals_path"] == str(v_path)
        assert res["instrumental_path"] == str(i_path)
        assert v_path.stat().st_size > 44
        assert i_path.stat().st_size > 44


def test_separate_stems_missing_input_raises_file_not_found(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    with pytest.raises(FileNotFoundError):
        separator.separate_stems("/nonexistent/file.wav", "bad_track")


def test_separate_stems_empty_input_audio_raises_value_error(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    empty_file = tmp_path / "empty.wav"
    empty_file.write_bytes(b"")
    with pytest.raises(ValueError):
        separator.separate_stems(str(empty_file), "track_empty")


def test_separate_stems_empty_path_string_raises_value_error(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    with pytest.raises(ValueError):
        separator.separate_stems("", "track_empty")
    with pytest.raises(ValueError):
        separator.separate_stems("   ", "track_empty")


# ==============================================================================
# 2. Subprocess Deadlock Prevention & Lifecycle
# ==============================================================================


def test_separate_stems_stdout_is_devnull_prevents_deadlock(tmp_path):
    """
    CRITICAL: Asserts that stdout is redirected to subprocess.DEVNULL
    so that unread stdout buffers never cause a deadlock.
    """
    separator = AudioSeparator(output_base_dir=tmp_path)
    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    track_id = "deadlockCheck"

    mock_proc = MagicMock()
    mock_proc.poll.return_value = 0
    mock_proc.returncode = 0
    mock_proc.stderr = iter([])

    with patch("subprocess.Popen", return_value=mock_proc) as mock_popen:
        try:
            separator.separate_stems(audio_path=str(input_audio), track_id=track_id)
        except RuntimeError:
            pass  # Expected since no files were written by the mock

        assert mock_popen.call_count == 1
        _, kwargs = mock_popen.call_args
        assert kwargs["stdout"] == subprocess.DEVNULL
        assert kwargs["stderr"] == subprocess.PIPE


def test_separate_stems_progress_parsing_and_callbacks(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    track_id = "progressTrack"
    target_dir = tmp_path / track_id

    mock_lines = [
        " 25%|██▌       | 25/100 [00:05<00:15,  5.0it/s]\n",
        " 50%|█████     | 50/100 [00:10<00:10,  5.0it/s]\n",
        " 100%|██████████| 100/100 [00:20<00:00, 5.0it/s]\n",
    ]

    def fake_popen(cmd, **kwargs):
        demucs_dir = target_dir / "htdemucs" / "input"
        demucs_dir.mkdir(parents=True, exist_ok=True)
        create_dummy_wav(demucs_dir / "vocals.wav", 500)
        create_dummy_wav(demucs_dir / "no_vocals.wav", 500)

        proc = MagicMock()
        proc.poll.return_value = 0
        proc.returncode = 0
        proc.stderr = iter(mock_lines)
        return proc

    progress_reports = []

    def cb(pct, detail, eta):
        progress_reports.append((pct, detail, eta))

    with patch("subprocess.Popen", side_effect=fake_popen):
        res = separator.separate_stems(
            audio_path=str(input_audio),
            track_id=track_id,
            progress_callback=cb,
        )
        assert Path(res["vocals_path"]).exists()
        assert len(progress_reports) >= 3
        percentages = [r[0] for r in progress_reports]
        assert 25.0 in percentages
        assert 50.0 in percentages
        assert 100.0 in percentages


def test_separate_stems_intermediate_model_dir_cleanup(tmp_path):
    """
    Verifies that the intermediate Demucs model directories (e.g. target_dir/htdemucs)
    are cleaned up after copying the stems to target_dir/vocals.wav and instrumental.wav.
    """
    separator = AudioSeparator(output_base_dir=tmp_path)
    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    track_id = "cleanupTrack"
    target_dir = tmp_path / track_id

    def fake_popen(cmd, **kwargs):
        demucs_dir = target_dir / "htdemucs" / "input"
        demucs_dir.mkdir(parents=True, exist_ok=True)
        create_dummy_wav(demucs_dir / "vocals.wav", 500)
        create_dummy_wav(demucs_dir / "no_vocals.wav", 500)

        proc = MagicMock()
        proc.poll.return_value = 0
        proc.returncode = 0
        proc.stderr = iter([])
        return proc

    with patch("subprocess.Popen", side_effect=fake_popen):
        res = separator.separate_stems(audio_path=str(input_audio), track_id=track_id)
        assert res["vocals_path"] == str(target_dir / "vocals.wav")
        assert (target_dir / "vocals.wav").exists()
        assert (target_dir / "instrumental.wav").exists()
        # Assert intermediate directory has been cleaned up
        assert not (target_dir / "htdemucs").exists()
        # Ensure only the two target WAV files exist
        assert len(list(target_dir.iterdir())) == 2


def test_separate_stems_cancellation_terminates_subprocess(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    cancel_evt = threading.Event()
    track_id = "cancelTrack"

    mock_proc = MagicMock()
    mock_proc.poll.return_value = None  # Process is running

    def stderr_gen():
        yield " 10%|█         | 10/100 [00:02<00:18,  5.0it/s]\n"
        cancel_evt.set()
        yield " 20%|██        | 20/100 [00:04<00:16,  5.0it/s]\n"

    mock_proc.stderr = stderr_gen()

    with patch("subprocess.Popen", return_value=mock_proc):
        with pytest.raises(RuntimeError) as exc_info:
            separator.separate_stems(
                audio_path=str(input_audio),
                track_id=track_id,
                cancel_event=cancel_evt,
            )
        assert "cancelled by user" in str(exc_info.value)
        mock_proc.terminate.assert_called()


def test_separate_stems_nonzero_exit_code_raises_runtime_error(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    mock_proc = MagicMock()
    mock_proc.poll.return_value = 1
    mock_proc.returncode = 1
    mock_proc.stderr = iter(["RuntimeError: CUDA out of memory\n"])

    with patch("subprocess.Popen", return_value=mock_proc):
        with pytest.raises(RuntimeError) as exc_info:
            separator.separate_stems(audio_path=str(input_audio), track_id="failTrack")
        assert "CUDA out of memory" in str(exc_info.value)


def test_separate_stems_guaranteed_cleanup_on_unexpected_exception(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    input_audio = tmp_path / "input.wav"
    create_dummy_wav(input_audio, 200)

    mock_proc = MagicMock()
    mock_proc.poll.return_value = None  # Running

    def throwing_stderr():
        raise OSError("Broken pipe simulation")
        yield ""

    mock_proc.stderr = throwing_stderr()

    with patch("subprocess.Popen", return_value=mock_proc):
        with pytest.raises(IOError):
            separator.separate_stems(audio_path=str(input_audio), track_id="errTrack")
        # Assert terminate was called via finally:
        mock_proc.terminate.assert_called()


# ==============================================================================
# 3. set_custom_instrumental Unit Tests
# ==============================================================================


def test_set_custom_instrumental_success(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    custom_inst = tmp_path / "user_backing.wav"
    create_dummy_wav(custom_inst, 500)

    track_id = "customTrack1"
    target_path = separator.set_custom_instrumental(track_id, str(custom_inst))
    assert Path(target_path).exists()
    assert Path(target_path).stat().st_size == 500
    assert (tmp_path / track_id / "instrumental.wav").exists()


def test_set_custom_instrumental_missing_file_raises(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    with pytest.raises(FileNotFoundError):
        separator.set_custom_instrumental("customTrack1", "/nonexistent/backing.wav")


def test_set_custom_instrumental_empty_track_id_raises(tmp_path):
    separator = AudioSeparator(output_base_dir=tmp_path)
    custom_inst = tmp_path / "user_backing.wav"
    create_dummy_wav(custom_inst, 500)
    with pytest.raises(ValueError):
        separator.set_custom_instrumental("", str(custom_inst))
