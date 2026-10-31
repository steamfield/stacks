"""Loading the sales CSV with an explicit schema: the only module that opens files."""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

import polars as pl
import structlog

from package_name.errors import AppError, ErrorCode

if TYPE_CHECKING:
    from pathlib import Path

SALES_SCHEMA: Final = pl.Schema(
    {
        "order_id": pl.String(),
        "ordered_on": pl.Date(),
        "region": pl.String(),
        "product": pl.String(),
        "units": pl.Int64(),
        "unit_price": pl.Float64(),
    }
)

log = structlog.get_logger(__name__)


def load_sales(path: Path) -> pl.DataFrame:
    """Read the sales file with SALES_SCHEMA and add `revenue`. Nothing is inferred from the data."""
    if not path.is_file():
        raise AppError(
            ErrorCode.DATA_MISSING,
            f"no data file at {path}",
            "Put the CSV there, or point the DATA_PATH setting at it.",
        )
    header = tuple(pl.read_csv(path, n_rows=0, infer_schema=False).columns)
    if header != tuple(SALES_SCHEMA.names()):
        raise AppError(
            ErrorCode.DATA_SCHEMA,
            f"{path.name} has columns {', '.join(header)}",
            f"Expected {', '.join(SALES_SCHEMA.names())}, in that order.",
        )
    try:
        frame = pl.read_csv(path, schema=SALES_SCHEMA)
    except pl.exceptions.PolarsError as error:
        raise AppError(
            ErrorCode.DATA_SCHEMA,
            f"{path.name} has a value that doesn't fit its column's type",
            "Fix the row, or change SALES_SCHEMA and the tests together.",
        ) from error
    log.info("sales loaded", path=str(path), rows=frame.height)
    return frame.with_columns(revenue=pl.col("units") * pl.col("unit_price"))
