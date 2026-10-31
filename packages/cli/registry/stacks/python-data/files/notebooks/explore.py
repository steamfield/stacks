import marimo

app = marimo.App(width="medium")

with app.setup:
    from pathlib import Path

    import altair as alt
    import marimo as mo
    import polars as pl

    from package_name import io, transform


@app.cell
def _():
    mo.md("""
    # Orders

    The package's own transforms on the committed fixture, so this runs on any checkout.
    Point `source` at `data/raw` to explore real data; keep the logic in the package.
    """)
    return


@app.cell
def _():
    source = (mo.notebook_dir() or Path.cwd()) / ".." / "data" / "fixtures" / "orders.csv"
    raw = io.scan_orders(io.csv_files(source))
    orders = transform.clean(raw).collect()
    rejects = transform.rejects(raw).collect()
    return orders, rejects


@app.cell
def _(orders: pl.DataFrame, rejects: pl.DataFrame):
    mo.md(f"{orders.height} clean orders, {rejects.height} rejected rows.")
    return


@app.cell
def _(orders: pl.DataFrame):
    revenue = transform.revenue_by_region(orders.lazy()).collect()
    # Vega-Lite takes floats; the Decimal stays exact in the package's output.
    chart = (
        alt.Chart(revenue.with_columns(pl.col("revenue").cast(pl.Float64)))
        .mark_bar()
        .encode(x=alt.X("region:N", title="Region"), y=alt.Y("revenue:Q", title="Revenue"))
    )
    mo.ui.altair_chart(chart)
    return


@app.cell
def _(rejects: pl.DataFrame):
    mo.ui.table(rejects)
    return


if __name__ == "__main__":
    app.run()
