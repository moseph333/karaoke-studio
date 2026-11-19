"""An album upload without chapters finds its songs in the album's track list on Deezer or
the iTunes Store: the album of that artist and name whose songs add up to the upload's
length. A deluxe edition with bonus songs, or another artist's album of the same name, is
not the recording. The answers below are trimmed copies of what both catalogs return."""

import pytest

from backend.services import album_tracks, song_search
from backend.services.album_tracks import find_catalog_album, tracks_from_lengths

OK_COMPUTER = [
    ("Airbag", 284),
    ("Paranoid Android", 383),
    ("Subterranean Homesick Alien", 267),
    ("Exit Music (For A Film)", 264),
    ("Let Down", 299),
    ("Karma Police", 264),
]
LENGTH = sum(length for _, length in OK_COMPUTER)


def _deezer_tracks(songs, artist="Radiohead"):
    return {"data": [{"title": t, "duration": d, "artist": {"name": artist}} for t, d in songs]}


class Catalogs:
    """Stands in for song_search._get_json: answers album searches and track lists."""

    def __init__(self, deezer=True, itunes=True):
        self.deezer, self.itunes = deezer, itunes
        self.asked: list[str] = []

    def __call__(self, url, params):
        self.asked.append(url)
        if url == album_tracks.DEEZER_ALBUM_SEARCH_URL:
            if not self.deezer:
                raise song_search.CatalogRefused("HTTP 429")
            return {
                "data": [
                    # Same name, other artist: never read
                    {"id": 1, "title": "OK Computer", "artist": {"name": "Mother Falcon"}},
                    {
                        "id": 2,
                        "title": "OK Computer OKNOTOK 1997 2017",
                        "artist": {"name": "Radiohead"},
                    },
                    {
                        "id": 3,
                        "title": "OK Computer (Collector's Edition)",
                        "artist": {"name": "Radiohead"},
                    },
                    {"id": 4, "title": "OK Computer", "artist": {"name": "Radiohead"}},
                ]
            }
        if url == album_tracks.DEEZER_ALBUM_TRACKS_URL.format(id=3):
            # A deluxe edition: the album and a bonus disc
            return _deezer_tracks([*OK_COMPUTER, ("Bonus", 300), ("Another Bonus", 280)])
        if url == album_tracks.DEEZER_ALBUM_TRACKS_URL.format(id=4):
            return _deezer_tracks(OK_COMPUTER)
        if url == album_tracks.ITUNES_SEARCH_URL:
            if not self.itunes:
                raise RuntimeError("down")
            return {
                "results": [
                    {"collectionId": 77, "collectionName": "OK Computer", "artistName": "Radiohead"}
                ]
            }
        if url == album_tracks.ITUNES_LOOKUP_URL:
            # Out of order, as the lookup may list them; disc and track numbers order them
            songs = [
                {
                    "kind": "song",
                    "trackName": title,
                    "trackTimeMillis": length * 1000 + 400,
                    "trackNumber": number,
                    "discNumber": 1,
                    "artistName": "Radiohead",
                }
                for number, (title, length) in enumerate(OK_COMPUTER, start=1)
            ]
            return {"results": [{"wrapperType": "collection"}, *reversed(songs)]}
        raise AssertionError(f"unexpected request {url}")


@pytest.fixture
def catalogs(monkeypatch):
    fake = Catalogs()
    monkeypatch.setattr(song_search, "_get_json", fake)
    return fake


def test_the_album_whose_songs_add_up_to_the_upload_is_found(catalogs):
    album = find_catalog_album("Radiohead", "OK Computer", LENGTH + 6)
    assert album is not None
    assert album.title == "OK Computer"
    assert [title for title, _, _ in album.songs] == [title for title, _ in OK_COMPUTER]
    # The other artist's album of that name was never read
    assert album_tracks.DEEZER_ALBUM_TRACKS_URL.format(id=1) not in catalogs.asked


def test_a_deluxe_edition_with_bonus_songs_is_not_the_recording(catalogs):
    album = find_catalog_album("Radiohead", "OK Computer", LENGTH)
    assert album.link == "https://www.deezer.com/album/4"
    # The deluxe edition is the recording only when the recording has its bonus songs
    deluxe = find_catalog_album("Radiohead", "OK Computer", LENGTH + 580)
    assert deluxe.link == "https://www.deezer.com/album/3"


def test_the_itunes_store_answers_when_deezer_does_not_and_orders_by_track(monkeypatch):
    monkeypatch.setattr(song_search, "_get_json", Catalogs(deezer=False))
    album = find_catalog_album("Radiohead", "OK Computer", LENGTH)
    assert album.site == "itunes"
    assert album.songs[0][0] == "Airbag"
    assert album.songs[1][1] == pytest.approx(383.4)


def test_nothing_is_found_when_no_album_fits_the_length(catalogs):
    assert find_catalog_album("Radiohead", "OK Computer", LENGTH + 1500) is None


def test_nothing_is_asked_without_an_artist_or_a_name_or_with_no_sources(catalogs):
    assert find_catalog_album("", "OK Computer", LENGTH) is None
    assert find_catalog_album("Radiohead", "OK Computer", LENGTH, sources=()) is None
    assert catalogs.asked == []


def test_catalogs_that_do_not_answer_find_nothing(monkeypatch):
    monkeypatch.setattr(song_search, "_get_json", Catalogs(deezer=False, itunes=False))
    assert find_catalog_album("Radiohead", "OK Computer", LENGTH) is None


def test_songs_are_placed_end_to_end_and_the_last_ends_with_the_recording():
    songs = [(title, float(length), "Radiohead") for title, length in OK_COMPUTER]
    tracks = tracks_from_lengths(songs, LENGTH + 10, "Radiohead")
    assert tracks[1].start == 284.0
    assert tracks[-1].end == LENGTH + 10
    assert all(not t.artist for t in tracks)


def test_a_featured_artist_is_kept_on_its_song():
    tracks = tracks_from_lengths([("A", 100.0, "Band"), ("B", 100.0, "Rapper X")], 200, "Band")
    assert [t.artist for t in tracks] == ["", "Rapper X"]
