"""Song links the intake accepts: YouTube, SoundCloud, Bandcamp, Vimeo and the Internet
Archive (the sites in ``assets/shared/media_sites.json``). Turns a pasted link into the site,
the address yt-dlp downloads and a file-safe track id, which names the song's audio in
``downloads/``, its stems folder and its project, so the same link pasted twice opens the
same song. Works offline: nothing here touches the network."""

import hashlib
import re
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlparse

from backend.shared_assets import load

SITES: list[dict] = load("media_sites")["sites"]
SITE_NAMES: dict[str, str] = {site["id"]: site["name"] for site in SITES}

_YOUTUBE_ID = re.compile(r"[0-9A-Za-z_-]{11}")
_VIMEO_ID = re.compile(r"\d{4,}")
_VIMEO_HASH = re.compile(r"[0-9a-f]{6,}")
_ARCHIVE_IDENTIFIER = re.compile(r"[0-9A-Za-z._-]+")
# SoundCloud pages under a profile that list tracks rather than being one
_SOUNDCLOUD_LISTS = {
    "albums",
    "comments",
    "followers",
    "following",
    "likes",
    "popular-tracks",
    "reposts",
    "sets",
    "spotlight",
    "tracks",
}
# First path segments of soundcloud.com that are site pages, not profiles
_SOUNDCLOUD_PAGES = {"charts", "discover", "feed", "search", "stations", "upload", "you"}


class UnusableLink(ValueError):
    """A link to a supported site that is not one song (a profile, an album, a playlist).
    The message says what to paste instead."""


@dataclass(frozen=True)
class MediaLink:
    site: str
    """One of the ids in media_sites.json: youtube, soundcloud, bandcamp, vimeo, archive."""
    url: str
    """The address handed to yt-dlp."""
    track_id: str
    """File-safe and stable for the same song: a YouTube video id, else ``<site>-<id>``."""


def _with_scheme(text: str) -> str:
    return text if re.match(r"^https?://", text, re.IGNORECASE) else "https://" + text


def link_site(text: str | None) -> str | None:
    """The supported site a link points to (its host is one of a site's domains or below
    one), or None for anything else, a bare video id and plain search words included."""
    if not isinstance(text, str):
        return None
    clean = text.strip()
    if not clean or any(ch.isspace() for ch in clean) or "." not in clean:
        return None
    try:
        host = (urlparse(_with_scheme(clean)).hostname or "").lower()
    except ValueError:
        return None
    for site in SITES:
        for domain in site["domains"]:
            if host == domain or host.endswith("." + domain):
                return site["id"]
    return None


def _digest(key: str) -> str:
    return hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]


def _segments(path: str) -> list[str]:
    return [unquote(part) for part in path.split("/") if part]


def _soundcloud(url: str, host: str, parts: list[str]) -> MediaLink:
    if host == "on.soundcloud.com":
        # The app's share links: a short code that redirects to the track
        if len(parts) == 1:
            return MediaLink("soundcloud", url, f"soundcloud-{_digest('on/' + parts[0])}")
        raise UnusableLink("That SoundCloud share link is incomplete. Copy it again.")
    if host not in ("soundcloud.com", "www.soundcloud.com", "m.soundcloud.com"):
        raise UnusableLink("Open the track on soundcloud.com and paste its link.")
    if not parts or parts[0].lower() in _SOUNDCLOUD_PAGES:
        raise UnusableLink("Open one track on SoundCloud and paste its link.")
    if len(parts) == 1:
        raise UnusableLink(
            "That is a SoundCloud profile. Open one of its tracks and paste that link."
        )
    if parts[1].lower() in _SOUNDCLOUD_LISTS:
        raise UnusableLink(
            "That SoundCloud link lists several tracks. Open one track and paste its link."
        )
    # A third segment is a private track's secret token (s-…), kept in the URL
    if len(parts) > 3 or (len(parts) == 3 and not parts[2].startswith("s-")):
        raise UnusableLink("Open one track on SoundCloud and paste its link.")
    key = f"{parts[0]}/{parts[1]}".lower()
    return MediaLink("soundcloud", url, f"soundcloud-{_digest(key)}")


