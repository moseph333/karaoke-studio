import logging
import math
import re
from typing import Any

import numpy as np
import scipy.signal
import soundfile as sf

logger = logging.getLogger(__name__)


# Plain-lyrics fallback layout (no usable audio): sung duration per unit of line weight
# (roughly syllables * 3 + letters * 0.2), the shortest line, and the pause between lines
FALLBACK_SECONDS_PER_WEIGHT = 0.12
FALLBACK_MIN_LINE_SEC = 1.0
FALLBACK_LINE_GAP = 0.3
# Samples per block when summing frame energies (8 MB of float64 at a time)
_ENERGY_BLOCK = 1 << 20
# Frames per FFT batch in whole-track voicing analysis
_FFT_BATCH = 2048


def _frame_mean_square(
    mono: np.ndarray, frame_len: int, hop_len: int, num_frames: int
) -> np.ndarray:
    """Mean square of each frame (frames start every hop_len samples) as float32.

    Same result as differencing a running sum of squares over the whole track, but the
    sum is built a block at a time and only read at frame boundaries, so no track-sized
    float64 array is allocated (that allocation dominated alignment time on long songs).
    """
    starts = np.arange(num_frames, dtype=np.int64) * hop_len
    ends = starts + frame_len
    return (
        (_running_square_sum_at(mono, ends) - _running_square_sum_at(mono, starts)) / frame_len
    ).astype(np.float32)


def _signal_variance(signal: np.ndarray) -> float:
    """Variance of a whole track, accumulated in float64 a block at a time (no full-size
    temporary, unlike np.var)."""
    n = signal.size
    if n == 0:
        return 0.0
    total = total_sq = 0.0
    for start in range(0, n, _ENERGY_BLOCK):
        block = np.asarray(signal[start : start + _ENERGY_BLOCK], dtype=np.float64)
        total += float(block.sum())
        total_sq += float(np.dot(block, block))
    mean = total / n
    return max(0.0, total_sq / n - mean * mean)


def _running_square_sum_at(signal: np.ndarray, positions: np.ndarray) -> np.ndarray:
    """sum(signal[:p] ** 2) for each p of the ascending ``positions``."""
    out = np.zeros(len(positions), dtype=np.float64)
    carry = 0.0
    done = 0
    for block_start in range(0, len(signal), _ENERGY_BLOCK):
        block = signal[block_start : block_start + _ENERGY_BLOCK]
        block_end = block_start + len(block)
        running = np.cumsum(np.square(block, dtype=np.float64))
        upto = int(np.searchsorted(positions, block_end, side="right"))
        if upto > done:
            offsets = positions[done:upto] - block_start
            inside = offsets > 0
            out[done:upto] = carry
            out[done:upto][inside] += running[offsets[inside] - 1]
            done = upto
        carry += float(running[-1])
    out[done:] = carry
    return out


def _voicing_features(
    mono: np.ndarray, sample_rate: int, frame_length: int, hop_length: int, num_frames: int
) -> tuple[np.ndarray, np.ndarray]:
    """Per-frame voicing evidence for whole-track phrase detection: the autocorrelation peak
    in the 80-500 Hz pitch range (periodicity) and the share of energy above 3 kHz.

    Frames are transformed _FFT_BATCH at a time; doing the whole song at once needed about
    1 GB for a four-minute track. Each frame's values are the same either way.
    """
    max_lag = int(sample_rate / 80)
    n_fft = max(1024, 1 << int(np.ceil(np.log2(frame_length + max_lag))))
    frames = np.lib.stride_tricks.as_strided(
        mono,
        shape=(num_frames, frame_length),
        strides=(mono.strides[0] * hop_length, mono.strides[0]),
    )
    window = np.hanning(frame_length).astype(np.float32)
    lag_min = max(1, int(sample_rate / 500))
    lag_max = min(n_fft // 2, max_lag)
    high_band = np.fft.rfftfreq(n_fft, 1.0 / sample_rate) > 3000.0
    periodicity = np.zeros(num_frames, dtype=np.float64)
    hf_ratio = np.zeros(num_frames, dtype=np.float64)
    for start in range(0, num_frames, _FFT_BATCH):
        batch = frames[start : start + _FFT_BATCH]
        stop = start + len(batch)
        power = np.abs(np.fft.rfft(batch * window, n=n_fft, axis=-1)) ** 2
        if lag_max > lag_min:
            autocorr = np.fft.irfft(power, n=n_fft, axis=-1)
            periodicity[start:stop] = np.max(autocorr[:, lag_min:lag_max], axis=-1) / np.maximum(
                1e-9, autocorr[:, 0]
            )
        hf_ratio[start:stop] = np.sum(power[:, high_band], axis=-1) / (
            np.sum(power, axis=-1) + 1e-9
        )
    return periodicity, hf_ratio


def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely converts val to a finite float, falling back to default if None, non-finite, or invalid."""
    if val is None:
        return default
    try:
        f = float(val)
        return f if math.isfinite(f) else default
    except (ValueError, TypeError):
        return default


def _is_zero(val: Any) -> bool:
    """Returns True if val is None, non-finite, or numerically equal to 0.0."""
    if val is None:
        return True
    try:
        f = float(val)
        return (not math.isfinite(f)) or f == 0.0
    except (ValueError, TypeError):
        return True


_DSP_CACHE: dict[tuple[int, int, int], tuple[np.ndarray, np.ndarray, np.ndarray]] = {}


def _get_dsp_windows(
    frame_length: int, n_fft: int, sample_rate: int
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Caches FFT window, vocal mask, and HF noise mask across lines."""
    key = (frame_length, n_fft, sample_rate)
    cached = _DSP_CACHE.get(key)
    if cached is not None:
        return cached
    win = np.hanning(frame_length).astype(np.float32)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sample_rate)
    vocal_mask = (freqs >= 200.0) & (freqs <= 4500.0)
    hf_mask = freqs > 3000.0
    val = (win, vocal_mask, hf_mask)
    if len(_DSP_CACHE) > 32:
        _DSP_CACHE.clear()
    _DSP_CACHE[key] = val
    return val


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

    l_start = _safe_float(l_start, 0.0)
    if l_start < 0.0:
        l_start = 0.0
    l_end = _safe_float(l_end, l_start + max(0.5, 0.05 * n))
    if l_end <= l_start:
        l_end = l_start + max(0.5, 0.05 * n)

    total_dur = l_end - l_start
    min_dur = max(0.0001, min(0.020, total_dur / (n * 1.2)))
    if n * min_dur > total_dur:
        min_dur = total_dur / (n * 1.01)

    result = []
    cur_time = l_start

    for i, w in enumerate(words):
        rem = n - 1 - i
        max_allowed_end = l_end - (rem * min_dur)

        s_cand, e_cand = raw_spans[i] if i < len(raw_spans) else (cur_time, cur_time + min_dur)
        s_cand = _safe_float(s_cand, cur_time)
        e_cand = _safe_float(e_cand, s_cand + min_dur)

        # Clamp start time: cannot precede previous word end, cannot precede l_start or 0.0, must leave room for remainder
        s = max(cur_time, s_cand)
        s = max(0.0, max(l_start, s))
        max_s = max(cur_time, max_allowed_end - min_dur)
        s = min(s, max_s)
        s = max(cur_time, max(0.0, s))

        # Clamp end time: must be at least s + min_dur, cannot exceed max_allowed_end
        e = max(s + min_dur, e_cand)
        e = min(e, max_allowed_end)
        if e <= s:
            e = s + min_dur
        if rem == 0 and e < l_end:
            e = max(e, min(l_end, e_cand))

        s_r = round(s, 3)
        if s_r < 0.0:
            s_r = 0.0
        e_r = round(max(s_r + 0.001, e), 3)
        if e_r <= s_r:
            e_r = round(s_r + 0.001, 3)

        cur_time = e_r

        result.append({"word": w, "start_time": s_r, "end_time": e_r})

    return result


