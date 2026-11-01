---
paths:
  - "src/**"
  - "tests/**"
  - "notebooks/**"
  - "data/**"
---

# Data pipeline conventions

- Transforms in `transform.py` take a `pl.LazyFrame` and return one. No file access and no `collect()` there; `io.py` reads and writes, and `pipeline.py` collects once with `pl.collect_all`.
- Schemas are explicit. Raw columns are read as text with `RAW_SCHEMA` and parsed by expressions in `PARSED`; never let Polars infer a type from the data.
- A value that fails a rule makes a reject with a `reject_reason`, not an exception. A rule changes in `transform.py`, `docs/data-contract.md` and `tests/test_transform.py` together, and the fixture gets a row that exercises it.
- Money and other exact quantities stay `pl.Decimal`; cast to float only for a chart.
- DuckDB reads Parquet paths and returns frames with `.pl()`. Pass values as query parameters, never by formatting them into SQL.
- Notebooks import the package and run on `data/fixtures`, so `make notebooks` works on any checkout. Logic a notebook needs to keep moves into the package with a test. Cell variable names are unique across a notebook (`marimo check` enforces it).
- `data/raw/` is input exactly as it arrived and `data/processed/` is output; neither is edited by hand. Only `data/fixtures/` is committed, and it never holds real data.
- Expected outputs in `data/fixtures/expected/` change only when the behavior change is intended; say so in the commit.
- Add dependencies with `uv add` (`uv add --dev` for tools); never edit `uv.lock`.

See the project's `AGENTS.md` for commands and the remaining conventions.
