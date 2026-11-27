"""Song search for the intake box: typed words become a list of songs (title, artist, album,
length, artwork, a 30-second preview), not of videos. The songs come from two public music
catalogs that need no key, Deezer's search API and Apple's iTunes Search API; the same
recording listed by both, or on several albums, is shown once, and the list is ranked here
rather than in either catalog's order.

Misspellings are handled three ways. Both catalogs search loosely themselves. YouTube's
search suggestions respell the query ("adel rolling in the deap" → "adele rolling in the
deep"), and when they do the corrected words are searched too. And the ranking compares the
query to each song word by word with a typo allowance, so "wondewall oasis" puts Wonderwall
above the B-sides a catalog lists first.

A picked song is started by its link (``url``: a Deezer or Apple Music song link), which
``song_lookup`` reads again and matches to a YouTube upload of the same recording, as it
does for a pasted link. Nothing here downloads audio.

``SONG_SEARCH_SOURCES`` (config) chooses which services are asked; with none, or when none
answers, the result is empty and the studio searches YouTube uploads instead."""

import logging
import re
import threading
import time
import unicodedata
from collections import OrderedDict
from collections.abc import Callable, Iterable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any

import requests

from backend import config, server_settings

logger = logging.getLogger(__name__)

DEEZER_SEARCH_URL = "https://api.deezer.com/search"
ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
SUGGEST_URL = "https://suggestqueries.google.com/complete/search"
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; KaraokeStudio)"}
# (connect, read) seconds for one catalog request
REQUEST_TIMEOUT = (2.0, 3.5)
# The whole search answers within this, with whatever has arrived
SEARCH_DEADLINE_SEC = 5.0
# How long the spelling suggestions may hold up the catalogs that wait for them
SUGGEST_WAIT_SEC = 1.2
# Songs asked of each catalog per query; the ranking picks from all of them
CATALOG_RESULTS = 25
MAX_RESULTS = 25
# Deezer's preview links expire after 15 minutes, so answers are kept for less
CACHE_TTL_SEC = 300.0
CACHE_ENTRIES = 256
# A catalog that refuses requests (its rate limit) is left alone for this long
PAUSE_SEC = 60.0
# Lengths this close are the same recording on another album or in the other catalog
SAME_RECORDING_SEC = 5.0
SOURCES = ("deezer", "itunes", "suggest")

_STOPWORDS = frozenset({"a", "an", "and", "by", "feat", "ft", "in", "of", "the", "to"})

