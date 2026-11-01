from __future__ import annotations

import polars as pl

from package_name.charts import revenue_chart
from package_name.metrics import revenue_by_month


def test_revenue_chart_stacks_monthly_revenue_by_region(sales: pl.DataFrame) -> None:
    spec = revenue_chart(revenue_by_month(sales)).to_dict()
    assert spec["mark"]["type"] == "bar"
    encoding = spec["encoding"]
    assert (encoding["x"]["field"], encoding["x"]["timeUnit"]) == ("month", "yearmonth")
    assert (encoding["y"]["field"], encoding["y"]["aggregate"]) == ("revenue", "sum")
    assert encoding["color"]["field"] == "region"
    rows = next(iter(spec["datasets"].values()))
    assert len(rows) == 24
    # Vega-Lite gets plain numbers; the package keeps revenue as a Decimal.
    assert all(isinstance(row["revenue"], float) for row in rows)
