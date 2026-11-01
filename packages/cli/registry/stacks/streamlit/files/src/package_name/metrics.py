"""Pure functions from a sales frame to what the page shows. No Streamlit and no file access."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

import polars as pl


@dataclass(frozen=True)
class Filters:
    """The sidebar's choices. An empty tuple means no filter on that column."""

    regions: tuple[str, ...] = ()
    products: tuple[str, ...] = ()


@dataclass(frozen=True)
class Summary:
    revenue: Decimal
    orders: int
    units: int


def options(frame: pl.DataFrame, column: str) -> list[str]:
    """The distinct values of a text column, sorted, for a filter widget."""
    return sorted(frame.get_column(column).unique().to_list())


def apply_filters(frame: pl.DataFrame, filters: Filters) -> pl.DataFrame:
    condition = pl.lit(value=True)
    if filters.regions:
        condition &= pl.col("region").is_in(filters.regions)
    if filters.products:
        condition &= pl.col("product").is_in(filters.products)
    return frame.filter(condition)


def summarize(frame: pl.DataFrame) -> Summary:
    revenue = frame.get_column("revenue").sum()
    return Summary(
        revenue=revenue if isinstance(revenue, Decimal) else Decimal(0),
        orders=frame.height,
        units=int(frame.get_column("units").sum()),
    )


def revenue_by_month(frame: pl.DataFrame) -> pl.DataFrame:
    """Revenue per calendar month and region, sorted, with one row per pair that has sales."""
    return (
        frame.group_by(pl.col("ordered_on").dt.truncate("1mo").alias("month"), "region")
        .agg(pl.col("revenue").sum())
        .sort("month", "region")
    )


def format_money(amount: Decimal) -> str:
    return f"${amount:,.2f}"
