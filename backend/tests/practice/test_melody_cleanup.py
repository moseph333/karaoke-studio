"""melody.clean_contour: a raw pitch track made into something a voice can follow. Octave
slips are put back, breaths inside a note drawn through, and blips dropped; a real leap and a
real pause stay."""

import numpy as np

from backend.services.melody import clean_contour

HOP = 0.032
NAN = float("nan")


def _track(*pieces) -> np.ndarray:
    """A pitch track from (note, frames) pieces; a note of None is silence."""
    out: list[float] = []
    for note, frames in pieces:
        out.extend([NAN if note is None else float(note)] * frames)
    return np.array(out, dtype=float)


def _sung(track: np.ndarray) -> np.ndarray:
    return ~np.isnan(track)


def test_a_steady_note_is_left_as_it_is():
    track = _track((60, 40))

    assert np.array_equal(clean_contour(track, HOP), track)


def test_a_short_slip_an_octave_up_is_put_back():
    track = _track((60, 20), (72, 4), (60, 20))

    cleaned = clean_contour(track, HOP)

    assert np.allclose(cleaned, 60.0)


def test_a_short_slip_an_octave_down_is_put_back():
    track = _track((67, 20), (55, 5), (67, 20))

    assert np.allclose(clean_contour(track, HOP), 67.0)


def test_a_held_octave_leap_is_a_real_one():
    # A second up the octave: long enough to be sung on purpose
    track = _track((60, 20), (72, 32), (60, 20))

    cleaned = clean_contour(track, HOP)

    assert np.allclose(cleaned[25:45], 72.0)
    assert np.allclose(cleaned[:15], 60.0)


def test_a_short_note_a_fifth_away_is_not_an_octave_slip():
    track = _track((60, 20), (67, 5), (60, 20))

    assert np.allclose(clean_contour(track, HOP)[21:24], 67.0)


def test_a_leap_at_the_end_of_a_phrase_is_kept():
    # Nothing follows it to say it was a slip
    track = _track((60, 20), (72, 5), (None, 30))

    assert np.allclose(clean_contour(track, HOP)[21:24], 72.0)


def test_a_breath_of_a_frame_or_two_inside_a_note_is_drawn_through():
    track = _track((62, 15), (None, 2), (62, 15))

    cleaned = clean_contour(track, HOP)

    assert _sung(cleaned).all()
    assert np.allclose(cleaned, 62.0)


def test_a_longer_pause_stays_a_pause():
    track = _track((62, 15), (None, 6), (62, 15))

    cleaned = clean_contour(track, HOP)

    assert not _sung(cleaned)[15:21].any()
    assert _sung(cleaned)[:15].all()


def test_a_short_pause_between_two_different_notes_stays():
    track = _track((60, 15), (None, 2), (65, 15))

    assert not _sung(clean_contour(track, HOP))[15:17].any()


def test_a_blip_too_short_to_sing_is_dropped():
    track = _track((None, 20), (64, 2), (None, 20), (64, 10))

    cleaned = clean_contour(track, HOP)

    assert not _sung(cleaned)[:42].any()
    assert _sung(cleaned)[42:].all()


def test_jitter_is_evened_out_without_moving_the_note():
    rng = np.random.default_rng(7)
    track = 60 + rng.normal(0, 0.3, 200)
    track[50] = 63.0  # one wild frame

    cleaned = clean_contour(track, HOP)

    assert abs(cleaned[50] - 60) < 0.6
    assert np.std(cleaned) < np.std(track)
    assert abs(np.mean(cleaned) - 60) < 0.1


def test_a_step_between_notes_stays_where_it_is():
    track = _track((60, 30), (64, 30))

    cleaned = clean_contour(track, HOP)

    assert np.allclose(cleaned[:28], 60.0)
    assert np.allclose(cleaned[32:], 64.0)


def test_nothing_sung_and_nothing_at_all_are_safe():
    silent = _track((None, 50))

    assert np.isnan(clean_contour(silent, HOP)).all()
    assert len(clean_contour(np.array([]), HOP)) == 0
    assert len(clean_contour(np.array([60.0]), HOP)) == 1


def test_the_track_keeps_its_length_and_is_not_changed_in_place():
    track = _track((60, 20), (72, 4), (60, 20), (None, 2), (60, 5))
    before = track.copy()

    cleaned = clean_contour(track, HOP)

    assert len(cleaned) == len(track)
    assert np.array_equal(track, before, equal_nan=True)
