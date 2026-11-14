"""The CTC worker's saved emission: a version 2 run saves the song's emission, later runs of
either version align on it without loading the model, a bad file is ignored, and the
emission-only mode the cloud GPU runs after separation writes the same emission.

The MMS bundle and model are faked (no weights); forced alignment runs through torchaudio."""

import json

import numpy as np
import pytest
import soundfile as sf

from backend.workers import ctc_align_worker as worker

torch = pytest.importorskip("torch")
torchaudio = pytest.importorskip("torchaudio")
functional = pytest.importorskip("torchaudio.functional")

LETTERS = worker.NULL_LETTERS + "'"
DICTIONARY = {"-": 0, **{ch: i + 1 for i, ch in enumerate(LETTERS)}}
STAR = len(DICTIONARY)
LABELS = STAR + 1
SPF = worker.FRAME_SAMPLES / worker.SAMPLE_RATE


def _spell(at: int, word: str) -> dict[int, str]:
    return {at + 3 * i: ch for i, ch in enumerate(word)}


SUNG = {**_spell(100, "hello"), **_spell(300, "again")}  # at 2.0 s and 6.0 s


class _Model:
    """Stands in for MMS_FA: blank everywhere except the SUNG letters at their song frames.
    The test waveform holds each sample's index, so a chunk knows where it is in the song."""

    def __init__(self):
        self.calls = 0

    def eval(self):
        return self

    def to(self, device):
        self.device = device
        return self

    def __call__(self, segment):
        self.calls += 1
        frames = worker.emission_frames(int(segment.shape[1]))
        first = round(segment[0, 0].item()) // worker.FRAME_SAMPLES
        probs = torch.full((frames, LABELS), 1e-4)
        probs[:, 0] = 1.0
        for j in range(frames):
            ch = SUNG.get(first + j)
            if ch:
                probs[j, :] = 1e-4
                probs[j, DICTIONARY[ch]] = 1.0
        emission = torch.log(probs / probs.sum(dim=1, keepdim=True))
        emission[:, STAR] = 0.0
        return emission.unsqueeze(0), None


class _Bundle:
    def __init__(self, loadable=True):
        self.loadable = loadable
        self.models = []

    def get_dict(self, star=None):
        return dict(DICTIONARY)

    def get_model(self, with_star=True, dl_kwargs=None):
        if not self.loadable:
            raise AssertionError("the model should not be loaded")
        model = _Model()
        self.models.append(model)
        return model


@pytest.fixture
def setup(tmp_path, monkeypatch):
    vocals = tmp_path / "vocals.wav"
    samples = worker.SAMPLE_RATE * 9
    sf.write(str(vocals), np.arange(samples, dtype=np.float32), worker.SAMPLE_RATE, "FLOAT")
    model_dir = tmp_path / "models"
    model_dir.mkdir()
    (model_dir / worker.WEIGHTS_FILE).write_bytes(b"weights")
    state = {"bundle": _Bundle()}
    monkeypatch.setattr(
        worker, "import_torch", lambda: (torch, torchaudio, functional, state["bundle"])
    )

    def request(version=2, cache=tmp_path / "cache" / "emission.npy"):
        req = {
            "version": version,
            "audio": str(vocals),
            "model_dir": str(model_dir),
            "allow_download": False,
            "lines": [
                {"index": 0, "window_start": 1.5, "window_end": 3.5, "words": ["hello"]},
                {"index": 1, "window_start": 5.5, "window_end": 7.5, "words": ["again"]},
            ],
        }
        if version == 2:
            req["song"] = {
                "lines": [{"index": 0, "words": ["hello"]}, {"index": 1, "words": ["again"]}]
            }
        if cache is not None:
            req["emission_cache"] = str(cache)
        return req

    state.update(request=request, cache=tmp_path / "cache" / "emission.npy", vocals=vocals)
    return state


def _starts(lines):
    return [line["words"][0]["start"] for line in lines]


