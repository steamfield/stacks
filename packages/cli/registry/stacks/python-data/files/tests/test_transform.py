from __future__ import annotations

from datetime import date
from decimal import Decimal

import polars as pl
from polars.testing import assert_frame_equal

from package_name.io import RAW_SCHEMA
from package_name.transform import ORDER_SCHEMA, clean, rejects, revenue_by_region


def raw(*rows: tuple[str | None, ...]) -> pl.LazyFrame:
    return pl.LazyFrame(rows, schema=RAW_SCHEMA, orient="row")


def orders(*rows: tuple[object, ...]) -> pl.LazyFrame:
    return pl.LazyFrame(rows, schema=ORDER_SCHEMA, orient="row")


def test_clean_parses_types_and_normalizes_text() -> None:
    result = clean(raw(("7", " 2026-02-01 ", "  North ", "Pen", "3", "1.5"))).collect()
    expected = orders((7, date(2026, 2, 1), "north", "pen", 3, Decimal("1.50"))).collect()
    assert_frame_equal(result, expected)


def test_clean_keeps_the_first_row_of_a_repeated_order_id() -> None:
    result = clean(
        raw(
            ("1", "2026-01-01", "east", "pen", "1", "1.00"),
            ("2", "2026-01-01", "west", "pen", "1", "1.00"),
            ("1", "2026-01-02", "east", "pen", "9", "9.00"),
        )
    ).collect()
    assert result["order_id"].to_list() == [1, 2]
    assert result["quantity"].to_list() == [1, 1]


def test_rejects_keep_the_raw_text_and_name_the_first_problem() -> None:
    frame = raw(
        ("x", "2026-01-01", "east", "pen", "1", "1.00"),
        ("2", "2026-02-30", "east", "pen", "1", "1.00"),
        ("3", "2026-01-01", " ", "pen", "1", "1.00"),
        ("4", "2026-01-01", "east", None, "1", "1.00"),
        ("5", "2026-01-01", "east", "pen", "0", "1.00"),
        ("6", "2026-01-01", "east", "pen", "1", "-1"),
        ("7", "2026-01-01", "east", "pen", "1", "1.00"),
    )
    result = rejects(frame).collect()
    assert result["order_id"].to_list() == ["x", "2", "3", "4", "5", "6"]
    assert result["reject_reason"].to_list() == [
        "order_id is missing or not a whole number",
        "ordered_at is missing or not a YYYY-MM-DD date",
        "region is missing",
        "product is missing",
        "quantity is missing or not a positive whole number",
        "unit_price is missing, not a number or negative",
    ]
    assert clean(frame).collect()["order_id"].to_list() == [7]


def test_revenue_by_region_sums_units_and_revenue_per_region() -> None:
    result = revenue_by_region(
        orders(
            (1, date(2026, 1, 1), "west", "pen", 2, Decimal("1.25")),
            (2, date(2026, 1, 1), "east", "pen", 1, Decimal("4.00")),
            (3, date(2026, 1, 2), "west", "binder", 1, Decimal("6.75")),
        )
    ).collect()
    expected = pl.DataFrame(
        {
            "region": ["east", "west"],
            "orders": [1, 2],
            "units": [1, 3],
            "revenue": [Decimal("4.00"), Decimal("9.25")],
        },
        schema_overrides={"orders": pl.UInt32, "revenue": pl.Decimal(38, 2)},
    )
    assert_frame_equal(result, expected)


def test_transforms_stay_lazy() -> None:
    frame = raw(("1", "2026-01-01", "east", "pen", "1", "1.00"))
    assert isinstance(clean(frame), pl.LazyFrame)
    assert isinstance(rejects(frame), pl.LazyFrame)
    assert isinstance(revenue_by_region(clean(frame)), pl.LazyFrame)
