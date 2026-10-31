from __future__ import annotations

import os
from pathlib import Path

import pytest

from package_name.config import ENV_PREFIX
from package_name.log import configure_logging

FIXTURES = Path(__file__).resolve().parents[1] / "data" / "fixtures"


@pytest.fixture
def orders_csv() -> Path:
    """The committed raw fixture, with its deliberate dirty rows."""
    return FIXTURES / "orders.csv"


@pytest.fixture
def expected_dir() -> Path:
    """The expected output of the pipeline on orders_csv, one CSV per Parquet output."""
    return FIXTURES / "expected"


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test runs in an empty directory (so no .env is read) with none of the variables."""
    for name in list(os.environ):
        if name.startswith(ENV_PREFIX):
            monkeypatch.delenv(name)
    monkeypatch.chdir(tmp_path)
    # structlog keeps the stream it was configured with; give each test its own stderr.
    configure_logging(level="warning", fmt="console")
