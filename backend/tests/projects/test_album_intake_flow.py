"""A pasted whole album rests as a list of its songs; each song picked from it becomes a song
of its own, cut out of the album; and the whole recording can still be made one song.

The download, separation, lyric lookup, alignment and mix are stand-ins; the album is a
synthetic recording (``helpers/albums``) cut with the real FFmpeg."""

import shutil

import pytest
import soundfile as sf

import backend.main as main_mod
import backend.pipeline as pipeline
from backend.main import active_cancellations, projects
from backend.project_store import find_project, save_projects
from backend.services import album_audio
from backend.services.downloader import AlbumDetected
from backend.services.lyric_sync import SyncResult
from backend.tests.helpers.albums import album_info, write_album

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="needs FFmpeg")

VIDEO_ID = "AlbumVid001"
URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"
LENGTHS = [60.0, 70.0, 55.0]
CHAPTERS = [(0.0, "1. First Song"), (61.0, "2. Second Song"), (133.0, "3. Third Song")]


@pytest.fixture
def studio(monkeypatch):
    """Stand-ins for everything but the album's audio; records what each was asked."""
    state = type("State", (), {})()
    state.extract_calls = []
    state.album_downloads = []
    state.lyrics_asked = []
    state.duration, state.middles = None, None

    def extract(url, progress_hook=None, **kwargs):
        state.extract_calls.append((url, kwargs))
        if kwargs.get("detect_album", True):
            raise AlbumDetected(album_info(VIDEO_ID, state.duration, CHAPTERS))
        wav = main_mod.DOWNLOADS_DIR / f"{VIDEO_ID}.wav"
        write_album(wav, LENGTHS)
        return {
            "id": VIDEO_ID,
            "title": "The Record",
            "artist": "The Band",
            "duration": state.duration,
            "audio_path": str(wav),
        }

    def download_album(url, stem, progress_hook=None):
        state.album_downloads.append((url, stem))
        path = main_mod.DOWNLOADS_DIR / f"{stem}.album.wav"
        state.duration, state.middles = write_album(path, LENGTHS)
        thumb = main_mod.DOWNLOADS_DIR / f"{stem}.jpg"
        thumb.write_bytes(b"\xff\xd8 cover")
        return {"audio_path": str(path), "thumbnail_path": str(thumb)}

    def separate(**kwargs):
        return {"vocals_path": kwargs["audio_path"], "instrumental_path": kwargs["audio_path"]}

    def fetch_lyrics(title, artist, duration=None):
        state.lyrics_asked.append((title, artist, round(duration or 0)))
        return {"source": "lrclib", "synced": True, "lines": [{"text": "la", "start": 1, "end": 2}]}

    monkeypatch.setattr(main_mod.downloader, "extract_info_and_download", extract)
    monkeypatch.setattr(main_mod.downloader, "download_album_audio", download_album)
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
    # The album recording is small, so the length a whole album needs is lowered for it
    write_album(main_mod.DOWNLOADS_DIR / "probe.wav", LENGTHS)
    state.duration = sf.info(str(main_mod.DOWNLOADS_DIR / "probe.wav")).duration
    return state


class _NoVoices:
    def report(self):
        return None


def _paste(client) -> str:
    res = client.post("/api/process", json={"url_or_id": URL})
    assert res.status_code == 200, res.text
    return res.json()["project_id"]


def test_a_pasted_album_rests_as_a_list_of_its_songs(client, studio):
    album_id = _paste(client)

    proj = find_project(album_id)
    assert proj["status"] == "album", proj.get("error")
    assert proj["title"] == "The Record" and proj["artist"] == "The Band"
    assert proj["thumbnail_url"] == f"/static/downloads/{VIDEO_ID}.jpg"
    assert studio.album_downloads == [(URL, VIDEO_ID)]
    album = proj["album"]
    assert album["source"] == "chapters"
    assert [t["title"] for t in album["tracks"]] == ["First Song", "Second Song", "Third Song"]
    # The chapter times (a second off) were moved into the pauses
    starts = [t["start"] for t in album["tracks"][1:]]
    assert starts == pytest.approx(studio.middles, abs=0.75)

    listing = client.get(f"/api/project/{album_id}/album").json()
    assert listing["whole_allowed"] is True
    assert [t["project_id"] for t in listing["tracks"]] == [None, None, None]


def test_pasting_the_album_again_opens_its_list_without_downloading_it_again(client, studio):
    album_id = _paste(client)
    res = client.post("/api/process", json={"url_or_id": URL})
    assert res.json() == {"project_id": album_id, "status": "album"}
    assert len(studio.album_downloads) == 1


