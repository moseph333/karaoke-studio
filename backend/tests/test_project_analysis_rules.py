"""When each route and job detects chords or the vocal range, which key it uses and how it
builds the YouTube kit, pinned per site: the chord and vocal-range routes, the ASS and chord
sheet exports, the render and the lyric and metadata edits."""

import pytest

import backend.main as main_mod
from backend.main import projects
from backend.render_worker import run_video_render
from backend.schemas import RenderRequest

CHORDS = [
    {"start": 0.0, "end": 2.0, "chord": "C", "confidence": 0.9},
    {"start": 2.0, "end": 4.0, "chord": "G", "confidence": 0.9},
]
RANGE = {
    "is_voiced": True,
    "lowest_note": "A2",
    "highest_note": "E4",
    "estimated_key": "A Minor",
    "key_confidence": 0.8,
}
LINES = [
    {
        "id": 1,
        "text": "Hello there",
        "start_time": 0.5,
        "end_time": 2.5,
        "words": [
            {"word": "Hello", "start_time": 0.5, "end_time": 1.2},
            {"word": "there", "start_time": 1.3, "end_time": 2.5},
        ],
    }
]


class FakeDetector:
    def __init__(self):
        self.calls: list[str] = []
        self.error: Exception | None = None

    def detect_chords(self, audio_path):
        self.calls.append(str(audio_path))
        if self.error:
            raise self.error
        return [dict(c) for c in CHORDS]


class FakeAnalyzer:
    def __init__(self):
        self.calls: list[str] = []

    def analyze_vocals(self, path):
        self.calls.append(str(path))
        return dict(RANGE)

    def recommend_key(self, song_vocal_range, target_voice_preset, **_):
        return {
            "recommended_semitones": -2,
            "projected_key": "G Minor",
            "projected_low_note": "G2",
            "projected_high_note": "D4",
            "cost": 0.1,
            "is_in_range": True,
            "target_preset": target_voice_preset,
            "original_key": song_vocal_range["estimated_key"],
        }


@pytest.fixture
def detector(monkeypatch):
    fake = FakeDetector()
    monkeypatch.setattr(main_mod, "chord_detector", fake, raising=False)
    return fake


@pytest.fixture
def analyzer(monkeypatch):
    fake = FakeAnalyzer()
    monkeypatch.setattr(main_mod, "vocal_analyzer", fake, raising=False)
    return fake


@pytest.fixture
def song(tmp_path):
    """A ready song with an instrumental, a vocal stem and the original audio on disk, and no
    chords or vocal range yet; the files by name."""
    files = {}
    for name in ("instrumental", "vocals", "audio"):
        files[name] = tmp_path / f"{name}.wav"
        files[name].write_bytes(b"RIFF" + b"\x00" * 64)
    projects["song1"] = {
        "id": "song1",
        "track_id": "song1",
        "title": "Rules",
        "artist": "Table",
        "status": "ready",
        "progress": 100,
        "lines": [dict(line) for line in LINES],
        "semitones": 0,
        "guide_volume": 0.0,
        "instrumental_path": str(files["instrumental"]),
        "vocals_path": str(files["vocals"]),
        "audio_path": str(files["audio"]),
        "chords": None,
    }
    return files


@pytest.fixture
def ass_calls(monkeypatch):
    """The keyword arguments of every ASS generation, which still writes the real file."""
    calls: list[dict] = []
    renderer = main_mod.video_renderer
    real_content, real_subtitles = renderer.generate_ass_content, renderer.generate_ass_subtitles

    def content(**kwargs):
        calls.append(kwargs)
        return real_content(**kwargs)

    def subtitles(**kwargs):
        calls.append(kwargs)
        return real_subtitles(**kwargs)

    monkeypatch.setattr(renderer, "generate_ass_content", content)
    monkeypatch.setattr(renderer, "generate_ass_subtitles", subtitles)
    return calls


