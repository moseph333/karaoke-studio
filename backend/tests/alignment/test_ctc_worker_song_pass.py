"""CTC worker protocol version 2: one emission for the whole song, stitched from chunks, the
line windows aligned on slices of it, and the song pass that places every line in order.

The model is faked; forced alignment itself runs through torchaudio when it is installed
(it is in CI, from backend/requirements.txt) on hand-made emissions, so no weights are
needed."""

import json

import pytest

from backend.workers import ctc_align_worker as worker

torch = pytest.importorskip("torch")
functional = pytest.importorskip("torchaudio.functional")

LETTERS = worker.NULL_LETTERS + "'"
DICTIONARY = {ch: i + 1 for i, ch in enumerate(LETTERS)}  # 0 is the blank
STAR = len(DICTIONARY) + 1
LABELS = STAR + 1
SPF = worker.FRAME_SAMPLES / worker.SAMPLE_RATE


def _emission(frames: int, letters: dict[int, str]) -> "torch.Tensor":
    """Log-probabilities that are blank everywhere except the given letters at the given
    frames; the star column is free (log-prob 0), as in MMS_FA with_star."""
    probs = torch.full((frames, LABELS), 1e-4)
    probs[:, 0] = 1.0
    for frame, ch in letters.items():
        probs[frame, :] = 1e-4
        probs[frame, DICTIONARY[ch]] = 1.0
    emission = torch.log(probs / probs.sum(dim=1, keepdim=True))
    emission[:, STAR] = 0.0
    return emission


def _spell(at: int, word: str) -> dict[int, str]:
    return {at + 3 * i: ch for i, ch in enumerate(word)}


@pytest.mark.parametrize(
    "samples",
    [0, 399, 400, 16000 * 5, 16000 * 20, 16000 * 20 + 320 * 3 + 17, 16000 * 61, 16000 * 245],
)
def test_chunks_cover_every_frame_once_and_start_on_a_frame(samples):
    plan = worker.chunk_plan(samples)
    kept = [f for _, _, lo, hi in plan for f in range(lo, hi)]
    assert kept == list(range(worker.emission_frames(samples)))
    for first, end, lo, hi in plan:
        assert first % worker.FRAME_SAMPLES == 0
        assert 0 <= first < end <= samples
        assert hi - lo <= worker.CHUNK_CORE_FRAMES
        offset = first // worker.FRAME_SAMPLES
        # the chunk's own frames reach its last kept frame (at most one short at the end)
        assert worker.emission_frames(end - first) + offset >= hi - 1
        assert offset <= lo


class _FrameModel:
    """A stand-in for MMS_FA: emits one frame per 320 samples whose first column is the song
    frame it covers (the waveform holds each sample's index), so stitching can be checked."""

    def __init__(self):
        self.calls = []

    def __call__(self, segment):
        frames = worker.emission_frames(int(segment.shape[1]))
        self.calls.append(int(segment.shape[1]))
        first = segment[0, 0].item()
        index = (first + torch.arange(frames) * worker.FRAME_SAMPLES) / worker.FRAME_SAMPLES
        return index.unsqueeze(1).repeat(1, 3).unsqueeze(0), None


def test_the_song_emission_is_stitched_by_frame_index():
    samples = 16000 * 47 + 123
    waveform = torch.arange(samples, dtype=torch.float64).unsqueeze(0)
    model = _FrameModel()
    progress = []
    emission, chunks = worker.song_emission(
        model, waveform, torch, lambda d, t: progress.append((d, t))
    )
    assert chunks == len(worker.chunk_plan(samples)) == 3
    assert emission.shape[0] == worker.emission_frames(samples)
    assert torch.equal(emission[:, 0], torch.arange(emission.shape[0], dtype=torch.float64))
    assert progress == [(1, 3), (2, 3), (3, 3)]
    # every model run is a chunk with context, never the whole song
    assert (
        max(model.calls) <= (worker.CHUNK_CORE_FRAMES + 2 * worker.CHUNK_CONTEXT_FRAMES) * 320 + 80
    )


def test_too_short_audio_has_no_emission():
    with pytest.raises(ValueError):
        worker.song_emission(_FrameModel(), torch.zeros(1, 100), torch)


