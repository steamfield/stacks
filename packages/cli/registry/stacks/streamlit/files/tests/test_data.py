from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

import polars as pl
import pytest

from package_name.data import SALES_SCHEMA, load_sales
from package_name.errors import AppError, ErrorCode

if TYPE_CHECKING:
    from pathlib import Path

HEADER = ",".join(SALES_SCHEMA.names())


def test_sample_loads_with_the_declared_types_and_revenue(sales: pl.DataFrame) -> None:
    assert sales.schema == pl.Schema({**SALES_SCHEMA, "revenue": pl.Decimal(38, 2)})
    assert sales.height == 24
    first = sales.row(0, named=True)
    assert first["ordered_on"] == date(2025, 1, 5)
    assert first["revenue"] == Decimal("30.00")


def test_missing_file(tmp_path: Path) -> None:
    with pytest.raises(AppError) as raised:
        load_sales(tmp_path / "absent.csv")
    assert raised.value.code is ErrorCode.DATA_MISSING


def test_an_empty_file_is_a_schema_error(tmp_path: Path) -> None:
    path = tmp_path / "sales.csv"
    path.write_bytes(b"")
    with pytest.raises(AppError) as raised:
        load_sales(path)
    assert raised.value.code is ErrorCode.DATA_SCHEMA


def test_wrong_columns(tmp_path: Path) -> None:
    path = tmp_path / "sales.csv"
    path.write_text("id,day\n1,2025-01-01\n")
    with pytest.raises(AppError) as raised:
        load_sales(path)
    assert raised.value.code is ErrorCode.DATA_SCHEMA
    assert "id, day" in raised.value.message


def test_value_that_does_not_parse(tmp_path: Path) -> None:
    path = tmp_path / "sales.csv"
    path.write_text(f"{HEADER}\n1,2025-01-01,North,Widget,three,10.00\n")
    with pytest.raises(AppError) as raised:
        load_sales(path)
    assert raised.value.code is ErrorCode.DATA_SCHEMA


def test_an_empty_cell_is_a_schema_error(tmp_path: Path) -> None:
    path = tmp_path / "sales.csv"
    path.write_text(f"{HEADER}\n1,2025-01-01,North,Widget,3,10.00\n2,2025-01-02,,Gizmo,1,40.00\n")
    with pytest.raises(AppError) as raised:
        load_sales(path)
    assert raised.value.code is ErrorCode.DATA_SCHEMA
    assert "region" in raised.value.message


def test_prices_stay_exact(tmp_path: Path) -> None:
    path = tmp_path / "sales.csv"
    rows = "".join(f"{n},2025-01-01,North,Widget,1,0.10\n" for n in range(3))
    path.write_text(f"{HEADER}\n{rows}")
    assert load_sales(path).get_column("revenue").sum() == Decimal("0.30")
