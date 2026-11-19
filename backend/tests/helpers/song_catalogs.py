"""The music catalogs the song search asks, for tests: what Deezer, the iTunes Store and
YouTube's suggestions really answered for a few misspelled searches (recorded in
``song_catalog_listings.json``, trimmed to the fields ``song_search`` reads and to each
catalog's first twelve songs), a stand-in for ``song_search._get_json`` that replays them,
and builders for single catalog entries."""

import json
from pathlib import Path
from typing import Any

from backend.services import song_search

LISTINGS: dict[str, dict[str, list]] = json.loads(
    (Path(__file__).with_name("song_catalog_listings.json")).read_text(encoding="utf-8")
)


class FakeCatalogs:
    """Stands in for ``song_search._get_json``: answers from ``deezer``, ``itunes`` and
    ``suggest`` (query → entries; a query not listed finds nothing) and records every
    request as ``(service, query)``. A service in ``down`` raises instead, and one in
    ``refusing`` answers with its rate-limit refusal."""

    def __init__(
        self,
        deezer: dict[str, list] | None = None,
        itunes: dict[str, list] | None = None,
        suggest: dict[str, list] | None = None,
        down: tuple[str, ...] = (),
        refusing: tuple[str, ...] = (),
    ):
        self.deezer = LISTINGS["deezer"] if deezer is None else deezer
        self.itunes = LISTINGS["itunes"] if itunes is None else itunes
        self.suggest = LISTINGS["suggest"] if suggest is None else suggest
        self.down = set(down)
        self.refusing = set(refusing)
        self.requests: list[tuple[str, str]] = []
        self.params: list[dict[str, Any]] = []

    def asked(self, service: str) -> list[str]:
        return [query for name, query in self.requests if name == service]

    def __call__(self, url: str, params: dict[str, Any]) -> Any:
        service = {
            song_search.DEEZER_SEARCH_URL: "deezer",
            song_search.ITUNES_SEARCH_URL: "itunes",
            song_search.SUGGEST_URL: "suggest",
        }[url]
        query = params["term"] if service == "itunes" else params["q"]
        self.requests.append((service, query))
        self.params.append(dict(params))
        if service in self.down:
            raise ConnectionError(f"{service} is down")
        if service in self.refusing:
            raise song_search.CatalogRefused("HTTP 429")
        if service == "deezer":
            return {"data": self.deezer.get(query, [])}
        if service == "itunes":
            return {"results": self.itunes.get(query, [])}
        return [query, self.suggest.get(query, [])]


def deezer_entry(
    title: str,
    artist: str,
    *,
    song_id: int = 1,
    duration: int = 200,
    rank: int = 500_000,
    album: str = "",
    **extra: Any,
) -> dict[str, Any]:
    return {
        "id": song_id,
        "type": "track",
        "title": title,
        "duration": duration,
        "rank": rank,
        "artist": {"name": artist},
        "album": {"title": album or title},
        **extra,
    }


def itunes_entry(
    title: str,
    artist: str,
    *,
    song_id: int = 1,
    seconds: float = 200,
    album: str = "",
    **extra: Any,
) -> dict[str, Any]:
    return {
        "kind": "song",
        "trackId": song_id,
        "trackName": title,
        "artistName": artist,
        "collectionName": album or title,
        "trackTimeMillis": int(seconds * 1000),
        **extra,
    }
