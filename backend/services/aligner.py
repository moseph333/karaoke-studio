import logging
import math
import re
from typing import Any

import numpy as np
import soundfile as sf

logger = logging.getLogger(__name__)


def count_syllables(word: str) -> int:
    """
    Estimates the number of syllables in an English/Western word using phonetic regex rules.
    Counts vowel clusters, accounts for silent trailing 'e', past-tense '-ed', and '-le' endings.
    Deterministic, pure Python, zero external dependencies.
    """
    clean = re.sub(r"[^a-zA-Z]", "", word).lower()
    if not clean or len(clean) <= 2:
        return 1
    vowels = "aeiouy"
    count = 0
    prev_v = False
    for c in clean:
        is_v = c in vowels
        if is_v and not prev_v:
            count += 1
        prev_v = is_v
    # Adjust for silent trailing 'e' (unless ending in '-le' or '-ee')
    if clean.endswith("e") and not clean.endswith("le") and not clean.endswith("ee") and count > 1:
        count -= 1
    # Adjust for past tense '-ed'
    if (
        clean.endswith("ed")
        and count > 1
        and not clean.endswith("ted")
        and not clean.endswith("ded")
    ):
        count -= 1
    return max(1, count)


def calculate_word_weight(word: str) -> float:
    """
    Calculates word duration weight: count_syllables(w) * 3.0 + len(clean) * 0.2.
    Adds a punctuation pause bonus (+1.0) for terminal punctuation (, . ! ? ; :).
    """
    clean = re.sub(r"[^a-zA-Z]", "", word).lower()
    syl = count_syllables(word)
    weight = syl * 3.0 + len(clean) * 0.2
    stripped = word.strip()
    if stripped and stripped[-1] in ",.!?;:":
        weight += 1.0
    return max(0.5, float(weight))


def enforce_monotonic_words(
    words: list[str],
    raw_spans: list[tuple[float, float]],
    l_start: float,
    l_end: float,
) -> list[dict[str, Any]]:
    """
    Enforces strict timestamp monotonicity (start_time < end_time, non-overlapping,
    finite non-negative floats) across all words within the line window [l_start, l_end].
    Preserves intra-line pauses when raw_spans have gaps (raw_start > prev_end),
    while preventing any overlaps or out-of-order timestamps.
    """
    n = len(words)
    if n == 0:
        return []

    if not math.isfinite(l_start) or l_start < 0.0:
        l_start = 0.0
    if not math.isfinite(l_end) or l_end <= l_start:
        l_end = l_start + max(0.5, 0.05 * n)

    total_dur = l_end - l_start
    min_dur = max(0.001, min(0.020, total_dur / (n * 1.5)))

    result = []
    cur_time = l_start

    for i, w in enumerate(words):
        rem = n - 1 - i
        max_allowed_end = l_end - (rem * min_dur)

        s_cand, e_cand = raw_spans[i] if i < len(raw_spans) else (cur_time, cur_time + min_dur)
        if not math.isfinite(s_cand):
            s_cand = cur_time
        if not math.isfinite(e_cand):
            e_cand = s_cand + min_dur

        # Clamp start time: cannot precede previous word end, must leave room for remainder
        s = max(cur_time, s_cand)
        s = min(s, max_allowed_end - min_dur)

        # Clamp end time: must be at least s + min_dur, cannot exceed max_allowed_end
        e = max(s + min_dur, e_cand)
        e = min(e, max_allowed_end)
        if e <= s:
            e = s + min_dur

        s_r = round(s, 3)
        e_r = round(max(s_r + 0.001, e), 3)
        cur_time = e_r

        result.append({"word": w, "start_time": s_r, "end_time": e_r})

    return result


