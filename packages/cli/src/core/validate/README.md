# core/validate

This folder is everything behind `stacks validate`: the checks an author runs on a registry, or
on one stack or fragment in it, before anyone builds a project from it. With `--brief` it also
renders the brief (the task text the CLI writes for the coding agent) one composition would
produce, so an author can read it and see its size.

## How it fits

`commands/validate.ts` parses the flags and calls four things here, in this order:

1. `target.ts::resolveTarget` works out what the path points at: the bundled registry (no path),
   a registry root (a directory holding `stacks/` or `fragments/`), or one entry inside a root.
2. `index.ts::validate` runs every check and returns a `ValidateReport`, or, for `--brief`,
   `preview.ts::previewBrief` composes one stack and returns a `BriefPreview`.
3. `report.ts` renders either one as text for the `human` or `agent` audience; `--json` prints
   the object itself.
4. Any error finding fails the command as `ValidationFailed`, which keeps the report on stdout.

The checks read entries through `core/registry/` and compose them with `core/compose/` and
`core/brief/`, the same code `stacks new` and `stacks add` use, so a registry that validates
composes the same way for a user. Like the rest of `core/`, this folder never imports
`platform/` or `commands/`. It runs one program, git, with fixed arguments through
`services/processes.ts::Processes` (`git.ts`); nothing an entry holds is ever executed
(`.claude/rules/architecture.md`, "Trust model", point 1).

## The flow

1. `index.ts::validationRoots` puts the target root first, so its entries shadow every other
   origin, then this invocation's own roots. The bundled registry resolves only inside itself,
   because it ships to users who don't have the author's user directory.
2. `snapshot.ts::snapshotRegistry` wraps the `Registry` so repeated compositions share reads.
3. `index.ts` builds the `View` (`types.ts`): the validated entries, the resolution set, every
   entry's source text from `sources.ts::readSources`, and `composed`, the compositions rendered
   once on first use by `composed.ts::composedFiles`.
4. Each module in `index.ts::checks` runs over the view, in that order, and returns findings and
   size rows. A problem in an entry is a finding, never a failure, so one bad entry can't hide the
   others. Only an unreadable root fails the run.
5. `index.ts::compareFindings` sorts the findings: registry-wide first, then each stack and each
   fragment by id, then severity, file, line, check id and message. Size rows keep the order the
   checks produced within each kind.

`validate --submission` appends `submission.ts::submissionChecks`. `preview.ts::previewBrief`
reuses the same list without the checks that start a process or span the whole registry.

## Files

| File | What it owns |
| --- | --- |
| `index.ts` | `validate`, the ordered `checks` list, `validationRoots` and the finding order |
| `types.ts` | `View`, `Check` and the shapes rendering compositions shares with checks |
| `view.ts` | Root-relative paths for findings and the `finding` constructor |
| `sources.ts` | Each entry's raw markdown and shipped file text, for file and line locations |
| `target.ts` | `resolveTarget`: what a `validate [path]` argument points at |
| `report.ts` | The text report, size table and `Next:` line, and the `--brief` text |
| `preview.ts` | `previewBrief`: one composition's brief, counts and findings for `--brief` |
| `snapshot.ts` | A registry wrapper that caches file lists and reads within one validation |
| `format.ts` | Entries that didn't load or were skipped, and frontmatter rules the schema can't express |
| `references.ts` | Every fragment, stack or tag id an entry's frontmatter names resolves |
| `conditionals.ts` | Well-formed `stacks:when` blocks whose ids and tags resolve |
| `conditionals-reach.ts` | Conditional branches for a stack that can never include the fragment |
| `headings.ts` | Underlined (setext) headings the brief can't nest |
| `templates.ts` | GitHub Actions expressions inside `.tmpl` files |
| `files.ts` | Merge files, unreadable files and `shipped` size rows for Markdown an entry ships |
| `git.ts` | Entry files the checkout's own ignore rules keep out of every commit |
| `budget.ts` | `BUDGET`, the word limits, and the canonical context every budgeted brief renders with |
| `compositions.ts` | Body sizes and the compositions each stack is budgeted in, with their brief sizes |
| `composition-findings.ts` | Groups one stack's composition results and turns them into findings, one per failure or warning across presets |
| `composed.ts` | Rendering every composition per agent adapter, and locating a rendered defect's source |
| `compose-each.ts` | Each validated fragment composed with every stack it fits |
| `add-compositions.ts` | Add-mode briefs for each fragment, with and without a host recipe |
| `commands.ts` | Verify steps that run a project command no entry declares |
| `shipped-refs.ts` | Files and commands that shipped configs name but no composition provides |
| `native-config.ts` | Parsing and decoding each agent's own config format |
| `native-refs.ts` | The commands those agent configs run |
| `reference-issue.ts` | `ReferenceIssue`, a config problem before it is placed in a source file |
| `imports.ts` | Relative imports that reach outside an entry's allowed dependencies |
| `verify-notes.ts` | Notes for missing fragment checks and duplicate verify commands |
| `dated.ts` | Prose that will go stale: prerelease words, dates, pinned versions |
| `version-sensitive.ts` | Version literals in shipped tool configs (`package.json`, `go.mod`) |
| `deps.ts` | The dependency allowlist and dependency cards of a root holding `allowlist.json` |
| `search.ts`, `search-examples.ts` | Search cards, the vocabulary and their example selections |
| `ledger-notes.ts` | Notes when a composition has no current proven run in `runs.json` |
| `authors.ts` | `authors.json` decodes and credits only entries that exist |
| `submission.ts`, `patterns.ts` | `--submission` readiness: fill markers, credential shapes, home paths |

## Terms

- **Validated set**: the entries under the target root (`View.entries` and `View.rejected`), or
  only the one entry a path named. Findings are only ever about these.
- **Resolution set**: `View.all`, every winning entry of every origin, used to resolve the ids
  the validated entries name. A reference that resolves only outside the root is a note
  (`resolved-outside-root`), since the result then depends on what this machine holds.
- **Finding**: one problem, with a check id (`unknown-reference`), a severity, the entry, and a
  root-relative file and line when there is one. Severity decides the outcome: an `error` fails
  the command with exit 2, a `warning` fails only the bundled registry's own zero-warning test,
  and a `note` never fails.
- **Size row**: a word count against a limit: an entry's `body`, a `composed` brief, or a
  `shipped` Markdown file (no limit). Agent text shows only rows over their limit.
- **Check**: one module's function from `View` to findings (`types.ts::Check`). Check ids,
  severities, messages and their order are what authors and agents read, so changing one changes
  the CLI's output.

## Where to start

Read `index.ts::validate` for the flow, then `types.ts::View` for what a check can see. Each
check module is self-contained; `references.ts` and `format.ts` are short ones to read first.
AGENTS.md, "Architecture map" (the `src/core/validate/` entry), lists the same pieces in brief.

Tests, all in `packages/cli/tests/`:

- `validate.test.ts`: findings per check, through `stacks validate` on fixture registries.
- `validate-command-edges.test.ts`: paths, targets, exit codes and the three audiences.
- `bundled-registry.test.ts`: the bundled registry validates with no errors and no warnings.
- `gate-findings.test.ts`, `preview.test.ts`, `preview-composition-scope.test.ts`: the gate's
  findings and `--brief`.
- `validate-shipped.test.ts`, `validate-native-*.test.ts`, `validate-rot-*.test.ts`,
  `validate-ledger.test.ts`, `validate-snapshot.test.ts`, `validate-submission.test.ts`: the
  shipped-file, native-config, staleness, ledger, snapshot and submission checks.
