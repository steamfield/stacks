# Phase 0.2: Distribution

Status: EXECUTED 2026-10-27. The Node ESM bundle shipped as `@steamfield/stacks` 0.1.0, installed
as the `stacks` command (D34). A1 (a), D12, D22 and D23 are approved. Publishing was 1.6c.

| Field | Value |
|---|---|
| Goal | `npx @steamfield/stacks <command>` runs the real CLI under Node on macOS or Linux, from one tarball packed with `bun pm pack` that the local e2e suite installs and tests byte for byte |
| Traces to | Open question "Is the npm name available? ... `npx @steamfield/stacks new ...`, the README's first line, only works if `stacks` is free on npm"; D9's entry point "ask your agent to run stacks", which only works if the agent can `npx` it |
| Depends on | [0.0](../../phases/phase-0.0-decisions-and-npm-name.md) (A1, D12, D22, D23, the name reserved), [0.1](phase-0.1-repo-baseline-2026-10-30.md) |
| Blocks | [1.0](phase-1.0-entry-format-and-registry-2026-10-30.md) soft (the registry path; a stub path works until then), [1.1](phase-1.1-composition-and-brief-2026-10-30.md) soft (the `_npx` rule for `Host.invocation`; 1.1 stubs the constant `stacks` until then), [1.6b](phase-1.6b-mvp-gate-runs-2026-10-30.md) soft (gate runs use the packed tarball if this has landed, else the compiled binary), [1.6c](phase-1.6c-first-release-2026-10-30.md) (publishes the tarball this file's pack script makes), [5.0](../../phases/phase-5.0-ci-release-and-checks.md) (its release workflow and `e2e-node22` job reuse the pack script and e2e) |
| Decisions needed | A1 (recommendation (a), a Node ESM bundle on npm; if (b) or (c), this file is rewritten before work starts). D12 (Node `>=22`; a different floor changes the floor constant, `engines` and the `@types/node` pin, nothing else). D22 (macOS and Linux on Node only; if Bun must be supported, the refusal goes and this file needs a way to stop Bun loading `.env` before `config.ts` captures the environment, which Bun doesn't offer for a script run by `bun`). D23 (if CI stays in scope, the release workflow and the Node 22 job come back here from 5.0). Open question 19 (is refusing Bun acceptable). The maintainers record A1, D12 and D22 in the README decisions log before this file's work starts; that is their step, not part of this file's exit criteria |
| Settles | What the package ships and how it is packed; how the CLI finds its bundled registry; the Node floor and Bun refusal checks; `Host.invocation`; what replaces the compiled binary in e2e |

## Scope

In:

- A Node ESM bundle of the CLI with every dependency bundled, plus a tiny entry that
  checks the runtime before the bundle loads.
- `packages/cli/package.json` made publishable: `bin`, `files`, `engines`, `os`, no
  `private`, no runtime `dependencies`.
- A pack script built on `bun pm pack`, writing the tarball and its sha256.
- The bundled registry directory shipped in the package, located in `bin.ts`, and handed
  to core code through `Host`. `Host.invocation` for the brief.
- Local e2e against the packed tarball, installed offline into a throwaway prefix and run
  under Node.

Out:

- The tag-driven release workflow with npm provenance, and an `e2e-node22` CI job:
  [5.0](../../phases/phase-5.0-ci-release-and-checks.md). This file changes nothing under
  `.github/workflows/` (D23).
- Publishing. The manual `npm publish` of the packed tarball is
  [1.6c](phase-1.6c-first-release-2026-10-30.md).
- Per-platform binaries, Homebrew, a curl installer, self-update, Windows (D22).

## Design

### The artifact

Two files in `packages/cli/dist/`:

| File | What it is |
|---|---|
| `cli.mjs` | `bun build src/bin.ts` with `target: "node"`, `format: "esm"`, minified, every dependency bundled, no sourcemap. Bundling Effect means `npx` downloads one small tarball and resolves no dependency tree, which matters most on a first run inside an agent's sandbox |
| `stacks` | The package's `bin`. A few lines copied verbatim by the build from `scripts/node-entry.mjs`, with a `#!/usr/bin/env node` first line |

The entry exists because in a single ESM bundle, Effect's module bodies evaluate before
any code in `bin.ts` runs, so a floor check inside `bin.ts` can be pre-empted by a syntax
or API error on an old Node. The entry imports nothing at the top level and does three
things in order:

1. If `process.versions.bun` is set, write `stacks runs on Node. Bun is not
   supported; run it with npx or node.` to stderr and exit 1 (D22).
2. If the major of `process.versions.node` is below 22 (D12), write `stacks needs
   Node 22 or newer.` to stderr and exit 1.
3. `import("./cli.mjs")`.

It is written in syntax old Node parses (no optional chaining, no top-level `await`), so
the check gets to run and print its line on any Node that can load an `.mjs` file.

Decided here: the Bun refusal lives in the entry. D22 refuses Bun "outside development", and `bun run dev` runs `src/bin.ts` directly, so the
entry is outside development by construction and `bin.ts` needs no development flag.
Under Bun, a project `.env` has already been loaded into `process.env` when the entry
runs, but nothing reads it before the exit.

Decided here: the entry's source is `scripts/node-entry.mjs`, outside `src/`. It must not
import Effect or anything else, and the `src/` boundary rules (Grit plugin and
`guard-boundaries`) exist for application code; giving `src/` a file allowed to write
`process.stderr` and call `process.exit` would need a new exception.

The package:

```json
{
  "name": "stacks",
  "type": "module",
  "bin": { "stacks": "dist/stacks" },
  "files": ["dist/stacks", "dist/cli.mjs", "registry"],
  "engines": { "node": ">=22" },
  "os": ["darwin", "linux"]
}
```

`private` is removed. `dependencies` move to `devDependencies`, since nothing is
resolved at install time; `@effect/platform-bun` is removed once `bin.ts` no longer uses
it. `version` stays the single source for `version.ts::VERSION`.

`@types/node` is pinned to the floor, 22, so typecheck catches a Node 24-only API in
code that must run on 22. Shared versions live once in the root `workspaces.catalog`, so
the catalog entry changes from `24` to `22`. If the root harness turns out to need Node 24
types, use a named Bun catalog for the CLI package instead; don't put a version in
`packages/cli/package.json`.

### One entry, Node services

Today `bin.ts` provides `BunServices.layer` and reads `Bun.isStandaloneExecutable`. The
shipped program runs under Node, so `bin.ts` switches to `NodeServices.layer` from
`@effect/platform-node` (which also provides `ChildProcessSpawner` for 0.3b). Core code
doesn't change: it already uses Effect `FileSystem` and `Path`.

| Option | Effect on the boundary rules | Choice |
|---|---|---|
| Keep `bin.ts` on Bun for development, add a second Node entry under `src/platform/` | The Grit rule allows `process.stdout` only in `bin.ts`, so the Node entry would need a new exception, and two entries drift | No |
| One `bin.ts` on Node services, used by both `bun run dev` and the bundle | No new exception. Bun runs Node's platform package for development | Yes |

### Host: registry path and invocation

`services/host.ts::HostInfo` loses `compiled` and gains two fields, both computed in
`bin.ts`:

- `registry`: the absolute path of the bundled registry, from
  `fileURLToPath(new URL("../registry/", import.meta.url))`. The one expression works for
  `src/bin.ts` under `bun run dev` and for `dist/cli.mjs` in the package, because both are
  one directory below `packages/cli/` (see roadmap, Other shared facts: Bundled registry
  in the repo). Core code never computes package-relative paths; it asks `Host`.
- `invocation`: see roadmap, Contracts: Invocation string. `bin.ts` tests its own script
  path (`fileURLToPath(import.meta.url)`) for an `_npx` path segment, which only npm's npx
  cache has; a global or project install, and the tarball installed for the gate, get
  `stacks`.

`Host.memory` takes the registry path (and optionally `invocation`) so tests point it at a
temporary directory; `tests/helpers/cli.ts` passes one in. `packages/cli/registry/`
starts with only a `README.md` saying what goes there, so the tarball assertion has
something to find before 1.0 and 1.6a fill it.

`doctor` reports `registry: { path, found }` in place of `compiled` (human mode:
`Registry: <path>` or `Registry: missing (<path>)`), so a package with a lost registry is
visible without running a command that needs it.

### Runtime support

Supported: macOS and Linux, on Node 22 or newer (D12, D22). Process groups, `kill(-pid)`
and `/bin/sh` are POSIX, and 0.3b relies on them; `"os"` makes npm refuse to install on
Windows rather than fail later.

`bunx stacks` is supported only in the sense that `bunx` honors the shebang when
`node` is on PATH, so the CLI runs under Node; an e2e case proves it. Running under the
Bun runtime (`bunx --bun`, or Bun with no Node installed) hits the entry's refusal. The
reason is D22's: under Bun, `.env` files load into the environment before `config.ts`
captures it, so a project could change the CLI's behavior.

### What happens to the compiled binary

It leaves the gate. Keeping it would mean two artifacts with two e2e suites, and only one
ships. `scripts/build.ts` builds the two `.mjs` files instead of `Bun.build({ compile })`.
The hostile `.env` and `bunfig.toml` tests stay, rewritten against the installed package,
to prove a project's dotenv or Bun config can't reach the CLI's environment under `node`
or `bunx`. If a later phase wants binaries again, it brings back a `build:binary` script
with its own tests.

### Packing

`bun run pack` in `packages/cli`: `bun run build`, then
`bun pm pack --destination dist/pack --quiet`, then write
`dist/pack/stacks-<version>.tgz.sha256`. It uses `bun pm pack`, never `npm pack`,
because `package.json` uses `catalog:` specs and `npm pack` would ship them unresolved.
`scripts/clean.ts` already removes `dist/`.

What [1.6c](phase-1.6c-first-release-2026-10-30.md) publishes: the `dist/pack/stacks-<version>.tgz`
that 1.6b's gate runs installed, identified by that sha256, with
`npm publish <tgz> --access public` run by a maintainer. Never `npm publish` from the
package directory, which would repack. Provenance needs the 5.0 workflow (open question
20).

### e2e against the tarball

`bun run e2e` in `packages/cli` becomes `bun run pack && bun test ./e2e`. The suite's
setup (one helper in `e2e/`, run once before the tests):

1. Find Node. Read `STACKS_E2E_NODE` (an absolute path to a `node` binary). When it
   is unset, resolve `node` from the e2e process's own `PATH` (`Bun.which`) before
   building any scrubbed environment. If neither gives a Node of the floor or newer, fail
   with a line naming the variable; never skip.
2. Install. With that Node's `npm` (next to it, else resolved the same way), run
   `npm install --global --prefix <tmp>/prefix <tgz> --offline --no-audit --no-fund`
   with `HOME` and `npm_config_cache` inside `<tmp>`. With no runtime dependencies this
   needs no network.
3. Build the scratch `PATH`: that Node's directory first, then `<tmp>/prefix/bin`, then
   `/usr/bin:/bin`. Without step 1, `#!/usr/bin/env node` fails wherever Node isn't in
   `/usr/bin` (setup-node's toolcache on CI, Homebrew on macOS).

Tests spawn `<tmp>/prefix/bin/stacks`, the symlink npm created, so the shebang and
the entry run exactly as they do under `npx`, with an environment built from scratch. The
tarball's file list is asserted, so a missing `registry/` or a stray source file fails
the gate. A later sub-phase that ships another directory adds it to `files` and to this
assertion in the same change.

On CI this runs inside the existing `check` job with no workflow change: setup-node puts
the `.node-version` Node on `PATH`, and step 1 finds it. Testing on Node 22 is a
documented manual step until 5.0 adds the `e2e-node22` job:
`STACKS_E2E_NODE=/path/to/node22/bin/node bun run e2e`, written in
`packages/cli/README.md` and run before 1.6b.

### Failure modes

| Situation | What happens | Exit |
|---|---|---|
| Node below the floor | One fixed stderr line from the entry; Effect never loads | 1 |
| Run under the Bun runtime | One fixed stderr line from the entry | 1 |
| Registry directory missing from the package | `doctor` reports `found: false`; commands that need it fail `NotFound` (1.0) | 2 |
| `bunx stacks` with Node on PATH | Runs under Node, same output as `node` | as usual |
| Installed on Windows | npm refuses the install (`os`) | n/a |
| e2e can't find Node | Setup fails naming `STACKS_E2E_NODE` | test failure |

## Files and areas touched

`packages/cli/package.json`, root `package.json` (catalog `@types/node`), `bun.lock`,
`packages/cli/scripts/build.ts`, new `packages/cli/scripts/node-entry.mjs`, new
`packages/cli/scripts/pack.ts`, `packages/cli/src/bin.ts`,
`packages/cli/src/services/host.ts`, `packages/cli/src/core/doctor.ts`,
`packages/cli/src/commands/doctor.ts`, `packages/cli/src/schemas/doctor.ts`,
`packages/cli/e2e/` (the binary test becomes a package test, plus the install helper),
`packages/cli/tests/helpers/cli.ts` and `tests/cli.test.ts` (Host fixture, doctor shape),
new `packages/cli/registry/README.md`, `packages/cli/README.md` (install, pack, the
manual Node 22 e2e run), `AGENTS.md` (Overview "Bun compiles the executable", commands
table, Testing's binary-test paragraph, Build workarounds' compile line, Deferred's A1).
Not `.github/workflows/`.

## Acceptance tests

- e2e: the installed `stacks --version` prints the package version; `doctor --json`
  reports a `registry.path` inside the install prefix with `found: true`.
- e2e: with a hostile `.env` (`STACKS_DATA_DIR=/should-not-load`, `LOG_LEVEL=trace`)
  and `bunfig.toml` with a throwing preload in the cwd, output equals a clean cwd's, under
  the installed bin and under `bunx stacks` run from a scratch project that has the
  tarball installed, with Node on the scratch PATH.
- e2e: `bun <prefix>/lib/node_modules/stacks/dist/stacks --version` exits 1
  with the Bun line and empty stdout.
- e2e: the floor check, by running the installed entry under the found Node with a
  `--import` preload that redefines `process.versions` with `node: "20.0.0"`: exit 1, the
  fixed line, empty stdout.
- e2e: the tarball contains exactly `package.json`, `README.md`, `dist/stacks`,
  `dist/cli.mjs` and `registry/**`, and its `package.json` has no `catalog:` or
  `workspace:` spec.
- e2e: the `.sha256` file matches the tarball.
- Unit: `Host.invocation` is `npx -y @steamfield/stacks@<VERSION>` for a script path with an `_npx`
  segment and `stacks` for any other, including a global install under `node_modules` (the path test is a pure function in
  `bin.ts`'s module or a small helper it calls).
- Unit: the existing suites pass with `Host.memory` taking a registry path.
- Signals through `npm exec` of the packed tarball (the case [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md)
  lists): one SIGINT to the group runs finalizers and exits 130. Added here if 0.3b
  landed first, otherwise by 0.3b.

## Exit criteria

- `bun run check` green from the repo root, with e2e running against the installed
  tarball, locally and in the existing CI `check` job on Linux and macOS.
- The e2e suite passed once with `STACKS_E2E_NODE` pointing at a Node 22 binary,
  recorded in this file with the date and Node version.
- `bun pm pack --dry-run` in `packages/cli` lists only the expected files.
- `AGENTS.md` updated as listed above.

## What this plan may get wrong

- Recorded 2026-10-27, scoped-package follow-up: npm refused the unscoped name.
  The npm package is `@steamfield/stacks` with public access; the command, storage paths
  and environment variables stay `stacks`. Tarballs use `steamfield-stacks-<version>.tgz`,
  and npx briefs use `npx -y @steamfield/stacks@<version> verify`. The command/storage slug
  is independent of package metadata. The root and package licenses remain Apache-2.0,
  with the package license copied byte for byte from the root license on main.
  An offline npx run confirmed `_npx/<cache>/node_modules/@steamfield/stacks/` and the
  scoped verify line in the generated brief. The six frozen canonical brief digests
  changed only by the package spelling, verified by reversing that substitution.

- Verified 2026-10-27: the installed-package suite passed on Node 22.23.3 with
  `STACKS_E2E_NODE` set explicitly (33 tests). The root gate passed
  all five rr partitions on macOS and Linux. First-user QA installed the tarball with
  npm and ran root/help, list, show, preview, new, verify and usage failures in all
  three audiences. Verify correctly failed the unimplemented project's install step
  with exit 5 and a kept result. No output-contract change was needed. Warm `--version`
  startup on the same machine (20 samples after one warmup) had median 43.0 ms for the
  previous compiled executable and 68.3 ms for the installed Node entry.
- Recorded 2026-10-27: npm's `npx --yes /absolute/path/package.tgz` shortcut tries to
  execute the local tarball (exit 126) before loading package metadata. The explicit
  `file:/absolute/path/package.tgz` spec installs and runs through npx correctly;
  its generated brief contains `npx -y @steamfield/stacks@0.1.0 verify`. The package-name
  invocation after publication remains the goal; no npm behavior is patched here.
- Recorded 2026-10-27 after the independent review: the e2e scratch PATH pins the
  selected Node with a `node` symlink, including an override named `node22`. The bench
  resolves and validates Node under the original HOME before constructing its clean
  environment. The build uses Bun's input manifest to append every bundled package's
  complete license/notice files as a comment in cli.mjs; the exact shipped file list
  stays unchanged. All three findings have reproducing, revert-verified tests.
  A final regression also pins the escaped paths into the bundle at build time, so
  an author's literal `.gitignore.stacks` filename stays literal; source development
  has no escaped paths. The Homebrew Node override fixture retains its sibling library
  directory, which that interpreter needs when copied under a different filename.

- Recorded 2026-10-27: phases 1–3 already landed. Host already had registry, skill,
  authoring and invocation; only compiled was removed. The shipped assets include
  registry, skill and docs/authoring.md, plus LICENSE. The registry is a full catalog,
  not a stub. Existing relocation, ledger, skill and signal tests now use the installed
  package. NodeServices also works under `bun run dev`. The existing network adapter
  still imports BunSocket's re-export of the shared Node TCP constructor, so
  `@effect/platform-bun` remains a devDependency until that last import is migrated;
  changing `src/platform/net.ts` is outside this contract's named source files.
  The bench copies the two-file Node artifact and current registry, skill and
  authoring guide into its prefix and invokes it with the found Node through a shell
  launcher; independent verify still uses that installed copy. `human` also finds Node.
- Recorded 2026-10-27: Bun 1.4.2 omits literal `.gitignore` files, and npm drops them
  even if appended to the archive. The pack script appends their unchanged bytes under
  `.gitignore.stacks` before hashing; bin's filesystem adapter decodes those names
  only inside its bundled registry. `show`, composition and `create --from bundled`
  therefore expose the original names. No entry format or author files change. A raw
  `bun pm pack --dry-run` lists the unaugmented allowlist; the final tarball test checks
  the complete list with exactly these seven escapes, and every installed asset digest.
  Standard POSIX tar appends members without changing Bun's resolved manifest or modes.
- Recorded 2026-10-27: the root harness typechecks with the shared `@types/node` 22
  catalog, so a named CLI catalog is unnecessary. Node/npm on PATH can be version-manager
  wrappers: e2e asks Node for process.execPath and locates npm's JS entry in that install.
- Recorded 2026-10-27: LICENSE existed at the root as Apache 2.0; the follow-up
  preserves that license and copies the exact root text into the package. User-facing installation prose
  remains for the orchestrator; only retired executable paths were corrected here.

- Recorded 2026-10-27: `packages/cli/README.md` is now a short entry page, and user docs
  live in `packages/cli/docs/`. The install, pack and manual Node 22 e2e instructions this
  plan puts in the README belong in `docs/quickstart.md` (install) and
  `docs/maintaining.md` (pack and the Node 22 run) instead.

- `@effect/platform-node` under `bun run dev` is assumed to work for everything the CLI
  needs, including child processes (0.3b). Check this before switching; if it doesn't,
  development keeps a Bun platform layer in `src/platform/` and only the bundle uses
  Node's.
- `bunx` honoring the shebang when Node is on PATH is assumed from Bun's documented
  behavior; the e2e case is the proof. If it runs the bundle under Bun anyway, the entry
  refuses, and the README says to use `npx`.
- `Host.invocation` keys on npm's `_npx` cache directory name. If npm renames it, npx
  users get `stacks` in the brief, which fails when nothing is installed; a unit
  test pins the expected path shape, and 1.6c checks the brief from a real `npx` run.
- A fully bundled Effect may be larger than expected. Measure the tarball; anything over
  a couple of megabytes is worth a look at tree-shaking before 1.6c.
- `bun pm pack` and `npm pack` can disagree on which files a `files` list includes
  (dotfiles, README casing). The tarball assertion is against `bun pm pack`'s output,
  which is the one that ships.
- Packaging risk, recorded 2026-10-26: the amended D18 stores dotfiles in entries
  literally, and npm pack drops `.gitignore` files from a package (it may rename or omit
  others too). A bundled entry's `files/.gitignore` would vanish from the tarball and
  `new` would silently not write it. This sub-phase must add either a pack-time escape
  (rename on pack, undone when the installed CLI reads its own bundled registry, never
  visible to authors) or a check that fails the pack when the tarball's `registry/` file
  list differs from the tree. 1.6a's tarball file-list test is that check; the escape is
  needed only if the check fails.
- 2026-10-26: the registry stub in `bin.ts` used `import.meta.dirname`, which inside a Bun
  standalone binary is the virtual `/$bunfs`, so the compiled binary found no bundled
  registry at all. Ahead of 0.2, a compiled binary now looks for `registry/` beside its own
  `bin/` directory (`dist/stacks` finds the package's, `<prefix>/bin/stacks` finds
  `<prefix>/registry`), so 1.6b's gate runs can use an installed copy of the binary. 0.2
  still decides where the npm package's registry lives and replaces the stub.
