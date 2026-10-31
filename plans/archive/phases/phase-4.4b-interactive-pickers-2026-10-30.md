# Phase 4.4b: Interactive pickers

Status: EXECUTED 2026-10-27. Human cohort only; agents, `--json`, CI and pipes keep today's behavior.
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A person who runs `new`, `add` or `create` at a terminal without the required arguments picks them from a list instead of reading a usage error, then sees the exact command the picks stand for |
| Traces to | The human audience in `.claude/rules/cli/cli.md` "Three audiences"; "ask your agent" stays the main entry point (D9), so this is for the person who runs the CLI directly |
| Depends on | 3.0 (`add`), 3.1b (`create`), 1.2a (`new`), 1.4 (handoff). Soft: 4.4a, whose color decision the pickers' theme follows |
| Blocks | Nothing |
| Decisions needed | None beyond agreeing this plan |
| Settles | When the CLI may prompt, which prompts exist, and that a prompted run is the same as the flagged run it prints |

## Scope

In:

- `new` with no stack: pick a stack, then optional fragments, then a preset, then the target directory.
- `add` with no fragments: pick from the fragments that fit the project (the `list` project view's addable set).
- `create` with no kind or id: pick a kind, enter an id, and pick `--from` when copying.

Out:

- Prompting anywhere else, or for values that have a working default.
- Any prompt under an agent, with `--json`, in CI, or when stdin or stdout isn't a terminal. Those keep the current `Usage` error with its `details`.
- A wizard over every flag (effect/cli's `--wizard` stays as the framework ships it).

## Design

### When to prompt

A pure `core/prompting.ts::canPrompt({ audience, stdinIsTTY, stdoutIsTTY })` is true only for the `human` audience with both streams on a terminal; `resolveAudience` already folds agent detection, `--json` and CI into the audience. Commands check it before failing with `Usage` for a missing argument. Untrusted entries are listed with their origin and never preselected; picking one leads to the same confirmation and handoff rules as passing it by name, since the picks go through the same code path.

### How

Pickers are built with effect/cli's `Prompt` (`Select`, `MultiSelect`, `AutoComplete` for long lists, `Text` for ids), run through Effect's `Terminal` service, which `core/create.ts` already uses for its confirmation. The choices come from the same data the command already reads (`core/list.ts` for stacks and addable fragments), so there's no second catalog. A finished prompt yields the same parsed flag values the parser would; the command then prints one line, `Running: stacks new <stack> <dir> --with a,b --sandbox`, rendered with `core/shell.ts::shellArg`, and continues exactly as the flagged command would. Ctrl+C during a prompt is `Terminal.QuitError`, mapped to the existing interruption path (exit 130, nothing written).

## Files and areas touched

| Path | Change |
|---|---|
| `src/core/prompting.ts` | New: `canPrompt` and the three picker programs |
| `src/commands/new.ts`, `src/commands/add.ts`, `src/commands/create.ts` | Call the picker when an argument is missing and `canPrompt` holds |
| `tests/helpers/` | A scripted `Terminal` layer that feeds keys and records output |
| `packages/cli/README.md`, `.claude/rules/cli/cli.md` | When the CLI prompts |

## Acceptance tests

1. `new` with no stack in agent mode, with `--json`, and in human mode with non-terminal stdin each fail `Usage` (exit 2) with today's details, and the scripted terminal records no reads.
2. `new` with no stack in human mode with a scripted terminal (select stack, select two fragments, accept preset, type a directory) writes the same files and manifest as the printed `Running:` command run with flags in a fresh directory.
3. `add` with no fragments offers exactly the project's addable set, in `list`'s order.
4. `create` with no arguments, picking "copy", lists only stacks and fragments from trusted roots first and marks project-origin ones.
5. Ctrl+C at any prompt exits 130 and leaves the target directory absent.
6. A picked untrusted fragment produces the same untrusted-entry confirmation as naming it on the command line.

### Realistic edge cases

7. CI with terminal streams, agent markers, JSON and pipes never read the terminal for missing `new`, `add` or `create` arguments and preserve each command's current result.
8. A picked directory with spaces, quotes, a leading dash and non-ASCII text through a symlinked parent replays from the printed command with identical files and manifest content apart from invocation ids and timestamps.
9. Picking an occupied target reports the existing target error and preserves all existing files.

## Exit criteria

- Acceptance tests pass; the gate is green.
- Manual QA in a real terminal (`bun run human -- new --no-launch`, `add`, `create`), recorded in the implementer's QA note, including arrow keys, filtering a long list and Ctrl+C.

## What this plan may get wrong

- 2026-10-27: Bare `create` currently prints help and succeeds outside the human terminal cohort, rather than failing Usage. Preserve that behavior. Its first menu combines stack skeleton, fragment skeleton and copy; copying then picks a kind/id/origin together, excluding user-origin sources because `create --from user` is refused.
- 2026-10-27: Numbered line input supports neither arrow-key selection nor filtering. QA uses numbers and comma-separated selections, as the settled contract requires, without terminal redraws.
- 2026-10-27: `add` needs a nonempty selection: blank input retries, while an empty addable set prints that no fragments are available and exits without prompting or writing. The command echo escapes terminal controls, and `new` validates explicit template values before collecting picks or printing the echo.
- 2026-10-27: `resolveAudience` did not fold CI into the audience, though AGENTS.md lists CI as an `agent` audience. A set `CI` now resolves to `agent` in `services/output.ts::resolveAudience`, so `canPrompt` keeps its three inputs and CI at a terminal gets agent output and no prompts.
- effect/cli's `Prompt` inside the Bun-compiled binary hasn't been tried; `create`'s confirmation shows `Terminal` works, but the richer prompts redraw more. Run the compiled binary early.
- People may expect `new` with no arguments to show the agent guide or help instead. If manual QA finds that confusing, print the picker's first line as "No stack given; pick one (Ctrl+C to quit)".
- The `Running:` echo assumes every pick maps to a flag. If a pick ever doesn't, that pick is the bug, not the echo.
- 2026-10-27: `Prompt.select` and `MultiSelect` redraw with cursor movement, which `.claude/rules/cli/cli.md` forbids. [4.4c](phase-4.4c-agent-picker-2026-10-30.md)'s agent picker is a numbered list read with `Terminal.readLine` for that reason; build these pickers on it rather than add a second prompt mechanism, or change the rule first.
