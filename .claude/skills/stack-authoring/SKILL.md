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

## The proving slice

A stack ships a working slice of the project, not starter files and prose. `go-cli` and `typescript-api` are the reference conversions: read both `STACK.md` files and their `files/` trees before writing or converting a stack. The public `references/anatomy.md` ("The body", "files/ and adapters/") states the rule; this section is how to meet it in this checkout.

What the slice carries, for any stack:

- The entry point and the boundaries every feature passes through: config with validated defaults (file, env, flags as the stack decides), the error type and its mapping to exit codes or HTTP statuses, structured logging, and output (CLI) or response envelopes and request middleware (server). A web app ships its layout, one route or page that exercises a server boundary, and the error page. A mobile or desktop app ships the shell, one screen and its native-side command if it has one.
- One payload that proves the wiring end to end (go-cli's `config show` and `greeting` setting, typescript-api's health resource and payload endpoint). No product features.
- Unit tests next to the code and the integration, contract or end-to-end tests the verify steps run, written the way the stack's Testing section says. A test that only asserts a file exists isn't a test of the slice.
- Every config the checks use: lint, format, typecheck, test, the build tool's config, the task runner (Makefile or `package.json` scripts with no dependency blocks), `.env.example`, `.gitignore`, and `docs/` for reference material the body links to.
- Nothing that ages (anatomy's list), and nothing no verify step exercises.

Where a framework has a generator (Next.js, SvelteKit, Astro, React Router, Expo, Tauri), ship the durable parts of its output with the slice: the app source, its config files and the tests. Keep a generator step in Setup only for what can't ship as files (Expo or Tauri native project directories and icons, a lockfile), run into a subdirectory and merged without overwriting shipped files.

`STACK.md` follows the slice. Open with "What stacks wrote" (one paragraph, ending "read the code before extending it"), as `go-cli` does; `typescript-api` says the same in its unheaded first paragraphs, and a converted stack uses the heading. Setup becomes: add the declared `deps` so they resolve to current releases, run the checks, update shipped code or config the installed release rejects without loosening a check, record toolchain versions, fill the README. Conventions shrink to rules new code must keep, each already followed by the shipped code; cut prose the code now carries. Keep every Gotcha that still applies. Keep `id`, `tags` and `description` unless the description becomes false. Keep `deps` to names the slice imports; a new name needs an allowlist row and a reviewed dependency card, which is a maintainer's step, so don't add one: report the need instead.

Lessons from converting the twelve stacks:

- Use the framework's own server and static-file mechanism (`react-router-serve`, Effect's `HttpStaticServer`) over a hand-written one; record its trade-offs as a Gotcha rather than replacing it.
- When one declared tool lags another's newest release (typescript-eslint or `@astrojs/check` behind a TypeScript major), Setup installs the newest release inside the lagging tool's peer range and a Gotcha says when to drop that. It's version resolution, not a new dependency, and no version number goes anywhere.
- Code generated at setup (an OpenAPI document, a typed client, framework type files) stays generated; ship the generator config and the code that imports its output.
- Setup records toolchain versions before running the checks, since linters read them (Ruff's Python target, go.mod's directive selecting the mux behavior).
- `adapters/` carries rules and docs too (hidden directories such as `.claude/rules/`); update them with the body, and drop a `.tmpl` suffix from any adapter or doc file that uses no template variable.
- A `.tmpl` file is tokenized for `{{`, so source that needs a literal `{{` (Go templates, JSX style objects) either stays out of `.tmpl` or spells it another way.
- Keep the proving payload's names when a fragment's branch already refers to them (the `items` service `drizzle-postgres` replaces), and update that branch with the shipped names.

The slice must compose with every default and optional fragment. Don't ship a file a fragment writes (CI workflows, git hooks, harness scripts, the agent files `claude-harness` owns); compose with `--with` and read where each fragment's files land. Update the stack's `stacks:when with=` branches. A fragment's `stack=<id>` block for this stack that now describes code the stack ships gets trimmed to what still applies; any wider fragment change gets reported.

### Checks this checkout runs on shipped files

