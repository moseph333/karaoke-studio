"""Text from a request cannot forge log lines: the app's formatter escapes control
characters in messages but keeps tracebacks readable."""

import logging

from backend.logging_setup import APP_LOGGERS, SafeFormatter, configure_logging


def _record(msg: str, *args, exc_info=None) -> logging.LogRecord:
    return logging.LogRecord("karaoke_backend", logging.WARNING, __file__, 1, msg, args, exc_info)


def test_newlines_in_a_message_stay_on_one_line():
    formatter = SafeFormatter("%(levelname)s %(message)s")
    line = formatter.format(_record("Failed login for %s", "eve\nINFO Signed in user admin"))
    assert line == "WARNING Failed login for eve\\nINFO Signed in user admin"
    assert "\n" not in line


def test_other_control_characters_are_escaped_and_tabs_kept():
    formatter = SafeFormatter("%(message)s")
    assert formatter.format(_record("a\rb\x1b[31mc\td\x7f")) == "a\\rb\\x1b[31mc\td\\x7f"


def test_tracebacks_keep_their_line_breaks():
    formatter = SafeFormatter("%(message)s")
    try:
        raise ValueError("boom")
    except ValueError:
        import sys

        line = formatter.format(_record("job failed", exc_info=sys.exc_info()))
    first, *rest = line.split("\n")
    assert first == "job failed"
    assert rest[0].startswith("Traceback")
    assert rest[-1] == "ValueError: boom"


def test_the_app_handler_uses_it():
    configure_logging()
    for name in APP_LOGGERS:
        handlers = [
            h for h in logging.getLogger(name).handlers if getattr(h, "karaoke_app_handler", False)
        ]
        assert handlers and isinstance(handlers[0].formatter, SafeFormatter)
