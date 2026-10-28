"""Measure lyric sync accuracy against hand-timed words.

    python -m backend.tools.benchmark_sync --vocals vocals.wav --truth truth.lrc
    python -m backend.tools.benchmark_sync --vocals vocals.wav --truth truth.json \\
        --engine both --mode plain --json results.json

--truth is an enhanced LRC file (<mm:ss.xx> word tags) or a JSON list of lines with
"words": [{"word", "start_time", "end_time"}] (the studio's own export). The aligner is given
the same lyric text, with line timing (--mode line, like a synced LRC) or without it
(--mode plain, like pasted lyrics), and its word starts are compared with the truth:
mean/median/P90 error, the share within 100/200/300 ms, how well the confidence predicts the
error (Spearman correlation per line), and run time. Use isolated vocals for meaningful
numbers; the neural engine ("ctc") needs PyTorch, torchaudio and the MMS model.
"""

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

from backend.services.lyrics import LyricsService

THRESHOLDS_MS = (100, 200, 300)


def load_truth(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    if path.suffix.lower() == ".json":
        data = json.loads(text)
        lines = data.get("lines", data) if isinstance(data, dict) else data
    else:
        lines = LyricsService.parse_lrc(text)
    usable = [x for x in lines if isinstance(x, dict) and x.get("words")]
    if not usable:
        raise SystemExit(f"{path} has no word-timed lines to compare against")
    return usable


def aligner_input(truth: list[dict], mode: str) -> list[dict]:
    lines = []
    for i, line in enumerate(truth):
        item = {"id": i, "text": " ".join(str(w["word"]) for w in line["words"])}
        if mode == "line":
            item["start_time"] = float(line["start_time"])
            item["end_time"] = float(line["end_time"])
        else:
            item["start_time"] = item["end_time"] = 0.0
        lines.append(item)
    return lines


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=values.__getitem__)
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        for k in range(i, j + 1):
            ranks[order[k]] = (i + j) / 2
        i = j + 1
    return ranks


def spearman(a: list[float], b: list[float]) -> float | None:
    if len(a) < 3:
        return None
    ra, rb = _ranks(a), _ranks(b)
    try:
        return round(statistics.correlation(ra, rb), 3)
    except statistics.StatisticsError:
        return None


def score(truth: list[dict], aligned: list[dict]) -> dict:
    errors, line_errors, line_mean_errors, confidences = [], [], [], []
    for expected, got in zip(truth, aligned, strict=False):
        got_words = got.get("words") or []
        per_line = []
        for want, have in zip(expected["words"], got_words, strict=False):
            per_line.append(abs(float(have["start_time"]) - float(want["start_time"])))
        if not per_line:
            continue
        errors.extend(per_line)
        line_errors.append(abs(float(got["start_time"]) - float(expected["start_time"])))
        if got.get("confidence") is not None:
            line_mean_errors.append(statistics.fmean(per_line))
            confidences.append(float(got["confidence"]))
    if not errors:
        return {"words": 0}
    ordered = sorted(errors)
    result = {
        "words": len(errors),
        "word_mae_ms": round(statistics.fmean(errors) * 1000, 1),
        "word_median_ms": round(statistics.median(errors) * 1000, 1),
        "word_p90_ms": round(ordered[min(len(ordered) - 1, int(0.9 * len(ordered)))] * 1000, 1),
        "line_mae_ms": round(statistics.fmean(line_errors) * 1000, 1) if line_errors else None,
    }
    for ms in THRESHOLDS_MS:
        result[f"within_{ms}ms"] = round(100 * sum(e <= ms / 1000 for e in errors) / len(errors), 1)
    # Good confidence goes with small error, so a useful score correlates negatively
    result["confidence_vs_error"] = spearman(confidences, line_mean_errors)
    return result


def run_engine(vocals: str, lines: list[dict], engine: str) -> tuple[dict, list[dict]]:
    from backend.services.aligner import AudioAligner
    from backend.services.lyric_sync import sync_lyrics

    started = time.monotonic()
    result = sync_lyrics(vocals, lines, engine=engine, aligner=AudioAligner())
    elapsed = time.monotonic() - started
    report = dict(result.report, runtime_seconds=round(elapsed, 2))
    return report, result.lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Benchmark lyric sync against hand-timed words.")
    parser.add_argument("--vocals", required=True, type=Path, help="Isolated vocal stem")
    parser.add_argument("--truth", required=True, type=Path, help="Enhanced LRC or studio JSON")
    parser.add_argument("--engine", choices=("dsp", "ctc", "both"), default="both")
    parser.add_argument("--mode", choices=("line", "plain"), default="line")
    parser.add_argument("--json", type=Path, help="Also write the results here")
    args = parser.parse_args(argv)

    truth = load_truth(args.truth)
    lines = aligner_input(truth, args.mode)
    engines = ("dsp", "ctc") if args.engine == "both" else (args.engine,)
    results = {}
    for engine in engines:
        report, aligned = run_engine(str(args.vocals), lines, engine)
        metrics = score(truth, aligned)
        metrics.update(
            engine_used=report["engine"],
            fallback_reason=report.get("fallback_reason"),
            runtime_seconds=report["runtime_seconds"],
            mean_confidence=report.get("mean_confidence"),
        )
        results[engine] = metrics

    columns = [
        "engine_used",
        "words",
        "word_mae_ms",
        "word_median_ms",
        "word_p90_ms",
        "line_mae_ms",
    ]
    columns += [f"within_{ms}ms" for ms in THRESHOLDS_MS]
    columns += ["confidence_vs_error", "mean_confidence", "runtime_seconds"]
    width = max(len(c) for c in columns)
    print(f"{'':{width}}  " + "  ".join(f"{e:>10}" for e in results))
    for column in columns:
        row = "  ".join(f"{results[e].get(column, '-')!s:>10}" for e in results)
        print(f"{column:{width}}  {row}")
    for engine, metrics in results.items():
        if metrics.get("fallback_reason"):
            print(
                f"note: {engine} ran as {metrics['engine_used']}: {metrics['fallback_reason']}",
                file=sys.stderr,
            )
    if args.json:
        args.json.write_text(json.dumps(results, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
