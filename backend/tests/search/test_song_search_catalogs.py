"""The song search against what the catalogs really answered for misspelled searches
(``helpers/song_catalogs``): the song meant comes first, the respelled words are searched
too, and a catalog that is down, slow or refusing requests costs only its own songs."""

import time

import pytest

from backend import config
from backend.services import song_search
from backend.tests.helpers.song_catalogs import FakeCatalogs, deezer_entry, itunes_entry


@pytest.fixture
def catalogs(monkeypatch):
    fake = FakeCatalogs()
    monkeypatch.setattr(song_search, "_get_json", fake)
    return fake


def _titles(outcome, count=5) -> list[str]:
    return [f"{song.title} | {song.artist}" for song in outcome.results[:count]]


@pytest.mark.parametrize(
    "typed,corrected,first",
    [
        ("wondewall oasis", "wonderwall oasis", "Wonderwall | Oasis"),
        ("adel rolling in the deap", "adele rolling in the deep", "Rolling in the Deep | Adele"),
        (
            "nirvna smels lik ten sprit",
            "nirvana smells like teen spirit",
            "Smells Like Teen Spirit | Nirvana",
        ),
        (
            "rick astly never gona give you up",
            "rick astley never gonna give you up",
            "Never Gonna Give You Up | Rick Astley",
        ),
        ("beyonse halo", "beyonce halo", "Halo | Beyoncé"),
        ("is this the real life is this just fantasy", None, "Bohemian Rhapsody | Queen"),
        ("queen", None, "Bohemian Rhapsody | Queen"),
    ],
)
def test_the_song_that_was_meant_comes_first(catalogs, typed, corrected, first):
    outcome = song_search.search_songs(typed)
    assert outcome.corrected == corrected
    assert _titles(outcome, 1) == [first]
    assert outcome.sources == ("deezer", "itunes")
    assert outcome.results[0].url


def test_deezers_own_order_for_the_typo_is_not_kept(catalogs):
    # Deezer lists two B-sides of the "Wonderwall" single first for "wondewall oasis"
    listed = [entry["title"] for entry in catalogs.deezer["wondewall oasis"][:3]]
    assert "The Swamp Song" in listed
    assert "The Swamp Song | Oasis" not in _titles(song_search.search_songs("wondewall oasis"))


def test_the_respelled_words_are_searched_too_and_the_itunes_store_only_once(catalogs):
    song_search.search_songs("wondewall oasis")
    assert catalogs.asked("suggest") == ["wondewall oasis"]
    assert sorted(catalogs.asked("deezer")) == ["wonderwall oasis", "wondewall oasis"]
    # The iTunes Store allows few requests a minute: it gets the best spelling only
    assert catalogs.asked("itunes") == ["wonderwall oasis"]


def test_without_a_suggestion_the_words_are_respelled_from_the_songs_found(catalogs):
    # YouTube's suggestions for this one are other word orders, not a respelling
    outcome = song_search.search_songs("nirvna smels lik ten sprit")
    assert outcome.corrected == "nirvana smells like teen spirit"
    assert catalogs.asked("deezer") == [
        "nirvna smels lik ten sprit",
        "nirvana smells like teen spirit",
    ]
    assert catalogs.asked("itunes") == [
        "nirvna smels lik ten sprit",
        "nirvana smells like teen spirit",
    ]
    # Deezer's first answer held covers and live takes only
    first = outcome.results[0]
    assert (first.title, first.artist, first.versions) == ("Smells Like Teen Spirit", "Nirvana", ())


def test_a_tribute_act_is_not_folded_into_the_artist(catalogs):
    outcome = song_search.search_songs("adel rolling in the deap")
    listed = _titles(outcome, 25)
    assert listed[0] == "Rolling in the Deep | Adele"
    assert "Rolling In The Deep | Hello I'm Adele" in listed[1:]
    # Deezer does not list Adele's own recording here: the song starts from Apple Music
    assert outcome.results[0].url.startswith("https://music.apple.com/us/song/")


def test_a_line_of_the_lyrics_keeps_the_catalogs_order(catalogs):
    outcome = song_search.search_songs("is this the real life is this just fantasy")
    listed = [title.lower() for title in _titles(outcome, 25)]
    assert listed[:2] == ["bohemian rhapsody | queen", "bohemian rhapsody | panic! at the disco"]
    # A song whose title is the first half of the line does not jump the queue
    assert all(not title.startswith("is this the real life") for title in listed[:3])


def test_an_artists_name_lists_that_artists_songs(catalogs):
    outcome = song_search.search_songs("queen")
    assert {song.artist for song in outcome.results[:5]} == {"Queen"}
    # Each recording once, though both catalogs list it and on several albums
    assert len(set(_titles(outcome, 25))) == len(outcome.results)


