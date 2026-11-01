---
schema_version: 1
id: goreleaser
kind: fragment
category: release
name: GoReleaser
description: Tag-driven releases for a Go binary with GoReleaser, shipping a checked .goreleaser.yaml for cross-platform builds with version ldflags, archives, checksums and a conventional-commit changelog, plus a GitHub release workflow and optional Homebrew publishing.
tags: [go, release, goreleaser]
applies_to: [go-cli]
tools: []
decisions:
  - "Targets: linux, darwin, windows on amd64 and arm64 (default; edit `goos` and `goarch` in `.goreleaser.yaml`)."
  - "Homebrew: off (default), or publish a cask to a tap repository the user owns (needs the tap repo and a token secret)."
  - "Build provenance: off (default), or attest `dist/checksums.txt` with GitHub artifact attestations (public repositories, or private ones on GitHub Enterprise Cloud)."
  - "Release trigger: pushing a v* tag (default)."
verify:
  - name: release-check
    layer: check
    run: "grep -n 'stacks:fill' .goreleaser.yaml docs/releasing.md; [ $? -eq 1 ] && make release-check"
  - { name: release-build, layer: build, run: make release-build }
  - { name: release-snapshot, layer: build, run: make release-snapshot, tags: [prod] }
commands:
  release-check: Validate .goreleaser.yaml
  release-build: Build this platform's release binary with GoReleaser and check its version
  release-snapshot: Build every release target into dist/ without publishing
---

# GoReleaser

Pushing `vX.Y.Z` builds every target, attaches archives and `checksums.txt` to a GitHub release and writes the changelog from commit messages. stacks wrote `.goreleaser.yaml` (GoReleaser v2 config: builds with the same ldflags as the Makefile, tar.gz archives with zip on Windows named `<slug>_<os>_<arch>`, checksums, a snapshot version template, a changelog that drops `docs:`, `test:`, `chore:` and `ci:` commits, and a `release.github` block) and `docs/releasing.md`. Read both before changing them.

## What to add

1. **Owner.** Replace the `stacks:fill` line in `.goreleaser.yaml`'s `release.github` with the owner from the module path decision (`github.com/<owner>/<slug>`). With a bare module path, use the owner the user names, or the slug as a placeholder listed under Pending user actions. The block has to stay: without it, or a git remote, `goreleaser check` fails with "no remote configured to list refs from", which says nothing about config.
2. **Makefile targets**, added to `.PHONY`. GoReleaser needn't be installed; the fallback runs it through `go run`, like the stack's `vuln` target:

   ```make
   GORELEASER := $(shell command -v goreleaser 2>/dev/null || echo go run github.com/goreleaser/goreleaser/v2@latest)

   release-check: ## Validate .goreleaser.yaml
   	$(GORELEASER) check

   release-build: ## Build this platform's release binary with GoReleaser and check its version
   	$(GORELEASER) build --snapshot --clean --single-target --output dist/$(BIN)
   	@out="$$(./dist/$(BIN) --version --json)" && echo "$$out" && ! echo "$$out" | grep -q '"version": *"dev"'

   release-snapshot: ## Build every release target into dist/ without publishing
   	$(GORELEASER) release --snapshot --clean
   ```

   `release-build` fails when the ldflags don't reach `main.version`, so keep `version`, `commit` and `date` in `main.go`, the Makefile's `LDFLAGS` and `.goreleaser.yaml` in step. `--output` must stay directly under `dist/`, because `--clean` removes the directory before the build.
3. **Release workflow** `.github/workflows/release.yml`: trigger on `push` of tags matching `v*`; `permissions: { contents: write }`; check out with `fetch-depth: 0` so the changelog sees earlier tags; set up Go from `go.mod`; run `goreleaser/goreleaser-action` with `version: "~> v2"` and `args: release --clean`; pass `GITHUB_TOKEN`, plus `HOMEBREW_TAP_TOKEN` from secrets when Homebrew is on. Look up current action versions when writing the file.
4. **Homebrew (if on).** Add a `homebrew_casks` entry (`brews` is deprecated): `binaries: [<bin>]`, the tap in `repository` (`owner`, `name`, `token: "{{ .Env.HOMEBREW_TAP_TOKEN }}"`). Unsigned macOS binaries are quarantined: remove the attribute with the cask's declarative `hooks.post.install_steps` (an `on_macos` block that runs `/usr/bin/xattr -dr com.apple.quarantine` on the staged binary), as GoReleaser's cask docs show, or document the manual step. The older `hooks.post.install` Ruby hook is deprecated.
5. **Provenance (if on).** Give the release job `id-token: write` and `attestations: write`, and after GoReleaser attest `dist/checksums.txt` with GitHub's `actions/attest`.
6. **`docs/releasing.md`**: replace the `stacks:fill` line in its secrets section with the secrets your choices added, or remove it.

## Tool configuration

`goreleaser check` also reports deprecated keys; fix them rather than ignoring the warning. Keep `version: 2` at the top of the file, `formats` and `ids` (not `format` and `builds`) in archives, and `version_template` in snapshot. GoReleaser's own `{{ .Field }}` templates in the file are literal: stacks only renders bare names like the project slug.

## Verify

`release-check` fails while `.goreleaser.yaml` or `docs/releasing.md` still holds a `stacks:fill` line, and when the config is invalid. `release-build` builds this platform's binary through GoReleaser and runs `--version --json`. Both work without a remote or a commit. `release-snapshot` builds all six targets and is tagged `prod`; under `--sandbox` it's skipped. Under `--sandbox`, also skip the release workflow, Homebrew and provenance, and list the release workflow under Pending user actions (`docs/releasing.md` points there).

## AGENTS.md

Add a **Releasing** section: releases are cut by pushing a `v*` tag, never by hand-uploading; run `make release-check` after touching `.goreleaser.yaml` and `make release-build` after touching ldflags or `main.go`'s version variables; `make release-snapshot` builds every archive locally. Under Pending user actions, add the release owner if it's a placeholder, and the Homebrew tap repo and `HOMEBREW_TAP_TOKEN` secret if Homebrew is on.
