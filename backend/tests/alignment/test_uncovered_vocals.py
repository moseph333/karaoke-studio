"""Singing the lyrics leave out (a hook written once and sung three times) is found on the
vocal stem and reported with the alignment."""

from backend.services.lyric_sync import sync_lyrics
from backend.services.sync_confidence import load_evidence, uncovered_vocals, vocal_regions
from backend.tests.helpers.audio_signals import write_test_wav


def line(text: str, start: float, end: float) -> dict:
    words = text.split()
    step = (end - start) / len(words)
    return {
        "id": 0,
        "text": text,
        "start_time": start,
        "end_time": end,
        "words": [
            {"word": w, "start_time": start + i * step, "end_time": start + (i + 1) * step}
            for i, w in enumerate(words)
        ],
    }


def hook_song(path: str) -> str:
    """Sung at 2-5 s (the written hook), again at 8-14 s (repeats with no lyric line), and a
    short breath-like blip at 18 s; silence elsewhere."""
    events = [
        {"start": 2.0, "end": 5.0, "freq": 440.0},
        {"start": 8.0, "end": 10.8, "freq": 440.0},
        {"start": 11.0, "end": 14.0, "freq": 494.0},
        {"start": 18.0, "end": 18.3, "freq": 300.0},
    ]
    return write_test_wav(path, 20.0, events, sr=16000)


def test_vocal_regions_follow_the_singing(tmp_path):
    regions = vocal_regions(load_evidence(hook_song(str(tmp_path / "hook.wav"))))
    assert len(regions) == 2  # the 0.3 s blip is too short to count
    (a1, b1), (a2, b2) = regions
    assert abs(a1 - 2.0) < 0.1 and abs(b1 - 5.0) < 0.1
    assert abs(a2 - 8.0) < 0.1 and abs(b2 - 14.0) < 0.1  # the 0.2 s breath is bridged


def test_only_singing_without_a_line_is_uncovered():
    regions = [(2.0, 5.0), (8.0, 14.0)]
    lines = [line("It's a good day", 2.0, 5.0)]
    assert uncovered_vocals(regions, lines, 2.5, 0.3) == [{"start": 8.0, "end": 14.0}]


def test_lines_split_an_uncovered_region_and_short_leftovers_are_dropped():
    regions = [(10.0, 30.0)]
    lines = [line("verse one", 12.0, 15.0), line("verse two", 15.5, 26.0)]
    assert uncovered_vocals(regions, lines, 2.5, 0.3) == [{"start": 26.3, "end": 30.0}]
    assert uncovered_vocals([(10.0, 12.0)], [], 2.5, 0.3) == []


def test_the_sync_report_names_the_unwritten_repeats(tmp_path):
    path = hook_song(str(tmp_path / "hook.wav"))
    result = sync_lyrics(path, [line("It's a good day", 2.0, 5.0)], engine="dsp")
    report = result.report
    assert len(report["vocal_regions"]) == 2
    (gap,) = report["uncovered_vocals"]
    assert abs(gap["start"] - 8.0) < 0.5 and abs(gap["end"] - 14.0) < 0.2


def test_a_stem_that_cannot_be_read_reports_no_regions(tmp_path):
    assert vocal_regions(load_evidence(str(tmp_path / "missing.wav"))) == []
