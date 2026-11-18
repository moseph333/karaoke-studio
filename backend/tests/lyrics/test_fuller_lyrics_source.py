"""When LRCLIB's lyrics list a repeated hook only once, NetEase's fuller transcription of the
same song is used instead, if it is no sloppier."""

import re
from unittest.mock import MagicMock, patch

import pytest

import backend.services.lyrics as lyrics_mod
from backend.services.lyrics import (
    LyricsService,
    is_fuller_transcription,
    writes_repeats_once,
)
from backend.tests.helpers.lrclib_listings import (
    LASER_SHARKS_CLEAN,
    METAPHYSICAL,
    METAPHYSICAL_NETEASE,
)


def lrclib_answer(payload):
    resp = MagicMock(status_code=200)
    resp.json.return_value = payload
    return resp


@pytest.fixture
def netease(monkeypatch):
    calls = []

    def fake(query, **kwargs):
        calls.append((query, kwargs))
        return fake.answer

    fake.answer = None
    monkeypatch.setattr(lyrics_mod.syncedlyrics, "search", fake)
    fake.calls = calls
    return fake


def test_metaphysical_from_lrclib_writes_its_hook_once():
    assert writes_repeats_once(LyricsService.parse_lrc(METAPHYSICAL["syncedLyrics"]))


def test_a_song_whose_lines_never_repeat_is_not_sparse():
    lines = [
        {"text": f"line number {i}", "start_time": i * 20.0, "end_time": i * 20.0 + 3}
        for i in range(5)
    ]
    assert not writes_repeats_once(lines)


def test_neteases_metaphysical_is_the_fuller_transcription():
    current = {
        "lines": LyricsService.parse_lrc(METAPHYSICAL["syncedLyrics"]),
        "lrc": METAPHYSICAL["syncedLyrics"],
    }
    fuller = LyricsService.parse_lrc(METAPHYSICAL_NETEASE)
    assert is_fuller_transcription(current, METAPHYSICAL_NETEASE, fuller)
    # Another song, or one with fewer lines, is not
    sharks = LyricsService.parse_lrc(LASER_SHARKS_CLEAN["syncedLyrics"])
    assert not is_fuller_transcription(current, LASER_SHARKS_CLEAN["syncedLyrics"], sharks)
    assert not is_fuller_transcription(current, METAPHYSICAL_NETEASE, fuller[:20])


def test_fetching_metaphysical_uses_neteases_lyrics(netease):
    netease.answer = METAPHYSICAL_NETEASE
    with patch("requests.get", return_value=lrclib_answer(METAPHYSICAL)):
        result = LyricsService().fetch_lyrics(
            "Metaphysical (A Good Day)", "Handsome Boy Modeling School", 206
        )
    assert result["source"] == "netease"
    texts = [line["text"] for line in result["lines"]]
    assert sum(1 for t in texts if t.startswith("It's a good day")) > 3
    assert not any(t.startswith("作词") for t in texts)
    (query, kwargs) = netease.calls[0]
    assert query == "Handsome Boy Modeling School - Metaphysical (A Good Day)"
    assert kwargs["providers"] == ["NetEase"]


def test_lrclibs_lyrics_stay_when_netease_has_nothing_better(netease):
    with patch("requests.get", return_value=lrclib_answer(LASER_SHARKS_CLEAN)):
        result = LyricsService().fetch_lyrics("Laser Sharks", "Savant", 242)
    assert result["source"] == "lrclib"
    netease.answer = "[00:01.00] some other song entirely\n[00:05.00] with words\n"
    with patch("requests.get", return_value=lrclib_answer(METAPHYSICAL)):
        result = LyricsService().fetch_lyrics(
            "Metaphysical (A Good Day)", "Handsome Boy Modeling School", 206
        )
    assert result["source"] == "lrclib"


def test_neteases_lyrics_for_a_longer_version_are_not_taken(netease):
    current = {
        "lines": LyricsService.parse_lrc(METAPHYSICAL["syncedLyrics"]),
        "lrc": METAPHYSICAL["syncedLyrics"],
    }
    # The same words a minute later: an extended version whose last lines start after the
    # 206 s of audio have ended
    extended = re.sub(r"\[(\d\d):", lambda m: f"[{int(m.group(1)) + 1:02d}:", METAPHYSICAL_NETEASE)
    lines = LyricsService.parse_lrc(extended)
    assert is_fuller_transcription(current, extended, lines)
    assert not is_fuller_transcription(current, extended, lines, 206)
    assert is_fuller_transcription(
        current, METAPHYSICAL_NETEASE, LyricsService.parse_lrc(METAPHYSICAL_NETEASE), 206
    )

    netease.answer = extended
    with patch("requests.get", return_value=lrclib_answer(METAPHYSICAL)):
        result = LyricsService().fetch_lyrics(
            "Metaphysical (A Good Day)", "Handsome Boy Modeling School", 206
        )
    assert result["source"] == "lrclib"


def test_a_failing_netease_lookup_keeps_lrclibs_lyrics(monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("network down")

    monkeypatch.setattr(lyrics_mod.syncedlyrics, "search", boom)
    with patch("requests.get", return_value=lrclib_answer(METAPHYSICAL)):
        result = LyricsService().fetch_lyrics(
            "Metaphysical (A Good Day)", "Handsome Boy Modeling School", 206
        )
    assert result["source"] == "lrclib"
