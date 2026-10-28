"""Stem separation benchmark tool."""

import json

import numpy as np
import pytest
import soundfile as sf

from backend.services.separator import AudioSeparator
from backend.tools import benchmark_separation as bench

RATE = 8000


@pytest.fixture
def stems(tmp_path):
    rng = np.random.default_rng(0)
    t = np.arange(RATE * 2) / RATE
    vocals = 0.3 * np.sin(2 * np.pi * 440 * t)
    backing = 0.2 * rng.standard_normal(len(t))
    paths = {name: tmp_path / f"{name}.wav" for name in ("mix", "vocals", "instrumental")}
    sf.write(str(paths["mix"]), np.stack([vocals + backing] * 2, axis=1), RATE, subtype="FLOAT")
    sf.write(str(paths["vocals"]), vocals, RATE, subtype="FLOAT")
    sf.write(str(paths["instrumental"]), backing, RATE, subtype="FLOAT")
    return paths, vocals, backing


def test_si_sdr_measures_the_distortion_level():
    rng = np.random.default_rng(1)
    reference = np.sin(2 * np.pi * 3 * np.arange(8000) / 8000)
    noise = rng.standard_normal(len(reference))
    noise *= np.sqrt(np.mean(reference**2) / np.mean(noise**2)) / np.sqrt(10)  # 10 dB below
    assert bench.si_sdr(reference + noise, reference) == pytest.approx(10.0, abs=0.5)
    assert bench.si_sdr(3.0 * reference, reference) > 60  # loudness does not matter
    assert bench.si_sdr(reference, np.zeros(100)) is None


def test_the_backing_reference_defaults_to_the_mix_minus_the_vocals(stems):
    paths, _, backing = stems
    refs, rate = bench.references(paths["mix"], paths["vocals"], None)
    assert rate == RATE
    np.testing.assert_allclose(refs["instrumental"], backing, atol=1e-5)
    resampled, new_rate = bench.load_mono(paths["vocals"], 16000)
    assert (new_rate, len(resampled)) == (16000, 2 * len(backing))


def test_each_preset_is_separated_and_scored(stems, tmp_path, monkeypatch, capsys):
    paths, vocals, backing = stems
    noise_levels = {"fast": 0.1, "balanced": 0.02}
    calls = []

    def fake_separate(self, audio_path, track_id, model_name="htdemucs", **kwargs):
        calls.append((audio_path, track_id, model_name))
        if model_name == "best":
            raise RuntimeError("audio-separator is not installed")
        rng = np.random.default_rng(len(calls))
        target = self.output_base_dir / track_id
        target.mkdir(parents=True, exist_ok=True)
        level = noise_levels[model_name]
        out = {}
        for name, clean in (("vocals", vocals), ("instrumental", backing)):
            out[f"{name}_path"] = str(target / f"{name}.wav")
            noisy = clean + level * rng.standard_normal(len(clean))
            sf.write(out[f"{name}_path"], noisy, RATE, subtype="FLOAT")
        out["separation"] = {"label": f"{model_name.title()} engine", "fallback_reason": None}
        return out

    monkeypatch.setattr(AudioSeparator, "separate_stems", fake_separate)
    results_path, keep = tmp_path / "results.json", tmp_path / "kept"
    code = bench.main(
        [
            "--mix",
            str(paths["mix"]),
            "--vocals",
            str(paths["vocals"]),
            "--instrumental",
            str(paths["instrumental"]),
            "--keep",
            str(keep),
            "--json",
            str(results_path),
        ]
    )

    assert code == 0
    assert [call[2] for call in calls] == ["fast", "balanced", "best"]
    results = json.loads(results_path.read_text())
    fast, balanced = results["fast"], results["balanced"]
    assert balanced["engine_used"] == "Balanced engine"
    assert balanced["vocals_si_sdr_db"] > fast["vocals_si_sdr_db"] + 10
    assert balanced["instrumental_si_sdr_db"] > fast["instrumental_si_sdr_db"] + 10
    assert results["best"] == {"error": "audio-separator is not installed"}
    assert (keep / "fast" / "vocals.wav").is_file()
    printed = capsys.readouterr()
    assert "vocals_si_sdr_db" in printed.out
    assert "note: best failed: audio-separator is not installed" in printed.err


def test_the_tool_fails_when_no_preset_could_run(stems, monkeypatch):
    paths, _, _ = stems

    def broken(self, *args, **kwargs):
        raise RuntimeError("Demucs failed (exit 1)")

    monkeypatch.setattr(AudioSeparator, "separate_stems", broken)
    argv = ["--mix", str(paths["mix"]), "--vocals", str(paths["vocals"]), "--presets", "fast"]
    assert bench.main(argv) == 1
