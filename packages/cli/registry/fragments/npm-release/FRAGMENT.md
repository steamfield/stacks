---
schema_version: 1
id: npm-release
kind: fragment
needs_own_repo: true
category: release
name: npm release by tag for TypeScript libraries
description: Publish a TypeScript npm library from a pushed v* tag through npm trusted publishing, with provenance and no stored token, a release script that bumps every version in one commit, a rerunnable publish helper with readable failures and tests that run the workflow's own publish step.
tags: [npm, release, github]
applies_to: [typescript-library]
tools: [bun, node, git]
decisions:
  - "Authentication: npm trusted publishing over OIDC (default). No NPM_TOKEN secret and no NODE_AUTH_TOKEN, ever: npm is retiring bypass-2FA tokens."
  - "Repository: public on GitHub (default), because provenance needs it. A private repository publishes without provenance: drop `--provenance` from scripts/publish.ts, and list it under Pending user actions."
  - "Package access: public (default). Remove `\"private\": true` from package.json with this fragment, since adding it is the decision to publish; keep the version below 1."
  - "Default branch: main (default). scripts/release.ts refuses to run from another branch."
  - "Several packages per release: one (default). A package with per-platform packages publishes them first in scripts/publish.ts and packs each into the same directory; that fan-out is an extension, not part of this fragment."
verify:
  - { name: release-publish, layer: test, run: bun run test tests/release }
  - name: release-workflow
    layer: check
    tags: [hygiene]
    run: "f=.github/workflows/release.yml; test -f $f && grep -Eq 'tags: \\[\"v\\*\"\\]' $f && grep -q 'id-token: write' $f && ! grep -Eq 'NPM_TOKEN|NODE_AUTH_TOKEN|stacks:fill' $f && grep -q '\"repository\"' package.json || { echo \"$f needs a v* tag trigger, id-token: write, no npm token and no stacks:fill, and package.json needs a repository field\" >&2; exit 1; }"
commands:
  release: "Bump the version everywhere for a release (bun run release X.Y.Z); never commits, tags or pushes"
---

# npm release by tag

A pushed `v<version>` tag runs the project's gate while a second job packs the library and uploads the tarball, then a third job publishes exactly that tarball to npm with provenance. stacks wrote `scripts/publish.ts` (pack, then publish with a registry check first, so a rerun skips what is already published), `scripts/release.ts` (`bun run release X.Y.Z`), `CHANGELOG.md` and `tests/release/`. The tests run the workflow's own `Publish to npm` and `Verify release version` steps against a fake `npm`, so read them before writing the workflow, and keep those two step names.

## What to add

- **`package.json`**: add `"release": "bun scripts/release.ts"` to `scripts`; add `repository` (`{ "type": "git", "url": "git+https://github.com/<owner>/<repo>.git" }`, from `git remote get-url origin`; provenance fails without it) and remove `"private": true`. Keep `version` below 1 unless the person says otherwise.
- **`.github/workflows/release.yml`**, from the skeleton below. Look up each action's latest release first and pin it by full commit SHA with the tag in a comment (`git ls-remote --tags https://github.com/<owner>/<repo>`, annotated tags: the `^{}` line). Never invent a SHA; list one you can't resolve under Pending user actions.
- **`scripts/release.ts`**: add a `rewrite(...)` call for every other place the version is written (an install command in the README, a version a test pins), so a bump can't miss one.

Each job starts with `checkout` (`persist-credentials: false`), `oven-sh/setup-bun` (`bun-version-file: package.json`) and `actions/setup-node` (`node-version-file: .node-version`), each pinned.

```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: read
jobs:
  verify:                      # timeout-minutes: 20
    steps:
      # checkout with fetch-depth: 0, then setup-bun, setup-node
      - name: Verify release version   # env TAG: ${{ github.ref_name }}; run: >- node -e '...'
      - name: Verify the tag is on main   # run: git merge-base --is-ancestor "$GITHUB_SHA" origin/main
      - run: bun install --frozen-lockfile
      - run: bun run check
  build:                       # timeout-minutes: 15; runs in parallel with verify
    steps:
      # checkout, setup-bun, setup-node
      - run: bun install --frozen-lockfile
      - run: bun scripts/publish.ts pack dist/release
      - uses: actions/upload-artifact@<sha> # v<tag>   # name: release-package, path: dist/release/
  publish:
    needs: [verify, build]     # timeout-minutes: 30
    concurrency:
      group: npm-publish
      cancel-in-progress: false
    permissions:
      contents: read
      id-token: write          # only this job
    steps:
      # checkout, setup-bun, setup-node with registry-url: https://registry.npmjs.org
      - uses: actions/download-artifact@<sha> # v<tag>   # name: release-package, path: dist/release
      - name: Publish to npm
        run: |
          bun scripts/publish.ts publish dist/release
```

