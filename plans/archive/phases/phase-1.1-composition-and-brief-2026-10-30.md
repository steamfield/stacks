# Phase 1.1: Composition and the brief

Status: EXECUTED 2026-10-26; reviewed, fixed, merged to main (PR #4). Selection order, apps, the
split brief, decision prefixes, `--with` fit warnings and `NotFound` details revised
2026-10-26 for the amended D18

Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Turn a stack id plus `--with`/`--without`, the user's `always` list and a preset into a composition (entries, files, verify steps, commands, decisions, env, and at most one app), and render the brief an agent can follow to a green `verify` without asking anything the brief could have answered, with its verify table, split into base and application when an app is present, and `countWords` |
| Traces to | "a brief that says 'set up testing' without saying which layers, a verify command that doesn't exist, a decision with no default" (the coding agent's frustration); "Success is reaching a green `verify` without asking the user anything the brief could have answered"; Evidence, "stack prose grows without a budget" |
| Depends on | [1.0](phase-1.0-entry-format-and-registry-2026-10-30.md); [0.2](phase-0.2-npm-distribution-artifact-2026-10-30.md) soft (until 0.2 lands, 1.1 declares `Host.invocation` with the constant `stacks`, and 0.2 fills in the `_npx` rule); D18 agreed or explicitly accepted as the working format (D18 blocks the start of 1.1) |
| Blocks | [1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md), [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md), [1.5](phase-1.5-validate-and-brief-budget-2026-10-30.md); later users of `Composition` (2.0a, 3.0, 3.1a) |
| Decisions needed | D18 (above). D5 only for the numbers 1.5 enforces; 1.1 counts words. Open question 7 (does the budget count fixed text): this file follows the contract (fixed text is in `briefWords`) and reports `fixedWords` beside it, so either answer needs no change here. D7 is not needed |
| Settles | Selection order and conflict rules, including `always` misses, `--with` fit warnings, env conflicts, cycles, `--with`/`--without` overlap and the one-app rule; composition order; `.tmpl` on a merge path; conditional prose syntax; the brief's section order, its base and application split, its verify table and fixed rules, including the `## Asked` log used to count interventions |

## Scope

In:

- `compose`: a function from entries and options to a `Composition` that reads only
  through `Registry`.
- Fragment selection: required, default, optional, `--with`, `--without`, the user's
  `always` defaults (from `Settings`), sandbox drops, and the one-app rule.
- `requires` closure with cycle detection, `conflicts`, `appliesTo`, `needsOwnRepo` (as a
  flag for 1.2a). (Frontmatter fields are named here by their decoded camelCase names;
  the YAML keys are snake_case, 1.0.)
- File ownership and JSON `merge` planning (what is written by whom; 1.2a writes).
- Conditional prose blocks.
- Merged `commands`, `env`, `decisions`, `tools` and verify steps, with defaults applied.
- `renderBrief`: the brief text, `briefWords` and `fixedWords`, using `countWords`.
- `Settings` gains `always`, `agents`, `author` and `package_scope` (roadmap, Other
  shared facts: Settings fields).
- `NotFound` gains its closed `details` schema, `{ suggestions }`.

Out:

- Writing anything to disk, rendering `.tmpl` files and the template variable set (1.2a).
  Running anything (1.3a).
- Budget limits and authoring diagnostics (1.5).
- The `add` mode of the brief (3.0). The section order below leaves room for its "Merge
  needed" section.

## Design

### Inputs and output

`ComposeOptions`, `Composition`, `PlannedFile` and `compose` are the roadmap contract
(Types and schemas: Composition), owned here. `AgentId` is 1.0's (Agent ids).

```ts
// src/core/compose/compose.ts
import type { AgentId, VerifyStep } from "../../schemas/entry"

export type ComposeOptions = {
  stack: string
  with: ReadonlyArray<string>
  without: ReadonlyArray<string>
  preset: "default" | "sandbox"
  agents: ReadonlyArray<AgentId>        // adapter targets; see "Target agents" below
  always: ReadonlyArray<string>          // Settings.always
  mode: "new"                            // "add" arrives in 3.0
}

export type PlannedFile = {
  path: string                           // output path, relative (1.0 Dotfiles)
  owner: string                          // entry id; for a merge, the first writer
  kind: "copy" | "template" | "merge"
  source?: { entry: string; file: string } // copy and template: the EntryFile source
  content?: string                       // merge only: the merged JSON, final bytes
  mode: number                           // executable bit from the source file
}

export type Composition = {
  stack: Entry
  fragments: ReadonlyArray<Entry>        // composition order, see below; the app, if any, is last
  app: Entry | null                      // the one fragment with category "app", also in fragments
  files: ReadonlyArray<PlannedFile>
  verify: ReadonlyArray<VerifyStep & { owner: string; skipByDefault: boolean }> // defaults applied
  commands: Record<string, string>
  env: Record<string, string>
  decisions: ReadonlyArray<{ owner: string; text: string }>
  tools: ReadonlyArray<{ tool: string; owners: ReadonlyArray<string> }>
  deps: ReadonlyArray<{ role: string; names: ReadonlyArray<string>; owners: ReadonlyArray<string> }>
  needsOwnRepo: ReadonlyArray<string>    // fragment ids that refuse an enclosing repo
  untrusted: ReadonlyArray<{ id: string; origin: Origin; dir: string }>
  warnings: ReadonlyArray<{ code: "always_not_applicable" | "always_unknown" | "with_not_applicable" | "without_not_selected"; id: string }>
}

export const compose: (
  options: ComposeOptions,
) => Effect.Effect<Composition, NotFound | BadInput | EntryInvalid | ComposeConflict, Registry>
```

`deps` merges every entry's `deps` frontmatter (1.0) by role in composition order: names
under one role are concatenated with duplicates removed, and `owners` lists the entries
that named any of them. Roles keep the order they first appear in. This is the only
consumer of `deps`; the brief renders it (section 7) so the agent installs the packages
the entries were written against, at whatever version is current.

`compose` reads through `Registry` and is otherwise pure, so tests drive it with the
fixture registry from 1.0 and assert on the value. Verify steps go through 1.0's
`withStepDefaults` here, once, so the brief, the manifest (1.2b) and the digest all see
the same defaulted step.

### Selection

An app is a fragment with `category: app` (1.0). The sandbox drop set is the categories
`deploy`, `release` and `app`. In this order:

1. **Required.** The stack's `fragments.required`, plus their transitive `requires`.
   `--without` naming one of them is `ComposeConflict` (reason `required`): the stack's
   own files depend on it. A required fragment that is an app is `ComposeConflict`
   (reason `app_required`): a stack is complete without an app, so an app is only ever
   chosen.
2. **Defaults.** The stack's `fragments.default`, minus `--without` ids, minus, under
   `--sandbox`, fragments in the drop set.
3. **`always`.** The user's `Settings.always`, minus `--without` ids (`--without` beats
   the user's own default) and the sandbox drop set. One whose `appliesTo` doesn't fit
   the stack is skipped with the warning `always_not_applicable`, because `always` is a
   cross-stack preference, not a request for this stack; an `always` id that names no
   fragment is skipped with `always_unknown`.
4. **`--with`.** Each id is added even under `--sandbox` and even if it is an app. One
   whose `appliesTo` doesn't fit the stack is kept with the warning
   `with_not_applicable`: the user named it, and the warning tells them its prose may not
   fit. An id in both `--with` and `--without` is `BadInput` with `details: { id }`; the
   user asked for two opposite things and guessing either is wrong.
5. **`requires` closure** of everything selected so far, transitively. A fragment pulled
   in here is kept even if the sandbox would drop its category, because something that
   was selected needs it. Requiring a fragment named in `--without` is `ComposeConflict`
   (reason `requires`, naming both). Requiring an app is `ComposeConflict` (reason
   `app_required`). A cycle is `ComposeConflict` (reason `cycle`, `details.ids` the cycle
   in order), because there is no "requirement first" order for a cycle.
6. **At most one app.** Two or more is `ComposeConflict` (reason `app_count`, the app ids
   in `details.ids`).
7. **`conflicts`** in both directions; any pair present is `ComposeConflict` (reason
   `conflicts`).
8. **Fit.** A required or default fragment, or one pulled in by `requires`, whose
   `appliesTo` excludes the stack is `ComposeConflict` (reason `applies_to`): the stack
   author listed it, so it is an entry bug that 1.5 also reports.

Ids are checked before selection starts. A `--with` or `--without` id, or the stack id,
that names no entry fails `NotFound`. Its closed `details` is `{ suggestions }`: up to
three known ids of the right kind from 0.3a's `src/core/suggest.ts::closest` (the same
rule the parser uses for mistyped subcommands); the full set is one `list --json` away. A
`--without` id that is a known fragment but isn't in the composition (not a default, not
`always`) is skipped with the warning `without_not_selected`: the user's intent, "not
this one", already holds. Decided here against a silent skip for unknown ids, because an
unknown `--without` is almost always a typo, and a typo there would quietly keep the
fragment the user meant to drop.

