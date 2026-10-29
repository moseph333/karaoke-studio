"""Separation presets, progress parsing, the RoFormer worker and the separator's engine chain.

Real models never run here. Engines are replaced by small scripts that speak the same
protocol (Demucs-style progress bars, or the RoFormer worker's JSON events), and the worker
itself runs against a stand-in audio_separator package.
"""

import json
import os
import subprocess
import sys
import threading
import time
import types
from pathlib import Path
from typing import ClassVar

import numpy as np
import pytest
import soundfile as sf

from backend.services import remote_separation as remote_mod
from backend.services import separation_presets as presets
from backend.services import separator as separator_mod
from backend.services.process_watchdog import PROJECT_ROOT
from backend.services.separation_progress import ProgressTracker, parse_eta_seconds
from backend.services.separator import AudioSeparator, SeparationCancelled
from backend.workers import roformer_worker as worker

BALANCED_MODEL = presets.DEFAULT_BALANCED_MODEL
BEST_MODELS = presets.DEFAULT_BEST_MODELS


def _write_wav(path: Path, value: float = 0.0, frames: int = 400) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), np.full((frames, 2), value, dtype="float32"), 8000)
    return path


def _stage_words_ok(detail: str) -> bool:
    # The processing screen treats these words as "vocal range & chords" progress
    lower = detail.lower()
    return "chord" not in lower and "range" not in lower


# ==============================================================================
# Presets and availability
# ==============================================================================


def test_presets_resolve_ids_and_raw_demucs_models():
    balanced = presets.resolve_plan(" Balanced ")
    assert (balanced.preset, balanced.engine, balanced.models) == (
        "balanced",
        "roformer",
        (BALANCED_MODEL,),
    )
    best = presets.resolve_plan("best")
    assert best.models == BEST_MODELS
    assert best.passes == 2
    assert best.params["ensemble"] == "avg_wave"
    assert presets.resolve_plan("htdemucs") == presets.preset_plan("fast")
    assert presets.resolve_plan(None).preset == "fast"
    custom = presets.resolve_plan("htdemucs_ft")
    assert (custom.preset, custom.engine, custom.models) == ("custom", "demucs", ("htdemucs_ft",))

    assert [p.preset for p in presets.fallback_chain(best)] == ["best", "balanced", "fast"]
    assert [p.preset for p in presets.fallback_chain(balanced)] == ["balanced", "fast"]
    assert [p.preset for p in presets.fallback_chain(custom)] == ["custom"]


def test_preset_settings_are_read_from_the_environment(monkeypatch):
    monkeypatch.setenv("SEPARATION_QUALITY", "BEST")
    assert presets.configured_preset() == "best"
    monkeypatch.setenv("SEPARATION_QUALITY", "ultra")
    assert presets.configured_preset() == "balanced"
    monkeypatch.delenv("SEPARATION_QUALITY")
    assert presets.configured_preset() == "balanced"

    monkeypatch.setenv("SEPARATION_BEST_MODELS", " a.ckpt , ,b.ckpt ")
    assert presets.preset_plan("best").models == ("a.ckpt", "b.ckpt")
    monkeypatch.setenv("SEPARATION_BALANCED_MODEL", "my_roformer.ckpt")
    assert presets.preset_plan("balanced").models == ("my_roformer.ckpt",)

    monkeypatch.setenv("SEPARATION_TIMEOUT_SEC", "-5")
    assert presets.separation_timeout_seconds() == 7200
    monkeypatch.setenv("SEPARATION_STALL_SEC", "12.5")
    assert presets.separation_stall_seconds() == 12.5
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", "off")
    assert presets.downloads_allowed() is False
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", " ")
    assert presets.downloads_allowed() is True


def test_roformer_availability_explains_what_is_missing(monkeypatch, tmp_path):
    plan = presets.preset_plan("balanced")
    installed = {"audio_separator": False, "torch": True}
    monkeypatch.setattr(presets, "package_available", lambda name: installed.get(name, False))
    monkeypatch.setenv("AUDIO_SEPARATOR_MODEL_DIR", str(tmp_path))

    ready, why = presets.plan_status(plan)
    assert not ready
    assert "audio-separator is not installed" in why
    installed.update(audio_separator=True, torch=False)
    assert presets.plan_status(plan) == (False, "PyTorch is not installed")

    installed["torch"] = True
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", "0")
    ready, why = presets.plan_status(plan)
    assert not ready
    assert "automatic download is disabled" in why
    (tmp_path / BALANCED_MODEL).write_bytes(b"weights")
    assert presets.plan_status(plan) == (True, None)

    (tmp_path / BALANCED_MODEL).unlink()
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", "1")
    assert presets.plan_status(plan) == (True, None)
    assert presets.plan_status(presets.preset_plan("fast")) == (True, None)


@pytest.mark.parametrize(
    ("version", "expected"), [("4.1.0", True), ("5.0", True), ("4.0.1", False), (None, False)]
)
def test_demucs_quality_flags_need_demucs_4_1(monkeypatch, version, expected):
    monkeypatch.setattr(presets, "package_version", lambda name: version)
    presets.demucs_supports_quality_flags.cache_clear()
    try:
        assert presets.demucs_supports_quality_flags() is expected
    finally:
        presets.demucs_supports_quality_flags.cache_clear()