def test_a_song_carries_what_the_studio_shows_and_starts(monkeypatch):
    fake = FakeCatalogs(
        deezer={
            "halo": [
                deezer_entry(
                    "Halo",
                    "Beyoncé",
                    song_id=3135556,
                    duration=261,
                    rank=900_000,
                    album="I AM...SASHA FIERCE",
                    explicit_lyrics=True,
                    preview="https://cdnt-preview.dzcdn.net/halo.mp3?hdnea=exp=1",
                )
                | {
                    "album": {
                        "title": "I AM...SASHA FIERCE",
                        "cover_medium": "https://cdn-images.dzcdn.net/cover/250x250.jpg",
                    }
                }
            ]
        },
        itunes={
            "halo": [
                itunes_entry(
                    "Halo (Live)",
                    "Beyoncé",
                    song_id=42,
                    seconds=392.4,
                    album="I Am... World Tour - Single",
                    releaseDate="2010-11-26T08:00:00Z",
                    artworkUrl100="https://is1-ssl.mzstatic.com/a/100x100bb.jpg",
                    previewUrl="https://audio-ssl.itunes.apple.com/halo.m4a",
                    trackExplicitness="notExplicit",
                )
            ]
        },
        suggest={},
    )
    monkeypatch.setattr(song_search, "_get_json", fake)

    studio, live = (song.public() for song in song_search.search_songs("halo").results)

    assert studio == {
        "id": "deezer-3135556",
        "track_ids": ["deezer-3135556"],
        "url": "https://www.deezer.com/track/3135556",
        "title": "Halo",
        "artist": "Beyoncé",
        "album": "I AM...SASHA FIERCE",
        "year": None,
        "duration": 261.0,
        "thumbnail": "https://cdn-images.dzcdn.net/cover/250x250.jpg",
        "preview": "https://cdnt-preview.dzcdn.net/halo.mp3?hdnea=exp=1",
        "explicit": True,
        "versions": [],
    }
    assert live == {
        "id": "applemusic-42",
        "track_ids": ["applemusic-42"],
        "url": "https://music.apple.com/us/song/42",
        "title": "Halo (Live)",
        "artist": "Beyoncé",
        "album": "I Am... World Tour",
        "year": 2010,
        "duration": 392.4,
        "thumbnail": "https://is1-ssl.mzstatic.com/a/200x200bb.jpg",
        "preview": "https://audio-ssl.itunes.apple.com/halo.m4a",
        "explicit": False,
        "versions": ["live"],
    }


def test_entries_that_are_not_songs_or_lack_a_name_are_skipped(monkeypatch):
    fake = FakeCatalogs(
        deezer={
            "x": [
                deezer_entry("", "Nobody", song_id=1),
                deezer_entry("Untitled", "", song_id=2),
                {"type": "album", "id": 3, "title": "An Album", "artist": {"name": "Band"}},
                "not an entry",
                deezer_entry("Real Song", "Band", song_id=4),
            ]
        },
        itunes={
            "x": [
                itunes_entry("A Music Video", "Band", song_id=5) | {"kind": "music-video"},
                itunes_entry("No Id", "Band") | {"trackId": None},
            ]
        },
        suggest={},
    )
    monkeypatch.setattr(song_search, "_get_json", fake)
    assert _titles(song_search.search_songs("x")) == ["Real Song | Band"]


def test_the_itunes_store_searched_is_the_configured_countrys(monkeypatch):
    fake = FakeCatalogs(
        deezer={},
        itunes={"yoasobi": [itunes_entry("夜に駆ける", "YOASOBI", song_id=7)]},
        suggest={},
    )
    monkeypatch.setattr(song_search, "_get_json", fake)
    monkeypatch.setattr(config, "SONG_SEARCH_COUNTRY", "jp")

    [song] = song_search.search_songs("yoasobi").results

    assert song.url == "https://music.apple.com/jp/song/7"
    itunes_params = next(p for p in fake.params if "term" in p)
    assert (itunes_params["country"], itunes_params["entity"]) == ("jp", "song")


def test_an_answer_is_kept_for_the_same_words_typed_again(catalogs):
    first = song_search.search_songs("queen")
    asked = len(catalogs.requests)
    again = song_search.search_songs("  Queen ")
    assert len(catalogs.requests) == asked
    assert _titles(again) == _titles(first)

    song_search.reset()
    song_search.search_songs("queen")
    assert len(catalogs.requests) == 2 * asked


def test_a_catalog_that_is_down_costs_only_its_own_songs(monkeypatch):
    fake = FakeCatalogs(down=("deezer",))
    monkeypatch.setattr(song_search, "_get_json", fake)

    outcome = song_search.search_songs("beyonse halo")

    assert outcome.sources == ("itunes",)
    assert _titles(outcome, 1) == ["Halo | Beyoncé"]


