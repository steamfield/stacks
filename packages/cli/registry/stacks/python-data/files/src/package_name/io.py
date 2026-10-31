"""Reading raw CSV with an explicit schema and writing Parquet: the only module that opens files."""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

import polars as pl

from package_name.errors import ErrorCode, PipelineError

if TYPE_CHECKING:
    from collections.abc import Sequence
    from pathlib import Path

ORDER_COLUMNS: Final = ("order_id", "ordered_at", "region", "product", "quantity", "unit_price")
# Every raw column is read as text, so a bad value becomes a reject with a reason in
# transform.py instead of failing the whole read. Nothing is inferred.
RAW_SCHEMA: Final = pl.Schema(dict.fromkeys(ORDER_COLUMNS, pl.String()))


def csv_files(path: Path) -> list[Path]:
    """The CSV file at `path`, or every `*.csv` directly inside the directory `path`."""
    if path.is_file():
        return [path]
    files = sorted(path.glob("*.csv")) if path.is_dir() else []
    if not files:
        raise PipelineError(
            ErrorCode.INPUT,
            f"no CSV files at {path}",
            "Copy the raw CSV files into that directory, or pass --input with a file or directory.",
        )
    return files


def check_header(path: Path) -> None:
    """Fail before reading rows when a file's columns are not exactly ORDER_COLUMNS, in order."""
    try:
        header = tuple(pl.read_csv(path, n_rows=0, infer_schema=False).columns)
    except (OSError, pl.exceptions.PolarsError) as error:
        raise PipelineError(
            ErrorCode.INPUT,
            f"cannot read {path}",
            "Check the file is a readable CSV with a header.",
        ) from error
    if header != ORDER_COLUMNS:
        raise PipelineError(
            ErrorCode.SCHEMA,
            f"{path} has columns {', '.join(header)}; expected {', '.join(ORDER_COLUMNS)}",
            "Fix the file's header, or change ORDER_COLUMNS and the transforms together.",
        )


def scan_orders(paths: Sequence[Path]) -> pl.LazyFrame:
    """A lazy scan of the raw order files with RAW_SCHEMA. Nothing is read until collect."""
    for path in paths:
        check_header(path)
    return pl.scan_csv(list(paths), schema=RAW_SCHEMA)


def write_parquet(frame: pl.DataFrame, path: Path) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        frame.write_parquet(path)
    except OSError as error:
        raise PipelineError(
            ErrorCode.OUTPUT, f"cannot write {path}", "Check the output directory is writable."
        ) from error
