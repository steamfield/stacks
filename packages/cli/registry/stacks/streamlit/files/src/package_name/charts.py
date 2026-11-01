"""Altair chart specs built from metric frames. Streamlit only renders them."""

from __future__ import annotations

import altair as alt
import polars as pl


def revenue_chart(monthly: pl.DataFrame) -> alt.Chart:
    """Stacked monthly revenue bars, one color per region, from `metrics.revenue_by_month`."""
    # Vega-Lite takes floats; the Decimal stays exact everywhere but the drawing.
    drawn = monthly.with_columns(pl.col("revenue").cast(pl.Float64))
    # Altair's mark_* methods are typed as returning Any; the annotation restores the type.
    chart: alt.Chart = (
        alt.Chart(drawn)
        .mark_bar()
        .encode(
            x=alt.X("yearmonth(month):O", title="Month"),
            y=alt.Y("sum(revenue):Q", title="Revenue"),
            color=alt.Color("region:N", title="Region"),
            tooltip=[
                alt.Tooltip("yearmonth(month):O", title="Month"),
                alt.Tooltip("region:N", title="Region"),
                alt.Tooltip("sum(revenue):Q", title="Revenue", format="$,.2f"),
            ],
        )
    )
    return chart
