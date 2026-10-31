"""SQL over the pipeline's Parquet output with DuckDB. Results come back as Polars frames."""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

import duckdb

if TYPE_CHECKING:
    from pathlib import Path

    import polars as pl

# Values reach the query as parameters, never through string formatting. DuckDB sums
# integers as HUGEINT, which Polars receives as Decimal(38, 0), so units is cast back.
TOP_PRODUCTS_SQL: Final = """
SELECT product, CAST(sum(quantity) AS BIGINT) AS units, sum(quantity * unit_price) AS revenue
FROM read_parquet($orders)
GROUP BY product
ORDER BY revenue DESC, product
LIMIT $limit
"""


def top_products(orders: Path, *, limit: int) -> pl.DataFrame:
    """The `limit` products with the most revenue in the clean orders Parquet file."""
    with duckdb.connect() as connection:
        result: pl.DataFrame = connection.sql(
            TOP_PRODUCTS_SQL, params={"orders": str(orders), "limit": limit}
        ).pl()
    return result
