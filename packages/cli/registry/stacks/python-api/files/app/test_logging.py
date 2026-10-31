import json

import pytest
import structlog

from app.config import Settings
from app.logging import configure_logging


def test_production_is_json_and_filters_by_level(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(Settings(environment="production", log_level="WARNING"))
    logger = structlog.get_logger()
    logger.info("filtered")
    logger.warning("ready")
    record = json.loads(capsys.readouterr().out)
    assert record["event"] == "ready"
    assert record["level"] == "warning"
    assert record["timestamp"].endswith("Z")


def test_development_is_readable(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(Settings(environment="development"))
    structlog.get_logger().info("ready")
    output = capsys.readouterr().out
    assert "ready" in output
    assert "info" in output
    assert "\x1b" not in output