# What a title's brackets say about the recording: (label, pattern). The label is what the
# studio shows beside the song; ALTERNATE labels are not the song as released.
_VERSION_RULES: tuple[tuple[str, re.Pattern[str]], ...] = tuple(
    (label, re.compile(pattern))
    for label, pattern in (
        ("karaoke", r"\bkaraoke\b|\bsing[- ]?along\b|\bbacking track\b"),
        ("instrumental", r"\binstrumentals?\b|\bno vocals?\b|\bminus one\b"),
        (
            "cover",
            r"\bcovers?\b|\btribute\b|\brendition\b|\bmade famous\b|\boriginally performed\b"
            r"|\bin the style of\b|\blullaby\b",
        ),
        ("live", r"\blive\b|\ben vivo\b|\ben directo\b|\bconcert\b|\bunplugged\b"),
        ("acoustic", r"\bacoustic\b|\bstripped\b|\bpiano version\b|\bunplugged\b"),
        (
            "remix",
            r"\bremix(?:es|ed)?\b|\brmx\b|\bbootleg\b|\bmashup\b|\bdub\b"
            r"|(?<!radio )(?<!single )(?<!album )(?<!original )(?<!mono )(?<!stereo )\bmix\b",
        ),
        ("demo", r"\bdemos?\b|\brehearsals?\b|\bouttakes?\b|\brough\b|\bearly version\b"),
        ("altered", r"\bsped[- ]up\b|\bslowed\b|\bnightcore\b|\b8d\b|\breverb\b|\bbass boosted\b"),
        ("extended", r"\bextended\b|\b12[\"”″]|\blong version\b"),
        (
            "edit",
            r"\bedit\b|\bradio (?:version|mix)\b|\bsingle (?:version|mix)\b|\bshort version\b",
        ),
        ("rerecorded", r"\bre-?record(?:ed|ing)\b|\b[a-z]+['\u2019]s version\b"),
        ("remaster", r"\bremaster(?:ed)?\b"),
    )
)
ALTERNATE_VERSIONS = frozenset(
    {"karaoke", "instrumental", "cover", "live", "acoustic", "remix", "demo", "altered", "extended"}
)
# Words in a query that ask for such a version by name
_VERSION_QUERY_WORDS = {
    "karaoke": {"karaoke"},
    "instrumental": {"instrumental"},
    "cover": {"cover", "tribute", "lullaby"},
    "live": {"live", "concert", "unplugged", "vivo"},
    "acoustic": {"acoustic", "unplugged", "stripped", "piano"},
    "remix": {"remix", "mix", "rmx", "mashup", "dub"},
    "demo": {"demo", "rehearsal"},
    "altered": {"sped", "slowed", "nightcore", "8d", "reverb"},
    "extended": {"extended"},
}
# Acts that re-record other people's songs: karaoke labels, tribute bands, lullaby and
# workout compilations. Their names say so even when the title does not; an album's name
# says so only in the plainest words ("Greatest Hits" is an act's name, never an album's).
_SOUNDALIKE_ALBUM = (
    r"\bkaraoke\b|\btribute\b|\blullab(?:y|ies)\b|\bworkout\b|\bmade famous\b"
    r"|\boriginally performed\b|\bsing[- ]?along\b|\bringtones?\b|\bmusic box\b|\bcovers\b"
)
_SOUNDALIKE_ACT = re.compile(
    _SOUNDALIKE_ALBUM + r"|\binstrumentals?\b|\b8[- ]?bit\b|\bcovers?\b|\bremixers\b"
    r"|\bpiano (?:man|guys|tribute|superstar)\b|\bgreatest hits\b|\bhits (?:band|crew)\b"
    r"|\bstudio (?:group|musicians|allstars)\b|\bstring quartet\b"
)
_SOUNDALIKE_ALBUM_RE = re.compile(_SOUNDALIKE_ALBUM)
# Words in a title's brackets that do not make it another recording
_NEUTRAL_WORDS = frozenset(
    {
        "album",
        "anniversary",
        "bonus",
        "deluxe",
        "digital",
        "digitally",
        "edition",
        "explicit",
        "lp",
        "mono",
        "original",
        "remaster",
        "remastered",
        "standard",
        "stereo",
        "studio",
        "track",
        "version",
    }
)
_FEATURING = re.compile(r"[(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]", re.IGNORECASE)
_BRACKETS = re.compile(r"[(\[]([^)\]]*)[)\]]")


class CatalogRefused(RuntimeError):
    """A catalog turned the request away (its rate limit); it is left alone for a while."""


@dataclass
class Song:
    """One recording, as the studio lists it. ``links`` holds the song's link in each
    catalog that has it ("deezer", "applemusic"); ``popularity`` is 0 to 1."""

    title: str
    artist: str
    album: str = ""
    year: int | None = None
    duration: float | None = None
    thumbnail: str | None = None
    preview: str | None = None
    explicit: bool = False
    links: dict[str, str] = field(default_factory=dict)
    track_ids: list[str] = field(default_factory=list)
    popularity: float | None = None
    position: int = 0
    versions: tuple[str, ...] = ()
    score: float = 0.0

    @property
    def url(self) -> str:
        """The link a pick is started with: Deezer's when the song is there (its track API
        is the more dependable to read back), else Apple Music's."""
        return self.links.get("deezer") or self.links.get("applemusic") or ""

    def public(self) -> dict[str, Any]:
        # The id of the link the song starts with first: the project a pick becomes
        ids = sorted(self.track_ids, key=lambda track_id: not track_id.startswith("deezer-"))
        return {
            "id": ids[0] if ids else "",
            "track_ids": ids,
            "url": self.url,
            "title": self.title,
            "artist": self.artist,
            "album": self.album,
            "year": self.year,
            "duration": self.duration,
            "thumbnail": self.thumbnail,
            "preview": self.preview,
            "explicit": self.explicit,
            "versions": list(self.versions),
        }


@dataclass
class SearchOutcome:
    """``corrected`` is the respelled query that was searched as well (None when the words
    were searched as typed); ``sources`` the catalogs that answered."""

    results: list[Song]
    corrected: str | None = None
    sources: tuple[str, ...] = ()


