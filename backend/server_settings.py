"""Options the owner saved on the Server settings page, laid over the environment.

A saved option is the value its environment variable would have, kept in ``settings.json`` in
the data folder (``{"version": 1, "env": {"SONG_LOOP_MODELS": "ltx"}}``), so the code that reads
the variable parses a saved value exactly as it parses one from ``.env``. Those readers call
``env(name)`` instead of ``os.getenv(name)``: the saved value if there is one (an empty one
counts: that is how "off" is saved), else the environment's. Removing a saved value puts the
environment back in charge. Which options the page offers, and what it accepts for each, is in
``services/admin_settings``.

The file is read once per data folder and kept in memory (the server is a single process), so
a save takes effect at once and nothing needs a restart.

Nothing from the app is imported at import time: RoFormer's worker imports
``separation_presets``, which imports this, on machines with neither FastAPI nor a data folder.
"""

import json
import logging
import os
import threading
from pathlib import Path

logger = logging.getLogger("karaoke_backend")

SETTINGS_FILE_NAME = "settings.json"
BACKUP_FILE_NAME = "settings.json.bak"
FILE_VERSION = 1

_lock = threading.RLock()
# Saved values by settings file path: tests give every test its own data folder
_saved: dict[str, dict[str, str]] = {}


def settings_file() -> Path:
    from backend import config

    return Path(config.DATA_DIR) / SETTINGS_FILE_NAME


def _read(path: Path) -> dict[str, str]:
    """The saved values in the file, else in its backup, else none."""
    for candidate in (path, path.with_name(BACKUP_FILE_NAME)):
        try:
            data = json.loads(candidate.read_text(encoding="utf-8"))
        except FileNotFoundError:
            continue
        except (OSError, ValueError) as exc:
            logger.error(f"Could not read {candidate}: {exc}")
            continue
        values = data.get("env") if isinstance(data, dict) else None
        if isinstance(values, dict):
            if candidate != path:
                logger.info(f"Recovered the server settings from {candidate.name}")
            return {k: v for k, v in values.items() if isinstance(k, str) and isinstance(v, str)}
        logger.error(f"{candidate} does not hold server settings; ignoring it")
    return {}


def _current() -> dict[str, str]:
    path = settings_file()
    key = str(path)
    with _lock:
        values = _saved.get(key)
        if values is None:
            values = _saved[key] = _read(path)
        return values


def saved() -> dict[str, str]:
    """Every saved value, by the environment variable it stands in for."""
    return dict(_current())


def env(name: str, default: str | None = None) -> str | None:
    """What ``os.getenv(name, default)`` gives, unless the owner saved a value for it."""
    value = _current().get(name)
    return value if value is not None else os.getenv(name, default)


def save(values: dict[str, str]) -> None:
    """Replaces the saved values, on disk first and then in memory. Raises what the disk
    raised (an OSError when it is full), leaving both as they were."""
    from backend.project_store import write_text_atomically

    path = settings_file()
    clean = {str(k): str(v) for k, v in values.items()}
    text = json.dumps({"version": FILE_VERSION, "env": clean}, indent=2, sort_keys=True) + "\n"
    with _lock:
        write_text_atomically(path, text, backup=path.with_name(BACKUP_FILE_NAME))
        _saved[str(path)] = clean


def reset_cache() -> None:
    """Forgets what was read, so the next call reads the file again (tests)."""
    with _lock:
        _saved.clear()


# --- Options config.py parses once at import ---
#
# Their readers used the module attribute (which tests replace), so each has a function here:
# the saved value parsed by config's own parser, else the attribute as it stands.


def max_song_minutes() -> int:
    """MAX_SONG_MINUTES: the longest recording a link may download; 0 is no limit."""
    from backend import config

    raw = _current().get("MAX_SONG_MINUTES")
    return config.MAX_SONG_MINUTES if raw is None else config._max_song_minutes(raw)


def max_album_minutes() -> int:
    """MAX_ALBUM_MINUTES: the longest album recording a link may download; 0 is no limit."""
    from backend import config

    raw = _current().get("MAX_ALBUM_MINUTES")
    return config.MAX_ALBUM_MINUTES if raw is None else config._max_album_minutes(raw)


def song_search_sources() -> tuple[str, ...]:
    """SONG_SEARCH_SOURCES: the services the song search asks."""
    from backend import config

    raw = _current().get("SONG_SEARCH_SOURCES")
    return config.SONG_SEARCH_SOURCES if raw is None else config._song_search_sources(raw)
