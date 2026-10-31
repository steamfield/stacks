# Phase 1.5: `validate` and the brief budget

Status: EXECUTED 2026-10-26; batch-reviewed, fixed, merged to main (PR #4)

Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `stacks validate [path]` checks a stack, a fragment, or a whole registry directory before anyone spends an agent run on it: schema, composition, conditional prose, the brief budget (D5) measured on a canonical render, and the verify layers (D7). `validate --brief <stack>` prints the brief a composition renders to, with its word counts. The bundled registry passes with zero errors and zero warnings, including while it is still empty |
| Traces to | Open question "What is the brief budget? ... A per-stack cap on brief size, enforced by `validate`, would force the fragment split"; success row "The result is complete"; assumption 1 (agents follow a long brief), tested here only as a hypothesis: a cap keeps every bundled brief inside the size the gate runs (1.6b) are meant to prove |
| Depends on | 1.1 (composition, the brief renderer and `countWords`; `validate` composes and renders, it doesn't reimplement either), and through it 1.0 (entry schema, origins, the registry loader) |
| Blocks | [1.6a](phase-1.6a-bundled-stack-content-2026-10-30.md) and [1.6d](phase-1.6d-guardrail-hook-fragments-2026-10-30.md) (entries are written against it), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (adds the content and staleness checks to the same pipeline), [3.1a](phase-3.1a-show-and-preview-2026-10-30.md) (`show`, and the preview's fingerprint and findings on top of 1.5's `validate --brief`) |
| Decisions needed | D5 (numbers, amended 2026-10-26 to the ones below) and D7 (layers) agreed before this exits; the checks are built with the proposed numbers as constants and change in one place if the maintainers pick others. [Open question 7](../../risks-and-open-questions.md#open-questions-for-the-maintainers) (does the budget count fixed text): built to count it, with `fixedWords` reported; if the answer is "authored text only", the limit applies to `words - fixedWords`, a small change where `compositions.ts` and `preview.ts` compare a size with its limit |
| Settles | The canonical render context; which compositions are budgeted; how references resolve across origins; the severity of each check; the `ValidateReport` and `BriefPreview` shapes |

## Scope

In:

- `validate [path]`: a single entry directory, a registry root (has `stacks/` or
  `fragments/`), or, with no path, the bundled registry.
- Checks in four groups: schema and identity, composition, conditional prose, and
  content (budget, layers, git), listed below with their severity. These are the checks
  the bundled catalog needs to be safe to ship; everything else waits for 2.2.
- A human report and a `--json` report.
- `validate [path] --brief <stack> [--with ..] [--without ..] [--sandbox]`: the brief the
  composition renders to on the canonical context, with `briefWords`, `fixedWords` and
  the limit. Moved here from 3.1a (see "What this plan may get wrong").
- A test that runs `validate` over `packages/cli/registry` through the real command tree
  and requires zero errors and zero warnings. It runs in `bun run test`, so it already
  runs in CI's coverage step with no workflow change. An explicit CI step for the
  bundled registry is [5.0](../../phases/phase-5.0-ci-release-and-checks.md).

Out:

- 3.1a's additions to the preview: the composition's fingerprint, the composed entries'
  findings beside the brief, and exit 2 when the previewed brief is over its limit.
- Every check that guards against rot or authoring slips rather than a broken
  composition: `compose-each`, `conditional-dead-branch`, `undeclared-command`,
  `template-expression`, `setext-heading`, `version-sensitive-file`, `pinned-version`,
  shipped-file reference checks, import closure, the dated-phrase list and ledger notes
  ([2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md)).
- Anything that runs a command from an entry. `validate` reads files only (D2,
  [roadmap, Trust model](../../roadmap.md#trust-model) point 1). The `git-ignored` check runs
  `git check-ignore` on paths the CLI listed itself, with hooks and fsmonitor disabled;
  nothing from an entry is executed.

## Design

### CLI surface

```
stacks validate [path] [--json]
stacks validate [path] --brief <stack> [--with <id>].. [--without <id>].. [--sandbox] [--json]
```

Exit 0 when there are no error findings (warnings and notes allowed). Exit 2 with
`ValidationFailed` when there is at least one error. A path that doesn't exist, or is
neither an entry directory under `stacks/` or `fragments/`, a registry root, nor the
bundled registry, is `NotFound` (exit 2) with `details.looked` naming the resolved path.
An unreadable root is `PermissionDenied` (exit 6).

`ValidationFailed` is a keeps-result tag (see roadmap, Contracts: Error tags, and the
keeps-result form in roadmap, Contracts: JSON contract): the full report stays on stdout
and the envelope is the last stderr line, with `details: { errors: number, warnings:
number }`. Its `errorTable` row is exit 2, not retryable, `keepsResult: true`.

`--with`, `--without` and `--sandbox` shape a `--brief` preview only; given without
`--brief` they are `BadInput` with `details.id` naming the flag, rather than silently
ignored. Their values may repeat and may be comma-separated. An unknown `--brief` stack is
1.1's `NotFound` with suggestions.

The bundled registry (the path from roadmap, Other shared facts: Bundled registry in the
repo, or `STACKS_REGISTRY_DIR` when set) is always a registry root, even when it
holds only its `README.md`. It ships empty until 1.6a, and an empty registry validates
clean: zero entries, zero findings, no size rows, exit 0. An explicit path to some other
directory with neither `stacks/` nor `fragments/` is `NotFound`.

### Interfaces

```ts
// src/schemas/validate.ts
export const Severity: Schema<"error" | "warning" | "note">; // roadmap, Other shared facts: validate severities
export const Finding: Schema<{
  check: string;                 // stable, kebab-case, e.g. "budget-composed"
  severity: Severity;
  kind?: "stack" | "fragment";   // a stack and a fragment may share an id
  entry?: string;                // absent for a finding about the registry as a whole
  file?: string;                 // relative to the validated root, "/"-separated
  line?: number;                 // line in the source file, never in the brief
  problem?: ConditionalProblem;  // conditional-syntax only (1.1's codes)
  message: string;               // fixed template plus ids and numbers, no file content
}>;
export const SizeRow: Schema<{
  kind: "body" | "composed" | "shipped";
  entryKind: "stack" | "fragment";
  entry: string;                 // the stack, for composed rows
  preset?: "default" | "sandbox"; // composed rows
  with?: string;                 // composed rows: the one fragment or app added
  words: number;                 // countWords
  fixedWords?: number;           // composed rows only; see "Word counting"
  limit?: number;                // absent on shipped rows
}>;
export const ValidateReport: Schema<{
  root: string;
  bundled: boolean;              // every reference must resolve inside the root
  entries: { stacks: number; fragments: number };
  findings: ReadonlyArray<Finding>;
  sizes: ReadonlyArray<SizeRow>;
}>;
export const BriefPreview: Schema<{
  stack: string; preset: "default" | "sandbox"; fragments: string[]; app: string | null;
  briefWords: number; fixedWords: number; limit: number;
  warnings: { code: string; id: string }[]; brief: string;
}>;

// src/core/validate/index.ts
export const validate: (target: Target) => Effect<ValidateReport, PermissionDenied, ...>;
// src/core/validate/target.ts
export const resolveTarget: (path?: string) => Effect<Target, NotFound | PermissionDenied, ...>;
// src/core/validate/preview.ts
export const previewBrief: (target: Target, options) => Effect<BriefPreview, ComposeFailure, ...>;
```

Each check is a function from the loaded view (below) to findings and size rows. Check
groups live one per module under `src/core/validate/` (`format`, `references`,
`conditionals`, `files`, `git`, `compositions`), so 2.2 adds modules without touching
existing ones. `--json` encodes `ValidateReport` or `BriefPreview`.

### What gets loaded, and what gets reported

Two separate sets:

- **Validated set**: the entries under the validated root, read with 1.0's directory
  reader. Only these get findings and size rows.
- **Resolution set**: the validated set, then every origin 1.0 loads for this invocation
  (project, user, bundled; see roadmap, Contracts: Entry and its listing), with the
  root's entries shadowing any same id. `requires`, `fragments.*`, `conflicts`,
  `appliesTo` and conditional `with=` ids resolve through this set, and composition
  uses it, so a user-directory stack that lists a bundled fragment validates and is
  budgeted with that fragment's real text.

A reference that resolves only outside the root produces a `note` (`resolved-outside-root`)
naming the id and the origin it came from, so a result that depends on the machine says
so. One exception: when the root is the bundled registry, nothing else is loaded, so a
reference outside it is `unknown-reference`, because a bundled stack ships to users who
have nobody else's user directory.

`validate` never needs the root to be one of 1.0's origins. It builds the resolution set
with `Registry.layer` and the validated root first in the ordered roots list (roadmap,
Contracts: Registry view), labeled with the origin it belongs to (the matching default
origin when the root is one, `user` for any other directory); it does not add an `Origin`
value.

### Word counting

`countWords` is the shared one (see roadmap, Contracts: Word count). 1.5 adds no counter
and no second rule. Two uses:

- **Body size**: `countWords` of the raw entry body. Marker lines are removed by the rule
  itself and every branch's content stays, so this is the worst case any project gets.
- **Composed size**: `countWords` of the whole brief as 1.1 renders it, fixed text
  included, rendered with the canonical context below.

`fixedWords` on a composed row is the `fixedWords` that 1.1's `renderBrief` returns for
that composition rendered with the canonical context: `countWords` summed over the
segments that come from `text.ts` (roadmap, Contracts: Word count). It is the CLI's own text
(headings, ground rules, versions, definition of done), so a CLI wording change that
pushes a stack over the budget shows up as a `fixedWords` change rather than an
unexplained jump. The human report prints it beside every composed size.

### The canonical render context

The brief depends on facts about the machine and the invocation (git state, missing
tools, how the CLI was started). Budgeting the brief a given machine would produce makes
`validate` pass on one laptop and fail on another, so every composed size is rendered with
one fixed context:

| Context field (1.1's brief context) | Canonical value | Why |
|---|---|---|
| Project name | `project` | One token, like most real names |
| Git state | `fresh` | `parent` adds a machine path |
| Written paths | The composition's planned paths, from `compose` | Deterministic from the entries |
| Missing tools | none | Depends on the machine |
| `yes` | `false` for `default`, `true` for `sandbox` | What `--sandbox` implies |
| CLI invocation (`Host.invocation`) | `npx -y stacks@<this CLI's version>` | The longest form an agent sees |
| Target agents | 1.1's default (`targetAgents` with no `Settings.agents` and no agent marker) | No user config |
| `Settings.always` | none | User config |
| Untrusted entries | none | The stop-and-confirm section is fixed text that only project-origin briefs get; it isn't the author's to cut |

If 1.1 adds a context field, the same change gives it a canonical value here. The context
is built by `canonicalContext(composition)` in `src/core/validate/budget.ts`, and
`canonicalBrief(composition)` renders with it.

### Budget (D5, as amended 2026-10-26)

The numbers are in one constant, `BUDGET`, with a comment pointing to D5. An app is a
fragment with `category: app` (D18 as amended).

| Subject | Limit (words) | Why this number |
|---|---|---|
| Stack body | 2,000 | Leaves room for the default fragments inside the composed cap |
| Fragment body | 1,000 | A fragment is one known-good piece; past this it is a stack |
| App body | 3,000 | An app carries its own build guidance and stage; it is the second half of the brief, not a small add-on |
| Composed brief without an app, in each of `default` and `sandbox` | 6,000 | D5's hypothesis: an agent still follows a brief this long to green. 1.6b's gate runs are the first evidence |
| Composed brief with an app | 9,000 | The brief splits into a base and an application part (1.1), each in the range of a brief without an app |

The composed limit depends only on whether the composition holds an app, so a stack's base
composition and the same composition with one optional fragment added share the 6,000
limit. Over a limit is an error. Every composed size is reported even when under, so
growth is visible in review. Shipped Markdown under `files/` and `adapters/` is counted
per entry and reported as `shipped` rows with no limit, so moving prose into shipped docs
to dodge the cap stays visible.

### Budgeted compositions

For each validated stack, in both presets: the base composition (required and default
fragments, with any default app), then the base with each optional fragment added alone,
then the base with each app that fits the stack added alone (a default app is left out
when another app is added, since a composition holds at most one). Every combination would
be exponential; these are the briefs `new` produces without the user naming several
extras. When a stack's base composition fails, its additions in that preset are skipped,
since each would fail the same way.

A composition failure is one `compose` finding (or `step-names` for a duplicate step
name) per stack and failing addition, with both presets merged into the message when they
fail the same way. A failure caused by an entry the root holds and another check already
reports (a bad conditional, broken merge JSON) isn't repeated as a `compose` finding.

### Verify layers (D7, proposed)

The `layer` vocabulary is the shared one (see roadmap, Other shared facts: Verify step
`layer`). For each stack's base composition, in each preset, the steps must include at
least one each of `install`, `lint`, `typecheck` and `test`, and at least one `serve` step
with a probe when the stack's tags include `web` or `api`. Steps from an app (the reserved
`app` tag) don't count, since the base must be complete without the app. A language
without a separate type checker marks its compile or vet step `typecheck`. Missing layer:
error naming the layer. A `serve` step without a probe is already a schema error in 1.0.

### Full check list

| Check id | Severity | What it catches |
|---|---|---|
| `schema` | error | Frontmatter fails the entry format v1 schema (see roadmap, Contracts: Entry format v1), excess keys included, with 1.0's rejection text. An unreadable entry file or a directory skipped for a newer `schema_version` is this finding |
| `symlink` | error | Any symlink inside an entry directory |
| `id-matches-dir` | error | `id` differs from the directory name |
| `kind-matches-file` | error | `kind: stack` in a `FRAGMENT.md` or the reverse |
| `decision-default` | error | A `decisions` entry doesn't contain "(default" (every decision needs a default so `--sandbox` and `--yes` can proceed) |
| `dep-version` | error | A `deps` name carries a version or range; `deps` name packages only, and versions belong to the agent |
| `step-names` | error | Duplicate verify step names in one entry, or in a composition |
| `step-layer` | warning | A verify step has no `layer`, so D7 and run records can't place it |
| `task-runner-tag` | warning | A stack's `tags` hold neither or both of `make` and `scripts` (1.0 asks for exactly one), so conditional prose keyed on them would pick nothing or both |
| `stack-setup-section` | warning | A stack body has no `## Setup` heading. The brief's agent looks for one place that says how the project is created |
| `unknown-reference` | error | `fragments.*`, `requires`, `conflicts`, `appliesTo` (as an id or a tag some stack declares) name nothing in the resolution set; an unknown fragment id gets nearest-id suggestions |
| `resolved-outside-root` | note | A reference resolved only through another origin; names the origin |
| `conditional-syntax` | error | 1.1's `ConditionalProblem` (unknown key, bad value, nested or unclosed block, and the rest); file, line and `problem` |
| `conditional-ids` | error | `stack=` or `with=` names an id in no origin of the resolution set |
| `conditional-tag` | warning | `tag=` or `tag!=` names a tag no stack in the resolution set declares |
| `merge-path-missing` | error | A path listed in an entry's `merge` isn't one of that entry's own files (after the dotfile escape is undone) |
| `merge-json` | error | An entry's own copy of a `merge` file doesn't parse as JSON, checked per entry even when no budgeted composition includes it. A `.tmpl` on a merge path is already 1.1's `merge_template` |
| `git-ignored` | warning | Inside a git checkout, git ignores one of an entry's files, so it never reaches a commit (see "Decided here") |
| `compose` | error | Composing a budgeted composition fails (1.1's `ComposeConflict`, `EntryInvalid` or `NotFound`), with the error's `details` reason and parties |
| `optional-fits` | error | A stack's `fragments.optional` names a fragment whose `applies_to` matches neither the stack nor its tags (1.1's `with_not_applicable` warning; added in the batch review) |
| `budget-body`, `budget-composed` | error | Over the D5 limits |
| `verify-layers` | error | D7 layer missing |

The checks are registered one module each, so 2.2's checks join the same report and
the same zero-warning gate without touching these.

### Output

Human: a header, findings grouped under `stack <id>` and `fragment <id>` headings, sizes
as a table, a one-line total, and a `Next:` line. Entry text is escaped before it reaches
the terminal. Abridged, for an illustrative stack `example-cli`:

```
Validated /path/to/registry: 1 stack, 3 fragments

stack example-cli
  error    budget-composed  stacks/example-cli/STACK.md: example-cli (sandbox): 6,212 words, limit 6,000

Sizes (words)
  example-cli body                 1,266 / 2,000
  example-cli (default)            3,926 / 6,000   fixed 756
  example-cli (sandbox)            6,212 / 6,000   fixed 793   over
...
1 stack, 3 fragments: 1 error, 0 warnings, 0 notes
Next: fix the errors above, then run stacks validate /path/to/registry
```

With no errors, the `Next:` line suggests `validate --brief <first stack> --sandbox`. Every
suggested command carries the invocation prefix (`Host.invocation`). `--json`: the encoded
`ValidateReport`, one object.

`--brief`: the brief, then a `---` line and the counts (`Brief: N words (fixed text F),
limit L`, with `over by X` when over), the stack and preset, the fragments, and any
composition warnings. `--json`: the encoded `BriefPreview`.

### Failure modes

| Case | Error tag | Exit | What the agent sees |
|---|---|---|---|
| Any error finding | `ValidationFailed` | 2 | Full report on stdout, envelope with counts as the last stderr line |
| Path missing, or not an entry, a registry root or the bundled registry | `NotFound` with `looked` | 2 | Envelope only |
| The root itself can't be read | `PermissionDenied` (`read`) | 6 | Envelope only |
| An entry file is unreadable, or its frontmatter isn't YAML | `schema` finding for that entry, not a crash | 2 | The rest of the registry still reports |
| Empty bundled registry | none | 0 | Zero entries, no findings |
| `--with`, `--without` or `--sandbox` without `--brief` | `BadInput` (`details.id` is the flag) | 2 | Envelope only |

`validate` never stops at the first bad entry: an author fixing a registry wants every
problem in one run.

### Decided here

| Question | Answer | Why |
|---|---|---|
| Machine-dependent brief text | Budget the canonical render, not the brief this machine would produce | Otherwise the same registry passes on one machine and fails on another |
| Which compositions are budgeted | Base (required + default), in both presets, plus each optional fragment and each fitting app added alone | These are the briefs `new` produces without the user naming several extras; every combination would be exponential |
| References to other origins | Resolve through all origins, report only the root's entries, note any outside resolution; bundled must be self-contained | An author's user stack may build on bundled fragments; the note keeps machine dependence visible |
| Fixed text in the budget | Counted, `fixedWords` shown (open question 7 default) | It measures what the agent reads, which is what assumption 1 is about |
| Suppression | Errors fail, warnings don't (except the bundled zero-warning gate), no suppression comment | A suppression syntax becomes the default fix |
| Git-ignored entry files | A `validate` warning, and the repo test guard (`tests/registry.test.ts`) stays | See below |

An entry's literal `files/.gitignore` applies to the checkout it sits in: one that lists
`.env.*` makes git ignore the same entry's `files/.env.example.tmpl`, which then never
reaches a commit while every local run passes. The check belongs in `validate` because an
author keeping their own registry in git gets nothing from this repo's tests; `validate`
is the one tool they run on it. It is a warning, not an error: the file is fine on disk
and the composition works locally, and some authors may keep a registry outside git on
purpose. That still fails the bundled zero-warning gate. The repo guard stays because the
fixture registries under `tests/fixtures/` aren't validated in CI with zero warnings
(some exist to produce findings), and the guard covers them. Outside a checkout, or with
no `git` on `PATH`, the check reports nothing.

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/commands/validate.ts` | Command and flags |
| `src/core/validate/*.ts` | `target.ts`, `view.ts`, one module per check group, `budget.ts` (`BUDGET`, `canonicalContext`, `canonicalBrief`), `preview.ts`, `report.ts` (human output) and `index.ts` |
| `src/core/compose/conditionals.ts` | `scanConditionals` exported, so `validate` reports marker problems with the same parser `compose` uses |
| `src/schemas/validate.ts` | `ValidateReport`, `Finding`, `SizeRow`, `BriefPreview` |
| `src/errors.ts` | `ValidationFailed` and its `errorTable` row; `NotFound.details.looked` |
| `src/cli.ts` | Subcommand |
| `registry/README.md` | The bundled registry's README, so the directory exists and validates empty |
| `tests/validate.test.ts` | Fixtures written to temporary directories, one or more per check |
| `tests/bundled-registry.test.ts` | `validate` over `packages/cli/registry` through the real command tree: zero errors, zero warnings |
| `e2e/binary.test.ts` | `validate` and `validate --brief` from the compiled binary over the realistic fixture registry |
| repo `AGENTS.md`, package `README.md` | The command, its exit codes and the budget table |

## Acceptance tests

1. Fixtures per check, each producing exactly the expected finding (id, severity, entry,
   file, line). A clean fixture produces none.
2. Budget: a fixture stack whose body is 2,001 words fails `budget-body`; a composition at
   exactly 6,000 passes and at 6,001 fails, in each preset separately (a `preset=sandbox`
   block can push only the sandbox brief over); an app composition is held to 9,000.
3. Canonical context: the same fixture validated with a missing tool on PATH, inside a
   parent git repo, through a different `Host.invocation`, and with `Settings.always` and
   `Settings.agents` set gives byte-identical `sizes`.
4. `fixedWords`: a fixture whose stack body grows by 50 words changes `words` by 50 and
   `fixedWords` by 0.
5. Word count property test: inserting or removing conditional marker lines never changes
   a body's count; adding a word anywhere changes it by one.
6. Resolution: a fixture user-directory stack listing a bundled fragment validates with a
   `resolved-outside-root` note and a composed size that includes the fragment; no
   finding names the bundled fragment. The same reference from inside the bundled root is
   `unknown-reference`.
7. `verify-layers`: a `web`-tagged stack with no `serve` step fails; adding one with a
   probe passes; a `cli`-tagged stack without `serve` passes.
8. `stack-setup-section`, `task-runner-tag` (both and neither), `merge-path-missing`,
   `merge-json` on an optional fragment's broken JSON that no default composition includes,
   `git-ignored` on an entry whose own `.gitignore` hides one of its files.
9. A registry with one broken entry still reports findings for the others.
10. Control characters in entry text are escaped in the human report.
11. `--json` output decodes with `ValidateReport`; on errors, stdout holds the
    `ValidateReport`, the last stderr line is the `ValidationFailed` envelope with counts,
    and the exit is 2.
12. The empty bundled registry (only `README.md`) exits 0 with zero entries; a different
    empty directory is `NotFound`; an unreadable root is exit 6.
13. `--brief` prints the brief and its counts (human and JSON); an unknown stack is
    `NotFound` with suggestions; `--sandbox` without `--brief` is `BadInput`.
14. `tests/bundled-registry.test.ts` passes against today's `packages/cli/registry`, empty
    or not.

## Exit criteria

- `bun run check` green from the repo root, including `tests/bundled-registry.test.ts`.
- `AGENTS.md` lists `validate`, its exit codes and the budget; the D5 and D7 rows in
  [requirements.md](../../requirements.md#proposed-decisions) note that the checks exist and
  which numbers are in `BUDGET`.
- Open question 7 is answered or still defaulted to "counted", and the file says which.

## What this plan may get wrong

- 6,000 words is a hypothesis with no measurement behind it yet. 1.6b's gate runs are the
  first measured pairs; if the near-cap stack goes green as fast as the small one, D5 can
  loosen, and if it hesitates, tighten before more stacks are written. The one-way door
  the problem statement warns about is stacks growing past the cap, not the cap moving.
- The canonical context hides real variance: a brief on a machine missing three tools, or
  inside a parent repo, is longer than the budgeted one. The difference is fixed CLI text
  of a few dozen words, which is why it was left out rather than added as worst case.
- Counting every conditional branch overstates bodies with many `stack=` blocks. That is
  intended pressure toward tags and fragments, but it may push authors into awkward
  splits; watch for it in 3.1b.
- Resolving through the user directory means an author's `validate` result can depend on
  what else is in their user directory. The `resolved-outside-root` note says when; the
  bundled registry is immune.
- Leaving `compose-each` and the staleness warnings to 2.2 means the bundled entries ship
  without them. A maintainer reading the composed briefs in the gate runs (1.6b) is the
  check until 2.2 lands.

Found executing, 2026-10-26:

- **Budget numbers.** The plan had D5's earlier 5,000 composed and 6,500 with an optional
  fragment, and no app number. Built with the numbers in the roadmap's Feature gaps row
  (stack 2,000, fragment 1,000, app 3,000, composed 6,000, 9,000 with an app); D5's
  proposal text in requirements.md is amended to match. The composed limit now turns on
  whether the composition holds an app, not on whether an optional fragment was added.
  Measured on the realistic fixture registry, its TypeScript CLI stack composes to about
  3,900 words in either preset (about 750 of them fixed text) and about 6,000 with the app
  fixture added, inside both limits; with the old numbers the app composition would have
  failed.
- **`validate --brief` moved here from 3.1a.** This phase's assignment put it in scope; it
  reuses the canonical render, so it was a small addition. 3.1a keeps the
  fingerprint, the findings beside the brief and exit 2 over the limit; this version
  prints the counts and an `over by` line but exits 0. It uses 1.1's default agents, not
  3.1a's `Settings.agents[0]`.
- **Checks changed.** Added `dep-version` (a version in `deps` freezes something the agent
  owns), `step-layer` (the roadmap's verify-step-layer row already said 1.5 warns; it
  applies to every validated step, not only bundled ones) and `git-ignored`. Dropped
  `fill-marker-owner`: entry format v1 has no built-in `filled` checks for it to read.
  `step-names` also fires within one entry, not only in a composition.
- **`merge-json` round trip dropped.** The plan also asked that each budgeted composition's
  merged output parse back to the value it was built from. The merge serializes with
  `JSON.stringify` from parsed values, so the check could never fail; per-entry parsing is
  what catches broken input.
- **Interfaces.** `canonicalContext` is a function of the composition, not a constant: the
  written paths and `yes` come from it. `SizeRow` is structured (`entryKind`, `entry`,
  `preset`, `with`) instead of a `subject` string, so JSON consumers needn't parse it;
  `Finding` gained `kind` (a stack and a fragment may share an id) and `problem`, and its
  `entry` is optional rather than `"<registry>"`. `ValidateReport` gained `bundled`.
  `validate` takes a resolved `Target`, not a path.
- **Paths.** An entry directory must sit directly under `stacks/` or `fragments/`; its root is
  the grandparent. `STACKS_REGISTRY_DIR` replaces the bundled registry for this
  invocation, so it is validated as bundled (self-contained, zero-warning). An unreadable
  root is `PermissionDenied` (exit 6) while an unreadable entry file is a `schema` finding.
- **`schema` findings carry 1.0's rejection text** and no parser line: 1.0's loader reports
  the decode failure, not a YAML position.
- **Compose failures are merged across presets** into one finding when both fail the same
  way, and failures another check already reports for a root entry aren't repeated.
- **`NotFound.details.looked`** (planned for 1.3a) was added here, for the resolved path of a
  missing `validate` target; 1.3a reuses it.
- **Fixtures** are generated per test in temporary directories rather than kept under
  `tests/fixtures/registries/*`; the realistic and composition fixture registries from
  1.0 and 1.1 are also run through `validate` (the composition fixture exits 2 by design).
- **`registry/README.md`** didn't exist yet; it was created here so the bundled registry
  directory exists and the zero-warning test has a real target.
- **`git check-ignore -z`** only works with `--stdin`, which `Processes.exec` doesn't offer;
  without `--stdin` git exits 128. The check passes paths as arguments with
  `core.quotePath=false` and reads newline-separated output, so a path holding a newline
  or a quote goes unreported.
- **The step-layer vocabulary has no honest value for a file-existence or config check.**
  `install`, `lint`, `typecheck`, `test`, `build`, `serve` and `docs` don't describe a step
  that checks a file is there or a config is wired (six of the realistic fixture's seven
  warnings are such steps), and the zero-warning gate for bundled entries pushes authors to pick a wrong
  layer just to clear `step-layer`. Resolved 2026-10-26: the maintainers added a `check`
  layer through the roadmap's "Verify step `layer`" contract row. `step-layer` stays a
  warning, and `check` isn't a D7 layer, so `verify-layers` doesn't ask for one.

Found in the batch review, 2026-10-26:

- **An optional fragment can replace a default.** Each added composition now leaves out
  every default that conflicts with the added fragment (either direction), as an added app
  already left out default apps; only a conflict that remains (with a required fragment,
  say) is a `compose` finding. The earlier version reported a false conflict.
- **Compose warnings were dropped.** An optional fragment whose `applies_to` doesn't fit
  its stack is now an `optional-fits` error on the stack; any other compose warning is a
  `compose` error.
- **Duplicates.** An unknown id a validated entry names (`unknown-reference`) and a
  rejected root fragment a stack names (its load finding) are no longer reported again as
  `compose` failures; an unknown optional id gets no composition at all.
- **Apps come from the validated root** (or the stack's own `optional`), not every origin,
  so the budgeted compositions don't depend on the machine.
- **`git-ignored` reads `check-ignore -v`** and reports only rules from a .gitignore inside
  the entry's own directory, naming the rule and its file; a root under an ignored
  directory isn't flagged.
- **A directory under `stacks/` or `fragments/`** given to `validate` is that kind's entry
  even with its markdown file missing or the other kind's in place, so it gets the normal
  finding instead of `NotFound`.
- **The newer-`schema_version` finding** comes from what the registry skipped
  (`Registry.skipped`), not from a directory with no entry; a project root's symlinked
  `stacks/` or `fragments/` is its own `symlink` finding.
- **`with=` and `stack=` ids** found only in another origin get the same
  `resolved-outside-root` note as frontmatter references.