# --------------------------------------------------------------------------- words


def fold(text: str) -> str:
    """Lower case without accents, apostrophes or punctuation: "Beyoncé: Don't" →
    "beyonce dont"."""
    decomposed = unicodedata.normalize("NFKD", str(text or ""))
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()
    plain = re.sub("['\u2019`\u00b4]", "", plain.replace("&", " and "))
    return " ".join(re.findall(r"\w+", plain))


def words(text: str) -> list[str]:
    return fold(text).split()


def _edit_distance(a: str, b: str, limit: int) -> int:
    """Typing-error distance between two words (insert, delete, replace, swap two
    neighbours), or ``limit + 1`` once it is known to be more than ``limit``."""
    if abs(len(a) - len(b)) > limit:
        return limit + 1
    previous2: list[int] = []
    previous = list(range(len(b) + 1))
    for i, ch_a in enumerate(a, start=1):
        current = [i]
        for j, ch_b in enumerate(b, start=1):
            cost = 0 if ch_a == ch_b else 1
            best = min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
            if i > 1 and j > 1 and ch_a == b[j - 2] and a[i - 2] == ch_b:
                best = min(best, previous2[j - 2] + 1)
            current.append(best)
        if min(current) > limit:
            return limit + 1
        previous2, previous = previous, current
    return previous[-1]


def _typos_allowed(length: int) -> int:
    """Typing errors a word of this length may hold and still be taken for another: none in
    a word of one or two letters, one up to five ("quen", "smels"), two up to nine
    ("rapsodi"), three beyond. "queen" is not "green"."""
    if length <= 2:
        return 0
    if length <= 5:
        return 1
    return 2 if length <= 9 else 3


def word_similarity(typed: str, word: str, vouched: bool = False) -> float:
    """How well a typed word stands for a song's word, 0 to 1: the same word, its beginning
    (still being typed, or "believin" for "believing"), or a misspelling of it. ``vouched``
    allows a word of five letters or more one typing error more: for a respelling a search
    suggestion already made ("billy" for "billie")."""
    if typed == word:
        return 1.0
    if not typed or not word:
        return 0.0
    if len(typed) >= 2 and word.startswith(typed):
        return 0.9
    if len(word) >= 4 and typed.startswith(word):
        return 0.85
    longest = max(len(typed), len(word))
    shortest = min(len(typed), len(word))
    limit = _typos_allowed(shortest)
    if limit == 0:
        return 0.0
    if vouched and shortest >= 5:
        limit += 1
    distance = _edit_distance(typed, word, limit)
    if distance > limit:
        return 0.0
    return max(0.0, 1.0 - distance / longest) * 0.95


def _weight(word: str) -> float:
    return 0.3 if word in _STOPWORDS else 1.0


def _coverage(typed: list[str], song_words: list[str]) -> tuple[float, list[float]]:
    """How much of the typed words the song's words explain (0 to 1, small words counting
    less), and for each song word the best typed word's similarity."""
    if not typed:
        return 0.0, [0.0] * len(song_words)
    matched = [0.0] * len(song_words)
    total = weight_sum = 0.0
    for word in typed:
        best = 0.0
        for i, song_word in enumerate(song_words):
            sim = word_similarity(word, song_word)
            best = max(best, sim)
            matched[i] = max(matched[i], sim)
        total += _weight(word) * best
        weight_sum += _weight(word)
    return (total / weight_sum if weight_sum else 0.0), matched


# --------------------------------------------------------------------------- titles


def _decorations(title: str) -> str:
    """What a title says about itself outside the song's name: its brackets and anything
    after a spaced dash ("Song - Live at Wembley"), lower case."""
    parts = _BRACKETS.findall(title)
    if " - " in title:
        parts.append(title.split(" - ", 1)[1])
    return " ".join(parts).lower()


def base_title(title: str) -> str:
    """The song's name without brackets or a dash suffix: "Halo (Live) [2009]" → "Halo"."""
    name = _BRACKETS.sub(" ", title).split(" - ", 1)[0]
    return " ".join(name.split()) or title


