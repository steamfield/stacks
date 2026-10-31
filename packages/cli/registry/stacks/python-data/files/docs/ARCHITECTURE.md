# Architecture

Data moves one way: raw CSV in `data/raw/`, through pure transforms, to Parquet in
`data/processed/`, then SQL over that Parquet. Notebooks read through the same package.

```text
data/raw/*.csv --io.scan_orders--> LazyFrame (text) --transform.clean/rejects--> LazyFrame
   --pipeline (one collect_all)--> io.write_parquet --> data/processed/*.parquet
   --queries.top_products (DuckDB)--> top_products.parquet
```

| Module | Owns |
|---|---|
| `io.py` | `ORDER_COLUMNS`, `RAW_SCHEMA`, finding input files, the header check, the lazy CSV scan, Parquet writes. The only module that opens files |
| `transform.py` | `ORDER_SCHEMA`, the parsing expressions, `reject_reason`, `clean`, `rejects`, `revenue_by_region`. LazyFrame in, LazyFrame out; no I/O and no `collect()` |
| `queries.py` | DuckDB SQL over Parquet paths, returning Polars frames |
| `pipeline.py` | `run_pipeline`: wires the above, collects once, writes every output |
| `compare.py` | `compare_outputs`: expected CSV against actual Parquet, as frames |
| `cli.py` | argparse commands `run` and `compare`, output, and the one place errors become exit codes |
| `config.py` | `Settings` (pydantic-settings): defaults, `.env`, environment, flags |
| `errors.py` | `ErrorCode`, `EXIT_CODES`, `PipelineError` |
| `log.py` | structlog to stderr |

Polars hands Parquet to DuckDB by path, and DuckDB hands results back as Arrow
through `.pl()`, so no rows pass through Python lists.

`notebooks/` holds marimo notebooks, stored as Python. They import the package and
run its transforms on the committed fixture; analysis that should last moves into the
package with a test.

`data/fixtures/orders.csv` is a small committed input with one example of every dirty
row the rules handle. `data/fixtures/expected/` holds the pipeline's output for it, one
CSV per Parquet file. `make pipeline-check` and `tests/test_pipeline.py` compare the
two as frames, so Parquet writer differences never show up as failures.
