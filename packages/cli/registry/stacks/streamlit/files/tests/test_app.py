"""The page, run in process by Streamlit's AppTest: no browser and no server."""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest
from streamlit.testing.v1 import AppTest

from package_name.config import ENV_PREFIX
from package_name.data import SALES_SCHEMA

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app.py"
# The first run imports Streamlit, Polars and Altair; give it more than AppTest's default.
TIMEOUT = 30


def run_page(monkeypatch: pytest.MonkeyPatch, data_path: Path) -> AppTest:
    monkeypatch.setenv(f"{ENV_PREFIX}DATA_PATH", str(data_path))
    return AppTest.from_file(str(APP), default_timeout=TIMEOUT).run()


def metric(page: AppTest, label: str) -> str:
    return next(str(item.value) for item in page.metric if item.label == label)


def test_page_shows_the_totals_for_every_order(
    sample_csv: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = run_page(monkeypatch, sample_csv)
    assert not page.exception
    assert metric(page, "Revenue") == "$1,400.00"
    assert metric(page, "Orders") == "24"
    assert page.multiselect(key="regions").options == ["East", "North", "South", "West"]
    # AppTest has no typed accessor for charts; get() finds them by element type.
    assert len(page.get("vega_lite_chart")) == 1
    assert len(page.dataframe) == 1


def test_filters_change_the_metrics(sample_csv: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    page = run_page(monkeypatch, sample_csv)
    page.multiselect(key="regions").select("North").run()
    assert not page.exception
    assert (metric(page, "Revenue"), metric(page, "Orders")) == ("$380.00", "6")
    page.multiselect(key="regions").select("West")
    page.multiselect(key="products").select("Gizmo").run()
    assert (metric(page, "Revenue"), metric(page, "Units")) == ("$320.00", "8")


def test_missing_data_shows_the_error_instead_of_a_traceback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    page = run_page(monkeypatch, tmp_path / "absent.csv")
    assert not page.exception
    assert "Data not found" in page.error[0].value
    assert not page.metric


def test_an_empty_file_shows_the_error_instead_of_a_traceback(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    path = tmp_path / "sales.csv"
    path.write_bytes(b"")
    page = run_page(monkeypatch, path)
    assert not page.exception
    assert "expected columns" in page.error[0].value
    assert not page.metric


def test_empty_data_says_nothing_matches(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "sales.csv"
    path.write_text(",".join(SALES_SCHEMA.names()) + "\n")
    page = run_page(monkeypatch, path)
    assert not page.exception
    assert metric(page, "Revenue") == "$0.00"
    assert "No orders match" in page.info[0].value


def test_server_config_is_headless_without_usage_stats_or_tracebacks() -> None:
    config = tomllib.loads((ROOT / ".streamlit" / "config.toml").read_text())
    assert config["server"]["headless"] is True
    assert config["browser"]["gatherUsageStats"] is False
    assert config["runner"]["magicEnabled"] is False
    # Viewers never see a traceback, which would show file paths and code.
    assert config["client"]["showErrorDetails"] == "none"
