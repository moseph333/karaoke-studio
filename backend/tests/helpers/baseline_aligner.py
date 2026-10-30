"""The aligner as it worked before word-level alignment (character-weighted words chained
back to back across each line), kept as the baseline the alignment benchmarks measure the
current aligner against."""

import re
from typing import Any

import numpy as np
import soundfile as sf


def baseline_align_lyrics(vocals_path: str, lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Reference baseline implementation reflecting the pre-Milestone 3 aligner logic:
    - Character-length biased weighting: len(w) + (2 if vowel in w else 0)
    - Full-line window base duration allocation without pause detection
    - Back-to-back chaining: cur_time = w_end_r
    - Hardcoded final word stretching: if idx == len(words) - 1: w_end = max(w_start + min_word_dur, l_end)
    """
    audio_data, sample_rate = sf.read(vocals_path)
    mono_audio = np.mean(audio_data, axis=-1) if audio_data.ndim > 1 else audio_data
    mono_audio = np.nan_to_num(mono_audio, nan=0.0, posinf=0.0, neginf=0.0)

    frame_length = max(1, int(0.02 * sample_rate))
    hop_length = max(1, int(0.01 * sample_rate))
    sq_audio = mono_audio**2

    if len(sq_audio) == 0:
        norm_energy = np.zeros(0, dtype=np.float32)
    elif len(sq_audio) < frame_length:
        avg_val = float(np.mean(sq_audio)) if len(sq_audio) > 0 else 0.0
        norm_energy = np.array([avg_val], dtype=np.float32)
    else:
        num_frames = max(1, (len(sq_audio) - frame_length) // hop_length)
        cum_sq = np.concatenate(([0.0], np.cumsum(sq_audio, dtype=np.float64)))
        starts = np.arange(num_frames) * hop_length
        ends = starts + frame_length
        energy = ((cum_sq[ends] - cum_sq[starts]) / frame_length).astype(np.float32)
        if len(energy) >= 5:
            kernel = np.ones(5, dtype=np.float32) / 5.0
            energy = np.convolve(energy, kernel, mode="same")
        max_energy = float(np.nanmax(energy)) if len(energy) > 0 else 0.0
        norm_energy = (
            np.zeros_like(energy)
            if (np.isnan(max_energy) or max_energy <= 1e-9)
            else np.nan_to_num(energy / max_energy, nan=0.0, posinf=0.0, neginf=0.0)
        )

    aligned_lines = []
    for line in lines:
        l_start = float(line.get("start_time", 0.0))
        l_end = float(line.get("end_time", l_start + 4.0))
        if l_end <= l_start:
            l_end = l_start + 0.5

        text = str(line.get("text", "")).strip()
        text = re.sub(r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        words = [w for w in text.split() if w]
        if not words:
            aligned_lines.append(
                {
                    "id": line.get("id", len(aligned_lines)),
                    "text": text,
                    "start_time": round(l_start, 3),
                    "end_time": round(l_end, 3),
                    "words": [],
                }
            )
            continue

        if len(norm_energy) > 0 and sample_rate > 0 and hop_length > 0:
            f_start = int((l_start * sample_rate) / hop_length)
            f_end = int((l_end * sample_rate) / hop_length)
            f_start = max(0, min(len(norm_energy) - 1, f_start))
            f_end = max(f_start + 1, min(len(norm_energy), f_end))
            line_energy = norm_energy[f_start:f_end]
        else:
            line_energy = np.zeros(0, dtype=np.float32)
            f_start = 0

        # Baseline: Character count dominant
        word_weights = [
            max(1, len(w) + (2 if any(c in "aeiouyAEIOUY" for c in w) else 0)) for w in words
        ]
        total_weight = sum(word_weights)
        total_line_dur = max(0.1, l_end - l_start)
        min_word_dur = min(0.04, total_line_dur / len(words))

        aligned_words = []
        cur_time = l_start
        for idx, w in enumerate(words):
            w_weight = word_weights[idx]
            base_dur = (w_weight / total_weight) * total_line_dur
            w_start = cur_time

            if len(line_energy) > 0:
                w_f_start = max(
                    0,
                    min(
                        len(line_energy),
                        int((cur_time * sample_rate) / hop_length) - f_start,
                    ),
                )
                w_f_end = max(
                    w_f_start,
                    min(
                        len(line_energy),
                        int(((cur_time + base_dur) * sample_rate) / hop_length) - f_start,
                    ),
                )
                local_energy = line_energy[w_f_start:w_f_end]
                if len(local_energy) > 0 and float(np.mean(local_energy)) > 0.02:
                    active_indices = np.where(local_energy > 0.03)[0]
                    if len(active_indices) > 0:
                        onset_frame = active_indices[0]
                        onset_sec = (onset_frame * hop_length) / sample_rate
                        w_start = cur_time + min(onset_sec, base_dur * 0.25)

            w_start = max(cur_time, w_start)
            rem_words = len(words) - 1 - idx
            max_allowed_end = l_end - (rem_words * min_word_dur)
            w_end = min(max_allowed_end, w_start + base_dur)

            if w_end <= w_start:
                w_end = w_start + min_word_dur
            if idx == len(words) - 1:
                # ROOT CAUSE BUG in baseline: Stretches final word across trailing silence to l_end
                w_end = max(w_start + min_word_dur, l_end)

            w_start_r = round(w_start, 3)
            w_end_r = round(max(w_start + 0.001, w_end), 3)
            cur_time = w_end_r  # Back-to-back chaining eliminates intra-line gaps

            aligned_words.append({"word": w, "start_time": w_start_r, "end_time": w_end_r})

        aligned_lines.append(
            {
                "id": line.get("id", len(aligned_lines)),
                "text": text,
                "start_time": round(l_start, 3),
                "end_time": round(l_end, 3),
                "words": aligned_words,
            }
        )

    return aligned_lines