def version_labels(title: str) -> tuple[str, ...]:
    """What kind of recording a title says it is ("live", "remix", "remaster"…), read from
    its brackets and dash suffix only, so "Live Forever" and "Cover Me" are plain songs."""
    decorations = _decorations(title)
    if not decorations:
        return ()
    return tuple(label for label, pattern in _VERSION_RULES if pattern.search(decorations))


def _variant_words(title: str) -> list[str]:
    """The words in a title's brackets and dash suffix that make it another recording than
    the plain song: everything but featured artists, soundtrack notes ("From …"), years
    and remaster or edition notes. Empty for "Song (2011 Remaster)" and "Song (feat. X)"."""
    found: list[str] = []
    stripped = _FEATURING.sub(" ", title)
    parts = _BRACKETS.findall(stripped)
    if " - " in stripped:
        parts.append(stripped.split(" - ", 1)[1])
    for part in parts:
        part_words = words(part)
        if part_words[:1] == ["from"]:
            continue
        found += [w for w in part_words if w not in _NEUTRAL_WORDS and not w.isdigit()]
    return found


def title_key(title: str) -> str:
    """Titles with the same key name the same recording of a song: "Song", "Song (feat. X)"
    and "Song (2011 Remaster)" share one, "Song (Live)" and "Song (Piano Version)" do not."""
    return fold(base_title(_FEATURING.sub(" ", title))) + "|" + " ".join(_variant_words(title))


_ARTIST_SEPARATORS = re.compile(r"\s+(?:&|x|and|feat\.?|ft\.?|with|vs\.?)\s+|\s*[,;/+]\s*", re.I)


def same_artist(a: str, b: str) -> bool:
    """Whether two credits are the same act: the same name, or the same first name of a
    list ("Luis Fonsi" and "Luis Fonsi & Daddy Yankee"). "Adele" and the tribute act
    "Hello I'm Adele" are not."""
    whole_a, whole_b = fold(a), fold(b)
    if not whole_a or not whole_b:
        return False
    if whole_a == whole_b:
        return True
    lead_a, lead_b = fold(_ARTIST_SEPARATORS.split(a)[0]), fold(_ARTIST_SEPARATORS.split(b)[0])
    return bool(lead_a) and lead_a == lead_b and (lead_a == whole_a or lead_b == whole_b)


# --------------------------------------------------------------------------- catalogs


def _get_json(url: str, params: dict[str, Any]) -> Any:
    res = requests.get(url, params=params, headers=_HEADERS, timeout=REQUEST_TIMEOUT)
    if res.status_code in (403, 429):
        raise CatalogRefused(f"HTTP {res.status_code}")
    res.raise_for_status()
    return res.json()


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if value > 0 else None


def deezer_songs(query: str, limit: int = CATALOG_RESULTS) -> list[Song]:
    """Deezer's search results for the words, in Deezer's order."""
    data = _get_json(DEEZER_SEARCH_URL, {"q": query, "limit": limit})
    error = data.get("error") if isinstance(data, dict) else None
    if isinstance(error, dict):
        # Deezer answers 200 with an error body; code 4 is its request quota
        if error.get("code") == 4:
            raise CatalogRefused(str(error.get("message") or "quota"))
        raise RuntimeError(f"Deezer: {error.get('message') or error}")
    songs: list[Song] = []
    for position, item in enumerate(data.get("data") or [] if isinstance(data, dict) else []):
        if not isinstance(item, dict) or item.get("type", "track") != "track":
            continue
        artist = item.get("artist") if isinstance(item.get("artist"), dict) else {}
        album = item.get("album") if isinstance(item.get("album"), dict) else {}
        title, name, song_id = _text(item.get("title")), _text(artist.get("name")), item.get("id")
        if not title or not name or not isinstance(song_id, int):
            continue
        rank = _number(item.get("rank"))
        songs.append(
            Song(
                title=title,
                artist=name,
                album=_text(album.get("title")),
                duration=_number(item.get("duration")),
                thumbnail=_text(album.get("cover_medium")) or None,
                preview=_text(item.get("preview")) or None,
                explicit=bool(item.get("explicit_lyrics")),
                links={"deezer": f"https://www.deezer.com/track/{song_id}"},
                track_ids=[f"deezer-{song_id}"],
                popularity=min(1.0, rank / 1_000_000) if rank else None,
                position=position,
            )
        )
    return songs