class AudioAligner:
    """
    Performs word-level forced audio alignment between vocals and lyric text.
    Combines vocal activity energy detection with acoustic alignment, syllable weighting,
    intra-line pause detection, and strict monotonicity enforcement.
    """

    count_syllables = staticmethod(count_syllables)
    calculate_word_weight = staticmethod(calculate_word_weight)
    enforce_monotonic_words = staticmethod(enforce_monotonic_words)

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

            # 2. Resilient stereo / multichannel to mono conversion (vectorized fast path)
            if audio_data.ndim == 2:
                mono_audio = 0.5 * (audio_data[:, 0] + audio_data[:, 1])
            elif audio_data.ndim > 2:
                mono_audio = np.mean(audio_data, axis=-1)
            else:
                mono_audio = audio_data

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
                cum_sq = np.concatenate(([0.0], np.cumsum(sq_audio, dtype=np.float64)))
                starts = np.arange(num_frames) * hop_length
                ends = starts + frame_length
                energy = ((cum_sq[ends] - cum_sq[starts]) / frame_length).astype(np.float32)

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
                phrases = self._detect_vocal_phrases(norm_energy, sample_rate, hop_length)
                working_lines = self._partition_lines_into_phrases(lines, phrases, duration)
            else:
                working_lines = [dict(line_item) for line_item in lines]

            # 5. Align words for each line with syllable weighting and acoustic energy
            aligned_lines = []
            for line in working_lines:
                l_start = float(line.get("start_time", 0.0))
                l_end = float(line.get("end_time", l_start + 4.0))
                if l_end <= l_start:
                    l_end = l_start + 0.5

                text = str(line.get("text", "")).strip()
                text = re.sub(
                    r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", text
                )
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
                            "singer": line.get("singer", "singer1"),
                        }
                    )
                    continue

                # Preserve explicit word timestamps if line already has word-level sync
                if line.get("has_word_sync") and line.get("words"):
                    clean_words = []
                    for w in line.get("words", []):
                        cw = re.sub(
                            r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>",
                            "",
                            str(w.get("word", "")),
                        ).strip()
                        clean_words.append(
                            {
                                "word": cw,
                                "start_time": float(w.get("start_time", 0.0)),
                                "end_time": float(w.get("end_time", 0.0)),
                            }
                        )
                    aligned_lines.append(
                        {
                            "id": line.get("id", len(aligned_lines)),
                            "text": text,
                            "start_time": round(l_start, 3),
                            "end_time": round(l_end, 3),
                            "words": clean_words,
                            "singer": line.get("singer", "singer1"),
                            "has_word_sync": True,
                        }
                    )
                    continue

                aligned_words = self._align_line_words(
                    words=words,
                    l_start=l_start,
                    l_end=l_end,
                    norm_energy=norm_energy,
                    sample_rate=sample_rate,
                    hop_length=hop_length,
                )

                aligned_lines.append(
                    {
                        "id": line.get("id", len(aligned_lines)),
                        "text": text,
                        "start_time": round(l_start, 3),
                        "end_time": round(l_end, 3),
                        "words": aligned_words,
                        "singer": line.get("singer", "singer1"),
                    }
                )

            return aligned_lines

        except Exception as e:
            logger.error(f"Error during audio alignment: {e}", exc_info=True)
            return self._fallback_distribute_words(lines)

    def _align_line_words(
        self,
        words: list[str],
        l_start: float,
        l_end: float,
        norm_energy: np.ndarray,
        sample_rate: int,
        hop_length: int,
    ) -> list[dict[str, Any]]:
        """
        Aligns words within a line window using acoustic energy envelopes, rule-based
        syllable weighting, intra-line vocal pause detection, and termination snapping.
        """
        n_words = len(words)
        if n_words == 0:
            return []

        weights = [calculate_word_weight(w) for w in words]

        # Extract energy slice for this line window
        if len(norm_energy) > 0 and sample_rate > 0 and hop_length > 0:
            f_start = int((l_start * sample_rate) / hop_length)
            f_end = int((l_end * sample_rate) / hop_length)
            f_start = max(0, min(len(norm_energy) - 1, f_start))
            f_end = max(f_start + 1, min(len(norm_energy), f_end))
            line_energy = norm_energy[f_start:f_end]
        else:
            line_energy = np.zeros(0, dtype=np.float32)

        peak_e = float(np.max(line_energy)) if len(line_energy) > 0 else 0.0
        floor_e = float(np.percentile(line_energy, 10)) if len(line_energy) > 0 else 0.0
        delta_e = peak_e - floor_e

        # Fallback if audio is silent or energy is flat
        if delta_e < 0.01:
            tot_w = sum(weights)
            tot_dur = max(0.1, l_end - l_start)
            raw_spans = []
            cur_t = l_start
            for wt in weights:
                dur = tot_dur * (wt / tot_w) if tot_w > 0 else tot_dur / n_words
                raw_spans.append((cur_t, cur_t + dur))
                cur_t += dur
            return enforce_monotonic_words(words, raw_spans, l_start, l_end)

        t_active = floor_e + 0.08 * delta_e
        is_active = line_energy > t_active

        if not np.any(is_active):
            tot_w = sum(weights)
            tot_dur = max(0.1, l_end - l_start)
            raw_spans = []
            cur_t = l_start
            for wt in weights:
                dur = tot_dur * (wt / tot_w) if tot_w > 0 else tot_dur / n_words
                raw_spans.append((cur_t, cur_t + dur))
                cur_t += dur
            return enforce_monotonic_words(words, raw_spans, l_start, l_end)

        padded = np.pad(is_active.astype(np.int8), (1, 1), mode="constant")
        diff = np.diff(padded)
        s_fr = np.where(diff == 1)[0]
        e_fr = np.where(diff == -1)[0]
        runs = [
            (
                float(l_start + s * hop_length / sample_rate),
                float(l_start + e * hop_length / sample_rate),
            )
            for s, e in zip(s_fr, e_fr, strict=False)
        ]

        # Bridge micro-pauses (< 0.20s)
        min_pause = 0.20
        bridged_runs: list[tuple[float, float]] = []
        cur_s, cur_e = runs[0]
        for next_s, next_e in runs[1:]:
            if next_s - cur_e < min_pause:
                cur_e = max(cur_e, next_e)
            else:
                bridged_runs.append((cur_s, cur_e))
                cur_s, cur_e = next_s, next_e
        bridged_runs.append((cur_s, cur_e))

        # Add 80ms release hangover tail
        hangover = 0.08
        bursts: list[tuple[float, float]] = []
        for b_s, b_e in bridged_runs:
            bursts.append((b_s, min(l_end, b_e + hangover)))

        # Evaluate trailing silence on last burst: snap if >= 0.25s, else stretch to l_end
        trailing_silence = l_end - bursts[-1][1]
        if trailing_silence < 0.25:
            bursts[-1] = (bursts[-1][0], l_end)

        # Evaluate leading silence on first burst: snap to l_start if < 0.20s
        leading_silence = bursts[0][0] - l_start
        if leading_silence < 0.20:
            bursts[0] = (l_start, bursts[0][1])

        # Resolve any accidental overlaps between bursts caused by hangover
        clean_bursts: list[tuple[float, float]] = []
        for b_s, b_e in bursts:
            if clean_bursts and b_s < clean_bursts[-1][1]:
                clean_bursts[-1] = (clean_bursts[-1][0], max(clean_bursts[-1][1], b_e))
            else:
                clean_bursts.append((b_s, b_e))
        bursts = clean_bursts

        # If more bursts than words, merge closest bursts until B <= n_words
        while len(bursts) > n_words:
            min_gap_idx = 0
            min_gap = bursts[1][0] - bursts[0][1]
            for idx in range(1, len(bursts) - 1):
                gap = bursts[idx + 1][0] - bursts[idx][1]
                if gap < min_gap:
                    min_gap = gap
                    min_gap_idx = idx
            merged = (bursts[min_gap_idx][0], bursts[min_gap_idx + 1][1])
            bursts = [*bursts[:min_gap_idx], merged, *bursts[min_gap_idx + 2 :]]

        num_bursts = len(bursts)
        d_k_list = [max(0.01, b[1] - b[0]) for b in bursts]
        d_tot = sum(d_k_list)
        w_tot = sum(weights)

        # Partition words across bursts
        if num_bursts == 1:
            splits = [0, n_words]
        elif num_bursts == n_words:
            splits = list(range(n_words + 1))
        else:
            p_weights = [0.0] * (n_words + 1)
            for j in range(n_words):
                p_weights[j + 1] = p_weights[j] + weights[j]
            targets = [w_tot * (d / d_tot) for d in d_k_list]
            dp = np.full((n_words + 1, num_bursts + 1), np.inf, dtype=np.float64)
            parent = np.full((n_words + 1, num_bursts + 1), -1, dtype=np.int32)
            dp[0, 0] = 0.0
            for k in range(1, num_bursts + 1):
                target = targets[k - 1]
                for i in range(k, n_words - (num_bursts - k) + 1):
                    for j in range(k - 1, i):
                        block_w = p_weights[i] - p_weights[j]
                        cost = dp[j, k - 1] + (block_w - target) ** 2
                        if cost < dp[i, k]:
                            dp[i, k] = cost
                            parent[i, k] = j
            curr = n_words
            splits = [n_words]
            for k in range(num_bursts, 0, -1):
                prev = int(parent[curr, k])
                splits.append(prev)
                curr = prev
            splits.reverse()

        raw_spans: list[tuple[float, float]] = []
        for k in range(num_bursts):
            w_slice = weights[splits[k] : splits[k + 1]]
            b_s, b_e = bursts[k]
            d_burst = max(0.01, b_e - b_s)
            w_slice_tot = sum(w_slice)
            cur_t = b_s
            for widx, wt in enumerate(w_slice):
                dur = d_burst * (wt / w_slice_tot) if w_slice_tot > 0 else d_burst / len(w_slice)
                w_start = cur_t
                w_end = cur_t + dur
                if widx == len(w_slice) - 1:
                    w_end = b_e
                raw_spans.append((w_start, w_end))
                cur_t = w_end

        return enforce_monotonic_words(words, raw_spans, l_start, l_end)

    def _fallback_distribute_words(self, lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Graceful fallback when audio analysis fails: distributes words proportionally across line timestamps.
        """
        fallback_lines = []
        for line in lines:
            l_start = float(line.get("start_time", 0.0))
            l_end = float(line.get("end_time", l_start + 4.0))
            if l_end <= l_start:
                l_end = l_start + 1.0

            text = str(line.get("text", "")).strip()
            text = re.sub(
                r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", text
            )
            text = re.sub(r"\s+", " ", text).strip()
            words = [w for w in text.split() if w]
            aligned_words = []

            if words:
                weights = [calculate_word_weight(w) for w in words]
                tot_w = sum(weights)
                tot_dur = l_end - l_start
                raw_spans = []
                cur_t = l_start
                for wt in weights:
                    dur = tot_dur * (wt / tot_w) if tot_w > 0 else tot_dur / len(words)
                    raw_spans.append((cur_t, cur_t + dur))
                    cur_t += dur
                aligned_words = enforce_monotonic_words(words, raw_spans, l_start, l_end)

            fallback_lines.append(
                {
                    "id": line.get("id", len(fallback_lines)),
                    "text": text,
                    "start_time": round(l_start, 3),
                    "end_time": round(l_end, 3),
                    "words": aligned_words,
                    "singer": line.get("singer", "singer1"),
                }
            )
        return fallback_lines

    def _compute_line_weight(self, line: dict[str, Any]) -> float:
        """
        Computes line weight based on rule-based syllable counting and word length:
        W(L_m) = sum_{w in L_m} (count_syllables(w) * 3.0 + len(clean) * 0.2).
        Acts as a robust proxy for sung/spoken duration.
        """
        text = str(line.get("text", "")).strip()
        text = re.sub(r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", text)
        text = re.sub(r"\s+", " ", text).strip()
        words = [w for w in text.split() if w]
        if not words:
            return 1.0
        weight = sum(calculate_word_weight(w) for w in words)
        return max(1.0, float(weight))

    def _detect_vocal_phrases(
        self,
        norm_energy: np.ndarray,
        sample_rate: int,
        hop_length: int,
        min_gap_sec: float = 1.25,
    ) -> list[tuple[float, float]]:
        """
        Detects active singing phrases from normalized short-time vocal energy.
        Applies adaptive noise-floor thresholding, clusters contiguous active frames,
        bridges micro-pauses (< min_gap_sec), and prunes transient blips (< 0.35s).
        Preserves instrumental intros, interludes (>= 1.5s), and outros.
        """
        if len(norm_energy) == 0 or sample_rate <= 0 or hop_length <= 0:
            return []

        rms = np.sqrt(np.maximum(0.0, norm_energy))
        if float(np.max(rms)) <= 1e-6:
            return []

        # Smooth RMS using 100ms boxcar filter (10 frames at 10ms hop)
        smooth_win = max(1, int(0.10 * sample_rate / hop_length))
        if len(rms) >= smooth_win:
            kernel = np.ones(smooth_win, dtype=np.float32) / float(smooth_win)
            smooth_rms = np.convolve(rms, kernel, mode="same")
        else:
            smooth_rms = rms

        # Adaptive threshold: tau = clip(p10 + 0.025, 0.02, 0.06)
        p10 = float(np.percentile(smooth_rms, 10))
        tau = float(np.clip(p10 + 0.025, 0.02, 0.06))

        is_active = smooth_rms > tau
        if not np.any(is_active):
            return []

        # Extract contiguous runs of active frames
        padded = np.pad(is_active.astype(np.int8), (1, 1), mode="constant", constant_values=0)
        diff = np.diff(padded)
        start_frames = np.where(diff == 1)[0]
        end_frames = np.where(diff == -1)[0]

        raw_intervals: list[tuple[float, float]] = []
        for s, e in zip(start_frames, end_frames, strict=False):
            t_s = float(s * hop_length / sample_rate)
            t_e = float(e * hop_length / sample_rate)
            raw_intervals.append((t_s, t_e))

        if not raw_intervals:
            return []

        # Bridge micro-pauses (< min_gap_sec)
        merged: list[tuple[float, float]] = []
        cur_start, cur_end = raw_intervals[0]
        for next_s, next_e in raw_intervals[1:]:
            if next_s - cur_end < min_gap_sec:
                cur_end = max(cur_end, next_e)
            else:
                merged.append((cur_start, cur_end))
                cur_start, cur_end = next_s, next_e
        merged.append((cur_start, cur_end))

        # Prune transient blips (< 0.35s)
        filtered = [p for p in merged if (p[1] - p[0]) >= 0.35]
        if not filtered and merged:
            filtered = [max(merged, key=lambda p: p[1] - p[0])]
        return filtered

    def _partition_lines_into_phrases(
        self,
        lines: list[dict[str, Any]],
        phrases: list[tuple[float, float]],
        duration: float,
    ) -> list[dict[str, Any]]:
        """
        Partitions M un-timed lyric lines across K detected vocal phrases.
        Weights line durations proportionally to spoken/sung content (syllable/vowel count).
        Handles M > K, M == K, M < K, and K == 0 (silent/unvoiced audio fallback).
        """
        if not lines:
            return []

        line_weights = [self._compute_line_weight(line_item) for line_item in lines]
        M = len(lines)
        K = len(phrases)

        # Case 1: K == 0 (Silent or unvoiced audio fallback)
        if K == 0:
            if duration > 10.0:
                first_sec = 2.0
                last_sec = max(4.0, duration - 2.0)
            elif duration > 0.0:
                first_sec = 0.0
                last_sec = duration
            else:
                first_sec = 0.0
                last_sec = 10.0

            total_dur = max(1.0, last_sec - first_sec)
            tot_w = sum(line_weights)
            working_lines = []
            cur_t = first_sec
            for i, line in enumerate(lines):
                l_copy = dict(line)
                dur = total_dur * (line_weights[i] / tot_w)
                l_s = cur_t
                l_e = l_s + dur * 0.95
                l_copy["start_time"] = round(l_s, 3)
                l_copy["end_time"] = round(l_e, 3)
                if l_copy["end_time"] <= l_copy["start_time"]:
                    l_copy["end_time"] = round(l_copy["start_time"] + 0.05, 3)
                working_lines.append(l_copy)
                cur_t += dur
            return working_lines

        # Case 4: M < K (Fewer lines than phrases -> merge closest phrases)
        curr_phrases = list(phrases)
        while len(curr_phrases) > M:
            min_gap_idx = 0
            min_gap_val = curr_phrases[1][0] - curr_phrases[0][1]
            for idx in range(1, len(curr_phrases) - 1):
                gap = curr_phrases[idx + 1][0] - curr_phrases[idx][1]
                if gap < min_gap_val:
                    min_gap_val = gap
                    min_gap_idx = idx
            merged_p = (curr_phrases[min_gap_idx][0], curr_phrases[min_gap_idx + 1][1])
            curr_phrases = [
                *curr_phrases[:min_gap_idx],
                merged_p,
                *curr_phrases[min_gap_idx + 2 :],
            ]

        K = len(curr_phrases)

        # Dynamic Programming Partitioning for M >= K
        P = [0.0] * (M + 1)
        for i in range(M):
            P[i + 1] = P[i] + line_weights[i]
        W_tot = P[M]

        phrase_durs = [max(0.1, p[1] - p[0]) for p in curr_phrases]
        D_tot = sum(phrase_durs)
        targets = [W_tot * (d / D_tot) for d in phrase_durs]

        dp = np.full((M + 1, K + 1), np.inf, dtype=np.float64)
        parent = np.full((M + 1, K + 1), -1, dtype=np.int32)
        dp[0, 0] = 0.0

        for k in range(1, K + 1):
            for i in range(k, M - (K - k) + 1):
                target = targets[k - 1]
                for j in range(k - 1, i):
                    block_w = P[i] - P[j]
                    cost = dp[j, k - 1] + (block_w - target) ** 2
                    if cost < dp[i, k]:
                        dp[i, k] = cost
                        parent[i, k] = j

        # Backtrack partition points
        curr = M
        splits = [M]
        for k in range(K, 0, -1):
            prev = int(parent[curr, k])
            splits.append(prev)
            curr = prev
        splits.reverse()

        working_lines = []
        for k in range(K):
            a = splits[k]
            b = splits[k + 1]
            S_k, E_k = curr_phrases[k]
            D_k = max(0.1, E_k - S_k)
            block_w = sum(line_weights[a:b])
            if block_w <= 0:
                block_w = 1.0

            cur_t = S_k
            for m in range(a, b):
                l_copy = dict(lines[m])
                dur = D_k * (line_weights[m] / block_w)
                l_s = cur_t
                l_e = l_s + dur * 0.96
                l_s = min(E_k - 0.01, l_s)
                l_e = min(E_k, max(l_s + 0.01, l_e))
                l_copy["start_time"] = round(l_s, 3)
                l_copy["end_time"] = round(l_e, 3)
                if l_copy["end_time"] <= l_copy["start_time"]:
                    l_copy["end_time"] = round(l_copy["start_time"] + 0.05, 3)
                working_lines.append(l_copy)
                cur_t += dur

        return working_lines
