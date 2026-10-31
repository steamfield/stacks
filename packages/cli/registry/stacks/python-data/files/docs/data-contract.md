# Data contract

## Input

CSV files with a header row that is exactly these columns, in this order. Every value is
read as text; the rules below decide what is valid.

| Column | Parsed as | Valid when |
|---|---|---|
| `order_id` | 64-bit integer | present and a whole number |
| `ordered_at` | date | present and `YYYY-MM-DD` |
| `region` | lowercase text | present after trimming |
| `product` | lowercase text | present after trimming |
| `quantity` | 64-bit integer | present and above zero |
| `unit_price` | decimal, 2 places | present, a number, zero or more |

A file with a different header stops the run with `SCHEMA` before any row is read, and so
does a row with more fields than the header. A row with fewer fields has the rest missing,
so it is rejected.

## Cleaning rules

Applied in `transform.py`, in this order:

1. Surrounding whitespace is trimmed from every value; empty text counts as missing.
2. A row that fails any column's rule is rejected with the first failing rule as its
   `reject_reason`. Rejected rows keep their raw text.
3. When an `order_id` repeats, the first valid row is kept and the rest are dropped as
   duplicates.

## Outputs

Written to the output directory as Parquet.

| File | One row per | Columns |
|---|---|---|
| `orders.parquet` | valid order | the input columns, typed |
| `rejects.parquet` | rejected row | the input columns as raw text, `reject_reason` |
| `revenue_by_region.parquet` | region, sorted | `region`, `orders`, `units`, `revenue` |
| `top_products.parquet` | product, by revenue | `product`, `units`, `revenue` (DuckDB query) |

`revenue` is `quantity * unit_price`, summed exactly as a decimal.

## Exit codes

| Code | Exit | When |
|---|---|---|
| `INTERNAL` | 1 | An unexpected error; rerun with `LOG_LEVEL=debug` (with the env prefix) |
| `USAGE` | 2 | A bad command or flag |
| `CONFIG` | 3 | An invalid setting |
| `INPUT` | 4 | No input files, or an unreadable one |
| `SCHEMA` | 5 | A header or row that doesn't match the contract |
| `OUTPUT` | 6 | The output directory can't be written |
| `MISMATCH` | 7 | `compare` found outputs that differ from the expected files |
