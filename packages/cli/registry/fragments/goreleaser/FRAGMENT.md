---
schema_version: 1
id: goreleaser
kind: fragment
category: release
name: GoReleaser
description: Tag-driven releases for a Go binary with GoReleaser, covering cross-platform builds with version ldflags, archives, checksums, a conventional-commit changelog, a GitHub release workflow, and optional Homebrew publishing.
tags: [go, release, goreleaser]
applies_to: [go-cli, go-tui, go-mcp]
requires_tools: [goreleaser]
tools: [goreleaser]
decisions:
  - "Targets: linux, darwin, windows on amd64 and arm64 (default)."
  - "Homebrew: off (default), or publish to a tap repository the user owns (needs a tap repo and a token secret)."
  - "Release trigger: pushing a v* tag (default)."
verify:
  - { name: release-check, layer: check, run: make release-check }
  - { name: release-snapshot, layer: build, run: make release-snapshot, tags: [prod] }
commands:
  release-check: Validate release configuration
  release-snapshot: Build a release snapshot
---

# GoReleaser

Add tag-driven releases. Pushing `vX.Y.Z` builds every target, attaches archives and checksums to a GitHub release, and writes the changelog from commit messages. Write `.goreleaser.yaml` for the installed GoReleaser; its config has a schema version and keys that change between majors, so check the current docs.

## What to add

**`.goreleaser.yaml`**:
- **Build**: `main` is the go-cli stack's package `.` (its `main.go` sits at the project root), `binary` is `<bin>`, `CGO_ENABLED=0`, goos linux/darwin/windows, goarch amd64/arm64 (per the decision). ldflags: `-s -w` plus `-X main.version`, `-X main.commit`, and `-X main.date` bound to GoReleaser's version, commit, and date template fields. These must match the variables the go-cli stack declares in `main.go` and the Makefile's `build` target, so `<bin> --version` reports the same thing whether GoReleaser or make built it.
- **Archives**: tar.gz, with zip for windows. Name them `<project>_<os>_<arch>` so install scripts can predict the URL. Include README, LICENSE, and shell completions if the project generates them (a `before` hook can run `go run . completion <shell>` into `completions/`).
- **Checksum**: a single `checksums.txt`.
- **Changelog**: sorted ascending, excluding `docs:`, `test:`, `chore:`, and `ci:` commits (the git-hooks fragment enforces conventional commits, which makes this useful).
- **Snapshot**: a version template for snapshot builds that marks them clearly as non-releases.
- **Homebrew (if on)**: use whichever Homebrew publisher the current GoReleaser recommends (it has moved from formulas toward casks), pointing at the user's tap repo, with the token read from a `HOMEBREW_TAP_TOKEN` env var. On macOS, unsigned binaries get quarantined; add the post-install hook GoReleaser documents for removing the quarantine attribute, or document the manual step.
<!-- stacks:when stack=go-tui -->

go-tui has the same layout: `main.go` at the root with `main.version`, `main.commit` and `main.date`, set by the Makefile's `build` target, and `dist/` already in `.gitignore`. It has no `completion` command, so leave out the completions hook.
<!-- stacks:end -->
<!-- stacks:when stack=go-mcp -->

go-mcp has the same layout: `main.go` at the root with `main.version`, `main.commit` and `main.date`, set by the Makefile's `build` target, and `dist/` already in `.gitignore`. Build only `.`, not the `cmd/mcpcall` dev client, and leave out the completions hook. In `docs/hosts.md`, point hosts at the installed binary.
<!-- stacks:end -->

**Release workflow** `.github/workflows/release.yml`:
- Trigger on `push` of tags matching `v*`.
- `permissions: { contents: write }` (needed to create the release), nothing else.
- Check out with full history (`fetch-depth: 0`) so the changelog can see previous tags. Set up Go from `go.mod`, then run GoReleaser's official action with `release --clean`, pinned to the GoReleaser major the config targets.
- Env: `GITHUB_TOKEN` from the workflow token, plus `HOMEBREW_TAP_TOKEN` from secrets if Homebrew is on.
- Pin every action by full commit SHA with a version comment, and look SHAs up when writing the file.

**Makefile targets**:
- `release-check`: `goreleaser check` (validates the config).
- `release-snapshot`: `goreleaser release --snapshot --clean` (full local build into `dist/`, publishes nothing).
- `dist/` is already in the go-cli `.gitignore`; add it if this is another stack.

**docs/releasing.md**: how to cut a release (make sure main is green, tag `vX.Y.Z`, push the tag), how to check the result, and which secrets exist.

## Verify

`release-check` runs everywhere. `release-snapshot` is tagged `prod` because it cross-compiles every target and takes a while. The whole fragment is dropped under `--sandbox`.

## AGENTS.md

Add a **Releasing** section: releases are cut by pushing a `v*` tag, never by hand-uploading; `make release-check` after touching `.goreleaser.yaml`; `make release-snapshot` to test a release locally; version info comes from ldflags. Under Pending user actions, add creating the Homebrew tap repo and the `HOMEBREW_TAP_TOKEN` secret if Homebrew is on.
