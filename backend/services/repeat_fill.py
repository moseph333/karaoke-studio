"""Adds the repeats a lyric file leaves out: a hook written once but sung again and again.

Lyric files often list a repeated line once ("It's a good day" in "Metaphysical", "(It's
the laser sharks)" in "Laser Sharks"), so the stage sits empty while the hook is sung. The
alignment's report names the stretches of strong singing that no line covers
(``uncovered_vocals``). Here the neural aligner tries each short line the song repeats in
those stretches, and a confident match becomes a new line marked ``added: "repeat"`` for the
studio to show for review. The rest of the stretch is tried again, a few rounds at most.

Only the neural (CTC) aligner can tell which words are sung, so without it nothing is added.
"""

import logging
import re
from typing import Any

from backend.services.line_realign import line_words
from backend.services.lyric_sync import (
    NeuralAlignmentFailed,
    neural_slot,
    romaji_onto_characters,
    romaji_spelling,
    run_neural_pass,
)
from backend.services.lyric_tokenize import normalize_for_mms

logger = logging.getLogger(__name__)

# A repeat candidate: a line of at most this many words whose text appears at least twice
MAX_CANDIDATE_WORDS = 8
MIN_OCCURRENCES = 2
# A match must be at least this confident (the CTC line score) and place every word
MIN_REPEAT_SCORE = 0.7
# Stretches shorter than this are not searched again; at most this many rounds
MIN_WINDOW_SEC = 1.5
MAX_ROUNDS = 4
# Space kept between an added repeat and the rest of its stretch
REPEAT_GAP_SEC = 0.1


def _key(text: str) -> str:
    return re.sub(r"[^\w']+", " ", str(text or "").lower()).strip()


def repeat_candidates(lines: list[dict[str, Any]]) -> list[int]:
    """Indices of the first line of each short line the song repeats."""
    counts: dict[str, int] = {}
    first: dict[str, int] = {}
    for i, line in enumerate(lines):
        key = _key(line.get("text", ""))
        if not key or len(key.split()) > MAX_CANDIDATE_WORDS:
            continue
        counts[key] = counts.get(key, 0) + 1
        first.setdefault(key, i)
    return [first[k] for k, n in counts.items() if n >= MIN_OCCURRENCES]


def _placed_line(template: dict, words: list[str], neural: dict, new_id: int) -> dict | None:
    timed = neural.get("words") or []
    if len(timed) != len(words) or not all(isinstance(w, dict) for w in timed):
        return None
    out_words = [
        {"word": word, "start_time": float(t["start"]), "end_time": float(t["end"])}
        for word, t in zip(words, timed, strict=True)
    ]
    score = float(neural.get("line_score") or 0.0)
    line = {k: v for k, v in template.items() if k not in ("words", "confidence", "align_method")}
    line.update(
        id=new_id,
        start_time=out_words[0]["start_time"],
        end_time=out_words[-1]["end_time"],
        words=out_words,
        align_method="ctc",
        confidence=round(min(1.0, score), 3),
        added="repeat",
    )
    return line


def fill_repeats(
    vocals_path: str, lines: list[dict[str, Any]], uncovered: list[dict[str, float]]
) -> tuple[list[dict[str, Any]], int]:
    """The lines with confident repeats added in the uncovered stretches, in time order, and
    how many were added. Without a neural pass, or nothing to add, the lines come back."""
    candidates = repeat_candidates(lines)
    windows = [(float(u["start"]), float(u["end"])) for u in uncovered or []]
    if not candidates or not windows:
        return lines, 0
    spelled = {}
    romanized: set[int] = set()  # candidates listened for by their romanization
    for ci in candidates:
        words = line_words(lines[ci])
        normalized = romaji_spelling(lines[ci])
        if normalized:
            romanized.add(ci)
        else:
            normalized = [normalize_for_mms(w) for w in words]
        if words and all(normalized):
            spelled[ci] = (words, normalized)
    if not spelled:
        return lines, 0
    next_id = (
        max(
            (
                int(line.get("id", 0))
                for line in lines
                if str(line.get("id", "")).lstrip("-").isdigit()
            ),
            default=-1,
        )
        + 1
    )
    added: list[dict[str, Any]] = []
    for _ in range(MAX_ROUNDS):
        windows = [(a, b) for a, b in windows if b - a >= MIN_WINDOW_SEC]
        if not windows:
            break
        request, meta = [], {}
        for wi, (a, b) in enumerate(windows):
            for ci, (_, normalized) in spelled.items():
                meta[len(request)] = (wi, ci)
                request.append(
                    {"index": len(request), "window_start": a, "window_end": b, "words": normalized}
                )
        try:
            with neural_slot():
                response = run_neural_pass(vocals_path, request)
        except NeuralAlignmentFailed as e:
            logger.info(f"No repeats added: {e}")
            break
        best: dict[int, tuple[float, int, dict]] = {}
        for result in response.get("lines") or []:
            if not isinstance(result, dict) or result.get("status") != "ok":
                continue
            idx = result.get("index")
            if idx not in meta:
                continue
            score = float(result.get("line_score") or 0.0)
            wi, ci = meta[idx]
            if score >= MIN_REPEAT_SCORE and (wi not in best or score > best[wi][0]):
                best[wi] = (score, ci, result)
        if not best:
            break
        remaining = []
        for wi, (a, b) in enumerate(windows):
            if wi not in best:
                continue
            _, ci, result = best[wi]
            if ci in romanized:
                characters = {"words": [{"word": w} for w in spelled[ci][0]]}
                result = romaji_onto_characters(result, characters)
            line = _placed_line(lines[ci], spelled[ci][0], result, next_id)
            if line is None or line["start_time"] < a - 0.5 or line["end_time"] > b + 0.5:
                continue
            next_id += 1
            added.append(line)
            remaining += [
                (a, line["start_time"] - REPEAT_GAP_SEC),
                (line["end_time"] + REPEAT_GAP_SEC, b),
            ]
        windows = remaining
    if not added:
        return lines, 0
    merged = sorted([*lines, *added], key=lambda line: float(line.get("start_time", 0)))
    return merged, len(added)
