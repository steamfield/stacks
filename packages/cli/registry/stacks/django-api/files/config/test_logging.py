import json
import logging
import sys

from config.logging import logging_config


def render(*, json_output: bool, exc_info: bool = False) -> str:
    spec = dict(logging_config("INFO", json=json_output)["formatters"]["structlog"])
    formatter: logging.Formatter = spec.pop("()")(**spec)
    try:
        raise RuntimeError("secret value")
    except RuntimeError:
        info = sys.exc_info() if exc_info else None
        record = logging.LogRecord(
            "django.request", logging.ERROR, __file__, 1, "Internal Server Error", None, info
        )
    return formatter.format(record)


def test_production_records_are_json_lines() -> None:
    record = json.loads(render(json_output=True))
    assert record["event"] == "Internal Server Error"
    assert record["level"] == "error"
    assert record["logger"] == "django.request"
    assert record["timestamp"].endswith("Z")


def test_json_tracebacks_carry_frames_but_no_message_or_locals() -> None:
    line = render(json_output=True, exc_info=True)
    (error,) = json.loads(line)["exception"]
    assert error["exc_type"] == "RuntimeError"
    assert error["frames"]
    assert all("locals" not in frame for frame in error["frames"])
    assert "secret value" not in line


def test_development_records_are_readable() -> None:
    line = render(json_output=False)
    assert "Internal Server Error" in line
    assert "\x1b" not in line