def test_estimates_and_model_labels():
    assert presets.estimate_cpu_seconds("fast", 200) == 70
    assert presets.estimate_cpu_seconds("balanced", 100) == 160
    assert presets.estimate_cpu_seconds("best", 100) > presets.estimate_cpu_seconds("balanced", 100)
    assert presets.model_label(BALANCED_MODEL) == "Mel-Band RoFormer"
    assert presets.model_label("model_bs_roformer_ep_368_sdr_12.9628.ckpt") == "BS-RoFormer"
    assert presets.model_label("htdemucs_ft") == "htdemucs_ft"


# ==============================================================================
# Progress parsing
# ==============================================================================


def test_single_pass_reports_the_raw_percentage_eta_and_audio_seconds():
    tracker = ProgressTracker()
    update = tracker.feed(" 42%|████▏     | 73.0/175.0 [00:21<00:30,  3.4seconds/s]\n")
    assert update == (42.0, "Demucs AI: 73s of 175s of audio processed (42%)", 30)
    assert parse_eta_seconds("[1:02:03<1:04:05, 2.10s/it]") == 3845
    assert parse_eta_seconds("100%|█| 4/4") is None


def test_restarting_bars_become_one_monotonic_percentage():
    tracker = ProgressTracker(passes=2, engine_label="RoFormer", count_unit="chunks")
    lines = [
        " 50%|█| 5/10 [00:05<00:05]",
        "100%|█| 10/10 [00:10<00:00]",
        "  0%| | 0/10 [00:00<?]",
        " 50%|█| 5/10 [00:05<00:05]",
        "100%|█| 10/10 [00:10<00:00]",
    ]
    updates = [tracker.feed(line) for line in lines]
    assert [u[0] for u in updates] == [25.0, 50.0, 50.0, 75.0, 100.0]
    assert updates[3][1] == "RoFormer: chunk 5/10 (model 2 of 2) (50%)"


def test_worker_events_drive_passes_downloads_and_errors():
    tracker = ProgressTracker(passes=2, engine_label="RoFormer", count_unit="chunks")
    download = '{"event": "download", "detail": "Downloading BS-RoFormer weights"}'
    assert tracker.feed(download) == (None, "Downloading BS-RoFormer weights", None)
    bar = " 45%|████▌     | 412M/913M [00:15<00:18, 27.2MiB/s]"
    assert tracker.feed(bar) == (None, "Downloading model weights… (45%)", 18)
    stage = '{"event": "stage", "pass": 2, "pct": 0, "detail": "BS-RoFormer separating stems"}'
    assert tracker.feed(stage) == (50.0, "BS-RoFormer separating stems", None)
    assert tracker.feed('{"event": "stage", "detail": "Blending"}') == (50.0, "Blending", None)
    assert tracker.feed('{"event": "error", "code": "failed", "detail": "Boom"}') is None
    assert tracker.error_detail == "Boom"


def test_lines_without_progress_are_kept_for_error_messages():
    tracker = ProgressTracker()
    for i in range(20):
        tracker.feed(f"warning {i}\n")
        tracker.feed(f" {i}%|█| {i}/100 [00:01<00:10]\n")
    tracker.feed("   \n")
    tracker.feed("{not json")
    tracker.feed("x" * 1000)
    tail = list(tracker.tail)
    assert len(tail) == 15
    assert tail[-2] == "{not json"
    assert len(tail[-1]) < 500
    assert not any("%|" in line for line in tail)


# ==============================================================================
# RoFormer worker (in process, against a stand-in audio_separator package)
# ==============================================================================


class FakeSeparator:
    """Writes constant-level stems with audio-separator's output naming."""

    instances: ClassVar[list["FakeSeparator"]] = []
    levels: ClassVar[dict[str, float]] = {BALANCED_MODEL: 0.2, BEST_MODELS[1]: 0.4}
    fail_on_separate = False

    def __init__(self, model_file_dir, output_dir, info_only=False, **kwargs):
        self.model_file_dir = Path(model_file_dir)
        self.output_dir = Path(output_dir)
        self.info_only = info_only
        self.kwargs = kwargs
        self.model = None
        FakeSeparator.instances.append(self)

    def download_file_if_not_exists(self, url, output_path):
        if not os.path.isfile(output_path):
            Path(output_path).write_bytes(b"weights")

    def download_model_files(self, model):
        self.download_file_if_not_exists(model, str(self.model_file_dir / model))

    def load_model(self, model_filename):
        self.download_model_files(model_filename)
        self.model = model_filename

    def separate(self, audio_path):
        if FakeSeparator.fail_on_separate:
            raise RuntimeError("index out of bounds")
        level = self.levels.get(self.model, 0.1)
        names = []
        for stem, value in (("Vocals", level), ("Instrumental", -level)):
            name = f"{Path(audio_path).stem}_({stem})_{Path(self.model).stem}.wav"
            _write_wav(self.output_dir / name, value)
            names.append(name)
        return names