def estimate_global_offset(
    audio: np.ndarray,
    sample_rate: int,
    lines: list[dict[str, Any]],
    max_offset: float = 15.0,
) -> tuple[float, float]:
    """
    Estimates global time offset (in seconds) between acoustic vocal energy envelope
    and lyric line intervals using normalized FFT cross-correlation.

    Returns (offset_seconds, correlation_confidence).
    Positive offset means lyrics lead audio by offset_seconds (audio occurs later than lyric timestamps),
    so adding offset aligns lyrics to audio.
    If correlation confidence < 0.15 or audio is silent/flat, returns (0.0, float(confidence)).
    """
    if not lines or sample_rate <= 0:
        return 0.0, 0.0

    # Resilient stereo / multichannel to mono conversion & sanitization
    if audio.dtype == np.float32 and audio.ndim == 1:
        mono = audio
    else:
        if audio.ndim == 2:
            mono = audio[:, 0] if audio.shape[1] == 1 else np.mean(audio, axis=-1)
        elif audio.ndim > 2:
            mono = np.mean(audio, axis=-1)
        else:
            mono = audio
        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)

    if len(mono) == 0:
        return 0.0, 0.0

    mono_max = max(float(np.max(mono)), abs(float(np.min(mono)))) if len(mono) > 0 else 0.0
    if mono_max > 1.0:
        mono = mono / mono_max

    # Pure silence or DC check
    if _signal_variance(mono) < 1e-6:
        return 0.0, 0.0

    dt = 0.02  # 50 Hz analysis grid
    hop_len = max(1, int(dt * sample_rate))
    n_frames = len(mono) // hop_len

    if n_frames == 0:
        sq = mono**2
        rms = np.array([float(np.sqrt(np.mean(sq)))], dtype=np.float32)
    else:
        sq = mono**2
        trimmed = sq[: n_frames * hop_len].reshape(n_frames, hop_len)
        rms = np.sqrt(np.mean(trimmed, axis=1)).astype(np.float32)

    max_rms = float(np.max(rms)) if len(rms) > 0 else 0.0
    if max_rms <= 1e-6:
        return 0.0, 0.0

    A = rms / max_rms
    noise_floor_20 = float(np.percentile(A, 20))
    noise_floor_10 = float(np.percentile(A, 10))
    ptp = float(np.ptp(A))
    var_A = float(np.var(A))

    if noise_floor_20 > 0.25 or noise_floor_10 > 0.15 or ptp < 0.25 or var_A < 1e-3:
        return 0.0, 0.0

    valid_lines = [
        line_item
        for line_item in lines
        if _safe_float(line_item.get("end_time"), -1.0)
        > _safe_float(line_item.get("start_time"), 0.0)
    ]
    if not valid_lines:
        return 0.0, 0.0

    t_lyrics = max(_safe_float(line_item.get("end_time"), 0.0) for line_item in valid_lines)
    t_audio = len(mono) / sample_rate
    t_max = max(t_audio, t_lyrics)
    n_total = max(len(A), int(np.ceil(t_max / dt)))

    A_pad = np.pad(A, (0, max(0, n_total - len(A))))
    L = np.zeros(n_total, dtype=np.float32)
    for line_item in valid_lines:
        s_idx = max(0, round(_safe_float(line_item.get("start_time"), 0.0) / dt))
        e_idx = min(n_total, round(_safe_float(line_item.get("end_time"), 0.0) / dt))
        if e_idx > s_idx:
            L[s_idx:e_idx] = 1.0

    tot_L = float(np.sum(L))
    tot_A = float(np.sum(A_pad))
    if tot_L < 1e-6 or tot_A < 1e-6:
        return 0.0, 0.0

    # Mean-subtracted zero-mean Pearson cross-correlation
    A_cent = A_pad - float(np.mean(A_pad))
    L_cent = L - float(np.mean(L))

    corr = scipy.signal.correlate(A_cent, L_cent, mode="full")
    lags = scipy.signal.correlation_lags(len(A_pad), len(L), mode="full")

    denom = float(np.sqrt(np.sum(A_cent**2) * np.sum(L_cent**2)))
    if denom < 1e-6:
        return 0.0, 0.0
    norm_corr = corr / denom

    max_lag = round(max_offset / dt)
    valid_mask = (lags >= -max_lag) & (lags <= max_lag)
    if not np.any(valid_mask):
        return 0.0, 0.0

    valid_lags = lags[valid_mask]
    valid_corr = norm_corr[valid_mask]

    r_max = float(np.max(valid_corr))

    # Handle plateau of maximum correlation (prefer lag closest to zero)
    plateau_mask = np.isclose(valid_corr, r_max, atol=1e-3, rtol=1e-3)
    plateau_lags = valid_lags[plateau_mask]
    if len(plateau_lags) == 0 or not math.isfinite(r_max):
        return 0.0, 0.0

    best_lag = float(plateau_lags[np.argmin(np.abs(plateau_lags))])

    # Parabolic sub-frame interpolation if best peak is unique/isolated
    best_idx = int(np.where(valid_lags == best_lag)[0][0])
    if 0 < best_idx < len(valid_corr) - 1 and np.sum(plateau_mask) == 1:
        alpha = float(valid_corr[best_idx - 1])
        beta = float(valid_corr[best_idx])
        gamma = float(valid_corr[best_idx + 1])
        denom = 2.0 * (2.0 * beta - alpha - gamma)
        if abs(denom) > 1e-9:
            delta = (alpha - gamma) / denom
            if abs(delta) < 1.0:
                best_lag = best_lag - delta

    offset_seconds = round(best_lag * dt, 4)
    if abs(offset_seconds) < 1e-6:
        offset_seconds = 0.0

    # Compute coverage of lyric lines on shifted audio
    int_lag = round(best_lag)
    if int_lag >= 0:
        L_shifted = np.pad(L, (int_lag, 0))[: len(A_pad)]
    else:
        L_shifted = np.pad(L[-int_lag:], (0, -int_lag))[: len(A_pad)]
    if len(L_shifted) < len(A_pad):
        L_shifted = np.pad(L_shifted, (0, len(A_pad) - len(L_shifted)))

    overlap = float(np.sum(np.minimum(A_pad, L_shifted)))
    cov_L = overlap / max(1e-6, tot_L)
    cov_A = overlap / max(1e-6, tot_A)

    # Active line coverage
    active_lines = 0
    for line_item in valid_lines:
        s_t = max(0.0, float(line_item["start_time"]) + offset_seconds)
        e_t = max(0.0, float(line_item["end_time"]) + offset_seconds)
        s_i = max(0, min(len(A), round(s_t / dt)))
        e_i = max(s_i + 1, min(len(A), round(e_t / dt)))
        line_a = A[s_i:e_i] if s_i < len(A) else np.zeros(0)
        if len(line_a) > 0 and float(np.max(line_a)) > 0.08:
            active_lines += 1
    line_cov = active_lines / len(valid_lines)

    r_pos = max(0.0, r_max)
    confidence = float((r_pos**1.65) * np.sqrt(cov_L * cov_A) * line_cov)

    if r_max < 0.15 or confidence < 0.15:
        return 0.0, confidence

    return offset_seconds, confidence


