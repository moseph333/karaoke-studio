"""An all-caps lyric file is put into sentence case; other files keep their casing."""

from backend.services.lyric_cleanup import is_all_caps, sentence_case_lines


def line(text: str) -> dict:
    words = text.split()
    return {
        "id": 0,
        "text": text,
        "start_time": 0.0,
        "end_time": 1.0,
        "words": [{"word": w, "start_time": 0.0, "end_time": 1.0} for w in words],
    }


SHOUTING = [
    line("A DIFFERENT PRODUCT OF EVOLUTION"),
    line("I'M HERE TO CRUSH THE REVOLUTION. THEY CAME TO SAVE THE DAY"),
    line("(IT'S THE LASER SHARKS) OK, I SAID IT ON TV IN THE U.S."),
]


def test_an_all_caps_song_becomes_sentence_case():
    texts = [entry["text"] for entry in sentence_case_lines(SHOUTING)]
    assert texts == [
        "A different product of evolution",
        "I'm here to crush the revolution. They came to save the day",
        "(It's the laser sharks) OK, I said it on TV in the U.S.",
    ]


def test_words_follow_the_new_text():
    for entry in sentence_case_lines(SHOUTING):
        assert " ".join(w["word"] for w in entry["words"]) == entry["text"]


def test_a_mixed_case_song_is_left_alone():
    song = [line("Mutants from OUTER SPACE"), line("American all the way, they came to SAVE")]
    assert sentence_case_lines(song) is song


def test_a_few_shouted_words_do_not_count_as_an_all_caps_song():
    assert not is_all_caps(["HEY!", "OH"])
    assert is_all_caps(["MUTANTS FROM OUTER SPACE", "AMERICAN ALL THE WAY TODAY"])