@pytest.fixture
def kit_calls(monkeypatch):
    calls: list[dict] = []

    def kit(**kwargs):
        calls.append(kwargs)
        return {"key_note": kwargs["semitones"], "guide": kwargs["has_guide_vocal"]}

    monkeypatch.setattr(main_mod.youtube_service, "generate_youtube_package", kit)
    return calls


@pytest.fixture
def render_stubs(monkeypatch, tmp_path):
    """The mix and the FFmpeg render are stand-ins; the subtitles are generated for real."""
    monkeypatch.setattr(
        main_mod.audio_mixer, "mix_and_shift", lambda **kw: str(tmp_path / "mix.wav")
    )
    monkeypatch.setattr(main_mod.video_renderer, "render_video", lambda *a, **kw: None)


# --- Chords -----------------------------------------------------------------------------


def test_chords_route_detects_from_the_instrumental_and_stores_them(client, song, detector):
    files = song
    res = client.get("/api/project/song1/chords")

    assert res.status_code == 200
    assert res.json()["detected"] is True
    assert [c["chord"] for c in res.json()["chords"]] == ["C", "G"]
    assert detector.calls == [str(files["instrumental"])]
    assert [c["chord"] for c in projects["song1"]["chords"]] == ["C", "G"]


def test_chords_route_falls_back_to_the_original_audio(client, song, detector):
    files = song
    files["instrumental"].unlink()

    assert client.get("/api/project/song1/chords").status_code == 200
    assert detector.calls == [str(files["audio"])]


def test_chords_route_without_any_audio_is_a_400(client, song, detector):
    files = song
    files["instrumental"].unlink()
    files["audio"].write_bytes(b"")

    res = client.get("/api/project/song1/chords")

    assert res.status_code == 400
    assert "instrumental stem missing" in res.json()["detail"]
    assert detector.calls == []


@pytest.mark.parametrize("stored", [[], CHORDS[:1]])
def test_chords_route_returns_stored_chords_even_an_empty_list(client, song, detector, stored):
    projects["song1"]["chords"] = list(stored)

    res = client.get("/api/project/song1/chords")

    assert res.status_code == 200
    assert len(res.json()["chords"]) == len(stored)
    assert detector.calls == []


def test_chords_route_reports_a_detection_failure_as_a_500(client, song, detector):
    detector.error = RuntimeError("chroma exploded")

    res = client.get("/api/project/song1/chords")

    assert res.status_code == 500
    assert "Failed to detect chords" in res.json()["detail"]
    assert projects["song1"]["chords"] is None


def test_redetect_overwrites_stored_chords(client, song, detector):
    projects["song1"]["chords"] = [{"start": 0.0, "end": 9.0, "chord": "Em"}]

    res = client.post("/api/project/song1/chords/detect")

    assert res.status_code == 200
    assert [c["chord"] for c in projects["song1"]["chords"]] == ["C", "G"]


def test_redetect_is_refused_while_the_song_is_separating(client, song, detector):
    projects["song1"]["status"] = "separating"

    res = client.post("/api/project/song1/chords/detect")

    assert res.status_code == 400
    assert detector.calls == []


def test_ass_export_with_chords_detects_and_stores_them(client, song, detector):
    res = client.get("/api/project/song1/export/ass", params={"include_chords": True})

    assert res.status_code == 200
    assert "Chord,,0,0,0,,{\\an8}C" in res.text
    assert [c["chord"] for c in projects["song1"]["chords"]] == ["C", "G"]


def test_ass_export_with_a_failing_detector_exports_without_chords(client, song, detector):
    detector.error = RuntimeError("no chroma")

    res = client.get("/api/project/song1/export/ass", params={"include_chords": True})

    assert res.status_code == 200
    assert ",Chord,," not in res.text
    assert projects["song1"]["chords"] is None


def test_ass_export_without_chords_never_detects(client, song, detector):
    res = client.get("/api/project/song1/export/ass")

    assert res.status_code == 200
    assert detector.calls == []
    assert projects["song1"]["chords"] is None


