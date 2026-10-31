# Phase 2.0a: Composed files and fingerprint

Status: EXECUTED 2026-10-27 (`composeFiles`, `fingerprint`, the manifest and `new --json`
fingerprint; reviewed once and fixed)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A composition's files exist once, in memory: `composeFiles` renders every file `new` would write, `new` writes exactly that output, and `fingerprint` hashes the composition so every later run record can be tied to the exact content it ran |
| Traces to | "None of these are collected today"; the stack author: "the only proof a stack works is an end-to-end agent run" (a run proves only the content it ran) |
| Depends on | [1.1](phase-1.1-composition-and-brief-2026-10-30.md) (`compose`, `Composition`, `PlannedFile`), [1.2a](phase-1.2a-new-scaffold-and-templates-2026-10-30.md) (the scaffold writer, templates and `TemplateVars`), [1.2b](phase-1.2b-manifest-state-and-detection-2026-10-30.md) (the manifest's optional `fingerprint` field) |
| Blocks | [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (ledger records carry the fingerprint), [2.0b](phase-2.0b-bench-2026-10-30.md) (reads `fingerprint` from `new --json`), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (consumes `composeFiles`, `NEUTRAL_VARS` and `fingerprint`), [4.0c](phase-4.0c-registry-index-2026-10-30.md) (proof by fingerprint) |
| Decisions needed | D8 (local proof in phase 2, before authoring and sources) assumed. If D8 changes, this sub-phase still stands: 2.0c and 4.0c need it |
| Settles | What `composeFiles` returns and that `new` writes its output; what the fingerprint covers; how `fingerprint` differs from `bundleDigest` |

## Scope

In:

- `composeFiles` in `src/core/compose/files.ts`, with `new` refactored to write its output,
  and the byte-identity property test between the two.
- `NEUTRAL_VARS`, the fixed template variables for fingerprints and checks.
- `fingerprint` in `src/core/fingerprint.ts`; `new --json` and the manifest fill the
  optional `fingerprint` field 1.2b declared.

Out:

- The ledger, the gate-run import, `stacks runs` and `lastRun` in `list` (2.0c).
- The bench (2.0b). Rot checks (2.2). Publishing results (4.0c).
- Any CI step. The existing `check` job runs this sub-phase's tests through the root
  `bun run --filter '*'` scripts with no workflow change.

## Design

### Where this fits

Phase 2 builds the proof data in two steps. This sub-phase fixes what content a run is
tied to. [2.0c](phase-2.0c-run-ledger-2026-10-30.md) defines the ledger record that carries the
fingerprint and the commands that read it. [2.0b](phase-2.0b-bench-2026-10-30.md) produces records
and [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) checks content; both treat
`src/core/compose/files.ts` as read-only (roadmap, lanes table).

### Composed file set

`composeFiles` is the contract in the roadmap ([Contracts: Composed file set](../../roadmap.md#types-and-schemas)).
It takes a `Composition` (roadmap, Contracts: Composition) and the template variables, and
returns every file `new` would write for that composition, rendered in memory:

```ts
// src/core/compose/files.ts
export type RenderedFile = {
  readonly path: string;        // project-relative; dotfile names are literal
  readonly owner: string;       // "<kind>:<id>", or the merged-file marker below
  readonly bytes: Uint8Array;
  readonly executable: boolean; // the only mode bit new copies (1.2a)
};
export const composeFiles: (c: Composition, vars: TemplateVars) =>
  Effect.Effect<ReadonlyArray<RenderedFile>, EntryInvalid, FileSystem.FileSystem | Path.Path>;
```

It does, in memory, everything 1.2a's scaffold did between composing and writing: reads
each copy and template `PlannedFile`'s source through `Registry.read` (dotfile names are
already literal, so a path needs no rewriting), renders template files with `vars`, and
takes a merge file's bytes from the `PlannedFile` itself, since `compose` already
deep-merged it by 1.1's rules. `PlannedFile.owner` is an `EntryRef` (`{ kind, id }`),
because a stack and a fragment may share an id; `RenderedFile.owner` spells it
`<kind>:<id>`, and a merged file's owner is its writers spelled that way and joined with
`+`, in composition order. Adapter files
are included for the agents in the composition's options, so a composition is already
agent-specific. The output is sorted by `path`.

It does not include what the CLI itself writes: `.stacks/BRIEF.md`,
`.stacks/manifest.json`, `.stacks/.gitignore`, `NOTES.md` or the state record.

`new` is refactored so its writer takes `composeFiles`' output and only writes: resolve
the real parent path, refuse an escape, write bytes, set the executable bit (1.2a's safe
writer, unchanged). That is the only change to 1.2a's code, and it is what makes the
property test below mean something: there is one renderer, not two that agree.

`TemplateVars` is 1.2a's variable set. `NEUTRAL_VARS` (exported from the same module) is a
fixed value for each variable (`project_name: "example"`, `project_slug: "example"`,
`env_prefix: "EXAMPLE"`, `package_scope: ""`, `author: ""`, `year: "2000"`), used by the fingerprint and by
2.2 so neither depends on the project's name, the user's config or the clock.

### Fingerprint

`fingerprint` is the contract in the roadmap ([Contracts: Fingerprint](../../roadmap.md#types-and-schemas)):

```ts
// src/core/fingerprint.ts
export const fingerprint: (c: Composition) =>
  Effect.Effect<string, EntryInvalid, FileSystem.FileSystem | Path.Path>; // "sha256:<hex>"
```

The hash input, in this order and length-prefixed so no two inputs can run together:

1. For each composed entry in composition order: its kind and id, the canonical JSON of its
   decoded frontmatter (keys sorted), and its body bytes. The body is what the brief is
   built from, so a prose edit changes the fingerprint.
2. The preset name.
3. For each `RenderedFile` from `composeFiles(c, NEUTRAL_VARS)`, sorted by path: path,
   owner, executable flag and bytes.

The CLI's own fixed brief text is excluded, so a CLI release that rewords the brief's
fixed sections doesn't mark every run stale; a CLI change that alters behavior shows up
when the stack is rerun (2.0b, later 5.1). Frontmatter is hashed decoded, so reformatting
YAML doesn't change it. Because adapters are part of the composition, two agents get
different fingerprints only when an adapter file differs.

`new` computes the fingerprint after composing and puts it in the `new --json` result and
the manifest's optional `fingerprint` field (roadmap, Contracts: Manifest). No schema
version bump: the field was declared in 1.2b.

Entry ids, frontmatter and bodies are hashed as well as the rendered files, because
bodies aren't shipped files and a prose edit must change the fingerprint (roadmap,
Contracts: Fingerprint).

### Fingerprint and bundle digest

Two hashes, never interchangeable:

- `fingerprint` is sha256 over a whole composition: every composed entry, the preset and
  the `composeFiles` output. It answers "is this the content that ran", and every ledger
  record (2.0c) carries one.
- `bundleDigest` (4.0a, `packages/format`) is sha256 of one entry's canonical bundle: its
  own files only, no composition. It answers "is this the entry the signed index names"
  (4.0c, 4.0d).

`fingerprint` and `composeFiles` stay in the CLI; 4.0a moves `canonicalBundle` and
`bundleDigest`, not this code, so a ledger record's fingerprint never changes because
code moved.

### Failure modes

| Case | Handling | Exit |
|---|---|---|
| A template variable missing from `NEUTRAL_VARS` or the project's vars | `EntryInvalid` from `composeFiles` (1.2a's `template` reason) | 2 |
| A source file vanished between compose and render | `EntryInvalid` (`missing`), nothing written by `new` | 2 |

### Decided here

- The fingerprint hashes inputs plus the rendered shipped files, not the rendered brief.
  Reason above.
- `new` writes `composeFiles`' output, so the renderer exists once. Reason: a second
  renderer for fingerprinting could drift, and then a fingerprint would describe files
  nobody wrote.
- `fingerprint` stays in the CLI next to `composeFiles`; only `bundleDigest` lives in
  `packages/format`.

## Files and areas touched

| Path (under `packages/cli/`) | Change |
|---|---|
| `src/core/compose/files.ts` | `composeFiles`, `RenderedFile`, `NEUTRAL_VARS` |
| `src/core/scaffold/` | the writer takes `composeFiles` output; rendering and merging move out |
| `src/core/fingerprint.ts` | `fingerprint` |
| `src/commands/new.ts` | `fingerprint` in the result and manifest |
| `tests/compose-files.test.ts`, `tests/fingerprint.test.ts` | below |
| repo `AGENTS.md` | `composeFiles` as the one renderer, and the fingerprint |

## Acceptance tests

1. Byte identity (property test with `@effect/vitest` over fixture compositions, including
   a `.tmpl` file, a merged JSON file, an escaped dotfile, an executable hook and an
   adapter file): `new` into a temporary directory, then read every file back; the set of
   paths, bytes and executable bits equals `composeFiles` with the same variables, minus
   nothing and plus only the CLI's own `.stacks/` files listed above.
2. Fingerprint: stable across two runs and across `TZ` and `HOME` values for the same
   inputs; changes when any body, frontmatter value, preset or shipped file byte changes;
   unchanged by YAML reformatting, by a change to the brief's fixed text and by the
   project name; differs between two agents only when an adapter file differs.
3. `new --json` and the written manifest carry the same `fingerprint`, equal to
   `fingerprint` of the same composition.

### Realistic edge cases

4. Paths with spaces, leading dashes and non-ASCII names, plus quotes and backslashes in template values, remain literal when rendered and written from a different working directory.
5. A symlinked bundled root renders like its real path; a source directory replaced by a symlink after composition is rejected without following it.
6. A source removed between composition and rendering fails with `EntryInvalid` (`missing`), without writing a project.
7. An unknown template variable fails with `EntryInvalid` (`template`) before `new` writes anything and preserves an existing target's OS litter.
8. A pre-existing OS-litter file blocking a later output directory causes rollback of earlier writes and preserves the existing file and a sibling outside the target.

## Exit criteria

- `bun run check` green from the repo root.
- `AGENTS.md` documents `composeFiles` and the fingerprint.

## What this plan may get wrong

- The fingerprint ignores the CLI's fixed brief text and composition code. A CLI release
  that changes how a stack composes leaves the fingerprint the same until the content is
  recomposed; rerunning stacks after a CLI release (2.0b by hand, 5.1 later) is the
  backstop.
- `owner` for merged files joins ids with `+`. That string is part of the hash input, so
  changing its shape later marks every ledger record stale.
- 2026-10-26: this plan unescaped `_dot_` dotfile names, deep-merged `merge` files itself
  and spelled owners as bare ids. The amended D18 stores dotfiles literally, and 1.1 as
  built merges JSON in `compose` (a `PlannedFile` of kind `merge` carries the final
  bytes) and makes every owner an `EntryRef`, since a stack and a fragment may share an
  id. `composeFiles` now only reads, renders and orders; owners are `<kind>:<id>` and
  the fingerprint hashes each entry's kind with its id. `package_scope` is in v1's
  variable set, so `NEUTRAL_VARS` holds it (empty), which keeps a fingerprint independent
  of the user's scope. Check the merge marker and the
  owner spelling against the shipped `compose.ts` before building on them.
- 2026-10-27 (found writing the tests): the template variable type is
  `TemplateValues` in `scaffold/template.ts`, not `TemplateVars`. A merge `PlannedFile`
  keeps only its first writer as `owner`, so the `+`-joined owner needs `compose` to
  carry every writer. A source file gone at render time is `EntryInvalid` reason
  `missing`, the registry's existing reason for it, not `decode`.
- 2026-10-27 (implementation): `composeFiles` builds `Registry.layer([])` for the
  registry's checked reads without loading roots; the composition already holds its
  entries. Registry reads can also fail with `PermissionDenied` (an unreadable source),
  which `composeFiles` and `fingerprint` pass through unchanged (exit 6, as for every
  other unreadable entry), so their error type is `EntryInvalid | PermissionDenied`, not
  the `EntryInvalid` the design above shows. `PlannedFile.owners` carries all writers,
  including the sole writer of a copy or template, while `owner` remains the first writer.
- 2026-10-27 (independent review): calling `composeFiles` and then `fingerprint`
  separately rereads sources, so an edit between them can record a fingerprint for bytes
  `new` did not write. `composeFilesWithNeutral` now reads sources once and uses the same
  renderer for project and neutral values; `fingerprintFromFiles` hashes that retained
  neutral output. The public `composeFiles(c, vars)` and `fingerprint(c)` interfaces stay
  available. A regression edits real source files during project rendering and checks
  that the neutral fingerprint still describes the retained content.