@pytest.fixture
def fake_audio_separator(monkeypatch):
    FakeSeparator.instances = []
    FakeSeparator.fail_on_separate = False
    package = types.ModuleType("audio_separator")
    module = types.ModuleType("audio_separator.separator")
    module.Separator = FakeSeparator
    package.separator = module
    monkeypatch.setitem(sys.modules, "audio_separator", package)
    monkeypatch.setitem(sys.modules, "audio_separator.separator", module)
    return FakeSeparator


def _worker_args(tmp_path: Path, *models: str, extra: tuple[str, ...] = ()) -> list[str]:
    audio = _write_wav(tmp_path / "song.wav")
    return [
        "--audio",
        str(audio),
        "--out",
        str(tmp_path / "out"),
        "--models",
        *models,
        "--model-dir",
        str(tmp_path / "models"),
        *extra,
    ]


def _events(capsys) -> list[dict]:
    err = capsys.readouterr().err
    return [json.loads(line) for line in err.splitlines() if line.startswith('{"event"')]


def test_worker_single_model_writes_vocals_and_no_vocals(tmp_path, capsys, fake_audio_separator):
    assert worker.main(_worker_args(tmp_path, BALANCED_MODEL)) == worker.EXIT_OK

    out = tmp_path / "out"
    assert sorted(p.name for p in out.iterdir()) == ["no_vocals.wav", "vocals.wav"]
    assert sf.read(str(out / "vocals.wav"))[0].mean() == pytest.approx(0.2, abs=1e-3)
    assert sf.read(str(out / "no_vocals.wav"))[0].mean() == pytest.approx(-0.2, abs=1e-3)

    events = _events(capsys)
    assert events[0] == {"event": "stage", "pass": 1, "detail": "Loading Mel-Band RoFormer…"}
    assert events[1] == {
        "event": "download",
        "detail": "Downloading Mel-Band RoFormer weights (first run only)…",
    }
    assert events[-1] == {"event": "stage", "pct": 100, "detail": "Stems ready"}
    options = fake_audio_separator.instances[0].kwargs
    assert options["mdxc_params"]["overlap"] == 2
    assert options["output_format"] == "WAV"


def test_worker_ensemble_averages_each_stem(tmp_path, capsys, fake_audio_separator):
    args = _worker_args(tmp_path, *BEST_MODELS, extra=("--overlap", "4"))
    assert worker.main(args) == worker.EXIT_OK

    out = tmp_path / "out"
    assert sorted(p.name for p in out.iterdir()) == ["no_vocals.wav", "vocals.wav"]
    assert sf.read(str(out / "vocals.wav"))[0].mean() == pytest.approx(0.3, abs=2e-3)
    assert sf.read(str(out / "no_vocals.wav"))[0].mean() == pytest.approx(-0.3, abs=2e-3)
    stages = [e for e in _events(capsys) if e["event"] == "stage"]
    assert [e.get("pass") for e in stages] == [1, 1, 2, 2, None, None]
    assert stages[3]["detail"] == "BS-RoFormer separating stems (model 2 of 2)"
    assert stages[4]["detail"] == "Blending 2 model outputs…"
    assert all(sep.kwargs["mdxc_params"]["overlap"] == 4 for sep in fake_audio_separator.instances)


def test_worker_never_downloads_when_downloads_are_disabled(
    tmp_path, capsys, monkeypatch, fake_audio_separator
):
    args = _worker_args(tmp_path, BALANCED_MODEL, extra=("--allow-download", "0"))
    assert worker.main(args) == worker.EXIT_WEIGHTS_MISSING
    error = _events(capsys)[-1]
    assert (error["event"], error["code"]) == ("error", "weights_missing")
    assert list((tmp_path / "models").iterdir()) == []

    # Weights on disk, but the loader wants a config file that is not: still no download
    (tmp_path / "models" / BALANCED_MODEL).write_bytes(b"weights")
    original_load = FakeSeparator.load_model

    def load_with_config(self, model_filename):
        self.download_file_if_not_exists("config", str(self.model_file_dir / "config.yaml"))
        original_load(self, model_filename)

    monkeypatch.setattr(FakeSeparator, "load_model", load_with_config)
    assert worker.main(args) == worker.EXIT_WEIGHTS_MISSING
    assert "config.yaml is not downloaded" in _events(capsys)[-1]["detail"]
    assert not (tmp_path / "models" / "config.yaml").exists()


def test_worker_reports_separation_and_import_failures(
    tmp_path, capsys, monkeypatch, fake_audio_separator
):
    fake_audio_separator.fail_on_separate = True
    assert worker.main(_worker_args(tmp_path, BALANCED_MODEL)) == worker.EXIT_FAILED
    err = capsys.readouterr().err
    assert "Traceback" in err
    assert json.loads(err.splitlines()[-1]) == {
        "event": "error",
        "code": "failed",
        "detail": "RuntimeError: index out of bounds",
    }

    monkeypatch.setitem(sys.modules, "audio_separator", None)
    monkeypatch.setitem(sys.modules, "audio_separator.separator", None)
    assert worker.main(_worker_args(tmp_path, BALANCED_MODEL)) == worker.EXIT_IMPORT
    assert _events(capsys)[-1]["code"] == "import"


