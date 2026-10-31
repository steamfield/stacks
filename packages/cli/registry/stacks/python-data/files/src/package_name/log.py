"""structlog to stderr, readable or JSON lines, so stdout carries only the command's result."""

from __future__ import annotations

import logging
import sys
from typing import TYPE_CHECKING, Literal

import structlog

if TYPE_CHECKING:
    from structlog.typing import Processor

LogLevel = Literal["debug", "info", "warning", "error"]
LogFormat = Literal["console", "json"]


def configure_logging(*, level: LogLevel, fmt: LogFormat) -> None:
    processors: list[Processor] = [
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
    ]
    if fmt == "json":
        processors += [structlog.processors.dict_tracebacks, structlog.processors.JSONRenderer()]
    else:
        processors.append(
            structlog.dev.ConsoleRenderer(
                colors=False, exception_formatter=structlog.dev.plain_traceback
            )
        )
    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
        # Reconfigured on every run, so the stream is whatever sys.stderr is then (tests swap it).
        logger_factory=structlog.PrintLoggerFactory(sys.stderr),
        cache_logger_on_first_use=False,
    )
