"""Model prefetch tool."""

import subprocess
import sys

from backend.services import separation_presets as presets
from backend.tools import fetch_models


def _run(monkeypatch, argv, returncodes=None):
    calls = []
    codes = iter(returncodes or [])

    def fake_run(cmd, *args, **kwargs):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, next(codes, 0))

    monkeypatch.setattr(subprocess, "run", fake_run)
    return fetch_models.main(argv), calls


def test_default_fetches_demucs_and_the_configured_preset(monkeypatch):
    monkeypatch.setenv("SEPARATION_QUALITY", "balanced")
    code, calls = _run(monkeypatch, [])
    assert code == 0
    assert calls[0][:2] == [sys.executable, "-c"]
    assert "get_model('htdemucs')" in calls[0][2]
    worker = calls[1]
    assert worker[:5] == [
        sys.executable,
        "-u",
        "-m",
        "backend.workers.roformer_worker",
        "--download-only",
    ]
    assert worker[worker.index("--models") + 1 : worker.index("--model-dir")] == [
        presets.DEFAULT_BALANCED_MODEL
    ]
    assert worker[worker.index("--model-dir") + 1] == str(presets.model_dir())


def test_all_presets_without_demucs_and_failures(monkeypatch, capsys):
    code, calls = _run(monkeypatch, ["--separation", "all", "--no-demucs"], returncodes=[3])
    assert code == 1
    assert len(calls) == 1
    models = calls[0][calls[0].index("--models") + 1 : calls[0].index("--model-dir")]
    assert models == list(
        dict.fromkeys([presets.DEFAULT_BALANCED_MODEL, *presets.DEFAULT_BEST_MODELS])
    )
    assert "failed (exit 3)" in capsys.readouterr().err


def test_fast_and_none_need_no_roformer_weights(monkeypatch):
    assert fetch_models.roformer_models("fast") == []
    assert fetch_models.roformer_models("none") == []
    code, calls = _run(monkeypatch, ["--separation", "none", "--no-demucs"])
    assert (code, calls) == (0, [])


def test_alignment_model_is_fetched_on_request(monkeypatch, tmp_path):
    monkeypatch.setenv("ALIGNMENT_MODEL_DIR", str(tmp_path / "mms"))
    code, calls = _run(monkeypatch, ["--separation", "none", "--no-demucs", "--alignment"])
    assert code == 0
    assert calls[0][:2] == [sys.executable, "-c"]
    assert "MMS_FA.get_model(with_star=True" in calls[0][2]
    assert str(tmp_path / "mms") in calls[0][2] and "mms_fa.pt" in calls[0][2]
    assert (tmp_path / "mms").is_dir()
