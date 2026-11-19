"""How the song search reads and orders songs, without any catalog: typed words against a
song's words with a typo allowance, what a title's brackets say about the recording, which
entries are one recording, which suggestion is a respelling, and what ranks first."""

import pytest

from backend.services.song_search import (
    Song,
    base_title,
    fold,
    merge_songs,
    names_songs,
    pick_correction,
    rank_songs,
    respell_from_songs,
    same_artist,
    version_labels,
    word_similarity,
    words,
)


def _song(title, artist, **fields) -> Song:
    fields.setdefault("links", {"deezer": f"https://www.deezer.com/track/{abs(hash(title))}"})
    fields.setdefault("track_ids", [f"deezer-{abs(hash((title, artist)))}"])
    return Song(title=title, artist=artist, **fields)


def _ranked(songs, query, corrected=None, named=True) -> list[str]:
    return [f"{s.title} | {s.artist}" for s in rank_songs(songs, query, corrected, named)]


@pytest.mark.parametrize(
    "text,folded",
    [
        ("Beyoncé", "beyonce"),
        ("Don't Stop Believin'", "dont stop believin"),
        ("Guns N’ Roses", "guns n roses"),
        ("Simon & Garfunkel", "simon and garfunkel"),
        ("AC/DC", "ac dc"),
        ("  Mr.   Brightside ", "mr brightside"),
        ("夜に駆ける", "夜に駆ける"),
    ],
)
def test_words_are_compared_without_case_accents_or_punctuation(text, folded):
    assert fold(text) == folded
    assert words(text) == folded.split()


@pytest.mark.parametrize(
    "typed,word",
    [
        ("rapsody", "rhapsody"),
        ("quen", "queen"),
        ("beleiving", "believing"),
        ("smels", "smells"),
        ("ten", "teen"),
        ("califronia", "california"),
        ("rapsodi", "rhapsody"),
        ("beyonse", "beyonce"),
    ],
)
def test_a_misspelled_word_still_stands_for_the_word(typed, word):
    assert 0.6 < word_similarity(typed, word) < 1.0


@pytest.mark.parametrize(
    "typed,word",
    [
        ("hello", "halo"),
        ("an", "on"),
        ("i", "a"),
        ("queen", "green"),
        ("billy", "billie"),
        ("stairway", "highway"),
    ],
)
def test_a_word_further_off_than_a_typo_or_two_is_another_word(typed, word):
    assert word_similarity(typed, word) == 0.0


def test_a_word_being_typed_stands_for_the_word_it_begins():
    assert word_similarity("rha", "rhapsody") == 0.9
    assert word_similarity("believing", "believin") == 0.85
    # One letter begins too many words to mean any of them
    assert word_similarity("r", "rhapsody") == 0.0


@pytest.mark.parametrize(
    "title,labels",
    [
        ("Halo", ()),
        ("Live Forever", ()),
        ("Cover Me", ()),
        ("Demons", ()),
        ("Halo (Live)", ("live",)),
        ("Wonderwall (Live at Knebworth, 10 August '96)", ("live",)),
        ("Anti-Hero (Kungs Remix)", ("remix",)),
        ("Smells Like Teen Spirit (Devonshire Mix)", ("remix",)),
        ("Halo (Radio Edit)", ("edit",)),
        ("Poker Face (Glam As You Radio Mix)", ("edit",)),
        ("Wonderwall (Remastered)", ("remaster",)),
        ("Love Story (Taylor’s Version)", ("rerecorded",)),
        ("Shape of You (Acoustic)", ("acoustic",)),
        ("Wonderwall (Unplugged)", ("live", "acoustic")),
        ("Lose Yourself (Original Demo Version)", ("demo",)),
        ("Shape of You - Ed Sheeran (Instrumental)", ("instrumental",)),
        ("Rolling in the Deep (Originally Performed By Adele)", ("cover",)),
        ("Bohemian Rhapsody - Live Aid", ("live",)),
        ("Blinding Lights (Sped Up)", ("altered",)),
    ],
)
def test_a_titles_brackets_say_what_kind_of_recording_it_is(title, labels):
    assert version_labels(title) == labels


