"""Log output for the app's own modules.

Uvicorn configures only its own loggers, so without this the `karaoke_backend` logger and the
`backend.*` module loggers dropped everything below WARNING (render queueing, cloud wait times,
fallbacks). configure_logging() gives both one timestamped stderr handler at INFO, or at
LOG_LEVEL when that names a level.
"""

import logging
import os

APP_LOGGERS = ("karaoke_backend", "backend")
_FORMAT = "%(asctime)s %(levelname)s %(name)s: %(message)s"


def _level() -> int:
    level = logging.getLevelName((os.getenv("LOG_LEVEL") or "INFO").strip().upper())
    return level if isinstance(level, int) else logging.INFO


def configure_logging() -> None:
    """Set up the app loggers once; calling it again only re-applies the level."""
    level = _level()
    handler: logging.Handler | None = None
    for name in APP_LOGGERS:
        logger = logging.getLogger(name)
        logger.setLevel(level)
        if any(getattr(h, "karaoke_app_handler", False) for h in logger.handlers):
            continue
        if handler is None:
            handler = logging.StreamHandler()
            handler.setFormatter(logging.Formatter(_FORMAT))
            handler.karaoke_app_handler = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
