"""Pure transforms, LazyFrame in and LazyFrame out. No I/O and no collect() here.

The cleaning rules are documented in docs/data-contract.md; a rule changes there and here
together, with a test in tests/test_transform.py.
"""

from __future__ import annotations

from typing import Final

import polars as pl

ORDER_SCHEMA: Final = pl.Schema(
    {
        "order_id": pl.Int64(),
        "ordered_at": pl.Date(),
        "region": pl.String(),
        "product": pl.String(),
        "quantity": pl.Int64(),
        "unit_price": pl.Decimal(10, 2),
    }
)


def _text(name: str) -> pl.Expr:
    """The column's text with surrounding whitespace removed; empty text becomes null."""
    value = pl.col(name).str.strip_chars()
    return pl.when(value != "").then(value)


# One parsing expression per raw column. A value that doesn't parse becomes null, and
# reject_reason() names the first such problem in each row.
PARSED: Final[dict[str, pl.Expr]] = {
    "order_id": _text("order_id").cast(pl.Int64, strict=False),
    "ordered_at": _text("ordered_at").str.to_date("%Y-%m-%d", strict=False),
    "region": _text("region").str.to_lowercase(),
    "product": _text("product").str.to_lowercase(),
    "quantity": _text("quantity").cast(pl.Int64, strict=False),
    "unit_price": _text("unit_price").cast(pl.Decimal(10, 2), strict=False),
}


def reject_reason() -> pl.Expr:
    """Why a raw row is rejected, or null when it is valid."""
    parsed = PARSED
    return (
        pl.when(parsed["order_id"].is_null())
        .then(pl.lit("order_id is missing or not a whole number"))
        .when(parsed["ordered_at"].is_null())
        .then(pl.lit("ordered_at is missing or not a YYYY-MM-DD date"))
        .when(parsed["region"].is_null())
        .then(pl.lit("region is missing"))
        .when(parsed["product"].is_null())
        .then(pl.lit("product is missing"))
        .when(parsed["quantity"].is_null() | (parsed["quantity"] <= 0))
        .then(pl.lit("quantity is missing or not a positive whole number"))
        .when(parsed["unit_price"].is_null() | (parsed["unit_price"] < 0))
        .then(pl.lit("unit_price is missing, not a number or negative"))
        .alias("reject_reason")
    )


def clean(raw: pl.LazyFrame) -> pl.LazyFrame:
    """Valid orders with ORDER_SCHEMA types. A repeated order_id keeps its first row."""
    return (
        raw.filter(reject_reason().is_null())
        .select(**PARSED)
        .unique(subset="order_id", keep="first", maintain_order=True)
    )


def rejects(raw: pl.LazyFrame) -> pl.LazyFrame:
    """Rejected rows as they arrived, as text, with a reject_reason column."""
    return raw.with_columns(reject_reason()).filter(pl.col("reject_reason").is_not_null())


def revenue_by_region(orders: pl.LazyFrame) -> pl.LazyFrame:
    """Order count, units and revenue per region, sorted by region."""
    return (
        orders.group_by("region")
        .agg(
            orders=pl.len(),
            units=pl.col("quantity").sum(),
            revenue=(pl.col("quantity") * pl.col("unit_price")).sum(),
        )
        .sort("region")
    )
