import logging
from typing import Any

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


class AudioAligner:
    """
    Performs word-level forced audio alignment between vocals and lyric text.
    Combines vocal activity energy detection with acoustic alignment.
    """

    def align_lyrics(self, vocals_path: str, lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Refines line and word-level timestamps using acoustic envelope of isolated vocals.
        Safe against empty, silent, stereo, or corrupted audio inputs.
        """
        if not lines:
            return []

        try:
            # 1. Read vocals audio safely
            try:
                audio_data, sample_rate = sf.read(vocals_path)
            except Exception as read_err:
                logger.warning(
                    f"Failed to read vocal audio from {vocals_path}: {read_err}. Falling back to default timing."
                )
                return self._fallback_distribute_words(lines)

            if sample_rate <= 0:
                sample_rate = 44100

            # 2. Resilient stereo / multichannel to mono conversion
            mono_audio = np.mean(audio_data, axis=-1) if audio_data.ndim > 1 else audio_data

            # Sanitize any NaN or Inf values from corrupted decodes
            mono_audio = np.nan_to_num(mono_audio, nan=0.0, posinf=0.0, neginf=0.0)
            duration = float(len(mono_audio) / sample_rate) if len(mono_audio) > 0 else 0.0

            logger.info(
                f"Loaded vocals for alignment: {duration:.2f}s, sample rate {sample_rate}Hz"
            )

            # 3. Calculate short-time RMS energy (frame size = 20ms, hop size = 10ms)
            frame_length = max(1, int(0.02 * sample_rate))
            hop_length = max(1, int(0.01 * sample_rate))
            sq_audio = mono_audio**2

            # Guard against empty audio: prevent np.mean([]) warnings and NaN propagation
            if len(sq_audio) == 0:
                norm_energy = np.zeros(0, dtype=np.float32)
            elif len(sq_audio) < frame_length:
                avg_val = float(np.mean(sq_audio)) if len(sq_audio) > 0 else 0.0
                norm_energy = np.array([avg_val], dtype=np.float32)
            else:
                num_frames = max(1, (len(sq_audio) - frame_length) // hop_length)
                energy = np.zeros(num_frames, dtype=np.float32)
                for i in range(num_frames):
                    start = i * hop_length
                    end = start + frame_length
                    window = sq_audio[start:end]
                    energy[i] = float(np.mean(window)) if len(window) > 0 else 0.0

                # Smooth energy envelope if sufficient frames exist
                if len(energy) >= 5:
                    kernel = np.ones(5, dtype=np.float32) / 5.0
                    energy = np.convolve(energy, kernel, mode="same")

                # Defensive normalization: guard against pure silence and NaN
                max_energy = float(np.nanmax(energy)) if len(energy) > 0 else 0.0
                if np.isnan(max_energy) or max_energy <= 1e-9:
                    norm_energy = np.zeros_like(energy)
                else:
                    norm_energy = np.nan_to_num(
                        energy / max_energy, nan=0.0, posinf=0.0, neginf=0.0
                    )

            # 4. Check if lines are un-timed plain text (both start and end are 0.0)
            all_zero = len(lines) > 0 and all(
                float(line.get("start_time", 0.0)) == 0.0
                and float(line.get("end_time", 0.0)) == 0.0
                for line in lines
            )

            if all_zero:
                # Distribute lines across active vocal regions or audio duration
                active_frames = (
                    np.where(norm_energy > 0.05)[0] if len(norm_energy) > 0 else np.array([])
                )
                if len(active_frames) > 0:
                    first_active_sec = (active_frames[0] * hop_length) / sample_rate
                    last_active_sec = (active_frames[-1] * hop_length) / sample_rate
                else:
                    if duration > 10.0:
                        first_active_sec = 2.0
                        last_active_sec = max(first_active_sec + 2.0, duration - 2.0)
                    elif duration > 0.0:
                        first_active_sec = 0.0
                        last_active_sec = duration
                    else:
                        first_active_sec = 0.0
                        last_active_sec = 10.0

                total_singing_time = max(1.0, last_active_sec - first_active_sec)
                line_dur = total_singing_time / max(1, len(lines))

                working_lines = []
                for i, line in enumerate(lines):
                    l_copy = dict(line)
                    l_start = first_active_sec + (i * line_dur)
                    l_end = l_start + (line_dur * 0.95)
                    l_copy["start_time"] = round(l_start, 3)
                    l_copy["end_time"] = round(l_end, 3)
                    working_lines.append(l_copy)
            else:
                working_lines = [dict(line_item) for line_item in lines]

            # 5. Align words for each line with syllable weighting and energy onsets
            aligned_lines = []
            for line in working_lines:
                l_start = float(line.get("start_time", 0.0))
                l_end = float(line.get("end_time", l_start + 4.0))
                if l_end <= l_start:
                    l_end = l_start + 0.5

                text = str(line.get("text", "")).strip()
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

                # Locate vocal energy envelope slice for this line's window
                if len(norm_energy) > 0 and sample_rate > 0 and hop_length > 0:
                    f_start = int((l_start * sample_rate) / hop_length)
                    f_end = int((l_end * sample_rate) / hop_length)
                    f_start = max(0, min(len(norm_energy) - 1, f_start))
                    f_end = max(f_start + 1, min(len(norm_energy), f_end))
                    line_energy = norm_energy[f_start:f_end]
                else:
                    line_energy = np.zeros(0, dtype=np.float32)
                    f_start = 0

                # Syllable-aware weights based on character length and vowel density
                word_weights = [
                    max(1, len(w) + (2 if any(c in "aeiouyAEIOUY" for c in w) else 0))
                    for w in words
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

                    # Active energy boundary refinement pass
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
                                # Nudge start boundary towards acoustic onset (capped at 25% duration)
                                w_start = cur_time + min(onset_sec, base_dur * 0.25)

                    w_start = max(cur_time, w_start)
                    rem_words = len(words) - 1 - idx
                    max_allowed_end = l_end - (rem_words * min_word_dur)
                    w_end = min(max_allowed_end, w_start + base_dur)

                    if w_end <= w_start:
                        w_end = w_start + min_word_dur
                    if idx == len(words) - 1:
                        w_end = max(w_start + min_word_dur, l_end)

                    w_start_r = round(w_start, 3)
                    w_end_r = round(max(w_start + 0.001, w_end), 3)
                    cur_time = w_end_r

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

        except Exception as e:
            logger.error(f"Error during audio alignment: {e}", exc_info=True)
            return self._fallback_distribute_words(lines)

    def _fallback_distribute_words(self, lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Graceful fallback when audio analysis fails: distributes words evenly across line timestamps.
        """
        fallback_lines = []
        for line in lines:
            l_start = float(line.get("start_time", 0.0))
            l_end = float(line.get("end_time", l_start + 4.0))
            if l_end <= l_start:
                l_end = l_start + 1.0

            text = str(line.get("text", "")).strip()
            words = [w for w in text.split() if w]
            aligned_words = []

            if words:
                dur_per_word = (l_end - l_start) / len(words)
                for i, w in enumerate(words):
                    w_s = l_start + (i * dur_per_word)
                    w_e = w_s + dur_per_word
                    aligned_words.append(
                        {"word": w, "start_time": round(w_s, 3), "end_time": round(w_e, 3)}
                    )

            fallback_lines.append(
                {
                    "id": line.get("id", len(fallback_lines)),
                    "text": text,
                    "start_time": round(l_start, 3),
                    "end_time": round(l_end, 3),
                    "words": aligned_words,
                }
            )
        return fallback_lines
