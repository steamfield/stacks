# core/brief

This folder writes the brief: `.stacks/BRIEF.md`, the task text a coding agent reads first after
`stacks new` or `stacks add`. The brief tells the agent what stacks wrote, what to install and
decide, what each stack and fragment asks for, and what "done" means (a green `stacks verify`).

A stack is a recipe for a whole new project; a fragment is a reusable addition (CI, git hooks, a
database) that composes onto one. Combining them gives a composition: the files, verify steps,
env and notes of the result. The brief is one rendering of a composition, written for an agent
rather than a person.

## How it fits

Three callers render a brief through `render.ts::renderBrief`:

- `core/scaffold/new.ts` writes it into a new project.
- `core/add.ts` writes the add brief after fragments are applied to an existing project.
- `core/validate/budget.ts` and `core/validate/add-compositions.ts` render canonical briefs to
  check them against their word budgets (`budget.ts::BUDGET`).

`renderBrief` is pure. It takes a `Composition` from `core/compose/` and a `BriefContext` of facts
the composition doesn't carry (project name, git state, written files, missing tools) and returns
the text with its word counts. It reads no files and runs nothing, so the same inputs always give
the same bytes. Tests pin those bytes by digest, so a change to any sentence, blank line or
section order shows up as a failing test.

Other modules borrow two helpers: `words.ts::countWords` is the CLI's one word counter (used by
`show` and the validate checks), and `paths.ts::collapsePaths` shortens the written-file listing
for `core/scaffold/report.ts` too. `core/validate/` uses `headings.ts::proseLines` to read
Markdown outside code blocks.

The `core/` boundary rules apply (AGENTS.md, "Conventions"): nothing here imports `platform/` or
`commands/`, and nothing here touches the filesystem.

## The main flow

`renderBrief` checks whether the context carries an `add` section. If it does, the add brief is
written by `render-add.ts::renderAddBrief`. Otherwise it writes a new-project brief, one section
per `write*` step, in this order:

1. The title, then the untrusted entries, if any, so the agent stops and asks the user before
   reading anything they wrote (Trust model point 3 in `.claude/rules/architecture.md`).
2. Start here: a numbered action list. Step 1 is the install command when `installCommands` can
   spell it (single-package Bun and uv stacks); otherwise it points at the dependency list.
3. Facts, versions and ground rules.
4. Decisions, then dependencies and tools.
5. The stack's guidance and each fragment's, with headings nested under their section by
   `headings.ts::nest`.
6. The definition of done: the verify step table, the commands and environment tables and the
   rules. With an app (a fragment with category `app`) this covers the base, and a separate
   application section follows.
7. Manual QA, what to do after green, and the sandbox note under `--sandbox`.

The add brief carries only the new fragments' guidance but the whole merged manifest's definition
of done, plus the files parked under `.stacks/incoming/` for the agent to merge.

## Files

| File | What it owns |
| --- | --- |
| `render.ts` | `renderBrief` and the new-project brief's sections; `installCommands` for Start here |
| `render-add.ts` | `renderAddBrief`, the brief for `stacks add` |
| `blocks.ts` | Pieces both briefs share: the step table and command fence, the commands and env tables, the untrusted list, decisions and tool lines |
| `writer.ts` | `briefWriter`, which collects lines and counts the fixed and total words |
| `text.ts` | Every fixed sentence of the brief, so the wording is reviewed in one place |
| `headings.ts` | `nest`, which moves an entry body's headings under its section, and `proseLines` |
| `paths.ts` | `collapsePaths`, which lists a crowded directory as one line |
| `words.ts` | `countWords`, the one word counter |
| `types.ts` | `Brief`, `BriefContext` and `GitState` |

## Terms

- Fixed and data lines: a fixed line is the CLI's own wording from `text.ts` (or a blank line
  between sections); a data line comes from an entry or the composition. `Brief.fixedWords` counts
  only fixed lines, so validate can tell how much of a brief's budget the entries use.
- Base and application: with an app in the composition, the base is the stack and every other
  fragment. The agent builds the base to a `partial` verify first (`verify --skip-tag app`), then
  the application to a full `green`.
- `cli`: `Host.invocation`, the way the agent should spell the CLI (`stacks`, or the `npx` form
  when stacks ran through npx). Every command the brief names uses it.
- Untrusted entry: one found in the project's own `.stacks/` or a registry that
  `STACKS_REGISTRY_DIR` points at (Trust model point 2). The brief names it first and tells the
  agent to ask the user.

## Where to start

Read `render.ts::renderBrief` top to bottom: each line is one section. Then `text.ts` for the
wording. Tests: `packages/cli/tests/brief.test.ts` covers rendering, `nest` and `collapsePaths`;
`bundled-compositions.test.ts` pins the canonical brief bytes of the bundled stacks by digest;
`new.test.ts`, `add.test.ts` and `preview.test.ts` cover the brief as `new`, `add` and
`validate --brief` write it; `words.test.ts` covers `countWords`.
