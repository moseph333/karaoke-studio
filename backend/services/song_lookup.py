"""Spotify, Apple Music, TIDAL and Deezer links: their audio cannot be downloaded, so the
song's title, artist and length are read from the service's public pages (Spotify's track
page, Apple's iTunes lookup API, TIDAL's track page, Deezer's track API) and the song is
matched to a YouTube upload of the same recording. Songs picked from the song search
(``song_search``) arrive as Deezer or Apple Music links and take the same path. The match must have the song's title and artist and, when the service
gives a length, about the same length; covers, live takes, karaoke and other versions the
song's own title does not name are never picked. With no such upload the link is refused
rather than guessed, and the user is told to search instead."""

import html
import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import requests

from backend.services.lyrics import LyricsNormalizer, LyricsService
from backend.services.media_links import SITE_NAMES, MediaLink, UnusableLink, parse_media_link

logger = logging.getLogger(__name__)

LOOKUP_TIMEOUT_SEC = 10
# Results read per search; the right upload is nearly always in the first few
SEARCH_RESULTS = 10
# A length within this many seconds counts in full; past MAX it rules an upload out
DURATION_EXACT_SEC = 4.0
DURATION_MAX_SEC = 15.0
MIN_TITLE_SIMILARITY = 0.6
MIN_ARTIST_SIMILARITY = 0.5
# Versions of a song an upload's title may name that are not the recording linked (unless
# the linked song's own title names them too)
OTHER_VERSIONS = (
    "8d",
    "acapella",
    "a cappella",
    "acoustic",
    "bass boosted",
    "cover",
    "hour",
    "instrumental",
    "karaoke",
    "live",
    "loop",
    "mashup",
    "nightcore",
    "reaction",
    "remix",
    "reverb",
    "slowed",
    "sped up",
    "tutorial",
)
_HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; KaraokeStudio)"}


class SongNotFound(RuntimeError):
    """The song's details could not be read, or no YouTube upload matches it. The message is
    written for the person who pasted the link."""


@dataclass
class SongInfo:
    title: str
    artists: list[str]
    duration: float | None = None
    thumbnail: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    @property
    def artist(self) -> str:
        return self.artists[0] if self.artists else ""


def _get(url: str, **params: Any) -> requests.Response:
    res = requests.get(url, params=params or None, headers=_HEADERS, timeout=LOOKUP_TIMEOUT_SEC)
    res.raise_for_status()
    return res


def _meta(page: str, key: str) -> list[str]:
    """Every value of <meta property|name="key" content="…"> on a page."""
    pattern = rf'<meta\s+(?:property|name)="{re.escape(key)}"\s+content="([^"]*)"'
    return [html.unescape(value).strip() for value in re.findall(pattern, page)]