def test_picked_songs_become_songs_of_their_own_cut_out_of_the_album(client, studio):
    album_id = _paste(client)

    res = client.post(
        f"/api/project/{album_id}/album/songs",
        json={"songs": [{"number": 2}, {"number": 3, "title": "Third Song (Renamed)"}]},
    )
    assert res.status_code == 200, res.text
    started = res.json()["projects"]
    assert [(s["project_id"], s["number"]) for s in started] == [
        (f"{VIDEO_ID}-t02", 2),
        (f"{VIDEO_ID}-t03", 3),
    ]

    second = find_project(f"{VIDEO_ID}-t02")
    assert second["status"] == "ready", second.get("error")
    assert second["title"] == "Second Song" and second["artist"] == "The Band"
    assert second["album_track"]["album_id"] == album_id
    assert second["thumbnail_url"] == f"/static/downloads/{VIDEO_ID}.jpg"
    cut = sf.info(second["audio_path"])
    track = find_project(album_id)["album"]["tracks"][1]
    assert cut.duration == pytest.approx(track["end"] - track["start"], abs=0.05)
    assert second["duration"] == pytest.approx(cut.duration, abs=0.05)
    # The lyrics were looked up by the song's own name and length
    assert ("Second Song", "The Band", round(cut.duration)) in studio.lyrics_asked
    assert find_project(f"{VIDEO_ID}-t03")["title"] == "Third Song (Renamed)"
    # The album was downloaded once, for the list; the songs were cut from that copy
    assert len(studio.album_downloads) == 1

    listing = client.get(f"/api/project/{album_id}/album").json()
    assert [t["project_status"] for t in listing["tracks"]] == [None, "ready", "ready"]
    assert listing["tracks"][2]["title"] == "Third Song (Renamed)"


def test_a_song_made_already_is_left_alone_and_a_failed_one_starts_again(client, studio):
    album_id = _paste(client)
    client.post(f"/api/project/{album_id}/album/songs", json={"songs": [{"number": 1}]})
    first = f"{VIDEO_ID}-t01"
    made_at = find_project(first)["created_at"]

    again = client.post(f"/api/project/{album_id}/album/songs", json={"songs": [{"number": 1}]})
    assert again.json()["projects"] == [{"project_id": first, "number": 1, "status": "ready"}]
    assert find_project(first)["created_at"] == made_at

    find_project(first)["status"] = "error"
    retried = client.post(f"/api/project/{album_id}/album/songs", json={"songs": [{"number": 1}]})
    assert retried.json()["projects"][0]["status"] == "queued"
    assert find_project(first)["status"] == "ready"


def test_a_song_is_cut_again_from_a_fresh_download_when_the_album_copy_is_gone(client, studio):
    album_id = _paste(client)
    (main_mod.DOWNLOADS_DIR / f"{VIDEO_ID}.album.wav").unlink()
    client.post(f"/api/project/{album_id}/album/songs", json={"songs": [{"number": 2}]})
    assert find_project(f"{VIDEO_ID}-t02")["status"] == "ready"
    assert len(studio.album_downloads) == 2


def test_unknown_songs_and_songs_that_are_not_albums_are_refused(client, studio):
    album_id = _paste(client)
    res = client.post(f"/api/project/{album_id}/album/songs", json={"songs": [{"number": 9}]})
    assert res.status_code == 400
    assert "no song 9" in res.json()["detail"]

    projects["plain_song"] = {"id": "plain_song", "status": "ready", "lines": []}
    save_projects()
    for path in ("/api/project/plain_song/album", "/api/project/plain_song/album/songs"):
        call = client.get if path.endswith("album") else client.post
        kwargs = {} if path.endswith("album") else {"json": {"songs": [{"number": 1}]}}
        assert call(path, **kwargs).status_code == 409


def test_the_whole_recording_can_still_be_made_one_song(client, studio):
    album_id = _paste(client)

    res = client.post(f"/api/project/{album_id}/album/whole", json={})
    assert res.json() == {"project_id": album_id, "status": "queued"}
    proj = find_project(album_id)
    assert proj["status"] == "ready", proj.get("error")
    assert "album" not in proj and proj["album_whole"] is True
    assert studio.extract_calls[-1] == (URL, {"detect_album": False})
    # The compressed album copy is not kept for a song made from the whole recording
    assert not (main_mod.DOWNLOADS_DIR / f"{VIDEO_ID}.album.wav").exists()

    # Tried again, it is still one song
    find_project(album_id)["status"] = "error"
    active_cancellations.pop(album_id, None)
    client.post("/api/process", json={"url_or_id": URL})
    assert studio.extract_calls[-1] == (URL, {"detect_album": False})