def test_spelling_suggestions_that_fail_leave_the_search_working(monkeypatch):
    fake = FakeCatalogs(down=("suggest",))
    monkeypatch.setattr(song_search, "_get_json", fake)

    outcome = song_search.search_songs("beyonse halo")

    # Respelled from the songs Deezer found for the typo instead
    assert outcome.corrected == "beyonce halo"
    assert _titles(outcome, 1) == ["Halo | Beyoncé"]


def test_no_catalog_answering_finds_nothing_and_is_asked_again_next_time(monkeypatch):
    fake = FakeCatalogs(down=("deezer", "itunes", "suggest"))
    monkeypatch.setattr(song_search, "_get_json", fake)

    outcome = song_search.search_songs("queen")
    assert (outcome.results, outcome.sources) == ([], ())

    # Not remembered: the catalogs may be back
    fake.down.clear()
    assert song_search.search_songs("queen").sources == ("deezer", "itunes")


def test_a_catalog_that_refuses_requests_is_left_alone_for_a_while(monkeypatch):
    fake = FakeCatalogs(refusing=("itunes",))
    monkeypatch.setattr(song_search, "_get_json", fake)

    assert song_search.search_songs("queen").sources == ("deezer",)
    assert song_search.search_songs("beyonse halo").sources == ("deezer",)
    assert fake.asked("itunes") == ["queen"]

    # Asked again once the pause is over
    monkeypatch.setattr(song_search, "PAUSE_SEC", 0.0)
    song_search.reset()
    song_search.search_songs("wondewall oasis")
    song_search.search_songs("adel rolling in the deap")
    assert len(fake.asked("itunes")) == 3


def test_deezers_quota_answer_counts_as_a_refusal(monkeypatch):
    def quota(url, params):
        return {"error": {"type": "Exception", "message": "Quota limit exceeded", "code": 4}}

    monkeypatch.setattr(song_search, "_get_json", quota)
    with pytest.raises(song_search.CatalogRefused, match="Quota"):
        song_search.deezer_songs("queen")

    def broken(url, params):
        return {"error": {"type": "ParameterException", "message": "Wrong parameter", "code": 500}}

    monkeypatch.setattr(song_search, "_get_json", broken)
    with pytest.raises(RuntimeError, match="Wrong parameter"):
        song_search.deezer_songs("queen")


def test_a_slow_catalog_is_not_waited_for(monkeypatch):
    fake = FakeCatalogs()

    def slow_itunes(url, params):
        if url == song_search.ITUNES_SEARCH_URL:
            time.sleep(0.6)
        return fake(url, params)

    monkeypatch.setattr(song_search, "_get_json", slow_itunes)
    monkeypatch.setattr(song_search, "SEARCH_DEADLINE_SEC", 0.2)

    started = time.monotonic()
    outcome = song_search.search_songs("queen")

    assert time.monotonic() - started < 0.55
    assert outcome.sources == ("deezer",)
    assert outcome.results


@pytest.mark.parametrize(
    "sources,asked",
    [
        (("deezer",), {"deezer"}),
        (("itunes",), {"itunes"}),
        (("deezer", "suggest"), {"deezer", "suggest"}),
        (("suggest",), set()),
        ((), set()),
    ],
)
def test_only_the_configured_services_are_asked(catalogs, monkeypatch, sources, asked):
    monkeypatch.setattr(config, "SONG_SEARCH_SOURCES", sources)

    outcome = song_search.search_songs("queen")

    assert {service for service, _ in catalogs.requests} == asked
    assert set(outcome.sources) == asked - {"suggest"}
    assert bool(outcome.results) == bool(asked)


@pytest.mark.parametrize("query", ["", "   ", None])
def test_no_words_ask_nothing(catalogs, query):
    assert song_search.search_songs(query).results == []
    assert catalogs.requests == []


@pytest.mark.parametrize(
    "raw,sources",
    [
        (None, ("deezer", "itunes", "suggest")),
        ("", ("deezer", "itunes", "suggest")),
        ("deezer", ("deezer",)),
        (" iTunes , DEEZER ", ("deezer", "itunes")),
        ("none", ()),
        ("off", ()),
        ("deezer,spotify", ("deezer",)),
    ],
)
def test_the_sources_setting_names_known_services(raw, sources):
    assert config._song_search_sources(raw) == sources


@pytest.mark.parametrize(
    "raw,country",
    [(None, "us"), ("", "us"), ("GB", "gb"), (" jp ", "jp"), ("usa", "us"), ("1x", "us")],
)
def test_the_country_setting_is_a_two_letter_store(raw, country):
    assert config._song_search_country(raw) == country
