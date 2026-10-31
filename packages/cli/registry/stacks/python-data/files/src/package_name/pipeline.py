"""The pipeline: raw CSV through the transforms to Parquet, then one DuckDB query over the result."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Final

import polars as pl
import structlog

from package_name import io, queries, transform
from package_name.errors import ErrorCode, PipelineError

if TYPE_CHECKING:
    from pathlib import Path

OUTPUTS: Final = ("orders", "rejects", "revenue_by_region", "top_products")


@dataclass(frozen=True)
class PipelineResult:
    rows_read: int
    rows_clean: int
    rows_rejected: int
    duplicates: int
    outputs: dict[str, Path]


def run_pipeline(source: Path, output_dir: Path, *, top: int) -> PipelineResult:
    """Read every CSV at `source`, write OUTPUTS as Parquet files into `output_dir`."""
    log = structlog.get_logger()
    raw = io.scan_orders(io.csv_files(source))
    orders = transform.clean(raw)
    try:
        # One collect for every frame, so Polars reads the CSV once and shares the work.
        counted, clean, rejected, revenue = pl.collect_all(
            [
                raw.select(pl.len()),
                orders,
                transform.rejects(raw),
                transform.revenue_by_region(orders),
            ]
        )
    except pl.exceptions.PolarsError as error:
        raise PipelineError(
            ErrorCode.SCHEMA,
            f"cannot parse the CSV at {source}: {str(error).splitlines()[0]}",
            "Check no row has more fields than the header, and quotes are closed.",
        ) from error
    outputs = {name: output_dir / f"{name}.parquet" for name in OUTPUTS}
    io.write_parquet(clean, outputs["orders"])
    io.write_parquet(rejected, outputs["rejects"])
    io.write_parquet(revenue, outputs["revenue_by_region"])
    io.write_parquet(queries.top_products(outputs["orders"], limit=top), outputs["top_products"])
    rows_read = int(counted.item())
    result = PipelineResult(
        rows_read=rows_read,
        rows_clean=clean.height,
        rows_rejected=rejected.height,
        duplicates=rows_read - clean.height - rejected.height,
        outputs=outputs,
    )
    log.info(
        "pipeline finished",
        rows_read=result.rows_read,
        rows_clean=result.rows_clean,
        rows_rejected=result.rows_rejected,
        duplicates=result.duplicates,
    )
    return result