def test_a_song_pass_saves_its_emission_and_the_next_run_skips_the_model(setup):
    first = worker.run(setup["request"]())
    assert first["emission"]["cached"] is False
    assert len(setup["bundle"].models) == 1
    saved = np.load(setup["cache"])
    assert saved.dtype == np.float32
    assert saved.shape == (first["emission"]["frames"], LABELS)

    setup["bundle"] = _Bundle(loadable=False)
    second = worker.run(setup["request"]())
    assert second["emission"]["cached"] is True
    assert second["lines"] == first["lines"]
    assert second["song"] == first["song"]
    assert _starts(second["song"]["lines"]) == pytest.approx([2.0, 6.0], abs=0.03)


def test_a_single_line_request_aligns_on_the_saved_emission(setup):
    worker.run(setup["request"]())
    setup["bundle"] = _Bundle(loadable=False)
    result = worker.run(setup["request"](version=1))
    assert result["version"] == 1
    assert result["emission"]["cached"] is True
    assert [line["status"] for line in result["lines"]] == ["ok", "ok"]
    assert _starts(result["lines"]) == pytest.approx([2.0, 6.0], abs=0.03)


def test_a_single_line_request_without_a_saved_emission_listens_to_its_windows_only(setup):
    result = worker.run(setup["request"](version=1))
    assert "emission" not in result
    assert _starts(result["lines"]) == pytest.approx([2.0, 6.0], abs=0.05)
    assert not setup["cache"].exists()  # only a whole-song emission is worth keeping


@pytest.mark.parametrize(
    "bad",
    [
        b"not an array",
        np.zeros((10, LABELS - 1), dtype=np.float32),
        np.zeros((10, LABELS), dtype=np.float64),
        np.full((10, LABELS), np.nan, dtype=np.float32),
    ],
)
def test_an_unusable_saved_emission_is_replaced(setup, bad):
    setup["cache"].parent.mkdir(parents=True)
    if isinstance(bad, bytes):
        setup["cache"].write_bytes(bad)
    else:
        np.save(setup["cache"], bad)
    result = worker.run(setup["request"]())
    assert result["emission"]["cached"] is False
    assert len(setup["bundle"].models) == 1
    assert np.load(setup["cache"]).shape == (result["emission"]["frames"], LABELS)


def test_without_a_cache_path_nothing_is_saved(setup, tmp_path):
    result = worker.run(setup["request"](cache=None))
    assert result["emission"]["cached"] is False
    assert not (tmp_path / "cache").exists()


def test_emission_only_mode_writes_the_songs_emission(setup, tmp_path, capsys):
    out = tmp_path / "gpu" / "emission.npy"
    model_dir = tmp_path / "models"
    code = worker.main(
        ["--emission", str(setup["vocals"]), "--out", str(out), "--model-dir", str(model_dir)]
    )
    assert code == worker.EXIT_OK
    events = [json.loads(x) for x in capsys.readouterr().err.splitlines() if x.startswith("{")]
    done = events[-1]
    assert done["event"] == "done"
    assert done["device"] == ("cuda" if torch.cuda.is_available() else "cpu")
    # The same emission a song pass computes here, so the server can align on it directly
    worker.run(setup["request"]())
    assert np.array_equal(np.load(out), np.load(setup["cache"]))


def test_emission_only_mode_reports_missing_weights(setup, tmp_path, capsys):
    empty = tmp_path / "empty-models"
    code = worker.main(
        [
            "--emission",
            str(setup["vocals"]),
            "--out",
            str(tmp_path / "e.npy"),
            "--model-dir",
            str(empty),
            "--allow-download",
            "0",
        ]
    )
    assert code == worker.EXIT_WEIGHTS_MISSING
    assert not (tmp_path / "e.npy").exists()
    assert '"weights_missing"' in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [["--emission", "v.wav"], ["--emission", "v.wav", "--out", "e.npy"], ["--request", "r.json"]],
)
def test_incomplete_arguments_are_usage_errors(argv):
    with pytest.raises(SystemExit) as exc:
        worker.parse_args(argv)
    assert exc.value.code == worker.EXIT_USAGE


def test_saving_never_raises(tmp_path):
    blocker = tmp_path / "file"
    blocker.write_text("x")
    assert worker.save_emission(blocker / "sub" / "e.npy", torch.zeros(3, LABELS)) is False
    assert worker.load_cached_emission(tmp_path / "missing.npy", LABELS, torch) is None
