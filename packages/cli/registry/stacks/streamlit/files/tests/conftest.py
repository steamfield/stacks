from __future__ import annotations

import os
from pathlib import Path

import polars as pl
import pytest

from package_name.config import ENV_PREFIX
from package_name.data import load_sales
from package_name.log import configure_logging

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def sample_csv() -> Path:
    """The committed sample: 24 orders over six months, four regions and three products."""
    return ROOT / "data" / "sample.csv"


@pytest.fixture
def sales(sample_csv: Path) -> pl.DataFrame:
    return load_sales(sample_csv)


@pytest.fixture(autouse=True)
def isolated_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Each test runs in an empty directory (so no .env is read) with none of the variables."""
    for name in list(os.environ):
        if name.startswith(ENV_PREFIX):
            monkeypatch.delenv(name)
    monkeypatch.chdir(tmp_path)
    # structlog keeps the stream it was configured with; give each test its own stderr.
    configure_logging(level="warning", fmt="console")
