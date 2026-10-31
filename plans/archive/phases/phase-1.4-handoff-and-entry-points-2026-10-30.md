# Phase 1.4: Handoff and entry points

Status: EXECUTED 2026-10-26, reviewed once and fixed, merged to main 2026-10-27. The `guide`
subcommand was added as a proposed scope item 2026-10-26 and is built, but the maintainers
haven't formally agreed it; it stays proposed until they do

Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | After `new` writes the project, the brief reaches an agent without the user copying anything: the agent that called stacks is told what to do next, or the first agent CLI on PATH is launched with the brief as its first prompt, or the prompt is printed. No agent is ever launched for a project with an untrusted entry. Running `stacks` with no arguments prints a guide written for agents; a `guide` subcommand printing the same guide is proposed, not agreed |
| Traces to | "The CLI writes a few files and a brief, then hands off to the agent the user already has"; assumption "Handoff to whatever agent is on PATH is the right entry point" (confidence low, "Watch whether people use `new` from a terminal or ask their agent to run it"); the agent user: "It runs `list --json`, picks a stack, runs `new`, reads the brief, builds, and loops on `verify`" |
| Depends on | [1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md) (`new` and its result), [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (the manifest with its optional `handoff` field, `AppConfig.agent`, `DetectedAgent`, `AgentMarkers`), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`Processes.interactive`, `Processes.which`, the A3 signal policy), [0.3a](phase-0.3a-errors-and-output-2026-10-30.md) (`Output.flushNow`, `Host.stdinIsTTY`, `Host.stdoutIsTTY`) |
| Blocks | [1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md) (the gate runs use the real handoff), [2.0b](phase-2.0b-bench-2026-10-30.md) (the bench reuses the launch-args table and prompt text), [3.0](phase-3.0-add-fragments-to-repo-2026-10-30.md) (`add` reuses the handoff module and flags), [3.4c](phase-3.4c-agent-skill-2026-10-30.md) (the agent skill reuses the guide's loop and rules) |
| Decisions needed | D9 (both entry points, instrumented). If deferred, build both anyway and record the handoff kind, since recording costs nothing. If the maintainers drop the PATH launch, the `launch` outcome and its tests go and `print` takes its place; the rest stands. A3 (signal policy, 0.3b) as recommended; if A3 changes, only the launch step changes |
| Settles | Launch order; when the CLI refuses to launch; the exact prompt text; how `new` exits after launching an agent; the manifest's `handoff` record; what `stacks` with no arguments prints; whether a `guide` subcommand prints it too (proposed) |

## Scope

In:

- The handoff decision as a pure function, and its three outcomes: `inside-agent`,
  `launch`, `print`.
- Launching an interactive agent through `Processes.interactive` under the A3 policy, and
  exiting with the agent's status.
- `new` flags: `--launch <agent>` (the agent to hand off to) and `--no-launch`, both defined
  here once; `add` (3.0) reuses them. `--json` never launches. `--agents <list>` is a
  different flag: the agents whose config is written (1.2a, 1.1 `targetAgents`).
- Filling the manifest's optional `handoff` field (for D9) and widening the `new` result's
  `handoff` from 1.2a's print-only placeholder to the full union.
- The no-argument agent guide.
- Proposed 2026-10-26: a `guide` subcommand that prints the same guide, so an agent or a
  person who learned the command names from `--help` can reach it by name.

Out:

- Agent detection and `AgentMarkers` (1.2b defines them), `Host.stdinIsTTY` and
  `Host.stdoutIsTTY` (0.3a defines them); this sub-phase reads them. PATH lookup other
  than `Processes.which`.
- The `agents` setting (added by 1.1; read here for launch order).
- Native per-agent config under `adapters/<agent>/` for anything but Claude Code
  ([3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md)).
- An agent skill that teaches agents about stacks ([3.4c](phase-3.4c-agent-skill-2026-10-30.md)
  ships one, reusing this guide's loop and rules).
- Sending the handoff kind anywhere (4.1a, if D17 is agreed).
- `add` handoff (3.0 reuses this module).

## Design

### Inputs

Everything the decision reads is already defined elsewhere; this sub-phase cites it:

| Input | Source |
|---|---|
| Detected agent | `AppConfig.agent: DetectedAgent` (`AgentId \| "other" \| "none"`; [roadmap, Contracts: Agent detection and TTY](../../roadmap.md#types-and-schemas)) |
| stdin is a terminal | `Host.stdinIsTTY` (same row) |
| stdout is a terminal | `Host.stdoutIsTTY` (same row; 0.3a supplies it from `bin.ts`) |
| Agent binaries | `Processes.which` ([roadmap, Contracts: PATH lookup](../../roadmap.md#types-and-schemas)) |
| Agent ids | `AgentId` from 1.0 |
| Configured order | `Settings.agents` (1.1) |
| Trust | `trusted` on each composed `Entry` (1.0) |
| How this CLI was invoked | `Host.invocation` (`stacks`, or `npx -y stacks@<version>`) |

### The decision

```ts
// src/core/handoff.ts: pure; the binary lookup result is passed in
export type HandoffDecision =
  | { kind: "inside-agent"; agent: Exclude<DetectedAgent, "none">; untrusted: ReadonlyArray<string> }
  | { kind: "launch"; agent: AgentId; bin: string; args: ReadonlyArray<string> }
  | { kind: "print"; reason: PrintReason; agent?: AgentId; untrusted: ReadonlyArray<string> };

export type PrintReason =
  | "json" | "no-launch" | "not-a-terminal" | "untrusted" | "no-agent-found" | "agent-not-found";

export function decideHandoff(input: {
  detected: DetectedAgent;               // AppConfig.agent
  json: boolean;
  launch: boolean;                       // false with --no-launch
  stdinIsTTY: boolean;
  stdoutIsTTY: boolean;
  untrusted: ReadonlyArray<string>;      // ids of composed entries with trusted: false
  preferred?: AgentId;                   // --launch
  configured: ReadonlyArray<AgentId>;    // Settings.agents, user order
  found: ReadonlyMap<AgentId, string>;   // absolute paths from Processes.which
}): HandoffDecision;
```

The handler looks up each candidate binary with `Processes.which` first, so the function
stays pure. Rules, first match wins:

1. An agent is detected (`detected` is not `"none"`, so `"other"` counts): `inside-agent`.
   stacks is already a tool call inside an agent session; launching a second agent
   there would nest sessions.
2. `--json`: `print` with reason `json`. A machine caller wants a result, not a terminal
   takeover.
3. `--no-launch`: `print`.
4. stdin or stdout is not a terminal: `print`. An interactive agent with no terminal hangs
   or exits at once.
5. Any composed entry is untrusted: `print` with reason `untrusted`. Never launch with an
   untrusted entry ([roadmap, Trust model](../../roadmap.md#trust-model), point 3): the user
   reads the warning before any agent acts on the brief, and the brief opens with its
   stop-and-confirm section (1.1).
6. Otherwise try `--launch` alone if given, else `Settings.agents` followed by `claude`,
   `codex`, `opencode`, `cursor` (deduplicated). First binary found: `launch`. None:
   `print` with `agent-not-found` (when `--launch` was given) or `no-agent-found`.

Flag contradictions never reach the decision: the parser rejects `--launch` with
`--no-launch`, and `--launch` with `--json`, as `Usage` (exit 2), the same tag every flag
contradiction in `new` and `add` uses (1.2a, 3.0).

Rule 5 sits below 1-4 only because those already never launch; any reordering must keep
"untrusted never reaches `launch`", which a property test asserts.

### The prompt

One sentence, the same in every outcome, built by `agentPrompt(invocation)`:

> Read .stacks/BRIEF.md and carry it out. It's your full task for this project; you're done when `<invocation> verify` passes.

`<invocation>` is `Host.invocation`, the same string the brief uses (1.1), so a project
created through `npx` names the pinned version. Launch arguments per agent:

| `AgentId` | Binary | Arguments |
|---|---|---|
| `claude` | `claude` | the prompt as the single positional argument |
| `codex` | `codex` | the prompt as the single positional argument |
| `opencode` | `opencode` | `--prompt <prompt>` |
| `cursor` | `cursor-agent` | the prompt as the single positional argument |

The table is one constant with the date each entry was last checked against the agent's
docs; a test asserts every `AgentId` has a row.

### Outcomes

| Kind | Stdout (human) | `--json` result `handoff` field | Exit |
|---|---|---|---|
| `inside-agent` | `NEXT STEP FOR THE AGENT: read .stacks/BRIEF.md now and carry it out, working in <dir>. Loop on <invocation> verify until it passes. Don't stop here to report back; the brief says when to ask the user.` With untrusted entries, instead: `STOP: this project uses entries this machine hasn't trusted: <ids>. Don't start. Show the user the list and .stacks/BRIEF.md's first section, and continue only if they confirm.` | `{ kind, agent, untrusted }` | 0 |
| `launch` | `Launching <bin> in <dir>...`, flushed, then the agent owns the terminal | not reachable (`--json` never launches) | the agent's status |
| `print` | `Next: open <dir> in your coding agent and give it this prompt:`, the prompt, an example (`cd <dir> && claude "<prompt>"`) and the brief path; with untrusted entries, a warning naming each entry and its path first | `{ kind, reason, agent?, untrusted, prompt }` | 0 |

The `inside-agent` text is aimed at the agent reading the tool output, the main reader.
It is a result on stdout, not a note on stderr, because agents read stdout first and some
drop stderr.

### Launching

`new` computes the decision before writing, so the manifest is written once:

1. 1.2a's writer writes the project with the manifest's `handoff` field filled (below). A
   crash during the agent session still leaves the record.
2. `Output.flushNow` writes the scaffold summary and the `Launching` line. From here,
   "stdout empty on failure" no longer applies to this invocation ([roadmap, Contracts:
   Progress and flush](../roadmap.md#types-and-schemas)).
3. `Processes.interactive` runs the agent with cwd the project, stdio inherited and
   `detached: false`, so the agent stays in the terminal's foreground process group and
   Ctrl+C reaches it ([roadmap, Contracts: Process service](../../roadmap.md#types-and-schemas)).
   Its environment is the captured environment unchanged (the user is starting their own
   agent; nothing is stripped). While it runs, the A3 policy (0.3b) ignores SIGINT and
   SIGQUIT in stacks and forwards SIGTERM and SIGHUP.
4. The child's status becomes the invocation's exit: its code, or 128 plus the signal
   number. `new` returns it through a per-invocation exit-status override that `main`
   applies only when the command succeeded, so a non-zero agent exit writes no error
   envelope: the project was written correctly. This is the one place an exit code
   outside 0.3a's table reaches the caller; the README's exit-code table says so
   ([open question 25](../../risks-and-open-questions.md#open-questions-for-the-maintainers)
   covers the scheme as a whole).

The `command` log record gains `handoff: <kind>` and, for `launch` and `inside-agent`,
`agent: <id>`. No argument values, paths or prompt text.

### Manifest record

1.2b declares the manifest's `handoff` field optional ([roadmap, Contracts:
Manifest](../roadmap.md#types-and-schemas)); this sub-phase fills it:

```json
"handoff": { "kind": "inside-agent", "agent": "claude", "at": "2026-11-03T10:02:00Z" }
```

`kind` is `"inside-agent" | "launch" | "print"`; `agent` is present for `inside-agent`
and `launch`, and is `"other"` when an unrecognized agent was detected. Filling a declared optional field needs no `schemaVersion` bump
([roadmap, Schema versions](../../roadmap.md#schema-versions)), and `handoff` is outside the
step digest (Trust model point 5). This is the local half of D9's instrumentation: 2.0c's
`stacks runs` reports it; 4.1a can send it if telemetry is agreed.

### The no-argument guide

`stacks` with no subcommand prints a short guide written for agents (and readable by
people) instead of the framework's help. Today a bare invocation ends in the framework's
`ShowHelp`, which `main` turns into help text and exit 0; the guide replaces that text
only for the bare root, and `--help` keeps the framework help. Content, under 250 words,
in `src/core/guide.ts` with a test asserting the cap with `countWords`:

1. What stacks does, in two sentences.
2. The loop: `stacks list --json`, pick a stack and tell the user why,
   `stacks new <stack> <dir> [--sandbox]`, read the brief, loop on
   `stacks verify`.
3. Rules: never pick an entry `list --json` marks untrusted unless the user named it
   (Trust model point 3); never edit `.stacks/manifest.json`; weakening a step counts
   as failure; if `verify` reports `VerifyChanged`, stop and ask the user (only they can
   accept the change); ask the user only what the brief says to ask.
4. Where the user's own stacks go (the user directory from 1.0).

`--json` on the bare root returns `{ guide: "<text>", commands: [...] }`.

`stacks guide` (proposed) is a subcommand with no arguments that prints the same
text from the same `src/core/guide.ts`, with the same `--json` result, so there is one
guide and two ways to reach it. It exists because the bare root is easy to miss: a
subcommand shows up in `--help`'s command list, and an agent told "run the guide" has a
name to run. It reads neither the project nor the registry, so it works anywhere.

### The help footer

`stacks --help` keeps the framework's help, and ends with a fixed footer from the
same `src/core/guide.ts`, so an agent that reaches for `--help` first still finds the
loop:

```
Start here (agents): <cli> list --json, pick a stack and tell the user why,
then <cli> new <stack> <dir> --json, then follow .stacks/BRIEF.md
until <cli> verify is green. Run <cli> with no arguments for the full guide.
```

If the proposed `guide` subcommand is accepted, the last sentence becomes "Run <cli> guide
for the full guide."; until then it stays as above.

`<cli>` is `Host.invocation`. Check first how `effect/cli` in the installed version lets a
root command add text after its generated help (a description field, an epilogue, or
`main` appending to the captured help text before it is flushed). Whichever it is, the
footer appears only on the root's `--help`, not on each subcommand's, and it counts
toward nothing (it isn't the guide's 250 words).

### Failure modes

| Case | Error tag | Exit | What the agent or user sees |
|---|---|---|---|
| `--launch` names an unknown id | `Usage` (parser) | 2 | Usage error listing valid ids |
| `--launch` with `--no-launch` or `--json` | `Usage` (parser) | 2 | Usage error naming both flags |
| `--launch` binary not on PATH | none; `print` with `agent-not-found` | 0 | The printed prompt plus "claude isn't on PATH" |
| Spawn fails after the binary was found | `SpawnFailed` handled here: `PermissionDenied` for `EACCES`, `Defect` otherwise | 6 or 1 | The project is written; stdout already has the summary (step 2 flushed it); stderr has the envelope |
| Agent exits non-zero or by signal | none | the agent's status | Whatever the agent printed |
| SIGTERM or SIGHUP to stacks during the session | none | forwarded; then the agent's status | The agent shuts down; no orphan is left on the terminal |
| Untrusted entries composed | none; `print` with `untrusted`, or the `STOP` text inside an agent | 0 | A warning naming each entry and its path |

### Decisions settled here

- Launch order as above. Configured agents first lets a user with several agents pick
  without a flag every time.
- `--json` never launches, and neither does a non-terminal: a launched session would
  swallow the JSON contract and hang a caller that isn't a person.
- A non-zero agent exit is passed through, not wrapped: the CLI's job ended when the files
  were written.
- The launched agent gets the user's environment unchanged. Verify strips agent markers
  from its steps (1.3a); handoff doesn't, because it starts the user's own agent, not a
  project command.

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/core/handoff.ts` | `decideHandoff`, `agentPrompt`, launch-args table, messages |
| `src/core/guide.ts`, `src/cli.ts` | Bare-root guide and the root `--help` footer |
| `src/commands/guide.ts` | The `guide` subcommand (proposed), a thin handler over `src/core/guide.ts` |
| `src/schemas/guide.ts` | `GuideResult`, the `{ guide, commands }` result of the bare root's `--json` (and of `guide --json`, if accepted) |
| `src/commands/new.ts` | Flags, lookup, decision, manifest field, flush, launch, exit status |
| `src/schemas/new.ts` (1.2a's `NewResult`) | `handoff` widened to the union |
| `src/main.ts` | Exit-status override; `command` record fields; guide for the bare root |
| `tests/handoff.test.ts`, `tests/new-handoff.test.ts` | New |
| `e2e/handoff.test.ts` | One test against the built artifact |
| `README.md` (package), repo `AGENTS.md` | Handoff behavior and the guide |

## Acceptance tests

1. `decideHandoff` table test over every rule and its precedence (detected agent beats
   `--json`; `--json` beats `--no-launch`; untrusted beats a found binary), and a test that
   every `AgentId` has a launch row.
2. Property test with `@effect/vitest`: for any input with non-empty `untrusted`, the
   decision is never `launch`; for any `detected` other than `"none"`, it is
   `inside-agent`.
3. `runCli(["new", "<fixture-stack>", dir, "--sandbox"])` with `CLAUDECODE=1`: stdout
   ends with the `NEXT STEP FOR THE AGENT` text, exit 0, manifest `handoff.kind` is
   `inside-agent`, agent `claude`. Same with `--json`: one JSON result whose `handoff` is
   `{ kind: "inside-agent", agent: "claude", untrusted: [], prompt }`.
4. `AI_AGENT=foo` with a fake `claude` on `PATH` and both TTY flags true: `AppConfig.agent`
   is `"other"`, the decision is `inside-agent` with agent `"other"`, the fake `claude`
   never ran, and the manifest's `handoff` is `{ kind: "inside-agent", agent: "other" }`.
5. `new --launch claude --no-launch` and `new --launch claude --json` each exit 2 with a
   `Usage` envelope naming both flags and write nothing; `--launch` with an unknown id is
   `Usage` too.
6. Same with a project-origin fixture entry composed: the `STOP` text names it, and the
   `--json` `untrusted` lists its id.
7. Launch with a real child: a temp directory on `PATH` holding an executable `claude` (a
   small Node script) that writes its argv, cwd and process group id to a file and exits 7.
   `runCli` with both TTY flags true and that `PATH`: the file shows the prompt as one
   argument, the project as cwd, and the same process group as the CLI; the invocation exits
   7 with no error envelope; the manifest says `launch`; stdout had the scaffold summary
   before the child ran. The agent's environment is the captured one unchanged, and the
   `command` log record names the handoff kind and agent only.
8. Signal policy (subprocess form, as the dev-script test does): the fake agent sleeps; the
   test sends SIGTERM to stacks and asserts the child received SIGTERM and stacks
   exited 130 (the A3 policy: a forwarded SIGTERM stops the CLI with 130 once the child
   exits).
9. `--no-launch`, either TTY flag false, an untrusted fixture entry with a fake `claude` on
   `PATH`, and an empty `PATH`: each prints the prompt, exit 0, and the fake `claude` never
   ran.
10. The prompt uses `Host.invocation`: with an npx-style invocation it reads
    `npx -y stacks@<version> verify`.
11. `stacks` with no args: the guide, exit 0, under 250 words by `countWords`, and it
    contains the untrusted-entry rule and the `VerifyChanged` rule; `--help` still shows the
    framework help; `--json` returns `GuideResult`.
12. `stacks guide` (proposed) prints exactly the bare root's text, exit 0, and
    `guide --json` returns the same result as the bare root's `--json`; `guide` appears in
    the root `--help` command list.
13. `stacks --help` ends with the "Start here (agents)" footer using
    `Host.invocation`; `stacks new --help` does not contain it; exit 0 for both.
14. e2e: the built artifact run with `CLAUDECODE=1` on a fixture registry prints the
    next-step text and writes the manifest record.

### Realistic edge cases

15. An agent binary on `PATH` with an execute bit only for others: the spawn fails
    `EACCES`, which is `PermissionDenied` with reason `launch` (exit 6); the project and the
    flushed summary stay.
16. An agent that dies by a signal: the invocation exits 128 plus the signal number, with no
    envelope.
17. Launch order: the `agents` setting picks the agent ahead of the default order, and
    `--launch` picks one alone.
18. `--launch codex` with only `claude` on `PATH`: printed with "codex isn't on PATH", and
    the example names `codex`.
19. The printed example command quotes a project directory with spaces and quotes, so it
    pastes into a shell.

## Exit criteria

- All tests above pass; `bun run check` green from the repo root.
- `AGENTS.md` (Error handling, Architecture map) and the package README describe the
  handoff outcomes, the guide, that `--json` never launches, and that untrusted entries
  never launch.
- D9's local record exists in the manifest (noted for the maintainers when D9 is reviewed).

## What this plan may get wrong

- An agent that sets no marker at all, not even `AI_AGENT`, reads as `"none"`. Rule 4
  usually still prevents a nested launch, because agent shell tools rarely give the child
  a terminal. If one does, the user sees a second agent start inside the first; 1.6b's
  gate runs and 2.0b's bench would show it.
- Agent markers change without notice. 1.2b's marker list carries confirmation dates; a
  missed detection shows up as a nested launch attempt in 2.0b bench runs, and later in
  the canary (5.1).
- Some agents may stop accepting the prompt as a positional argument. The launch-args
  table is the one place to fix it, and the printed fallback always works.
- Ignoring SIGINT while the child runs assumes the child stays in the terminal's
  foreground process group. If an agent starts its own session, Ctrl+C would reach
  neither; check this against each agent in the first 1.6b gate run.
- 2026-10-26: the `guide` subcommand is a proposed addition, matching the roadmap's
  Feature gaps row. The help footer keeps the original "Run <cli> with no arguments for
  the full guide" and changes to "Run <cli> guide for the full guide" only if the
  subcommand is accepted; if the maintainers drop it, the bare root stays the only way to
  the guide.

What execution found, 2026-10-26:

- The `guide` subcommand is built (`commands/guide.ts`) though the maintainers haven't
  formally agreed it. Dropping it is deleting that file and its line in `cli.ts`; the bare
  root keeps the same handler. The footer still says "Run <cli> with no arguments".
- Signal test: the plan expected stacks to exit 143 after a forwarded SIGTERM. The A3
  policy as built in 0.3b (`platform/signals.ts::foregroundCleared`, AGENTS.md "Error
  handling") stops the CLI with 130 once the child exits, the same as every other signal
  stop, so acceptance test 8 asserts 130. The agent's own status still reaches the caller
  when nothing signaled stacks.
- The prompt text changed from the 1.2a placeholder: no backticks around the verify command
  ("It's your full task ...; you're done when <invocation> verify passes."), because the
  printed example puts the prompt in double quotes and backticks would run as a command
  substitution when pasted.
- The `--json` `handoff` carries `prompt` for `inside-agent` too, not only for `print`, so an
  agent reading JSON gets its next step without knowing the convention. Acceptance tests 3
  and 6 assert it.
- Acceptance test 9 asked for "the right `reason` in `--json`" for `--no-launch` and a
  missing TTY. Rule 2 (`--json` prints with reason `json`) comes before both, so `--json`
  can't observe them; the reasons are covered by the `decideHandoff` table (test 1), and
  test 9 asserts the human output and that the fake agent never ran.
- Flag contradictions are `Usage` with a new details shape, `{ flags: [a, b] }`
  (`errors.ts::UsageDetails` is now a union with the unknown-subcommand
  `{ command, suggestions }`), so the envelope and the human lines name both flags.
- `--launch` with an unknown id is `Usage` without the valid ids in details: `main` maps
  every effect/cli value error to a plain `Usage`, the same as `--agents` today. The flag's
  help text lists the ids.
- `EACCES` on spawn is `PermissionDenied` with a new reason, `launch`, and `path` the binary,
  so the human output says what to fix.
- `new` reads `--json` from the root's shared flag (`commands/root.ts::root`, yielded inside
  the handler); the exit-status override and the log fields go through a per-invocation
  service, `services/invocation.ts::Invocation`, which `main` builds fresh each run.
- The launch-args table has no `checked` dates: no row has been checked against the agents'
  docs yet. Check them in the first 1.6b gate run.
- The bare root's `--json` `commands` are `{ name, run, purpose }` rows for the loop's
  commands. They name `verify`, which lands with 1.3a; the test that every listed command
  is a subcommand skips `verify` until then.
- The e2e test puts the fixture stack in the user directory, because entries under
  `STACKS_REGISTRY_DIR` are untrusted and would give the `STOP` text.

Review, 2026-10-26:

- The manifest is written with `handoff.kind: "launch"` before the agent is spawned, so a
  spawn that fails left a record of a launch that never happened (2.0b and 2.0c read it).
  `commands/new.ts` now rewrites the record to `{ kind: "print", at }` (the same `at`) when
  the spawn fails, both for `PermissionDenied` (`launch`) and for the defect from any other
  spawn error, before reporting the failure. The record means what happened, not what was
  attempted: the prompt is on stdout either way, and an `attempted` kind would be a manifest
  schema change for no reader. The rewrite is best effort; a manifest that can't be read or
  written back keeps `launch`, and the spawn failure is still what the caller sees.
- D29 (agent output by default) landed on `main` after this plan executed. The handoff
  decision is unchanged (a launch needs a terminal and no agent, which is the human
  audience), but its text is rendered per audience: the `NEXT STEP FOR THE AGENT` line names
  the project through `core/shown-path.ts::shownPath` (relative when it is under the
  working directory, "the current directory" when it is the working directory), and agent
  output drops the printed `For example:` command, which repeats the prompt on the line
  above it.
