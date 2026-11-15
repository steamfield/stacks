# Debugging

Read `docs/guidance/engineering/testing.md` for flaky-test diagnosis and `docs/guidance/engineering/errors.md` for cause chains and diagnostics. Find the root cause before changing code; measure slow code before optimizing.

The `ce:writing-tests` and `ce:handling-errors` skills go deeper when installed. For evidence in large logs, use the `ce:log-reader` agent when available.

The two-attempt budget in the Debugging section of `AGENTS.md` applies: two failed fixes with no new diagnostic in between means stop, summarize what you learned, and ask.