def test_the_songs_own_name_is_its_title_without_brackets_or_a_dash_suffix():
    assert base_title("Halo (Live) [2009]") == "Halo"
    assert base_title("夜に駆ける - From THE FIRST TAKE") == "夜に駆ける"
    assert base_title("(What's the Story) Morning Glory?") == "Morning Glory?"
    # A title that is all brackets stays as it is
    assert base_title("(I Can't Get No)") == "(I Can't Get No)"


@pytest.mark.parametrize(
    "a,b,same",
    [
        ("Luis Fonsi", "Luis Fonsi & Daddy Yankee", True),
        ("Lady Gaga", "Lady Gaga, Bradley Cooper", True),
        ("Beyoncé", "Beyonce", True),
        ("Simon & Garfunkel", "Simon & Garfunkel", True),
        ("Adele", "Hello I'm Adele", False),
        ("Queen", "The Muppets & Queen", False),
        ("Toto", "Toto Cutugno", False),
        ("Luis Fonsi & Daddy Yankee", "Luis Fonsi & Justin Bieber", False),
        ("", "Queen", False),
    ],
)
def test_two_credits_are_one_act_only_by_name_or_first_name(a, b, same):
    assert same_artist(a, b) is same
    assert same_artist(b, a) is same


def test_the_same_recording_from_both_catalogs_is_listed_once_with_both_links():
    deezer = _song(
        "Wonderwall",
        "Oasis",
        album="Stop The Clocks",
        duration=258,
        popularity=0.87,
        links={"deezer": "https://www.deezer.com/track/1"},
        track_ids=["deezer-1"],
        preview="https://cdnt-preview.dzcdn.net/x.mp3?hdnea=exp=1",
    )
    apple = _song(
        "Wonderwall",
        "Oasis",
        album="(What's the Story) Morning Glory?",
        year=1995,
        duration=258.9,
        links={"applemusic": "https://music.apple.com/us/song/2"},
        track_ids=["applemusic-2"],
        preview="https://audio-ssl.itunes.apple.com/x.m4a",
        position=3,
    )
    [song] = merge_songs([deezer, apple])
    assert song.links == {
        "deezer": "https://www.deezer.com/track/1",
        "applemusic": "https://music.apple.com/us/song/2",
    }
    assert song.track_ids == ["deezer-1", "applemusic-2"]
    assert (song.year, song.popularity, song.position) == (1995, 0.87, 0)
    # Started by its Deezer link; previewed from Apple, whose preview links do not expire
    assert song.url == "https://www.deezer.com/track/1"
    assert song.preview == "https://audio-ssl.itunes.apple.com/x.m4a"


def test_a_remaster_or_a_featured_credit_is_the_same_recording_shown_by_its_plain_title():
    songs = [
        _song("Never Gonna Give You Up (2022 Remaster)", "Rick Astley", duration=213.5),
        _song("Never Gonna Give You Up", "Rick Astley", duration=213, album="Whenever You Need"),
        _song("Under Pressure (feat. David Bowie)", "Queen", duration=246),
        _song("Under Pressure", "Queen & David Bowie", duration=248),
    ]
    merged = merge_songs(songs)
    assert [(s.title, s.album, s.versions) for s in merged] == [
        ("Never Gonna Give You Up", "Whenever You Need", ()),
        ("Under Pressure (feat. David Bowie)", "", ()),
    ]


def test_other_versions_lengths_and_artists_stay_separate():
    songs = [
        _song("Halo", "Beyoncé", duration=261),
        _song("Halo (Live)", "Beyoncé", duration=262),
        _song("Halo (Radio Edit)", "Beyoncé", duration=261),
        _song("Halo", "Beyoncé", duration=224),
        _song("Halo", "Cage the Elephant", duration=261),
        _song("Never Gonna Give You Up (Pianoforte)", "Rick Astley", duration=213),
        _song("Never Gonna Give You Up", "Rick Astley", duration=213),
        _song("Rolling in the Deep", "Hello I'm Adele", duration=228),
        _song("Rolling in the Deep", "Adele", duration=228),
    ]
    assert len(merge_songs(songs)) == len(songs)