def itunes_songs(query: str, limit: int = CATALOG_RESULTS) -> list[Song]:
    """The iTunes Store's songs for the words, in its order, from the store of
    ``SONG_SEARCH_COUNTRY``."""
    country = config.SONG_SEARCH_COUNTRY
    data = _get_json(
        ITUNES_SEARCH_URL,
        {"term": query, "media": "music", "entity": "song", "limit": limit, "country": country},
    )
    songs: list[Song] = []
    for position, item in enumerate(data.get("results") or [] if isinstance(data, dict) else []):
        if not isinstance(item, dict) or item.get("kind") != "song":
            continue
        title, name, song_id = (
            _text(item.get("trackName")),
            _text(item.get("artistName")),
            item.get("trackId"),
        )
        if not title or not name or not isinstance(song_id, int):
            continue
        millis = _number(item.get("trackTimeMillis"))
        released = _text(item.get("releaseDate"))
        artwork = _text(item.get("artworkUrl100"))
        songs.append(
            Song(
                title=title,
                artist=name,
                album=re.sub(r"\s+-\s+(?:Single|EP)$", "", _text(item.get("collectionName"))),
                year=int(released[:4]) if re.match(r"\d{4}-", released) else None,
                duration=millis / 1000 if millis else None,
                thumbnail=artwork.replace("100x100", "200x200") or None,
                preview=_text(item.get("previewUrl")) or None,
                explicit=item.get("trackExplicitness") == "explicit",
                links={"applemusic": f"https://music.apple.com/{country}/song/{song_id}"},
                track_ids=[f"applemusic-{song_id}"],
                position=position,
            )
        )
    return songs


def spelling_suggestions(query: str) -> list[str]:
    """YouTube's search suggestions for the words: completions, and for a misspelled query
    its usual spelling."""
    data = _get_json(SUGGEST_URL, {"client": "firefox", "ds": "yt", "q": query})
    if not isinstance(data, list) or len(data) < 2 or not isinstance(data[1], list):
        return []
    return [s for s in data[1] if isinstance(s, str)]


def pick_correction(query: str, suggestions: Iterable[str]) -> str | None:
    """The suggestion that is the query spelled right, or None. It must be the same words:
    every word of each matches a word of the other, allowing typos, and at least one typed
    word is a misspelling (a suggestion that only finishes the last word, or adds
    "lyrics", is not a correction)."""
    typed = words(query)
    if not typed:
        return None
    for suggestion in list(suggestions)[:5]:
        suggested = words(suggestion)
        if suggested == typed:
            # Suggested as typed: the words are spelled the usual way
            return None
        if not suggested or abs(len(suggested) - len(typed)) > 1:
            continue
        corrections = 0
        ok = True
        for i, word in enumerate(typed):
            best = max((word_similarity(word, other, True) for other in suggested), default=0.0)
            exact = word in suggested
            # The last word may still be being typed: its completion is not a correction
            completing = i == len(typed) - 1 and any(o.startswith(word) for o in suggested)
            if best == 0.0 and len(word) > 2 and word not in _STOPWORDS:
                ok = False
                break
            if not exact and not completing and best > 0.0:
                corrections += 1
        if not ok or corrections == 0:
            continue
        # Nothing new in the suggestion either ("… lyrics", "… karaoke", another artist)
        if all(
            len(other) <= 2
            or other in _STOPWORDS
            or any(word_similarity(word, other, True) > 0.0 for word in typed)
            for other in suggested
        ):
            return " ".join(suggestion.split())
    return None


# --------------------------------------------------------------------------- ranking

# Below this share of the typed words explained by a catalog's first picks, the words are
# not a title or an artist (a line of the lyrics, say) and the catalogs' own order stands
NAMED_COVERAGE = 0.5


def _soundalike(song: Song) -> bool:
    return bool(
        _SOUNDALIKE_ACT.search(song.artist.lower())
        or _SOUNDALIKE_ALBUM_RE.search(song.album.lower())
    )


def _popularity(song: Song) -> float:
    """0 to 1. Deezer says how popular a song is; a song only the iTunes Store listed is
    judged by how high it was listed."""
    if song.popularity is not None:
        return song.popularity
    return 0.6 - 0.3 * min(1.0, song.position / CATALOG_RESULTS)


