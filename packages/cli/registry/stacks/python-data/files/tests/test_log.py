import json

import pytest
import structlog

from package_name.log import configure_logging


def test_logs_go_to_stderr_at_the_configured_level(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(level="warning", fmt="console")
    logger = structlog.get_logger()
    logger.info("hidden")
    logger.warning("shown")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "shown" in captured.err
    assert "hidden" not in captured.err


def test_json_records(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(level="debug", fmt="json")
    structlog.get_logger().debug("loaded", rows=3)
    record = json.loads(capsys.readouterr().err)
    assert record["event"] == "loaded"
    assert record["level"] == "debug"
    assert record["rows"] == 3
    assert record["timestamp"].endswith("Z")