def _is_breath_frame(frame: np.ndarray, sr: int) -> bool:
    """Detects high-frequency unvoiced breath noise via autocorrelation periodicity and HF ratio."""
    if len(frame) < 100 or float(np.var(frame)) < 1e-6 or sr <= 0:
        return False
    win = np.hanning(len(frame))
    max_lag = int(sr / 80)
    n_fft = max(1024, 1 << int(np.ceil(np.log2(len(frame) + max_lag))))
    X = np.fft.rfft(frame * win, n=n_fft)
    mag2 = np.abs(X) ** 2
    R = np.fft.irfft(mag2, n=n_fft)
    r0 = R[0]
    if r0 < 1e-9:
        return False
    lag_min = max(1, int(sr / 500))
    lag_max = min(n_fft // 2, max_lag)
    if lag_max <= lag_min:
        return False
    r_max = float(np.max(R[lag_min:lag_max])) / float(r0)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    tot_pow = float(np.sum(mag2)) + 1e-9
    hf_pow = float(np.sum(mag2[freqs > 3000.0]))
    hf_ratio = hf_pow / tot_pow
    return (r_max < 0.25) and (hf_ratio > 0.60)


def refine_line_boundaries(
    audio: np.ndarray,
    sample_rate: int,
    lines: list[dict[str, Any]],
    min_silence_gap: float = 1.0,
) -> list[dict[str, Any]]:
    """
    Refines synced lyric line boundaries against isolated vocal audio activity.
    Snaps line start_time to local vocal phrase onsets (within 120ms MAE) and trims
    line end_time when silence >= min_silence_gap (1.0s) follows vocal release (+ 0.10s hangover).
    Preserves strict monotonicity and inter-line ordering.
    Resilient to empty, silent, stereo, NaN/Inf, whisper, or single-line inputs.
    """
    if not lines:
        return []

    # 1. Sanitize & convert multichannel to mono
    if audio.dtype == np.float32 and audio.ndim == 1:
        mono = audio
    else:
        if audio.ndim == 2:
            mono = audio[:, 0] if audio.shape[1] == 1 else np.mean(audio, axis=-1)
        elif audio.ndim > 2:
            mono = np.mean(audio, axis=-1)
        else:
            mono = audio
        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)

    # Pure silence or invalid sample rate fallback
    if len(mono) == 0 or sample_rate <= 0 or _signal_variance(mono) < 1e-7:
        sanitized: list[dict[str, Any]] = []
        cur_t = 0.0
        for line in lines:
            l_copy = dict(line)
            s = max(cur_t, _safe_float(l_copy.get("start_time"), 0.0))
            e = max(s + 0.05, _safe_float(l_copy.get("end_time"), s + 0.05))
            l_copy["start_time"] = round(s, 3)
            l_copy["end_time"] = round(e, 3)
            cur_t = e
            sanitized.append(l_copy)
        return sanitized

    dt = 0.01  # 10ms frame hop for high temporal resolution (100 Hz grid)
    frame_len = max(1, int(0.02 * sample_rate))
    hop_len = max(1, int(dt * sample_rate))
    num_frames = (len(mono) - frame_len) // hop_len

    if num_frames <= 0:
        sanitized = []
        cur_t = 0.0
        for line in lines:
            l_copy = dict(line)
            s = max(cur_t, _safe_float(l_copy.get("start_time"), 0.0))
            e = max(s + 0.05, _safe_float(l_copy.get("end_time"), s + 0.05))
            l_copy["start_time"] = round(s, 3)
            l_copy["end_time"] = round(e, 3)
            cur_t = e
            sanitized.append(l_copy)
        return sanitized

    energy = _frame_mean_square(mono, frame_len, hop_len, num_frames)
    rms = np.sqrt(np.maximum(0.0, energy))
    max_rms = float(np.max(rms))

    # Whisper / low energy guard
    if max_rms < 0.005:
        sanitized = []
        cur_t = 0.0
        for line in lines:
            l_copy = dict(line)
            s = max(cur_t, _safe_float(l_copy.get("start_time"), 0.0))
            e = max(s + 0.05, _safe_float(l_copy.get("end_time"), s + 0.05))
            l_copy["start_time"] = round(s, 3)
            l_copy["end_time"] = round(e, 3)
            cur_t = e
            sanitized.append(l_copy)
        return sanitized

    norm_rms = rms / max_rms
    p10 = float(np.percentile(norm_rms, 10))
    p90 = float(np.percentile(norm_rms, 90))

    if p90 - p10 < 0.08:
        # Stationary noise / flat whisper
        sanitized = []
        cur_t = 0.0
        for line in lines:
            l_copy = dict(line)
            s = max(cur_t, _safe_float(l_copy.get("start_time"), 0.0))
            e = max(s + 0.05, _safe_float(l_copy.get("end_time"), s + 0.05))
            l_copy["start_time"] = round(s, 3)
            l_copy["end_time"] = round(e, 3)
            cur_t = e
            sanitized.append(l_copy)
        return sanitized

    vocal_thresh = max(0.05, float(p10 + 0.12 * (p90 - p10)))
    is_active = norm_rms > vocal_thresh

    refined: list[dict[str, Any]] = []
    prev_end = 0.0

    for line_idx, line in enumerate(lines):
        if line.get("has_word_sync"):
            l_copy = dict(line)
            prev_end = _safe_float(l_copy.get("end_time"), prev_end)
            refined.append(l_copy)
            continue

        raw_s = _safe_float(line.get("start_time"), 0.0)
        raw_e = _safe_float(line.get("end_time"), raw_s + 0.05)
        if raw_s < 0.0:
            raw_s = 0.0
        if raw_e <= raw_s:
            raw_e = raw_s + 0.05

        f_raw_s = max(0, min(num_frames - 1, round(raw_s / dt)))

        # Onset Snapping:
        # Search window around raw_s: [max(prev_end, raw_s - 1.0), min(raw_e, raw_s + 1.2)]
        search_s = max(prev_end, raw_s - 1.0)
        search_e = min(raw_e, raw_s + 1.2)
        f_s = max(0, round(search_s / dt))
        f_e = min(num_frames, round(search_e / dt))

        snapped_s = raw_s
        if f_e > f_s:
            flen = max(1, int(0.025 * sample_rate))
            if not is_active[f_raw_s]:
                # Case 1: Audio is silent at raw_s -> search forward for vocal phrase onset
                sub_active = is_active[f_raw_s:f_e]
                if np.any(sub_active):
                    first_act_rel = int(np.where(sub_active)[0][0])
                    first_act_idx = f_raw_s + first_act_rel
                    while first_act_idx < f_e:
                        s_samp = int(first_act_idx * dt * sample_rate)
                        frame = mono[s_samp : s_samp + flen]
                        if _is_breath_frame(frame, sample_rate):
                            first_act_idx += 1
                            while first_act_idx < f_e and not is_active[first_act_idx]:
                                first_act_idx += 1
                        else:
                            break
                    if first_act_idx < f_e:
                        cand_s = round(first_act_idx * dt, 3)
                        if abs(cand_s - raw_s) >= 0.07:
                            snapped_s = cand_s
            else:
                # Case 2: Audio is active at raw_s -> trace backward to find vocal phrase onset
                first_act_idx = f_raw_s
                while first_act_idx > f_s and is_active[first_act_idx - 1]:
                    first_act_idx -= 1
                while first_act_idx < f_e:
                    s_samp = int(first_act_idx * dt * sample_rate)
                    frame = mono[s_samp : s_samp + flen]
                    if _is_breath_frame(frame, sample_rate):
                        first_act_idx += 1
                        while first_act_idx < f_e and not is_active[first_act_idx]:
                            first_act_idx += 1
                    else:
                        break
                # Snap if preceded by silence within the search window or at t=0.0s
                if first_act_idx < f_e and (
                    first_act_idx == 0 or (first_act_idx > 0 and not is_active[first_act_idx - 1])
                ):
                    cand_s = round(first_act_idx * dt, 3)
                    if abs(cand_s - raw_s) >= 0.07:
                        snapped_s = cand_s

        # Release Trimming & Sustained Note Extension:
        f_line_s = max(0, round(snapped_s / dt))
        f_line_e = min(num_frames, round(raw_e / dt))
        snapped_e = raw_e

        # Determine forward extension boundary (up to next line or +2.0s)
        if line_idx + 1 < len(lines):
            next_raw_s = _safe_float(lines[line_idx + 1].get("start_time"), raw_e + 2.0)
            max_extend_e = min(raw_e + 2.0, max(raw_e, next_raw_s - 0.05))
        else:
            max_extend_e = min(raw_e + 2.0, num_frames * dt)
        f_max_e = min(num_frames, round(max_extend_e / dt))

        if f_line_e > f_line_s:
            active_indices = np.where(is_active[f_line_s:f_line_e])[0]
            if len(active_indices) > 0:
                last_active_idx = f_line_s + int(active_indices[-1])
                # If note is sustained past raw_e (active at/near end of raw window), trace forward
                if (
                    last_active_idx >= f_line_e - 5
                    and f_line_e < num_frames
                    and is_active[min(num_frames - 1, f_line_e)]
                    and f_max_e > f_line_e
                ):
                    f_curr = f_line_e
                    while f_curr < f_max_e and is_active[f_curr]:
                        f_curr += 1
                    last_active_idx = f_curr - 1
                    last_active_t = (last_active_idx + 1) * dt
                    snapped_e = round(last_active_t + 0.10, 3)
                else:
                    last_active_t = (last_active_idx + 1) * dt
                    silence_gap = raw_e - last_active_t
                    if silence_gap >= min_silence_gap:
                        snapped_e = round(last_active_t + 0.10, 3)

        # Monotonicity & inter-line non-overlapping ordering
        snapped_s = max(prev_end, max(0.0, snapped_s))
        snapped_e = max(snapped_s + 0.05, snapped_e)
        prev_end = snapped_e

        l_copy = dict(line)
        l_copy["start_time"] = round(float(snapped_s), 3)
        l_copy["end_time"] = round(float(snapped_e), 3)

        # If line already has words, adjust word timestamps if they exceed new boundaries
        if l_copy.get("words"):
            adjusted_words = []
            for w in l_copy["words"]:
                w_copy = dict(w)
                ws = max(
                    l_copy["start_time"],
                    _safe_float(w_copy.get("start_time"), l_copy["start_time"]),
                )
                we = min(
                    l_copy["end_time"],
                    max(ws + 0.001, _safe_float(w_copy.get("end_time"), l_copy["end_time"])),
                )
                w_copy["start_time"] = round(ws, 3)
                w_copy["end_time"] = round(we, 3)
                adjusted_words.append(w_copy)
            l_copy["words"] = adjusted_words

        refined.append(l_copy)

    return refined


