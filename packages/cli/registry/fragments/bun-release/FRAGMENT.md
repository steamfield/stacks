---
schema_version: 1
id: bun-release
kind: fragment
category: release
name: Bun binary releases
description: Release a Bun-compiled CLI as standalone binaries for macOS and Linux on x64 and arm64, with SHA256SUMS, a checksum-verifying install.sh and its tests, an atomic self-update command and a tag-triggered GitHub release workflow.
tags: [bun, release]
applies_to: [typescript-cli]
tools: [bun]
decisions:
  - "Release targets: darwin arm64 and x64, Linux x64 and arm64 with glibc (default). Windows is deferred."
  - "musl Linux (Alpine): off (default), or add the `-musl` targets; install.sh already picks a `-musl` asset on musl and fails clearly when the release has none."
  - "Releases repository: package scope/project slug on GitHub (default). Record confirmation under Pending user actions."
verify:
  - { name: release-install, layer: test, run: bun run test:unit tests/install.test.ts }
  - { name: release-update, layer: test, run: bun run test:unit tests/update.test.ts }
  - { name: release-build-all, layer: build, run: bun run build:all, tags: [prod] }
commands:
  test:unit: Run Vitest on Node
  build:all: Compile each release target and write SHA256SUMS
---

# Bun binary releases

Distribution for the compiled CLI: per-target binaries with SHA256SUMS, a shell installer, an `update` command that replaces the installed binary atomically, and a release workflow driven by `v*` tags. stacks wrote `install.sh`, its tests in `tests/install.test.ts`, and `tests/helpers/releases.ts`, whose `startStubReleases` serves GitHub's release download URLs from 127.0.0.1 (`/latest` redirecting to `/tag/<tag>`, `/latest/download/<name>`, `/download/<tag>/<name>`). Read them before writing the rest; the update command and its tests use the same stub.

## What to add

- **Version.** Add a semver `version` field to `package.json`, starting below 1 unless the user says otherwise. `src/bin.ts` already reports `metadata.version` and falls back to `dev` without it. The build embeds it, and the release workflow fails when the pushed tag isn't `v<version>`.
- **`scripts/build.ts --all`** and a `build:all` package script (`bun scripts/build.ts --all`). The host build stays as it is. `--all` compiles each target from the decision to `dist/<slug>-<os>-<arch>` (`-musl` suffix for musl targets) with the same flags as the host build (dotenv and bunfig autoload off, minified, no linked sourcemap), then writes `dist/SHA256SUMS` in `sha256sum` format. Bun downloads a runtime for each non-host target, so this needs the network.
- **Release settings.** `<PREFIX>_RELEASES_REPO`, `<PREFIX>_RELEASES_URL` and `<PREFIX>_INSTALL_DIR` (the names `install.sh` documents) go in `src/config.ts`, `.env.example` and README. Read them separately from application config, so a broken config file can't block `update`. If the package scope is empty, the default repository has no owner and `install.sh` refuses to run: ask the user for the GitHub owner, make `owner/<slug>` the default in `install.sh` and config, and list it under Pending user actions.
- **`update` command**: `src/commands/update.ts` (thin handler, with `--check`), `src/core/update.ts` (the program) and `src/services/releases.ts` (a `Releases` service over HTTP). Find the latest tag from the `Location` header of `<base>/latest` without following the redirect, compare it with the running version, then download `<base>/download/<tag>/<asset>` and `SHA256SUMS`. Refuse when running from source (not compiled). Write to a temporary file in the binary's own directory, verify the checksum, chmod 0755 and rename over the binary. Checksum and network failures keep the old binary and remove the temporary file. A read-only install directory is a permissions error (exit 6) with a hint to rerun `install.sh` or fix the directory. Add a tagged error and an error-table row for each new failure.
- **`tests/update.test.ts`**: drive `update` through the real CLI (`tests/helpers/cli.ts`) against `startStubReleases`: `--check` reports newer and current, a good update replaces the binary, a checksum mismatch and a missing asset leave it unchanged, source mode refuses, a read-only directory exits 6, and a broken config file doesn't block `update`. Tests never reach the network: keep `<PREFIX>_RELEASES_URL` on the stub or on an unreachable local address.
- **`.github/workflows/release.yml`** on `push` of `v*` tags: check the tag equals `v` plus `package.json`'s version, run `bun run check`, run `bun run build:all`, then run each binary on a runner of its OS and CPU (`--version` prints the tag's version, `doctor --json` succeeds, its checksum matches SHA256SUMS). Only the publish job, after every smoke job passes, gets `contents: write`; it creates the release with generated notes and uploads the binaries, SHA256SUMS and `install.sh`. Look up current action versions when writing the file.

When native packages are present, install the optional packages for every release target and make the build include only the target's native library, failing clearly when it's absent.
<!-- stacks:when with=openrouter-chat-cli -->
Apply this to the OpenTUI packages and extend the smoke matrix with `doctor --tui --json`.
<!-- stacks:end -->
<!-- stacks:when with=ci-github -->
Use the CI fragment's action pinning and job timeouts in `release.yml`, and keep `build:all` out of the CI workflow's required checks (it downloads runtimes).
<!-- stacks:end -->

## Tool configuration

Keep asset names identical across `build.ts`, `install.sh`, `update` and the workflow: `<slug>-<os>-<arch>[-musl]` plus `SHA256SUMS`. `install.sh` must stay POSIX-tool only (bash, curl, awk, `sha256sum` or `shasum`); don't add jq. When changing it, run `shellcheck install.sh` if it's installed.

## Verify

`release-install` runs `install.sh` against the stub: latest and pinned installs into a directory whose name has spaces and `$`, a checksum mismatch that keeps the old binary, missing assets, an unsupported OS and a repository with no owner. `release-update` runs `tests/update.test.ts`, which you write. Both run without network. `release-build-all` is tagged `prod`, because it downloads a Bun runtime per target; it's skipped under `--sandbox`.

<!-- stacks:when preset=sandbox -->
Under `--sandbox`, write the release workflow but don't push a tag or create the repository's release.
<!-- stacks:end -->

## AGENTS.md

Add a **Releasing** section: cut a release by bumping `package.json`'s version and pushing `v<version>`; `bun run build:all` builds every target locally; `install.sh` and `update` share the asset names and checksum rule, and their tests run against `tests/helpers/releases.ts`, never the network. Document recovery: rerun `install.sh` (optionally with `<PREFIX>_VERSION`) when an update fails. Under Pending user actions, list confirming the releases repository.