def text_match(song: Song, typed: list[str]) -> tuple[float, float, float]:
    """How the typed words fit a song, each 0 to 1: the share of the words its title,
    artist and bracketed notes explain; the share of its title the words name; the share
    of its artist's name they name. A word that names the artist does not also count
    towards the title, so "queen" is no more "Killer Queen" than any other Queen song."""
    title_words = words(base_title(_FEATURING.sub(" ", song.title)))
    artist_words = words(song.artist)
    extra_words = words(_decorations(song.title))
    coverage, matched = _coverage(typed, title_words + artist_words + extra_words)
    artist_hit = matched[len(title_words) : len(title_words) + len(artist_words)]
    # The first act of a shared credit is name enough: "lady gaga" for "Lady Gaga & Bradley
    # Cooper"
    lead_words = words(_ARTIST_SEPARATORS.split(song.artist)[0])
    named_words = artist_words
    if lead_words and sum(artist_hit[: len(lead_words)]) / len(lead_words) >= 0.99:
        artist_hit, named_words = artist_hit[: len(lead_words)], lead_words
    artist_named = sum(artist_hit) / len(artist_hit) if artist_hit else 0.0
    for_title = typed
    if artist_named >= 0.99:
        spare = list(typed)
        for word in named_words:
            if word in spare:
                spare.remove(word)
        for_title = spare
    _, title_hit = _coverage(for_title, title_words)
    title_named = sum(title_hit) / len(title_hit) if title_hit else 0.0
    return coverage, title_named, artist_named


def score_song(
    song: Song, queries: list[list[str]], named: bool = True, acts: Iterable[str] = ()
) -> float:
    """How well a song answers the search (higher is better). When the words name songs
    (``named``): how much of them the title and artist explain, whether they name the
    whole title and the artist, then popularity and the catalog's own order. When they do
    not (a lyric line), the catalog's order leads. Either way a live take, remix, cover or
    karaoke track loses points unless the words ask for one, as does any other bracketed
    variant ("Piano Version"), a sound-alike act the words do not name, and, when the
    words name a song and its act (``acts``, from named_acts), a song by anyone else."""
    asked: set[str] = set()
    text = 0.0
    for typed in queries:
        asked.update(typed)
        coverage, title_named, artist_named = text_match(song, typed)
        text = max(text, 55.0 * coverage + 15.0 * title_named + 10.0 * artist_named)
    acts = list(acts)

    listed = max(0.0, 1.0 - song.position / CATALOG_RESULTS)
    if named:
        score = text + 20.0 * _popularity(song) + 5.0 * listed
    else:
        score = 0.25 * text + 15.0 * _popularity(song) + 60.0 * listed
    if len(song.links) > 1:
        # Both catalogs listed it for these words
        score += 3.0
    unasked = [
        label
        for label in song.versions
        if label in ALTERNATE_VERSIONS and not (_VERSION_QUERY_WORDS[label] & asked)
    ]
    if unasked:
        score -= min(24.0, 14.0 * len(unasked))
    elif any(word not in asked for word in _variant_words(song.title)):
        # "Radio Edit", "Pianoforte", "Jamie xx Shuffle": the song, but not as released
        score -= 6.0
    if _soundalike(song) and not set(words(song.artist)) <= asked:
        score -= 18.0
    elif acts and not any(same_artist(song.artist, act) for act in acts):
        # "wonderwall oasis" is Oasis's song: "Wonderwall Oasis" by someone else, with the
        # act's name in its title, is a cover of it, and an act named after the artist
        # ("Hello I'm Adele") is a tribute to them
        credit = set(words(song.artist))
        score -= 18.0 if any(set(words(act)) < credit for act in acts) else 12.0
    return score


def named_acts(songs: Iterable[Song], queries: list[list[str]]) -> list[str]:
    """The acts the typed words name together with one of their songs: the artists of the
    songs whose whole title and whole (or first) artist name the words spell out."""
    acts: list[str] = []
    for song in songs:
        for typed in queries:
            _, title_named, artist_named = text_match(song, typed)
            if title_named >= 0.99 and artist_named >= 0.99 and song.artist not in acts:
                acts.append(song.artist)
    return acts