def test_worker_download_only_prefetches_weights(tmp_path, capsys, fake_audio_separator):
    models_dir = tmp_path / "models"
    code = worker.main(
        ["--download-only", "--models", *BEST_MODELS, "--model-dir", str(models_dir)]
    )
    assert code == worker.EXIT_OK
    assert all((models_dir / model).is_file() for model in BEST_MODELS)
    assert fake_audio_separator.instances[0].info_only is True
    assert _events(capsys)[-1]["detail"] == "BS-RoFormer weights ready"


def test_worker_rejects_incomplete_arguments(tmp_path):
    with pytest.raises(SystemExit) as exc:
        worker.parse_args(["--models", "a.ckpt", "--model-dir", str(tmp_path)])
    assert exc.value.code == worker.EXIT_USAGE
    with pytest.raises(SystemExit):
        worker.parse_args([*_worker_args(tmp_path, "a.ckpt"), "--overlap", "0"])


@pytest.mark.parametrize(
    ("name", "kind"),
    [
        ("song_(Vocals)_vocals_mel_band_roformer.wav", "vocals"),
        ("song_(Instrumental)_model_bs_roformer_ep_317_sdr_12.9755.wav", "instrumental"),
        ("song_(Other)_model.wav", "instrumental"),
        ("live_(Instrumental)_(Vocals)_model.wav", "vocals"),
        ("song_(Drums)_model.wav", None),
        ("vocals.wav", None),
    ],
)
def test_worker_classifies_audio_separator_outputs(name, kind):
    assert worker.classify_stem(Path(name)) == kind


# ==============================================================================
# Separator engine chain (fake engine processes)
# ==============================================================================

FAKE_DEMUCS = r"""
import os, sys, time
args = sys.argv[1:]
out = args[args.index("-o") + 1]
mode = os.environ.get("FAKE_DEMUCS_MODE", "ok")
if mode == "silent":
    time.sleep(30)
if mode == "busy":
    for i in range(300):
        sys.stderr.write(f" {i % 100}%|#| {i}/300 [00:01<00:10]\n")
        sys.stderr.flush()
        time.sleep(0.1)
for pct in (25, 50, 100):
    sys.stderr.write(f" {pct}%|#| {pct}/100 [00:01<00:01, 5.00seconds/s]\n")
if mode == "oom":
    sys.stderr.write("RuntimeError: DefaultCPUAllocator: can't allocate memory\n")
    sys.exit(137)
if mode == "disk":
    sys.stderr.write("OSError: [Errno 28] No space left on device\n")
    sys.exit(1)
dest = os.path.join(out, "htdemucs", "song")
os.makedirs(dest, exist_ok=True)
for name in ("vocals.wav", "no_vocals.wav"):
    with open(os.path.join(dest, name), "wb") as f:
        f.write(b"RIFF" + b"D" * 200)
"""

FAKE_ROFORMER = r"""
import json, os, sys, time
args = sys.argv[1:]
out = args[args.index("--out") + 1]
models = args[args.index("--models") + 1 : args.index("--overlap")]
mode = os.environ.get("FAKE_ROFORMER_MODE", "ok")
os.makedirs(out, exist_ok=True)

def event(**fields):
    sys.stderr.write(json.dumps(fields) + "\n")
    sys.stderr.flush()

if mode == "slow":
    for _ in range(300):
        event(event="stage", detail="Still working")
        time.sleep(0.1)
for i, model in enumerate(models, 1):
    event(**{"event": "stage", "pass": i, "detail": f"Loading model {i}"})
    event(**{"event": "stage", "pass": i, "pct": 0, "detail": f"Separating with model {i}"})
    for pct in (50, 100):
        sys.stderr.write(f"{pct}%|#| {pct // 10}/10 [00:01<00:01,  1.00s/it]\n")
if mode == "fail":
    # A partial result that must not leak into the fallback's output
    with open(os.path.join(out, "vocals.wav"), "wb") as f:
        f.write(b"RIFF" + b"R" * 200)
    sys.stderr.write("Traceback (most recent call last):\nIndexError: index out of range\n")
    event(event="error", code="failed", detail="IndexError: index out of range")
    sys.exit(5)
for name in ("vocals.wav", "no_vocals.wav"):
    with open(os.path.join(out, name), "wb") as f:
        f.write(b"RIFF" + b"R" * 200)
event(event="stage", pct=100, detail="Stems ready")
"""

