---
name: stack-authoring
description: How to create or revise a stack (a STACK.md recipe under packages/cli/registry/stacks) and its search card in packages/cli/registry/search/stacks so it is well named, plainly described, accurate and found by the right searches. Use it whenever someone asks for a new stack, recipe or project template, wants to edit a stack's id, name, description, frontmatter or search card, asks why a stack ranks badly in stacks search, or is distilling a working project into the registry, even if they don't say "stack". For fragments and apps, use fragment-authoring.
---

# Authoring a bundled stack

The format and the authoring judgment live in the public `stacks-author` skill, `packages/cli/skills/stacks-author/`. Read its `SKILL.md`, then `references/anatomy.md` (format, id, description, verify, body), `references/interview.md` (settling the goal with the person asking) and, for a repo being distilled, `references/from-repo.md`. Read `search-card.md` beside this file for the card; it adds the ranker internals and maintainer provenance to the public `references/search-card.md`. If the stack needs a capability no fragment provides yet, load `fragment-authoring` too.

Before writing anything, load the `ce:writer` skill (the Engineer persona) and use it for the frontmatter `description`, the body and every search card field.

This file covers only what differs for the bundled registry.

## Working in the checkout

Use `bun run dev <command>` from the repo root where the public skill says `<cli>`, so you run the CLI from source against the working registry. Write the entry straight into `packages/cli/registry/stacks/<id>/` with Edit and Write; don't `create` into the user registry.

Search before you start: run a few requests through `bun run dev search --local --kind stack --json "<request>"` and read the closest two stacks in full. Bundled entries predate the public skill: copy their structure, not their search cards.

For a new stack or a broad change, ask the person the interview questions (at most five, each with a recommendation). A subagent returns the questions to its caller and waits for the answers. A narrow revision goes straight to work.

## Ids in a release

An id is permanent once a release ships it. Renaming one needs a `removed.json` row with `replacedBy`, restarts its published stats, stales `runs.json` proofs and golden judgments, and leaves older projects whose manifest names the old id unable to `add` its fragments cleanly. When revising a stack, keep its id; if you think it's wrong, say so with these costs.

## Tags are a compatibility contract

Fragments pick stacks by tag. For each tag, list the fragments it admits (`grep -rn applies_to packages/cli/registry/fragments`). Compose the brief with each default and optional fragment (`bun run dev validate --brief <id> --with <fragment> --sandbox` from `packages/cli`) and read the result. Add the `with=` guidance the stack needs, and report any fragment whose `stack=` branches should cover the new stack.

## Search card

Write `packages/cli/registry/search/stacks/<id>.json` following `search-card.md` here, as a `drafted` card. Stack-specific points:

- `platforms` lists everywhere the stack runs code. Shipping an API means `server`; leaving it out penalizes the stack on every "api" or "backend" request.
- `productKinds` lists what a user would call the product. Add `api` if the stack serves JSON routes. Don't add a kind that is a sibling's main job.
- `notFor` phrases only for misses you see in testing, each checked against a request it should still win.

## Check and hand back

From `packages/cli`: `bun run dev validate`, `bun run dev show <id> --kind stack`, `bun run dev validate --brief <id> --sandbox`, then `bun run test:unit tests/bundled-registry.test.ts tests/registry.test.ts` and the search tests in `search-card.md`. Fix every failure except the ones `search-card.md` lists as staying red on a new draft.

The hand-back lists the files changed, the validate and test results with counts, the search request table, the proposed golden judgments, and the pending user actions:

- card approval and restamp
- a bench run, `bun run bench <id> --agent claude` from `packages/cli` (`docs/maintaining.md`, "The bench"), before the stack counts as proven
- if you edited a stack with `runs.json` records or a fragment in its default composition, that its ledger proof is now stale

## Reviewing a submitted stack

A PR from `stacks submit` or the entry template carries an author card (`by: "author"`, `reviewedAt: null`). Work through the maintainer checklist in the PR body (`CONTRIBUTING.md`, "What maintainers do"): compare the `authors.json` login with the PR author, review `files/` and `adapters/` for anything that runs in a user's project, then review the card and the entry against the public references, add allowlist rows and dependency cards, add golden judgments, and run the bench. Approve and restamp the card only after reading it.

## Maintainer-only anti-patterns

| Don't | Do |
| --- | --- |
| Setting `reviewedAt` or running restamp yourself | Leave the card a draft for a person |
| Renaming an id to fix search | Fix the card and description; a rename is a release decision |
| Tags chosen without checking which fragments they admit | Compose the brief with each admitted fragment |
