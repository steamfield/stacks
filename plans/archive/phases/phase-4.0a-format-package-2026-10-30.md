# Phase 4.0a: The format package

Status: EXECUTED 2026-10-27 (gate green; publishing to npm is the maintainers' step)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | Move the entry, manifest and run-record schemas out of `packages/cli` into `packages/format`, published for the API's repository (D35), add `canonicalBundle` and `bundleDigest`, and leave every CLI behavior unchanged |
| Traces to | D11: "shared code gets its own package". The index build (4.0c), the remote origin (4.0d), telemetry (4.1a) and the API's ingest (4.1b onward, through the published copy) all need the same schemas; this is the second consumer D11 waits for |
| Depends on | 1.3b (`RunRecord` exists to move), 1.6c (the published package whose packing 0.2 defined) |
| Blocks | 4.0c, 4.0d, 4.1a, and the API's first import in 4.1b. 4.0b doesn't import it: before 4.0f the API serves only `/healthz` and static files |
| Decisions needed | None. If D11 is ever reversed, this sub-phase is skipped and later sub-phases import from `packages/cli` through a published entry point instead |
| Settles | What lives in `packages/format`; how the CLI depends on it through the workspace while the API depends on the published copy; the canonical bundle form |

## Scope

In:

- A new workspace package `packages/format` (`@steamfield/stacks-format`). Amended 2026-10-27 under D35: it was private and never published, but the API now lives in its own repository and can only depend on it through a registry, so it is published (under the CLI's npm scope; the name is decided at publish time, like D34's). The CLI still links it through the workspace and bundles it.
- A build for the published copy: `dist/` JavaScript plus `.d.ts` declarations. Exports conditions give the workspace the source and npm consumers `dist/` (below).
- A pack test that installs the packed tarball into a temporary project and imports it under Node 22 with no TypeScript transform.
- Publishing by hand: a maintainer packs and publishes it, as with the CLI's 0.1.0, until 5.0's release workflow takes over. The contract is the roadmap's "Published format package" row.
- Moving the contracts the roadmap marks "moves in 4.0a" (see roadmap, [Contracts: Types and schemas](../../roadmap.md#types-and-schemas)): `AgentId` and `DetectedAgent`; Entry format v1 (`StackMeta`, `FragmentMeta`, `VerifyStep`, `Probe`, `Check`); `Manifest`, `ManifestStep`, `EntryRef`; `RunRecord`. Same names, same behavior. `RunRecord` moves carrying 3.5b's optional `stages` field.
- New: `EntryBundle` schema, `canonicalBundle` and `bundleDigest` (roadmap, Contracts: Canonical bundle).
- Rewriting every CLI import of the moved code to `@steamfield/stacks-format` in this one change, and deleting the old files.
- A Grit boundary in the format package banning platform imports.

Out:

- Composition (`compose`, `composeFiles`, the `Composition` type), `fingerprint`, the registry loader, `validate`, the ledger file reader and `LedgerRecord`. They stay in the CLI; nothing outside the CLI needs them yet. `fingerprint` takes a `Composition` and calls `composeFiles`, so it can't move without them. The index build that needs them runs from `packages/cli/scripts/` (4.0c).
- `RegistryIndex` and the signed envelope (4.0c adds them), `TelemetryEvent` (4.1a), `StatsSummary` (4.2a).
- Any behavior change, new command, or test change in `packages/cli` beyond import paths.

## Design

### Where this fits

4.0a is a pure refactor plus two small new functions and a build for the published copy. The API (`stacks-api`, D35) first imports `@steamfield/stacks-format` in 4.1b, which starts after 4.0f, so 4.1b's tests are the first to run it inside the Workers runtime. The API depends on it through an npm alias (`"@steamfield/stacks-format": "npm:<published name>@^<version>"`), so its source imports `@steamfield/stacks-format` whatever the published name turns out to be. 4.0c uses `canonicalBundle` and `bundleDigest` to publish bundles, 4.0e uses the signed envelope 4.0c adds for the official-names file, and 4.0d uses the same two functions to compare remote and bundled copies. Once this lands, `packages/format` changes only by adding files (4.0c, 4.0e, 4.1a, 4.2a), never by changing what it exports.

### Package shape

```
packages/format/
  package.json     name @steamfield/stacks-format, type module,
                   exports { ".": { "bun": "./src/index.ts", "types": "./dist/index.d.ts",
                   "default": "./dist/index.js" } },
                   scripts build/typecheck/test/coverage/check/clean/pack
  tsconfig.json    extends ../../tsconfig.base.json; types: [] (no Node, no Bun)
  biome.json       { "root": false, "extends": "//", "plugins": [...] }
  biome-plugins/   no-platform-imports.grit
  src/             agent.ts, entry.ts, manifest.ts, run-record.ts, bundle.ts, index.ts
  dist/            generated, gitignored: index.js and .d.ts files, the only files packed
  tests/
```

Inside this workspace the package resolves to its source: Bun's build (the CLI's Node bundle, 0.2) picks the `bun` condition, and Vitest is configured with the same condition, so no build is needed to run the CLI or its tests. The published copy resolves to `dist/`, which `build` emits with `tsc` (JavaScript plus declarations) before packing, because Node refuses to strip types from files under `node_modules` and the API's bundler shouldn't need to transform a dependency. The exact condition name is checked against Bun and Vitest's resolvers during the work; a custom condition is the fallback if `bun` is resolved somewhere it shouldn't be. The tsconfig has no `@types/node` or `@types/bun`, which is the check that the package is safe to run on Workers. Only `effect` (the core package, through `catalog:`) is a dependency; `@effect/platform-*`, `node:*` and `bun` imports are banned by the Grit rule.

The package needs `typecheck`, `test` and `coverage` scripts so the root fan-out (`bun run --filter '*'`) runs it locally and in the existing CI job, which already calls `bun run typecheck` and `bun run coverage` at the root. No workflow change is needed (D23; CI edits are phase 5).

### How the CLI depends on it

`packages/cli/package.json` lists `"@steamfield/stacks-format": "workspace:*"` in `devDependencies`, next to the other packages 0.2's build inlines. The published tarball's `package.json` then names no runtime dependency on a package that doesn't exist on npm. There are no re-exports left in `packages/cli/src/schemas/`: every import moves in this change, so there is one name for each symbol from the day the package exists (the roadmap contracts table already says "moves in 4.0a"). A stale import is a compile error, not a silent second copy.

### Canonical bundle

Two digests, never confused: `fingerprint` (CLI, 2.0a) is a sha256 over a whole composition (its entries, the preset and the `composeFiles` output); `bundleDigest` (here) is a sha256 over one entry's canonical bundle.

An entry bundle is every file under an entry's directory (`STACK.md` or `FRAGMENT.md`, `files/`, `adapters/`), as bytes, with the executable bit.

```ts
// packages/format/src/bundle.ts (shape)
export const BundlePath = Schema.String.check(/* relative, "/"-separated, no "..", no leading "/", no "\\", no NUL */);
export const EntryBundle = Schema.Struct({
  id: EntryId, kind: Schema.Literals(["stack", "fragment"]),
  files: Schema.Array(Schema.Struct({
    path: BundlePath, executable: Schema.Boolean,
    encoding: Schema.Literals(["utf8", "base64"]), content: Schema.String,
  })),
});
export const canonicalBundle: (bundle: EntryBundle) => Uint8Array;  // deterministic bytes
export const bundleDigest: (bundle: EntryBundle) => Effect.Effect<Digest>; // sha256 hex of canonicalBundle
```

Rules (roadmap, Contracts: Canonical bundle): files sorted by path using byte order of the UTF-8 path; keys in the fixed order `id, kind, files` and `path, executable, encoding, content`; `utf8` only when the bytes round-trip exactly through UTF-8 decoding, otherwise `base64`; no whitespace; content is the raw file bytes, with no line-ending or trailing-newline normalization. Paths are the names in the entry directory, dotfiles included as stored (literally, `files/.gitignore`), so the digest of a bundled copy and an index copy of the same entry is the same. `bundleDigest` uses Web Crypto (`crypto.subtle.digest`), which exists on Node, Bun and Workers, so the package needs no platform import.

`kind` is `src/schemas/entry.ts::Kind` as 1.0 declared it, moved here unchanged. An app is a fragment with `category: app` (D18 as amended), so it is bundled with `kind: "fragment"` and there is no third kind to reserve.

`BundlePath` rejects path traversal at decode time so every reader of a bundle (the CLI extracting one, the API reading one) gets the check for free.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/format/` | New package as above, with its `build` and `pack` scripts and a pack test under `packages/format/tests/` |
| `packages/cli/src/schemas/entry.ts`, `manifest.ts`, `verify.ts` (the `RunRecord` part) | Moved into `packages/format/src/`; removed from the CLI. `src/core/fingerprint.ts` and `src/core/compose/` stay |
| `packages/cli/src/**`, `tests/**` | Imports rewritten to `@steamfield/stacks-format` |
| `packages/cli/package.json` | `@steamfield/stacks-format: workspace:*` in `devDependencies` |
| Root `package.json` catalog | Nothing new; the package uses `effect` and Vitest through `catalog:` |
| `.claude/rules/format/` | New rule file scoped to `packages/format/` (no platform imports, additive changes only after this sub-phase) |
| `AGENTS.md` | Architecture map gains `packages/format`; Overview no longer says only `packages/cli` has code |

## Acceptance tests

1. The schema tests that belonged to the moved code move with it and pass in `packages/format`; the fingerprint tests stay in the CLI unchanged.
2. `packages/format` typechecks with `types: []`; adding `import "node:fs"` to a probe file fails lint (Grit probe on a real temporary file, as the CLI's boundary tests do).
3. `canonicalBundle`: the same files in a different order give identical bytes; a CRLF file and its LF copy give different digests; a binary file round-trips through `base64`; property test over random file sets that decode-then-canonicalize is stable.
4. `BundlePath` rejects `../x`, `/x`, `a/../../x`, `a\\b` and an empty string.
5. The packed `@steamfield/stacks-format` tarball holds only `dist/`, `package.json` and the license; installed into a temporary project under Node 22 with no TypeScript loader, `import { bundleDigest, Manifest } from "@steamfield/stacks-format"` runs and decodes a fixture manifest, and the declarations typecheck a consumer file with `tsc`.

### Realistic edge cases

6. A literal dotfile path (`files/.gitignore`) stays literal in canonical bytes and survives decoding.
7. Changing only a file's executable bit changes the canonical bytes and digest.
8. An empty file stays present with empty UTF-8 content and differs from an absent file.
9. Non-ASCII paths sort by UTF-8 byte order, including paths whose UTF-16 order differs.
10. Invalid UTF-8 bytes stay lossless as base64; valid UTF-8 supplied as base64 canonicalizes to utf8.
11. A NUL anywhere in a bundle path is rejected at decode time.
12. Spaces and leading dashes in ordinary relative paths survive canonicalization unchanged.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root, now including `packages/format`.
- The CLI suite passes with no test file changed except import lines (`bun run test`, `bun run coverage` and `bun run e2e` in `packages/cli`); a diff of `packages/cli/tests/` and `e2e/` shows only import changes.
- The CLI's packed tarball names `@steamfield/stacks-format` in no runtime field of its `package.json` (`dependencies`, `peerDependencies`, `optionalDependencies`), and 0.2's existing packed-tarball e2e (installs it and runs `list --json`) passes unchanged.
- No file under `packages/cli/src/` defines a symbol that `packages/format` exports.
- `AGENTS.md` describes the package.

## What this plan may get wrong

- 2026-10-27: Bun's Node-target build does not select the proposed `bun` condition. The workspace uses standard `types` and `import` source conditions; packing replaces the exports map with `types` and `default` pointing at built `dist/`. Bun's build, Vitest and TypeScript therefore resolve source without consumer configuration or a prior build, and published consumers resolve built files.
- 2026-10-27: `Probe`, `Check`, `EntryId` and `Digest` in the sketches do not exist in the current schemas. The extraction preserves `Expect`; `EntryBundle.id` uses the existing entry id schema and `bundleDigest` returns an Effect of a `sha256:`-prefixed string, matching the CLI's fingerprint representation.
- 2026-10-27: the CLI's composition module already exported a different `EntryRef` shape (`{ kind, id }`). It is renamed to `CompositionEntryRef` so the persisted `EntryRef` has one definition under its exported name, as this extraction's acceptance requires; composition behavior is unchanged.
- 2026-10-27: Bun retains development dependencies in packed metadata, including workspace dependencies resolved to versions. Keeping the format dependency in CLI devDependencies therefore does not by itself remove it from the CLI tarball. npm never installs a dependency's devDependencies, and the CLI's other inlined packages sit there too, so the exit criterion now names only the runtime fields rather than rewriting the packed metadata.
- 2026-10-27: the plan exported only `.ts` source with no build, assuming every consumer transforms TypeScript. A published package is read from `node_modules`, where Node's type stripping refuses `.ts`, so the published copy now builds `dist/` and the workspace keeps resolving source through an exports condition.
- Exports conditions are resolved differently by Bun, Vitest and TypeScript. If one of them picks `dist/` inside the workspace, the CLI would run stale code after an edit without a rebuild; the acceptance tests run without a prior build to catch that.
- `crypto.subtle.digest` is async, so `bundleDigest` returns an Effect. If a caller needs it synchronously, that caller is wrong about where it runs, not the function.
- 2026-10-26: `EntryBundle.kind` reserved `"app"` for 3.5a's entry kind, the bundle listed `APP.md`, and bundle paths kept `_dot_` escaped names. The amended D18 withdrew 3.5a (an app is a fragment), so `kind` is `stack | fragment`, and dotfiles are literal in the entry directory, so bundle paths are too. A bundle path starting with `.` is ordinary; `BundlePath`'s traversal rules are unchanged.
- Leaving `compose`, `composeFiles` and `fingerprint` in the CLI means the API can never compose a stack or compute a fingerprint itself. Nothing in phase 4 needs it to; if that changes, they move then, with the same "second consumer" rule.
