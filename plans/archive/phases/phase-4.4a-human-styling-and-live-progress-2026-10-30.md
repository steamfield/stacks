# Phase 4.4a: Human styling and live progress

Status: EXECUTED 2026-10-27. Human cohort only; nothing here changes json or agent output.
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A person at a terminal gets colored status words, a live progress line while `verify` and `new` work, and text wrapped to the terminal's width, with no new dependency and byte-identical json and agent output |
| Traces to | The human audience in `.claude/rules/cli/cli.md` "Three audiences"; the expectation that coding agents are most of the CLI's users, so this lands late and only for people |
| Depends on | 1.3a (`verify`'s per-step progress lines), 1.2a (`new`), 3.1a (`show` text). Nothing in 4.0 to 4.3 |
| Blocks | Nothing. 4.4b may reuse the color decision |
| Decisions needed | Agreeing this plan reverses two written rules for the human audience only: `.claude/rules/cli/cli.md`'s "No colors, spinners or cursor movement" and AGENTS.md's "No colors are currently emitted". Both change in the commit that executes it |
| Settles | Where the color decision lives, which words are colored, how live progress renders, and how width is measured without Bun in core |

## Scope

In:

- Color for a fixed set of human-text elements: the failure line and `Error:` prefix, warnings, step outcomes in `verify` rows (`passed`, `failed`, `skipped`), proof labels in `list` (`historical pass`, `unproven`), and the `Next:` line.
- One live line on stderr for long steps: `verify`'s running step with its elapsed time, and `new`'s write and `git init` stages.
- Wrapping human paragraphs (guide text, `show` guidance, `list` descriptions) to the terminal width, falling back to today's output when the width is unknown.

Out:

- Anything in `--json` or agent output. Those keep their exact bytes.
- A full-screen or alternate-screen TUI, mouse input, themes or user-configurable palettes.
- New runtime dependencies (`chalk`, `ora`, `ink` and similar).

## Design

### The color decision

`AppConfig` reads `NO_COLOR` and `FORCE_COLOR` (only config reads env). `services/output.ts` decides once per invocation: color is on only when `resolveAudience` returns `human`, `NO_COLOR` is unset or empty, and stderr or stdout (per stream) is a terminal; `FORCE_COLOR=1` turns it on for the human audience even through a pipe, which `bun run human` and tests use. The agent and json audiences never color, whatever `FORCE_COLOR` says.

Output exposes `style(kind, text)` where `kind` is a closed union (`error`, `warn`, `ok`, `skip`, `dim`, `next`). Renderers call it; it returns `text` unchanged when color is off. Escape sequences come from `node:util` `styleText` called with `validateStream: false`, because the decision is already made and core never reads streams. Nothing else in the codebase writes ANSI.

### Live progress

`Output.progress` already writes human-only lines to stderr and stops after the first write error. Add `Output.live(label)`, a scoped handle: it forks a fiber that redraws one line (`\r` plus clear-line) every 100 ms with a spinner frame and elapsed time from `Clock`, and on scope close clears the line and prints the final row through the normal path. It's a no-op for non-human audiences or a non-terminal stderr. `verify`'s `runStep` and `new`'s write stages open one around each long step. Child output that `verify` passes through still goes to its own stream; the live line is cleared before any pass-through write and redrawn after.

### Width

`Host` gains `columns: Option<number>` and `stringWidth: (s: string) => number`, supplied in `bin.ts` from `process.stdout.columns` and `Bun.stringWidth`, and in `tests/helpers/cli.ts` from fixed values. A pure `core/wrap.ts::wrap(text, width, measure)` breaks on spaces, never inside a word or escape sequence, and leaves lines starting with indentation, `-` or a code fence alone. Renderers wrap only in human mode and only when `columns` is present.

## Files and areas touched

| Path | Change |
|---|---|
| `src/config.ts` | `NO_COLOR`, `FORCE_COLOR` in `AppConfig` |
| `src/services/output.ts` | Color decision, `style`, `live` |
| `src/services/host.ts`, `src/bin.ts`, `tests/helpers/cli.ts` | `columns`, `stringWidth` |
| `src/core/wrap.ts` | New, pure |
| `src/core/verify/report.ts`, `src/core/verify/step.ts`, `src/core/scaffold/report.ts`, `src/core/list-report.ts`, `src/core/show-report.ts`, `src/errors.ts` (human error rendering) | Call `style`, `live`, `wrap` |
| `AGENTS.md`, `.claude/rules/cli/cli.md`, `packages/cli/README.md` | Replace "no colors" with the rule above |

## Acceptance tests

1. Every command run with `--json` and in agent mode under `FORCE_COLOR=1` produces stdout and stderr with no ESC byte, and the same bytes as with color off.
2. Human mode with `FORCE_COLOR=1`: a failing `verify` colors the `failed` row and the `Next:` line; `NO_COLOR=1` alongside it removes every escape.
3. Human mode with a non-terminal stdout and no `FORCE_COLOR` emits no escapes.
4. `Output.live` under `TestClock`: advancing 350 ms draws 3 frames on stderr; closing the scope clears the line and writes the final row once; an EPIPE on stderr stops drawing without failing the command.
5. `verify` with a step that prints output: the live line never appears inside the passed-through output.
6. `wrap` property test: joining the wrapped lines with spaces gives back the input words in order, no line is wider than `width` unless it's a single word, and escape sequences are never split.
7. Compiled binary under `bun run human -- verify` shows a colored summary; `NO_COLOR=1 bun run human -- verify` shows none.

### Realistic edge cases

8. Inherited agent markers override forced color; empty `NO_COLOR` allows color, nonempty `NO_COLOR` wins over `FORCE_COLOR`, and fresh invocations do not share the color decision.
9. Wrapping preserves ANSI sequences, wide and combining characters, indentation, list items, code fences and paragraph breaks; empty text and overlong words remain intact.
10. Human `guide`, `show` guidance and `list` descriptions honor injected terminal columns and display width; unknown width retains current output and agent output ignores columns.
11. Closing a live scope after failure or interruption clears its line and stops its fiber; a fresh invocation still draws after an earlier stderr failure.

## Exit criteria

- Acceptance tests pass; the gate is green.
- Manual QA as a person in a real terminal (`bun run human`) for `list`, `show`, `new --no-launch`, `verify` (green and failing) and an error, recorded in the implementer's QA note.
- AGENTS.md and `rules/cli/cli.md` describe the new color rule in the same commit.

## What this plan may get wrong

- 2026-10-27: renderer integration also needs the `guide`, `list`, `show`, `new` and `verify` command handlers to pass terminal layout and styling values, plus the shared handoff renderer for `new`'s `Next:` line. Existing `stdoutColumns` remains for compatibility with the earlier list layout; `columns` supplies the new optional width contract. A PTY can report zero columns, which bin treats as unknown.
- 2026-10-27: asynchronous stderr writes can outlast a redraw interval. The scoped ticker starts a child redraw only when the writer lock is available, skipping busy frames instead of queuing them; normal output rows share the lock. This also lets TestClock advance the ticker independently of a writer promise.
- 2026-10-27: setting both `NO_COLOR` and `FORCE_COLOR` makes Node 24 print its own precedence warning before the CLI starts. The CLI still honors `NO_COLOR` and writes no escapes; human QA without `FORCE_COLOR` has no runtime warning.
- 2026-10-27: review found that descriptions need plain-word wrapping rather than Markdown block detection, and `show` must escape entry text before measuring it. `wrapWords` shares the word-breaking implementation while preserving the existing description normalization. Fences retain their opening character and length. Live frames also need a measured width bound, keeping elapsed time and truncating the label by grapheme to avoid stale rows on narrow terminals.
- 2026-10-27: the new Host fields also affect `tests/fixtures/handoff-bin.ts`, outside this contract's allowed files; it needs explicit `stderrIsTTY`, `columns` and `stringWidth` values. The configuration reference and roadmap shared-contract table also need follow-up edits outside this scope. Regression tests from the required review are in a separate unlocked file.

- `Bun.stringWidth` is documented; `Bun.wrapAnsi` was not verified, which is why wrapping is a small pure function here instead.
- Bun's `node:util` `styleText` may differ from Node's in the codes it emits; acceptance test 7 runs the compiled binary for that reason.
- Redrawing a line while a child writes to the same terminal can still interleave if the child writes to the tty directly rather than through our pipes. If that shows up, drop the live line for steps that inherit the terminal.
- People may not want color at all in a tool they mostly see through an agent. If manual QA says the plain output already reads well, shrink this to the live line only.
- 2026-10-27: acceptance tests 2 and 7 require no ESC byte at all under `NO_COLOR`, and the live line's redraw and clear are escape sequences. A nonempty `NO_COLOR` therefore turns off the live line too (it falls back to today's `Output.progress` lines), so one decision gates every escape the CLI writes.
- 2026-10-27: the CLI runs under Node, where `Bun.stringWidth` doesn't exist. `bin.ts` supplies `Host.stringWidth` from `node:util` `stripVTControlCharacters` and `Intl.Segmenter` graphemes (wide East Asian and emoji graphemes count 2, combining marks 0), with no new dependency.