FAKE_AUDIO_SEPARATOR_PACKAGE = r"""
import os
import numpy as np
import soundfile as sf

class Separator:
    def __init__(self, model_file_dir, output_dir, **kwargs):
        self.model_file_dir = model_file_dir
        self.output_dir = output_dir

    def download_file_if_not_exists(self, url, output_path):
        if not os.path.isfile(output_path):
            with open(output_path, "wb") as f:
                f.write(b"weights")

    def load_model(self, model_filename):
        path = os.path.join(self.model_file_dir, model_filename)
        self.download_file_if_not_exists(model_filename, path)
        self.model = model_filename

    def separate(self, audio_path):
        level = 0.2 if "mel_band" in self.model else 0.4
        base = os.path.splitext(os.path.basename(audio_path))[0]
        names = []
        for stem, value in (("Vocals", level), ("Instrumental", -level)):
            name = f"{base}_({stem})_{os.path.splitext(self.model)[0]}.wav"
            data = np.full((400, 2), value, dtype="float32")
            sf.write(os.path.join(self.output_dir, name), data, 8000)
            names.append(name)
        return names
"""


@pytest.fixture
def engines(tmp_path, monkeypatch):
    """Routes engine launches to fake scripts and records every command."""
    scripts = tmp_path / "engines"
    scripts.mkdir()
    (scripts / "demucs.py").write_text(FAKE_DEMUCS)
    (scripts / "roformer.py").write_text(FAKE_ROFORMER)
    state = types.SimpleNamespace(calls=[], route_roformer=True)
    real_popen = subprocess.Popen

    def popen(cmd, *args, **kwargs):
        state.calls.append({"cmd": list(cmd), "kwargs": kwargs})
        if cmd[:4] == [sys.executable, "-u", "-m", "demucs"]:
            cmd = [sys.executable, str(scripts / "demucs.py"), *cmd[4:]]
        elif state.route_roformer and "backend.workers.roformer_worker" in cmd:
            cmd = [sys.executable, str(scripts / "roformer.py"), *cmd[4:]]
        return real_popen(cmd, *args, **kwargs)

    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(separator_mod, "plan_status", lambda plan: (True, None))
    return state


def _separate(tmp_path: Path, model: str, **kwargs):
    reports: list[tuple] = []
    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    result = separator.separate_stems(
        str(_write_wav(tmp_path / "song.wav")),
        "trk",
        model_name=model,
        duration=100,
        progress_callback=lambda *update: reports.append(update),
        **kwargs,
    )
    return result, reports


def _engine_modules(state) -> list[str]:
    return [call["cmd"][3] for call in state.calls]


def test_balanced_runs_the_roformer_worker(tmp_path, engines):
    result, reports = _separate(tmp_path, "balanced")

    assert _engine_modules(engines) == ["backend.workers.roformer_worker"]
    call = engines.calls[0]
    cmd = call["cmd"]
    assert cmd[cmd.index("--models") + 1 : cmd.index("--overlap")] == [BALANCED_MODEL]
    assert cmd[cmd.index("--overlap") + 1] == "2"
    assert cmd[cmd.index("--allow-download") + 1] == "0"  # the test env disables downloads
    assert Path(cmd[cmd.index("--model-dir") + 1]) == presets.model_dir().resolve()
    assert "--ensemble" not in cmd
    assert call["kwargs"]["stdout"] == subprocess.DEVNULL
    assert call["kwargs"]["stderr"] == subprocess.PIPE
    worker_path = call["kwargs"]["env"]["PYTHONPATH"].split(os.pathsep)
    assert str(PROJECT_ROOT) in worker_path

    target = tmp_path / "stems" / "trk"
    assert sorted(p.name for p in target.iterdir()) == ["instrumental.wav", "vocals.wav"]
    assert (target / "vocals.wav").read_bytes().startswith(b"RIFFR")
    info = result["separation"]
    assert {k: info[k] for k in ("preset", "engine", "models", "requested", "fallback_reason")} == {
        "preset": "balanced",
        "engine": "roformer",
        "models": [BALANCED_MODEL],
        "requested": "balanced",
        "fallback_reason": None,
    }
    assert info["label"] == "Balanced · Mel-Band RoFormer"
    assert info["elapsed_seconds"] >= 0
    assert abs(info["separated_at"] - time.time()) < 60

    assert reports[0] == (5.0, "Starting Balanced · Mel-Band RoFormer…", 160)
    assert (50.0, "Mel-Band RoFormer: chunk 5/10 (50%)", 1) in reports
    assert reports[-1] == (100.0, "Stems ready", None)
    assert all(_stage_words_ok(detail) for _, detail, _ in reports)


def test_best_runs_an_ensemble_with_monotonic_progress(tmp_path, engines):
    result, reports = _separate(tmp_path, "best")

    cmd = engines.calls[0]["cmd"]
    assert cmd[cmd.index("--models") + 1 : cmd.index("--overlap")] == list(BEST_MODELS)
    assert cmd[cmd.index("--overlap") + 1] == "4"
    assert cmd[cmd.index("--ensemble") + 1] == "avg_wave"
    overall = [pct for pct, _, _ in reports[1:] if pct is not None]
    assert overall == sorted(overall)
    assert overall[-1] == 100.0
    assert any("(model 2 of 2)" in detail for _, detail, _ in reports)
    assert result["separation"]["preset"] == "best"
    assert result["separation"]["models"] == list(BEST_MODELS)


