# @steamfield/stacks-format

The portable contracts stacks shares between its CLI and its hosted API: entry format v1, the
project manifest, run records, telemetry events, canonical bundles and their digests, the signed
registry index with its official names and directory, and the stats shapes. It has no platform
code; its one dependency is `effect`.

Inside this workspace the package resolves to `src/` directly. Everyone else installs the
published build from npm.

## Publishing

CI publishes. A pushed `v<cli version>` tag runs `.github/workflows/release.yml`, which publishes
this package, then `@steamfield/stacks`, then `@steamfield/stacks-mcp` (it pins the CLI's exact
version) with provenance, through npm trusted publishing. AGENTS.md, "Releasing", has the whole
flow; this section covers what is specific to this package.

1. Choose the version. Bump `version` in `packages/format/package.json` on its own commit:
   patch for a fix, minor for an addition (a new export, a new optional field), major for a
   change that rejects data the previous version accepted or removes an export. A release whose
   format version is already on npm with the same bytes skips it.

   `bun run release X.Y.Z` bumps the patch version in `packages/mcp/package.json` with the CLI
   version, because the MCP package pins the CLI's exact version.

2. To publish format alone first, so the hosted API can use it, start the Release workflow from
   `main` in the Actions tab (or `gh workflow run release.yml --ref main`). A manual run packs and
   publishes this package only and tags nothing; a later tag run skips this exact version.

3. Check the registry and a clean install:

   ```bash
   npm view @steamfield/stacks-format version dist.integrity
   cd "$(mktemp -d)" && npm init -y >/dev/null && npm install @steamfield/stacks-format
   node --input-type=module -e "import('@steamfield/stacks-format').then((m) => console.log(Object.keys(m).length, 'exports'))"
   ```

`bun run pack` in this directory builds and stages only the published interface (`dist/*.js`,
`dist/*.d.ts`, `schemas/`, `LICENSE` and a `package.json` whose `exports` points at `dist/`), which
is why CI publishes the tarball and not the directory. Provenance needs the `repository` field
that pack copies from `package.json`.

A published version can't be replaced. If one is wrong, publish a fixed patch version and
deprecate the bad one with `npm deprecate @steamfield/stacks-format@<version> "<reason>"`.

## Picking up a release in stacks-api

`stacks-api` depends on `@steamfield/stacks-format` with a caret range. After a publish, bump
the range there (`bun add @steamfield/stacks-format@^<version>`), run its gate, and commit the
lockfile with it. Until the first publish, `stacks-api` keeps its own copies of the schemas it
reads.
