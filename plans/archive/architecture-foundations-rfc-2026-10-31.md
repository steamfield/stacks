# RFC: Strengthen architectural boundaries

Status: EXECUTED 2026-10-31. All six units landed on `main` with their regression tests; the "Deferred" list below stays deferred.

## Summary

Keep the current monorepo and Effect architecture. The separation between CLI
behavior, portable contracts, platform adapters, and repository tooling is sound:
there are no runtime import cycles in `packages/cli/src`, nothing in `core/`,
`services/` or `telemetry/` imports `commands/`, and only `bin.ts`, `platform/` and
`config.ts` read the environment.

The work is three correctness fixes where a write or lookup bypasses the module
built for it, two small moves, and lint rules that make the existing boundaries
enforceable. Abstractions that would exist only to satisfy a new rule (an injected
process port, a one-method directory-cleanup service) are cut; the rules name those
two imports as explicit allowances instead.

## Implementation changes

Units run in the order below. Units that share a file never run in parallel.

### 1. Characterization tests first

These pass on current code and guard the later units. Each is revert-checked by
construction (it must pass before and after).

- A golden test with literal `sha256:` values for one fixed manifest's
  `digestSteps`, `digestStep` and `digestSettings`, and one fixed composition's
  `fingerprint`. Today only `canonicalJson`'s string output is tested, and the
  ledger fingerprint checks are notes, which never fail.
- In `tests/scaffold-write.test.ts`: put a foreign file into a directory the
  writer created, then fail the scope. The directory and file survive and the
  original failure is the outcome.

### 2. Accepted manifests go through the project writer

`core/verify/tamper.ts::acceptChanges` writes through
`core/manifest.ts::writeManifest`, a plain `writeFileString`: it follows a
symlinked `.stacks/manifest.json`, isn't atomic, and hand-rolls rollback of the
state record. Use the pattern `core/add/write.ts::applyAdd` already uses:
`replaceProjectState` around `openProject(root).rewrite`, with the project root
derived from the manifest path. Delete `writeManifest` and its round-trip test in
`tests/manifest.test.ts` (the new behavior is covered by the tests below).

Preserve: the one uninterruptible accept region, and a `replaceProjectState`
failure mapping to `state-unwritable` before the manifest is touched.

Behavior changes, stated and tested:

- A symlinked manifest now fails `--accept-changes` with `PermissionDenied`
  (`reason: "escape"`, exit 6) instead of writing through the link. Check that
  `failureGuide`'s escape text reads correctly from `verify`.
- A manifest write failure reports `rewrite`'s details (`unwritable` and the real
  path) instead of `reason: "write"` and the given path.

`tests/verify-tamper.test.ts`'s interrupt-during-accept test hooks
`writeFileString` on the manifest path; `rewrite` writes to a temp file and
renames, so the test is rewritten to hold the `rename` onto the manifest path.
Regression tests start failing: symlinked manifest refused and its target
unchanged; the JSON envelopes for state-unwritable, manifest-unwritable and
symlinked-manifest failures decoded through `ErrorEnvelope`.

### 3. A failed skill install rolls back

`core/skill.ts`'s `installedFiles.replace` reimplements `ProjectWriter.rewrite`,
so a `skill install --force` that fails partway leaves earlier files replaced.
Use `rewrite`. Regression test: make the second file's parent unwritable (skipped
as root, as `tests/scaffold-write.test.ts` does) and assert the first file's
original bytes are back.

Behavior changes, stated and tested: errors report the real path rather than the
given spelling; a non-file appearing at the last moment becomes `PermissionDenied`
`escape` (exit 6) instead of `TargetNotEmpty` `non-file` (exit 2); a replaced
file keeps the old file's mode.

### 4. `add` telemetry describes the `--dir` project

`telemetry/index.ts::recordScaffold` rebuilds a `Registry` from `remoteRoots`,
which reads the current directory's `.stacks/`, not the `add --dir` project, so an
entry that project overrides is reported as the bundled one with the bundled
fingerprint. Pass the command's `Registry["Service"]` into `recordScaffold`; keep
`ScaffoldFacts` unchanged and keep `telemetry/composition.ts::completeAddFacts`
lazy behind the consent check, re-resolving every `manifest.fragments` ref as it
does now. `commands/add.ts` provides one `Registry.layer(roots)` around both its
picker, `add` and the telemetry, so the registry loads once.

Regression test (starts failing): `add --dir <other>` where the other project
overrides a bundled fragment, run from a cwd without that override. The event
reports `custom`, counts it under `nonOfficial.project`, and has no fingerprint.

### 5. Small moves