@pytest.mark.parametrize(
    "query,suggestions,corrected",
    [
        ("adel rolling in the deap", ["adele rolling in the deep"], "adele rolling in the deep"),
        ("bohemian rapsody", ["bohemian rhapsody", "bohemian rhapsody queen"], "bohemian rhapsody"),
        ("dont stop beleiving", ["don't stop believing"], "don't stop believing"),
        ("hotel califronia egles", ["eagles hotel california"], "eagles hotel california"),
        (
            "guns n roses sweet chid o mine",
            ["guns roses sweet child o mine"],
            "guns roses sweet child o mine",
        ),
        # The first suggestion that is the same words wins, not a longer one before it
        ("billy jean", ["billie jean michael jackson", "billie jean"], "billie jean"),
    ],
)
def test_a_suggestion_that_respells_the_words_is_the_correction(query, suggestions, corrected):
    assert pick_correction(query, suggestions) == corrected


@pytest.mark.parametrize(
    "query,suggestions",
    [
        ("queen", ["queen", "queens domain", "queen naija"]),
        ("bohemian rha", ["bohemian rhapsody", "bohemian rhapsody lyrics"]),
        ("wonderwall", ["wonderwall oasis", "wonderwall lyrics", "wonderwall karaoke"]),
        ("nirvna smels lik ten sprit", ["nirvana like smell spirit", "nirvana it smells like"]),
        ("bohemain rapsodi quen", ["queen biopic bohemian rhapsody", "bohemian raspberry queen"]),
        ("halo", ["halo beyonce", "hello"]),
        # Suggested as typed, so spelled right, whatever comes after
        ("the wall", ["the wall", "the well"]),
        ("anything", []),
    ],
)
def test_completions_other_songs_and_added_words_are_not_corrections(query, suggestions):
    assert pick_correction(query, suggestions) is None


def test_misspelled_words_are_respelled_from_the_songs_that_were_found():
    found = [
        _song("Smells Like Teen Spirit", "Shaka Ponk"),
        _song("Smells Like Teen Spirit (Live at Reading)", "Nirvana"),
        _song("Smells Like Teen Spirit", "Malia J"),
    ]
    assert (
        respell_from_songs("nirvna smels lik ten sprit", found) == "nirvana smells like teen spirit"
    )


def test_words_the_songs_use_and_a_word_still_being_typed_are_kept():
    found = [_song("Bohemian Rhapsody", "Queen"), _song("Bohemian Like You", "The Dandy Warhols")]
    assert respell_from_songs("bohemian rhapsody queen", found) is None
    assert respell_from_songs("bohemian rha", found) is None
    assert respell_from_songs("zzzz qqqq", found) is None
    assert respell_from_songs("bohemain rha", found) == "bohemian rha"


def test_the_song_the_words_name_ranks_above_songs_that_share_a_word():
    songs = [
        _song("The Swamp Song", "Oasis", popularity=0.1, position=0),
        _song("The Masterplan", "Oasis", popularity=0.1, position=1),
        _song("Wonderwall", "Oasis", popularity=0.9, position=5),
    ]
    assert _ranked(songs, "wondewall oasis")[0] == "Wonderwall | Oasis"


def test_the_plain_recording_ranks_above_its_live_remix_and_edited_versions():
    songs = [
        _song("Halo (Live)", "Beyoncé", duration=392, popularity=0.6, position=0),
        _song("Halo (Dave Audé Club Remix)", "Beyoncé", duration=534, popularity=0.6, position=1),
        _song("Halo (Radio Edit)", "Beyoncé", duration=224, popularity=0.6, position=2),
        _song("Halo", "Beyoncé", duration=261, popularity=0.6, position=3),
    ]
    assert _ranked(songs, "beyonce halo") == [
        "Halo | Beyoncé",
        "Halo (Radio Edit) | Beyoncé",
        "Halo (Live) | Beyoncé",
        "Halo (Dave Audé Club Remix) | Beyoncé",
    ]


def test_a_version_asked_for_by_name_ranks_first():
    songs = [
        _song("Wonderwall", "Oasis", popularity=0.9),
        _song("Wonderwall (Live at Knebworth)", "Oasis", popularity=0.4, position=1),
        _song("Wonderwall (Acoustic)", "Oasis", popularity=0.4, position=2),
    ]
    assert _ranked(songs, "wonderwall live")[0] == "Wonderwall (Live at Knebworth) | Oasis"
    assert _ranked(songs, "wonderwall acoustic")[0] == "Wonderwall (Acoustic) | Oasis"
    assert _ranked(songs, "wonderwall")[0] == "Wonderwall | Oasis"


