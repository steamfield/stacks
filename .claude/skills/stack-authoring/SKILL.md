---
name: stack-authoring
description: How to create or revise a stack (a STACK.md recipe under packages/cli/registry/stacks) and its search card in packages/cli/registry/search/stacks so it is well named, plainly described, accurate and found by the right searches. Use it whenever someone asks for a new stack, recipe or project template, wants to edit a stack's id, name, description, frontmatter or search card, asks why a stack ranks badly in stacks search, or is distilling a working project into the registry, even if they don't say "stack". For fragments and apps, use fragment-authoring.
---

# Authoring a bundled stack

The format and the authoring judgment live in the public `stacks-author` skill, `packages/cli/skills/stacks-author/`. Read its `SKILL.md`, then `references/anatomy.md` (format, id, description, verify, body), `references/interview.md` (settling the goal with the person asking) and, for a repo being distilled, `references/from-repo.md`. For the card, read `search-card.md` beside this file; it adds the ranker internals and maintainer provenance to the public `references/search-card.md`. If the stack needs a capability no fragment provides yet, load `fragment-authoring` too.

Before writing anything, load the `ce:writer` skill (the Engineer persona) and use it for the frontmatter `description`, the body and every search card field.

This file covers only what differs for the bundled registry.

## Working in the checkout

Use `bun run dev <command>` from the repo root where the public skill says `<cli>`, so you run the CLI from source against the working registry. Write the entry straight into `packages/cli/registry/stacks/<id>/` with Edit and Write; don't `create` into the user registry.

Search before you start: run a few requests through `bun run dev search --local --kind stack --json "<request>"` and read the closest two stacks in full. Bundled entries predate the public skill, so copy their structure and not their search cards.

For a new stack or a broad change, ask the person the interview questions (at most five, each with a recommendation). A subagent returns the questions to its caller and waits for the answers. A narrow revision goes straight to work.

## The proving slice

A stack ships a working slice of the project. Starter files with prose describing the rest don't count. `go-cli` and `typescript-api` are the reference conversions: read both `STACK.md` files and their `files/` trees before writing or converting a stack. The public `references/anatomy.md` ("The body", "files/, adapters/ and stack overlays") states the rule; this section is how to meet it in this checkout.

What the slice carries, for any stack:

