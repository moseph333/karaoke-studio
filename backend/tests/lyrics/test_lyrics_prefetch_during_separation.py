"""The intake pipelines look the lyrics up while the stems are separated, instead of after.

Every service is a stand-in, so the tests only watch the order of the calls: the lyric lookup
must start before separation ends, its result must reach the aligner, and a failed or
cancelled lookup must end the song the way a lookup in line did.
"""

import threading

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects
from backend.project_store import find_project, save_projects
from backend.services.lyric_sync import SyncResult

LYRICS = {
    "source": "lrclib",
    "synced": True,
    "lines": [{"text": "hello world", "start": 1.0, "end": 2.0}],
}


@pytest.fixture
def fake_song(monkeypatch, tmp_path):
    """Stand-ins for the download, separation, alignment and mix; records what happened."""
    state = type("State", (), {})()
    state.events = []
    state.lyrics_started = threading.Event()
    state.lyrics_release = threading.Event()
    state.lyrics_release.set()
    state.lyrics_error = None
    state.synced_with = None

    def extract(url, progress_hook=None):
        state.events.append("download")
        return {
            "id": "prefetch_vid",
            "title": "Song",
            "artist": "Singer",
            "duration": 200.0,
            "audio_path": str(tmp_path / "song.wav"),
        }

    def separate(**kwargs):
        state.events.append("separate:start")
        # The lookup is already under way while the stems are made
        state.lyrics_seen_during_separation = state.lyrics_started.wait(timeout=5)
        state.events.append("separate:end")
        return {
            "vocals_path": str(tmp_path / "missing_vocals.wav"),
            "instrumental_path": str(tmp_path / "missing_inst.wav"),
        }

    def fetch_lyrics(title, artist, duration=None):
        state.lyrics_args = (title, artist, duration)
        state.lyrics_started.set()
        state.lyrics_release.wait(timeout=5)
        if state.lyrics_error is not None:
            raise state.lyrics_error
        return LYRICS

    def sync(vocals_path, lines, **kwargs):
        state.synced_with = lines
        return SyncResult(lines=lines, report={}, lyric_timing="line")

    def mix(**kwargs):
        return str(tmp_path / "master.wav")

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", extract)
    monkeypatch.setattr(main_mod.separator, "separate_stems", separate)
    monkeypatch.setattr(main_mod.lyrics_service, "fetch_lyrics", fetch_lyrics)
    monkeypatch.setattr(pipeline, "sync_lyrics", sync)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", mix)
    return state


def _new_project(pid: str) -> None:
    projects[pid] = {"id": pid, "status": "queued"}
    save_projects()
    active_cancellations.pop(pid, None)


def test_a_youtube_song_looks_its_lyrics_up_while_it_is_separated(fake_song):
    _new_project("prefetch_yt")

    pipeline.run_pipeline("prefetch_yt", "prefetch_vid")

    proj = find_project("prefetch_yt")
    assert proj["status"] == "ready", proj.get("error")
    assert fake_song.lyrics_seen_during_separation
    assert fake_song.lyrics_args == ("Song", "Singer", 200.0)
    assert fake_song.synced_with == LYRICS["lines"]
    assert proj["lyric_source"] == "lrclib"


def test_an_upload_looks_its_lyrics_up_while_it_is_separated(fake_song, tmp_path, monkeypatch):
    _new_project("prefetch_up")
    wav = main_mod.DOWNLOADS_DIR / "prefetch_up.wav"
    wav.write_bytes(b"")

    class Info:
        format = "WAV"
        duration = 123.0

    monkeypatch.setattr(main_mod.sf, "info", lambda path: Info())
    try:
        pipeline.run_local_pipeline("prefetch_up", str(wav), title="Upload", artist="Band")
    finally:
        wav.unlink(missing_ok=True)

    proj = find_project("prefetch_up")
    assert proj["status"] == "ready", proj.get("error")
    assert fake_song.lyrics_seen_during_separation
    assert fake_song.lyrics_args == ("Upload", "Band", 123.0)


def test_pasted_lyrics_skip_the_lookup(fake_song, monkeypatch):
    _new_project("prefetch_paste")
    fake_song.lyrics_started.set()  # separation need not wait for a lookup that never runs
    called = []
    monkeypatch.setattr(main_mod.lyrics_service, "fetch_lyrics", lambda *a, **k: called.append(a))

    pipeline.run_pipeline("prefetch_paste", "prefetch_vid", custom_lyrics="my own words")

    proj = find_project("prefetch_paste")
    assert proj["status"] == "ready", proj.get("error")
    assert called == []
    assert proj["lyric_source"] != "lrclib"


def test_a_failed_lookup_still_ends_the_song_with_its_error(fake_song):
    _new_project("prefetch_fail")
    fake_song.lyrics_error = RuntimeError("LRCLIB is down")

    pipeline.run_pipeline("prefetch_fail", "prefetch_vid")

    proj = find_project("prefetch_fail")
    assert proj["status"] == "error"
    assert "LRCLIB is down" in proj["error"]
    assert "separate:end" in fake_song.events


def test_cancelling_while_the_lookup_hangs_does_not_wait_for_it(fake_song, monkeypatch):
    _new_project("prefetch_cancel")
    fake_song.lyrics_release.clear()  # the lookup hangs until the test lets it go
    separate = main_mod.separator.separate_stems
    mixed = []

    def separate_then_cancel_later(**kwargs):
        stems = separate(**kwargs)
        # Cancel once the pipeline is waiting on the hung lookup
        threading.Timer(0.5, active_cancellations["prefetch_cancel"].set).start()
        return stems

    monkeypatch.setattr(main_mod.separator, "separate_stems", separate_then_cancel_later)
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda **k: mixed.append(k))
    try:
        pipeline.run_pipeline("prefetch_cancel", "prefetch_vid")
    finally:
        fake_song.lyrics_release.set()

    proj = find_project("prefetch_cancel")
    assert proj["status"] == "cancelled"
    assert proj["progress"] == 0
    assert mixed == []
    assert fake_song.synced_with is None


def test_the_prefetch_hands_back_what_the_lookup_raised():
    def boom():
        raise ValueError("bad title")

    job = pipeline.LyricsPrefetch(boom)
    with pytest.raises(ValueError, match="bad title"):
        job.result()
    assert pipeline.LyricsPrefetch(lambda a, b: a + b, 2, 3).result() == 5
