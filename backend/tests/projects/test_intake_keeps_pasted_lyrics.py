"""Lyrics pasted with a link are still used when the song is started again.

POST /api/process handed pasted lyrics straight to the pipeline and kept no copy, so "Try
again" on a song that failed or was cancelled looked the lyrics up instead and came back with
other words. They now stay on the song (``intake_lyrics``) until it has its lines.

The download, separation, lyric lookup, alignment and mix are stand-ins; the pasted lyrics go
through the real parser."""

import pytest

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations
from backend.project_store import find_project
from backend.services.lyric_sync import SyncResult
from backend.tests.helpers.media import generate_sine_wave_wav

VIDEO_ID = "PastedLyr01"
URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
PASTED = "Line one of mine\nLine two of mine"
OTHER = "Other words\nOther words again"


@pytest.fixture
def studio(monkeypatch):
    """Stand-ins for everything but the lyrics. ``studio.download_fails`` makes the next
    download fail; ``studio.lyrics_asked`` lists the lookups made."""
    state = type("State", (), {})()
    state.download_fails = False
    state.lyrics_asked = []

    def extract(url, progress_hook=None, **kwargs):
        if state.download_fails:
            raise RuntimeError("The download failed")
        wav = generate_sine_wave_wav(main_mod.DOWNLOADS_DIR / f"{VIDEO_ID}.wav", duration=0.25)
        return {
            "id": VIDEO_ID,
            "title": "The Song",
            "artist": "The Band",
            "duration": 0.25,
            "audio_path": str(wav),
        }

    def separate(**kwargs):
        return {"vocals_path": kwargs["audio_path"], "instrumental_path": kwargs["audio_path"]}

    def fetch_lyrics(title, artist, duration=None):
        state.lyrics_asked.append((title, artist))
        return {"source": "lrclib", "synced": True, "lines": [{"text": "la", "start": 1, "end": 2}]}

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", extract)
    monkeypatch.setattr(main_mod.separator, "separate_stems", separate)
    monkeypatch.setattr(main_mod.lyrics_service, "fetch_lyrics", fetch_lyrics)
    monkeypatch.setattr(
        pipeline,
        "sync_lyrics",
        lambda vocals, lines, **kw: SyncResult(lines=lines, report={}, lyric_timing="line"),
    )
    monkeypatch.setattr(pipeline, "analyze_project_stems", lambda *a, **k: [])
    monkeypatch.setattr(pipeline, "assign_voice_parts", lambda path, lines: (lines, _NoVoices()))
    monkeypatch.setattr(main_mod.audio_mixer, "mix_and_shift", lambda **kw: kw["instrumental_path"])
    return state


class _NoVoices:
    def report(self):
        return None


def _start(client, **fields) -> dict:
    """Starts the song and returns it as the pipeline left it (the test client runs the
    pipeline before it answers)."""
    active_cancellations.pop(VIDEO_ID, None)
    res = client.post("/api/process", json={"url_or_id": URL, **fields})
    assert res.status_code == 200, res.text
    return find_project(res.json()["project_id"])


def _words(song: dict) -> list[str]:
    return [line["text"] for line in song["lines"]]


def test_a_failed_song_started_again_is_made_with_the_lyrics_pasted_for_it(client, studio):
    studio.download_fails = True
    failed = _start(client, custom_lyrics=PASTED)
    assert failed["status"] == "error"
    assert failed["intake_lyrics"] == PASTED

    studio.download_fails = False
    song = _start(client, retry=True)

    assert song["status"] == "ready", song.get("error")
    assert song["lyric_source"] == "custom"
    assert _words(song) == PASTED.split("\n")
    assert studio.lyrics_asked == []


def test_a_finished_song_no_longer_carries_the_pasted_text(client, studio):
    song = _start(client, custom_lyrics=PASTED)

    assert song["status"] == "ready", song.get("error")
    assert _words(song) == PASTED.split("\n")
    assert "intake_lyrics" not in song


def test_the_lyrics_survive_a_second_failure(client, studio):
    studio.download_fails = True
    _start(client, custom_lyrics=PASTED)

    failed_again = _start(client, retry=True)

    assert failed_again["status"] == "error"
    assert failed_again["intake_lyrics"] == PASTED


def test_lyrics_sent_with_the_retry_replace_the_ones_kept(client, studio):
    studio.download_fails = True
    _start(client, custom_lyrics=PASTED)

    studio.download_fails = False
    song = _start(client, retry=True, custom_lyrics=OTHER)

    assert _words(song) == OTHER.split("\n")


def test_the_link_pasted_again_without_lyrics_looks_them_up(client, studio):
    """Only "Try again" brings the old lyrics back: a new request for the song is taken as
    it is asked."""
    studio.download_fails = True
    _start(client, custom_lyrics=PASTED)

    studio.download_fails = False
    song = _start(client)

    assert song["status"] == "ready", song.get("error")
    assert song["lyric_source"] == "lrclib"
    assert studio.lyrics_asked == [("The Song", "The Band")]
    assert "intake_lyrics" not in song


def test_a_retry_of_a_song_started_without_lyrics_looks_them_up(client, studio):
    studio.download_fails = True
    failed = _start(client)
    assert "intake_lyrics" not in failed

    studio.download_fails = False
    song = _start(client, retry=True)

    assert song["lyric_source"] == "lrclib"


def test_only_spaces_are_not_lyrics_to_keep(client, studio):
    studio.download_fails = True
    failed = _start(client, custom_lyrics="  \n ")

    assert "intake_lyrics" not in failed


def test_an_upload_sent_with_lyrics_keeps_them_too(client, monkeypatch):
    """An upload is sent again rather than started again, but one that turns out to be an
    album can still be made as one song with its lyrics."""
    started: list[tuple] = []
    monkeypatch.setattr(main_mod, "run_local_pipeline", lambda *args: started.append(args))
    wav = generate_sine_wave_wav(main_mod.DOWNLOADS_DIR / "upload-source.wav", duration=0.25)

    res = client.post(
        "/api/upload-track",
        files={"file": ("song.wav", wav.read_bytes(), "audio/wav")},
        data={"custom_lyrics": PASTED},
    )

    assert res.status_code == 200, res.text
    song = find_project(res.json()["project_id"])
    assert song["intake_lyrics"] == PASTED
    assert started[0][-1] == PASTED
