# Registry agent ops: destructive-only hooks, baked-in engineering guidance, documented code

## Context

The maintainer's feedback on `typescript-library` (demo scaffold `~/Projects/zod-clone2`) is about four things:

1. The agent guidance is thin. It's one-line pointers to `ce:*` skills, and those load only for Claude, only after the folder is trusted and the session restarted. The agent that builds right after `stacks new` gets almost none of the testing, architecture or error-handling guidance.
2. The hooks block much more than destructive work, and the problem spreads across the whole registry:
   - The shared Claude TS guard denies unparseable commands, `find -delete` (it even fired on a quoted grep pattern here), `git stash drop`, `sudo` and similar.
   - It fails closed.
   - 36 stacks and fragments ship their own guards (`bun test`, `--bun`, generated files, package choices).
   - The Codex, Cursor and OpenCode wrappers fail closed too.
3. Nothing asks for human-readable code: a file-level header, a README per source folder, clear layout.
4. Shipped `tests/hooks/` duplicate the CLI's own suite and the shipped `smoke.sh`. `vitest.config.ts` includes them, so they run in `bun run test`/`coverage` and again in `harness-hooks`. zod-clone2's `runs.jsonl`: `test` takes 6.6–9.2 s and `harness-hooks` alone 4.3–7.4 s. The "about 60 s" figure isn't in any verify record, so a measured baseline comes first.

Decisions so far:

- Registry-wide sweep under one hook policy.
- One bash rule set for destructive commands, for every agent.
- Guidance ships as files in `agent-ops`, with the binding rules in AGENTS.md itself.
- `ce-plugin` becomes a default of `typescript-library`.
- Shipped `tests/hooks/` are removed.
- A new `code-docs` fragment: a checked file header, and folder READMEs as guidance the agent applies with judgment.
- Lands on `build/agent-ops-cleanup` in a worktree off `main`; the decks work on `feat/decks-stack` is untouched.
- Coding units go to Codex delegates.

## Hook policy (written into agent-ops and claude-harness FRAGMENT.md)

Every hook falls into exactly one of three classes:

- Destructive or irreversible: deny.
- Would hang the session (a foreground dev server, an MCP inspector UI, watch mode): keep, with the non-blocking alternative in the message.
- Wrong tool or convention (`bun test`, `--bun`, edits to generated files, package choices, import boundaries): never a deny. It goes in the stack's guidance, and lint or typecheck catch it where they can.

Wrappers fail open, with a stderr note, when a guard can't run. Advisory hooks stay: lint-on-write, typecheck-on-write, format-on-stop and session-start. Remove the FRAGMENT.md lines that tell agents to write guards and a regression test per hook. Replace them with: "a project hook adds a case to `.claude/hooks/smoke.sh`".

Destructive set: the single source is `agent-ops/files/.claude/hooks/_destructive-patterns.sh`. It matches unquoted segments, so quoted mentions pass. Every existing rule is classified:

- Keep:
  - `rm` of a literal `/`, `/*`, `~`, `$HOME`, `.`, `..` or an absolute path outside `$CLAUDE_PROJECT_DIR`; variable or unresolvable targets are allowed
  - `git reset --hard`, `git checkout .`/`git restore .`, `git clean -f`, `git push --force`/`-f` and remote branch delete (`--force-with-lease` allowed), history rewrite (`filter-branch`/`filter-repo`), `--no-verify`
  - `DROP`/`TRUNCATE` through a DB client
  - `mkfs`, `dd of=/dev/…`, redirects to raw disks, the fork bomb
  - `npm`/`bun`/`pnpm`/`yarn` `publish`/`unpublish`/`version`/`dist-tag`, `bun pm version`, `changeset publish`, `gh release create`
  - `gh repo delete`/`gh release delete`, `kubectl delete`, `aws s3 rm --recursive`/`s3 rb --force`, `terraform destroy`
  - `curl|wget … | sh`
  - secret-shaped writes (`detect-secrets.sh`) and the `.env` read denies in settings
- Drop:
  - opaque or complex commands
  - `rm` with a bare `*` or variable targets
  - `xargs rm`, `find -delete`/`-exec rm`
  - chmod 777, recursive chown
  - `DELETE` without `WHERE`
  - docker image or volume removal
  - `git stash drop/clear`, `git branch -D`, forced checkout/switch
  - `sudo`
  - `killall`/`pkill -9`