def test_tribute_and_karaoke_acts_rank_below_the_artist_unless_named():
    songs = [
        _song("Rolling in the Deep", "Hello I'm Adele", popularity=0.2),
        _song("Rolling in the Deep", "Karaoke Hits Band", popularity=0.6, position=1),
        _song("Rolling in the Deep", "Adele", popularity=None, position=2),
    ]
    assert _ranked(songs, "rolling in the deep adele")[0] == "Rolling in the Deep | Adele"
    assert _ranked(songs, "rolling in the deep karaoke hits band")[0] == (
        "Rolling in the Deep | Karaoke Hits Band"
    )


def test_words_that_name_a_song_and_its_act_rank_that_acts_recordings_first():
    songs = [
        _song("Wonderwall", "Oasis", popularity=0.87, position=4),
        # Covers that put the act's name in their own title
        _song("Wonderwall Oasis", "Weston Vance", popularity=None, position=0),
        _song("Wonderwall (Oasis)", "Squadra Risonante", popularity=None, position=1),
        _song("Wonderwall (Live at Knebworth)", "Oasis", popularity=0.46, position=5),
        _song("Shallow", "Lady Gaga & Bradley Cooper", popularity=0.9, position=6),
    ]
    assert _ranked(songs, "wonderwall oasis")[:2] == [
        "Wonderwall | Oasis",
        "Wonderwall (Live at Knebworth) | Oasis",
    ]
    # No act named: nobody is "someone else"
    assert _ranked(songs, "wonderwall")[0] == "Wonderwall | Oasis"


def test_an_act_named_after_the_artist_ranks_below_the_artists_other_versions():
    songs = [
        _song("Rolling in the Deep", "Hello I'm Adele", popularity=0.6, position=0),
        _song("Rolling in the Deep", "Adele", popularity=0.5, position=1),
        _song("Rolling in the Deep (Live)", "Adele", popularity=0.5, position=2),
    ]
    assert _ranked(songs, "adele rolling in the deep") == [
        "Rolling in the Deep | Adele",
        "Rolling in the Deep (Live) | Adele",
        "Rolling in the Deep | Hello I'm Adele",
    ]


def test_the_first_act_of_a_shared_credit_names_it():
    songs = [
        _song("Shallow", "Lady Gaga & Bradley Cooper", popularity=0.9, position=6),
        _song("Shallow", "Pentatonix", popularity=0.9, position=0),
    ]
    assert _ranked(songs, "shallow lady gaga")[0] == "Shallow | Lady Gaga & Bradley Cooper"


def test_an_artists_name_alone_lists_their_songs_by_popularity():
    songs = [
        _song("Killer Queen", "Queen", popularity=0.83),
        _song("Dancing Queen", "ABBA", popularity=0.91, position=1),
        _song("Bohemian Rhapsody", "Queen", popularity=0.96, position=2),
        _song("Don't Stop Me Now", "Queen", popularity=0.94, position=3),
    ]
    assert _ranked(songs, "queen") == [
        "Bohemian Rhapsody | Queen",
        "Don't Stop Me Now | Queen",
        "Killer Queen | Queen",
        "Dancing Queen | ABBA",
    ]


def test_a_popular_near_match_outranks_an_obscure_exact_one():
    songs = [
        _song("Billy Jean", "Don Snoop", popularity=0.25),
        _song("Billie Jean", "Michael Jackson", popularity=0.97, position=1),
    ]
    assert _ranked(songs, "billy jean", "billie jean")[0] == "Billie Jean | Michael Jackson"


def test_words_that_name_no_title_or_artist_keep_the_catalogs_order():
    deezer = [
        _song("Bohemian Rhapsody", "Queen", popularity=0.96, position=0),
        _song("Bohemian Rhapsody", "Panic! At The Disco", popularity=0.47, position=1),
    ]
    itunes = [
        _song("Bohemian Rhapsody", "Queen", position=0),
        _song("Bohemian Rhapsody", "Pentatonix", position=1),
        _song("Is This the Real Life", "Emery", position=9),
    ]
    typed = words("is this the real life is this just fantasy")
    assert names_songs([deezer, itunes], typed) is False
    assert names_songs([deezer, itunes], words("bohemian rapsody")) is True
    assert names_songs([None, []], typed) is True
    ranked = _ranked(deezer + itunes, " ".join(typed), named=False)
    assert ranked[0] == "Bohemian Rhapsody | Queen"
    assert ranked[-1] == "Is This the Real Life | Emery"
