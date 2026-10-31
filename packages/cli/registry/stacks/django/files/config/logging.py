"""structlog over the standard library, so Django's own log records share one format.

Settings pass `logging_config(...)` to Django as LOGGING; `core.apps.CoreConfig.ready` calls
`configure_structlog()` once at startup.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import structlog

if TYPE_CHECKING:
    from structlog.typing import Processor

# Applied to structlog events and to plain logging records (Django, gunicorn) alike.
SHARED: list[Processor] = [
    structlog.contextvars.merge_contextvars,
    structlog.stdlib.add_log_level,
    structlog.stdlib.add_logger_name,
    structlog.processors.TimeStamper(fmt="iso", utc=True),
]


def logging_config(level: str, *, json: bool) -> dict[str, Any]:
    renderer: list[Processor] = (
        [
            # Class and frames only: locals can hold secrets.
            structlog.processors.ExceptionRenderer(
                structlog.tracebacks.ExceptionDictTransformer(show_locals=False)
            ),
            structlog.processors.JSONRenderer(),
        ]
        if json
        else [structlog.dev.ConsoleRenderer(colors=False)]
    )
    return {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "structlog": {
                "()": structlog.stdlib.ProcessorFormatter,
                "foreign_pre_chain": SHARED,
                "processors": [
                    structlog.stdlib.ProcessorFormatter.remove_processors_meta,
                    *renderer,
                ],
            },
        },
        "handlers": {
            "stdout": {
                "class": "logging.StreamHandler",
                "stream": "ext://sys.stdout",
                "formatter": "structlog",
            },
        },
        "root": {"handlers": ["stdout"], "level": level},
        "loggers": {
            # Replace Django's default handlers so each record is written once, by the root.
            "django": {"handlers": [], "level": level, "propagate": True},
            # RequestLogMiddleware logs every request; keep django.request for 5xx tracebacks.
            "django.request": {"handlers": [], "level": "ERROR", "propagate": True},
        },
    }


def configure_structlog() -> None:
    structlog.configure(
        processors=[
            structlog.stdlib.filter_by_level,
            *SHARED,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        # structlog.testing.capture_logs needs uncached loggers.
        cache_logger_on_first_use=False,
    )