def test_ass_export_is_refused_while_the_lyrics_are_not_ready(client, song, detector):
    projects["song1"].update(status="aligning", lines=[])

    res = client.get("/api/project/song1/export/ass")

    assert res.status_code == 400
    assert "not ready" in res.json()["detail"]


def test_chord_sheet_detects_from_the_instrumental_and_stores_them(client, song, detector):
    files = song
    res = client.get("/api/project/song1/export/chord-sheet")

    assert res.status_code == 200
    assert detector.calls == [str(files["instrumental"])]
    assert [c["chord"] for c in projects["song1"]["chords"]] == ["C", "G"]


def test_chord_sheet_without_any_audio_exports_the_lyrics_alone(client, song, detector):
    files = song
    for path in files.values():
        path.unlink()

    res = client.get("/api/project/song1/export/chord-sheet")

    assert res.status_code == 200
    assert "Hello there" in res.text
    assert detector.calls == []


def test_render_with_chords_detects_them_for_a_song_without_any(song, detector, render_stubs):
    run_video_render("song1", RenderRequest(include_chords=True))

    assert projects["song1"]["render_status"] == "completed"
    assert [c["chord"] for c in projects["song1"]["chords"]] == ["C", "G"]


def test_render_keeps_stored_chords(song, detector, render_stubs, ass_calls):
    projects["song1"]["chords"] = [{"start": 0.0, "end": 9.0, "chord": "Em"}]

    run_video_render("song1", RenderRequest(include_chords=True))

    assert detector.calls == []
    assert [c["chord"] for c in ass_calls[-1]["chords"]] == ["Em"]


def test_render_without_chords_never_detects(song, detector, render_stubs, ass_calls):
    run_video_render("song1", RenderRequest(include_chords=False))

    assert detector.calls == []
    assert ass_calls[-1]["chords"] == []


# --- Vocal range ------------------------------------------------------------------------


def test_vocal_range_route_returns_the_stored_range(client, song, analyzer):
    projects["song1"]["vocal_range"] = dict(RANGE, estimated_key="E Major")

    res = client.get("/api/project/song1/vocal-range")

    assert res.json()["estimated_key"] == "E Major"
    assert analyzer.calls == []


@pytest.mark.parametrize("stored", [None, {}])
def test_vocal_range_route_analyses_the_vocals_when_missing(client, song, analyzer, stored):
    files = song
    projects["song1"]["vocal_range"] = stored

    res = client.get("/api/project/song1/vocal-range")

    assert res.status_code == 200
    assert res.json()["estimated_key"] == "A Minor"
    assert analyzer.calls == [str(files["vocals"])]
    assert projects["song1"]["vocal_range"]["estimated_key"] == "A Minor"


def test_vocal_range_route_without_a_vocal_stem_is_a_400(client, song, analyzer):
    files = song
    files["vocals"].unlink()

    res = client.get("/api/project/song1/vocal-range")

    assert res.status_code == 400
    assert "vocal stem missing" in res.json()["detail"]


def test_reanalysis_overwrites_the_stored_range(client, song, analyzer):
    projects["song1"]["vocal_range"] = dict(RANGE, estimated_key="E Major")

    res = client.post("/api/project/song1/vocal-range")

    assert res.json()["estimated_key"] == "A Minor"
    assert projects["song1"]["vocal_range"]["estimated_key"] == "A Minor"


def test_key_recommendation_analyses_a_missing_range_first(client, song, analyzer):
    res = client.post("/api/project/song1/recommend-key", json={"target_voice_preset": "baritone"})

    assert res.status_code == 200
    assert res.json()["original_key"] == "A Minor"
    assert projects["song1"]["vocal_range"]["estimated_key"] == "A Minor"


