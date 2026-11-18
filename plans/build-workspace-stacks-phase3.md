# Build plan: workspace stacks, Phase 3

Phase 3 of [the workspace stacks RFC](stack-pairing-rfc-2026-11-18.md) ("Later phases", item 3): composition, `new`, `add`, `validate`, the brief, the proof fingerprint, the index part pin, telemetry and the `--json` results for a `kind: stack` entry with `parts`.

Written against `feat/workspace-stacks` at b206153b. The task named 985cc615; the checkout moved while this was being planned, and b206153b already holds Phase 2 (`StackPart`, `StackMeta.parts`, `ManifestPart`, `Manifest.parts`, `IndexEntry.parts`, the `link` category, in `packages/format/src/entry.ts`, `manifest.ts`, `index-schema.ts`) and Phase 4's authoring guidance (`packages/cli/docs/authoring.md`, "Workspace stacks"). Every path below was checked against that tree. Symbols are cited, never line numbers.

The spike patch (`plans/runs/2026-11-18-stack-pairing-spikes/spike3-composer.patch`) is a reference only. Its paths moved: `core/manifest.ts` is `core/project/manifest.ts`, `core/registry/remote.ts` is `core/registry/remote/merge.ts`, `core/validate/commands.ts` is `core/validate/checks/commands.ts`, `core/canonical-json.ts` is `core/fs/canonical-json.ts`.

## Shape

One mounting step inside `core/compose/`, run right after fragment selection, rewrites each mounted entry's meta once: verify step names and `cwd`, command keys, dependency roles and `merge` paths. After it, only `plan-files.ts` (the output path, the overlay id and the payload per entry) and the condition context know parts exist. Every other consumer (steps, `mergeCommands`, `mergeEnv`, `mergeDeps`, the manifest, the step digest, `checkTamper`) sees ordinary meta. The rewrite changes hashed meta only for workspaces, so all existing fingerprints, proofs and briefs stay byte-identical; the golden tests below hold that.

Entry order in a workspace composition: the workspace stack, then each part in `parts` order, then the fragments in composition order (the app last, as today).

## Settled decisions

