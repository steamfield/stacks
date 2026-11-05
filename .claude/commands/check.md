# Check

Run the gate from AGENTS.md: `rr check` in a clone opted in to rr (`git config --get stacks.rr`), `bun run check` otherwise. Read the failures, fix their cause, and rerun the affected check (a scoped test file, lint or typecheck) before running the full gate again. Do not weaken assertions or skip checks. Report the result and any remaining blocker.
