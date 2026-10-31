# Phase 4.4c: Pick the agent harness at handoff

Status: EXECUTED 2026-10-27 (Codex-reviewed once; the live Codex app link and Copilot's agent marker are unchecked)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A person who runs `stacks new` (or `add`) at a terminal with several coding agents installed and none configured picks which one gets the project; with one installed it launches without asking; under an agent nothing changes |
| Traces to | Assumption "Handoff to whatever agent is on PATH" (D9); the human audience in `.claude/rules/cli/cli.md` "Three audiences" |
| Depends on | [1.4](phase-1.4-handoff-and-entry-points-2026-10-30.md) (the handoff decision, `LAUNCH_ARGS`, `Processes.interactive`), [3.0](phase-3.0-add-fragments-to-repo-2026-10-30.md) (`add` shares the flow) |
| Blocks | Nothing |
| Decisions needed | None; agreed with the maintainer 2026-10-27 |
| Settles | Which harnesses `--launch` and the picker know, when the CLI asks, and how a launch-only harness is recorded |

## Scope

In:

- Five terminal harnesses: claude, codex, opencode, cursor-agent, and GitHub Copilot CLI (`copilot -i <prompt>`). Gemini CLI was retired in June 2026.
- The Codex desktop app on macOS, opened with `open codex://new?path=<dir>&prompt=<prompt>`, auto-detected and listed last.
- A numbered picker after the project is written, only when no `Settings.agents` agent is found and two or more harnesses are.

Out:

- The Cursor IDE (its prompt deep link takes no folder and has open parsing bugs).
- Remembering a pick, Copilot adapters, `--agents` changes, and naming `copilot` or `codex-app` in `Settings.agents` (it stays `AgentId`).

## Where this fits

The agent half of the request already works: `config.ts::detectAgent` reads `AgentMarkers`, and `core/handoff.ts::decideHandoff` returns `inside-agent` before any launch rule, so `new` prints the instruction and spawns nothing. A non-terminal stdin or stdout never launches either (`not-a-terminal`), which covers an agent with no marker. Today a person with several agents installed gets the first binary in `candidates()` order without being asked.

## Design

### Ids: `Harness` beside `AgentId`

`src/schemas/entry.ts` gains `Harness = Schema.Literals([...AgentId.literals, "copilot", "codex-app"])`, used by `--launch`, `LAUNCH_ARGS`, `HandoffDecision` and `NewResult.handoff` print's optional `agent`. `--agents`, adapters, `targetAgents`, native-config checks, `Settings.agents` and `DetectedAgent` keep `AgentId`.

The manifest schema doesn't change. 0.1.0 decodes `handoff.agent` as closed `AgentId | "other"`, so a new value would make an older `verify` fail with `InvalidConfig`. `handoffRecord` maps a harness to its adapter id (`codex-app` to `codex`) or `"other"` (`copilot`). Nothing reads `handoff.agent` today (`core/runs.ts` reads `kind`).

### Launchers: `core/handoff.ts::LAUNCH_ARGS`

`LAUNCH_ARGS` becomes `Record<Harness, Launcher>`:

```ts
type Launcher =
  | { via: "terminal"; label: string; bin: string; args: (prompt: string) => string[]; checked?: string }
  | { via: "app"; label: string; app: string; url: (dir: string, prompt: string) => string; checked?: string };
```

New rows: `copilot` (`bin: "copilot"`, args `["-i", prompt]`) and `codex-app` (`app: "Codex.app"`, url `codex://new?path=<encodeURIComponent(dir)>&prompt=<encodeURIComponent(prompt)>`). `label` is the picker text: Claude Code, Codex CLI, OpenCode, Cursor CLI, Copilot CLI, Codex app. `LAUNCH_ORDER` appends `copilot`, then `codex-app`. In `renderHandoff`, the `For example:` line and the `no-agent-found` list use terminal launchers only, and `agent-not-found` for the app reads "The Codex app isn't installed (macOS only)." instead of `<bin> isn't on PATH.`

### Detection: `commands/handoff.ts::prepareHandoff`

Terminal launchers keep `Processes.which`. A named step `findApp` returns the app path when `Host.platform` is `darwin`, `which("open")` finds `open`, and `/Applications/<app>` or `$HOME/Applications/<app>` exists (Effect `FileSystem.exists`; HOME through `AppConfig`, adding `home` to `Paths` only if no field exposes it). Detection runs only when no agent is detected, without `--json`, and when launching is allowed. `found` becomes `ReadonlyMap<Harness, string>`.

### Decision: `decideHandoff` stays pure and synchronous

After the existing rules (inside-agent, json, no-launch, not-a-terminal, untrusted):

1. `--launch` given: launch it, else `agent-not-found`, as today.
2. The first `Settings.agents` agent in `found`: launch it without asking.
3. `available` is `LAUNCH_ORDER` filtered by `found`. None: `no-agent-found`. One: launch it. Several: `{ kind: "choose"; options; untrusted }`.

`launch` gains `via`: `{ kind: "launch"; agent: Harness; via: "terminal"; bin; args }` or `{ kind: "launch"; agent: Harness; via: "app" }`. `completeHandoff` builds the app URL from the project directory, so the decision needs no path. One `launchDecision` builds launches for the rules and the picker. `handoffRecord` records a `choose` as `print`, so `scaffold` and `add` keep their synchronous callback.

### The picker: `commands/handoff.ts::chooseHarness`

For `choose`, `completeHandoff` writes the summary and flushes it, then asks on stdout with `Terminal.display` (stdout is a terminal here; stderr may be redirected) and reads with `Terminal.readLine`, as `core/create.ts` does. The UX contract forbids cursor movement, so it isn't effect/cli `Prompt.select`.

```
Agents found:
  1) Claude Code
  2) Codex CLI
  3) Codex app
Hand the project to [1-3, Enter for 1]:
```

Enter picks 1, a valid number picks that row, and an invalid answer asks once more before falling back to print with the new `PrintReason` `not-chosen` (exit 0, prompt printed, project kept). EOF also falls back to `not-chosen`. Ctrl+C is SIGINT in cooked mode, so the run is interrupted and exits 130 with the project kept and the manifest's handoff still `print`. After a pick, `recordHandoff` (generalized from `recordPrinted`) rewrites the manifest's `handoff` to `launch` with the mapped agent; `handoff` is outside the step digest, so the tamper check is unaffected. The picker strings live in `core/handoff.ts` with the other fixed handoff text.

The picker is gated only by `decideHandoff`'s inputs, the same gate launching already has, so audiences render differently but don't behave differently.

### Launch

`via: "terminal"` keeps `Processes.interactive`. `via: "app"` prints `Opening the Codex app on <dir>...`, runs `Processes.exec` with argv `["open", url]`, the project as cwd and `childEnv([])`, and exits 0. A non-zero exit or `SpawnFailed` from `open` records `print` and writes the `renderHandoff` prompt with `output.note`, exit 0. `open` is a fixed command the CLI owns, like its git calls, so D2 holds. The `new` and `add` help text about the exit status after a launch gets the app exception.

### Flags

`--launch` takes every `Harness` (`harnessValue` beside `agentValue`, suggestions from `closest` over `Harness.literals`). `--launch codex-app` off macOS is `agent-not-found`. The `--launch` and `--no-launch` help says a person with several agents and none configured is asked.

## Files and areas touched

| Path | Change |
|---|---|
| `src/schemas/entry.ts` | `Harness` |
| `src/schemas/new.ts` | print `agent` is `Harness`; `not-chosen` reason |
| `src/core/handoff.ts` | `Launcher`, rows, order, configured-first rule, `choose`, `launchDecision`, record mapping, picker and app text |
| `src/commands/handoff.ts` | `harnessValue`, `findApp`, `chooseHarness`, `recordHandoff`, the app launch |
| `src/commands/new.ts`, `src/commands/add.ts` | help text |
| `tests/helpers/cli.ts` | a `terminal` option for `runCli`, defaulting to a scripted Terminal whose `readLine` fails as EOF, so an unexpected picker can't hang a test |
| `scripts/human.ts` | a human-only `--allow-launch` opt-in, stripped before the CLI, so the picker can be checked by hand |
| `packages/cli/docs/agents.md`, `packages/cli/README.md`, AGENTS.md | the picker, Copilot, the Codex app |

## Acceptance tests

1. With an agent marker set and several harnesses on PATH, `new` hands off `inside-agent`, prints no picker and reads nothing from the terminal; with no marker and stdout not a terminal it prints with reason `not-a-terminal`.
2. With `Settings.agents: ["codex"]` and claude and codex on PATH, a terminal run launches codex without reading the terminal.
3. With one harness on PATH and none configured, a terminal run launches it without reading the terminal.
4. With three harnesses found and none configured, the summary comes first and the picker follows on stdout in launch order; Enter launches row 1, `2` launches row 2, and two invalid answers print the prompt with reason `not-chosen` and exit 0. After a pick the manifest's `handoff` is `launch` with the mapped agent; after the fallback it is `print`.
5. EOF at the picker prints with `not-chosen`, exits 0 and keeps the project; an interrupt at the picker exits 130, keeps the project, and leaves the manifest's handoff `print`.
6. `--launch copilot` with `copilot` on PATH runs `copilot -i <prompt>` and records `other` in the manifest; without it, the run prints with reason `agent-not-found` and `agent: "copilot"`.
7. `codex-app` is detected only with platform `darwin`, `open` on PATH and `Codex.app` under `$HOME/Applications`; launching it runs `open` with a `codex://new` URL whose decoded `path` and `prompt` are the project directory and the agent prompt, and records `codex`. Off macOS, `--launch codex-app` prints with `agent-not-found` and the app line.
8. `new --json` output decodes with `NewResult`, `stacks schema new` lists the new harness ids and reason, and `--agents copilot` is still rejected as a usage error.
9. Against the built package under a pseudo-terminal, with two fake agents on PATH, picking the second gives that agent the terminal: a line typed after the pick reaches the agent's stdin.

### Realistic edge cases

10. With several harnesses installed, JSON, no-launch, dry-run, non-terminal stdin and untrusted entries never ask or launch, even with an explicit harness where allowed.
11. Unavailable configured agents fall through to the picker; the first available configured agent wins in settings order, and an explicit launch bypasses both settings and the picker.
12. An invalid answer gets one retry that can select a valid row; numeric prefixes, fractions, zero and out-of-range rows are invalid.
13. A project reached through a symlink and named with spaces, quotes and non-ASCII characters reaches the selected terminal agent as its real cwd with the prompt intact.
14. If the app opener exits non-zero or disappears after detection, the project stays, the manifest records print, the prompt is printed and the CLI exits 0.
15. Adding a fragment uses the same picker after its summary, preserves existing project files and leaves the manifest step digest unchanged by the choice.
16. Choosing a harness does not save a preference or change adapter targets; a second invocation asks again and existing configuration bytes stay unchanged.

## What this plan may get wrong

- Copilot CLI's environment marker is undocumented; inside Copilot the CLI relies on `AI_AGENT` or a non-terminal stdout. If QA shows its shell tool has a terminal and no marker, add the marker it sets to `AgentMarkers`.
- The Codex app's `prompt` parameter hasn't been tried live (assumed to fill the composer). If the link doesn't open the folder, drop the row.
- The app may be installed under another bundle name (the ChatGPT desktop app also registers `codex://`); `findApp` may need both.
- After `readLine`, Effect's `NodeTerminal` keeps its readline interface for a 10 ms idle TTL and adds keypress listeners on stdin, so the CLI may still hold fd 0 when the agent starts. Test 9 is where that shows; if it fails, release the interface before `interactive`.
- 2026-10-27: test 9 passed against the packed build without releasing anything, so the idle TTL is enough in practice.
- 2026-10-27: the app-failure fallback prompt goes to stdout through `output.result`, not `output.note` as Design said. It's the command's result once the app didn't open, and the tests expect stderr to stay empty.
- 2026-10-27: the picker made `tests/handoff-signals.test.ts` reach the picker whenever the real PATH held a second agent; it now passes `--launch claude`. `tests/handoff.test.ts` follows the new launch shape and the `choose` decision.