def test_the_song_pass_places_each_line_in_order():
    letters = {**_spell(50, "hello"), **_spell(120, "world"), **_spell(300, "again")}
    emission = _emission(400, letters)
    lines = [
        {"index": 0, "words": ["hello", "world"]},
        {"index": 5, "words": ["", ""]},  # nothing alignable: no anchor, no star pair
        {"index": 7, "words": ["", "again"]},
    ]
    groups, placed = worker.song_groups(lines, DICTIONARY, STAR)
    assert groups[0] == [STAR] and groups[-1] == [STAR]
    assert [entry[0]["index"] for entry in placed] == [0, 7]
    assert sum(1 for g in groups if g == [STAR]) == 3

    result = worker.align_song(emission, lines, DICTIONARY, STAR, torch, functional)
    assert result["status"] == "ok"
    first, second = result["lines"]
    assert first["index"] == 0 and second["index"] == 7
    assert first["start"] == pytest.approx(50 * SPF, abs=0.03)
    assert first["words"][1]["start"] == pytest.approx(120 * SPF, abs=0.03)
    assert second["words"][0] is None
    assert second["start"] == pytest.approx(300 * SPF, abs=0.03)
    assert first["line_score"] > 0.9
    # scrambled letters fit this emission far worse than the lyrics
    assert result["null_score"] is not None and result["null_score"] < 0.5


def test_the_song_pass_is_skipped_rather_than_forced():
    emission = _emission(20, _spell(2, "abc"))
    long_text = [{"index": 0, "words": ["supercalifragilistic"]}]
    skipped = worker.align_song(emission, long_text, DICTIONARY, STAR, torch, functional)
    assert (skipped["status"], skipped["error"]) == ("skipped", "too little audio for the words")
    empty = worker.align_song(
        emission, [{"index": 0, "words": [""]}], DICTIONARY, STAR, torch, None
    )
    assert empty["status"] == "skipped"


def test_a_song_too_large_for_one_pass_is_skipped(monkeypatch):
    monkeypatch.setattr(worker, "MAX_DP_CELLS", 100)
    emission = _emission(200, _spell(10, "hello"))
    result = worker.align_song(
        emission, [{"index": 0, "words": ["hello"]}], DICTIONARY, STAR, torch, functional
    )
    assert (result["status"], result["error"]) == ("skipped", "too long to align in one pass")


def test_line_windows_are_cut_from_the_song_emission():
    emission = _emission(400, {**_spell(50, "hello"), **_spell(300, "again")})
    lines = [
        {"index": 0, "window_start": 0.5, "window_end": 2.0, "words": ["hello"]},
        {"index": 1, "window_start": 5.5, "window_end": 7.5, "words": ["again"]},
        {"index": 2, "window_start": 3.0, "window_end": 3.05, "words": ["x"]},
        {"index": 3, "window_start": 3.0, "window_end": 4.0, "words": [""]},
    ]
    results = worker.align_windows_on_emission(emission, lines, DICTIONARY, STAR, torch, functional)
    assert results[0]["status"] == "ok"
    assert results[0]["words"][0]["start"] == pytest.approx(50 * SPF, abs=0.03)
    assert results[1]["words"][0]["start"] == pytest.approx(300 * SPF, abs=0.03)
    assert (results[2]["status"], results[2]["error"]) == ("failed", "window too short")
    assert results[3]["status"] == "empty"


def test_scrambled_words_keep_their_shape():
    assert worker.scrambled("don't") != "don't"
    assert len(worker.scrambled("hello")) == 5
    assert worker.scrambled("hello")[2] == worker.scrambled("hello")[3]  # repeats stay
    assert "'" in worker.scrambled("don't")


def test_the_worker_accepts_version_2(tmp_path, monkeypatch):
    request = {
        "version": 2,
        "audio": str(tmp_path / "v.wav"),
        "model_dir": str(tmp_path),
        "allow_download": False,
        "lines": [],
        "song": {"lines": []},
    }
    path = tmp_path / "request.json"
    path.write_text(json.dumps(request))
    seen = {}

    def fake_run(req):
        seen.update(req)
        return {"version": 2, "model": "MMS_FA", "lines": [], "song": {"status": "skipped"}}

    monkeypatch.setattr(worker, "run", fake_run)
    code = worker.main(["--request", str(path), "--response", str(tmp_path / "out.json")])
    assert code == worker.EXIT_OK
    assert seen["version"] == 2
    assert json.loads((tmp_path / "out.json").read_text())["song"]["status"] == "skipped"