def _bandcamp(url: str, host: str, parts: list[str]) -> MediaLink:
    artist = host.removesuffix(".bandcamp.com")
    if artist in ("bandcamp.com", "www", "") or "." in artist:
        raise UnusableLink(
            "Open the song on the artist's Bandcamp page (artist.bandcamp.com/track/…) "
            "and paste that link."
        )
    if len(parts) >= 2 and parts[0] == "track":
        return MediaLink("bandcamp", url, f"bandcamp-{_digest(f'{artist}/{parts[1]}'.lower())}")
    if parts and parts[0] == "album":
        raise UnusableLink("That is a Bandcamp album. Open one of its tracks and paste that link.")
    raise UnusableLink("Open one track on Bandcamp (…/track/…) and paste its link.")


def _vimeo(url: str, host: str, parts: list[str]) -> MediaLink:
    video_id = None
    if host == "player.vimeo.com":
        if len(parts) >= 2 and parts[0] == "video":
            video_id = parts[1]
    elif parts and _VIMEO_ID.fullmatch(parts[0]):
        # vimeo.com/<id>, or vimeo.com/<id>/<hash> for an unlisted video
        if len(parts) == 1 or (len(parts) == 2 and _VIMEO_HASH.fullmatch(parts[1])):
            video_id = parts[0]
    elif len(parts) == 3 and parts[0] == "channels":
        video_id = parts[2]
    elif len(parts) == 4 and parts[0] == "groups" and parts[2] == "videos":
        video_id = parts[3]
    if video_id is None or not _VIMEO_ID.fullmatch(video_id):
        raise UnusableLink("Open one video on Vimeo and paste its link.")
    return MediaLink("vimeo", url, f"vimeo-{video_id}")


def _archive(url: str, parts: list[str]) -> MediaLink:
    if len(parts) < 2 or parts[0] not in ("details", "download", "embed"):
        raise UnusableLink(
            "Open the recording on archive.org (archive.org/details/…) and paste its link."
        )
    identifier, file_name = parts[1], "/".join(parts[2:])
    if not _ARCHIVE_IDENTIFIER.fullmatch(identifier):
        raise UnusableLink("That Internet Archive link is incomplete. Copy it again.")
    if parts[0] == "download":
        if not file_name:
            raise UnusableLink(
                "Open the recording on archive.org (archive.org/details/…) and paste its link."
            )
        # yt-dlp reads items from their details page, which names the same file
        url = f"https://archive.org/details/{identifier}/{quote(file_name)}"
    key = f"{identifier}/{file_name}" if file_name else identifier
    return MediaLink("archive", url, f"archive-{_digest(key)}")


def parse_media_link(text: str | None) -> MediaLink | None:
    """The song a link points to; None when the text is not a link to a supported site
    (search words, a bare video id, another site). Raises UnusableLink for a supported
    site's link that is not one song, such as a profile, an album or a playlist."""
    site = link_site(text)
    if site is None:
        return None
    url = _with_scheme(text.strip())
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    parts = _segments(parsed.path)

    if site == "youtube":
        from backend.services.downloader import TrackDownloader

        video_id = TrackDownloader.extract_video_id(url)
        if not video_id or not _YOUTUBE_ID.fullmatch(video_id):
            raise UnusableLink(
                "That YouTube link is not a single video. Open the video and paste its link."
            )
        return MediaLink("youtube", url, video_id)
    if site == "soundcloud":
        return _soundcloud(url, host, parts)
    if site == "bandcamp":
        return _bandcamp(url, host, parts)
    if site == "vimeo":
        return _vimeo(url, host, parts)
    return _archive(url, parts)


def supported_sites_sentence() -> str:
    """ "YouTube, SoundCloud, Bandcamp, Vimeo or Internet Archive", for messages."""
    names = [site["name"] for site in SITES]
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " or " + names[-1]
