---
name: fragment-authoring
description: How to create or revise a fragment (a FRAGMENT.md under packages/cli/registry/fragments, including category app) and its search card in packages/cli/registry/search/fragments so it is well named, plainly described, scoped to the stacks it fits and found by the right searches. Use it whenever someone wants to add a capability to stacks (CI, auth, a database, analytics, release tooling, agent guardrails, an app), edit a fragment's id, name, description, applies_to, requires or search card, or asks why a fragment ranks badly in stacks search, even if they don't say "fragment". For base project recipes, use stack-authoring.
---

# Authoring a bundled fragment

The format and the authoring judgment live in the public `stacks-author` skill, `packages/cli/skills/stacks-author/`. Read its `SKILL.md`, then `references/fragment.md` (scope, body, apps, id and description) and `references/anatomy.md` (the shared format). Read `.claude/skills/stack-authoring/search-card.md` for the card; it adds the ranker internals and maintainer provenance to the public `references/search-card.md`.

Before writing anything, load the `ce:writer` skill (the Engineer persona) and use it for the frontmatter `description`, the body and every search card field.

This file covers only what differs for the bundled registry.

## Working in the checkout

Use `bun run dev <command>` from the repo root where the public skill says `<cli>`. Write the entry straight into `packages/cli/registry/fragments/<id>/` with Edit and Write.

Search for overlap first: `bun run dev search --local --kind fragment --json "<capability>"`, and read the closest two fragments in full. Bundled entries predate the public skill, so copy their structure and not their search cards.

For a new fragment or a broad change, ask the person the questions in `references/fragment.md` (at most five, each with a recommendation). A subagent returns the questions to its caller and waits for the answers.

When you target stacks by tag, compose each admitted stack's brief with the fragment (`bun run dev validate --brief <stack> --with <id> --sandbox` from `packages/cli`) and add `<!-- stacks:when stack=<stack> -->` branches where needed.

## Fragments in a workspace

A workspace stack places each fragment by stack id in `applies_to` (`packages/cli/docs/authoring.md`, "Layout and placement"): naming exactly one part's stack puts the fragment in that part, with its `stacks/<part stack id>/` overlay and prefixed steps; anything else puts it once at the root. A tag match never chooses a part. Before naming a second stack in `applies_to`, check whether the two are ever parts of one workspace: the fragment then moves to the root there.

When a fragment on one part changes what the other part needs, its own body says so in a `stacks:when part=<role>` block (`part=web` holds only in a workspace with a web part), written in roles ("the API part", "the client part"). `postgres` on the API part adds a readiness route, so the client is regenerated. Keep the block to that effect; the workspace body cannot list every fragment.

## Writing a link

A link is the fragment that connects a workspace's parts, such as `openapi-client`. Check each:

- [ ] `category: link`, and `applies_to` names the client stack, so the link lands in the client part.
- [ ] The body is written in roles, never directory names: "the API part", "the client part". It covers where the document is read from, the regenerate command inside the client part, that the output is read-only, what a failed drift check means and what a renamed operation does.
- [ ] It ships only its own new files (a generator config, an adapter onto the client module's request function), relative to the client part. The config reads `./openapi.json`, which the workspace's root target copies from the API part.
- [ ] It changes no file another entry writes and no template (`package.json.tmpl`, `biome.json.tmpl`). Package scripts are added by the agent from the body; settings the client needs for the link, such as Biome excludes for the generated directory, go into the client stack, where they are inert without the link.
- [ ] It ships no generated client and no `openapi.json`: both are Setup output that depends on installed releases.
- [ ] Its drift step regenerates into a temporary directory and compares with the committed output. Never compare with git: that fails straight after every correct regeneration until it's committed.
- [ ] It relies only on the role rules: the `/v1` prefix, the `notes` operation ids, the status and `x-request-id` of a failure. Anything per backend (schema names, the error envelope) makes the link per backend.
- [ ] Every workspace that uses it lists it in `required`, and its brief composes and proves with each.

## Ids in a release

An id is permanent once a release ships it. A rename needs a `removed.json` row with `replacedBy`, restarts the fragment's published stats, updates every stack `fragments` list and fragment `requires` that names it, and stales golden judgments. Fragments that something requires are the worst case: older projects keep the old id in their manifest, so `add` asks for the new id again and parks duplicate files under `.stacks/incoming/`. When revising a fragment, keep its id; if you think it's wrong, say so and name these costs.

## Search card

Write `packages/cli/registry/search/fragments/<id>.json` following `search-card.md`, as a `drafted` card. Fragment-specific points:

- `capabilities` come from the closed vocabulary (0 to 3). Platform and language penalties come from the stacks `applies_to` admits, and a fragment never takes a product-kind penalty. `applies_to: []` opts out of those penalties, so the fragment then needs `notFor` to stay out of other languages' queries.
- `notFor` fixes most fragment misses seen in testing: the other host ("GitLab CI"), the vendor's products it doesn't touch, the capability it lacks, and the sibling's job.
- `synonyms` add the plain words people use for the capability and agent-specific terms for each adapter shipped ("Cursor rules", "Codex hooks").
- For an app, `requests` describe the app the user gets, and project examples name their host `stack`.

## Check and hand back

From `packages/cli`: `bun run dev validate`, `bun run dev show <id> --kind fragment`, the brief composition above for each stack it fits (or a representative stack when `applies_to` is empty), then `bun run test:unit tests/registry/bundled-registry.test.ts tests/registry/registry.test.ts` and the search tests in `search-card.md`. Fix every failure except the ones `search-card.md` lists as staying red on a new draft.

The hand-back lists the files changed, the validate and test results with counts, the search request table, the proposed golden judgment, and the pending user actions:

- any stack whose `fragments` lists should offer it
- a bench run with the fragment, `bun run bench <stack> --with <id> --agent claude` from `packages/cli`, for an app or any fragment that changes what verify runs
- if the fragment is in a stack's default composition, that the stack's `runs.json` proof is now stale

## Reviewing a submitted fragment

Follow "Reviewing a submitted stack" in `stack-authoring`; for a fragment, also compose its brief with each stack its `applies_to` admits before the bench run.

## Maintainer-only anti-patterns

| Don't | Do |
| --- | --- |
| Set `reviewedAt` by hand or run `--approve` | Stamp your own card with `--restamp`; leave a submitted author card for a person to approve (`stack-authoring/search-card.md`) |
| Rename a required fragment to fix search | Fix the name field, description and card |
| Put misspellings on one card | Add aliases to `vocabulary.json` |