## Phase 0: baseline (inline, me)

Scaffold `typescript-library` from `main` into the scratchpad. Record `vitest run --reporter=verbose` per-file durations and `stacks verify` step durations. These are the before numbers for the report.

## Phase 1: hooks (Codex units A–C, parallel, file-disjoint)

- Unit A, the core guard: owns `agent-ops/**/hooks`, `agent-ops/adapters/{codex,cursor,opencode}`, `claude-harness/**`, `packages/cli/tests/fixtures/hook-input/*`, and the CLI hook tests (`agent-harness*.test.ts`, `registry-hooks.test.ts`, the harness parts of `registry-api-harness.test.ts`/`codex-api-harness.test.ts`, `fixtures/native-adapters/`).
  - Prune `_destructive-patterns.sh` to the keep list.
  - Delete `guard-commands.ts`, `_destructive.ts`, `_git.ts`, `guard-generated.ts` and the parity tests. Keep `_shell.ts` and `_lib.ts` only if a surviving stack guard imports them.
  - `block-destructive.sh` uses the bash list only.
  - The Codex, Cursor (`failClosed: false`, unreadable payload allowed) and OpenCode wrappers fail open with a note.
  - Delete `claude-harness/adapters/claude/tests/**`. Add the `rm -rf ~` deny and `rm -rf ./dist` allow cases to `smoke.sh`.
  - `harness-hooks` stays, for hook tests a project adds itself.
  - CLI tests are written first: every keep rule denies, and representative drops are allowed (`find . -name x -delete`, `$CMD --help`, `git stash drop`, `rm -rf "$TMP/out"`, `sudo ls`). Each wrapper allows when the guard is missing.
- Unit B, TypeScript stack guards: owns `adapters/claude/.claude/hooks/**`, its `settings.json` wiring, its `tests/hooks/**` and `tests/helpers/hooks.ts` references in `tsconfig*.json`/`vitest.config.ts`. That's for nextjs, nuxt, sveltekit, react-router, react-vite, tauri-react, typescript-api, typescript-cli, typescript-library, typescript-mcp, hono-api, nestjs-api, astro-fullstack and the `openrouter-chat-cli` fragment.
  - Apply the policy: delete convention guards; keep anti-hang ones, trimmed to that rule; keep advisory status hooks.
  - Each removed rule's content moves to the line it belongs on in that stack's guidance doc or STACK.md Gotchas, as a list in the hand-off that I apply.
  - Delete their shipped hook tests, add `exclude: ["tests/hooks/**"]` to each `vitest.config.ts`, and drop `tests/helpers/hooks.ts` from the tsconfigs.
- Unit C, bash stack guards (Python, Go, Rust, Java, Django and the rest of the `.sh` guards listed by `ls stacks/*/adapters/claude/.claude/hooks`): same policy and the same hand-off list.

Me: STACK.md and FRAGMENT.md text, applying B's and C's moved-rule lists, `.claude/README.md` template and `docs/harness.md` hook tables.

Demo: fresh `typescript-library` scaffold.
- `bun run test` runs only app tests, timed against phase 0.
- `stacks verify` is green.
- Payloads through `block-destructive.sh`: `find . -name '*.log' -delete` and `$X --version` are allowed; `rm -rf ~` and `git reset --hard` are denied.

## Phase 2: engineering guidance (Codex unit D, can start alongside phase 1: disjoint files)

- `agent-ops/files/docs/guidance/engineering/` holds `testing.md`, `architecture.md`, `errors.md` and `code-style.md`, each up to about 600 words. They're condensed from the ce `writing-tests`, `architecting-systems` and `handling-errors` SKILL.md files and their references, plus readability for `code-style.md`:
  - folders and files named by concept, one responsibility per file
  - a file-level doc comment in the language's convention saying what the file does and where it fits
  - a README in each folder that is a meaningful part of the architecture, explaining its role; the agent judges which folders need one
  - comments that explain why
  
  Language-neutral; each ends with a "Deeper" line naming the ce skill. Under `stacks:when mode=new` or listed as "merge needed" in add mode, so existing repos aren't overridden.
