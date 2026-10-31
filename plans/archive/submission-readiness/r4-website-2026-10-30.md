# R4. Website demo polish

Priority P0. Depends on R0; the final walkthrough uses R2's sample. Evidence: `web.md`.
Works in `stacks-api/apps/web` and `stacks-api/scripts/production.ts`.

## Outcome

Every page a judge or the demo visits works and reads well: dependency pages exist, links
and sharing use the real domain, copying a prompt never dead-ends, and someone choosing a
recipe finds the filtered list without wading through charts.

## Read first

- `stacks-api/.claude/rules/web/astro.md`, `.claude/rules/web/styling.md`,
  `apps/web/README.md`, the page's mock in `stacks-api/mocks/`.
- `stacks-api/docs/specs/2026-10-28-directory-decision-flows-rfc.md`, "Acceptance checks"
  (lines 144-158): this task's walkthrough checklist.
- Code: `apps/web/astro.config.mjs`, `apps/web/src/site-config.ts`,
  `apps/web/src/data/read-deps.ts`, `apps/web/src/islands/HomeExplorer.tsx`,
  `apps/web/src/islands/Directory.tsx`.
- R0's worktree inventory: the Codex `ux-browse-flow` and `ux-handoff-flow` work touched these
  files and appears to be on `main` (`b74a7e9`, `0f3d6ea`); confirm before editing.

## Steps

1. Dependency pages in production. In `scripts/production.ts` (around line 171) add
   `DEPS_ENABLED: "true"` to the stats pass's env only (the run that sets `STATS_ENABLED`),
   not the `--without-stats` pass, which has no `STATS_API_URL`. Update
   `docs/operations.md:56`. Extend `tests/deploy.test.ts` to assert it. Ask the user to
   skim the package names in `quickstack/packages/cli/registry/allowlist.json`, since they
   become public pages (4.2e left that review open); one pass is enough.

2. Real domain. Set `site` in `apps/web/astro.config.mjs:135` to
   `https://stacks.steamfield.io`, and update the "Deferred" sentence about `example.com` in
   `stacks-api/AGENTS.md`. Update test expectations that pin the old origin (find them with
   `grep -rn "example.com" apps/web tests`).

3. Clipboard failure. In `HomeExplorer.tsx` (and any other copy button,
   `grep -rln clipboard apps/web/src`), when the clipboard write fails: open the prompt's
   disclosure, select the text, and announce "Copy failed. The prompt is selected; press
   Cmd+C or Ctrl+C." in an `aria-live` region. Component test with a rejecting clipboard in
   `HomeExplorer.test.tsx`.

4. Build against the R2 sample and walk it:

   ```sh
   STATIC_DIR=<index> STACKS_DB_PATH=.dev/data/r2-sample.sqlite \
   STACKS_ARCHIVE_DIR=.dev/data/r2-sample-archive PORT_API=<port> bun run dev:stats
   # second terminal
   STATS_ENABLED=true DEPS_ENABLED=true STATS_API_URL=http://127.0.0.1:<port> \
   STACKS_INDEX_DIR=<index> STACKS_INDEX_PUBLIC_KEYS=<keys for that index> \
   bun run --cwd apps/web build
   ```

   (`free-port 4400` picks a port. The site's index reader requires signatures; if the
   unsigned index fails, record what you did to get past it.) Serve `apps/web/dist` and
   walk the spec's acceptance table on a laptop width and a 390-pixel width, with the
   keyboard, and once with JavaScript off. Also open the stats views (home charts, a stack's
   history, trending) since 4.2f's browser tests never merged. Record pass or fail per row.

5. Fix what the walkthrough found. If choosing a recipe means passing through analytics
   first, add the link from the home page's primary flow to the filtered stack list using
   existing pages and nav (the search page is R12's). Each fix gets a component or browser
   test.

## Done when

- [ ] Steps 1 to 3 landed with tests; touched browser specs pass
      (`bun run test:browser --grep <name>`).
- [ ] The user skimmed the allowlist.
- [ ] Every acceptance-table row and the stats views pass in the walkthrough.
- [ ] `web.md` lists R5's post-deploy smoke: `/`, `/deps/`, one stack, one fragment, one
      scoped dependency, canonical tag, every copied command on the home page.