- `Verify release version` is one `node -e` that compares `process.env.TAG` with `v` plus `package.json`'s version. On a mismatch it prints `::error title=Tag does not match package.json::` naming the fix (run `bun run release X.Y.Z`, commit, then tag that commit) and the delete command `git push origin :refs/tags/<tag>`, and exits 1. `Verify the tag is on main` prints `::error title=Tag is not on main::` naming the same delete command. The tests pin these strings.
- Rerunning a failed `publish` reruns only that job against the uploaded artifact, so the bytes that were built go to npm, and only that job can mint the OIDC token.
- Give `publish` a step that fails with an annotation when `npm --version` is older than the minimum npm's trusted-publishing documentation names (read it, don't recall it). Node's bundled npm is usually current for the LTS in `.node-version`.

## Tool configuration

`scripts/publish.ts` asks the registry first: not found means publish with `--provenance --access public`, the same integrity means skip, different bytes means fail and say never republish a version. The registry takes minutes to serve a new version, so it then waits and polls until the registry shows the same integrity (settings in `RELEASE_CONFIRM_*` env, so tests set them to zero), and treats an E409 on publish as already published. A version npm accepted but the registry still hasn't shown when the wait ends is a warning annotation, not a failure, since nothing depends on it. Every npm call has a timeout; `npm view` retries registry 429, 5xx, timeouts and network drops with jittered backoff, never auth errors, a 404 or `npm publish`. Any failure prints the npm command, npm's own error lines and a hint for the code (EOTP, ENEEDAUTH, E401, E403, E404, E422), then one `::error::` annotation, with no stack trace. Don't replace it with inline shell.

<!-- stacks:when with=ci-github -->
Use the CI fragment's pinning, timeouts and install steps in `release.yml`, and keep the release workflow separate from `ci.yml`.
<!-- stacks:end -->
<!-- stacks:when preset=sandbox -->
Under `--sandbox`, write the workflow but don't push a tag or publish.
<!-- stacks:end -->

## Verify

`release-publish` runs `tests/release/`: the publish helper's outcomes (fresh, already published, different bytes, registry error, failed publish, unconfirmed), the readable failure text, the workflow's shape and the release script's refusals, all without network. `release-workflow` is hygiene: the tag trigger, `id-token: write`, no npm token, a `repository` field.

## AGENTS.md

Add a **Releasing** section: numbered steps (changelog section; `bun run release X.Y.Z`; `bun run check`; commit `chore(release): X.Y.Z`; push `main`; then, after that commit, `git tag vX.Y.Z` and push the tag; `gh run watch <id> --exit-status`; `npm view <name> version dist.integrity`). Recovery: rerun the failed job; never move or reuse a published version, bump the patch; an agent never deletes a remote tag, it hands the maintainer the command. Tag only after the bump commit, or the version check fails and leaves a stale tag.

Under Pending user actions, in order. These need the person's npm account, so never run them:

1. `npm whoami` and, for a scoped name, `npm org ls <scope>`: the scope must belong to them.
2. First release by hand: let CI run once (it fails at publish after uploading the tarball), `gh run download <id> -n release-package`, then `npm publish <file>.tgz --access public` with their one-time password. Publishing the CI-built tarball keeps the registry's integrity equal to what the script expects. That release has no provenance.
3. On npmjs.com, the package's Settings, Trusted Publisher, GitHub Actions: owner, repository, workflow `release.yml`, environment blank, "Allow npm publish" ticked (without it npm answers the OIDC publish with a misleading 404).
4. Publishing access: "Require two-factor authentication and disallow bypass 2fa tokens".
