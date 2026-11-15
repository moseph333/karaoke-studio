"""Log output for the app's own modules.

Uvicorn configures only its own loggers, so without this the `karaoke_backend` logger and the
`backend.*` module loggers dropped everything below WARNING (render queueing, cloud wait times,
fallbacks). configure_logging() gives both one timestamped stderr handler at INFO, or at
LOG_LEVEL when that names a level. Its formatter escapes control characters in messages, so
text from a request cannot forge extra log lines, and lines written while a request is
handled carry its id.
"""

import logging
import os
import re
from contextvars import ContextVar

APP_LOGGERS = ("karaoke_backend", "backend")
_FORMAT = "%(asctime)s %(levelname)s %(name)s%(request_tag)s: %(message)s"

# The id of the request being handled (middleware.RequestContext), so the lines one request
# writes can be found together. Background jobs a request starts keep it, since Starlette
# runs them in the request's context and the job threads copy it.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


class RequestIdFilter(logging.Filter):
    """Adds request_tag (" [req=<id>]", or "" outside a request) to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        request_id = request_id_var.get()
        record.request_tag = f" [req={request_id}]" if request_id else ""
        return True


# Control characters other than tab. A message carries text from requests (usernames, song
# titles, search queries); a newline in one could otherwise start a forged log line.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0a-\x1f\x7f]")


def _escape_control(match: re.Match[str]) -> str:
    char = match.group(0)
    return {"\n": "\\n", "\r": "\\r"}.get(char, f"\\x{ord(char):02x}")


class SafeFormatter(logging.Formatter):
    """Escapes control characters in the message, so each record stays one line. The
    traceback and stack text that follow it keep their line breaks."""

    def formatMessage(self, record: logging.LogRecord) -> str:
        record.message = _CONTROL_CHARS.sub(_escape_control, record.message)
        return super().formatMessage(record)


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
            handler.setFormatter(SafeFormatter(_FORMAT))
            handler.addFilter(RequestIdFilter())
            handler.karaoke_app_handler = True  # type: ignore[attr-defined]
        logger.addHandler(handler)
