"""Spotify, Apple Music and TIDAL songs: their title, artist and length are read from the
service's public pages, and the song is matched to a YouTube upload of the same recording,
never a cover, a live take or another length, and refused when nothing matches."""

from unittest.mock import MagicMock, patch

import pytest
import requests

from backend.services.media_links import parse_media_link
from backend.services.song_lookup import (
    SongInfo,
    SongNotFound,
    fetch_song_info,
    find_on_youtube,
    match_score,
)

SPOTIFY = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"
APPLE = "https://music.apple.com/gb/album/never-gonna/1559885420?i=1559885421"
TIDAL = "https://tidal.com/browse/track/77646168"

SPOTIFY_PAGE = """<html><head>
<meta property="og:title" content="Never Gonna Give You Up"/>
<meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987"/>
<meta property="og:image" content="https://i.scdn.co/image/cover"/>
<meta name="music:duration" content="214"/>
<meta name="music:musician_description" content="Rick Astley"/>
</head></html>"""

TIDAL_PAGE = """<html><head><title>Internal Calm by Afterhour Chillout on TIDAL</title>
<script type="application/ld+json">{"@type":"MusicRecording","name":"Internal Calm",
"byArtist":[{"@type":"MusicGroup","name":"Afterhour Chillout"}],"duration":"PT3M34S"}</script>
</head></html>"""


def _response(text="", data=None, status=200):
    res = MagicMock()
    res.status_code = status
    res.text = text
    res.json.return_value = data
    if status >= 400:
        res.raise_for_status.side_effect = requests.HTTPError(response=res)
    return res


def _fetch(url, response):
    with patch("backend.services.song_lookup.requests.get", return_value=response) as get:
        info = fetch_song_info(parse_media_link(url))
    return info, get


def test_a_spotify_song_is_read_from_its_track_page():
    info, get = _fetch(SPOTIFY, _response(SPOTIFY_PAGE))
    assert (info.title, info.artists, info.duration) == (
        "Never Gonna Give You Up",
        ["Rick Astley"],
        214.0,
    )
    assert get.call_args.args[0] == SPOTIFY


def test_a_spotify_page_without_the_musician_tag_names_the_artist_in_its_description():
    page = SPOTIFY_PAGE.replace('name="music:musician_description"', 'name="other"')
    info, _ = _fetch(SPOTIFY, _response(page))
    assert info.artist == "Rick Astley"


def test_an_apple_music_song_is_read_from_the_itunes_lookup_in_its_country():
    data = {
        "results": [
            {
                "wrapperType": "track",
                "trackName": "Never Gonna Give You Up",
                "artistName": "Rick Astley",
                "trackTimeMillis": 213573,
            }
        ]
    }
    info, get = _fetch(APPLE, _response(data=data))
    assert (info.title, info.artist, info.duration) == (
        "Never Gonna Give You Up",
        "Rick Astley",
        213.573,
    )
    assert get.call_args.args[0] == "https://itunes.apple.com/lookup"
    assert get.call_args.kwargs["params"] == {"id": "1559885421", "country": "gb"}


def test_a_tidal_song_is_read_from_its_pages_structured_data():
    info, _ = _fetch(TIDAL, _response(TIDAL_PAGE))
    assert (info.title, info.artist, info.duration) == ("Internal Calm", "Afterhour Chillout", 214)


def test_a_tidal_page_without_structured_data_is_read_from_its_title():
    page = TIDAL_PAGE.split("<script")[0] + "</head></html>"
    info, _ = _fetch(TIDAL, _response(page))
    assert (info.title, info.artist, info.duration) == ("Internal Calm", "Afterhour Chillout", None)


@pytest.mark.parametrize(
    "response,message",
    [
        (_response(status=404), "Spotify has no song at that link"),
        (_response(status=503), "Spotify did not answer"),
        (_response("<html></html>"), "Could not read the song's title and artist from Spotify"),
    ],
)
def test_a_song_that_cannot_be_read_says_why(response, message):
    with pytest.raises(SongNotFound, match=message):
        _fetch(SPOTIFY, response)


