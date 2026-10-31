import json

import pytest
import structlog

from package_name.log import configure_logging


def test_logs_go_to_stderr_at_warning_by_default(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(verbose=False, json=False)
    logger = structlog.get_logger()
    logger.info("hidden")
    logger.warning("shown")
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "shown" in captured.err
    assert "hidden" not in captured.err
    assert "\x1b" not in captured.err


def test_verbose_json_records(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(verbose=True, json=True)
    structlog.get_logger().debug("loaded", source="file")
    record = json.loads(capsys.readouterr().err)
    assert record["event"] == "loaded"
    assert record["level"] == "debug"
    assert record["source"] == "file"
    assert record["timestamp"].endswith("Z")