def test_a_recording_too_long_for_one_song_cannot_be_made_one(client, studio, monkeypatch):
    from backend import config

    album_id = _paste(client)
    monkeypatch.setattr(config, "MAX_SONG_MINUTES", 1)
    assert client.get(f"/api/project/{album_id}/album").json()["whole_allowed"] is False
    res = client.post(f"/api/project/{album_id}/album/whole", json={})
    assert res.status_code == 400
    assert "Pick its songs instead" in res.json()["detail"]


def test_an_album_longer_than_the_album_limit_is_refused(client, studio, monkeypatch):
    from backend import config

    monkeypatch.setattr(config, "MAX_ALBUM_MINUTES", 1)
    album_id = _paste(client)
    proj = find_project(album_id)
    assert proj["status"] == "error"
    assert "longest album this server downloads is 1 minutes" in proj["error"]
    assert studio.album_downloads == []


def _upload(pid: str, lengths: list[float]) -> None:
    wav = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
    write_album(wav, lengths, rate=44100)
    projects[pid] = {"id": pid, "track_id": pid, "status": "queued", "lines": []}
    save_projects()
    active_cancellations.pop(pid, None)
    pipeline.run_local_pipeline(pid, str(wav), title="The Record", artist="The Band")


def test_an_uploaded_album_is_split_at_its_pauses_and_asks_for_names(studio, monkeypatch):
    monkeypatch.setattr(pipeline, "ALBUM_MIN_SECONDS", 120)
    monkeypatch.setattr(album_audio, "SONG_MIN_SEC", 30.0)
    monkeypatch.setattr("backend.services.album_tracks.find_catalog_album", lambda *a, **k: None)
    _upload("local_album1", [50.0, 45.0, 40.0])

    proj = find_project("local_album1")
    assert proj["status"] == "album", proj.get("error")
    album = proj["album"]
    assert album["kind"] == "upload" and album["source"] == "pauses"
    assert [(t["title"], t["named"]) for t in album["tracks"]] == [
        ("Track 1", False),
        ("Track 2", False),
        ("Track 3", False),
    ]
    assert album["audio_file"] == "local_album1.wav"


def test_a_long_upload_with_no_songs_to_tell_apart_is_one_song(studio, monkeypatch):
    monkeypatch.setattr(pipeline, "ALBUM_MIN_SECONDS", 60)
    monkeypatch.setattr("backend.services.album_tracks.find_catalog_album", lambda *a, **k: None)
    _upload("local_long1", [150.0])
    proj = find_project("local_long1")
    assert proj["status"] == "ready", proj.get("error")
    assert "album" not in proj


PASTED = "Line one of mine\nLine two of mine"


def test_an_album_made_one_song_is_made_with_the_lyrics_pasted_with_its_link(client, studio):
    res = client.post("/api/process", json={"url_or_id": URL, "custom_lyrics": PASTED})
    album_id = res.json()["project_id"]
    assert find_project(album_id)["status"] == "album"

    client.post(f"/api/project/{album_id}/album/whole", json={})

    proj = find_project(album_id)
    assert proj["status"] == "ready", proj.get("error")
    assert proj["lyric_source"] == "custom"
    assert [line["text"] for line in proj["lines"]] == PASTED.split("\n")
    assert studio.lyrics_asked == []
    assert "intake_lyrics" not in proj


def test_an_uploaded_album_made_one_song_is_made_with_the_lyrics_sent_with_it(
    client, studio, monkeypatch
):
    monkeypatch.setattr(pipeline, "ALBUM_MIN_SECONDS", 120)
    monkeypatch.setattr(album_audio, "SONG_MIN_SEC", 30.0)
    monkeypatch.setattr("backend.services.album_tracks.find_catalog_album", lambda *a, **k: None)
    pid = "local_album2"
    wav = main_mod.DOWNLOADS_DIR / f"{pid}.wav"
    write_album(wav, [50.0, 45.0, 40.0], rate=44100)
    # As POST /api/upload-track leaves an upload that was sent with lyrics
    projects[pid] = {
        "id": pid,
        "track_id": pid,
        "status": "queued",
        "lines": [],
        "intake_lyrics": PASTED,
    }
    save_projects()
    active_cancellations.pop(pid, None)
    pipeline.run_local_pipeline(pid, str(wav), "The Record", "The Band", PASTED)
    assert find_project(pid)["status"] == "album"

    client.post(f"/api/project/{pid}/album/whole", json={})

    proj = find_project(pid)
    assert proj["status"] == "ready", proj.get("error")
    assert proj["lyric_source"] == "custom"
    assert [line["text"] for line in proj["lines"]] == PASTED.split("\n")
    assert "intake_lyrics" not in proj
