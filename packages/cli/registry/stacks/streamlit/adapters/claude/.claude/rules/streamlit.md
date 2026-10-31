---
paths:
  - "app.py"
  - "pages/**"
  - "src/**"
  - "tests/**"
  - ".streamlit/**"
  - "data/**"
---

# Streamlit app conventions

- Streamlit reruns `app.py` from the top on every widget change. Anything slow (reading files, queries, model loads) sits behind `st.cache_data` (data) or `st.cache_resource` (connections, clients) in `app.py`, keyed by its arguments.
- `app.py` holds widgets, layout and the cache wrappers only. Filtering, totals and chart specs are pure functions in the package (`metrics.py`, `charts.py`) that import nothing from Streamlit, each with a unit test.
- Every widget gets an explicit `key`. AppTest finds widgets by key, and keys keep state stable when the layout changes.
- Draw with explicit `st.*` calls; magic is off in `.streamlit/config.toml`, so a bare expression shows nothing.
- `data.load_sales` reads with `SALES_SCHEMA`; never let Polars infer types. A column change updates the schema, `data/sample.csv` and the tests together.
- Expected failures are `AppError` with a code in `errors.HEADINGS`; `app.py` shows them with `st.error` and stops drawing. Don't catch broad exceptions in the page.
- A new filter, metric or chart gets a case in `tests/test_app.py` that sets the widget and asserts the value the page shows. Run `make test`, not a server: `streamlit run`, `make dev` and `make start` wait in the foreground (the guard hook refuses them).
- Settings come from `config.Settings`; secrets come from the environment, never from a committed file or `.streamlit/secrets.toml` you write.
- Add dependencies with `uv add` (`uv add --dev` for tools); never edit `uv.lock`.

See the project's `AGENTS.md` for commands and the remaining conventions.
