from __future__ import annotations

from typing import TYPE_CHECKING

import polars as pl
import pytest

from package_name.errors import ErrorCode, PipelineError
from package_name.io import RAW_SCHEMA, csv_files, scan_orders, write_parquet

if TYPE_CHECKING:
    from pathlib import Path

HEADER = "order_id,ordered_at,region,product,quantity,unit_price\n"


def test_a_directory_yields_its_csv_files_in_order(tmp_path: Path) -> None:
    for name in ("b.csv", "a.csv", "notes.txt"):
        (tmp_path / name).write_text(HEADER)
    assert [path.name for path in csv_files(tmp_path)] == ["a.csv", "b.csv"]


def test_missing_input_is_an_input_error(tmp_path: Path) -> None:
    with pytest.raises(PipelineError) as raised:
        csv_files(tmp_path / "absent")
    assert raised.value.code is ErrorCode.INPUT
    assert raised.value.exit_code == 4


def test_scan_reads_every_column_as_text(tmp_path: Path) -> None:
    source = tmp_path / "orders.csv"
    source.write_text(HEADER + "1,2026-01-01,east,pen,2,1.25\n")
    frame = scan_orders([source]).collect()
    assert frame.schema == RAW_SCHEMA
    assert frame.row(0) == ("1", "2026-01-01", "east", "pen", "2", "1.25")


def test_a_wrong_header_is_a_schema_error(tmp_path: Path) -> None:
    source = tmp_path / "orders.csv"
    source.write_text("id,date,region\n1,2026-01-01,east\n")
    with pytest.raises(PipelineError) as raised:
        scan_orders([source])
    assert raised.value.code is ErrorCode.SCHEMA
    assert "expected order_id" in raised.value.message


def test_an_empty_file_is_an_input_error(tmp_path: Path) -> None:
    source = tmp_path / "orders.csv"
    source.write_text("")
    with pytest.raises(PipelineError) as raised:
        scan_orders([source])
    assert raised.value.code is ErrorCode.INPUT


def test_write_parquet_creates_the_directory(tmp_path: Path) -> None:
    target = tmp_path / "out" / "frame.parquet"
    write_parquet(pl.DataFrame({"a": [1]}), target)
    assert pl.read_parquet(target)["a"].to_list() == [1]


def test_an_unwritable_target_is_an_output_error(tmp_path: Path) -> None:
    blocker = tmp_path / "file"
    blocker.write_text("")
    with pytest.raises(PipelineError) as raised:
        write_parquet(pl.DataFrame({"a": [1]}), blocker / "frame.parquet")
    assert raised.value.code is ErrorCode.OUTPUT