def test_key_recommendation_without_range_or_stem_is_a_400(client, song, analyzer):
    files = song
    files["vocals"].unlink()

    res = client.post("/api/project/song1/recommend-key", json={"target_voice_preset": "baritone"})

    assert res.status_code == 400


# --- The song's key ---------------------------------------------------------------------


def test_chords_route_reports_and_transposes_in_the_vocal_range_key(client, song, detector):
    projects["song1"].update(chords=[dict(c) for c in CHORDS], vocal_range=dict(RANGE))

    res = client.get("/api/project/song1/chords", params={"semitones": 1})

    assert res.json()["estimated_key"] == "A Minor"
    assert [c["chord"] for c in res.json()["chords"]] == ["Db", "Ab"]


@pytest.mark.parametrize(
    "fields, key",
    [
        ({"vocal_range": {"estimated_key": "D Major"}}, "D Major"),
        ({"estimated_key": "F Major"}, "F Major"),
        ({}, None),
    ],
)
def test_ass_export_passes_the_song_key(client, song, ass_calls, fields, key):
    projects["song1"].update(chords=[], **fields)

    client.get("/api/project/song1/export/ass")

    assert ass_calls[-1]["key"] == key


@pytest.mark.parametrize(
    "fields, key",
    [
        ({"vocal_range": {"estimated_key": "D Major"}}, "D Major"),
        ({"estimated_key": "F Major"}, "F Major"),
    ],
)
def test_render_passes_the_song_key(song, render_stubs, ass_calls, fields, key):
    projects["song1"].update(chords=[], **fields)

    run_video_render("song1", RenderRequest())

    assert ass_calls[-1]["key"] == key


@pytest.mark.parametrize(
    "fields, header",
    [
        ({"vocal_range": {"estimated_key": "D Major"}}, "**Key:** D Major"),
        ({"estimated_key": "F Major"}, "**Key:** F Major"),
    ],
)
def test_chord_sheet_header_names_the_song_key(client, song, fields, header):
    projects["song1"].update(chords=[dict(c) for c in CHORDS], **fields)

    res = client.get("/api/project/song1/export/chord-sheet")

    assert header in res.text


# --- YouTube kit ------------------------------------------------------------------------


def test_render_builds_the_youtube_kit_from_the_render_settings(song, render_stubs, kit_calls):
    projects["song1"]["chords"] = []

    run_video_render("song1", RenderRequest(semitones=2, guide_volume=0.4))

    assert kit_calls[-1]["semitones"] == 2
    assert kit_calls[-1]["has_guide_vocal"] is True
    assert projects["song1"]["youtube_package"] == {"key_note": 2, "guide": True}


@pytest.mark.parametrize(
    "edit",
    [
        lambda client: client.post(
            "/api/project/song1/lyrics", json={"lines": [dict(line) for line in LINES]}
        ),
        lambda client: client.post("/api/project/song1/metadata", json={"title": "New title"}),
    ],
    ids=["lyrics", "metadata"],
)
def test_edits_rebuild_a_stored_youtube_kit_from_the_song(client, song, kit_calls, edit):
    projects["song1"].update(youtube_package={"stale": True}, semitones=-3, guide_volume=0.5)

    assert edit(client).status_code == 200

    assert kit_calls[-1]["semitones"] == -3
    assert kit_calls[-1]["has_guide_vocal"] is True
    assert projects["song1"]["youtube_package"] == {"key_note": -3, "guide": True}


def test_edits_leave_a_song_without_a_youtube_kit_alone(client, song, kit_calls):
    client.post("/api/project/song1/lyrics", json={"lines": [dict(line) for line in LINES]})

    assert kit_calls == []
    assert "youtube_package" not in projects["song1"]


def test_youtube_kit_route_builds_from_the_song_before_any_render(client, song, kit_calls):
    projects["song1"].update(semitones=4, guide_volume=0.0)

    res = client.get("/api/project/song1/youtube-package")

    assert res.json() == {"key_note": 4, "guide": False}
