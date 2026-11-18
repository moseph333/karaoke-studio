"""Without a key to go by, a transposed chord is spelled with flats only when the chord it
came from had a flat: the note B is not one."""

import pytest

from backend.services.chord_detector import classify_key_spelling, transpose_chord


@pytest.mark.parametrize("chord", ["B", "Bm", "B7", "Bmaj7", "C/B", "Bsus4", "b"])
@pytest.mark.parametrize("key", [None, "Unknown", "C Major", "A Minor"])
def test_a_b_chord_is_not_a_flat_chord(chord, key):
    assert classify_key_spelling(key, chord) == "sharp"


@pytest.mark.parametrize("chord", ["Bb", "Bbm7", "Eb", "Abmaj7", "C/Bb", "Db/Ab", "B♭", "BB"])
@pytest.mark.parametrize("key", [None, "C Major"])
def test_a_chord_with_a_flat_keeps_flats(chord, key):
    assert classify_key_spelling(key, chord) == "flat"


def test_b_chords_transpose_to_sharps_without_a_key():
    assert transpose_chord("B", 2) == "C#"
    assert transpose_chord("Bm", -2) == "Am"
    assert transpose_chord("Bm7", 3) == "Dm7"
    assert transpose_chord("B7", -5) == "F#7"
    assert transpose_chord("C/B", 2) == "D/C#"
    # a flat chord still stays in flats
    assert transpose_chord("Bb", 3) == "Db"