def names_songs(lists: Iterable[list[Song] | None], typed: list[str]) -> bool:
    """Whether the typed words name a title or an artist, judged by each catalog's first
    two picks: when none of them is explained by the words, the catalog found them some
    other way (a line of the lyrics) and its order is better than a word-by-word one."""
    first_picks = [song for songs in lists for song in (songs or [])[:2]]
    if not first_picks or not typed:
        return True
    return max(text_match(song, typed)[0] for song in first_picks) >= NAMED_COVERAGE


def respell_from_songs(query: str, songs: Iterable[Song]) -> str | None:
    """The query with each misspelled word replaced by the word the found songs use, or
    None when no word changes: "nirvna smels lik ten sprit" among songs called "Smells Like
    Teen Spirit" by Nirvana becomes "nirvana smells like teen spirit". A typed word the
    songs also use is kept, as is the last word when it only begins one (still typing)."""
    typed = words(query)
    counts: dict[str, int] = {}
    for song in songs:
        for word in set(words(base_title(song.title)) + words(song.artist)):
            counts[word] = counts.get(word, 0) + 1
    respelled, changed = [], False
    for i, word in enumerate(typed):
        if word in counts or len(word) <= 2 or word in _STOPWORDS:
            respelled.append(word)
            continue
        similarity, _, best = max(
            ((word_similarity(word, known), count, known) for known, count in counts.items()),
            default=(0.0, 0, word),
        )
        if similarity == 0.0 or (i == len(typed) - 1 and best.startswith(word)):
            respelled.append(word)
        else:
            respelled.append(best)
            changed = True
    return " ".join(respelled) if changed else None


def merge_songs(songs: Iterable[Song]) -> list[Song]:
    """One entry per recording: the same title, artist and length (within
    SAME_RECORDING_SEC) from the other catalog or another album is folded into the first.
    The entry shows the plainest title of its copies and keeps every catalog's link."""
    merged: list[tuple[str, Song]] = []
    for song in songs:
        key = title_key(song.title)
        twin = next(
            (
                kept
                for kept_key, kept in merged
                if kept_key == key
                and same_artist(kept.artist, song.artist)
                and (
                    kept.duration is None
                    or song.duration is None
                    or abs(kept.duration - song.duration) <= SAME_RECORDING_SEC
                )
            ),
            None,
        )
        if twin is None:
            song.versions = version_labels(song.title)
            merged.append((key, song))
            continue
        if len(version_labels(song.title)) < len(twin.versions):
            # "Wonderwall" rather than "Wonderwall (Remastered)", with its album
            twin.title, twin.album = song.title, song.album or twin.album
            twin.versions = version_labels(song.title)
        for site, link in song.links.items():
            twin.links.setdefault(site, link)
        twin.track_ids.extend(t for t in song.track_ids if t not in twin.track_ids)
        if song.popularity is not None:
            twin.popularity = max(twin.popularity or 0.0, song.popularity)
        twin.position = min(twin.position, song.position)
        twin.year = min(filter(None, (twin.year, song.year)), default=None)
        twin.duration = twin.duration or song.duration
        twin.thumbnail = twin.thumbnail or song.thumbnail
        twin.album = twin.album or song.album
        twin.explicit = twin.explicit or song.explicit
        # Apple's preview links do not expire; Deezer's do
        if "applemusic" in song.links and song.preview:
            twin.preview = song.preview
        twin.preview = twin.preview or song.preview
    return [song for _, song in merged]


def rank_songs(
    songs: Iterable[Song], query: str, corrected: str | None = None, named: bool = True
) -> list[Song]:
    """The songs merged (merge_songs) and ordered best first for the typed words and, when
    given, their corrected spelling; ``named`` as in score_song."""
    queries = [typed for typed in (words(query), words(corrected or "")) if typed]
    merged = merge_songs(songs)
    acts = named_acts(merged, queries) if named else []
    for song in merged:
        song.score = score_song(song, queries, named, acts)
    return sorted(merged, key=lambda song: song.score, reverse=True)


# --------------------------------------------------------------------------- search

_POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="song-search")
_LOCK = threading.Lock()
_CACHE: OrderedDict[tuple[str, tuple[str, ...], str], tuple[float, SearchOutcome]] = OrderedDict()
_PAUSED_UNTIL: dict[str, float] = {}