(a) **A dependency role equal to the part name** (`db`'s role `backend` on part `backend`) becomes `backend-backend`. Always prefixing is one rule with no special case, and it is the only form that can't merge with a root role by accident.

(b) **A workspace command key equal to a namespaced part command** (workspace `backend-test`, part `backend`'s `test`): the workspace's command is kept and the part's is dropped from the merged table; `validate` warns (`part-namespace-shadowed`). Same for a root dependency role equal to a namespaced part role, which merges as `mergeDeps` merges any shared role and gets the same warning. This keeps `mergeCommands`' existing rule that the entry which knows the other one overrides it (a fragment replacing a stack's `lint`), and only the workspace knows the part names, so its key is deliberate; the warning keeps it from being silent. Two steps with one name stay a `ComposeConflict` `step_name`, as today.

(c) **A part step whose own `cwd` escapes the part directory** (`..`, `../x`, an absolute path, anything whose normalized join with the part directory is not the directory or under it) is refused at compose time with `EntryInvalid`, new reason `part_cwd`, `id` the workspace, `part` the part name and `step` the prefixed step name. The same rule applies to a fragment placed on a part. It is a defect of one entry as mounted, not a conflict between two, and at runtime `verify/step.ts` would accept it because the join lands inside the project.

(d) **The known roles and their Declared rules** live in one pure module, `packages/cli/src/core/compose/roles.ts`. Compose needs the role list to refuse `part_role` at `new`, validate needs the rules, and `compose/` sits below `validate/` in the import direction, so both import it without a cycle.

(e) **The brief's fixed wording slots** in `core/brief/text.ts`, with only names as data:

```ts
facts.part: (dir: string, role: string, stack: string) =>
  `- Part ${code(`${dir}/`)}: role ${code(role)}, stack ${code(stack)}`
facts.workspaceRoot:
  "- Project root: the directory containing `.stacks/`. Run root commands there; a Part, Link or placed Fragment section says where its own commands run."
sections.part: (name: string, id: string, dir: string) =>
  `## Part: ${name} (${code(id)}) in ${code(`${dir}/`)}`
sections.partLine: (dir: string) =>
  `This part lives in ${code(`${dir}/`)}. Paths and commands in this section are relative to ${code(`${dir}/`)} and run there. The workspace's Setup sets the order of setup and replaces this section's own setup and verify lines. \`README.md\`, \`.env.example\`, \`AGENTS.md\` and \`CLAUDE.md\` named here are this part's copies in ${code(`${dir}/`)}, not the root's.`
sections.link: (name: string, id: string) => `## Link: ${name} (${code(id)})`
sections.linkLine: (api: string, client: string) =>
  `In this section the API part is ${code(`${api}/`)} and the client part is ${code(`${client}/`)}. Paths and commands are relative to ${code(`${client}/`)} and run there.`
sections.placed: (dir: string) =>
  `This fragment is placed on the part in ${code(`${dir}/`)}. Paths and commands in this section are relative to ${code(`${dir}/`)} and run there.`
start.build: (decisions: boolean, app: boolean, workspace = false) =>
  // "Stack, Part, Link and Fragment sections" when workspace; today's text otherwise
```

`facts.root` is unchanged for single stacks; a workspace brief writes `facts.workspaceRoot` instead, because "Run every command from there" contradicts the part line.

(f) **`verify --only <step>` running setup steps** is existing behaviour: `verify/plan.ts::isSelectable` keeps every setup and teardown step under `--only` because a selected check depends on them. In a workspace that installs both parts. No change in Phase 3: nothing records which setup step a check needs, and scoping setup by step-name prefix would be a guess that breaks a check needing the other part's server. The workspace body can say so; a per-part `--only` is a later feature.

(g) **Identical adapter files from two parts**: a path on the session-root list (below) written by two or more mounted entries is planned as one file when every writer is a copy or every writer is a template, with identical source bytes and the same executable bit: `kind` stays copy or template, `owner` and `source` are the first writer's, `owners` lists all of them. When every writer lists the path in its (mounted) `merge`, it deep-merges as today. Otherwise it is `ComposeConflict` with the existing reason `file_owner`, `path` the root path, `stack` and the new `parts` field naming both parts. `file_owner` already means "two entries write one path and not all merge it", and the fix (rename the hook with the stack id, Phase 1's rule) is the same as for any other `file_owner`, so no new literal. Collapsing applies only when every writer is mounted; the workspace or a root fragment writing the same root path as a part is the ordinary rule (merge or `file_owner`).

### Other decisions made here

- The session-root list is matched on the output path, whatever `--agents` selected and whether the file came from `files/` or `adapters/`; `shipsFor` alone decides whether a file is written. The list: `.claude/settings.json`, `.claude/hooks/**`, `.claude/agents/**`, `.claude/commands/**`, `.codex/**`, `.agents/skills/**`, `.cursor/hooks.json`, `.cursor/hooks/**`, `opencode.json`, `.opencode/**`. A mounted `merge` path on the list is hoisted too.
- Payload per part: an entry of kind stack (the workspace or a part) that does not ship `payloads/<requested>/` uses `example`; `checkPayload` refuses only when neither the workspace nor any part ships it. Fragments get the requested payload, as today. `Composition.payload` records the request.
- Condition context per entry: the workspace and root fragments see the workspace id and tags, and every fragment id; a part, and a fragment placed on one, see that part's stack id, its tags, its effective payload and only the fragments placed on that part. `mode` and `preset` are shared.
- In `add`, parts come only from `ComposeOptions.parts` (the manifest's), never from the registry entry's `meta.parts`. A part stack missing from the registry still places and fits by its stack id (no tags) and `add` warns `part_unknown`.
- Placement: a fragment whose `applies_to` names exactly one mount's stack id, and not the workspace id, goes on that part; anything else goes to the root. The same stack mounted twice therefore sends its fragments to the root (not built or proven in version 1).
- A part's decisions keep today's `<entry id>: ` prefix (`compose.ts::decisions`); the facts block maps the id to its directory.
- `render.ts::installer` returns `null` for a workspace composition, so step 1 points at the dependency list; each part has its own package manager.
- `add` refuses with `PermissionDenied` reason `blocked` (`path` the part directory) when a `Manifest.parts` directory is missing or is not a real directory (a file or a symlink), before anything is written. `blocked` already means "the project's live tree stops this write".
- Severities in `validate`: part problems, Declared role rules, a missing restated requirement and a missing `openapi-drift` are errors; the two new headings and "names every part directory" are warnings, as `stack-setup-section` is; shadowing is a warning.

## Decided after planning

Both items in the next section are settled, and these lines override anything below that says otherwise.

1. The index part pin carries the stack id. `IndexEntry.parts` is now part name to `{ stack: Kebab, digest: Digest }` (changed on the landing branch before 3A.0; the format package was not yet published). Lane 3B.4 builds bundle paths from the index alone and does not write the helper in `scripts/index/bundle.ts` that reads a workspace bundle's frontmatter; `bundleRefs` keeps its one-argument signature.
2. `stacks:when part=<role>` is a new condition key, built in lane 3A.1 (`conditionals.ts::KEYS`, the condition context, and its tests). It is true when the composition is a workspace with a part of that role, for every entry in it, wherever the entry is placed; in a single-stack composition it is false. So `postgres` on the API part writes `part=web` around what a web part must do after it is added. In add mode the roles come from `ComposeOptions.parts`. Unknown roles are not an error (the value is open, as `with=` is).

## Needs a decision before this is built

1. **The index part pin has no stack id.** Phase 2 landed `IndexEntry.parts` as part name to digest. `scripts/index/remote.ts::bundleRefs` and `checkHost`, and `scripts/index/publish.ts`'s carry-forward, build every bundle path (`v1/entries/<kind>/<id>/<digest>.json`) from `IndexEntry` alone, so a name-keyed digest can't be turned into a path without fetching and decoding the workspace's own bundle first. If `@steamfield/stacks-format` with this shape is not yet published, change the value to `{ stack: Kebab, digest: Digest }`, keyed by part name; it is a one-way door in a contract `stacks-api` reads. Lane 3B.4 is written for the landed shape and reads part stack ids from the workspace's decoded `STACK.md` (it already holds or fetches that bundle); with the changed shape that helper disappears and the lane gets smaller.
2. **"A block that applies only in a workspace."** The RFC ("Who owns what") and the landed authoring docs tell a fragment on one part to describe its effect on the other part "in a block that applies only in a workspace". No `stacks:when` key can express that: `conditionals.ts::KEYS` is `stack`, `tag`, `tag!=`, `mode`, `preset`, `with`, `payload`, and a part context's `stack` is the part's own id. The smallest fix is a key such as `part=<role>`, true when the entry is placed on a part with that role. An unknown key is `EntryInvalid` (`conditional`, `unknown_key`) in every released CLI, so a registry body using it needs the same `minCli` rollout as `parts`. Not in these lanes; decide before Phase 5 writes `postgres`'s block.

## Test fixtures

Today compose tests build a `Registry` over fixture roots (`tests/helpers/compose.ts::composeExit` with `bundledAt(composeRegistry)`); `new` and `add` tests run the real command tree with `tests/helpers/cli.ts::runCli(args, { host: { registry } })` over `tests/fixtures/registry-new` or a temp copy made by `tests/helpers/add.ts::addProject`; per-case variants are written into a temp root with `tests/helpers/registry.ts::writeEntry`, `minimal` and `copyEntry`.

One shared fixture, created in 3A.0 and used by every lane: `packages/cli/tests/fixtures/registry-workspace/`, with `packages/cli/tests/helpers/workspace.ts` exporting:

```ts
export const workspaceRegistry: string; // the fixture root
/** A temp copy of the fixture, edited by `edit`, for failure-case variants; cleaned up by the caller's dir. */
export function workspaceVariant(edit?: (root: string) => void): { root: string; cleanup: () => void };
/** `stacks new pair <target> --no-launch --json` over `root` (default the fixture); the decoded result and target. */
export function newWorkspace(options?: { root?: string; args?: string[] }): Promise<{ result: CliResult; target: string }>;
```

Every verify `run` that a test may execute is POSIX shell (`true`, `test -f ...`); steps whose `run` is a runner form (`bun run test`, `make check`) exist for `validate`'s command check and are never executed in a test (select another step with `--only`; setup steps are `true`).

| Entry | Frontmatter that matters | Files |
| --- | --- | --- |
| `stacks/pair` (the workspace) | `tags: [make]`; `parts: [{name: backend, role: api, stack: api-part}, {name: frontend, role: web, stack: web-part}]`; `fragments: {required: [client-link, harness], default: [root-ci], optional: [db]}`; `commands: {check}`; `merge: [.claude/settings.json]`; verify `both` (`make check`, layer test) and `readme-filled` (`test -f README.md`, tag hygiene) | `files/Makefile`, `files/README.md`, `files/AGENTS.md`, `files/.env.example`, `adapters/claude/.claude/settings.json` (one `permissions.allow` string). Body: `## How the parts connect` naming `backend/` and `frontend/`, `## Setup`, `## Changing the API`, and a `with=client-link` block |
| `stacks/api-part` (`api` role) | `tags: [bun, scripts, typescript]`; `env: {PORT_API: "3100"}`; `commands: {lint, test, dev, openapi}`; `deps: {dev: [tsx], runtime: [hono]}`; `decisions: ["Database (default: none)."]`; `merge: [.claude/settings.json, config/app.json]`; `fragments: {required: [harness], default: [root-ci]}`; verify `install` (setup, `true`), `lint` (`test -f src/index.ts`), `test` (`bun run test`), `openapi-drift` (`bun run openapi`), `api` (serve, `bun run dev`, `expect.http: http://localhost:${PORT_API}/healthz`) | `files/src/index.ts`, `files/README.md`, `files/AGENTS.md`, `files/package.json.tmpl` (uses `{{ project_name }}`), `files/config/app.json`, `adapters/claude/.claude/settings.json` (a hook command `api-hook`), `adapters/claude/.claude/hooks/shared-guard.sh` (executable, byte-identical to web-part's), `adapters/claude/.claude/rules/api.md`, `adapters/codex/.agents/skills/api-skill/SKILL.md`, `payloads/example/src/notes.ts`, `payloads/none/src/empty.ts`. Body: `## Setup`, and blocks `with=root-ci`, `with=db`, `tag=bun` |
| `stacks/web-part` (`web` role) | `tags: [bun, scripts, typescript, web]`; `env: {PORT_WEB: "4173"}`; `commands: {lint, test, dev}`; `deps: {dev: [vitest]}`; `merge: [.claude/settings.json]`; `fragments: {required: [harness]}`; verify `install` (setup, `true`), `lint` (`test -f src/main.ts`), `test` (`bun run test`), `web` (serve, `expect.http: http://localhost:${PORT_WEB}/`) | `files/src/main.ts`, `files/README.md`, `files/AGENTS.md`, `adapters/claude/.claude/settings.json` (hook `web-hook`), `adapters/claude/.claude/hooks/shared-guard.sh` (identical), `payloads/example/src/notes-page.ts` only (no `none`) |
| `fragments/client-link` (the link) | `category: link`; `applies_to: [web-part]`; verify `client-drift` (`test -f orval.config.ts`) | `files/orval.config.ts` |
| `fragments/harness` (multi-part) | `category: agent-ops`; `applies_to: [api-part, web-part]`; `merge: [.claude/settings.json]`; verify `harness-ok` (`test -f .claude/settings.json`, tag hygiene) | `adapters/claude/.claude/settings.json` (hook `harness-hook`), `files/.claude/hooks/harness-guard.sh` |
| `fragments/db` (part-scoped) | `category: service`; `applies_to: [api-part]`; `deps: {backend: [pg]}`; `env: {DATABASE_URL: "postgres://localhost/example"}`; `commands: {db-up}`; `merge: [config/app.json]`; verify `up` (setup, `true`) and `migrate` (`test -f src/db.ts`, `cwd: .`) | `stacks/api-part/src/db.ts`, `stacks/web-part/src/db-client.ts` (must never be written), `files/config/app.json`. Body has a `with=db` line |
| `fragments/root-ci` (root) | `category: ci`; `applies_to: []`; verify `ci-config` (`test -f .github/workflows/ci.yml`) | `files/.github/workflows/ci.yml`. Body has a `tag=bun` block (drops at the root, since the workspace's tags lack `bun`) |

The fixture holds only valid entries, so a lane can assert that `validate` of it has no error in its own checks. Failure cases are variants written per test with `workspaceVariant` and `writeEntry`:

- `part_stack`: a part naming `no-such-stack`.
- `part_role`: a part with role `mobile`.
- decode: a part name `Backend` (rejected at decode, unchanged).
- `part_name_duplicate`: both parts named `app`.
- `part_nested`: a part naming `pair` itself, or a second workspace.
- `part_roles`: two `web` parts; two `api` parts; no `api` part (`api-part` given role `web` and `web-part` role `web`).
- `part_cwd`: an `api-part` step with `cwd: ..`, one with `cwd: ../x`, one with `cwd: /tmp`.
- root collision: the workspace ships `files/backend` (a file) or `files/backend/README.md`.
- step prefix collision: a root fragment (tag-only `applies_to: [bun]`) with step `backend-lint`.
- differing hoisted file: `web-part`'s `shared-guard.sh` edited by one byte.
- shadowing: the workspace declares command `backend-test` and deps role `backend-dev`.
- untrusted part: a project-root (`./.stacks/stacks/web-part`) copy of `web-part`.

## Sub-phases

| Sub-phase | Lane | Model | Non-test files | Depends on |
| --- | --- | --- | --- | --- |
| 3A.0 | Scaffold: contracts, registration points, fixture | sonnet | 7 | nothing |
| 3A.1 | Compose core: mounting, parts, placement, plan, manifest | opus | 8 | 3A.0 |
| 3B (parallel) | 3B.1 Workspace brief | opus | 3 | 3A |
| | 3B.2 `add` and telemetry | sonnet | 4 | 3A |
| | 3B.3 `validate` | opus | 6 code + 1 doc | 3A |
| | 3B.4 Proof and the index pin | opus | 6 | 3A |
| 3C | Results: `new --json`, `show`, MCP mirror | sonnet | 6 | 3A (may run with 3B; it shares no files) |
| 3D | Integration: shared docs, the gate, one review | orchestrator | 4 docs | all |

Every lane: works in its own worktree on a branch from the merged 3A; edits only its owned files plus new test files it names; runs only its scoped tests, `bun run lint` and `bun run typecheck` (no gate, `AGENTS.md` "Test runs"); runs the single-stack goldens it lists; commits on its branch. Rule files that apply: `.claude/rules/architecture.md`, `.claude/rules/typescript.md`, `.claude/rules/cli/{cli,comments,effect,testing,verification}.md`; 3C also `.claude/rules/mcp/effect.md`. Every tracked file stays free of absolute home paths and maintainer names.

The single-stack goldens, which every lane touching compose, brief or fingerprint output must keep green unchanged: `tests/digest-golden.test.ts`, `tests/fingerprint-snapshot.test.ts`, `tests/fingerprint.test.ts`, `tests/bundled-compositions.test.ts`, `tests/brief.test.ts` (digests in `tests/fixtures/bundled-brief-digests.ts`), `tests/compose.test.ts`.

---

## 3A.0 Scaffold

Model: sonnet. Every contract below is fixed here; a wrong stub fails the error-table and failure-guide tests.

Owned files:

| File | Change |
| --- | --- |
| `packages/cli/src/errors.ts` (existing) | `EntryInvalidDetails.reason` gains `part_stack`, `part_role`, `part_name_duplicate`, `part_nested`, `part_roles`, `part_cwd`; `EntryInvalidDetails` gains `part: Schema.optionalKey(Schema.String)` and `step: Schema.optionalKey(Schema.String)`; `ComposeConflictDetails` gains `parts: Schema.optionalKey(Schema.Array(Schema.String))` (the part names of the mounted parties, in party order). Doc comments say what each reason means |
| `packages/cli/src/core/failure-guide.ts` (existing) | `entryGuide` prints `Part: <name>` and `Step: <name>` when present, and for a `part_*` reason the next line "fix the workspace's parts list or that part's step; `<cli> validate` lists every problem in a registry."; `composeGuide` prints `Parts: a, b` when present |
| `packages/cli/src/core/compose/types.ts` (existing) | The types below |
| `packages/cli/src/core/registry/entry.ts` (existing) | `Entry.partEntries?: Readonly<Record<string, Entry>>`: a workspace's part stacks as its index entry pins them, or its bundled fallback, keyed by part name |
| `packages/cli/src/core/compose/roles.ts` (new) | The role vocabulary and the Declared rules, pure |
| `packages/cli/src/core/validate/checks/workspace.ts` (new, stub) | `export const workspaceChecks: Check = () => Effect.succeed({ findings: [] })` |
| `packages/cli/src/core/validate/index.ts` (existing) | Registers `workspaceChecks` after `metadataChecks` |
| `packages/cli/tests/fixtures/registry-workspace/**`, `packages/cli/tests/helpers/workspace.ts` (new, test) | The fixture and helper above |

Contracts:

```ts
// core/compose/types.ts
/** Where a mounted entry lives: its part's directory and step prefix, role, and the part's stack id (which picks overlays). */
export type PartMount = { readonly name: string; readonly role: string; readonly stack: string };
/** An entry as composed; `mount` is set on a part and on a fragment placed on one. */
export type MountedEntry = Entry & { readonly mount?: PartMount };
/** One part of a workspace composition. `entry` is null only in add mode, for a part stack the registry no longer has. */
export type ComposedPart = { readonly mount: PartMount; readonly entry: MountedEntry | null };
// ComposeOptions gains:
  /** Add mode only: the project's parts from `Manifest.parts` (`stack` is the ref's id). */
  parts?: ReadonlyArray<PartMount>;
// Composition gains (absent for every composition without parts):
  /** The workspace's parts in `parts` order, each mounted. */
  parts?: ReadonlyArray<ComposedPart>;
// and `fragments: ReadonlyArray<MountedEntry>` (assignable both ways with Entry).

// core/compose/roles.ts
export const ROLES: ReadonlyArray<{ readonly id: "api" | "web"; readonly client: boolean }>;
export const knownRole: (role: string) => boolean;
export const isClientRole: (role: string) => boolean;
export type RoleRule = "api-port-env" | "api-healthz-serve" | "web-port-env";
/** Declared rules a part of this role breaks, read from its meta only (trust point 1). Unknown role: none. */
export function declaredRuleProblems(role: string, meta: StackMeta): ReadonlyArray<{ rule: RoleRule; message: string }>;
```

`declaredRuleProblems`: `api` needs `PORT_API` in `env` (`api-port-env`) and a step with `phase: serve` whose `expect.http` contains `${PORT_API}` and ends in `/healthz` (`api-healthz-serve`); `web` needs `PORT_WEB` in `env` (`web-port-env`).

Tests (new `tests/workspace-contracts.test.ts`; extend `tests/errors.test.ts` only if its table test needs the new reasons listed):

- Each new `EntryInvalid` reason encodes in the envelope with `part` and `step`, and human mode prints the `Part:` and `Step:` lines before `Next:`.
- A `ComposeConflict` with `parts` prints `Parts: backend, frontend` and encodes `parts` in the envelope.
- `errorTable` and `stacks schema error` list the new reasons.
- `declaredRuleProblems`: `api-part` passes; without `PORT_API` it reports `api-port-env`; a serve step ending `/health` or using a literal port reports `api-healthz-serve`; `web-part` passes; without `PORT_WEB` it reports `web-port-env`; `knownRole("mobile")` is false.
- Every fixture entry decodes (`Registry.all` over `workspaceRegistry` has no rejected entry).
- `validate` still runs over the bundled registry with the stub registered (one `runCli(["validate", ...])` on the fixture, exit 0 or findings only from existing checks).

Scoped tests: `bun run test:unit tests/workspace-contracts.test.ts tests/errors.test.ts`, then lint and typecheck.

Done: contracts compile, the fixture decodes, the tests above pass, nothing else changes behaviour. Merged before 3A.1 branches.

## 3A.1 Compose core

Model: opus.

Owned files:

| File | Responsibility |
| --- | --- |
| `packages/cli/src/core/compose/mount.ts` (new) | The session-root list, path placement, fragment placement, the meta rewrite, and the per-entry condition context |
| `packages/cli/src/core/compose/parts.ts` (new) | Part problems as data, for compose (first one refused) and validate (all reported) |
| `packages/cli/src/core/compose/selection.ts` | `loadParts` (pin preference, `part_*` refusals), fit over the workspace and every part in `checkFit`, add-mode `selectWith`, `with_not_applicable` and `selectAlwaysFragment`; add mode takes parts from `options.parts` |
| `packages/cli/src/core/compose/compose.ts` | Calls the mount step after `selectFragments`; per-entry resolver; emitted entries `[workspace, ...parts, ...fragments]` in new mode; `checkPayload` per part; `recipeNotes` sources include the parts; `untrustedEntries` sees the parts; `Composition.parts` |
| `packages/cli/src/core/compose/plan-files.ts` | Per-entry overlay id (`entry.mount?.stack ?? selection.stack`) and payload; placed output paths; the identical-file collapse on session-root paths |
| `packages/cli/src/core/compose/files.ts` | `readFiles`' owner list includes the parts' entries |
| `packages/cli/src/core/compose/conflicts.ts` | `parties` names the first unmounted stack as `stack` (else the first stack) and the mounted stacks' part names as `parts` |
| `packages/cli/src/core/project/manifest.ts` | `buildManifest` writes `parts` (`{ name, role, stack: manifestEntryRef(entry) }`) only when `composition.parts` is present; `DigestInput` unchanged |

Contracts:

```ts
// core/compose/mount.ts
export const SESSION_ROOT_PATHS: Readonly<Record<AgentId, ReadonlyArray<string>>>;
/** Whether an entry-relative output path is one a harness reads only at the session root. */
export function atSessionRoot(path: string): boolean;
/** A mounted entry's output (or merge) path: under `<mount.name>/` unless it is a session-root path. */
export function placedPath(path: string, mount: PartMount | undefined): string;
/** The mount a fragment is placed on: exactly one mount's stack id named in `applies_to`, and not the workspace id. */
export function placement(appliesTo: ReadonlyArray<string>, workspace: string, mounts: ReadonlyArray<PartMount>): PartMount | undefined;
/**
 * The entry with its meta rewritten for its mount: steps `<name>-<step>` with `cwd` joined to the part directory,
 * commands and dependency roles `<name>-<key>` (a command the workspace already declares under that key is dropped),
 * `merge` paths through `placedPath`. A `cwd` that leaves the part directory is `EntryInvalid` `part_cwd`.
 */
export function mountEntry<E extends Entry>(entry: E, mount: PartMount, workspace: Stack): Effect.Effect<E & { mount: PartMount }, EntryInvalid>;
/** The condition context for one entry's body (see "Other decisions made here"). */
export function contextFor(entry: MountedEntry, root: ConditionContext, input: {
  parts: ReadonlyArray<ComposedPart>; placed: ReadonlyArray<MountedEntry>; payloads: ReadonlyMap<string, Payload>;
}): ConditionContext;

// core/compose/parts.ts
export type PartProblem = {
  reason: "part_stack" | "part_role" | "part_name_duplicate" | "part_nested" | "part_roles";
  part?: string;
};
/** In parts order: duplicate name, unknown stack, nested, unknown role; then the role count (no `part`). */
export function partProblems(
  parts: ReadonlyArray<StackPart>,
  lookup: (stackId: string) => StackMeta | undefined,
): ReadonlyArray<PartProblem>;

// core/compose/plan-files.ts
export type FileSelection = {
  agents: ReadonlyArray<AgentId>;
  stack: string | null;
  payload: Payload;
  /** A stack-kind entry's effective payload by `entryKey`, when it differs from `payload`. */
  payloads?: ReadonlyMap<string, Payload>;
};
```

`part_roles` holds when the count of `api` parts is not exactly one or the count of client parts (`isClientRole`) is not exactly one. A part whose stack can't be found, or decodes as a workspace, fails before its role is counted. Pin preference in `loadParts` mirrors `selection.ts::compositionFragment`: `workspace.partEntries?.[part.name]` wins unless the catalog's current entry for that stack id has origin `project` or `user`.

Test cases (new `tests/compose-workspace.test.ts` for composition, `tests/new-workspace.test.ts` for one `runCli` pass per refusal and the written tree):

- `new pair`: the workspace's files at the root, `api-part`'s under `backend/`, `web-part`'s under `frontend/`; `backend/package.json` rendered from the template; `backend/README.md`, `frontend/README.md` and the root `README.md` all written.
- Steps: `backend-install`, `backend-lint` (cwd `backend`), `frontend-test` (cwd `frontend`), the workspace's `both` (no cwd); a part step with `cwd: sub` gets `backend/sub`; `db`'s `migrate` with `cwd: .` gets `backend`.
- Commands are `backend-lint`, `frontend-dev` and the workspace's `check`; deps roles `backend-dev`, `backend-runtime`, `frontend-dev`; env holds `PORT_API` and `PORT_WEB` with no conflict.
- (a) `--with db`: role `backend` becomes `backend-backend`.
- (b) a workspace `backend-test` command keeps the workspace's description and no part `backend-test` replaces it; the workspace's `backend-dev` deps role merges with the part's.
- (c) `cwd: ..`, `../x` and an absolute `cwd` on a part step, and on `db`'s step, each fail `EntryInvalid` `part_cwd` with `id: pair`, the part and the prefixed step; nothing is written.
- Placement: `client-link` lands in `frontend/` with step `frontend-client-drift`; `harness` (names both parts) is written once at the root and its `harness-ok` step appears once, unprefixed; `db` lands in `backend/` from `stacks/api-part/` only, and `frontend/src/db-client.ts` is never planned; `root-ci` lands at the root; a fragment matching only by tag lands at the root; a fragment naming `pair` lands at the root with a `stacks/pair/` overlay.
- Session-root list: both parts' `.claude/settings.json` and `harness`'s deep-merge into one root `.claude/settings.json` holding each hook once; `shared-guard.sh` from both parts is one root file with both stacks in `owners` and its executable bit kept; `backend/.claude/rules/api.md` stays in the part; `.agents/skills/api-skill/SKILL.md` is at the root; `AGENTS.md` stays in each part.
- (g) a one-byte difference in one part's `shared-guard.sh` fails `ComposeConflict` `file_owner` with `path: .claude/hooks/shared-guard.sh`, `stack: api-part` (no unmounted stack is a party) and `parts: [backend, frontend]`.
- A mounted non-root merge path: `api-part`'s and `db`'s `config/app.json` merge into `backend/config/app.json`; without the mounted `merge` list that would be `file_owner`.
- The root collision: the workspace shipping `backend` or `backend/README.md` fails `file_owner` with `stack: pair` and `parts: [backend]`.
- A root fragment with step `backend-lint` fails `step_name` naming both.
- Condition context: `api-part`'s `with=root-ci` block is dropped and its `with=db` block kept only under `--with db`; its `tag=bun` block is kept; `root-ci`'s `tag=bun` block is dropped; the workspace's `with=client-link` block is kept.
- Payload: `--payload none` writes `backend/src/empty.ts` and not `notes.ts`, and keeps `frontend/src/notes-page.ts`; a payload no part and not the workspace ships is `BadInput` (`flag: payload`).
- Selection: `--preset lean` drops only `root-ci`; `--without root-ci` works; `--with db` gives no `with_not_applicable` warning; `--with` a fragment that fits neither part nor the workspace warns `with_not_applicable`; an `always` fragment that fits only a part is selected; the parts' own `required` and `default` tiers are not selected.
- Failure cases, each through `runCli new` with exit 2 and the envelope's details: `part_stack` (`id: pair`, `part`), `part_role`, `part_name_duplicate`, `part_nested`, the three `part_roles` variants, decode for a non-kebab name (unchanged), and the root collision above.
- Trust: a project-root `web-part` shadow is listed in `composition.untrusted` and `new` without `--no-launch` does not launch (trust point 3).
- Pins: a workspace `Entry` with `partEntries` composes those entries; a user-root `web-part` overrides the pin.
- Add mode: `compose({ mode: "add", stack: "pair", parts: [...] , with: ["db"] })` places `db` on `backend`; with `api-part` removed from the registry it still places by stack id and fits by id; the registry entry's `meta.parts` is ignored when `options.parts` is given; `recipeNotes` returns `api-part`'s `with=db` block.
- Manifest: `buildManifest` writes `parts` with `EntryRef`s for a workspace and no `parts` key for a single stack; `readManifest` reads it back; `checkTamper` reports an edited mounted `cwd` as changed and does not see an edited `Manifest.parts` name.
- Goldens unchanged (the list above).

Scoped tests: `bun run test:unit tests/compose-workspace.test.ts tests/new-workspace.test.ts tests/compose.test.ts tests/compose-files.test.ts tests/manifest.test.ts tests/new-manifest.test.ts tests/verify-tamper.test.ts` plus the goldens.

Done: both new test files pass, the goldens and existing compose, manifest and tamper tests pass unchanged, lint and typecheck are clean, and `plan-files.ts` and the condition context are the only places outside `mount.ts` and `selection.ts` that read `mount`.

---

## 3B.1 Workspace brief

Model: opus (wording, and byte-identity for single stacks).

Owned files: `packages/cli/src/core/brief/render.ts`, `packages/cli/src/core/brief/text.ts`, `packages/cli/src/core/brief/render-add.ts`.

Reads: `Composition.parts`, `MountedEntry.mount`, `roles.ts::isClientRole`; patterns `brief/render.ts::writeGuidance` and `render-add.ts::writeGuidance`.

Contracts: the text slots in decision (e). `renderBrief` order when `composition.parts` is present: the workspace's guidance; each part's section (`sections.part`, then `sections.partLine`, then its body) in `parts` order; each link (a fragment with `category: link` and a mount whose role is a client role) with `sections.link` and `sections.linkLine(api part's name, the link's part name)`, in composition order; every other base fragment, with `sections.placed` after its heading when it has a mount; then the definition of done, the application and After green as today. The facts block writes `facts.part` for each part right after `facts.stack`, and `facts.workspaceRoot` in place of `facts.root`. `start.build` gets `workspace: true`. `installer` returns `null` when `composition.parts` is present. Every new line is written with `out.fixed` except names, so `fixedWords` counts it. `renderAddBrief` writes `sections.placed` after a placed fragment's heading.

Test cases (new `tests/brief-workspace.test.ts`, over `composeExit` on `workspaceRegistry`):

- Section headings appear in the order workspace, `backend`, `frontend`, `client-link`, `harness`, `root-ci` (and `db` with `--with db`, after `client-link`).
- Each part section's first line is exactly `partLine` with its directory; the link's is `linkLine` naming `backend/` and `frontend/`; `db`'s is `placed` with `backend/`; `harness` and `root-ci` have no such line.
- The facts block lists both parts with role and stack id and uses the workspace root line.
- Step 3 of Start here names Part and Link sections in a workspace and is today's text otherwise.
- Step 1 points at the dependency list rather than an install command for the workspace.
- An app fragment in a workspace still comes after the definition of done.
- `fixedWords` grows by the new fixed lines and `briefWords` minus `fixedWords` equals the bodies' words.
- An add brief for `add db` on a workspace project opens `db`'s section with the placed line.
- Single-stack briefs are byte-identical: `tests/brief.test.ts` and the bundled brief digests unchanged.

Scoped tests: `bun run test:unit tests/brief-workspace.test.ts tests/brief.test.ts tests/words.test.ts tests/bundled-compositions.test.ts`.

Done: the cases pass, single-stack digests unchanged, lint and typecheck clean.

## 3B.2 `add` and telemetry

Model: sonnet. The compose side is done in 3A.1; this lane passes the manifest's parts in, checks the part directories and extends two telemetry functions, all with fixed outcomes.

Owned files: `packages/cli/src/core/add/project.ts`, `packages/cli/src/core/add/prepare.ts`, `packages/cli/src/telemetry/events.ts`, `packages/cli/src/telemetry/composition.ts`.

Reads: `ComposeOptions.parts`, `ManifestPart`, `Manifest.parts`; patterns `add/project.ts::readAddProject` and `telemetry/composition.ts::completeAddFacts`.

Contracts:

```ts
// add/project.ts
export type AddProject = { /* existing fields */ parts: ReadonlyArray<PartMount> };
// readAddProject: after checkTamper, each previous.parts directory must lstat as a directory (not a symlink),
// else PermissionDenied { reason: "blocked", path: <name> }; a part stack the registry lacks adds
// the warning { code: "part_unknown", id: <stack id> }.
// add/prepare.ts::composeDelta passes `parts: project.parts` when non-empty.
// telemetry/events.ts::scaffoldEvent: the official check, nonOfficialCounts and the fingerprint gate cover
// every manifest.parts[].stack as well.
// telemetry/composition.ts::completeAddFacts re-resolves each part's stack ref; officialFingerprint returns
// undefined when the registry workspace's parts (name and stack id, in order) differ from the manifest's.
```

Test cases (new `tests/add-workspace.test.ts` with projects from `newWorkspace`; new `tests/telemetry-workspace.test.ts`):

- `add db` writes `backend/src/db.ts` and nothing under `frontend/`, adds `backend-up` and `backend-migrate` with cwd `backend`, merges `backend/config/app.json`, and keeps `Manifest.parts` unchanged.
- `add` of a fragment that fits neither part nor the workspace fails `ComposeConflict` `applies_to`.
- `add` of a fragment whose prefixed step equals an existing step fails `step_name` before anything is written.
- `missingRequired` reports a workspace-required fragment the project dropped.
- A removed `frontend/` directory, a `frontend` that is a file, and a `frontend` symlink to another directory each fail `PermissionDenied` `blocked` with `path: frontend`, and the project is unchanged.
- A `Manifest.parts` name edited to another existing kebab directory (and the tamper baseline untouched, since `parts` is outside the digest) places `db` there: the documented reach, no wider than an edited `Manifest.stack.id`.
- With `api-part` removed from the registry, `add db` warns `part_unknown` and still writes under `backend/`.
- A project-root `api-part` shadow whose body has a `with=db` block lists it in `untrusted`, and the add keeps the previous digest baseline under an agent (trust point 4).
- Telemetry: a bundled workspace over a user-root part reports `origin` not official and no fingerprint; an edited `Manifest.parts` stack ref claiming `bundled` is re-resolved to its real origin; a manifest whose parts differ from the registry workspace's gets no recomputed fingerprint; an all-bundled workspace reports the fingerprint.

Scoped tests: `bun run test:unit tests/add-workspace.test.ts tests/telemetry-workspace.test.ts tests/add.test.ts tests/add-manifest.test.ts tests/telemetry-events.test.ts`.

Done: the cases pass, existing add and telemetry tests unchanged, lint and typecheck clean.

## 3B.3 `validate`

Model: opus.

Owned files:

| File | Change |
| --- | --- |
| `packages/cli/src/core/validate/checks/workspace.ts` | Replaces the stub: every validated stack with `parts`, resolved against `view.all`, without composing |
| `packages/cli/src/core/validate/checks/commands.ts` | `undeclaredStepCommands` looks owners up among the workspace, the parts' entries and the fragments, and accepts `<mount.name>-<target>` for a mounted owner's step; part steps are checked |
| `packages/cli/src/core/validate/checks/verify-notes.ts` | `duplicateRuns` groups by `cwd` and `run`, so the same command in two parts is no duplicate |
| `packages/cli/src/core/validate/compositions/compose-each.ts` | `fitsByAppliesTo` and `hostsOverlay` count a workspace as fitting when any part's stack does, so part-scoped fragments are composed onto it |
| `packages/cli/src/core/validate/compositions/compositions.ts` | `fittingApps` uses the same fit; `reportedElsewhere` treats a `part_*` `EntryInvalid` as reported by `workspaceChecks` |
| `packages/cli/src/core/validate/compositions/add-compositions.ts` | Passes the base manifest's `parts` into the add composition |
| `packages/cli/docs/reference/validation.md` | The new check names |

Findings from `workspaceChecks` (on the workspace stack's `STACK.md`):

| Check | Severity | When |
| --- | --- | --- |
| `part-stack`, `part-role`, `part-name-duplicate`, `part-nested`, `part-roles` | error | each `parts.ts::partProblems` result, naming the part |
| `part-cwd` | error | a part's step, or a fragment's that `applies_to` names exactly one part, whose `cwd` leaves the part directory |
| `part-role-rule` | error | each `roles.ts::declaredRuleProblems` result, naming the part and the rule |
| `part-required-restated` | error | a part's `fragments.required` id missing from the workspace's `required` |
| `link-openapi-drift` | error | the workspace's `required` holds a `category: link` fragment and the `api` part has no verify step named `openapi-drift` |
| `workspace-heading` | warning | no `## How the parts connect` or no `## Changing the API` heading (`## Setup` stays `stack-setup-section`'s) |
| `workspace-part-dirs` | warning | the body never mentions `<name>/` for some part |
| `part-namespace-shadowed` | warning | a workspace command key or deps role equals `<part>-<key>` of a part's command or role |

Test cases (new `tests/validate-workspace.test.ts`, `runCli(["validate", <root>, "--json"])` on `workspaceRegistry` and variants):

- The fixture has none of these findings and no `undeclared-command` for part steps (`backend-test` covers `bun run test` in `backend`).
- Each failure-case variant produces its finding once, naming the part, and no duplicate composition finding for the same cause.
- A workspace that drops `harness` from `required` reports `part-required-restated` for both parts' requirement.
- `api-part` without `PORT_API`, with a serve step ending `/health`, and `web-part` without `PORT_WEB` each report `part-role-rule` naming the rule.
- Removing `openapi-drift` from `api-part` reports `link-openapi-drift`; removing `client-link` from `required` clears it.
- Each missing heading reports `workspace-heading`; a body without `frontend/` reports `workspace-part-dirs`.
- The shadowing variant reports `part-namespace-shadowed` for the command and the role.
- A part step running an undeclared target (`bun run nope`) reports `undeclared-command` on the part.
- Two parts each running `bun run test` give no `verify-run-duplicate`; two steps in one part running one command still do.
- `compose-each` composes `db` onto `pair` and reports its problems with the workspace as host; the add compositions place `db` on `backend`.
- A stack with no `parts` gets none of the new findings (the bundled registry's validate output is unchanged: `tests/validate-shipped.test.ts`).

Scoped tests: `bun run test:unit tests/validate-workspace.test.ts tests/validate.test.ts tests/validate-command-edges.test.ts tests/validate-shipped.test.ts`.

Done: the cases pass, existing validate tests unchanged, lint and typecheck clean.

## 3B.4 Proof and the index pin

Model: opus.

Owned files:

| File | Change |
| --- | --- |
| `packages/cli/src/core/fingerprint.ts` | `proofFingerprint` hashes, after the workspace's fields and only when `composition.parts` is present, each part in order: `part:<name>`, its role, its stack id, its mounted meta without hygiene tags, its resolved body, and its written files (source, executable bit, bytes). `writtenStackFiles` takes the entry and matches a planned file by owner and `placedPath`, so collapsed and merged root files count for every part that wrote them. `fingerprintFromFiles` hashes `[stack, ...parts' entries, ...fragments]` |
| `packages/cli/src/core/registry/remote/merge.ts` | `pinnedParts` resolves `ref.parts` (part name to digest; the stack id from the workspace's decoded `meta.parts`), reusing a bundled copy whose directory matches the digest, else downloading; any part unavailable makes `resolveReference` fall back to `bundledComposition`, which also sets `partEntries` from the bundled part stacks; `pinnedReference` takes the kind |
| `packages/cli/scripts/index/proof.ts` | `stackEntry` and `unprovenStack` write `parts` (part name to the part stack's bundle digest) from the proven composition; `publicationEntries` publishes each pinned part stack's entry and bundle even when it has no proof of its own |
| `packages/cli/scripts/index/publish.ts` | Carry-forward includes a stale workspace's pinned part bundles as `includePinnedFragments` does for fragments |
| `packages/cli/scripts/index/remote.ts` | `bundleRefs` adds each workspace's part pins, given the part stack ids |
| `packages/cli/scripts/index/bundle.ts` | A helper that reads a workspace bundle's `STACK.md` frontmatter into part name to stack id, for `bundleRefs`, `checkHost` and carry-forward (dropped if the pin gains a stack id) |

Contracts:

```ts
// scripts/index/remote.ts
export function bundleRefs(entries: ReadonlyArray<IndexEntry>, partStacks: (workspace: IndexEntry) => Readonly<Record<string, string>>): BundleRef[];
// scripts/index/bundle.ts
export const partStackIds: (bundle: Uint8Array) => Effect.Effect<Readonly<Record<string, string>>, Error>;
```

Test cases (new `tests/fingerprint-workspace.test.ts`, `tests/workspace-index.test.ts` on `tests/helpers/remote-index.ts` and `tests/fixtures/index/harness`):

- An existing stack's `proofFingerprint` is unchanged (the golden in `tests/fingerprint-snapshot.test.ts`).
- A one-line change in `web-part`'s body, a shipped file or its meta changes `pair`'s proof fingerprint and `web-part`'s, and leaves `api-part`'s unchanged.
- A change to a file only the other part writes doesn't change that part's section; the collapsed `shared-guard.sh` and the merged root `settings.json` count for both parts.
- `fingerprintFromFiles` differs between `pair` and a copy whose part list is swapped.
- `build:index --unsigned --include-unproven` over the fixture writes `pair`'s `parts` as `{ backend: <api-part digest>, frontend: <web-part digest> }` and publishes both part stacks' bundles.
- A signed build where only `pair` is proven still publishes both part bundles.
- A carried-forward `pair` whose part digest differs from the current part keeps the old part bundle served; `--check` fetches every part bundle.
- Reader: a pinned part whose bundled copy matches is used without a download; one that differs is downloaded; a missing pinned part bundle falls back to the whole bundled `pair` with its bundled parts (no drifted part composed with the index workspace); a user-root part overrides the pin.
- A shadowed part changes `show`'s `lastRun.sameContent` (through `proofFingerprint`).

Scoped tests: `bun run test:unit tests/fingerprint-workspace.test.ts tests/workspace-index.test.ts tests/fingerprint.test.ts tests/fingerprint-snapshot.test.ts tests/remote-index.test.ts tests/build-index.test.ts tests/build-index-unproven.test.ts`.

Done: the cases pass, the single-stack proof golden unchanged, lint and typecheck clean. If the pin gains a stack id first, `bundle.ts` is not touched and `bundleRefs` reads the pin directly.

---

## 3C Results: `new --json`, `show`, MCP mirror

Model: sonnet. Additive optional fields with fixed shapes.

Owned files: `packages/cli/src/core/scaffold/report.ts`, `packages/cli/src/schemas/new.ts`, `packages/cli/src/schemas/show.ts`, `packages/cli/src/core/show/index.ts`, `packages/cli/src/core/show/report.ts`, `packages/mcp/src/schemas/cli.ts`.

Contracts:

```ts
const ResultPart = Schema.Struct({ name: Schema.String, role: Schema.String, stack: Schema.String });
// NewResult and ShowReport gain, after `stack` and after `fragments` respectively:
parts: Schema.optionalKey(Schema.Array(ResultPart)), // absent for a stack without parts
// packages/mcp/src/schemas/cli.ts::NewResult mirrors the same optional field.
```

`show` text (human and agent) adds one line after the fragments, `Parts: backend (api, api-part), frontend (web, web-part)`.

Test cases (new `tests/results-workspace.test.ts`; MCP unit tests in `packages/mcp/tests`):

- `new pair --json` and `new pair --dry-run --json` carry `parts` in `parts` order; a single-stack `new --json` has no `parts` key (`tests/json-key-order.test.ts` unchanged).
- `stacks schema new` and `stacks schema show` include the optional `parts`.
- `show pair --json` lists the parts, and human and agent text print the line; `show api-part` has no `parts`.
- The MCP `stacks_new` tool decodes a result with `parts` and one without; an older result shape still decodes.

Scoped tests: `bun run test:unit tests/results-workspace.test.ts tests/json-key-order.test.ts tests/show.test.ts tests/schema.test.ts` in `packages/cli`, and `bunx vitest run` on the touched MCP test files in `packages/mcp`. `e2e/schema-drift.test.ts` runs in 3D's gate.

Done: the cases pass, lint and typecheck clean.

## 3D Integration

Orchestrator, after every lane is merged:

- `packages/cli/docs/reference/commands.md`: `new`'s workspace layout, the `part_*` reasons and `parts` in `ComposeConflict`, `parts` in `new --json` and `show --json`, `add` in a workspace (placement, `part_unknown`, the `blocked` part directory), and that `verify --only` keeps both parts' setup steps.
- `AGENTS.md` "Architecture map": the `core/compose/` line names `mount.ts`, `parts.ts` and `roles.ts`. `packages/cli/src/README.md` glossary: part, mount, workspace, link.
- The gate once, then one `code-reviewer` pass over the merged diff, findings fixed, the gate again only if a fix touched code.

## What Phase 3 leaves out

`create --from` and `submit` for a workspace, two parts of one stack, roles beyond `api` and `web`, the condition key in "Needs a decision" item 2, and the broken guidance link of a hoisted skill from a fragment placed on one part (`rest-api`, RFC "Still open").

## RFC claims found wrong or outdated

- `verify --only` running setup steps was left unestablished ("Edge cases"); it is existing behaviour, `verify/plan.ts::isSelectable`.
- "`ComposeConflict`, with `conflicts.ts::parties` naming both stacks": `ComposeConflictDetails.stack` holds one id and `parties` picks the first stack, so naming both needs a new field (`parts`, 3A.0).
- "Each `EntryInvalid` reason gets its `failureGuide` line": `failure-guide.ts::entryGuide` has no per-reason lines; it prints the reason generically. 3A.0 adds `Part:` and `Step:` lines and one next action for every `part_*` reason.
- "`renderBrief` writes the stack's guidance, then each fragment's in composition order": it loops over `brief.base`, which leaves out the app, and `writeApplication` writes the app after the definition of done. The workspace order keeps that.
- The fixed facts line `brief/text.ts::facts.root` says to run every command from the project root, which the part line contradicts; the RFC doesn't mention it.
- The part pin "keyed by part name" is not enough for the index scripts: `scripts/index/remote.ts::bundleRefs` and `checkHost`, and `publish.ts`'s carry-forward, build bundle paths from `IndexEntry` alone and need the part's stack id.
- "A block that applies only in a workspace" (also in the landed authoring docs) has no `stacks:when` key that can express it (`conditionals.ts::KEYS`).
- The single-stack fit list in Phase 3 misses two callers in `validate`: `compose-each.ts::fitsByAppliesTo` and `compositions.ts::fittingApps` call `fitsStack` with one stack.
- `telemetry/composition.ts::completeAddFacts` re-resolving the part refs is not enough: its `officialFingerprint` recomposes from the registry workspace's own `parts`, so it also has to refuse a manifest whose parts differ.
- "`files.ts::readSource` finds owners among the stack and fragments only": the owner list is built in `files.ts::readFiles`; `readSource` searches whatever it is given.
- "A part's `cwd` of `..` ... should be refused": the RFC names no error, and no existing `EntryInvalid` reason fits, hence `part_cwd`.
- "The two required headings are checked the same way" as `## Setup`: `checks/format.ts::stackProblems` reports a missing `## Setup` as a warning, not a failure, while the RFC says `validate` "must fail" a missing restated fragment. The plan keeps headings as warnings and the restated check as an error.
