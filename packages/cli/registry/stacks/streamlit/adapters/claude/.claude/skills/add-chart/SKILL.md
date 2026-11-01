---
name: add-chart
description: Add a filter, metric, chart or table to this Streamlit page, with the package function behind it, its unit test and an AppTest case. Use when the user asks for a new widget, KPI, breakdown, chart or view of the data on the dashboard.
---

# Add a filter, metric or chart

`metrics.revenue_by_month`, `charts.revenue_chart` and the region filter in `app.py` are the models. Read them and `docs/ARCHITECTURE.md` first.

1. Write the calculation as a pure function in `src/<package>/metrics.py`: a `pl.DataFrame` in, a frame or a value out, no Streamlit import. A new filter adds a field to `Filters` (empty means no filter) and a condition in `apply_filters`.
2. A chart is a function in `charts.py` that takes the metric's frame and returns an Altair chart; titles and tooltips live there.
3. Unit test both: `tests/test_metrics.py` with a small inline frame and `assert_frame_equal` or exact values worked out by hand, and `tests/test_charts.py` on `chart.to_dict()` (mark, fields, aggregate).
4. In `app.py`, add the widget with an explicit `key` (in `st.sidebar` for filters), call the package function and draw the result with `st.metric`, `st.altair_chart(..., width="stretch")` or `st.dataframe`. If it is slow, cache it with `st.cache_data`.
5. In `tests/test_app.py`, set the widget by key (`page.multiselect(key=...).select(...).run()`) and assert what the page shows changes to the hand-worked value, with `assert not page.exception`. Use `data/sample.csv`; add rows there only with their expected values updated in every test that counts them.
6. Run `make lint typecheck coverage`.
