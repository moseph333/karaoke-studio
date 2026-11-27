"""The songs inside one recording of a whole album: a "Full Album" upload on YouTube, or an
album uploaded as one file. Tells whether a recording is an album, reads the album's artist
and name from its title, and lists its songs from the recording's chapters (YouTube's
chapters, which yt-dlp also reads from a description's track list) or from the album's track
list on Deezer or the iTunes Store, whose song lengths say roughly where each song starts.
``album_audio`` then puts each cut at the quiet between two songs, or finds the songs by those
pauses when nothing names them. Nothing here touches the audio."""

import itertools
import logging
import re
import statistics
from dataclasses import asdict, dataclass, field
from typing import Any

from backend import config, server_settings
from backend.services import song_search

logger = logging.getLogger(__name__)

# A recording shorter than this is one song, whatever its title or chapters say
ALBUM_MIN_SECONDS = 600.0
# Chapters this long on average are songs, not the sections of one song or a video's topics
SONG_CHAPTER_SECONDS = 60.0
# No song inside an album is shorter than this (a cut that would make one is dropped)
MIN_TRACK_SECONDS = 5.0

DEEZER_ALBUM_SEARCH_URL = "https://api.deezer.com/search/album"
DEEZER_ALBUM_TRACKS_URL = "https://api.deezer.com/album/{id}/tracks"
ITUNES_SEARCH_URL = "https://itunes.apple.com/search"
ITUNES_LOOKUP_URL = "https://itunes.apple.com/lookup"
# Albums of the right name whose track lists are read, per catalog
CATALOG_CANDIDATES = 3

_ALBUM_WORDS = re.compile(
    r"\b(?:full|complete|whole|entire)[\s-]+(?:album|ep|lp|record|mixtape)\b"
    r"|\b(?:álbum|album|disco)\s+(?:completo|complet|komplett|intero)\b"
    r"|\bfull[\s-]+length\b",
    re.IGNORECASE,
)
# Notes in a video title that are about the upload, not the album's name
_UPLOAD_NOTES = re.compile(
    r"\b(?:hq|hd|4k|official\s+audio|audio|remaster(?:ed)?|deluxe(?:\s+edition)?|"
    r"(?:19|20)\d{2})\b",
    re.IGNORECASE,
)
_BRACKETED = re.compile(r"[\[({【][^\])}】]*[\])}】]")
_DASHES = (" - ", " \u2013 ", " \u2014 ")
_TITLE_SEPARATORS = (*_DASHES, " | ", " ~ ")
_QUOTES = "\"'\u201c\u201d\u2018\u2019\u00ab\u00bb\u300c\u300d"
_TIMESTAMP = re.compile(r"[\[(]?\b\d{1,2}:\d{2}(?::\d{2})?\b[\])]?")
# "1. Song", "01) Song", "A2 - Song", "Track 3: Song"
_NUMBERED = re.compile(
    r"^\s*(?:(?:track|pista|song)\s*)?(?P<number>\d{1,3}|[A-Da-d]\d{1,2})"
    r"(?P<mark>\s*[.):\-\u2013\u2014]+\s*|\s+)(?=\S)",
    re.IGNORECASE,
)
_PLACEHOLDER = re.compile(
    r"^(?:<?untitled chapter \d+>?|(?:track|chapter|part|song|pista)\s*\d+)$", re.IGNORECASE
)


@dataclass
class AlbumTrack:
    """One song of an album recording, in seconds from the recording's start."""

    number: int
    title: str
    start: float
    end: float
    artist: str = ""
    """The song's own artist on a compilation; empty when it is the album's."""
    named: bool = True
    """False for a stand-in name ("Track 3") that the lyric lookup cannot use."""

    def public(self) -> dict[str, Any]:
        data = asdict(self)
        data["start"] = round(self.start, 2)
        data["end"] = round(self.end, 2)
        return data


@dataclass
class CatalogAlbum:
    """An album's track list from a music catalog."""

    site: str
    title: str
    artist: str
    link: str
    songs: list[tuple[str, float, str]] = field(default_factory=list)
    """(title, length in seconds, artist) in album order."""

    @property
    def length(self) -> float:
        return sum(length for _, length, _ in self.songs)

    def public(self) -> dict[str, Any]:
        return {"site": self.site, "title": self.title, "artist": self.artist, "link": self.link}


