# Phase 3.0: `add`

Status: EXECUTED 2026-10-27 (`add`, parked conflicts under `.stacks/incoming/`, the add
brief, `list` in a project; reviewed once and fixed, then refactored into named stages sharing
`new`'s handoff flow). Test 7 is the deterministic writer-level interrupt test
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | `stacks add <fragment...>` applies known-good fragments to a repo that already exists, after the same tamper check `verify` runs. It never overwrites a file, parks every conflicting file under `.stacks/incoming/` for the agent to merge, and writes an add-mode brief whose definition of done is `stacks verify` |
| Traces to | Job 4: "When I have an existing repo, I want to add a known-good piece (CI, agent hooks, Postgres) without it overwriting what's there, so the repo gets better instead of different." What this is not: "`add` applies fragments; it does not restructure what's there." |
| Depends on | 1.6c (composition, the 1.2a scaffold writer, the 1.2b manifest, brief, handoff and `verify` have shipped once), 1.3b (the tamper check and `--accept-changes`). May run alongside phase 2 (D8 as revised): it reuses bundled fragments the gate already proved |
| Blocks | Nothing. Nothing in 3.1a, 3.1b, 3.2a or 3.2b needs `add` |
| Decisions needed | D4 (settled): never restructure. D14 (proposed): if changed steps only warned, the tamper check here would still run but a mismatch would warn and stop `add` from recording a digest, instead of failing. D19 (proposed): if project entries were trusted by default, the untrusted-under-agent rule below would apply only to shadowing project entries. Open question 9 (who can confirm) applies to the digest rule below unchanged |
| Settles | How a fragment lands in a repo without overwriting; how `add` keeps the step digest honest; what `add` does in a repo stacks didn't scaffold; how repeat runs treat unmerged parked files |

## Scope

In:

- `stacks add <fragment...> [--dir <path>] [--agents <list>] [--launch <agent>] [--sandbox] [--yes] [--no-launch] [--json]`, run from the project root or with `--dir`. `--launch` is 1.4's handoff preference, `--no-launch` is 1.4's flag, and `--yes` is 1.2a's "take every decision's default" (implied by `--sandbox`), all with the meaning they have on `new`. A flag contradiction (`--launch` with `--no-launch`, `--json` with `--launch`) fails `Usage`, exit 2, the same rule as `new`.
- The project name for templates in a repo with no manifest, inferred from the repo's own files (below).
- A recorded stack id that no longer resolves: a warning, and fragments applied without stack matching.
- Missing tools reported before anything is written, the same lookup as 1.2a's.
- A context-aware default view for `list` inside a project (below).
- The 1.3b tamper check on an existing manifest before anything is planned.
- Parking conflicting files under `.stacks/incoming/<path>`, with the classification order below.
- Creating `.stacks/manifest.json` when the repo has none ("existing repo" mode, `stack: null`).
- Appending the new fragments' steps, `env` and `commands` to the manifest and recording the new step digest, except under the untrusted-under-agent rule.
- An add-mode brief with a "Merge needed" section, then handoff through 1.4.
- Refusals: symlinked `.stacks/` or `incoming/`, `needsOwnRepo` fragments inside an enclosing repository, unknown ids, stack ids, conflicts, a fragment already applied, step name collisions.
- A line in the result and brief, with the exact command, when the project's stack requires a fragment the project doesn't have.

Out:

- Removing a fragment. Removing files the agent has since edited is a restructure (D4).
- Re-running a stack over a project, switching stacks, or applying a whole stack to an existing repo.
- Merging into any live file. Markdown, Makefiles, YAML, source files and JSON are all parked whole; the agent merges them.
- `Settings.always`. Personal defaults are for `new`; `add` composes only what was asked for and its `requires` closure.
- A `--dry-run` flag. `planAdd` is read-only, so one is cheap later; nobody has asked.
- Any CI wiring. The existing `ci.yml` runs this sub-phase's tests unchanged (D23).

## Design

### Where this fits

`add` is the second writer of a project after `new` (1.2a, 1.2b). It reuses the composition (1.1), the safe writer and rollback (1.2a), the tamper check (1.3b) and handoff (1.4); what it adds is the parking path, the manifest append, and the add-mode brief. It shares only `src/core/scaffold/` with phase 2 work, so it can run alongside phase 2 once 1.6c has shipped.

### Behavior, in order

1. Resolve the project root: `--dir`, or the current directory.
2. Refuse before reading further when `.stacks/` or `.stacks/incoming/` is a symlink: `PermissionDenied` with `details.path`, the same failure 1.2a's write guard gives for a destination outside the project.
3. Read `.stacks/manifest.json` if it exists. A manifest that fails to decode, or has a higher `schemaVersion`, fails the way 1.3a's manifest reader does (`InvalidConfig`, per [roadmap, Schema versions](../../roadmap.md#schema-versions)). No manifest means an existing repo: `add` will create one with `stack: null`.
4. **Tamper check.** With a manifest, run 1.3b's tamper check, the same exported function in `src/core/verify/tamper.ts` that `verify` calls, not a copy, with the lookup rules in [roadmap, Trust model](../../roadmap.md#trust-model) point 5. Three outcomes:

| Tamper check | `add` does |
|---|---|
| Passes, `tamperCheck: "full"` | Continue. The new digest is written to the manifest and the state record |
| Passes, `tamperCheck: "manifest-only"` (no state record) | Continue. The new digest is written to the manifest only; no state record is created. Creating one here would turn steps checked only against the manifest's own copy into a "full" baseline, which launders an edit made to both the steps and `verifyDigest` |
| Fails | `VerifyChanged` (exit 5) with the `details` 1.3b defines. Nothing is written. A person resolves it with `verify --accept-changes` and reruns `add` |

   With no manifest there is nothing to check; `add` writes a new project id and a state record the way 1.2b does for `new` (`stateRecord: false` when the state directory isn't writable).
5. Load the registry with the project root as the project origin, so project-local entries are visible with their `origin` and `trusted` marks (point 2).
   If the manifest's `stack` names an id the registry no longer has (a user stack since deleted, a source removed), `add` continues as if `stack` were `null` for composition, adds `{ code: "stack_unknown", id: "<id>" }` to `warnings`, and keeps the manifest's `stack` ref unchanged: it records how the project started, and the id may come back.
6. Compose in add mode with the deltas below: the requested fragments and their `requires` closure, minus fragments already in the manifest. `appliesTo` is checked against the manifest's stack and its tags; with `stack: null` (or an unknown stack), an `appliesTo` that names a stack id is a warning in the result, not an error.
6a. **Missing tools.** Look up the composition's `requiresTools` with `Processes.which`, as 1.2a does. Missing ones go into `missingTools` (1.2a's shape, with the owning fragment ids) and a `warnings` line naming each tool and the fragment that needs it, before any file is written, so a human run shows them before the merge list. They don't stop `add`: the agent may install the tool, and the brief's ground rules say so.
7. Check `needsOwnRepo`: if any composed fragment has it and `git rev-parse --show-toplevel` (through `Processes`) names a parent directory, refuse with `ComposeConflict` (reason `needs_own_repo`) before writing, as 1.2a does. A nested directory with its own `git init` is fine.
8. Plan files with `planAdd` (classification below).
9. Write the planned files and parked copies through 1.2a's safe writer, then the state record (when one is kept), then the manifest last. Ensure `.stacks/.gitignore` exists with the entries in [roadmap, Other shared facts: Project metadata](../../roadmap.md#other-shared-facts); never rewrite one the user edited.
10. Write `.stacks/BRIEF.md` in add mode and hand off through 1.4's decision. Any untrusted composed entry gives `print` with reason `untrusted`, the 1.4 rule (point 3).

### Project name without a manifest

Templates need `{{project_name}}` (1.2a's fixed variable set). With a manifest, `add` uses the name it records. Without one, the first of these that yields a non-empty value is used, then passed through 1.2a's slug rules:

| Source | Rule |
|---|---|
| `package.json` `name` | Strip an npm scope (`@acme/web` gives `web`) |
| `pyproject.toml` `[project] name`, then `[tool.poetry] name` | As written |
| `go.mod` `module` | Last path segment, skipping a trailing major-version segment (`example.com/acme/tool/v2` gives `tool`) |
| `Cargo.toml` `[package] name` | As written |
| The project directory's basename | Always present |

Each file is read as data: JSON with `JSON.parse`, TOML with `smol-toml` (added once to the root `workspaces.catalog` here and depended on with `catalog:`; 4.2d reuses it, because a hand-written TOML subset is a parser to maintain and the standard library has none), and the `module` line of `go.mod` with a line match; a file that fails to parse is skipped with a `warnings` line, never an error. The chosen value and its source are in the result as `name: { value, source }` and written to the new manifest.

### `list` inside a project

Once `add` exists, `list` with no kind argument chooses its view from where it runs:

| Context | Default view |
|---|---|
| No `.stacks/manifest.json` in the current directory or `--dir` | Stacks, then fragments (1.0's view, unchanged) |
| A manifest that decodes | "Fragments you can add": fragments whose `appliesTo` fits the recorded stack and its tags (all fragments when `stack` is `null` or unknown), minus those already applied, each with its `Next: <invocation> add <id>` line; then one line pointing at `list stacks` |
| A manifest that fails to decode or is newer | 1.0's view, plus a warning line naming the path and the decode error |

`list stacks`, `list fragments` and `list --json` are unchanged: `--json` always returns the whole registry, plus a `project` field (`{ stack, applied, addable }`) when a manifest decoded, so an agent gets the same answer without a context-dependent shape. The change lives in `src/commands/list.ts` and reads the manifest through `src/core/manifest.ts`; nothing in 1.0's registry changes.

### Interface deltas from 1.1, 1.2a and 1.2b

These are the only changes to shared types, per [roadmap, Contracts: Composition and Manifest](../../roadmap.md#types-and-schemas). No new types replace them.

| Contract | Delta |
|---|---|
| `ComposeOptions.stack` | `string \| null`. `null` only in add mode, for a manifest with `stack: null` or no manifest |
| `ComposeOptions.existing` | New field, `ReadonlyArray<string>`: fragment ids already in the manifest. Empty for `new`. Selection treats them as present for `requires`, `conflicts` and `with=` conditionals, and emits no files, steps or body for them |
| `ComposeOptions.mode` | `"new" \| "add"` |
| `ComposeOptions.always` | Always `[]` in add mode |
| `Composition.stack` | `Entry \| null` |
| `Manifest.stack`, `Manifest.mode` | `NullOr(EntryRef)` and `Literals(["new", "add"])`. 1.2b declares both from the start (Contracts: Manifest), so 3.0 fills them and the manifest `schemaVersion` stays 1. If 1.2b shipped `Literal("new")` and a plain `EntryRef`, that is a 1.2b bug to fix there, and these become a version bump |

Merge rules when `add` rewrites an existing manifest:

| Field | Rule |
|---|---|
| `mode` | Unchanged. It records which command created the manifest: `"add"` only when `add` created it |
| `preset`, `agents` | Unchanged. `--sandbox` and `--agents` apply only when `add` creates the manifest; one that disagrees with the recorded value is `BadInput` |
| `fragments` | Existing refs kept in order; new `EntryRef`s appended |
| `verify` | Existing steps kept byte for byte in their recorded form (including any change accepted with `verify --accept-changes`); new steps appended in composition order. A name collision is `ComposeConflict` (reason `step_name`) |
| `env` | An existing key keeps the project's value; new keys added |
| `commands` | An existing key keeps the project's value; new keys added. A key whose new purpose differs is listed under `commandsKept` in the result so the agent knows the fragment's prose may describe it differently |
| `briefWords` | Replaced with `countWords` of the add-mode brief (see Contracts: Word count), because it is the brief the agent is now following. Ledger and gate runs come from `new --sandbox`, so their sizes are unaffected |
| `verifyDigest` | `digestSteps` over the merged steps, `env` and `preset`, unless the untrusted-under-agent rule applies |

`planAdd` (in `src/core/add.ts`):

```ts
export type AddPlan = {
  readonly write: ReadonlyArray<PlannedFile>;          // destination absent
  readonly park: ReadonlyArray<{ file: PlannedFile; incoming: string; action: "new" | "merge" | "copy" }>;
  readonly skipped: ReadonlyArray<string>;             // identical bytes already present
  readonly incoming: ReadonlyArray<string>;            // every file under incoming/ after this run
};

export const planAdd: (input: {
  readonly root: string;
  readonly composition: Composition;                   // mode "add"
  readonly rendered: ReadonlyArray<{ file: PlannedFile; bytes: Uint8Array }>;
}) => Effect.Effect<AddPlan, PermissionDenied | ComposeConflict, FileSystem.FileSystem | Path.Path | Processes>;
```

`Processes` is in the requirements type because `planAdd` runs the `needsOwnRepo` git probe. Rendering uses 1.2a's template renderer and 1.1's in-memory JSON merge for paths two new fragments both write.

### File classification

For each planned file, the first row that matches decides:

| # | State | Action |
|---|---|---|
| 1 | Live destination absent | Write it |
| 2 | Live file present with identical bytes | Skip; nothing to merge |
| 3 | Live file present, no parked copy at `incoming/<path>` | Park the new content at `.stacks/incoming/<path>` |
| 4 | Parked copy present with identical bytes | Skip the write; the copy stays listed |
| 5 | Parked copy present, and it and the new content both parse as JSON | Deep-merge the new content into the parked copy |
| 6 | Otherwise | Write the next free `<path>.2`, `<path>.3`, ... under `incoming/` |

The live tree is never written for a path that already exists, even one a fragment declares in `merge`, because the live copy may hold choices the project made after it was written. That is D4 for files. "Merge needed" in the result and the brief lists every file under `incoming/`, including copies left by earlier runs that this run didn't touch.

### Untrusted entries under an agent

[Trust model](../../roadmap.md#trust-model) point 3: when any composed entry is untrusted (a project-origin fragment not in the trust store, or later a source entry) and `AppConfig.agent` is not `"none"` or `Host.stdinIsTTY` is false, `add` writes the files, the manifest's new steps and the brief, but writes `verifyDigest` (and the state record) as `digestSteps` over the manifest's previous steps, `env` and `preset`. For a manifest `add` creates, "previous" is zero steps and empty `env`. The next `verify` fails `VerifyChanged` listing the new steps until a person runs `verify --accept-changes` (point 4). The result says `digestRecorded: false` and the brief's stop-and-confirm section names the command. The TTY half of the condition matches point 4's test for who can confirm, since recording a digest is a confirmation; point 3 names only the agent test, and this sub-phase applies both.

### Rollback

1.2a's safe writer in `src/core/scaffold/write.ts` tracks every file and directory it creates and removes them in an Effect finalizer on failure or interrupt. `add` uses it unchanged for rows 1, 3 and 6, which only create absent files. Row 5 is the one in-place write: before merging, the writer keeps the parked copy's previous bytes and restores them on rollback. That is the only extension to 1.2a's writer. The state record is replaced by temp file and rename before the manifest, and its old bytes are restored if the manifest write fails. If a state record exists but can't be rewritten, `add` fails `PermissionDenied` and rolls back, because continuing would leave a project whose `verify` fails `VerifyChanged` for a reason nobody chose.

### The add-mode brief

Built by 1.1's renderer with `mode: "add"`. Fixed wording lives in `src/core/brief/text.ts`. It contains only the new fragments' bodies, not the stack body or bodies of fragments already applied. Differences from `new`:

- Title "Add <fragments> to <project>" and facts naming the stack (or "none recorded, existing repo") and the fragments already applied.
- "Your job" says to apply the fragments without breaking what's there.
- Conditional blocks evaluate `mode=add`; `with=` sees existing and new fragments.
- "Merge needed": every file under `incoming/`, with the instruction to bring in what the incoming copy adds, keep the project's choices where they conflict, and delete `.stacks/incoming/` when done.
- "Missing required fragments", when the stack requires fragments the project lacks, with `stacks add <ids>`.
- The stop-and-confirm section when any entry is untrusted (point 3), naming `verify --accept-changes` when `digestRecorded` is false.
- The definition of done is `stacks verify` over the whole manifest.

### Result

`add --json`:

```json
{
  "project": "/abs/path",
  "stack": "go-cli",
  "added": ["ci-github"],
  "alreadyApplied": ["agent-ops"],
  "written": [".github/pull_request_template.md"],
  "skipped": [],
  "mergeNeeded": [{ "path": "AGENTS.md", "incoming": [".stacks/incoming/AGENTS.md"] }],
  "missingRequired": [],
  "commandsKept": [],
  "warnings": [],
  "missingTools": [],
  "name": { "value": "acme-tool", "source": "manifest" },
  "createdManifest": false,
  "tamperCheck": "full",
  "stateRecord": true,
  "digestRecorded": true,
  "brief": ".stacks/BRIEF.md",
  "briefWords": 1840,
  "untrusted": [],
  "handoff": { "kind": "print", "reason": "json" }
}
```

`handoff` is 1.4's union. `tamperCheck` is `null` when `add` created the manifest.

### Failure modes

| Case | Result | Exit |
|---|---|---|
| Steps changed since last recorded | `VerifyChanged` with 1.3b's `details`; nothing written | 5 |
| Unknown fragment id | `NotFound` with the closest known ids | 2 |
| Requested id is a stack | `BadInput`; the message says `add` takes fragments | 2 |
| Fragment already applied | `BadInput` with `details.alreadyApplied`; nothing written | 2 |
| Conflicts with an applied or requested fragment | `ComposeConflict` (1.1's reasons) | 2 |
| `needsOwnRepo` inside an enclosing repo | `ComposeConflict`, reason `needs_own_repo` | 2 |
| Step name collision | `ComposeConflict`, reason `step_name` | 2 |
| `--sandbox` or `--agents` disagree with the manifest | `BadInput` | 2 |
| Manifest corrupt or newer | `InvalidConfig` | 3 |
| Manifest unreadable (I/O failure, a directory) | `PermissionDenied`, as `readManifest` fails | 6 |
| `.stacks/` or `incoming/` is a symlink, a write escapes the project, a write fails, or the state record can't be rewritten | `PermissionDenied` with `details.path`; rollback as above | 6 |

No new error tags.

### Decided here

| Question | Decision | Why |
|---|---|---|
| Prompt per conflicting file, or park | Park | An agent reading a merge list is more reliable than a person answering y/n per file, and `add` stays non-interactive |
| State record when only the manifest copy existed | Leave it absent; stay `manifest-only` | Creating one would promote an unverified baseline to "full" |
| Who creates the manifest's `mode` | The command that first wrote it; `add` never changes it | Keeps the manifest an honest record of how the project started |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/src/commands/add.ts` | New thin handler |
| `packages/cli/src/core/add.ts` | `planAdd`, classification, manifest merge, untrusted digest rule |
| `packages/cli/src/core/scaffold/write.ts` | Restore-on-rollback for the in-place parked JSON merge |
| `packages/cli/src/core/compose/compose.ts` | The deltas above |
| `packages/cli/src/core/brief/render.ts`, `text.ts` | Add mode |
| `packages/cli/src/core/manifest.ts` | Read-merge-write for add; `stack: null` |
| `packages/cli/src/schemas/add.ts` | `AddResult` |
| `packages/cli/src/cli.ts` | Register `add` |
| `packages/cli/src/core/add/name.ts` | Project name inference from package, Python, Go and Rust manifests |
| Root `package.json` (`workspaces.catalog`), `packages/cli/package.json` | `smol-toml` added once to the catalog and depended on with `catalog:` |
| `packages/cli/src/commands/list.ts`, `src/schemas/list.ts` | Context-aware default view; additive `project` field in `list --json` |
| `packages/cli/tests/add.test.ts` | New |
| `packages/cli/README.md`, `AGENTS.md` | Document `add`, parking and the result |

## Acceptance tests

All through `tests/helpers/cli.ts` with the fixture registry and temporary projects created with real `git init`.

1. `add ci-github` in a scaffolded project writes only absent files, appends the fragment's steps, and `verify --json` afterwards lists old and new steps with `tamperCheck: "full"`.
2. A pre-existing `AGENTS.md` is byte-identical after `add`; the fragment's version is at `.stacks/incoming/AGENTS.md` and "Merge needed" lists it.
3. Classification: two runs that both park `.claude/settings.json` give one deep-merged parked copy; two that park `README.md` give `README.md` and `README.md.2`; a parked copy identical to the new content is not rewritten; a parked file from an earlier run that this run doesn't touch is still listed.
4. Tamper: edit a step and `verifyDigest` in the manifest with the state record present; `add` exits 5 and the tree hash is unchanged.
5. Manifest-only: delete the state record; `add` succeeds with `tamperCheck: "manifest-only"`, `stateRecord: false`, and no state record exists afterwards.
6. Untrusted under an agent: a project-origin fragment with `CLAUDECODE=1` writes files and steps, `digestRecorded: false`, and the next `verify` exits 5 listing the new steps as added; `verify --accept-changes` with a TTY and no marker then lets it run. The same `add` with a TTY and no marker gives `digestRecorded: true` and still no launch.
7. Rollback: a write that fails partway (a read-only directory at a later destination) leaves no created file, restores a pre-existing parked JSON copy byte for byte, and leaves the manifest and state record unchanged; the same holds under interrupt.
8. A plain git repo with no `.stacks/` gets a manifest with `stack: null`, `mode: "add"`, and `createdManifest: true`.
9. A symlinked `.stacks` pointing outside the project exits 6 and writes nothing anywhere.
10. `needsOwnRepo` inside another repo exits 2 before writing; with its own `git init` it succeeds.
11. A fixture stack requiring the fixture-only fragment `fixture-required` and a project without it: `missingRequired` and the brief both contain `stacks add fixture-required`.
12. Adding a fragment already applied exits 2 with the tree unchanged.
13. `add` starts no process other than `git` (the `Processes` test layer records spawns).
14. Property test: for any set of pre-existing paths, every pre-existing live file's bytes are unchanged after `add`.
15. Name inference in repos with no manifest: `package.json` `@acme/web` gives `web` (source `package.json`); `go.mod` `example.com/acme/tool/v2` gives `tool`; `pyproject.toml` with `[project] name = "Data Kit"` gives 1.2a's slug of it (`data-kit`); a malformed `package.json` falls through to the next source with a warning; an empty repo gives the directory basename.
16. A manifest whose `stack` is an id the fixture registry doesn't have: `add` succeeds with a `stack_unknown` warning, `appliesTo` naming a stack is a warning, and the manifest's `stack` ref is byte-identical afterwards.
17. A fixture fragment with `requiresTools: [fixture-tool]` and a `PATH` without it: `missingTools` names the tool and fragment, the warning appears on stderr before the merge list in human mode, and the files are still written.
18. `add --launch codex` with codex absent keeps the preference and prints the prompt (manifest `handoff.kind` is `print`); `add --yes` and `add --sandbox` both render the brief's take-the-default rule; `add --launch codex --json` and `add --launch codex --no-launch` exit 2 with `Usage`, as `new` does.
19. `list` inside a scaffolded fixture project shows only addable fragments that fit its stack, not ones already applied, with `Next:` lines; outside a project it shows stacks first; with a corrupt manifest it shows 1.0's view and a warning; `list --json` inside a project has the full registry plus `project.addable`.

### Realistic edge cases

20. An incoming-directory symlink pointing inside, outside or to itself refuses before traversal and leaves both trees unchanged.
21. A symlinked live destination ancestor cannot redirect a write outside the project; the operation refuses and changes neither tree.
22. A relative `--dir` from another cwd resolves a symlinked project root with spaces, a leading dash and non-ASCII characters, including its project-origin registry.
23. A corrupt or newer manifest fails `InvalidConfig`, and a directory-valued manifest fails `PermissionDenied`, without writing a replacement.
24. A file where a destination's parent directory belongs causes rollback, preserving the file, parked JSON, manifest and state record.
25. Repository variables inherited from a git hook cannot redirect the `needsOwnRepo` probe or writes into another repository.
26. A project's edited metadata ignore file and pending incoming copies survive an unrelated later add and remain in its merge list.
27. Existing fragments satisfy requirements and conflicts without being reapplied; personal `always` defaults stay out and step collisions refuse without writes.
28. Malformed conditional prose in a newly requested fragment fails before any file or metadata is written.
29. A case-colliding live filename keeps its bytes and receives a parked contribution on case-insensitive volumes, while case-sensitive volumes keep both distinct files.
30. An unwritable existing state-record directory rolls back project writes and restores parked JSON while preserving the old record.
31. Explicit sandbox or agent flags that disagree with the recorded project refuse without changing its files or state record.
32. Empty requests, stack ids and misspelled fragment ids refuse the whole add without writes; misspellings suggest the known fragment.
33. An unreadable existing manifest is not replaced and no fragment files are written.

## Exit criteria

- All acceptance tests pass; `bun run check` is green from the repo root.
- A manual `add ci-github` on a real repo, followed by an agent run, reaches a green `verify` with the merge done and `incoming/` deleted, recorded as a run note in [plans/runs/](../../runs/README.md).
- `AGENTS.md` and the CLI README describe `add`, parking, the tamper check and the result.

## What this plan may get wrong

- Parking JSON whole, rather than merging into the live file, may make agents do mechanical merges they get wrong. Watch the run notes; the live-tree rule is worth keeping regardless.
- `stack: null` projects get no `appliesTo` checking. If fragments routinely assume a stack's layout, briefs may not fit foreign repos; a `--stack` hint is the likely fix.
- Appending steps assumes phase ordering is enough between old and new steps. A fragment whose setup must run before an existing step needs explicit ordering in the manifest, which is a manifest version bump.
- 2026-10-27, from the test author: three claims didn't match the code. Item 18 said `add --launch codex --json` records the preference, but `new` refuses `--launch` with `--json` as `Usage`, and `add` follows `new`; item 18 now says so. The error table said an unreadable manifest is `InvalidConfig`, but `readManifest` fails I/O as `PermissionDenied` (6); the table now splits the two. "With a manifest, `add` uses the name it records" assumed a manifest field that didn't exist: `Manifest` gains an optional `name` (additive, schema version unchanged, like `fingerprint`), which `new` and `add` write; a manifest without one (written before this sub-phase) falls back to inference.
- The untrusted-under-agent rule makes every agent-driven `add` of a project fragment end in a `VerifyChanged` failure until a person acts. That is the intent, but if agents report it as a broken project rather than asking the user, the brief's wording needs work.

- 2026-10-27, implementation: `planAdd` also requires `AppConfig` to construct the git probe's environment through `childEnv`, as the platform boundary requires. Acceptance test 7's directory watcher can deliver the changed-file event after a fast add has completed on macOS; such a run never actually requests interruption. The implementation must still restore every byte when an interruption is delivered during the transaction.

- 2026-10-27, independent review: overwriting a parked inode also changes any live hard link to it. `ProjectWriter.rewrite` therefore stages an exclusive temporary file and renames it over the parked path, preserving permission bits; rollback restores bytes through the same mechanism. This replaces the design's literal in-place write while preserving its classification and rollback contract.
