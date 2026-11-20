"""Summing the kept vocal parts into one file for the mixer."""

import numpy as np
import pytest
import soundfile as sf

from backend.services.vocal_mix import MixPlan, PartMix, write_kept_vocals
from backend.tests.helpers.split_songs import wav

RATE = 8000


def _read(path):
    data, rate = sf.read(str(path), dtype="float32", always_2d=True)
    return data, rate


def test_parts_are_summed_each_at_its_gain(tmp_path):
    lead = wav(tmp_path / "lead.wav", 0.2, seconds=1.0)
    backing = wav(tmp_path / "backing.wav", 0.4, seconds=1.0)
    plan = MixPlan(0.0, "k", (PartMix(str(lead), 0.5), PartMix(str(backing), 1.0)))

    out = write_kept_vocals(plan, tmp_path / "kept.wav")

    data, rate = _read(out)
    assert (rate, data.shape) == (RATE, (RATE, 2))
    assert np.allclose(data, 0.2 * 0.5 + 0.4, atol=1e-4)
    assert sf.info(str(out)).subtype == "FLOAT"


def test_a_sum_past_full_scale_is_not_clipped(tmp_path):
    loud = wav(tmp_path / "a.wav", 0.8)
    louder = wav(tmp_path / "b.wav", 0.7)
    plan = MixPlan(0.0, "k", (PartMix(str(loud)), PartMix(str(louder))))

    data, _ = _read(write_kept_vocals(plan, tmp_path / "kept.wav"))

    assert np.allclose(data, 1.5, atol=1e-4)


def test_a_gated_part_follows_its_curve_sample_by_sample(tmp_path):
    lead = wav(tmp_path / "lead.wav", 0.5, seconds=4.0)
    gate = ((0.0, 0.0), (1.0, 0.0), (2.0, 1.0), (4.0, 1.0))
    plan = MixPlan(0.0, "k", (PartMix(str(lead), 1.0, gate),))

    data, _ = _read(write_kept_vocals(plan, tmp_path / "kept.wav"))

    assert np.allclose(data[: RATE - 1], 0.0, atol=1e-6)
    assert data[int(1.5 * RATE), 0] == pytest.approx(0.25, abs=1e-3)
    assert np.allclose(data[2 * RATE :], 0.5, atol=1e-4)
    # A fade, not a step
    assert np.all(np.diff(data[RATE : 2 * RATE, 0]) >= 0)


def test_a_curve_crosses_block_boundaries_without_a_seam(tmp_path, monkeypatch):
    monkeypatch.setattr("backend.services.vocal_mix._BLOCK_FRAMES", 1000)
    lead = wav(tmp_path / "lead.wav", 1.0, seconds=1.0)
    gate = ((0.0, 0.0), (1.0, 1.0))
    plan = MixPlan(0.0, "k", (PartMix(str(lead), 1.0, gate),))

    data, _ = _read(write_kept_vocals(plan, tmp_path / "kept.wav"))

    assert np.allclose(data[:, 0], np.arange(RATE) / RATE, atol=1e-4)


def test_a_shorter_part_ends_in_silence_and_a_mono_part_fills_both_channels(tmp_path):
    long_part = wav(tmp_path / "long.wav", 0.2, seconds=1.0)
    short_mono = tmp_path / "short.wav"
    sf.write(str(short_mono), np.full(RATE // 2, 0.3, dtype="float32"), RATE)
    plan = MixPlan(0.0, "k", (PartMix(str(long_part)), PartMix(str(short_mono))))

    data, _ = _read(write_kept_vocals(plan, tmp_path / "kept.wav"))

    assert data.shape == (RATE, 2)
    assert np.allclose(data[: RATE // 2], 0.5, atol=1e-4)
    assert np.allclose(data[RATE // 2 :], 0.2, atol=1e-4)


def test_parts_at_different_sample_rates_cannot_be_summed(tmp_path):
    one = wav(tmp_path / "a.wav", 0.1)
    other = wav(tmp_path / "b.wav", 0.1, rate=16000)
    plan = MixPlan(0.0, "k", (PartMix(str(one)), PartMix(str(other))))

    with pytest.raises(RuntimeError, match="disagree on sample rate"):
        write_kept_vocals(plan, tmp_path / "kept.wav")

    with pytest.raises(RuntimeError, match="No vocal part"):
        write_kept_vocals(MixPlan(0.0, "k"), tmp_path / "none.wav")