def test_failed_roformer_falls_back_to_demucs_without_leaking_partial_stems(
    tmp_path, engines, monkeypatch
):
    monkeypatch.setenv("FAKE_ROFORMER_MODE", "fail")
    result, reports = _separate(tmp_path, "balanced")

    assert _engine_modules(engines) == ["backend.workers.roformer_worker", "demucs"]
    target = tmp_path / "stems" / "trk"
    assert (target / "vocals.wav").read_bytes().startswith(b"RIFFD")
    assert sorted(p.name for p in target.iterdir()) == ["instrumental.wav", "vocals.wav"]
    info = result["separation"]
    assert (info["preset"], info["engine"], info["requested"]) == ("fast", "demucs", "balanced")
    assert info["fallback_reason"] == (
        "Balanced · Mel-Band RoFormer: RoFormer separation failed (exit 5): "
        "IndexError: index out of range"
    )
    assert (5.0, "Using Fast · Demucs instead", 35) in reports
    # The engine's error text stays out of the live status (it mentions "range")
    assert all(_stage_words_ok(detail) for _, detail, _ in reports)


def test_unavailable_roformer_is_skipped_without_launching_it(tmp_path, engines, monkeypatch):
    monkeypatch.setattr(separator_mod, "plan_status", presets.plan_status)
    monkeypatch.setattr(presets, "package_available", lambda name: False)
    result, _ = _separate(tmp_path, "best")

    assert _engine_modules(engines) == ["demucs"]
    assert result["separation"]["preset"] == "fast"
    reason = result["separation"]["fallback_reason"]
    assert "Best · RoFormer ensemble: audio-separator is not installed" in reason
    assert "Balanced · Mel-Band RoFormer: audio-separator is not installed" in reason


def test_cancel_during_roformer_stops_without_falling_back(tmp_path, engines, monkeypatch):
    monkeypatch.setenv("FAKE_ROFORMER_MODE", "slow")
    cancel = threading.Event()
    timer = threading.Timer(0.3, cancel.set)
    timer.start()
    started = time.monotonic()
    try:
        with pytest.raises(SeparationCancelled, match="cancelled by user"):
            _separate(tmp_path, "balanced", cancel_event=cancel)
    finally:
        timer.cancel()
    assert time.monotonic() - started < 5
    assert len(engines.calls) == 1
    assert not any(p.is_dir() for p in (tmp_path / "stems" / "trk").iterdir())


def test_demucs_quality_flags_sit_before_the_output_dir(tmp_path, engines, monkeypatch):
    _separate(tmp_path, "fast")
    plain = engines.calls[0]["cmd"]
    assert plain[:8] == [
        sys.executable,
        "-u",
        "-m",
        "demucs",
        "--two-stems=vocals",
        "-n",
        "htdemucs",
        "-o",
    ]
    assert "env" not in engines.calls[0]["kwargs"]

    monkeypatch.setattr(separator_mod, "demucs_supports_quality_flags", lambda: True)
    (tmp_path / "stems" / "trk" / "vocals.wav").unlink()
    _separate(tmp_path, "fast")
    cmd = engines.calls[1]["cmd"]
    assert cmd[7 : cmd.index("-o")] == [
        "--shifts",
        "1",
        "--overlap",
        "0.25",
        "--int24",
        "--clip-mode",
        "clamp",
    ]
    assert cmd[cmd.index("-o") + 1] == str(tmp_path / "stems" / "trk")


@pytest.mark.parametrize(
    ("mode", "expected"),
    [
        ("oom", "Demucs failed (exit 137): it ran out of memory"),
        ("disk", "Demucs failed (exit 1): the disk is full"),
    ],
)
def test_demucs_failures_explain_themselves(tmp_path, engines, monkeypatch, mode, expected):
    monkeypatch.setenv("FAKE_DEMUCS_MODE", mode)
    with pytest.raises(RuntimeError) as exc:
        _separate(tmp_path, "fast")
    assert str(exc.value).startswith(expected)
    assert "%|" not in str(exc.value)


def test_watchdog_stops_an_engine_that_goes_silent(tmp_path, engines, monkeypatch):
    monkeypatch.setenv("FAKE_DEMUCS_MODE", "silent")
    monkeypatch.setenv("SEPARATION_STALL_SEC", "0.5")
    started = time.monotonic()
    with pytest.raises(RuntimeError, match=r"no output for 0\.5 seconds \(SEPARATION_STALL_SEC\)"):
        _separate(tmp_path, "fast")
    assert time.monotonic() - started < 5


def test_watchdog_enforces_the_overall_time_limit(tmp_path, engines, monkeypatch):
    monkeypatch.setenv("FAKE_DEMUCS_MODE", "busy")
    monkeypatch.setenv("SEPARATION_TIMEOUT_SEC", "0.6")
    started = time.monotonic()
    with pytest.raises(RuntimeError, match=r"stopped after 0\.6 seconds"):
        _separate(tmp_path, "fast")
    assert time.monotonic() - started < 5