# --------------------------------------------------------------------------- detection


def says_album(title: str | None) -> bool:
    """Whether a title calls the recording a whole album ("Full Album", "Full EP", "Álbum
    Completo")."""
    return bool(title) and bool(_ALBUM_WORDS.search(title))


def _length(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if value > 0 else None


def usable_chapters(info: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The recording's chapters in order, each with a start, an end and a title; the last one
    ends with the recording. Chapters that start at the same time, out of order or (nearly)
    at the end of the recording are dropped."""
    if not isinstance(info, dict) or not isinstance(info.get("chapters"), list):
        return []
    chapters = [c for c in info["chapters"] if isinstance(c, dict)]
    end = _length(info.get("duration")) or (
        _length(chapters[-1].get("end_time")) if chapters else None
    )
    if not end:
        return []
    found: list[dict[str, Any]] = []
    for chapter in chapters:
        start = chapter.get("start_time")
        if isinstance(start, bool) or not isinstance(start, (int, float)) or start < 0:
            continue
        if start > end - MIN_TRACK_SECONDS:
            continue
        if found and start <= found[-1]["start"] + MIN_TRACK_SECONDS:
            continue
        found.append({"start": float(start), "title": str(chapter.get("title") or "").strip()})
    for current, following in itertools.pairwise(found):
        current["end"] = following["start"]
    if found:
        found[-1]["end"] = end
    return found if len(found) >= 2 else []


def looks_like_album(info: dict[str, Any] | None) -> bool:
    """Whether a recording (yt-dlp's metadata, read before anything downloads) is a whole
    album rather than one song: at least ten minutes long, and either called an album in its
    title or split into three or more song-length chapters."""
    if not isinstance(info, dict):
        return False
    if info.get("is_live") or info.get("live_status") in ("is_live", "is_upcoming"):
        return False
    duration = _length(info.get("duration"))
    if not duration or duration < ALBUM_MIN_SECONDS:
        return False
    if says_album(str(info.get("title") or "")):
        return True
    chapters = usable_chapters(info)
    if len(chapters) < 3:
        return False
    return statistics.median(c["end"] - c["start"] for c in chapters) >= SONG_CHAPTER_SECONDS


def album_limit_seconds() -> float | None:
    """The longest album recording the server downloads (MAX_ALBUM_MINUTES), or None."""
    minutes = server_settings.max_album_minutes()
    return minutes * 60.0 if minutes else None


# --------------------------------------------------------------------------- names


def _unquote(text: str) -> str:
    return " ".join(text.strip().strip(_QUOTES).split()).strip(" -\u2013\u2014|~:")


def strip_album_notes(title: str) -> str:
    """A video title without what it says about the upload: brackets, "Full Album", years,
    "HQ"…: "Imperial Teen - Seasick [1996] FULL ALBUM" → "Imperial Teen - Seasick"."""
    text = _BRACKETED.sub(" ", title or "")
    text = _ALBUM_WORDS.sub(" ", text)
    text = _UPLOAD_NOTES.sub(" ", text)
    text = " ".join(text.split())
    # Separators left dangling once the notes are gone ("Artist - Album -")
    return _unquote(text)


def album_names(info: dict[str, Any] | None, fallback_artist: str = "") -> tuple[str, str]:
    """The album's artist and name: yt-dlp's own fields when it has them, else the video
    title split at its dash ("Artist - Album"), else the uploader and the whole title."""
    if not isinstance(info, dict):
        return fallback_artist, ""
    artist, album = str(info.get("artist") or "").strip(), str(info.get("album") or "").strip()
    if artist and album:
        return artist, album
    title = strip_album_notes(str(info.get("title") or ""))
    for separator in _TITLE_SEPARATORS:
        if separator in title:
            left, right = title.split(separator, 1)
            if _unquote(left) and _unquote(right):
                return _unquote(left), _unquote(right)
    channel = re.sub(r"\s+-\s+Topic$", "", fallback_artist or "").strip()
    return artist or channel, title


def clean_chapter_title(text: str, position: int) -> str:
    """A chapter's song name without its track number or timestamp: "1. Imperial Teen" →
    "Imperial Teen", "03 - Butch (5:12)" → "Butch". A bare number is only taken for a track
    number when it is the chapter's position, so "1979" and "99 Problems" keep theirs."""
    clean = _TIMESTAMP.sub(" ", text or "")
    match = _NUMBERED.match(clean)
    if match:
        number, mark = match.group("number"), match.group("mark")
        punctuated = bool(mark.strip())
        is_position = number.isdigit() and int(number) == position
        if punctuated or is_position or not number.isdigit():
            clean = clean[match.end() :]
    return _unquote(clean)


def _split_artist(title: str) -> tuple[str, str] | None:
    for separator in _DASHES:
        if separator in title:
            left, right = title.split(separator, 1)
            if left.strip() and right.strip():
                return _unquote(left), _unquote(right)
    return None


def tracks_from_chapters(
    chapters: list[dict[str, Any]], album_artist: str
) -> tuple[list[AlbumTrack], str]:
    """The album's songs from its chapters (see ``usable_chapters``), and the album artist,
    which chapters named "Artist - Song" can correct. On a compilation, whose chapters name
    a different artist each, every song keeps its own."""
    titles = [clean_chapter_title(c["title"], i) for i, c in enumerate(chapters, start=1)]
    splits = [_split_artist(t) for t in titles]
    with_artist = [s for s in splits if s]
    artist = album_artist
    per_track = False
    if with_artist and len(with_artist) * 4 >= len(titles) * 3:
        lefts = {song_search.fold(left) for left, _ in with_artist}
        if len(lefts) == 1:
            artist = with_artist[0][0]
        elif not any(song_search.same_artist(left, album_artist) for left, _ in with_artist):
            per_track = True
    tracks: list[AlbumTrack] = []
    for number, (chapter, title, split) in enumerate(
        zip(chapters, titles, splits, strict=True), start=1
    ):
        own_artist = ""
        if split and (per_track or song_search.same_artist(split[0], artist)):
            own_artist, title = split if per_track else ("", split[1])
        named = bool(title) and not _PLACEHOLDER.match(title)
        tracks.append(
            AlbumTrack(
                number=number,
                title=title if named else f"Track {number}",
                start=chapter["start"],
                end=chapter["end"],
                artist=own_artist,
                named=named,
            )
        )
    return tracks, artist


def tracks_from_lengths(
    names: list[tuple[str, float, str]], duration: float, album_artist: str = ""
) -> list[AlbumTrack]:
    """Songs placed end to end by their catalog lengths; the last one ends with the
    recording. ``album_audio.place_cuts`` moves each cut to the pause that is really there."""
    tracks: list[AlbumTrack] = []
    position = 0.0
    for number, (title, length, artist) in enumerate(names, start=1):
        end = duration if number == len(names) else min(duration, position + length)
        own = "" if not artist or song_search.same_artist(artist, album_artist) else artist
        tracks.append(AlbumTrack(number, title, position, end, own))
        position = end
    return tracks


def tracks_from_cuts(cuts: list[float], duration: float) -> list[AlbumTrack]:
    """Unnamed songs between the cuts found at the pauses ("Track 1", "Track 2", …)."""
    edges = [0.0, *cuts, duration]
    return [
        AlbumTrack(n, f"Track {n}", edges[n - 1], edges[n], named=False)
        for n in range(1, len(edges))
    ]


def recut(tracks: list[AlbumTrack], cuts: list[float]) -> list[AlbumTrack]:
    """The tracks with their boundaries moved to ``cuts`` (one per boundary, in order)."""
    if len(cuts) != len(tracks) - 1:
        return tracks
    for track, cut in zip(tracks, cuts, strict=False):
        track.end = cut
    for track, cut in zip(tracks[1:], cuts, strict=False):
        track.start = cut
    return tracks


# --------------------------------------------------------------------------- catalogs


def _album_key(title: str) -> str:
    return song_search.fold(song_search.base_title(strip_album_notes(title) or title))


def _names_album(found_title: str, found_artist: str, title: str, artist: str) -> bool:
    if not song_search.same_artist(found_artist, artist):
        return False
    found, wanted = _album_key(found_title), _album_key(title)
    return bool(found) and bool(wanted) and found == wanted


def _deezer_albums(artist: str, title: str) -> list[CatalogAlbum]:
    data = song_search._get_json(DEEZER_ALBUM_SEARCH_URL, {"q": f"{artist} {title}", "limit": 10})
    albums: list[CatalogAlbum] = []
    for item in (data.get("data") or []) if isinstance(data, dict) else []:
        if not isinstance(item, dict) or not isinstance(item.get("id"), int):
            continue
        found_artist = str((item.get("artist") or {}).get("name") or "")
        found_title = str(item.get("title") or "")
        if not _names_album(found_title, found_artist, title, artist):
            continue
        albums.append(
            CatalogAlbum(
                "deezer",
                found_title,
                found_artist,
                f"https://www.deezer.com/album/{item['id']}",
                [],
            )
        )
        if len(albums) == CATALOG_CANDIDATES:
            break
    for album in albums:
        album_id = album.link.rsplit("/", 1)[-1]
        listing = song_search._get_json(DEEZER_ALBUM_TRACKS_URL.format(id=album_id), {"limit": 100})
        for track in (listing.get("data") or []) if isinstance(listing, dict) else []:
            length = _length(track.get("duration")) if isinstance(track, dict) else None
            name = str(track.get("title") or "").strip() if isinstance(track, dict) else ""
            if name and length:
                own = str((track.get("artist") or {}).get("name") or "")
                album.songs.append((name, length, own))
    return [album for album in albums if album.songs]


def _itunes_albums(artist: str, title: str) -> list[CatalogAlbum]:
    country = config.SONG_SEARCH_COUNTRY
    data = song_search._get_json(
        ITUNES_SEARCH_URL,
        {
            "term": f"{artist} {title}",
            "media": "music",
            "entity": "album",
            "limit": 10,
            "country": country,
        },
    )
    albums: list[tuple[int, CatalogAlbum]] = []
    for item in (data.get("results") or []) if isinstance(data, dict) else []:
        if not isinstance(item, dict) or not isinstance(item.get("collectionId"), int):
            continue
        found_title = re.sub(r"\s+-\s+(?:Single|EP)$", "", str(item.get("collectionName") or ""))
        found_artist = str(item.get("artistName") or "")
        if not _names_album(found_title, found_artist, title, artist):
            continue
        collection = item["collectionId"]
        link = f"https://music.apple.com/{country}/album/{collection}"
        albums.append((collection, CatalogAlbum("itunes", found_title, found_artist, link, [])))
        if len(albums) == CATALOG_CANDIDATES:
            break
    for collection, album in albums:
        listing = song_search._get_json(
            ITUNES_LOOKUP_URL,
            {"id": collection, "entity": "song", "limit": 200, "country": country},
        )
        songs = [
            item
            for item in ((listing.get("results") or []) if isinstance(listing, dict) else [])
            if isinstance(item, dict) and item.get("kind") == "song"
        ]
        songs.sort(key=lambda s: (s.get("discNumber") or 1, s.get("trackNumber") or 0))
        for song in songs:
            millis = _length(song.get("trackTimeMillis"))
            name = str(song.get("trackName") or "").strip()
            if name and millis:
                album.songs.append((name, millis / 1000, str(song.get("artistName") or "")))
    return [album for _, album in albums if album.songs]


def length_tolerance(duration: float) -> float:
    """How far an album's catalog length may be from the recording's: uploads add or trim
    a little silence between songs."""
    return max(20.0, duration * 0.04)


def find_catalog_album(
    artist: str, title: str, duration: float, sources: tuple[str, ...] | None = None
) -> CatalogAlbum | None:
    """The album on Deezer or the iTunes Store (those of ``SONG_SEARCH_SOURCES``) with this
    artist and name whose songs add up to the recording's length; the closest one when
    several do. None when no catalog answers or none fits: a deluxe edition with bonus
    songs, or an upload missing one, is not the recording."""
    if not artist or not title or not duration:
        return None
    sources = server_settings.song_search_sources() if sources is None else sources
    found: list[CatalogAlbum] = []
    for source, ask in (("deezer", _deezer_albums), ("itunes", _itunes_albums)):
        if source not in sources:
            continue
        try:
            found += ask(artist, title)
        except Exception as exc:
            logger.info(f"Album lookup on {source} failed for {artist} - {title}: {exc}")
    fitting = [a for a in found if abs(a.length - duration) <= length_tolerance(duration)]
    if not fitting:
        return None
    return min(fitting, key=lambda a: abs(a.length - duration))