def test_a_service_that_cannot_be_reached_says_so():
    error = requests.ConnectionError("Name or service not known")
    with (
        patch("backend.services.song_lookup.requests.get", side_effect=error),
        pytest.raises(SongNotFound, match="TIDAL could not be reached"),
    ):
        fetch_song_info(parse_media_link(TIDAL))


SONG = SongInfo(title="Never Gonna Give You Up", artists=["Rick Astley"], duration=214.0)


def _upload(title, artist="Rick Astley", duration=214, video_id="v1"):
    return {
        "id": video_id,
        "title": title,
        "artist": artist,
        "duration": duration,
        "url": f"https://www.youtube.com/watch?v={video_id}",
    }


@pytest.mark.parametrize(
    "upload",
    [
        _upload("Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)"),
        _upload("Never Gonna Give You Up", artist="Rick Astley - Topic"),
        _upload(
            "Rick Astley - Never Gonna Give You Up (Lyrics)", artist="Lyric Channel", duration=218
        ),
        _upload("Never Gonna Give You Up - Rick Astley", artist="Some Fan"),
    ],
)
def test_uploads_of_the_recording_match(upload):
    assert match_score(SONG, upload) is not None


@pytest.mark.parametrize(
    "upload",
    [
        _upload("Rick Astley - Never Gonna Give You Up (Sped up)", artist="Fan", duration=164),
        _upload("Never Gonna Give You Up | Rick Astley Live at Glastonbury", duration=216),
        _upload("Rick Astley - Never Gonna Give You Up (Piano Cover)", artist="Pianist"),
        _upload("Never Gonna Give You Up (Karaoke Version)", artist="Sing King"),
        _upload("Rick Astley - Never Gonna Give You Up (Remix)"),
        _upload("Rick Astley - Never Gonna Give You Up", duration=260),
        _upload("Rick Astley - Together Forever"),
        _upload("Never Gonna Give You Up", artist="Cake"),
        _upload(""),
    ],
)
def test_other_versions_songs_and_lengths_do_not_match(upload):
    assert match_score(SONG, upload) is None


def test_a_version_the_songs_own_title_names_can_match():
    live = SongInfo(title="Never Gonna Give You Up (Live)", artists=["Rick Astley"], duration=230)
    assert match_score(live, _upload("Rick Astley - Never Gonna Give You Up (Live)", duration=231))


def test_the_closest_upload_of_the_recording_ranks_first():
    lyric = _upload("Rick Astley - Never Gonna Give You Up (Lyrics)", "Lyrics Fan", 225, "lyric")
    topic = _upload("Never Gonna Give You Up", "Rick Astley - Topic", 213, "topic")
    cover = _upload("Never Gonna Give You Up (Cover)", "Someone", 214, "cover")
    search = MagicMock(return_value=[lyric, cover, topic])

    ranked = find_on_youtube(SONG, search)

    assert [r["id"] for r in ranked] == ["topic", "lyric"]
    search.assert_called_once_with("Rick Astley Never Gonna Give You Up", limit=10)


def test_no_matching_upload_is_refused_rather_than_guessed():
    search = MagicMock(return_value=[_upload("Relaxing Chillout Mix 2 Hours", "Lounge", 7200)])
    with pytest.raises(
        SongNotFound, match=r"Could not find .*Never Gonna Give You Up.* on YouTube"
    ):
        find_on_youtube(SONG, search)


def test_a_failed_search_is_tried_once_more_then_reported_as_a_failed_search():
    topic = _upload("Never Gonna Give You Up", "Rick Astley - Topic")
    flaky = MagicMock(side_effect=[RuntimeError("HTTP Error 403"), [topic]])
    assert find_on_youtube(SONG, flaky) == [topic]

    down = MagicMock(side_effect=RuntimeError("HTTP Error 403: Forbidden"))
    with pytest.raises(RuntimeError, match="YouTube search failed: HTTP Error 403"):
        find_on_youtube(SONG, down)
    assert down.call_count == 2
