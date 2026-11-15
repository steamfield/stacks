# core/compose

This folder works out what a project gets when a stack and fragments are combined. `stacks new
<stack>` and `stacks add <fragment...>` both start here, and so do the previews in `stacks show`
and the checks in `stacks validate`.

A stack is a recipe for a whole project; a fragment is a reusable addition (CI, git hooks, a
database) that composes onto one. The result of combining them is a composition: which fragments
were chosen and why, the files to write and who owns each, the verify steps, env defaults,
commands, decisions, tools and dependencies. Nothing is written here. The composition is a plan
that other folders turn into a brief, a manifest and files on disk.

## How it fits

Callers:

- `core/scaffold/new.ts` composes for `stacks new`, renders with `files.ts::composeFilesWithNeutral`
  and looks up tools with `tools.ts::missingToolsOnPath`.
- `core/add/prepare.ts` composes in add mode for `stacks add` and renders with
  `files.ts::composeFiles`.
- `core/show.ts`, `core/validate/` and `telemetry/composition.ts` compose to preview or check.
- `core/fingerprint.ts` hashes `composeFiles` output rendered with `NEUTRAL_VARS`.
- `core/brief/` renders a `Composition`; `core/manifest.ts::buildManifest` records one.

This folder depends on `core/registry/` for entries (every read goes through the `Registry`
service), `core/template.ts` for `.tmpl` rendering and `services/processes.ts` for the one PATH
lookup. `scaffold/` and `add/` depend on it, never the reverse. The `core/` boundary rules apply
(AGENTS.md, "Conventions"): no imports from `platform/` or `commands/`, and no Node builtins.
Nothing here runs a command from an entry; `tools.ts` only asks whether a tool is on PATH (Trust
model point 1 in `.claude/rules/architecture.md`).

The composition feeds digests that tests pin (`tests/digest-golden.test.ts`,
`tests/fingerprint-snapshot.test.ts`), so the order of every list is behavior: fragment order,
step order, env and decision order, file owner order and JSON merge semantics.

## The main flow

`compose.ts::compose` runs:

1. `selection.ts::selectFragments`: load the stack, check `--with` and `--without`, then select
   the stack's required fragments, its defaults, the user's `always`, `--with`, and everything
   their `requires` pull in. Check the whole set (one app at most, declared `conflicts`, fit) and
   order it: requirements first, ties by id, the app last.
2. `checkPayload`: a `--payload` other than the example must exist in the stack.
3. Resolve each body's `stacks:when` blocks for this composition (`conditionals.ts`). In add
   mode, also collect the recipe notes: blocks in the stack and applied fragments that name a new
   fragment.
4. `plan-files.ts::planFiles`: pick the files that ship for these agents, this stack and payload,
   give each path one owner or a JSON merge, and refuse reserved or colliding paths.
5. Aggregate verify steps (unique names, the app's tagged `app`), commands, env (a clash is a
   conflict), decisions, tools, dependencies and the untrusted entries.

Rendering is a separate step the caller takes: `files.ts::composeFiles` reads every planned
source and renders templates with a set of template values.

## Files

| File | What it owns |
| --- | --- |
| `compose.ts` | `compose`, the aggregation helpers (`mergeCommands`, `mergeEnv`) and the tool hints (`missingTools`, `dropFlags`) |
| `selection.ts` | `selectFragments`: which fragments are chosen, how each got in, and their order; `fitsStack` |
| `plan-files.ts` | `planFiles`: one owner or merge per output path, reserved-path and collision checks |
| `files.ts` | `composeFiles` and `composeFilesWithNeutral`, the one renderer; `NEUTRAL_VARS` |
| `conditionals.ts` | `stacks:when` blocks: `resolveConditionals`, `scanConditionals`, `isConditionalMarker` |
| `merge.ts` | `deepMerge`, the JSON merge for files several entries write |
| `conflicts.ts` | `conflict` and `parties`, the `ComposeConflict` builders |
| `agents.ts` | `targetAgents`: which agents get adapter files |
| `tools.ts` | `missingToolsOnPath`: tools a composition needs that aren't on PATH |
| `types.ts` | `ComposeOptions`, `Composition`, `PlannedFile`, `ComposedStep`, `MissingTool` and the rest |

## Terms

- Via: how a fragment entered the selection. `required` (the stack's required list and its
  requirements), `default`, `always` (`Settings.always`), `with` (`--with`) or `requires` (pulled
  in only by another fragment). It decides which rules apply, such as whether `--sandbox` or
  `--without` can drop the fragment, and which flag a missing-tool hint suggests.
- Composition order: the stack first (in `new` mode), then the fragments in selection order.
  Later entries override earlier ones for commands; env clashes and duplicate step names fail.
- Pin: a fragment version a stack records in its `composition` field. The pin is used unless the
  user has a project or user registry copy of that fragment.
- Existing fragments: in add mode, the fragments the project already has. They satisfy
  requirements and count in conflict checks, but emit nothing again.
- Recipe notes (`addNotes`): in add mode, the stack's and applied fragments' `stacks:when` blocks
  that name a fragment being added, shown in the brief under that fragment.
- Planned file: one output path and how it is produced: `copy`, `template` (a `.tmpl` source) or
  `merge` (several writers that all list the path in `merge`).
- Neutral values (`NEUTRAL_VARS`): fixed template values used for the fingerprint, so it doesn't
  change with the project name, author or year.

## Where to start

Read `compose.ts::compose` for the sequence, then `selection.ts::selectFragments` for the
selection rules. Tests: `packages/cli/tests/compose.test.ts` covers selection, conflicts and
aggregation; `compose-files.test.ts` rendering; `conditionals.test.ts` and `merge.test.ts` their
modules; `fingerprint.test.ts`, `fingerprint-snapshot.test.ts` and `digest-golden.test.ts` the
pinned digests; `bundled-compositions.test.ts` every bundled stack's compositions.
