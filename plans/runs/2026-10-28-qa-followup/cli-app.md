# CLI app follow-up

Status: **partial**. This fresh run exercised the fixed TypeScript CLI stack and
OpenRouter CLI app with an owned local provider. Both full manifest stages were
green, including the new acceptance steps, but the scratch app does not implement
the complete brief. The green result is evidence for the checks run here, not
proof of every requirement.

The built Node CLI was used against the uncommitted fixes at repository HEAD
`1e65551c277194e89530ed1bd99e73b54f1b7521`. The generated base fingerprint was
`sha256:222d662b986c22ca2aecce99c38436127b76e24ad858564deb798211fb071299`.
The generated manifest was not edited. Toolchain: Node 24.21.0, Bun 1.4.2,
Effect 4.0.7 and OpenTUI 0.7.0, on macOS arm64. This was one manually driven run,
with implementation and tests interleaved. No real provider credentials, paid
calls, deployment or publishing were used.

## Timeline

Times are UTC. The recorded verify timestamps are start times; completion is
start plus the run's recorded duration.

| Event | Time | Elapsed |
| --- | --- | --- |
| Base `new` start / end | 05:13:20.807 / 05:13:21.013 | 0.205 s |
| First actual passing test command end | 05:14:30.187 | 69.38 s from `new` start; three config tests |
| First full base verify start / end | 05:14:57.753 / 05:15:00.136 | 99.33 s from scaffold start to green; 14/14 |
| App `add` start / end | 05:15:25.890 / 05:15:26.073 | 0.183 s; 25.754 s after base first green |
| First app provider test | 05:16:21 | Vitest's displayed start time, second precision; actual test ran |
| First full app verify start / end | 05:22:59.892 / 05:23:12.620 | 7 min 46.55 s after add completed; 20/20 |
| Later expanded full verify start / end | 05:30:52.938 / 05:31:29.278 | 16 min 3.20 s after add completed; 20/20 |
| Latest expanded full verify start / end | 05:33:08.121 / 05:33:55.119 | 18 min 29.05 s after add completed; 20/20 |
| Final full verify start / end | 05:34:34.468 / 05:35:24.595 | 19 min 58.52 s after add completed; 20/20 |

The project state retains the base first-green timestamp after adding the app,
so the first app green is recovered from the app run record, not the state
record's `firstGreenAt`. These numbers include interactive implementation,
repairs and parallel manual checks; they are not unattended benchmark results.
There were two base and six composed full verification runs.
The first composed green preceded several substantive fixes below.

## Observed behavior

- Configuration acceptance: three grouped source tests exercise emitted JSONL
  records for default info, file debug/info, env none, blank env, invalid file
  fallback and separate invocations; file/env/default data paths and flag
  precedence; human and JSON output; and log metadata and a dummy secret. The
  compiled doctor repeats file debug and environment none. The configuration
  acceptance and binary manifest steps passed.
- The picker searches and filters, handles no matches and discovery failure,
  selects another model and restores input focus. The source and compiled PTY
  sent that selected model to the real Effect provider against the local stub.
  The PTY streamed a partial reply, stopped and aborted its HTTP request, saved
  the partial turn, executed successful and failing current-time tool follow-ups,
  exited zero on Ctrl+C and restored the terminal's normal screen. The real
  renderer also checked pending/done/failed display states.
- Source and compiled `ask` reach the stub; compiled `ask` accepted piped
  input and an explicit model and emitted delta/finish JSON lines. Local tests
  covered the models listing, structured extraction, chat listing and Markdown
  export. The structured request's exact JSON Schema was asserted for the local
  model, and invalid output returned a safe non-retryable error.
- The local provider tests covered 401, 402, 404, 429 and 500 mapping and safe
  stderr; two transient failures before output were retried, while a broken
  stream after output was not replayed. The eval uses pure pass/fail/error/
  truncated scoring, per-model counts, tokens, cost and median, timestamped
  JSON, and the same writer for dry and live runs. A never-finishing local
  request was aborted at its deadline; its error was saved, made the report
  invalid and did not prevent subsequent cases succeeding. The executable itself
  also exited 1 with that saved error and later passes. Dry-run used its own
  stub even with inherited dummy provider settings, and both paid entry points
  refused a missing key before contacting the watched stub. Canned replies test
  plumbing, not model quality.
- Source and compiled MCP initialize and delayed local-provider tool calls completed after stdin
  EOF with only JSON-RPC frames on stdout and exit zero. The initial direct
  Effect stdio layer interrupted its parent on EOF; running that layer in a
  child fiber recovered this observed behavior. This is the conditional
  workaround anticipated by the recipe, not a stacks defect.
- After the expanded changes, the focused Node acceptance suite had 13 passing
  tests; the renderer suite had 3 passing tests and 8 assertions; the compiled
  app suite had 4 passing tests and 12 assertions. One separate replay test was
  skipped for absent recordings. The manifest independently ran the suites and
  base checks; its 20/20 step count does not expose that test skip.

## Limits and findings

The generated app is partial. These are implementation gaps in this run, not
automatically defects in the recipe: multi-chat history and resume, full model
metadata/cache/routing and unknown-model handling, all CLI options and error
contracts, bounded TUI turn timeouts and retry across tool steps, complete
stream finalization/usage accounting were not
implemented or not fully exercised. The local store covers a single last turn;
schema-wire coverage is one local model
family. MCP coverage is one in-flight call, not every advertised tool. The
recorder was not run with a real key; no paid recordings were fabricated.
Real provider compatibility remains untested. A replay test was implemented
but not exercised because no real recordings were present. Recording and replay
are pending a user-supplied, credit-limited key and a separately authorized run.

The scaffold snapshot's `docs/ask-turn.md` described a
`guard-chat-boundaries.ts` write guard, but its Codex configuration did not
install that guard. The Grit rule was present. This is a guidance claim rather
than evidence that all guidance was missing; the new portable guidance and
acceptance files were generated. The parent is tracking the shared correction.

The first attempt to launch the CLI through its shebang with an isolated HOME
hit the local Node version manager's trust check. Invoking the same built entry
with the already installed Node 24 executable worked, without changing global
settings. This was a local toolchain interaction, not a recipe failure.

Reproduction shape (supply local paths and create isolated directories first):

```sh
export HOME=<qa-root>/home XDG_CONFIG_HOME=<qa-root>/config
export STACKS_DATA_DIR=<qa-root>/data STACKS_STATE_DIR=<qa-root>/state
unset STACKS_INDEX_URL OPENROUTER_API_KEY
node <cli> new typescript-cli <qa-root>/project --sandbox --agents codex --json --no-launch --offline
# Implement the generated brief, then inside <qa-root>/project:
node <cli> verify --all --json
node <cli> add openrouter-chat-cli --json --no-launch --offline
node <cli> verify --all --json
```

Raw, path-free verification results: [base first](cli-app-evidence/base-first.json),
[app first](cli-app-evidence/app-first.json),
[expanded app](cli-app-evidence/app-final.json),
[later app](cli-app-evidence/app-final2.json), and
[final app](cli-app-evidence/app-final3.json).

Cleanup: removed the owned scratch project, generator, isolated HOME, CLI state,
build output and downloaded project dependencies. No owned process or test
temporary directory remained in the post-cleanup check. This run created no
containers or volumes.

