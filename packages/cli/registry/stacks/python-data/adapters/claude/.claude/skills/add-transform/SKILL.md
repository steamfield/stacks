---
name: add-transform
description: Add a cleaning rule, a derived column, an aggregate output or a DuckDB query to this Polars pipeline, with its tests and expected output. Use when the user asks for a new rule, metric, summary table, output file or query over the data.
---

# Add a transform

`revenue_by_region` in `src/<package>/transform.py` and `top_products` in `queries.py` are the models. Read them, `docs/ARCHITECTURE.md` and `docs/data-contract.md` first.

1. Write the transform as a function from `pl.LazyFrame` to `pl.LazyFrame` in `transform.py`, or as SQL with parameters in `queries.py` when SQL reads better. No file access and no `collect()`.
2. A new cleaning rule is one more `when(...).then(...)` in `reject_reason`, in the order the contract lists it. A new raw column changes `ORDER_COLUMNS` in `io.py`, `PARSED` and `ORDER_SCHEMA` together.
3. Unit test it in `tests/test_transform.py` (or `tests/test_queries.py`) with a small inline frame and `assert_frame_equal`, covering the schema and each edge the rule handles.
4. For a new output, add its name to `OUTPUTS` in `pipeline.py`, compute it inside the one `pl.collect_all` call and write it with `io.write_parquet`.
5. When the fixture should exercise it, add a row to `data/fixtures/orders.csv`. Then update `data/fixtures/expected/` with the new output's CSV or the changed rows; work the values out by hand from the fixture rather than copying the pipeline's output, so the check can catch a wrong transform.
6. Update `docs/data-contract.md` (rules, outputs) and, if a notebook should show it, `notebooks/explore.py`.
7. Run `make lint typecheck coverage pipeline-check notebooks`.