def _iso_duration(text: Any) -> float | None:
    """Seconds in an ISO 8601 duration such as PT3M34S."""
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?", str(text or ""))
    if not match or not any(match.groups()):
        return None
    hours, minutes, seconds = (float(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def _spotify(link: MediaLink) -> SongInfo:
    page = _get(link.url).text
    title = next(iter(_meta(page, "og:title")), "")
    artists = _meta(page, "music:musician_description")
    if not artists:
        # "Rick Astley · Whenever You Need Somebody · Song · 1987"
        description = next(iter(_meta(page, "og:description")), "")
        artists = [description.split(" · ")[0]] if " · " in description else []
    duration = next(iter(_meta(page, "music:duration")), "")
    return SongInfo(
        title=title,
        artists=[a for a in artists if a],
        duration=float(duration) if duration.isdigit() else None,
        thumbnail=next(iter(_meta(page, "og:image")), None),
    )


def _apple_music(link: MediaLink) -> SongInfo:
    first = (urlparse(link.url).path.strip("/").split("/") or [""])[0]
    country = first if re.fullmatch(r"[a-z]{2}", first) else "us"
    data = _get("https://itunes.apple.com/lookup", id=link.source_id, country=country).json()
    song = next(
        (r for r in data.get("results") or [] if r.get("wrapperType") == "track"),
        None,
    )
    if not song:
        return SongInfo(title="", artists=[])
    millis = song.get("trackTimeMillis")
    return SongInfo(
        title=str(song.get("trackName") or ""),
        artists=[str(song.get("artistName") or "")],
        duration=millis / 1000 if isinstance(millis, (int, float)) and millis > 0 else None,
        thumbnail=song.get("artworkUrl100"),
    )


def _tidal(link: MediaLink) -> SongInfo:
    page = _get(link.url).text
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        if isinstance(data, dict) and data.get("@type") == "MusicRecording":
            by = data.get("byArtist") or []
            by = by if isinstance(by, list) else [by]
            return SongInfo(
                title=str(data.get("name") or ""),
                artists=[str(a.get("name")) for a in by if isinstance(a, dict) and a.get("name")],
                duration=_iso_duration(data.get("duration")),
                thumbnail=data.get("image") if isinstance(data.get("image"), str) else None,
            )
    # "Internal Calm by Afterhour Chillout on TIDAL"
    title_tag = re.search(r"<title>(.*?) by (.*?) on TIDAL</title>", page, re.S)
    if title_tag:
        return SongInfo(
            title=html.unescape(title_tag.group(1)).strip(),
            artists=[html.unescape(title_tag.group(2)).strip()],
        )
    return SongInfo(title="", artists=[])


def _deezer(link: MediaLink) -> SongInfo:
    song = link.source_id
    if not song:
        # A share link (link.deezer.com/s/…) redirects to the song's page
        try:
            target = parse_media_link(_get(link.url).url)
        except UnusableLink:
            target = None
        if target is None or target.site != "deezer" or not target.source_id:
            raise SongNotFound(
                "That Deezer share link does not lead to one song. "
                "Open the song on deezer.com and paste its link."
            )
        song = target.source_id
    data = _get(f"https://api.deezer.com/track/{song}").json()
    if not isinstance(data, dict):
        return SongInfo(title="", artists=[])
    error = data.get("error")
    if isinstance(error, dict):
        # Deezer answers 200 with an error body: 800 is "no data", 4 its request quota
        if error.get("code") == 800:
            raise SongNotFound("Deezer has no song at that link.")
        raise SongNotFound(
            f"Deezer did not answer ({error.get('message') or 'error'}). Try again in a minute."
        )
    artist = data.get("artist") if isinstance(data.get("artist"), dict) else {}
    contributors = [
        str(c["name"])
        for c in data.get("contributors") or []
        if isinstance(c, dict) and c.get("name")
    ]
    album = data.get("album") if isinstance(data.get("album"), dict) else {}
    duration = data.get("duration")
    return SongInfo(
        title=str(data.get("title") or ""),
        artists=contributors or [str(artist.get("name") or "")],
        duration=float(duration) if isinstance(duration, (int, float)) and duration > 0 else None,
        thumbnail=album.get("cover_big") or album.get("cover_medium"),
    )


_READERS = {"spotify": _spotify, "applemusic": _apple_music, "tidal": _tidal, "deezer": _deezer}


def fetch_song_info(link: MediaLink) -> SongInfo:
    """The song a Spotify, Apple Music, TIDAL or Deezer link points to, read from the service."""
    site_name = SITE_NAMES.get(link.site, link.site)
    try:
        info = _READERS[link.site](link)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else None
        if status == 404:
            raise SongNotFound(f"{site_name} has no song at that link.") from e
        raise SongNotFound(f"{site_name} did not answer ({e}). Try again in a minute.") from e
    except requests.RequestException as e:
        raise SongNotFound(f"{site_name} could not be reached ({e}). Try again in a minute.") from e
    if not info.title or not info.artist:
        raise SongNotFound(
            f"Could not read the song's title and artist from {site_name}. "
            "Search for the song by name instead."
        )
    return info


def _versions(text: str) -> set[str]:
    lowered = f" {text.lower()} "
    return {word for word in OTHER_VERSIONS if re.search(rf"\b{re.escape(word)}\b", lowered)}


def _uploader_artist(uploader: str) -> str:
    """The artist an uploading channel names: "Rick Astley - Topic", "RickAstleyVEVO"."""
    name = re.sub(r"\s*-\s*Topic$", "", uploader or "").strip()
    return re.sub(r"(?i)\s*vevo$", "", name).strip()


def match_score(info: SongInfo, candidate: dict[str, Any]) -> float | None:
    """How well a YouTube search result matches the song (higher is better), or None when it
    is not the same recording: another title or artist, a length off by more than
    DURATION_MAX_SEC, or a version (live, cover, remix…) the song's title does not name."""
    raw_title = str(candidate.get("title") or "")
    uploader = str(candidate.get("artist") or "")
    if not raw_title:
        return None
    if _versions(raw_title) - _versions(info.title):
        return None

    song_title, song_artist = LyricsNormalizer.normalize_track_metadata(info.title, info.artist)
    cand_title, cand_artist = LyricsNormalizer.normalize_track_metadata(
        raw_title, uploader, artist_is_uploader=True
    )
    similarity = LyricsService.calculate_similarity
    # "Artist - Song" as split, or "Song - Artist" the other way round
    title_sim, split_artist_sim = max(
        (similarity(song_title, cand_title), similarity(song_artist, cand_artist)),
        (similarity(song_title, cand_artist), similarity(song_artist, cand_title)),
        key=sum,
    )
    channel = _uploader_artist(uploader)
    artist_sim = max(
        split_artist_sim,
        similarity(song_artist, channel),
        # The artist named anywhere in the title ("Song (feat. …) | Artist")
        1.0 if song_artist and song_artist.lower() in raw_title.lower() else 0.0,
    )
    if title_sim < MIN_TITLE_SIMILARITY or artist_sim < MIN_ARTIST_SIMILARITY:
        return None

    score = 50.0 * title_sim + 30.0 * artist_sim
    try:
        cand_duration = float(candidate.get("duration") or 0)
    except (TypeError, ValueError):
        cand_duration = 0.0
    if info.duration and cand_duration > 0:
        off = abs(cand_duration - info.duration)
        if off > DURATION_MAX_SEC:
            return None
        score += 20.0 if off <= DURATION_EXACT_SEC else 20.0 * (1 - off / DURATION_MAX_SEC)
    # The artist's own channel or YouTube Music's "- Topic" upload of the recording
    if uploader.endswith(" - Topic") or similarity(song_artist, channel) >= 0.9:
        score += 5.0
    return score


def find_on_youtube(info: SongInfo, search) -> list[dict[str, Any]]:
    """The YouTube search results that match the song, best first. ``search(query, limit)``
    is ``TrackDownloader.search_tracks_or_raise``; a search that fails twice raises
    RuntimeError, and SongNotFound means YouTube answered but no upload matches."""
    query = f"{info.artist} {info.title}"
    try:
        results = search(query, limit=SEARCH_RESULTS) or []
    except Exception as first:
        logger.warning(f"YouTube search for {query!r} failed, trying once more: {first}")
        try:
            results = search(query, limit=SEARCH_RESULTS) or []
        except Exception as e:
            raise RuntimeError(f"YouTube search failed: {e}") from e
    scored = [(match_score(info, r), r) for r in results if r.get("id")]
    ranked = [
        r
        for score, r in sorted(
            ((score, r) for score, r in scored if score is not None),
            key=lambda pair: pair[0],
            reverse=True,
        )
    ]
    if not ranked:
        logger.info(f"No YouTube upload matches {query!r} among {len(results)} results")
        raise SongNotFound(
            f"Could not find “{info.title}” by {info.artist} on YouTube. "
            "Search for it and pick one of the YouTube uploads listed under the songs, "
            "or add the audio as a local file."
        )
    logger.info(f"{query!r} matches {len(ranked)} YouTube uploads, best {ranked[0].get('id')}")
    return ranked