- Biome lints and formats files under `packages/cli/registry/` with this repo's config (double quotes; `mobile-expo` uses single quotes). `packages/cli/biome.json` turns on Tailwind directives for registry CSS, relaxes the unused-import rules for `.svelte` and `.astro` (markup uses what the script imports), and turns Biome off for stacks whose project formats with Prettier (`astro-blog`, `nextjs`, `sveltekit`, `python-react`'s `frontend/`), so this repo's formatter never rewrites code the project's own lint step checks. A stack that switches formatter moves in or out of that list. Name a shipped `biome.json` `biome.json.tmpl` so it isn't read as a nested config. Run `bun run lint` from the repo root.
- `packages/cli/tsconfig.registry.json` includes every shipped `.ts` file (`.d.ts` too, but not `.tsx`) and typechecks it against this repo's installed packages (`effect`, Bun and Node types), with `lib` ES2023 and no DOM. A file that imports a package this repo doesn't install (React, Next.js, SvelteKit, Astro, Expo, Tauri), uses browser globals, or declares ambient types fails `bun run typecheck`. Exclude such files by directory in the config's `exclude` (the framework app's source and test trees, its `.d.ts` files), with a comment naming the reason. `exclude` only filters `include`: an included file that imports an excluded or `.tsx` file pulls it back in, so exclude the whole tree that imports framework code, keep the files checked today (shared `scripts/`, hook tests, `typescript-api`-style Effect code), and confirm with `bun run typecheck`.
- `.tmpl` files escape both checks above. Prefer relative imports over `@{{package_scope}}/...` workspace names where the stack allows it, and know that the fresh-scaffold proof is the only check of templated code.
- `validate` warns on a version literal in the config files it knows (`core/validate/version-sensitive.ts::VERSION_SENSITIVE`: package, TypeScript, Python, Go and Cargo manifests, the build and test tool configs it names, linters, Docker, workflows), and the bundled registry must stay warning-free (`tests/bundled-registry.test.ts`). It doesn't read `tauri.conf.json`, Expo's `app.json`, `rust-toolchain.toml`, Wrangler config, `next.config.*`, `svelte.config.js`, `react-router.config.ts`, `drizzle.config.ts` or `.prettierrc`, and it reads Compose files but doesn't flag a major-only image tag (`postgres:17`). Check those by hand. A manifest's own version needs two parts (`version = "0.1"`) or none where the format allows it; ship no `requires-python`, `rust-version` or `engines` line.
- Every shipped file a tool reads is exercised by a verify step. Docs, editor settings (`.vscode/`, `.editorconfig`) and PR templates are exempt.
- A `files/.gitignore` applies to this repository too, so a shipped path its patterns match (`build/`, `out/`, `next-env.d.ts`) passes the proof but never reaches a commit. Check `git status --ignored --porcelain packages/cli/registry/stacks/<id>` and add negations to the shipped `.gitignore` where needed, as `typescript-api`'s does.
- The search card's digest covers the entry, so every `STACK.md` edit makes `search-stale` warn until the card is restamped (`search-card.md`). Restamp after your last edit; a card you had to rewrite stays a draft and keeps the registry red until a person approves it.
- The stack body stays under 2,000 words and each composed brief under its budget: `bun run dev validate --brief <id> --sandbox` and once with each default and optional fragment.
- Tests pin composed output and brief prose. Find the ones naming the stack with `grep -rln '<id>' packages/cli/tests` (among them `gate-findings.test.ts`, `library-qa-*.test.ts`, `brief.test.ts`, `registry-hooks.test.ts`, `agent-harness.test.ts`, and for some stacks `registry-api-harness.test.ts`, `codex-api-harness.test.ts` and `mobile-dev-*.test.ts`). When the conversion moves a rule from prose into a shipped file, move the assertion with it onto the scaffolded file (`readFileSync` on the project the test scaffolds); never delete or loosen one. Regenerate `tests/fixtures/bundled-brief-digests.ts` keys as its header says.

### Prove it from a fresh scaffold

The bar is the one `go-cli` and `typescript-api` met: a fresh scaffold, built only by following the brief, reaches a green `verify`.

1. Build the CLI from the repo root (`bun run build`), then scaffold into an empty directory outside the checkout: `XDG_CONFIG_HOME=<empty temp dir> node packages/cli/dist/stacks new <id> <dir> --sandbox --no-launch`. The built CLI reads the working `packages/cli/registry`; the temporary config home keeps a personal copy of the id from shadowing the bundled one.
2. In that directory, follow `.stacks/BRIEF.md` the way the building agent would: add the declared deps (current releases), run each check, fix only what Setup says the agent fixes.
3. Run `node <checkout>/packages/cli/dist/stacks verify` there until it exits 0 with outcome `green`, then once with `--all` so steps the sandbox preset skips (tagged `prod`) are proven too. Record each step's result. For a stack with database steps, start Docker first (`docker info` must succeed).
4. Anything you had to change in a shipped file, or any brief step that misled you, goes back into `files/` or `STACK.md`. Then prove again in a new empty directory. Changes to `files/` read from the registry at runtime need no rebuild; changes to CLI code do.

This local proof isn't a bench run. The hand-back lists `bun run bench <id> --agent claude` as a pending maintainer action, and notes that edits stale any `runs.json` record for the stack.

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

- card approval (`bun run decorate --approve <id>`, which also restamps), for a new or rewritten card (a card you restamped after an entry edit is listed as done, not pending)
- a bench run, `bun run bench <id> --agent claude` from `packages/cli` (`docs/maintaining.md`, "The bench"), before the stack counts as proven
- if you edited a stack with `runs.json` records or a fragment in its default composition, that its ledger proof is now stale

## Reviewing a submitted stack

A PR from `stacks submit` or the entry template carries an author card (`by: "author"`, `reviewedAt: null`). Work through the maintainer checklist in the PR body (`CONTRIBUTING.md`, "What maintainers do"): compare the `authors.json` login with the PR author, review `files/` and `adapters/` for anything that runs in a user's project, then review the card and the entry against the public references, add allowlist rows and dependency cards, add golden judgments, and run the bench. Approve the card (which also restamps it) only after reading it.

## Maintainer-only anti-patterns

| Don't | Do |
| --- | --- |
| Setting `reviewedAt` by hand or running `--approve` | Leave a new or rewritten card a draft for a person; restamp only a reviewed card that still fits (`search-card.md`) |
| Renaming an id to fix search | Fix the card and description; a rename is a release decision |
| Tags chosen without checking which fragments they admit | Compose the brief with each admitted fragment |