def test_real_worker_process_end_to_end(tmp_path, engines, monkeypatch):
    package = tmp_path / "fakepkgs" / "audio_separator"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")
    (package / "separator.py").write_text(FAKE_AUDIO_SEPARATOR_PACKAGE)
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "fakepkgs"))
    monkeypatch.setenv("SEPARATION_ALLOW_DOWNLOAD", "1")
    engines.route_roformer = False

    result, reports = _separate(tmp_path, "best")

    vocals, _ = sf.read(str(tmp_path / "stems" / "trk" / "vocals.wav"))
    assert vocals.mean() == pytest.approx(0.3, abs=2e-3)
    assert result["separation"]["preset"] == "best"
    details = [detail for _, detail, _ in reports]
    assert "Downloading Mel-Band RoFormer weights (first run only)…" in details
    assert "Blending 2 model outputs…" in details
    assert reports[-1] == (100.0, "Stems ready", None)
    assert all(_stage_words_ok(detail) for detail in details)
    assert all((presets.model_dir() / model).is_file() for model in BEST_MODELS)


def test_an_aborting_progress_callback_cleans_up_without_falling_back(tmp_path, engines):
    class Abort(Exception):
        pass

    def callback(pct, detail, eta):
        if pct is not None and pct >= 50:
            raise Abort()

    separator = AudioSeparator(output_base_dir=tmp_path / "stems")
    with pytest.raises(Abort):
        separator.separate_stems(
            str(_write_wav(tmp_path / "song.wav")),
            "trk",
            model_name="balanced",
            progress_callback=callback,
        )
    assert len(engines.calls) == 1
    assert not any(p.is_dir() for p in (tmp_path / "stems" / "trk").iterdir())


# ==============================================================================
# Cloud GPU (SEPARATION_REMOTE=modal)
# ==============================================================================


def test_cloud_gpu_settings_and_estimates(monkeypatch):
    assert presets.remote_backend() is None
    assert presets.estimate_seconds("balanced", 100) == presets.estimate_cpu_seconds(
        "balanced", 100
    )

    monkeypatch.setenv("SEPARATION_REMOTE", " Modal ")
    assert presets.remote_backend() == "modal"
    assert presets.remote_app_name() == "karaoke-studio-gpu"
    assert presets.remote_queue_seconds() == 300.0
    monkeypatch.setenv("SEPARATION_REMOTE_APP", "my-gpu")
    monkeypatch.setenv("SEPARATION_REMOTE_QUEUE_SEC", "60")
    assert (presets.remote_app_name(), presets.remote_queue_seconds()) == ("my-gpu", 60.0)
    assert presets.estimate_seconds("balanced", 240) == 78  # 30 s + 240 s x 0.2
    assert presets.estimate_seconds("best", 240) == 126  # 30 s + 240 s x 0.4
    assert presets.estimate_seconds("fast", 200) == 70  # Fast still runs here

    monkeypatch.setenv("SEPARATION_REMOTE", "elsewhere")
    assert presets.remote_backend() is None


def test_cloud_gpu_availability_needs_the_client_and_credentials(monkeypatch, tmp_path):
    monkeypatch.setenv("SEPARATION_REMOTE", "modal")
    monkeypatch.setenv("HOME", str(tmp_path))
    installed = {"modal": False}
    monkeypatch.setattr(presets, "package_available", lambda name: installed.get(name, False))
    plan = presets.preset_plan("best")

    assert presets.plan_status(plan) == (False, "the modal package is not installed")
    installed["modal"] = True
    ready, why = presets.plan_status(plan)
    assert not ready
    assert "MODAL_TOKEN_ID" in why
    # No audio-separator, PyTorch or local weights are needed when the GPU does the work
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    assert presets.plan_status(plan) == (True, None)
    monkeypatch.delenv("MODAL_TOKEN_ID")
    (tmp_path / ".modal.toml").write_text("[default]\n")
    assert presets.plan_status(plan) == (True, None)
    assert presets.plan_status(presets.preset_plan("fast")) == (True, None)


def test_capabilities_report_presets_that_run_on_the_cloud_gpu(monkeypatch):
    from backend.services.capabilities import separation_capabilities

    monkeypatch.setenv("SEPARATION_REMOTE", "modal")
    monkeypatch.setenv("SEPARATION_QUALITY", "best")
    monkeypatch.setenv("MODAL_TOKEN_ID", "ak-test")
    monkeypatch.setenv("MODAL_TOKEN_SECRET", "as-test")
    monkeypatch.setattr(presets, "package_available", lambda name: name == "modal")

    caps = separation_capabilities()
    by_id = {p["id"]: p for p in caps["presets"]}
    assert caps["effective_default"] == "best"
    assert by_id["best"]["available"] is True
    assert by_id["best"]["runs_on"] == "cloud-gpu"
    assert by_id["best"]["cpu_realtime_factor"] == presets.REMOTE_REALTIME_FACTORS["best"]
    assert by_id["best"]["gpu_recommended"] is False
    assert by_id["balanced"]["weights_cached"] is None
    assert by_id["fast"]["runs_on"] is None
    assert by_id["fast"]["cpu_realtime_factor"] == presets.CPU_REALTIME_FACTORS["fast"]


