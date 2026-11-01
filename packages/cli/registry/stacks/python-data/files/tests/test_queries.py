from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

import polars as pl

from package_name.queries import top_products
from package_name.transform import ORDER_SCHEMA

if TYPE_CHECKING:
    from pathlib import Path


def test_top_products_ranks_by_revenue_and_breaks_ties_by_name(tmp_path: Path) -> None:
    orders = tmp_path / "orders.parquet"
    pl.DataFrame(
        [
            (1, date(2026, 1, 1), "east", "pen", 4, Decimal("1.00")),
            (2, date(2026, 1, 1), "east", "binder", 1, Decimal("4.00")),
            (3, date(2026, 1, 1), "west", "stapler", 1, Decimal("9.00")),
            (4, date(2026, 1, 2), "west", "pen", 1, Decimal("1.00")),
        ],
        schema=ORDER_SCHEMA,
        orient="row",
    ).write_parquet(orders)

    result = top_products(orders, limit=2)

    assert result.schema == pl.Schema(
        {"product": pl.String(), "units": pl.Int64(), "revenue": pl.Decimal(38, 2)}
    )
    assert result.rows() == [("stapler", 1, Decimal("9.00")), ("pen", 5, Decimal("5.00"))]
