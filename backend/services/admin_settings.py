"""The options the Server settings page offers: what each one is now, what the environment
alone would make it, and what the owner may change it to.

The list is data shared with the studio (``assets/shared/server_settings.json``): each
setting's id, the environment variable it stands in for, its kind and its words. Four kinds:
``flag`` (on or off, saved as the variable's ``on``/``off`` text), ``choice`` (one option),
``set`` (some of the options, comma-separated) and ``minutes`` (a whole number).

What a setting is *now* is never worked out here: it is asked of the code that uses it
(``READERS``), so the page shows what the server will really do, defaults, clamps and all.
A change is checked, turned into the variable's text and handed to ``server_settings``.
"""

import threading
from collections.abc import Callable
from typing import Any

from backend import server_settings, shared_assets
from backend.services import (
    alignment_config,
    remote_render,
    remote_separation,
    remote_song_loop,
    separation_presets,
    song_loops,
)
from backend.workers.song_loop_worker import MODELS

# What the server does for each setting right now, saved values included
READERS: dict[str, Callable[[], Any]] = {
    "song_loop.enabled": lambda: remote_song_loop.backend() is not None,
    "song_loop.models": song_loops.offered_models,
    "song_loop.default_model": song_loops.configured_model,
    "separation.presets": lambda: list(separation_presets.offered_presets()),
    "separation.default": separation_presets.configured_preset,
    "separation.cloud": lambda: separation_presets.remote_backend() is not None,
    "render.cloud": lambda: remote_render.backend() is not None,
    "render.prewarm": remote_render.prewarm_enabled,
    "separation.prewarm": remote_separation.prewarm_enabled,
    "limits.song_minutes": server_settings.max_song_minutes,
    "limits.album_minutes": server_settings.max_album_minutes,
    "search.sources": lambda: list(server_settings.song_search_sources()),
    "alignment.engine": alignment_config.requested_engine,
}

_update_lock = threading.Lock()


class SettingError(ValueError):
    """A change the page may not save; its text is a sentence for the owner."""


def definitions() -> dict[str, dict[str, Any]]:
    """Every setting by id, in the page's order."""
    groups = shared_assets.load("server_settings")["groups"]
    return {setting["id"]: setting for group in groups for setting in group["settings"]}


def _model_options() -> list[dict[str, str]]:
    return [
        {
            "id": model,
            "label": info["name"],
            "note": f"{info['label']}, about {info['minutes']} minutes a loop",
        }
        for model, info in MODELS.items()
    ]


# Options that are not written in the shared file because other code owns them
_OPTIONS: dict[str, Callable[[], list[dict[str, str]]]] = {"song_loop.models": _model_options}


def options(setting: dict[str, Any]) -> list[dict[str, str]]:
    """What a choice or a set may hold. A choice ``among`` a set may be any of that set's
    options; whether the set has it switched on is checked when a change is saved."""
    if setting.get("among"):
        return options(definitions()[setting["among"]])
    if setting["id"] in _OPTIONS:
        return _OPTIONS[setting["id"]]()
    return [dict(choice) for choice in setting.get("choices", [])]


def _encode(setting: dict[str, Any], value: Any) -> str:
    """The text the setting's variable would hold for this value, or a SettingError."""
    kind, title = setting["kind"], setting["title"]
    if kind == "flag":
        if not isinstance(value, bool):
            raise SettingError(f"{title}: choose on or off.")
        return setting["on"] if value else setting["off"]
    if kind == "minutes":
        limit = setting["max"]
        if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= limit:
            raise SettingError(f"{title}: enter a whole number from 0 to {limit}.")
        return str(value)

    labels = {option["id"]: option["label"] for option in options(setting)}
    if kind == "choice":
        if not isinstance(value, str) or value not in labels:
            raise SettingError(f"{title}: choose one of {', '.join(labels.values())}.")
        return value

    if not isinstance(value, list) or any(
        not isinstance(item, str) or item not in labels for item in value
    ):
        raise SettingError(f"{title}: choose among {', '.join(labels.values())}.")
    chosen = [option for option in labels if option in value]
    for locked in setting.get("locked", []):
        if locked not in chosen:
            raise SettingError(f"{title}: {labels[locked]} cannot be turned off.")
    if len(chosen) < setting.get("min", 0):
        raise SettingError(f"{title}: keep at least one on.")
    return ",".join(chosen) or setting.get("none", "")


def _check_choices_are_offered(candidate: dict[str, str]) -> None:
    """A saved default must be one of the options its set would then offer. (One that is not
    saved needs no check: the code that reads it settles on an offered option by itself.)"""
    settings = definitions()
    with server_settings.trying(candidate):
        for setting in settings.values():
            among = setting.get("among")
            if not among or setting["env"] not in candidate:
                continue
            if candidate[setting["env"]] not in READERS[among]():
                labels = {option["id"]: option["label"] for option in options(setting)}
                picked = labels.get(candidate[setting["env"]], candidate[setting["env"]])
                raise SettingError(
                    f"{setting['title']}: {picked} is turned off under "
                    f"“{settings[among]['title']}”. Choose one that is offered."
                )


def update(values: dict[str, Any]) -> list[str]:
    """Saves these changes, by setting id: a value to save, or None to forget the saved one
    and let the environment decide again. All of them are saved or, on a SettingError (or an
    OSError from the disk), none. Returns the ids changed."""
    settings = definitions()
    with _update_lock:
        candidate = server_settings.saved()
        for setting_id, value in values.items():
            setting = settings.get(setting_id)
            if setting is None:
                raise SettingError(f"This server has no setting called “{setting_id}”.")
            if value is None:
                candidate.pop(setting["env"], None)
            else:
                candidate[setting["env"]] = _encode(setting, value)
        _check_choices_are_offered(candidate)
        server_settings.save(candidate)
    return list(values)


def _plain(value: Any) -> Any:
    return list(value) if isinstance(value, tuple) else value


def describe() -> dict[str, Any]:
    """Every setting as the page shows it: its value now, the value the environment alone
    gives (what Reset returns to), whether a saved value is in force, and its options.
    ``cloud`` says whether the cloud can be asked at all, for the settings that need it."""
    settings = definitions()
    saved = server_settings.saved()
    with server_settings.trying({}):
        defaults = {setting_id: _plain(READERS[setting_id]()) for setting_id in settings}

    described: dict[str, dict[str, Any]] = {}
    for setting_id, setting in settings.items():
        entry: dict[str, Any] = {
            "value": _plain(READERS[setting_id]()),
            "default": defaults[setting_id],
            "overridden": setting["env"] in saved,
        }
        if setting["kind"] in ("choice", "set"):
            entry["options"] = options(setting)
        described[setting_id] = entry

    ready, reason = separation_presets.remote_status()
    return {"settings": described, "cloud": {"ready": ready, "reason": reason}}