def align_words_spectral(
    audio_segment: np.ndarray,
    sample_rate: int,
    words: list[str],
    line_start: float,
    line_end: float,
) -> list[dict[str, Any]]:
    """
    Sub-line word synchronization using log-magnitude spectral flux, voiced harmonic
    activity gating, and syllable-aware dynamic programming alignment.

    - Extracts vocal-band (200-4500Hz) spectral flux via STFT (20-25ms frames, 10ms hop).
    - Gates acoustic onsets using short-time autocorrelation periodicity (r_max >= 0.28
      in pitch lag range 80-500Hz) and high-frequency noise ratio (< 0.60), suppressing
      breath noise, percussive transients, and drum bleed.
    - Syllable-aware dynamic programming balances word duration weights with acoustic onset peaks.
    - Strictly guarantees non-overlapping monotonicity: line_start <= word[0].start < word[0].end <= ... <= line_end.
    - Pure CPU DSP execution: runs in < 0.05s per line (< 2.0s for whole track).
    - Safe against empty, silent, stereo, high-sample-rate, NaN/Inf, or sub-frame audio slices.
    """
    if not words:
        return []

    clean_words = []
    for w in words:
        cw = re.sub(
            r"\[\d{1,4}:\d{2}(?:\.\d{1,3})?\]|<\d{1,4}:\d{2}(?:\.\d{1,3})?>", "", str(w)
        ).strip()
        if cw:
            clean_words.append(cw)

    if not clean_words:
        return []

    n_words = len(clean_words)
    l_start = max(0.0, _safe_float(line_start, 0.0))
    l_end = _safe_float(line_end, l_start + max(0.5, 0.05 * n_words))
    if l_end <= l_start:
        l_end = l_start + max(0.5, 0.05 * n_words)

    weights = [calculate_word_weight(w) for w in clean_words]
    tot_weight = sum(weights)

    def _proportional_fallback() -> list[dict[str, Any]]:
        tot_dur = l_end - l_start
        spans: list[tuple[float, float]] = []
        cur_t = l_start
        for wt in weights:
            dur = tot_dur * (wt / tot_weight) if tot_weight > 0 else tot_dur / n_words
            spans.append((cur_t, cur_t + dur))
            cur_t += dur
        return enforce_monotonic_words(clean_words, spans, l_start, l_end)

    if sample_rate <= 0 or audio_segment is None:
        return _proportional_fallback()

    # Pre-slice audio_segment if it represents full track to avoid heavy array operations.
    # Audio clearly longer than the line is the whole track even when the line runs past its
    # end (a final line's LRC end often does); treating it as line-local would align the line
    # against the start of the song.
    n_samples = audio_segment.shape[0] if audio_segment.ndim >= 1 else 0
    audio_dur = n_samples / sample_rate
    pad_sec = 0.08
    if audio_dur >= l_end - 0.02 or audio_dur > (l_end - l_start) + 0.5:
        if l_start >= audio_dur:
            return _proportional_fallback()
        s_sample = max(0, round((l_start - pad_sec) * sample_rate))
        e_sample = min(n_samples, round((l_end + pad_sec) * sample_rate))
        raw_seg = audio_segment[s_sample:e_sample]
        t_offset = float(s_sample / sample_rate)
    else:
        raw_seg = audio_segment
        t_offset = l_start

    # Downmix & Sanitize
    if raw_seg.dtype == np.float32 and raw_seg.ndim == 1:
        mono = raw_seg
    else:
        if raw_seg.ndim == 2:
            mono = raw_seg[:, 0] if raw_seg.shape[1] == 1 else np.mean(raw_seg, axis=-1)
        elif raw_seg.ndim > 2:
            mono = np.mean(raw_seg, axis=-1)
        else:
            mono = raw_seg
        mono = np.nan_to_num(mono, nan=0.0, posinf=0.0, neginf=0.0).astype(np.float32)

    if len(mono) == 0 or float(np.var(mono)) < 1e-7:
        return _proportional_fallback()

    dt = 0.010  # 10ms hop
    hop_length = max(1, int(dt * sample_rate))
    frame_length = max(1, int(0.025 * sample_rate))
    seg = mono

    if len(seg) < frame_length:
        return _proportional_fallback()

    num_frames = (len(seg) - frame_length) // hop_length
    if num_frames <= 0:
        return _proportional_fallback()

    shape = (num_frames, frame_length)
    strides = (seg.strides[0] * hop_length, seg.strides[0])
    frames = np.lib.stride_tricks.as_strided(seg, shape=shape, strides=strides)

    frame_rms = np.sqrt(np.mean(frames**2, axis=-1))
    max_rms = float(np.max(frame_rms))
    if max_rms < 1e-5:
        return _proportional_fallback()
    norm_rms = frame_rms / max_rms

    max_lag = int(sample_rate / 80)
    n_fft = max(1024, 1 << int(np.ceil(np.log2(frame_length + max_lag))))

    win, vocal_mask, hf_mask = _get_dsp_windows(frame_length, n_fft, sample_rate)
    spec = np.fft.rfft(frames * win, n=n_fft, axis=-1)
    mag = np.abs(spec)

    # Spectral flux in vocal band 200-4500Hz
    vocal_mag = mag[:, vocal_mask]
    gamma = 20.0
    log_mag = np.log1p(gamma * vocal_mag)
    diff = np.diff(log_mag, axis=0)
    diff = np.maximum(0.0, diff)
    flux = np.pad(np.sum(diff, axis=-1), (1, 0), mode="constant")

    # Voiced harmonic autocorrelation periodicity (80Hz - 500Hz)
    R = np.fft.irfft(mag**2, n=n_fft, axis=-1)
    r0 = np.maximum(1e-9, R[:, 0])
    lag_min = max(1, int(sample_rate / 500))
    lag_max = min(n_fft // 2, max_lag)
    if lag_max > lag_min:
        periodicity = np.max(R[:, lag_min:lag_max], axis=-1) / r0
    else:
        periodicity = np.zeros(num_frames, dtype=np.float32)

    # High frequency noise ratio (>3000Hz)
    tot_pow = np.sum(mag**2, axis=-1) + 1e-9
    hf_ratio = np.sum(mag[:, hf_mask] ** 2, axis=-1) / tot_pow

    is_voiced = (periodicity >= 0.28) & (hf_ratio < 0.60) & (norm_rms > 0.05)
    act_mask = norm_rms > 0.08 if np.sum(is_voiced) == 0 else is_voiced

    if np.sum(act_mask) == 0:
        return _proportional_fallback()

    padded = np.pad(act_mask.astype(np.int8), (1, 1), mode="constant")
    d_act = np.diff(padded)
    s_idx = np.where(d_act == 1)[0]
    e_idx = np.where(d_act == -1)[0]
    raw_bursts: list[tuple[float, float]] = []
    for s_f, e_f in zip(s_idx, e_idx, strict=False):
        b_s = float(t_offset + s_f * dt)
        b_e = float(t_offset + e_f * dt)
        # Prune if completely outside line window
        if b_e < l_start - 0.15 or b_s > l_end + 0.15:
            continue
        # Prune tiny transient blips < 40ms unless only burst
        if (b_e - b_s) < 0.040 and len(s_idx) > 1:
            continue
        raw_bursts.append((b_s, b_e))

    if not raw_bursts:
        return _proportional_fallback()

    # Bridge micro-pauses < 35ms (1-2 frames)
    bridged: list[tuple[float, float]] = []
    c_s, c_e = raw_bursts[0]
    for n_s, n_e in raw_bursts[1:]:
        if n_s - c_e < 0.035:
            c_e = max(c_e, n_e)
        else:
            bridged.append((c_s, c_e))
            c_s, c_e = n_s, n_e
    bridged.append((c_s, c_e))
    bursts = bridged

    # If more bursts than words, merge smallest gaps until len(bursts) <= n_words
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

    # Single-word line
    if n_words == 1:
        b_s, b_e = bursts[0]
        if b_s - l_start < 0.15:
            b_s = l_start
        b_e = l_end if l_end - b_e < 0.25 else min(l_end, b_e + 0.08)
        b_s = max(l_start, b_s)
        b_e = min(l_end, max(b_s + 0.05, b_e))
        return [
            {
                "word": clean_words[0],
                "start_time": float(round(b_s, 3)),
                "end_time": float(round(b_e, 3)),
            }
        ]

    gated_flux = flux * act_mask
    onset_peaks: list[tuple[float, float]] = []
    if np.max(gated_flux) > 1e-3:
        p_thresh = max(5.0, 0.25 * float(np.max(gated_flux)))
        for i in range(1, num_frames - 1):
            if (
                gated_flux[i] > gated_flux[i - 1]
                and gated_flux[i] >= gated_flux[i + 1]
                and gated_flux[i] >= p_thresh
            ):
                p_t = float(t_offset + i * dt)
                onset_peaks.append((p_t, float(gated_flux[i])))

    B = len(bursts)
    if B == 1:
        splits = [0, n_words]
    elif n_words == B:
        splits = list(range(n_words + 1))
    else:
        P_w = [0.0] * (n_words + 1)
        for j in range(n_words):
            P_w[j + 1] = P_w[j] + weights[j]
        d_k = [max(0.01, b[1] - b[0]) for b in bursts]
        D_tot = sum(d_k)
        targets = [tot_weight * (d / D_tot) for d in d_k]
        dp = np.full((n_words + 1, B + 1), np.inf, dtype=np.float64)
        parent = np.full((n_words + 1, B + 1), -1, dtype=np.int32)
        dp[0, 0] = 0.0
        for k in range(1, B + 1):
            target = targets[k - 1]
            for i in range(k, n_words - (B - k) + 1):
                for j in range(k - 1, i):
                    block_w = P_w[i] - P_w[j]
                    cost = dp[j, k - 1] + (block_w - target) ** 2
                    if cost < dp[i, k]:
                        dp[i, k] = cost
                        parent[i, k] = j
        curr = n_words
        splits = [n_words]
        for k in range(B, 0, -1):
            prev = int(parent[curr, k])
            splits.append(prev)
            curr = prev
        splits.reverse()

    raw_spans: list[tuple[float, float]] = []
    for k in range(B):
        w_slice = clean_words[splits[k] : splits[k + 1]]
        w_slice_weights = weights[splits[k] : splits[k + 1]]
        b_s, b_e = bursts[k]
        K_w = len(w_slice)
        if K_w == 1:
            raw_spans.append((b_s, b_e))
        else:
            tot_w_sub = sum(w_slice_weights)
            target_durs = [(b_e - b_s) * (w / tot_w_sub) for w in w_slice_weights]
            cand_times = [b_s]
            cum_t = b_s
            for d in target_durs[:-1]:
                cum_t += d
                cand_times.append(cum_t)
            for p_t, _ in onset_peaks:
                if b_s + 0.03 < p_t < b_e - 0.03:
                    cand_times.append(p_t)
            cand_times.append(b_e)
            cand_times = sorted({round(t, 3) for t in cand_times})
            P = len(cand_times)
            peak_dict = {round(p_t, 3): sal for p_t, sal in onset_peaks}
            max_sal = max([sal for _, sal in onset_peaks], default=1.0)
            dp_sub = np.full((K_w + 1, P), np.inf, dtype=np.float64)
            parent_sub = np.full((K_w + 1, P), -1, dtype=np.int32)
            dp_sub[0, 0] = 0.0
            for j in range(1, K_w + 1):
                target_d = target_durs[j - 1]
                inv_target_d = 1.0 / max(0.05, target_d)
                bonus_mult = 0.8 if j < K_w else 0.0
                for p in range(j, P - (K_w - j)):
                    t_p = cand_times[p]
                    sal = peak_dict.get(t_p, 0.0) / max_sal
                    onset_bonus = bonus_mult * sal
                    for q in range(j - 1, p):
                        t_q = cand_times[q]
                        dur = t_p - t_q
                        if dur < 0.02:
                            continue
                        dur_cost = ((dur - target_d) * inv_target_d) ** 2
                        cost = dp_sub[j - 1, q] + dur_cost - onset_bonus
                        if cost < dp_sub[j, p]:
                            dp_sub[j, p] = cost
                            parent_sub[j, p] = q
            curr_p = P - 1
            sub_splits = [cand_times[curr_p]]
            for j in range(K_w, 0, -1):
                prev = int(parent_sub[j, curr_p])
                sub_splits.append(cand_times[prev])
                curr_p = prev
            sub_splits.reverse()
            for j in range(K_w):
                raw_spans.append((sub_splits[j], sub_splits[j + 1]))

    return enforce_monotonic_words(clean_words, raw_spans, l_start, l_end)


class AudioAligner:
    """
    Performs word-level forced audio alignment between vocals and lyric text.
    Combines vocal activity energy detection with acoustic alignment, syllable weighting,
    intra-line pause detection, and strict monotonicity enforcement.
    """

    count_syllables = staticmethod(count_syllables)
    calculate_word_weight = staticmethod(calculate_word_weight)
    enforce_monotonic_words = staticmethod(enforce_monotonic_words)
    estimate_global_offset = staticmethod(estimate_global_offset)
    refine_line_boundaries = staticmethod(refine_line_boundaries)
    align_words_spectral = staticmethod(align_words_spectral)

    def align_lyrics(
        self,
        vocals_path: str,
        lines: list[dict[str, Any]],
        auto_offset_correction: bool = True,
        refine_line_boundaries: bool = True,
    ) -> list[dict[str, Any]]:
        """
        Refines line and word-level timestamps using acoustic envelope of isolated vocals.
        Safe against empty, silent, stereo, or corrupted audio inputs.
        """
        if not lines:
            return []

        duration: float | None = None
        try:
            # 1. Read vocals audio safely
            try:
                # float32 halves the decode buffer; the analysis below runs in float32 anyway
                audio_data, sample_rate = sf.read(vocals_path, dtype="float32")
            except Exception as read_err:
                logger.warning(
                    f"Failed to read vocal audio from {vocals_path}: {read_err}. Falling back to default timing."
                )
                return self._fallback_distribute_words(lines)

            if sample_rate <= 0:
                sample_rate = 44100

            # 2. Resilient stereo / multichannel to mono conversion (vectorized fast path)
            if audio_data.ndim == 2:
                if audio_data.shape[1] == 1:
                    mono_audio = audio_data[:, 0]
                elif audio_data.shape[1] == 2:
                    # Same values as np.mean(axis=-1), without a slow strided reduction
                    mono_audio = (audio_data[:, 0] + audio_data[:, 1]) * np.float32(0.5)
                else:
                    mono_audio = np.mean(audio_data, axis=-1)
            elif audio_data.ndim > 2:
                mono_audio = np.mean(audio_data, axis=-1)
            else:
                mono_audio = audio_data

            # Sanitize any NaN or Inf values from corrupted decodes (only copy when needed)
            mono_audio = np.asarray(mono_audio, dtype=np.float32)
            if not np.isfinite(mono_audio).all():
                mono_audio = np.nan_to_num(mono_audio, nan=0.0, posinf=0.0, neginf=0.0)
            duration = float(len(mono_audio) / sample_rate) if len(mono_audio) > 0 else 0.0

            logger.info(
                f"Loaded vocals for alignment: {duration:.2f}s, sample rate {sample_rate}Hz"
            )

            # 3. Check if lines are un-timed plain text (both start and end are 0.0 or None)
            all_zero = len(lines) > 0 and all(
                _is_zero(line.get("start_time")) and _is_zero(line.get("end_time"))
                for line in lines
            )

            if all_zero:
                # Calculate short-time RMS energy (frame size = 20ms, hop size = 10ms)
                frame_length = max(1, int(0.02 * sample_rate))
                hop_length = max(1, int(0.01 * sample_rate))

                # Guard against empty audio: prevent np.mean([]) warnings and NaN propagation
                if len(mono_audio) == 0:
                    norm_energy = np.zeros(0, dtype=np.float32)
                elif len(mono_audio) < frame_length:
                    avg_val = float(np.mean(np.square(mono_audio)))
                    norm_energy = np.array([avg_val], dtype=np.float32)
                else:
                    num_frames = max(1, (len(mono_audio) - frame_length) // hop_length)
                    energy = _frame_mean_square(mono_audio, frame_length, hop_length, num_frames)

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

                # For untimed plain lyrics, apply voiced harmonic gating to suppress drum bleed
                phrases_energy = norm_energy
                if len(mono_audio) >= frame_length and num_frames > 0:
                    try:
                        per_u, hf_ratio_u = _voicing_features(
                            mono_audio, sample_rate, frame_length, hop_length, num_frames
                        )
                        is_voiced_u = (per_u >= 0.28) & (hf_ratio_u < 0.60) & (norm_energy > 0.05)
                        if np.sum(is_voiced_u) > 5:
                            if len(is_voiced_u) >= 3:
                                kernel_v = np.ones(3, dtype=np.float32)
                                voiced_env = (
                                    np.convolve(
                                        is_voiced_u.astype(np.float32), kernel_v, mode="same"
                                    )
                                    > 0.0
                                )
                            else:
                                voiced_env = is_voiced_u
                            phrases_energy = np.where(voiced_env, norm_energy, 0.0).astype(
                                np.float32
                            )
                    except Exception as gate_err:
                        logger.debug(f"Voiced gating in untimed phrases skipped: {gate_err}")

                phrases = self._detect_vocal_phrases(phrases_energy, sample_rate, hop_length)
                working_lines = self._partition_lines_into_phrases(lines, phrases, duration)
            else:
                working_lines = [dict(line_item) for line_item in lines]
                if auto_offset_correction and len(mono_audio) > 0 and working_lines:
                    offset, confidence = estimate_global_offset(
                        audio=mono_audio,
                        sample_rate=sample_rate,
                        lines=working_lines,
                    )
                    if confidence >= 0.20 and abs(offset) >= 0.10:
                        logger.info(
                            f"Applying global offset correction: {offset:+.3f}s (confidence: {confidence:.3f})"
                        )
                        corrected_lines = []
                        for line_item in working_lines:
                            l_copy = dict(line_item)
                            orig_s = _safe_float(l_copy.get("start_time"), 0.0)
                            orig_e = _safe_float(l_copy.get("end_time"), orig_s + 4.0)
                            shifted_s = max(0.0, orig_s + offset)
                            shifted_e = max(shifted_s + 0.05, orig_e + offset)
                            l_copy["start_time"] = round(shifted_s, 3)
                            l_copy["end_time"] = round(shifted_e, 3)
                            if l_copy.get("words"):
                                shifted_words = []
                                for w in l_copy["words"]:
                                    w_copy = dict(w)
                                    ws = max(
                                        0.0,
                                        _safe_float(w_copy.get("start_time"), 0.0) + offset,
                                    )
                                    we = max(
                                        ws + 0.001,
                                        _safe_float(w_copy.get("end_time"), ws + 0.05) + offset,
                                    )
                                    w_copy["start_time"] = round(ws, 3)
                                    w_copy["end_time"] = round(we, 3)
                                    shifted_words.append(w_copy)
                                l_copy["words"] = shifted_words
                            corrected_lines.append(l_copy)
                        working_lines = corrected_lines

                if refine_line_boundaries and len(mono_audio) > 0 and working_lines:
                    working_lines = AudioAligner.refine_line_boundaries(
                        audio=mono_audio,
                        sample_rate=sample_rate,
                        lines=working_lines,
                        min_silence_gap=1.0,
                    )

            # 5. Align words for each line with syllable weighting and acoustic energy
            aligned_lines = []
            for line in working_lines:
                l_start = _safe_float(line.get("start_time"), 0.0)
                l_end = _safe_float(line.get("end_time"), l_start + 4.0)
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
                                "start_time": _safe_float(w.get("start_time"), 0.0),
                                "end_time": _safe_float(w.get("end_time"), 0.0),
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

                aligned_words = AudioAligner.align_words_spectral(
                    audio_segment=mono_audio,
                    sample_rate=sample_rate,
                    words=words,
                    line_start=l_start,
                    line_end=l_end,
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
            return self._fallback_distribute_words(lines, duration)

    def _fallback_distribute_words(
        self, lines: list[dict[str, Any]], duration: float | None = None
    ) -> list[dict[str, Any]]:
        """
        Graceful fallback when audio analysis fails: distributes words proportionally across line timestamps.

        Untimed (plain) lines are laid out one after another, sized by their syllables and
        stretched over the track when its duration is known, instead of all landing on 0-1s.
        """
        seconds_per_weight = FALLBACK_SECONDS_PER_WEIGHT
        untimed = [
            line
            for line in lines
            if _is_zero(line.get("start_time")) and _is_zero(line.get("end_time"))
        ]
        if untimed and duration and duration > 1.0 and len(untimed) == len(lines):
            total = sum(self._compute_line_weight(line) for line in lines)
            gaps = FALLBACK_LINE_GAP * max(0, len(lines) - 1)
            seconds_per_weight = max(0.01, (duration * 0.95 - gaps) / max(total, 1.0))

        fallback_lines = []
        cursor = 0.0
        for line in lines:
            if _is_zero(line.get("start_time")) and _is_zero(line.get("end_time")):
                l_start = cursor
                l_end = l_start + max(
                    FALLBACK_MIN_LINE_SEC, self._compute_line_weight(line) * seconds_per_weight
                )
            else:
                l_start = _safe_float(line.get("start_time"), 0.0)
                l_end = _safe_float(line.get("end_time"), l_start + 4.0)
            if l_end <= l_start:
                l_end = l_start + 1.0
            cursor = l_end + FALLBACK_LINE_GAP

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
                l_s_r = round(l_s, 3)
                l_e_r = round(max(l_s_r + 0.001, l_e), 3)
                l_copy["start_time"] = l_s_r
                l_copy["end_time"] = l_e_r
                working_lines.append(l_copy)
                cur_t = max(cur_t + dur, l_e_r)

            prev_end = 0.0
            for line_item in working_lines:
                s = max(prev_end, line_item["start_time"])
                e = max(s + 0.001, line_item["end_time"])
                line_item["start_time"] = round(s, 3)
                line_item["end_time"] = round(e, 3)
                prev_end = line_item["end_time"]
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
                l_s = max(cur_t, S_k)
                l_e = l_s + dur * 0.96
                l_s = min(E_k - 0.001, l_s)
                l_e = min(E_k, max(l_s + 0.001, l_e))
                l_s_r = round(l_s, 3)
                l_e_r = round(max(l_s_r + 0.001, l_e), 3)
                l_copy["start_time"] = l_s_r
                l_copy["end_time"] = l_e_r
                working_lines.append(l_copy)
                cur_t = max(cur_t + dur, l_e_r)

        # Enforce strict line monotonicity across all lines
        prev_end = 0.0
        for line_item in working_lines:
            s = max(prev_end, line_item["start_time"])
            e = max(s + 0.001, line_item["end_time"])
            line_item["start_time"] = round(s, 3)
            line_item["end_time"] = round(e, 3)
            prev_end = line_item["end_time"]

        return working_lines