Warnings go into `Composition.warnings`; 1.2a puts them in its result and logs each one at
`Warn` on stderr in human mode.

A `--with` fragment whose `appliesTo` excludes the stack is now kept with a warning
rather than refused, which reverses what this plan first proposed and what
[open question 26](../../risks-and-open-questions.md#open-questions-for-the-maintainers)
asked the maintainers to confirm. The reason: `--with` is an explicit request, `appliesTo`
is an author's guess about fit, and refusing an explicit request on a guess sends the
user to edit the entry. The warning keeps the mismatch visible.

#### Target agents

`ComposeOptions.agents` is decided by one function, `compose/agents.ts::targetAgents`,
in this order: `new --agents` if given; else `Settings.agents` if set and non-empty; else
`["claude"]`. A detected calling agent (`AppConfig.agent`, 1.2b) does not change the set:
a Codex session that runs `new` without `--agents` still gets Claude Code's adapter
files plus `AGENTS.md`, which every agent reads. Kept on purpose for the MVP, because the
bundled adapters are Claude Code's only and adding an agent with no adapter content would
change nothing but the manifest.
[Open question 28](../../risks-and-open-questions.md#open-questions-for-the-maintainers)
asks whether a detected non-Claude agent should win; 3.4b adds the other agents' native
adapters, which is when that answer starts to matter. 3.0's `add` reads the manifest's
`agents` first (its own rule).

#### Composition order

The stack first, then the selected fragments in topological order by `requires` (a
requirement before the fragment that needs it), ties broken alphabetically by id, and
the app last. Order decides JSON merge precedence, verify step order within a phase, and
the order of sections in the brief, so it must be deterministic: same inputs, same order,
whatever order the flags were given in. Ordering by id rather than by how a fragment was
selected means `--with a,b` and `--with b,a` compose identically.

### Files

Paths are output paths from `Registry.files` (literal names; 1.0, Dotfiles). Every output
path has one owner. Two entries writing the same path is `ComposeConflict`
(reason `file_owner`), unless every writer lists that path in `merge`, in which case the
files are JSON-parsed and deep-merged in composition order: objects merge recursively,
arrays concatenate with duplicates removed, later scalars win. A file listed in `merge`
that doesn't parse as JSON is `EntryInvalid` (reason `merge_json`).

A `.tmpl` source whose output path is listed in `merge` is `EntryInvalid` (reason
`merge_template`). Decided here, against rendering templates before the merge: rendering
needs the template variables (1.2a), which depend on the target directory and the clock,
so the merge would move out of `compose` and 1.5's canonical render would have to fake
them. Merged files are agent and tool config (hook lists, settings), which have no
project-specific values in practice. If one ever needs a variable, the entry ships it
as a single-owner template instead.

`adapters/<agent>/` files are included only for agents in `options.agents`. Files whose
source ends `.tmpl` are planned as `template` with the suffix dropped from `path`; 1.2a
renders them. `compose` checks that no planned path escapes the project root (`..`
segments, absolute paths); 1.2a checks real paths at write time.

Shared prose files (`AGENTS.md`, `README.md`, `Makefile`) are never merged. The owning
entry ships the skeleton; other entries describe their additions in prose, and the agent
writes them.

### Verify steps, commands, env

Steps come from the stack, then fragments, in composition order, so an app's steps come
last. Names must be unique across the composition (`ComposeConflict`, reason
`step_name`). Every step the app owns gets the tag `app` added here; entries can't write
that tag themselves (1.0), so `app` always means "the app's step" to 1.3a, the digest and
3.5b. Under `--sandbox`, steps tagged `prod` stay in the composition with
`skipByDefault: true`, so `verify --all` can still run them (1.3a).

`commands` merge as records in composition order; a later entry's purpose replaces an
earlier one's, which lets a fragment redefine what `check` means.

`decisions` keep the stack's as written, then each fragment's in composition order with
its text prefixed `<fragment-id>: `, so the agent can tell which piece a default belongs
to when two fragments decide similar things.

`env` merges the same way, except that two entries giving the same key different defaults
is `ComposeConflict` (reason `env`, `details: { key, ids }`). Same key, same value is fine.
Decided here: a silent override of `PORT_WEB` would make one entry's prose and probe URL
point at a port the other entry moved.

### Conditional prose

```markdown
<!-- stacks:when stack=go-cli,python-react preset=default -->
Wire the client into the Makefile's `test` target.
<!-- stacks:end -->
```

The marker syntax is the roadmap contract (Other shared facts: Prose markers), owned here:
`<!-- stacks:when key=v,v2 key2=v -->` opens a block and `<!-- stacks:end -->`
closes it.

| Key | Matches |
|---|---|
| `stack` | The stack id |
| `tag` | Any of the stack's tags |
| `tag!=` | None of the listed tags |
| `mode` | `new` or `add` (`add` from 3.0) |
| `preset` | `default` or `sandbox` |
| `with` | A fragment id present in the composition (an app included) |

Commas are OR within a key; several keys on one marker are AND. Blocks don't nest. Each
marker is alone on its line. A matching block loses its two marker lines; a
non-matching block is removed whole. Unknown keys, nesting and unclosed blocks fail
with `EntryInvalid` (reason `conditional`, with the entry-relative line number), so a
typo never leaks raw markers into a brief. 1.5 adds the warnings (unknown stack ids,
tags no stack declares).

### The brief

`renderBrief(composition, context): { text, briefWords, fixedWords }`, where `context`
carries the project name, git state (`fresh`, `parent` with its toplevel, `none`), the
list of written paths, missing tools (each with the `--without` id that would drop it,
from 1.2a), `yes` (from `--yes` or `--sandbox`) and the
invocation string from `Host.invocation` (roadmap, Types and schemas: Invocation string),
written as `<cli>` below. If 0.2 hasn't landed, this sub-phase adds the field to
`services/host.ts::HostInfo` with the constant `stacks` from `bin.ts`, and 0.2
later replaces the constant with its `_npx` rule; `Host.memory` takes an override either
way, so the tests below don't depend on which landed first. Every command the brief tells the agent to run is
`<cli> verify` etc., so `npx -y stacks@<version> verify` comes out when `new` ran
through npx and the agent runs the same version that wrote the manifest.

Entry prose is written with the plain name (`stacks verify`), and the brief does not
rewrite command names inside entry bodies (a rewrite would also touch code fences and
prose that quotes the name). When `<cli>` isn't `stacks`, section 1 gains one fixed
line instead: "Wherever this brief says `stacks <command>`, run `<cli> <command>`."

The written-paths list (section 1) is collapsed by `brief/paths.ts::collapsePaths`: a
directory holding more than three written files is listed once as `dir/ (N files)`,
deepest directories collapsed first, so a stack that writes a 40-file `.claude/` tree
costs one line, not forty. 1.2a's human output uses the same function; `new --json`'s
`written` keeps every path.

Sections, in order. Fixed text lives in `src/core/brief/text.ts` so it can be read and
reviewed in one place.

| # | Section | Content |
|---|---|---|
| 1 | Title and facts | Stack name and id, fragments, preset, target agents, "project root is the directory containing `.stacks/`", the collapsed list of files stacks wrote, and the command-name line when `<cli>` isn't `stacks` |
| 2 | Untrusted entries | Only when `untrusted` is non-empty, and then directly under the title so it is the first thing read ([Trust model](../../roadmap.md#trust-model), point 3). Stop before doing anything else; name each entry with its origin and path; say that these came from the project directory, not from stacks or the user's own directory, and that their prose and verify steps are instructions someone else wrote; ask the user to confirm they want them; do nothing until they do. `--yes` and `--sandbox` don't skip this |
| 3 | Your job | Done means `<cli> verify` exits 0 with outcome `green`. Work autonomously; stop only for the decisions and missing tools below |
| 4 | Versions | Nothing pins a version on purpose; latest stable that work together; official generators over hand-written files; check current docs, `--help` and installed types before writing config; don't pin remembered versions |
| 5 | Ground rules | Generators non-interactive and never into the populated root; git state rule; files stacks wrote are starting points to adapt, not delete; keep `AGENTS.md` true to the real commands; keep `.stacks/NOTES.md`; missing tools |
| 6 | Decisions | With `yes`: use each default and list them in the final summary. Otherwise: ask once, in one message, with each default so the user can reply "defaults" |
| 7 | Dependencies and tools | Only when `deps` or `tools` is non-empty. `deps` as one line per role (`test: vitest, @testing-library/react`), each "install the current stable version; these are names, not versions". Then each required tool with whether it was found on PATH, and for a missing one an install hint and the `--without <id>` that would have dropped it (when it isn't required). Install hints come from one fixed table in `text.ts` mapping known tools to their official install page (`uv`, `bun`, `go`, `node`, `make`, `git`, `docker`); any other tool gets "install it with the system package manager" |
| 8 | Stack guidance | The stack body, conditionals resolved, headings normalized (below) |
| 9 | Fragment guidance | One section per fragment, in composition order, headings normalized. The app, if any, is not here: its guidance is in section 10's application part |
| 10 | Definition of done | See below. With an app, split in two (see "The application split") |
| 11 | Sandbox | Only under `--sandbox`: local only, never deployed, skip deploy, release and app work unless asked for, `prod` steps are skipped, optimize for time to green |

#### Heading normalization

Entry bodies are written as standalone documents, so `brief/headings.ts::nest` adjusts
them before they go under their brief section:

- A first non-blank line that is a level-1 heading (`# Anything`) is dropped; the brief's
  own section heading names the entry.
- Every other ATX heading is shifted so the body's shallowest heading lands one level
  below the section heading (the section is `##`, so the body starts at `###`). Relative
  depth is kept; nothing goes deeper than `######`, and anything that would is clamped.
- Lines inside fenced code blocks (between matching ```` ``` ```` or `~~~` fences) are
  never touched, so a shell comment `# install` in a fence stays as it is.
- Setext headings (underlined with `===` or `---`) are left alone; 1.5 warns on them.

#### Section 10: definition of done

The agent can't read `.stacks/manifest.json` as a spec, and shouldn't have to, so
the brief carries what verify will run. In order:

1. **The verify table**, one row per step in run order (phases `setup`, `check`, `serve`,
   `teardown`):

   | Step | Phase | Layer | Runs | Expects |
   |---|---|---|---|---|
   | `install` | setup | install | `make install` | |
   | `docs` | check | docs | `make docs-check` | |
   | `web` | serve | serve | `make dev` | `http://localhost:${PORT_WEB}/` within 60s |
   | `deploy-dry-run` | check | build | `make deploy-check` | skipped (`prod`, sandbox) |

   "Runs" is the `run` command. Steps with `skipByDefault` say "skipped" and why. A
   step's `timeout` is shown only when it isn't the default, and an empty `layer` cell
   means the step set none. A `Layer` or `Expects` column that no step in the table fills
   is left out (2026-10-26; see "What this plan may get wrong").
2. **The commands table**: the merged `commands` with their purposes.
3. **Environment**: each `env` key with its default, then: "If a port is busy, set the
   variable when you run verify (`PORT_WEB=5174 <cli> verify`). Don't change the defaults
   in `.stacks/manifest.json`: `env` is part of the definition of done, and editing
   it fails verify." (Environment precedence over manifest defaults is 1.3a's runner.)
4. **The rules**, as one list:
   - Run `<cli> verify` from the project root. Done is exit 0 with outcome `green`.
   - A command a step calls that doesn't exist yet is yours to create, and it must do
     real work: `make test` runs the tests, `make lint` lints.
   - Don't weaken the definition of done. Weakening is: editing the steps, `env` or any
     other part of `.stacks/manifest.json`; making a project command exit 0 without
     doing its job (`|| true`, `exit 0`, an empty target, a script that only echoes);
     deleting, skipping or excluding tests to get a pass; flags that pass with no tests;
     lowering a lint or typecheck setting until it reports nothing; serving a stub instead
     of the app the probe is meant to reach. Changed steps fail verify (D14); the rest is
     visible in the diff.
   - Stop any dev server you started yourself before running verify, or its port is taken
     and the serve step fails.
   - Serve commands stay in the foreground: the command a `serve` step runs must keep
     running until it is stopped, not start a daemon and exit. Verify starts it, probes
     it and stops it.
   - Run verify with your shell tool's longest timeout. A full run includes installs and
     can take several minutes; a tool timeout that kills it looks like a failure that
     isn't one.
   - When verify fails, read the step name, command and output tail it reports, fix the
     code or config the step exercises, not the step, and run it again.
   - If verify fails with `VerifyChanged` (exit 5, "Verify steps changed since they were
     recorded"), stop. Don't edit `.stacks/manifest.json` back and forth to make it
     pass, and don't run `verify --accept-changes` (it refuses agents). Tell the user
     which steps or settings it says changed, and that only they can accept the change, by
     running `<cli> verify --accept-changes` from their own terminal, or undo it. Then wait.
     This is the D14 rule ([open question 24](../../risks-and-open-questions.md#open-questions-for-the-maintainers)).
5. **Manual QA**: run the dev, test and build commands yourself, fix warnings in their
   output, and exercise what you built, because verify only checks exit codes and HTTP
   probes.
6. **After green**, in order:
   - Check `AGENTS.md` and `README.md` describe the project you built: real commands,
     no `stacks:fill` markers left. Verify doesn't check this unless a step does.
   - Commit, by git state. `fresh`: commit everything with the message
     `chore: scaffold <project> from the <stack> stack`. `parent`: don't commit; list the
     files to commit in the summary and ask the user. `none`: skip commits and say so.
     The message is Conventional Commits because the git-hook fragments enforce it.
   - End with a short summary: what was built, the decisions you took (with their
     defaults), anything you couldn't do, and a pointer to `.stacks/NOTES.md` for
     what the brief got wrong.

#### The application split

When `Composition.app` is set, section 10 becomes two sections, so the agent builds on a
working base instead of debugging the stack and the app at once:

1. **Definition of done: base.** Everything above, over the steps that don't carry the
   `app` tag. Its first rule says to reach green on the base before starting the app,
   with `<cli> verify --skip-tag app` (a `partial` run, which is fine at this point and
   never counts as done).
2. **Then: the application.** The app's body (conditionals resolved, headings
   normalized), its own verify table (the `app`-tagged steps), its commands and env if
   it adds any, and the closing rule: done is a full `<cli> verify` with outcome `green`,
   base and app steps together. The after-green list follows this section.

Without an app the brief has one section 10 as above, and nothing mentions apps. 1.5's
budgets count the whole brief either way (the composed cap is higher with an app; see the
roadmap's Feature gaps row on size budgets). 3.5b later makes verify report the two
stages separately; the brief doesn't depend on it.

#### The NOTES.md rule

One bullet in section 5 with two parts, because the run ledger (2.0c) and the bench (2.0b) read it:

- Append a line under `## Findings` whenever the brief is ambiguous, wrong, names
  something that doesn't exist, or made you guess, and whenever an instruction stopped
  you making a mistake.
- Append a line under `## Asked` every time you ask the user something or the user
  tells you something unprompted, with the time. An empty `## Asked` section means no
  interventions.

This is how interventions are counted in interactive runs (roadmap, Measurement and the
canary). It is self-reported, which is a known weakness (open question 8); bench runs in
2.0b measure it directly.

### Word count

`countWords` and the definition of `briefWords` are the roadmap contract (Types and
schemas: Word count), owned here in `src/core/brief/words.ts`. It is the only word
counter; 1.5, 1.6a and 2.0c import it.

`fixedWords` is `countWords` summed over the brief's segments that come from `text.ts`
(headings, rules, the sandbox section), excluding entry bodies and the generated tables.
Segments are joined with newlines, so the sum is exact and `fixedWords <= briefWords`.
1.5 reports it beside `briefWords` so a CLI wording change that pushes a stack over the
budget is visible (open question 7).

### Settings

`schemas/config.ts::Settings` gains four optional fields, still rejecting excess
properties (roadmap, Other shared facts: Settings fields):

| Field | Type | Read by |
|---|---|---|
| `always` | `string[]` of fragment ids | 1.1 selection |
| `agents` | `AgentId[]`, unknown ids rejected | 1.1 (`ComposeOptions.agents` default), 1.4 (launch order) |
| `author` | `string` | 1.2a (the `author` template variable) |
| `package_scope` | `string`, an npm scope with or without the leading `@` | 1.2a (the `package_scope` template variable, after `new --scope`). Snake_case like entry frontmatter, because authors set it next to the entries that use it |

Today `config.ts::configLayer`'s `get` returns only `{ dataDir }` from the decoded file.
It returns the new fields too, still read lazily and once per invocation.

### Failure modes

| Situation | Error tag | Exit | What the agent sees |
|---|---|---|---|
| Stack id unknown | `NotFound` | 2 | `details: { suggestions: [...] }` (up to 3, from `closest`) |
| `--with` or `--without` names a stack, or an unknown id | `NotFound` | 2 | `details: { suggestions: [...] }` |
| `--without` names a fragment that isn't selected | none | 0 | A `without_not_selected` warning |
| `--with` names a fragment whose `appliesTo` doesn't fit | none | 0 | A `with_not_applicable` warning; the fragment is composed |
| The same id in `--with` and `--without` | `BadInput` | 2 | `details: { id }` |
| Removing a required fragment, a missing requirement, a `requires` cycle, conflicts, a required or default fragment that doesn't fit, a required app, a requirement on an app, two apps, duplicate step name, two owners of a file, two env defaults for one key | `ComposeConflict` | 2 | `details: { reason, ids, path?, step?, key? }`, `reason` one of `required`, `requires`, `cycle`, `conflicts`, `applies_to`, `app_required`, `app_count`, `step_name`, `file_owner`, `env` (1.2a adds `needs_own_repo`) |
| Malformed conditional block, bad merge JSON, a template on a merge path | `EntryInvalid` | 2 | `details: { id, origin, reason, path?, line? }` |
| An `always` fragment that doesn't apply, or doesn't exist | none | 0 | A `warnings` entry |

`ComposeConflict` is the roadmap's Error tags row; this file adds it to `errors.ts` with
its closed `details` schema. It also gives `NotFound` (a base tag) its closed `details`
schema, `{ suggestions }`, and the matching `encodeDetails` and `detailLines` cases; the
roadmap's Error tags row says so. The id the user typed is already in their command, and
the message is fixed per tag, so the details carry only what the CLI computed.

### Settled here

| Question | Answer | Why |
|---|---|---|
| Duplicate file paths | Error unless every writer opts into `merge` | Silent last-writer-wins loses one entry's intent without anyone noticing |
| `.tmpl` on a merge path | `EntryInvalid` | Keeps the merge inside `compose`, with no template context |
| Different env defaults for one key | `ComposeConflict` | A silent override desynchronizes prose, probes and ports |
| `always` fragment that doesn't apply | Skipped with a warning | It's a cross-stack preference |
| `--with` and `--without` overlap | `BadInput` | Contradictory request |
| `--with` a fragment that doesn't apply to the stack | Kept with `with_not_applicable`, reversing the earlier proposal in [open question 26](../../risks-and-open-questions.md#open-questions-for-the-maintainers) | An explicit request beats an author's guess about fit; the warning keeps it visible |
| Apps | At most one, never required, never required by another fragment, ordered last, dropped by `--sandbox` unless asked for; its steps tagged `app`; the brief split in two | One composition algorithm for every entry; a base that is green before the app starts |
| Composition order | Topological by `requires`, ties by id, app last | Same flags in any order give the same composition |
| Unknown id in `--without` | `NotFound` with suggestions; a known fragment that isn't selected is a `without_not_selected` warning | A typo would silently keep the fragment |
| Target agents | `--agents`, else `Settings.agents`, else `["claude"]`; detection doesn't change it ([open question 28](../../risks-and-open-questions.md#open-questions-for-the-maintainers)) | The bundled adapters are Claude Code's only until 3.4b |
| Heading levels in entry bodies | Leading `#` dropped, the rest nested under the section, fences untouched | Authors write standalone documents; the brief needs one outline |
| Malformed conditionals | Hard error at compose time | A brief with raw markers in it confuses the agent more than a refused `new` confuses the user |
| `prod` steps under sandbox | Kept, `skipByDefault` | `verify --all` must be able to run the full definition |
| Fixed brief text | Counted in `briefWords`, reported as `fixedWords` | The contract counts what the agent reads; `fixedWords` keeps the CLI's share visible |
| Interventions | Self-logged under `## Asked` | The CLI never sees the conversation (D2); this is the only interactive signal |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/core/compose/compose.ts` | Selection, ordering, files plan, merges, warnings |
| `packages/cli/src/core/compose/conditionals.ts` | Marker parsing and resolution |
| `packages/cli/src/core/compose/merge.ts` | JSON deep merge |
| `packages/cli/src/core/compose/agents.ts` | `targetAgents` |
| `packages/cli/src/core/brief/render.ts`, `text.ts`, `words.ts`, `headings.ts`, `paths.ts` | The brief, its fixed text (including the tool install-hint table), `countWords`, heading normalization, `collapsePaths` |
| `packages/cli/src/schemas/config.ts` | `Settings` gains `always`, `agents`, `author`, `package_scope` |
| `packages/cli/src/config.ts` | `get` returns the new fields |
| `packages/cli/src/services/host.ts`, `src/bin.ts`, `tests/helpers/cli.ts` | Only if 0.2 hasn't landed: `Host.invocation` with the constant `stacks`, overridable in `Host.memory` |
| `packages/cli/src/errors.ts` | `ComposeConflict` and its row; `NotFound`'s `details` schema; `EntryInvalid` reasons `conditional`, `merge_json`, `merge_template` |
| `packages/cli/tests/fixtures/registry/` | Fragments that conflict, require each other (and one pair in a cycle), carry conditionals, merge a JSON file, give a clashing env default, one that applies only to the other stack, a second app, and a fragment that requires an app |
| `packages/cli/tests/compose.test.ts`, `brief.test.ts`, `conditionals.test.ts`, `words.test.ts` | New |

## Acceptance tests

Composition tests use the fixture registry through a real `Registry.layer` on
`NodeServices`; no mocks. Settings come from a real `config.json` in the temp XDG
directory.

1. Default composition of the fixture stack returns required, default and `always`
   fragments in topological order by `requires`, ties by id.
2. `--without` a required fragment fails `ComposeConflict` with `reason: "required"`.
3. `--with` a fragment that requires another pulls both in, requirement first.
4. A conflicting pair fails with both ids in `details.ids`.
5. A `requires` cycle fails `reason: "cycle"` with the cycle's ids.
6. The same id in `--with` and `--without` fails `BadInput` with `details.id`.
7. An `always` fragment whose `appliesTo` excludes the stack is absent from the
   composition and present in `warnings` as `always_not_applicable`; the same fragment
   given in `--with` is composed with a `with_not_applicable` warning; a default fragment
   that doesn't fit fails `reason: "applies_to"`.
8. Two entries with different `PORT_WEB` defaults fail `reason: "env"` with the key; the
   same value composes.
9. `--sandbox` drops a default `deploy` fragment and a default app unless they are in
   `--with`, keeps a `release` fragment that another selected fragment requires, and
   marks `prod` steps `skipByDefault`.
10. Two fragments writing `.claude/settings.json`, both listing it in `merge`, produce one
    planned file whose merged content has both hook arrays, deduplicated.
11. The same two without `merge` fail `reason: "file_owner"`; with one of them shipping
    `settings.json.tmpl`, they fail `EntryInvalid` reason `merge_template`.
12. A fragment shipping `files/.gitignore` plans `path: ".gitignore"`.
12a. Apps: `--with` one app composes it last with every one of its steps tagged `app` and
    `Composition.app` set; `--with` two apps fails `reason: "app_count"`; a stack listing
    an app in `fragments.required`, and a fragment whose `requires` names an app, each
    fail `reason: "app_required"`; requiring a fragment given in `--without` fails
    `reason: "requires"`.
12b. Decisions render the stack's as written, then each fragment's prefixed with its id
    and `: `.
13. Conditionals: a `stack=` block, a `tag!=` block, a `with=` block and a `preset=` block
    each resolve correctly; nested and unclosed blocks fail with the right line.
14. A property test: `compose` is deterministic (same options, same `Composition`), and
    the order of `--with` ids changes neither the set nor the order of fragments.
14a. With an app, the brief has "Definition of done: base" (no `app`-tagged step in its
    table, and the `--skip-tag app` instruction) followed by "Then: the application"
    (the app's body and only the `app`-tagged steps); without one, neither heading
    appears.
15. `renderBrief` for the fixture stack contains each section in order, the verify table
    with every step (the `prod` one marked skipped under sandbox), the env defaults and
    the port override sentence, every rule in section 10, the commands table, no marker
    lines, and every command prefixed with the invocation string. Run with
    `Host.invocation = "npx -y stacks@1.2.3"`, it contains
    `npx -y stacks@1.2.3 verify`.
16. The brief under `yes: false` asks once; under `yes: true` it says use defaults.
17. With a project-origin entry in the composition, the untrusted section comes directly
    after the title, names the entry and its path, and is present under `yes: true`.
18. `countWords` on a known text with fences and markers returns the expected count;
    `briefWords` equals `countWords(text)`; `fixedWords` equals the count of the brief
    rendered from a fixture whose bodies are empty and whose tables are empty.
19. Suggestions: `new fixtrue-stack` fails `NotFound` with
    `details: { suggestions: ["fixture-stack"] }` and no other key;
    `--with lnt` and `--without lnt` both suggest the fixture `lint` fragment; an id with
    no close match has `suggestions: []`. `--without` a known optional fragment that
    isn't selected composes with a `without_not_selected` warning.
20. Target agents: no flag and no setting gives `["claude"]`; `Settings.agents:
    ["codex"]` gives `["codex"]`; `--agents claude,codex` beats the setting. Only the
    selected agents' `adapters/<agent>/` files are planned. (That a detected agent doesn't
    change the set is tested in 1.2b, which owns detection.)
21. Deps and tools: two fixture entries naming `test: [vitest]` and
    `test: [vitest, playwright]` render one `test:` line with `vitest, playwright`; a
    missing tool owned by an optional fragment shows its install hint (or the generic line
    for an unknown tool) and `--without <that fragment>`; a missing tool owned by the stack
    shows no `--without`. No section 7 when both are empty.
22. Headings: a body starting `# Go CLI` with `## Layout` and `### Tests` renders without
    the `#` line, with `### Layout` and `#### Tests`; a fenced `# comment` is unchanged; a
    body whose shallowest heading is `####` is lifted to `###`; nothing is deeper than
    `######`.
23. The brief contains the `VerifyChanged` rule and the after-green list; under git state
    `fresh` it gives the commit message with the project and stack ids, under `parent` it
    says not to commit, under `none` it says to skip commits.
24. With `Host.invocation = "npx -y stacks@1.2.3"` the command-name line is present;
    with `stacks` it is absent. `collapsePaths` on 5 files in `.claude/hooks/` and 2
    in `src/` gives `.claude/hooks/ (5 files)` and both `src/` paths.

## Exit criteria

- All tests pass; `bun run check` green from the repo root.
- `src/core/brief/text.ts` is the only place fixed brief wording lives, and
  `src/core/brief/words.ts::countWords` the only word counter.
- `AGENTS.md` architecture map lists `src/core/compose/` and `src/core/brief/`;
  `packages/cli/README.md` documents `always`, `agents`, `author` and `package_scope` in `config.json`, and
  `--with`, `--without` and `--sandbox` once 1.2a exposes them (note it in the 1.2a
  handoff if 1.2a lands later).
- What was built matches the roadmap contracts this file owns (Composition, Word count,
  Prose markers, the 1.1 Settings fields).

## What this plan may get wrong

- The brief's fixed text is now larger: section 10 adds roughly 300 words of rules to the
  earlier 700, and the `VerifyChanged` rule, the after-green list and the tool hints add
  about 200 more. Against D5's 5,000 that is about a quarter of the budget. Check whether the
  rules can be shorter before 1.6a measures anything; `fixedWords` makes the cost visible.
- The weakening list is a list of examples. An agent can find a form it doesn't name; the
  digest (D14) catches step edits and the rest relies on inspection (Trust model, point 5).
- "Run verify with your shell tool's longest timeout" assumes agents can set one. Some
  tools have a fixed cap below a cold install. If 1.6b's gate runs show verify killed by
  the tool, 1.3a needs a way to run phases separately, not more brief text.
- Self-reported `## Asked` lines may undercount badly. If 1.6b's gate runs show agents
  skipping it, the measure needs a different source (the bench in 2.0b, or the agent's
  own transcript where the user shares it).
- Deep-merging arrays by concatenation is right for hook lists and wrong for ordered
  arrays such as `args`. If a merged file needs replace semantics, the `merge` field has
  to grow a mode, which is a D18 amendment before 1.6a.
- 2026-10-26: the amended D18 changed this plan. Composition order was selection order
  (required, default, always, with) and is now topological with id ties, so flag order
  can't change a brief. `--with` on a fragment that doesn't fit was an error and is now a
  warning. Apps arrived as `category: app` fragments with the one-app rule, the `app` tag
  and the split brief (moved here from the withdrawn 3.5a and the shrunk 3.5b).
  Decisions gained the `<fragment-id>: ` prefix. `NotFound.details` was
  `{ kind, id, known, suggestions }` and is now the closed `{ suggestions }`; if agents
  turn out to need `known`, it can come back as an optional key. 1.3a's missing-manifest
  `NotFound` has to fit the same struct (an optional `looked`).
- The split brief tells the agent to run `verify --skip-tag app` first. If gate runs show
  agents treating that `partial` run as done, the base section needs a stronger line, or
  3.5b's stage reporting has to land before apps ship.
- Treating every env clash as a conflict may be too strict if two fragments both default
  a shared variable such as `NODE_ENV` differently on purpose. If 1.6a hits it, the stack
  should own the key, and the rule can become "the stack's value wins over a fragment's".
- 2026-10-26, from execution:
  - `Registry` gained `read(entry, source)`, which reads one entry-relative file after
    `lstat`ing every path prefix, so a symlink fails `EntryInvalid` `symlink` and any
    other read error is `PermissionDenied` `read`. Compose needs it for merged JSON sources
    and to turn a body line into a file line for `conditional` errors.
  - `Composition` carries `preset` and `agents` beyond the type above, and each
    `untrusted` item is `{ id, kind, origin, dir }` (the brief names the kind). Entry bodies
    in a `Composition` are already resolved, so `renderBrief` is pure and 1.2a and 1.5
    read the same text. The roadmap's contracts table records both.
  - `compose`'s error channel includes `PermissionDenied` (an unreadable merge source or
    entry file). A stack-listed or required id that names no fragment is `ComposeConflict`
    `requires` with `[requirer, id]`, since the caller's flags didn't name it.
  - `BadInput` gained a closed `details: { id }` for the `--with`/`--without` overlap
    (roadmap Error tags updated). `EntryInvalid` gained an optional `line` (the file line
    of a bad conditional marker), and its detail lines are escaped like the others.
  - `missingTools(composition, found)` lives in `compose.ts` beside the data it reads;
    1.2a supplies `found` from `Processes.which`. A tool owned by the stack or a required
    fragment gets no `--without` hint.
  - Markers are processed even inside code fences, so a fenced example of a marker has to
    be indented or escaped. `stacks:fill` lines pass through untouched, including
    `stacks:fill:<text>` with no space; any other `stacks:` directive is an error.
  - `fixedWords` counts every line from `text.ts`, including fact lines with names
    interpolated; entry bodies, decision text, tables and generated lists are data. The
    server and foreground rules appear only when some step is a `serve` step. With an app,
    Manual QA and After green come after the application section, since they apply to the
    full green.
  - Composition-test fixtures are a new `tests/fixtures/registry-compose/` rather than
    additions to `registry/`, whose `list` tests assert exact listings.
  - Measured on the realistic fixture stack (`tests/fixtures/registry-real/`) with its app:
    briefWords 6,027 and fixedWords 1,031 under `--sandbox` (5,990 and 994 without); base
    only, 3,994 and 811 (3,957 and 774), after the review fixes below. With the app the brief is over D5's 5,000, almost
    all of it entry prose; 1.5's budget will flag it.
  - 1.2a owns the `--with`, `--without`, `--sandbox` and `--agents` flags' help text and
    README lines; 1.1 adds no command.
- 2026-10-26, from the review:
  - A stack and a fragment may share an id, so owners in `Composition` (files, steps,
    decisions, tools, deps) are `EntryRef` `{ kind, id }`, and app steps are found by
    entry identity. `ComposeConflict.details` gained an optional `stack`; `ids` holds
    fragment ids only (the plan had every party in `ids`). Human mode prints `Stack:` and
    `Fragments:`.
  - `Composition.selection` records how each fragment was selected, and
    `MissingTool.drop` lists only flags that would leave the tool out: a fragment another
    selected fragment requires is removed together with its dependents, a `--with` owner
    (or the app) gets "dropping `--with <id>`", and a required fragment in that set means
    no hint.
  - Step commands left the verify table: escaping `|` inside a cell changed the command an
    agent copies. The table keeps step, phase, layer and expectations, and a fenced block
    under it lists each command verbatim under a `# name` comment.
  - With an app, the base table names `verify --skip-tag app`, the base rule says the base
    is done at `partial` with every base step passing, and "green" appears only in the
    application section's closing line. The untrusted section now follows the title
    directly, before the facts, which print untrusted entries' names.
  - `EntryInvalid` `conditional` carries `details.problem` (the roadmap Error tags row
    lists the set). Empty comma values (`stack=a,,b`, `stack=`) are `bad_value`.
  - A file whose basename is exactly `.tmpl` is copied, not treated as a template.
  - `collapsePaths` still counts listed lines, not written files: a collapsed
    subdirectory is one line. Counting written files would collapse `.claude/` in this
    plan's own brief example, so the plan's rule and its example disagree; the tests pin
    the line rule.
- 2026-10-26, from manual QA with an imported stack:
  - The verify table's `Layer` and `Expects` columns were always present and empty for
    every step of an entry that sets neither, which is noise for the agent. Each table (the
    base one and the application's, decided separately) now leaves out a column no step in
    it fills; `Step` and `Phase` always stay. `text.ts::done.tableHead` takes the columns.
  - `NotFound` couldn't say whether the stack id or a `--with`/`--without` id was wrong.
    `id` and `kind` came back as optional keys of `NotFound.details`, and human mode
    prints `Stack: <id>` or `Fragment: <id>` (roadmap Error tags).
