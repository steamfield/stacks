# @steamfield/stacks-format

The portable contracts stacks shares between its CLI and its hosted API: entry format v1, the
project manifest, run records, telemetry events, canonical bundles and their digests, the signed
registry index with its official names and directory, and the stats shapes. It has no platform
code; its one dependency is `effect`.

Inside this workspace the package resolves to `src/` directly. Everyone else installs the
published build from npm.

## Publishing

Maintainers with publish rights on the `@steamfield` npm organization publish by hand. Run
every command from the repository root unless it says otherwise.

`bun run release` does steps 3 to 6 for this package and then `@steamfield/stacks`, once the
version commit is on `main`. It refuses a dirty tree, a HEAD other than `origin/main`, or an
existing tag. It packs both packages in a temporary detached worktree of `origin/main`, publishes
this package first, waits up to 10 minutes for the registry to serve both versions, then tags
`v<cli version>` and pushes the tag. If you publish format alone first so the hosted API can use
it, `release` skips that exact version when the published tarball integrity matches its fresh pack;
a mismatch or lookup failure stops the release. `bun run release:dry-run` packs both and shows
which it would skip or publish, including the CLI's embedded telemetry endpoint, without logging
in, publishing or tagging. The steps below are what it runs.

1. Log in once per machine, and check the account:

   ```bash
   npm login
   npm whoami
   ```

2. Choose the version. Bump `version` in `packages/format/package.json` on its own commit:
   patch for a fix, minor for an addition (a new export, a new optional field), major for a
   change that rejects data the previous version accepted or removes an export. The first
   release publishes the version already in the file.

3. Run the gate on that commit (`rr check`, or `bun run check` without rr) and push it to `main`.
   Pack and publish from a checkout of exactly that commit
   (`git worktree add --detach <dir> origin/main`, then `bun install --frozen-lockfile` there),
   not from whatever the main checkout has: a checkout behind `main` packs the old name or
   version.

4. Pack, then look at what will ship:

   ```bash
   cd packages/format
   bun run pack
   tar -tzf dist/pack/steamfield-stacks-format-<version>.tgz
   tar -xOzf dist/pack/steamfield-stacks-format-<version>.tgz package/package.json
   ```

   The listing holds `dist/*.js`, `dist/*.d.ts`, `schemas/`, `LICENSE` and `package.json`, and
   the manifest's `exports` points at `dist/`. `bun run pack` builds first and stages only the
   published interface, which is why you publish the tarball: the directory's own
   `package.json` points `exports` at `src/` for the workspace.

5. Publish the tarball (`--access public` is required on a scoped package's first publish and
   harmless after it):

   ```bash
   npm publish dist/pack/steamfield-stacks-format-<version>.tgz --access public
   ```

6. Check the registry and a clean install:

   ```bash
   npm view @steamfield/stacks-format version
   cd "$(mktemp -d)" && npm init -y >/dev/null && npm install @steamfield/stacks-format
   node --input-type=module -e "import('@steamfield/stacks-format').then((m) => console.log(Object.keys(m).length, 'exports'))"
   ```

A published version can't be replaced. If one is wrong, publish a fixed patch version and
deprecate the bad one with `npm deprecate @steamfield/stacks-format@<version> "<reason>"`.

## Picking up a release in stacks-api

`stacks-api` depends on `@steamfield/stacks-format` with a caret range. After a publish, bump
the range there (`bun add @steamfield/stacks-format@^<version>`), run its gate, and commit the
lockfile with it. Until the first publish, `stacks-api` keeps its own copies of the schemas it
reads.
