"""The cuts between an album's songs land in the pauses between them: chapter times are
moved to the quiet a second or two away, catalog lengths are followed one song at a time so
the silence an upload adds between songs does not pile up, and an album nothing names is
split at its pauses, never at a break inside a song. Then one song is cut out as the
studio's WAV. Synthetic albums (``helpers/albums``), read through FFmpeg."""

import shutil
import subprocess

import numpy as np
import pytest
import soundfile as sf

from backend.services import album_audio
from backend.tests.helpers.albums import album_signal, write_album

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")


def _envelope(lengths, **kwargs):
    """The loudness curve of a synthetic album, computed as loudness_envelope does."""
    signal, middles = album_signal(lengths, **kwargs)
    hop = int(album_audio.ENVELOPE_RATE * album_audio.HOP_SECONDS)
    frames = signal[: len(signal) // hop * hop].reshape(-1, hop)
    with np.errstate(divide="ignore"):
        db = 20 * np.log10(np.sqrt(np.mean(frames * frames, axis=1)))
    return np.maximum(db, album_audio.SILENT_DB), middles, len(signal) / album_audio.ENVELOPE_RATE


def test_chapter_times_move_to_the_pause_nearby():
    envelope, middles, duration = _envelope([60, 70, 50])
    # Chapters written a second or two off, as fans write them
    cuts = album_audio.snap_cuts(envelope, [middles[0] - 1.8, middles[1] + 1.2], duration)
    assert cuts == pytest.approx(middles, abs=0.75)


def test_a_chapter_time_far_from_any_pause_stays_close_to_where_it_was():
    envelope, _, duration = _envelope([60, 70, 50])
    (cut,) = album_audio.snap_cuts(envelope, [30.0], duration)
    assert abs(cut - 30.0) <= album_audio.CHAPTER_WINDOW_SEC


def test_catalog_lengths_find_each_pause_even_when_the_upload_adds_silence():
    # Four seconds between songs in the upload, none in the catalog: by the last cut the
    # lengths alone are 12 s early
    lengths = [60, 70, 50, 80]
    envelope, middles, duration = _envelope(lengths, pause=4.0)
    cuts = album_audio.place_cuts(envelope, lengths, duration)
    assert cuts == pytest.approx(middles, abs=1.5)


def test_an_album_nothing_names_is_split_at_its_pauses():
    envelope, middles, duration = _envelope([60, 70, 50, 80])
    cuts = album_audio.split_at_pauses(envelope, duration)
    assert cuts == pytest.approx(middles, abs=0.75)


def test_a_break_inside_a_song_and_the_silence_at_the_ends_are_not_cuts():
    # Song 2 stops for 1.5 s halfway through; it is still one song, since its halves are
    # shorter than any song (SONG_MIN_SEC) once split
    envelope, middles, duration = _envelope([90, 80, 90], inner_breaks={1: 1.5}, lead=3.0)
    cuts = album_audio.split_at_pauses(envelope, duration)
    assert cuts == pytest.approx(middles, abs=0.75)


def test_one_long_song_has_no_cuts():
    envelope, _, duration = _envelope([300])
    assert album_audio.split_at_pauses(envelope, duration) == []


@needs_ffmpeg
def test_the_loudness_curve_is_read_through_ffmpeg_a_little_at_a_time(tmp_path):
    path = tmp_path / "album.wav"
    duration, middles = write_album(path, [50, 60, 55])
    envelope = album_audio.loudness_envelope(path)
    assert len(envelope) == pytest.approx(duration / album_audio.HOP_SECONDS, abs=2)
    assert album_audio.split_at_pauses(envelope, duration) == pytest.approx(middles, abs=0.75)


@needs_ffmpeg
def test_a_cancel_stops_reading_the_album(tmp_path):
    import threading

    path = tmp_path / "album.wav"
    write_album(path, [40, 50])
    cancel = threading.Event()
    cancel.set()
    with pytest.raises(RuntimeError, match="cancelled"):
        album_audio.loudness_envelope(path, cancel)


@needs_ffmpeg
def test_an_unreadable_album_says_so(tmp_path):
    path = tmp_path / "album.wav"
    path.write_bytes(b"not audio at all")
    with pytest.raises(album_audio.AlbumAudioError):
        album_audio.loudness_envelope(path)


@needs_ffmpeg
def test_one_song_is_cut_out_as_the_studios_wav(tmp_path):
    path = tmp_path / "album.wav"
    write_album(path, [40, 50, 45])
    target = tmp_path / "song.wav"
    length = album_audio.cut_song(path, 41.5, 91.5, target)
    info = sf.info(str(target))
    assert length == pytest.approx(50.0)
    assert info.duration == pytest.approx(50.0, abs=0.05)
    assert (info.samplerate, info.channels, info.subtype) == (44100, 2, "PCM_16")
    assert not list(tmp_path.glob("*_cut.wav"))


@needs_ffmpeg
def test_a_failed_cut_leaves_nothing_behind(tmp_path):
    target = tmp_path / "song.wav"
    with pytest.raises(album_audio.AlbumAudioError):
        album_audio.cut_song(tmp_path / "missing.wav", 0, 10, target)
    assert list(tmp_path.iterdir()) == [tmp_path / "workspace_data"]


@needs_ffmpeg
def test_the_chapters_of_an_uploaded_file_are_read(tmp_path):
    source = tmp_path / "album.wav"
    write_album(source, [30, 30])
    meta = tmp_path / "chapters.txt"
    meta.write_text(
        ";FFMETADATA1\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=31000\ntitle=First Song\n"
        "[CHAPTER]\nTIMEBASE=1/1000\nSTART=31000\nEND=62000\ntitle=Second Song\n"
    )
    with_chapters = tmp_path / "album.mka"
    subprocess.run(
        [
            *("ffmpeg", "-v", "error", "-y", "-i", str(source), "-i", str(meta)),
            *("-map_metadata", "1", "-map_chapters", "1", "-c:a", "flac", str(with_chapters)),
        ],
        check=True,
    )
    chapters = album_audio.file_chapters(with_chapters)
    assert [(c["start_time"], c["title"]) for c in chapters] == [
        (0.0, "First Song"),
        (31.0, "Second Song"),
    ]
    assert album_audio.file_chapters(source) == []