- The entry point and the boundaries every feature passes through: config with validated defaults (file, env, flags as the stack decides), the error type and its mapping to exit codes or HTTP statuses, structured logging, and output (CLI) or response envelopes and request middleware (server). A web app ships its layout, one route or page that exercises a server boundary, and the error page. A mobile or desktop app ships the shell, one screen and its native-side command if it has one.
- One payload that proves the wiring end to end (go-cli's `config show` and `greeting` setting, typescript-api's health resource and payload endpoint). No product features.
- Unit tests next to the code, plus the integration, contract or end-to-end tests the verify steps run, written the way the stack's Testing section says. A test that only asserts a file exists doesn't test the slice.
- Every config the checks use: lint, format, typecheck, test, the build tool's config, the task runner (Makefile or `package.json` scripts with no dependency blocks), `.env.example`, `.gitignore`, and `docs/` for reference material the body links to.
- Nothing that ages (anatomy's list), and nothing no verify step exercises.

Where a framework has a generator (Next.js, SvelteKit, Astro, React Router, Expo, Tauri), ship the durable parts of its output with the slice: the app source, its config files and the tests. Keep a generator step in Setup only for what can't ship as files (Expo or Tauri native project directories and icons, a lockfile), run it into a subdirectory, and merge without overwriting shipped files.

`STACK.md` follows the slice. Open with "What stacks wrote" (one paragraph, ending "read the code before extending it"), as `go-cli` does; `typescript-api` says the same in its unheaded first paragraphs, and a converted stack uses the heading. Setup becomes: add the declared `deps` so they resolve to current releases, run the checks, update shipped code or config the installed release rejects without loosening a check, record toolchain versions, fill the README. Conventions shrink to rules new code must keep, each already followed by the shipped code; cut prose the code now carries. Keep every Gotcha that still applies. Keep `id`, `tags` and `description` unless the description becomes false. Keep `deps` to names the slice imports. A new name needs a dependency card (`search-card.md`) and an allowlist row; the row is a maintainer's step, so don't add it: report the need instead.

The slice must compose with every default and optional fragment. Don't ship a file a fragment writes (CI workflows, git hooks, harness scripts, the agent files `claude-harness` owns); compose with `--with` and read where each fragment's files land. Update the stack's `stacks:when with=` branches. When a fragment's `stack=<id>` block for this stack describes code the stack now ships, trim the block to what still applies; report any wider fragment change.

Before converting an existing stack, or when a framework server, a lagging tool, generated code, an adapter, a `.tmpl` file or a fragment branch complicates the slice, read `references/conversion-lessons.md`.

Before you write or edit anything under `files/` or `adapters/`, read `references/checkout-checks.md`: this repo's Biome, typecheck, `validate` and tests read shipped files, and it lists what each one requires.

Before handing back a new or converted stack, or any change to its `files/`, Setup or verify steps, prove it as `references/fresh-scaffold-proof.md` describes: a fresh scaffold, built only by following the brief, reaches a green `verify`.

## Ids in a release

An id is permanent once a release ships it. Renaming one needs a `removed.json` row with `replacedBy`, restarts its published stats, stales `runs.json` proofs and golden judgments, and leaves older projects whose manifest names the old id unable to `add` its fragments cleanly. When revising a stack, keep its id; if you think it's wrong, say so and name these costs.

## Tags are a compatibility contract

Fragments pick stacks by tag. For each tag, list the fragments it admits (`grep -rn applies_to packages/cli/registry/fragments`). Compose the brief with each default and optional fragment (`bun run dev validate --brief <id> --with <fragment> --sandbox` from `packages/cli`) and read the result. Add the `with=` guidance the stack needs, and report any fragment whose `stack=` branches should cover the new stack.

## Search card

Write `packages/cli/registry/search/stacks/<id>.json` following `search-card.md` here, as a `drafted` card. Stack-specific points:

- `platforms` lists everywhere the stack runs code. Shipping an API means `server`; leaving it out penalizes the stack on every "api" or "backend" request.
- `productKinds` lists what a user would call the product. Add `api` if the stack serves JSON routes. Don't add a kind that is a sibling's main job.
- Add `notFor` phrases only for misses you see in testing, each checked against a request it should still win.

## Check and hand back

From `packages/cli`: `bun run dev validate`, `bun run dev show <id> --kind stack`, `bun run dev validate --brief <id> --sandbox`, then `bun run test:unit tests/bundled-registry.test.ts tests/registry.test.ts` and the search tests in `search-card.md`. Fix every failure except the ones `search-card.md` lists as staying red on a new draft.

The hand-back lists the files changed, the validate and test results with counts, the search request table, the proposed golden judgments, and the pending user actions:

- a bench run, `bun run bench <id> --agent claude` from `packages/cli` (`docs/maintaining.md`, "The bench"), before the stack counts as proven
- if you edited a stack with `runs.json` records or a fragment in its default composition, that its ledger proof is now stale

## Reviewing a submitted stack

A PR from `stacks submit` or the entry template carries an author card (`by: "author"`, `reviewedAt: null`). Work through the maintainer checklist in the PR body (`CONTRIBUTING.md`, "What maintainers do"): compare the `authors.json` login with the PR author, review `files/` and `adapters/` for anything that runs in a user's project, then review the card and the entry against the public references, add allowlist rows and dependency cards, add golden judgments, and run the bench. Approve the card (which also restamps it) only after reading it.

## Maintainer-only anti-patterns

| Don't | Do |
| --- | --- |
| Set `reviewedAt` by hand or run `--approve` | Stamp your own card with `--restamp`; leave a submitted author card for a person to approve (`search-card.md`) |
| Rename an id to fix search | Fix the card and description; a rename is a release decision |
| Choose tags without checking which fragments they admit | Compose the brief with each admitted fragment |