- Extract `canonicalJson` word for word into `core/canonical-json.ts`; manifest
  digests, `fingerprint` and `searchSourceDigest` import it, and
  `tests/manifest.test.ts`'s import follows. The unit 1 golden test must pass
  unchanged. Leave `core/compose/merge.ts::canonical` alone: it differs on
  `undefined` and isn't a digest.
- Use `@effect/platform-node/NodeSocket` instead of
  `@effect/platform-bun/BunSocket` in `platform/net.ts` (both re-export
  `@effect/platform-node-shared/NodeSocket`). It was the only use, so drop
  `@effect/platform-bun` from `packages/cli/package.json` and the root catalog,
  and update `.claude/skills/effect/SKILL.md`'s "checked against" line. Registry
  content that names the package as data stays. Compare `dist/cli.mjs` size before
  and after.
- `tests/helpers/search-command.ts` loads `rank` and the search schemas with a
  computed `import()` into `../../../format/src/search/`. Import them from
  `@steamfield/stacks-format`, which exports them.

### 6. Enforce the boundaries (last)

Extend `packages/cli/biome-plugins/boundaries.grit` and mirror every rule in
`.claude/hooks/guard-boundaries.ts` with tests in
`tests/hooks/guard-boundaries.test.ts`:

- `core/` and `services/` cannot import `platform/` or `commands/`, including
  `import type`, `export ... from` and literal `import()`. One allowance:
  `services/processes.ts` → `platform/process.ts`.
- `node:` builtins in `core/` and `services/` are rejected except this
  allowlist: `node:crypto` in `core/{manifest,fingerprint,search/digest}.ts`,
  `node:util` in `services/output.ts`, `node:fs/promises` in
  `core/scaffold/write.ts` (atomic `rmdir`; Effect's `FileSystem.remove` calls
  `rm`, which refuses a directory without `recursive`). `node:os` stays in
  `config.ts`, which is outside `core/`.
- Imports into another workspace package's `src/` or private subpaths are
  rejected across packages' `src/`, `scripts/` and `tests/`, excluding
  `.*/registry/.*` (shipped entry code). Shared contracts go through
  `@steamfield/stacks-format`. Covering the root `tests/` and `scripts/` needs a
  plugin in the root `biome.json`; check whether a nested config's `plugins`
  merges with or replaces the root's before relying on inheritance. Computed
  `import()` specifiers and `fs` reads of another package's fixtures are out of
  scope; the probes record the computed `import()` as a known gap.

Probe each rule on real files, as `tests/boundaries.test.ts` does: static
imports, `import type`, `export * from`, `export { x } from`, literal `import()`,
prefixed and unprefixed builtins, each allowance, and the registry exclusion.

Update AGENTS.md and `.claude/rules/` where they describe these boundaries:
platform adapters implement services; core uses injected effects except the named
deterministic utilities and the `rmdir` allowance.

## Deferred

With evidence from the architecture scan, none a correctness bug today:

- An injected process port for `services/processes.ts` (one implementation, and
  the testing rules forbid stubbing own services).
- A `DirectoryCleanup` service (one call site).
- Moving `core/search/sidecar.ts` to `core/registry/metadata.ts` (a rename of a
  62-line module across about 15 importers, no cycle to break).
- One shared atomic JSON write for the five temp-and-rename copies
  (`cached-fetch.ts`, `search/remote.ts::saveBackoff`, `telemetry/storage.ts`,
  `ledger.ts::appendRecord`, `project-state.ts::saveProjectState`), which already
  differ on file mode and temp naming.
- Moving the registry's deep file walk from `Registry.layer` to
  `get`/`files`/`all` (`show <fragment>` makes about 2,500 `lstat` calls and
  composes once per ledger record).
- Splitting `errors.ts::BadInputDetails` into per-flag structs.
- A format-package rule against relative imports that leave the package
  (`tsconfig.build.json`'s `rootDir: "src"` already catches it for `src/`).

## Interfaces and scope

- No command, flag or published format changes. The exit-code and error-detail
  changes are the ones stated in units 2 and 3.
- Keep the current packages and directory layout. Do not extract a speculative
  MCP engine. Leave type-only cycles alone.
- Preserve structured logging, invocation IDs, bounded delivery and scoped
  concurrency.

## Verification

- Scoped tests per unit: digest golden, scaffold-write, verify-tamper, manifest,
  skill, add and telemetry, boundaries, and the root hook tests.
- Every new regression test is revert-checked: it fails with its fix reverted.
- `bun run human -- verify --accept-changes` in a changed project with `y` on
  stdin, and the same on a symlinked manifest.
- Lint and typecheck during implementation, then the full gate once as the final
  check (`rr check` when opted in, else `bun run check`), confirming the new test
  files appear in the counts and the installed-package e2e ran.
