# R5. Release and deploy

Priority P0. Depends on R1, R2, R3, R4 and R10. Evidence: `release.md`. The user runs
every command marked "user" (S1); an agent prepares and verifies.

## Outcome

`npx @steamfield/stacks@<version>` from the site's prompt works against the live API, and
the live site shows the final seed and catalog.

## Read first

- `stacks-api/docs/operations.md` ("Production", "How a deploy works", "Rolling back").
- `plans/archive/phases/phase-1.6c-first-release-2026-10-30.md` "Before publishing", "Publishing",
  "After publishing" (use the name `@steamfield/stacks`).

## Steps

0. Format patch (only if R13 changed `rank.ts`): the user publishes the format version
   recorded in `release.md` per `packages/format/README.md` "Publishing", then stacks-api
   takes it with `bun install` (lockfile regenerated, not hand-edited).

1. quickstack candidate. R1, R3 and R13 merged; bump `packages/cli/package.json` to the S2
   version on its own commit. Run the gate once (`rr check` or `bun run check`) and record
   counts. If the R0 EPERM test fails, rerun it alone once; if it passes alone, note it and
   continue. `bun run pack` in `packages/cli`; record the tarball's `shasum -a 256`. Confirm
   R3's proof still matches (R3 step 9).

2. stacks-api candidate. R4, R10 and R12 merged. Run `bun run check` once, record counts. Record
   the currently deployed commit as the rollback point.

3. The deploy builds the catalog from your quickstack checkout (`$STACKS_CLI_DIR`). Before
   steps 4 and 5, check it's clean and at the release commit:

   ```sh
   git -C "$STACKS_CLI_DIR" status --porcelain   # prints nothing
   git -C "$STACKS_CLI_DIR" rev-parse HEAD        # the quickstack release commit
   ```

4. Seed production (user). In a shell where `env | grep STACKS_DB_PATH` prints nothing,
   from the stacks-api release commit, with the flags from `seed-quality.md`:

   ```sh
   bun run prod:seed -- --replace-production-data --profile active --seed 1 --days 120 --through <YYYY-MM-DD>
   ```

   It regenerates locally (about an hour), backs up the host volumes, and swaps the data in.

5. Deploy (user): `bun run prod:deploy`, after step 4 (stats pages are built from the live API).

6. Check from outside (agent):

   ```sh
   curl -s https://stacks.steamfield.io/healthz
   curl -s https://stacks.steamfield.io/v1/index.json | jq -r .payload | jq -r .commit   # release commit
   curl -s 'https://stacks.steamfield.io/v1/search?q=!!!' | jq '.stacks, .fragments'    # empty
   curl -s -o /dev/null -w '%{http_code}\n' https://stacks.steamfield.io/deps/            # 200
   ```

   Then the smoke list in `web.md`, in a browser.

7. Packed CLI against production (agent), with fresh state:

   ```sh
   export HOME=$(mktemp -d) npm_config_cache=$(mktemp -d)
   npm install -g --prefix "$HOME/p" <tarball>
   "$HOME/p/bin/stacks" search "python api with a react dashboard" --json | jq '.ranking, .remote'   # "api" "used"
   "$HOME/p/bin/stacks" search "!!!"
   "$HOME/p/bin/stacks" show python-react
   ```

8. Publish (user): `npm publish --dry-run <tarball>`, then `npm publish <tarball>`.

9. After publishing (agent): in a fresh `HOME` and npm cache, paste the site's prompt into an
   agent or run its commands with `npx @steamfield/stacks@<version>` (pinned; an unpinned
   `npx` can reuse a cached 0.3.1): `search`, `show python-react`,
   `new python-react <tmp> --sandbox --no-launch`. The user tags `v<version>` and pushes it.

10. Add a dated line to `plans/HANDOFF.md`: "Earlier phase 4 handoff" items 1 to 4 are done by
    this release; production runs with `STACKS_DEMO` per S4.

## If something breaks

Fix forward if it's quick. Otherwise redeploy the recorded stacks-api commit
(operations.md "Rolling back"). A broken CLI release gets a patch release, never an
unpublish. A recipe defect goes back to R3.

## Done when

- [ ] Both gates recorded; tarball digest recorded.
- [ ] Production shows the release commit's catalog and the new seed; step 6 checks pass.
- [ ] Packed and published CLI both rank with the API; the site's prompt works end to end.
