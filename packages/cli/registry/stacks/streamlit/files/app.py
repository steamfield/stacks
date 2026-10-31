"""The Streamlit page: widgets and layout only. Every rule lives in the package, where tests reach it."""

from __future__ import annotations

from typing import TYPE_CHECKING

import streamlit as st

from package_name.charts import revenue_chart
from package_name.config import APP_TITLE, load_settings
from package_name.data import load_sales
from package_name.errors import AppError
from package_name.log import configure_logging
from package_name.metrics import (
    Filters,
    apply_filters,
    format_money,
    options,
    revenue_by_month,
    summarize,
)

if TYPE_CHECKING:
    from pathlib import Path

    import polars as pl


# Streamlit reruns this script on every interaction; the file is read once per path.
@st.cache_data(show_spinner="Loading sales")
def cached_sales(path: Path) -> pl.DataFrame:
    return load_sales(path)


def show_error(error: AppError) -> None:
    st.error(f"**{error.heading}**: {error.message}")
    st.info(error.suggestion)


def main() -> None:
    st.set_page_config(page_title=APP_TITLE, layout="wide")
    st.title(APP_TITLE)
    try:
        settings = load_settings()
        configure_logging(level=settings.log_level, fmt=settings.log_format)
        sales = cached_sales(settings.data_path)
    except AppError as error:
        show_error(error)
        return

    with st.sidebar:
        st.header("Filters")
        regions = st.multiselect("Region", options(sales, "region"), key="regions")
        products = st.multiselect("Product", options(sales, "product"), key="products")
    selected = apply_filters(sales, Filters(regions=tuple(regions), products=tuple(products)))
    summary = summarize(selected)

    revenue, orders, units = st.columns(3)
    revenue.metric("Revenue", format_money(summary.revenue))
    orders.metric("Orders", f"{summary.orders:,}")
    units.metric("Units", f"{summary.units:,}")

    if selected.is_empty():
        st.info("No orders match these filters.")
        return
    st.subheader("Revenue by month")
    st.altair_chart(revenue_chart(revenue_by_month(selected)), width="stretch")
    st.subheader("Orders")
    st.dataframe(selected, hide_index=True)


main()