CLOUD_WORKER_LINES = [
    '{"event": "stage", "pass": 1, "detail": "Loading model 1"}\n',
    '{"event": "stage", "pass": 1, "pct": 0, "detail": "Separating with model 1"}\n',
    "50%|#| 5/10 [00:01<00:01,  1.00s/it]\n",
    "100%|#| 10/10 [00:02<00:00,  1.00s/it]\n",
]


@pytest.fixture
def cloud(monkeypatch, engines):
    """Hands RoFormer plans to a stand-in for the Modal GPU and records each job."""
    state = types.SimpleNamespace(jobs=[], mode="ok")
    monkeypatch.setenv("SEPARATION_REMOTE", "modal")

    def run_remote(plan, audio_file, out_dir, on_line, cancel_event, **limits):
        state.jobs.append({"models": list(plan.models), "audio": audio_file.name, **limits})
        if state.mode == "unavailable":
            raise remote_mod.RemoteUnavailable(
                "no cloud GPU started the job within 5 minutes (SEPARATION_REMOTE_QUEUE_SEC)"
            )
        limits["on_started"]()
        for line in CLOUD_WORKER_LINES:
            on_line(line)
        if state.mode == "fail":
            on_line('{"event": "error", "code": "failed", "detail": "CUDA error: device lost"}\n')
            return remote_mod.RemoteOutcome(5)
        if state.mode == "cancelled":
            return remote_mod.RemoteOutcome(None, "cancelled")
        _write_wav(out_dir / "vocals.wav", 0.5)
        _write_wav(out_dir / "no_vocals.wav", -0.5)
        on_line('{"event": "stage", "pct": 100, "detail": "Stems ready"}\n')
        return remote_mod.RemoteOutcome(0)

    monkeypatch.setattr(remote_mod, "run_remote", run_remote)
    return state


def test_cloud_gpu_runs_balanced_with_no_local_worker(tmp_path, cloud, engines):
    result, reports = _separate(tmp_path, "balanced")

    assert engines.calls == []
    assert len(cloud.jobs) == 1
    job = cloud.jobs[0]
    assert (job["models"], job["audio"]) == ([BALANCED_MODEL], "song.wav")
    assert (job["timeout_s"], job["stall_s"], job["queue_s"]) == (7200.0, 900.0, 300.0)
    target = tmp_path / "stems" / "trk"
    assert sorted(p.name for p in target.iterdir()) == ["instrumental.wav", "vocals.wav"]
    vocals, _ = sf.read(str(target / "vocals.wav"))
    assert vocals.mean() == pytest.approx(0.5, abs=1e-3)
    info = result["separation"]
    assert (info["preset"], info["engine"], info["fallback_reason"]) == (
        "balanced",
        "roformer",
        None,
    )

    assert reports[0] == (5.0, "Starting Balanced · Mel-Band RoFormer…", 50)  # 30 s + 100 s x 0.2
    details = [detail for _, detail, _ in reports]
    assert "Waiting for a cloud GPU for Balanced · Mel-Band RoFormer…" in details
    assert "Balanced · Mel-Band RoFormer is running on a cloud GPU…" in details
    assert (50.0, "Mel-Band RoFormer: chunk 5/10 (50%)", 1) in reports
    assert reports[-1] == (100.0, "Stems ready", None)
    assert all(_stage_words_ok(detail) for detail in details)


def test_a_failed_cloud_job_falls_back_to_fast_here(tmp_path, cloud, engines):
    cloud.mode = "fail"
    result, _ = _separate(tmp_path, "balanced")

    assert _engine_modules(engines) == ["demucs"]
    info = result["separation"]
    assert (info["preset"], info["requested"]) == ("fast", "balanced")
    assert info["fallback_reason"] == (
        "Balanced · Mel-Band RoFormer: RoFormer separation failed (exit 5): CUDA error: device lost"
    )


def test_an_unreachable_cloud_gpu_skips_the_other_cloud_presets(tmp_path, cloud, engines):
    cloud.mode = "unavailable"
    result, reports = _separate(tmp_path, "best")

    assert len(cloud.jobs) == 1  # Balanced is not sent to the unreachable GPU again
    assert _engine_modules(engines) == ["demucs"]
    reason = result["separation"]["fallback_reason"]
    assert "Best · RoFormer ensemble: no cloud GPU started the job within 5 minutes" in reason
    assert "Balanced · Mel-Band RoFormer: skipped, the cloud GPU is unavailable" in reason
    assert (5.0, "Using Fast · Demucs instead", 35) in reports


def test_cancelling_a_cloud_job_does_not_fall_back(tmp_path, cloud, engines):
    cloud.mode = "cancelled"
    with pytest.raises(SeparationCancelled, match="cancelled by user"):
        _separate(tmp_path, "balanced")
    assert engines.calls == []
    assert not any(p.is_dir() for p in (tmp_path / "stems" / "trk").iterdir())
