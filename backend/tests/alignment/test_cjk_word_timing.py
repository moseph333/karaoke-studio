"""Japanese (and other CJK) lyrics are timed one character at a time, as karaoke shows
them, and split lines keep their source spacing."""

from backend.services.aligner import AudioAligner
from backend.services.lyric_cleanup import split_long_line
from backend.services.lyric_tokenize import join_lyric_tokens, tokenize_lyric_text
from backend.services.lyrics import LyricsService
from backend.tests.helpers.audio_signals import write_test_wav

LINE = "幸せなサメ サメ (Shiawase na same, same)"


def test_a_fetched_japanese_line_has_one_word_per_character():
    (parsed, _) = LyricsService.parse_lrc(f"[03:14.62]{LINE}\n[03:20.27]我々は\n")[:2]
    assert [w["word"] for w in parsed["words"]][:7] == ["幸", "せ", "な", "サ", "メ", "サ", "メ"]
    assert [w["word"] for w in parsed["words"]][7:] == ["(Shiawase", "na", "same,", "same)"]
    starts = [w["start_time"] for w in parsed["words"]]
    assert starts == sorted(starts)


def test_pasted_japanese_lyrics_split_the_same_way():
    (parsed,) = LyricsService.parse_plain_text("我々わ、LASERお設置")
    assert [w["word"] for w in parsed["words"]] == ["我", "々", "わ、", "LASER", "お", "設", "置"]


def test_the_aligner_times_each_character(tmp_path):
    path = write_test_wav(str(tmp_path / "v.wav"), 6.0, [{"start": 1.0, "end": 4.0, "freq": 440}])
    lines = [{"id": 0, "text": "我々は空間に", "start_time": 1.0, "end_time": 4.0}]
    (aligned,) = AudioAligner().align_lyrics(path, lines)
    words = aligned["words"]
    assert [w["word"] for w in words] == list("我々は空間に")
    assert all(w["end_time"] > w["start_time"] for w in words)
    assert words[0]["start_time"] >= 0.9 and words[-1]["end_time"] <= 4.6


def test_joining_tokens_keeps_the_source_spacing():
    assert join_lyric_tokens(tokenize_lyric_text(LINE), LINE) == LINE
    # Without the source, no space goes around CJK characters
    assert join_lyric_tokens(["我", "々", "は", "LASER"]) == "我々はLASER"
    assert join_lyric_tokens(["Lasers", "from", "the", "dark"]) == "Lasers from the dark"


def test_a_long_japanese_line_counts_characters_not_words():
    tokens = tokenize_lyric_text("空間に日本が行ってきました (Kuukan ni nippon ga ittekimashita)")
    line = {
        "id": 0,
        "text": "空間に日本が行ってきました (Kuukan ni nippon ga ittekimashita)",
        "start_time": 0.0,
        "end_time": len(tokens) * 0.2,
        "words": [
            {"word": t, "start_time": i * 0.2, "end_time": (i + 1) * 0.2}
            for i, t in enumerate(tokens)
        ],
    }
    assert split_long_line(line) == [line]
