from __future__ import annotations

from datetime import date

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


def test_options_are_sorted_distinct_values(sales: pl.DataFrame) -> None:
    assert options(sales, "region") == ["East", "North", "South", "West"]
    assert options(sales, "product") == ["Gadget", "Gizmo", "Widget"]


def test_no_filter_keeps_every_order(sales: pl.DataFrame) -> None:
    every = apply_filters(sales, Filters())
    assert summarize(every) == Summary(revenue=1400.0, orders=24, units=71)


def test_region_filter(sales: pl.DataFrame) -> None:
    north = apply_filters(sales, Filters(regions=("North",)))
    assert summarize(north) == Summary(revenue=380.0, orders=6, units=20)


def test_filters_combine(sales: pl.DataFrame) -> None:
    selected = apply_filters(sales, Filters(regions=("North", "West"), products=("Gizmo",)))
    assert selected.get_column("order_id").to_list() == ["1004", "1009", "1012", "1021", "1024"]
    assert summarize(selected) == Summary(revenue=320.0, orders=5, units=8)


def test_summary_of_nothing_is_zero(sales: pl.DataFrame) -> None:
    assert summarize(sales.clear()) == Summary(revenue=0.0, orders=0, units=0)


def test_revenue_by_month_sums_per_region() -> None:
    frame = pl.DataFrame(
        {
            "ordered_on": [date(2025, 1, 5), date(2025, 1, 20), date(2025, 2, 1), date(2025, 1, 9)],
            "region": ["North", "North", "North", "South"],
            "revenue": [10.0, 5.0, 7.0, 2.0],
        }
    )
    expected = pl.DataFrame(
        {
            "month": [date(2025, 1, 1), date(2025, 1, 1), date(2025, 2, 1)],
            "region": ["North", "South", "North"],
            "revenue": [15.0, 2.0, 7.0],
        }
    )
    assert_frame_equal(revenue_by_month(frame), expected)


def test_format_money() -> None:
    assert format_money(1400) == "$1,400.00"
    assert format_money(0.5) == "$0.50"