- `AGENTS.md.tmpl`: Testing, Error handling and Conventions each get 5–8 binding bullets (header and README rules included) and a link to the matching doc. It stays under 200 lines.
- Claude and Cursor get the docs on matching files without the plugin:
  - `agent-ops/adapters/claude/.claude/rules/engineering.md`, scoped to source paths
  - `agent-ops/adapters/cursor/.cursor/rules/engineering.mdc`, with globs
- `ce-plugin`:
  - Its rules point at the project doc first, then "deeper: `ce:<skill>`".
  - Rewrite FRAGMENT.md's "don't copy skill content" line.
  - Move it from optional to default in typescript-library.
- typescript-library `docs/guidance/typescript-library/testing.md` and `library.md` link the engineering docs and keep only the TS halves (the ce skills' TypeScript references).

Me: the `agent-ops/FRAGMENT.md` paragraph telling the agent to read the engineering docs before writing code; `bun run dev validate` across every bundled stack for the composed-brief budget (6,000 words).

Demo: a fresh scaffold has `docs/guidance/engineering/`, and AGENTS.md carries the bullets; `validate --brief typescript-library` stays within budget.

## Phase 3: code-docs fragment (Codex unit E, after phases 1–2 merge)

- `fragments/code-docs/`: category `tooling`, `applies_to: []`, search card via the `fragment-authoring` skill. One verify step, `file-headers`, with an inline `run:` (no shipped script) and tagged `hygiene`. It checks that the first non-blank line of each source file under `src/`, `scripts/` and (TS) `tests/` is a doc comment for its language: `/**` for `.ts`/`.tsx`/`.js`/`.mjs`, a docstring for `.py` and a `//` comment for `.go`. Excluded: `tests/consumer`, fixtures, config files at the root, `.claude`, generated directories.
- Folder READMEs are a judgment call, not a check. The fragment body and `code-style.md` say a folder that is a meaningful part of the architecture gets a README explaining its role. The agent decides which folders qualify and can skip a trivial or self-explanatory one (fixtures, a single-file folder, generated output). No verify step enforces it.
- Confirm Biome's `organizeImports` keeps a leading header comment in place.
- typescript-library takes `code-docs` as a default. Every shipped `.ts` in `files/` and both payloads gets a header, and `src/`, `src/internal/` (example), `tests/` and `scripts/` get READMEs.

Demo: a scaffold passes `stacks verify --all`. Delete one file header, and it fails, naming the file.

## Delegation mechanics

Per `.claude/delegate.md`: one worktree per unit under `.claude/worktrees/<unit>` branched from `build/agent-ops-cleanup`, `bun install --frozen-lockfile`, a contract from `.claude/delegate/contract.md` in the scratchpad, then `env DELEGATE_TRUST_REPO_HOOKS=1 ~/.claude/skills/codex-delegate/scripts/delegate.sh <contract> --write --worktree …` in the background. Check the digest names the newest sol model. At most five delegates at once.

Each contract carries:

- the hook policy and keep/drop list verbatim
- its owned paths
- the rule files (`.claude/rules/architecture.md`, `agent-ops.md`, `cli/testing.md`)
- scoped test commands (delegates can't run whole suites)

After each unit I review its hand-off and diff, refactor with Edit, and merge. Then:

- regenerate brief digests (`tests/fixtures/bundled-brief-digests.ts`) and the search golden through their documented paths
- run `rr check` once per phase and tag `phase-N`

## Verification

- Per unit: scoped CLI tests, `bun run lint`, `bun run typecheck`, `bun run dev validate` (zero warnings on the bundled registry).
- Per phase: `rr check`.
- At the end:
  - `bun run prove typescript-library` plus one TS stack and one bash-guard stack touched by the sweep, for fresh scaffold proofs
  - a full `stacks verify --all` in a scaffolded typescript-library, with before and after test timings from phase 0
  - one `code-reviewer` pass on the full diff

No merge into main or push until asked.

## Follow-up (not this change)

Opt the other Biome/TS stacks into `code-docs` once its output in typescript-library is reviewed.

## Baseline (phase 0)

Fresh typescript-library scaffold from main 8a76a946: 240 tests, 196 of them in tests/hooks; hook test files take 6.9 s of 8.4 s summed file time (guard-commands 3.8 s, guard-destructive-regressions 1.8 s); vitest wall time 4.0 s.
