# Debugging

When investigating a bug, a failing test, or unexpected behavior, find the root cause before changing code. For slow code, measure before optimizing. For a bug whose evidence is in large logs, use the `ce:log-reader` agent rather than reading the logs into the conversation.

The two-attempt budget in the Debugging section of `AGENTS.md` applies: two failed fixes with no new diagnostic in between means stop, summarize what you learned, and ask.
