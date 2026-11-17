"""Song links from SoundCloud, Bandcamp, Vimeo and the Internet Archive: which links are one
song, the address yt-dlp gets and the track id that names the song, offline."""

import re

import pytest

from backend.services.media_links import (
    UnusableLink,
    link_site,
    parse_media_link,
    supported_sites_sentence,
)
from backend.shared_assets import load

TRACK_ID = re.compile(r"[0-9A-Za-z_-]+")


@pytest.mark.parametrize("case", load("media_sites")["host_cases"], ids=lambda c: c["text"])
def test_the_site_of_a_link_matches_the_shared_cases(case):
    assert link_site(case["text"]) == case["site"]


@pytest.mark.parametrize(
    "text,site,track_id",
    [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "youtube", "dQw4w9WgXcQ"),
        ("https://vimeo.com/76979871", "vimeo", "vimeo-76979871"),
        ("vimeo.com/76979871/abcdef1234", "vimeo", "vimeo-76979871"),
        ("https://player.vimeo.com/video/76979871?h=abc", "vimeo", "vimeo-76979871"),
        ("https://vimeo.com/channels/staffpicks/76979871", "vimeo", "vimeo-76979871"),
        ("https://vimeo.com/groups/travel/videos/76979871", "vimeo", "vimeo-76979871"),
    ],
)
def test_links_whose_site_names_the_song_keep_its_id(text, site, track_id):
    link = parse_media_link(text)
    assert (link.site, link.track_id) == (site, track_id)


@pytest.mark.parametrize(
    "text,site",
    [
        ("https://soundcloud.com/forss/flickermood", "soundcloud"),
        ("https://m.soundcloud.com/forss/flickermood?si=abc&utm_source=clipboard", "soundcloud"),
        ("soundcloud.com/forss/flickermood/s-SecretToken", "soundcloud"),
        ("https://on.soundcloud.com/AbCdEf123", "soundcloud"),
        ("https://artist.bandcamp.com/track/a-song", "bandcamp"),
        ("https://archive.org/details/some-item", "archive"),
        ("https://archive.org/details/some-item/disc1/track01.flac", "archive"),
        ("https://archive.org/embed/some-item", "archive"),
    ],
)
def test_other_songs_get_a_file_safe_id_prefixed_by_their_site(text, site):
    link = parse_media_link(text)
    assert link.site == site
    assert link.track_id.startswith(f"{site}-")
    assert TRACK_ID.fullmatch(link.track_id)
    assert link.url.startswith("https://")


def test_the_same_song_pasted_differently_gets_the_same_id():
    ids = {
        parse_media_link(text).track_id
        for text in (
            "https://soundcloud.com/Forss/Flickermood",
            "soundcloud.com/forss/flickermood?si=123",
            "https://www.soundcloud.com/forss/flickermood/",
            "https://m.soundcloud.com/forss/flickermood",
        )
    }
    assert len(ids) == 1
    assert parse_media_link("https://soundcloud.com/forss/other").track_id not in ids


def test_ids_from_different_sites_never_collide():
    soundcloud = parse_media_link("https://soundcloud.com/a/b").track_id
    bandcamp = parse_media_link("https://a.bandcamp.com/track/b").track_id
    assert soundcloud != bandcamp


def test_an_archive_download_link_is_read_from_its_details_page():
    link = parse_media_link("https://archive.org/download/some-item/track%2001.mp3")
    assert link.url == "https://archive.org/details/some-item/track%2001.mp3"
    assert link.track_id == parse_media_link(link.url).track_id


@pytest.mark.parametrize(
    "text,hint",
    [
        ("https://soundcloud.com/forss", "profile"),
        ("https://soundcloud.com/forss/sets/an-album", "several tracks"),
        ("https://soundcloud.com/forss/likes", "several tracks"),
        ("https://soundcloud.com/discover", "one track"),
        ("https://soundcloud.com/a/b/c/d", "one track"),
        ("https://artist.bandcamp.com/album/a-record", "album"),
        ("https://artist.bandcamp.com/", "track"),
        ("https://bandcamp.com/discover", "artist's Bandcamp page"),
        ("https://vimeo.com/channels/staffpicks", "one video"),
        ("https://vimeo.com/someone", "one video"),
        ("https://archive.org/search?query=x", "archive.org/details"),
        ("https://archive.org/download/some-item", "archive.org/details"),
        ("https://www.youtube.com/playlist?list=PL123", "single video"),
    ],
)
def test_links_that_are_not_one_song_say_what_to_paste(text, hint):
    with pytest.raises(UnusableLink, match=hint):
        parse_media_link(text)


@pytest.mark.parametrize(
    "text",
    [
        "dQw4w9WgXcQ",
        "never gonna give you up",
        "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT",
        "https://soundcloud.com.attacker.example/a/b",
        "",
        None,
    ],
)
def test_search_words_ids_and_other_sites_are_not_song_links(text):
    assert parse_media_link(text) is None


def test_messages_name_every_supported_site():
    assert supported_sites_sentence() == "YouTube, SoundCloud, Bandcamp, Vimeo or Internet Archive"
