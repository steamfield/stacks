from __future__ import annotations

from datetime import date
from decimal import Decimal

import polars as pl
from polars.testing import assert_frame_equal

from package_name.metrics import (
    Filters,
    Summary,
    apply_filters,
    format_money,
    options,
    revenue_by_month,
    summarize,
)

MONEY = pl.Decimal(38, 2)


def test_options_are_sorted_distinct_values(sales: pl.DataFrame) -> None:
    assert options(sales, "region") == ["East", "North", "South", "West"]
    assert options(sales, "product") == ["Gadget", "Gizmo", "Widget"]


def test_no_filter_keeps_every_order(sales: pl.DataFrame) -> None:
    every = apply_filters(sales, Filters())
    assert summarize(every) == Summary(revenue=Decimal("1400.00"), orders=24, units=71)


def test_region_filter(sales: pl.DataFrame) -> None:
    north = apply_filters(sales, Filters(regions=("North",)))
    assert summarize(north) == Summary(revenue=Decimal("380.00"), orders=6, units=20)


def test_filters_combine(sales: pl.DataFrame) -> None:
    selected = apply_filters(sales, Filters(regions=("North", "West"), products=("Gizmo",)))
    assert selected.get_column("order_id").to_list() == ["1004", "1009", "1012", "1021", "1024"]
    assert summarize(selected) == Summary(revenue=Decimal("320.00"), orders=5, units=8)


def test_summary_of_nothing_is_zero(sales: pl.DataFrame) -> None:
    assert summarize(sales.clear()) == Summary(revenue=Decimal(0), orders=0, units=0)


def test_revenue_by_month_sums_per_region() -> None:
    frame = pl.DataFrame(
        {
            "ordered_on": [date(2025, 1, 5), date(2025, 1, 20), date(2025, 2, 1), date(2025, 1, 9)],
            "region": ["North", "North", "North", "South"],
            "revenue": [Decimal("10.10"), Decimal("5.20"), Decimal("7.00"), Decimal("2.00")],
        },
        schema_overrides={"revenue": MONEY},
    )
    expected = pl.DataFrame(
        {
            "month": [date(2025, 1, 1), date(2025, 1, 1), date(2025, 2, 1)],
            "region": ["North", "South", "North"],
            "revenue": [Decimal("15.30"), Decimal("2.00"), Decimal("7.00")],
        },
        schema_overrides={"revenue": MONEY},
    )
    assert_frame_equal(revenue_by_month(frame), expected)


def test_format_money() -> None:
    assert format_money(Decimal("1400")) == "$1,400.00"
    assert format_money(Decimal("0.5")) == "$0.50"
