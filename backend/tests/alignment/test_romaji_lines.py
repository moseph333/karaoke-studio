"""A Japanese line written with its romanization in parentheses shows the romanization
under it and is timed by it."""

import json

from backend.services.ass_generator import generate_ass_content
from backend.services.line_realign import realign_line
from backend.services.lyric_cleanup import clean_fetched_lines, split_romaji
from backend.services.lyric_sync import romaji_onto_characters, sync_lyrics
from backend.services.lyrics import LyricsService
from backend.services.repeat_fill import fill_repeats
from backend.tests.helpers.audio_signals import write_test_wav
from backend.tests.helpers.fake_ctc_worker import install_fake_ctc
from backend.tests.helpers.lrclib_listings import LASER_SHARKS_CLEAN


def parsed(text: str, start: float = 1.0, end: float = 4.0) -> dict:
    (line,) = LyricsService.parse_lrc(f"[00:{start:05.2f}]{text}\n[00:{end:05.2f}]\n")[:1]
    return line


def test_the_romanization_is_split_off_and_the_characters_fill_the_line():
    line = split_romaji(parsed("我々和かつ (Wareware wa katsu)"))
    assert (line["text"], line["romaji"]) == ("我々和かつ", "Wareware wa katsu")
    assert [w["word"] for w in line["words"]] == list("我々和かつ")
    assert line["words"][0]["start_time"] == line["start_time"]
    assert abs(line["words"][-1]["end_time"] - line["end_time"]) < 0.01


def test_lines_that_are_not_a_cjk_line_with_its_romanization_stay():
    for text in ("(It's the laser sharks)", "Lasers (from the dark)", "幸せなサメ"):
        line = parsed(text)
        assert split_romaji(line) is line


def test_an_ad_lib_or_translation_in_parentheses_is_not_a_romanization():
    for text in (
        "君のことが好きだから (Yeah)",
        "愛 (I love you so much, baby, tonight)",
    ):
        line = parsed(text)
        assert split_romaji(line) is line
    for text, romaji in (
        ("東京 (Tōkyō)", "Tōkyō"),
        ("ちょっと待って (Chotto matte)", "Chotto matte"),
        ("我爱你 (Wo ai ni)", "Wo ai ni"),
    ):
        assert split_romaji(parsed(text))["romaji"] == romaji


def test_a_few_latin_parentheticals_in_a_japanese_song_stay_in_the_lyrics():
    texts = ["君のことが好き", "忘れないよ", "愛してる (Oh baby yeah)", "夢の中で", "さよなら"]
    lrc = "".join(f"[00:{4 * i + 1:02d}.00]{text}\n" for i, text in enumerate(texts))
    lines = clean_fetched_lines(LyricsService.parse_lrc(lrc))
    assert [line["text"] for line in lines] == texts
    assert not any(line.get("romaji") for line in lines)


def test_every_japanese_line_of_laser_sharks_gets_its_romaji():
    lines = clean_fetched_lines(LyricsService.parse_lrc(LASER_SHARKS_CLEAN["syncedLyrics"]))
    japanese = [line for line in lines if line.get("romaji")]
    assert len(japanese) == 10
    assert japanese[0]["text"] == "幸せなサメ サメ"
    assert japanese[0]["romaji"] == "Shiawase na same, same"


def test_the_neural_aligner_is_given_the_romanization(tmp_path, monkeypatch):
    state = install_fake_ctc(tmp_path, monkeypatch)
    path = write_test_wav(str(tmp_path / "v.wav"), 8.0, [{"start": 1.0, "end": 5.0, "freq": 440}])
    line = split_romaji(parsed("我々和かつ (Wareware wa katsu)", 1.0, 5.0))
    result = sync_lyrics(path, [line], engine="ctc")
    request = json.loads(state.log.read_text())
    assert request["lines"][0]["words"] == ["wareware", "wa", "katsu"]
    (timed,) = result.lines
    assert timed["align_method"] == "ctc"
    assert timed["romaji"] == "Wareware wa katsu"
    assert [w["word"] for w in timed["words"]] == list("我々和かつ")
    starts = [w["start_time"] for w in timed["words"]]
    assert starts == sorted(starts)


def test_re_timing_one_line_gives_the_neural_aligner_the_romanization(tmp_path, monkeypatch):
    state = install_fake_ctc(tmp_path, monkeypatch)
    path = write_test_wav(str(tmp_path / "v.wav"), 8.0, [{"start": 1.0, "end": 5.0, "freq": 440}])
    line = split_romaji(parsed("我々和かつ (Wareware wa katsu)", 1.0, 5.0))
    result = realign_line(path, line, engine="ctc")
    request = json.loads(state.log.read_text())
    assert request["lines"][0]["words"] == ["wareware", "wa", "katsu"]
    assert (result.status, result.engine) == ("ok", "ctc")
    assert result.line["romaji"] == "Wareware wa katsu"
    assert [w["word"] for w in result.line["words"]] == list("我々和かつ")
    starts = [w["start_time"] for w in result.line["words"]]
    assert starts == sorted(starts)


def test_a_repeated_japanese_hook_is_listened_for_by_its_romanization(tmp_path, monkeypatch):
    state = install_fake_ctc(tmp_path, monkeypatch)
    path = write_test_wav(str(tmp_path / "v.wav"), 60.0, [{"start": 1.0, "end": 50.0, "freq": 440}])
    hook = split_romaji(parsed("我々和かつ (Wareware wa katsu)", 1.0, 5.0))
    lines = [{**hook, "id": 0}, {**hook, "id": 1, "start_time": 40.0, "end_time": 44.0}]
    filled, added = fill_repeats(path, lines, [{"start": 10.0, "end": 14.0}])
    request = json.loads(state.log.read_text())
    assert request["lines"][0]["words"] == ["wareware", "wa", "katsu"]
    assert added >= 1
    repeat = next(entry for entry in filled if entry.get("added") == "repeat")
    assert repeat["romaji"] == "Wareware wa katsu"
    assert [w["word"] for w in repeat["words"]] == list("我々和かつ")
    assert 10.0 <= repeat["start_time"] < repeat["end_time"] <= 14.0


def test_romanized_timing_is_spread_over_the_characters():
    neural = {
        "status": "ok",
        "line_score": 0.9,
        "words": [
            {"start": 2.0, "end": 2.5, "score": 0.8},
            {"start": 2.6, "end": 2.8, "score": 0.9},
            {"start": 2.9, "end": 3.5, "score": 1.0},
        ],
    }
    line = {"words": [{"word": c} for c in "我々和かつ"]}
    mapped = romaji_onto_characters(neural, line)
    assert len(mapped["words"]) == 5
    assert mapped["words"][0]["start"] == 2.0 and mapped["words"][-1]["end"] == 3.5
    assert romaji_onto_characters({"status": "failed"}, line) == {"status": "failed"}


def test_the_export_shows_the_romanization_under_the_line():
    line = split_romaji(parsed("我々和かつ (Wareware wa katsu)"))
    ass = generate_ass_content([line])
    dialogue = next(entry for entry in ass.splitlines() if entry.startswith("Dialogue: 0,"))
    lyric, romaji = dialogue.split("\\N")
    assert "我" in lyric and "Wareware" not in lyric
    assert romaji.endswith("Wareware wa katsu") and "\\fscx62" in romaji
