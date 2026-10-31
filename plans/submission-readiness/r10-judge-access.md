# R10. Judge-facing docs and source access

Priority P0. Depends on R0 (organizer rules) and S6. Evidence: `judge-access.md`. Finish
before R5 so the release carries the doc fixes.

## Outcome

A judge landing on a repository, the npm page or the site understands what stacks is,
installs the released version in one command, and can reach the source they're allowed
to see.

## Current state (2026-10-28)

`github.com/steamfield/stacks` (the CLI) is public with a LICENSE.
`github.com/steamfield/stacks-app` (the API and site) is private with no LICENSE.

## Steps

1. Access (S6). From the organizer rules, decide with the user: invite reviewers to the
   private repository (simplest), or make it public. If public, add a LICENSE copied from
   quickstack, and the user runs a quick secret scan of history before flipping visibility.
   Agents don't change visibility or send invitations.

2. First-read docs: `quickstack/README.md`, `packages/cli/README.md` (the npm page),
   `packages/cli/docs/quickstart.md`, `stacks-api/README.md`. For each:
   - the first paragraph says what stacks does and links `https://stacks.steamfield.io`;
   - install is `npx @steamfield/stacks@latest` and states Node 22 or newer (`engines`);
   - the commands shown are the demo loop (`search`, `show`, `new`, `verify --all`) and their
     output matches the source build (run each once);
   - nothing depends on a source checkout, a private host, or an env var the release ignores;
   - links open.

3. npm page metadata in `packages/cli/package.json`: `description`, `homepage`
   (`https://stacks.steamfield.io`), `repository`, `keywords`.

4. If a repository is public, add a source link to the site footer
   (`stacks-api/apps/web/src/layouts/BaseLayout.astro`); coordinate with R4.

## Done when

- [ ] S6 decided and the access route recorded.
- [ ] The four docs pass step 2; npm metadata set.
