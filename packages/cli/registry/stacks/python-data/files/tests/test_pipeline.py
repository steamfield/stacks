from __future__ import annotations

from typing import TYPE_CHECKING

import polars as pl
import pytest

from package_name.compare import compare_outputs
from package_name.errors import ErrorCode, PipelineError
from package_name.pipeline import OUTPUTS, run_pipeline

if TYPE_CHECKING:
    from pathlib import Path


def test_the_fixture_produces_the_expected_outputs(
    tmp_path: Path, orders_csv: Path, expected_dir: Path
) -> None:
    result = run_pipeline(orders_csv, tmp_path, top=5)

    counts = (result.rows_read, result.rows_clean, result.rows_rejected, result.duplicates)
    assert counts == (20, 13, 6, 1)
    assert sorted(result.outputs) == sorted(OUTPUTS)
    assert compare_outputs(tmp_path, expected_dir) == []


def test_compare_reports_a_changed_value_and_a_missing_file(
    tmp_path: Path, orders_csv: Path, expected_dir: Path
) -> None:
    run_pipeline(orders_csv, tmp_path, top=5)
    revenue = pl.read_parquet(tmp_path / "revenue_by_region.parquet")
    revenue.with_columns(pl.col("units") + 1).write_parquet(tmp_path / "revenue_by_region.parquet")
    (tmp_path / "top_products.parquet").unlink()

    problems = compare_outputs(tmp_path, expected_dir)

    assert [problem.split(":")[0] for problem in problems] == ["revenue_by_region", "top_products"]


def test_compare_needs_expected_files(tmp_path: Path) -> None:
    with pytest.raises(PipelineError) as raised:
        compare_outputs(tmp_path, tmp_path)
    assert raised.value.code is ErrorCode.INPUT


def test_a_short_row_is_rejected(tmp_path: Path, orders_csv: Path) -> None:
    source = tmp_path / "orders.csv"
    source.write_text(orders_csv.read_text() + "1019,2026-01-16,west\n")
    result = run_pipeline(source, tmp_path / "out", top=5)
    rejected = pl.read_parquet(result.outputs["rejects"])
    assert rejected.filter(pl.col("order_id") == "1019")["reject_reason"].to_list() == [
        "product is missing"
    ]


def test_a_row_with_extra_fields_is_a_schema_error(tmp_path: Path, orders_csv: Path) -> None:
    source = tmp_path / "orders.csv"
    source.write_text(orders_csv.read_text() + "1019,2026-01-16,west,pen,1,1.00,extra\n")
    with pytest.raises(PipelineError) as raised:
        run_pipeline(source, tmp_path / "out", top=5)
    assert raised.value.code is ErrorCode.SCHEMA
