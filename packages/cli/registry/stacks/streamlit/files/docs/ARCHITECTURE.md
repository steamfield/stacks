# Architecture

Streamlit runs `app.py` from top to bottom on every interaction. The page only lays out
widgets and draws results; the data rules live in a package that knows nothing about
Streamlit, so plain unit tests cover them.

```text
.env / environment --config.load_settings--> Settings.data_path
data/sample.csv --data.load_sales (cached in app.py)--> DataFrame
sidebar widgets --> metrics.Filters --metrics.apply_filters--> DataFrame
   --metrics.summarize--> Summary --> st.metric
   --metrics.revenue_by_month--> charts.revenue_chart --> st.altair_chart
```

| Module | Owns |
|---|---|
| `app.py` | Page config, widgets with keys, layout, the `st.cache_data` wrapper, turning `AppError` into `st.error` |
| `data.py` | `SALES_SCHEMA` and `load_sales`: the one place a file is read; rejects empty cells; adds `revenue` as a Decimal |
| `metrics.py` | `Filters`, `Summary` and pure functions over frames: options, filtering, totals, monthly revenue, money formatting |
| `charts.py` | Altair chart specs from metric frames; the only place money becomes a float |
| `config.py` | `Settings` (pydantic-settings): defaults, `.env`, environment |
| `errors.py` | `ErrorCode`, the `HEADINGS` table the page shows, `AppError` |
| `log.py` | structlog to stderr |

`.streamlit/config.toml` keeps the server headless, turns off usage statistics and magic
(only explicit `st.*` calls draw), and hides exception details from viewers.

Tests come in two layers. `tests/test_data.py`, `test_metrics.py` and `test_charts.py`
call the package directly. `tests/test_app.py` runs `app.py` in process with
`streamlit.testing.v1.AppTest`, sets widgets by key and reads the metrics, errors and
elements the page drew. `make start` serves the page; its `/_stcore/health` endpoint
answers once the server is up, before any script runs, so the AppTest tests are what
prove the page renders.