def reset() -> None:
    """Forgets cached answers and paused catalogs (tests)."""
    with _LOCK:
        _CACHE.clear()
        _PAUSED_UNTIL.clear()


def _available(source: str, sources: tuple[str, ...]) -> bool:
    with _LOCK:
        return source in sources and _PAUSED_UNTIL.get(source, 0.0) <= time.monotonic()


def _ask(source: str, call: Callable[..., list], query: str) -> list | None:
    """One catalog's answer, or None when it failed (logged; a refusal pauses it)."""
    try:
        return call(query)
    except CatalogRefused as e:
        with _LOCK:
            _PAUSED_UNTIL[source] = time.monotonic() + PAUSE_SEC
        logger.warning(f"Song search: {source} refused the request ({e}); pausing it")
    except Exception as e:
        logger.warning(f"Song search: {source} failed for {query!r}: {e}")
    return None


def _result(future: Future | None, deadline: float) -> list | None:
    if future is None:
        return None
    try:
        return future.result(timeout=max(0.05, deadline - time.monotonic()))
    except Exception:
        # Too slow for this answer; the request finishes on its own and is dropped
        return None


def search_songs(query: str, sources: tuple[str, ...] | None = None) -> SearchOutcome:
    """Songs for the typed words, best first (up to MAX_RESULTS). Asks the catalogs in
    ``sources`` (default ``SONG_SEARCH_SOURCES``) side by side and answers within
    SEARCH_DEADLINE_SEC with what arrived; answers are kept for CACHE_TTL_SEC. An empty
    ``sources`` in the outcome means no catalog answered."""
    clean = " ".join(str(query or "").split())
    sources = server_settings.song_search_sources() if sources is None else sources
    if not clean or not ({"deezer", "itunes"} & set(sources)):
        return SearchOutcome(results=[])
    key = (clean.casefold(), tuple(sources), config.SONG_SEARCH_COUNTRY)
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE.get(key)
        if cached and cached[0] > now:
            _CACHE.move_to_end(key)
            return cached[1]

    deadline = now + SEARCH_DEADLINE_SEC
    catalogs = {"deezer": deezer_songs, "itunes": itunes_songs}

    def ask(source: str, text: str) -> tuple[str, Future | None]:
        if not _available(source, sources):
            return source, None
        return source, _POOL.submit(_ask, source, catalogs[source], text)

    def gather(asked: list[tuple[str, Future | None]]) -> list[tuple[str, list[Song] | None]]:
        return [(source, _result(future, deadline)) for source, future in asked]

    deezer = ask("deezer", clean)
    corrected = None
    if _available("suggest", sources):
        suggest = _POOL.submit(_ask, "suggest", spelling_suggestions, clean)
        suggestions = _result(suggest, min(deadline, time.monotonic() + SUGGEST_WAIT_SEC))
        corrected = pick_correction(clean, suggestions or [])
    # The iTunes Store allows few requests a minute, so it is asked once, for the best
    # spelling known; Deezer is asked for both. The best spelling's answers come first:
    # among copies of a recording the earlier one is shown
    asked = [ask("itunes", corrected or clean), deezer]
    if corrected:
        asked.insert(0, ask("deezer", corrected))
    answers = gather(asked)
    named = names_songs([songs for _, songs in answers], words(corrected or clean))

    if corrected is None and named and time.monotonic() < deadline - 1.0:
        # No suggestion respelled the words: the songs found may (their titles and artists
        # are spelled right), and the respelled words find the songs the typos hid
        first_found = sorted(
            (song for _, songs in answers for song in songs or []), key=lambda song: song.position
        )
        corrected = respell_from_songs(clean, first_found[:10])
        if corrected:
            answers = gather([ask("deezer", corrected), ask("itunes", corrected)]) + answers

    answered = tuple(
        source
        for source in catalogs
        if any(songs is not None for name, songs in answers if name == source)
    )
    found = [song for _, songs in answers for song in songs or []]
    outcome = SearchOutcome(
        results=rank_songs(found, clean, corrected, named)[:MAX_RESULTS],
        corrected=corrected,
        sources=answered,
    )
    if answered:
        with _LOCK:
            _CACHE[key] = (time.monotonic() + CACHE_TTL_SEC, outcome)
            while len(_CACHE) > CACHE_ENTRIES:
                _CACHE.popitem(last=False)
    return outcome
