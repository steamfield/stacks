# Phase 1.6a: Bundled catalog in format v1

Status: EXECUTED 2026-10-26, reviewed once and fixed, merged to main 2026-10-27. The tarball tests (acceptance, unnumbered) wait for 0.2

Acceptance tests: traced

Re-scoped 2026-10-26 by the roadmap to "Bundled
catalog: bring into v1 and validate": bring the whole bundled catalog into entry format v1 as
amended and pass `validate`, recording each composed size, instead of writing three
stacks to D13's word targets. Body rewritten to match 2026-10-26

| Field | Value |
|---|---|
| Goal | Every entry in the bundled catalog (its stacks and fragments, apps included) written in entry format v1 as amended (D18), passing `validate` with zero errors and zero warnings, with each stack's composed size recorded in both presets, a composition test per stack, and a tarball file-list test |
| Traces to | Assumption "Agents can follow a 3,000 to 10,000 word brief faithfully ... The first assumption is the one to test next"; D5 (the budget hypothesis 1.6b's runs test); open question "Who is the bundled registry for?"; success row "The result is complete" |
| Depends on | 1.5 (`validate`, the budget and the canonical render). Writing entries can start now: 1.0 fixed the format in code and 1.1 the composition. The composition tests run `new`, so they land with or after 1.2a |
| Blocks | 1.6d (its hooks ship in `agent-ops` and are tested on files the gate stacks write), 1.6b (the gate runs these stacks), and the per-entry bench proofs in 3.3a, 3.3b, 3.3c, 3.4a and 3.5b |
| Decisions needed | D6 and D13 as amended: which entries the catalog holds is the maintainers' choice, including whether personal-tooling entries ship (roadmap, Feature gaps). D5 as amended 2026-10-26: the caps 1.5 enforces (stack body 2,000, fragment 1,000, app body 3,000, composed 6,000, 9,000 with an app) are still a proposal the maintainers haven't agreed. D20, if it keeps gating every bundled stack, makes 1.6b one run per catalog stack |
| Settles | The catalog's v1 form; each stack's measured composed size per preset, with and without its app where it offers one; [open question 4](../../risks-and-open-questions.md#open-questions-for-the-maintainers) as far as content goes |

## Where this fits

1.6 is split four ways. This sub-phase brings the catalog into format v1 and proves it
decodes, composes, fits the budget and packs; 1.6d writes the Claude Code guardrail hooks
that ship in `agent-ops`. 1.6b takes each gate stack once through a real agent run from
the packed tarball and records the result (D20); 1.6c publishes that tarball. 1.6a hands
1.6b a registry that passes `validate`, a composition test per stack and a tarball
file-list test, so a gate run that fails is a prose or CLI problem, not a format or
packing one. Fixes that 1.6b's run notes call for land in these same entry files, done
by 1.6b.

1.6a proves an entry is well formed, not that an agent gets it to green. That proof is
per entry and comes later: D13's three gate stacks in 1.6b, everything else under 3.3a's
proof rule (release and deploy fragments in 3.3a, service, vendor, Effect and tooling
fragments in 3.3c, the other stacks in 3.3b, the agent harness fragment in 3.4a, apps in
3.5b).

## Scope

In:

- Every stack and fragment in the bundled catalog, in entry format v1 as amended. Apps
  are fragments with `category: app`.
- The `agent-ops` fragment's body, its `AGENTS.md` skeleton and its verify steps (the
  guardrail hooks are 1.6d's).
- Composition, packing, lint and typecheck tests for the bundled set.
- The repo `README.md` and package `README.md` describing the core loop and the stack
  table. These ship in the tarball, so they are done before 1.6b packs it.

Out:

- Choosing what the catalog holds (D6, D13; the maintainers').
- The guardrail hooks and their behavior tests (1.6d).
- Bench proofs (1.6b for the gate set; 3.3a, 3.3b, 3.3c, 3.4a and 3.5b for the rest).
- CLI features an entry would like but v1 doesn't have, such as built-in file checks
  (an open additive item in 1.3a). An entry that needs one writes it as a short command.
- Gate runs (1.6b) and publishing (1.6c).
- A `validate` CI step for the bundled registry ([5.0](../../phases/phase-5.0-ci-release-and-checks.md)).
  1.5's bundled-registry test already runs in `bun run test`.

## Design

### What the catalog must contain

This plan doesn't list the catalog; the maintainers choose it. Whatever they choose has
to include:

| Part | Why |
|---|---|
| D13's three gate stacks: one small with a dev server, one small without, one near the composed cap with two servers | 1.6b's gate runs and D5's hypothesis need one brief at each end |
| `agent-ops` and the default fragments every stack composes with (git hooks, CI) | D7 and the brief's rules assume them |
| At least one app (`category: app`) on a gate stack | 1.1's split brief and 3.5b's app stage need real content to measure |

Each other entry belongs to one of the categories a 3.x sub-phase proves, so no entry
ships without an owner for its bench proof.

### Writing an entry in v1

Every entry follows entry format v1 (roadmap, Contracts: Entry format v1; D18 as amended)
and passes 1.5. The rules an entry author most often gets wrong:

- **Frontmatter keys are snake_case** (`schema_version`, `applies_to`, `needs_own_repo`,
  `requires_tools`). A camelCase key is an unknown key and the entry is rejected.
  `schema_version` is `1`; `id` equals the directory name.
- **Dotfiles are literal.** `files/.gitignore` is stored as `.gitignore`. An entry's own
  `.gitignore` can make git ignore that entry's other files in this repository (a `.env.*`
  pattern hides `files/.env.example.tmpl`); the fixture guard in `tests/registry.test.ts`
  fails when git ignores any file under `packages/cli/registry/` (1.0's "What this plan
  may get wrong").
- **Verify steps** are `{ name, run, cwd?, phase, tags, expect?, layer?, timeout? }`.
  Each calls a project command (`make test`, `bun run lint`), carries a `layer`, and sets
  `timeout` only when the 10-minute default is wrong. A dev server is a `serve` step with
  `expect: { http, within }`, its URL reading the port from `env` (`PORT_WEB`,
  `PORT_API`) with the default in the entry. A step that needs credentials or a deploy
  target carries the `prod` tag. No entry's step carries the `app` tag: the CLI adds it to
  an app's steps (1.1).
- **No built-in checks.** A check that a file exists or was filled in is a short command
  (`test -s README.md`, a `grep`), not a check kind.
- **Apps** have `category: app` and a non-empty `applies_to`. The body is the
  application half of 1.1's split brief: it starts from a base that is done at `partial`
  with every base step passing, and adds the app's own slice and steps.
- **Templates.** Only `*.tmpl` files render, with the fixed variables `project_name`,
  `project_slug`, `env_prefix`, `package_scope`, `author` and `year`. A fragment that
  publishes a package names it with `{{package_scope}}` rather than asking the agent to
  guess a scope. A rendered file never contains `{{`.
- **Conditional prose** uses `<!-- stacks:when tag=... -->` and
  `<!-- stacks:end -->` lines; `stacks:fill` markers pass through to the
  project. Markers are processed inside code fences too (1.1), so a fenced example of one
  is indented.
- **`merge`** lists each JSON output this entry shares with other writers (hook lists in
  `.claude/settings.json`, for instance); arrays concatenate (1.1).
- **Decisions** state their default. 1.1 prefixes a fragment's decisions with its id, so
  the text doesn't repeat it.

### Entry content rules

Beyond what `validate` checks:

- No versions anywhere, Gotchas included. Something only true of today's release is
  rewritten as the durable rule, a discovery step ("read the installed package's exports
  before writing imports"), or a verify step that asks the tool. If it has none of those
  forms it stays out; the building agent records it in the project's Build workarounds.
  `deps` holds package names only.
- Setup is a numbered procedure. Generators run non-interactively into a named
  subdirectory or a temp dir, never into the populated root. Flags are not named.
- Tool configuration is intent ("strict mode, no implicit any, unchecked index access"),
  never a pasted config file.
- `files/` holds only what is the same across versions: `.gitignore`, `.editorconfig`, an
  AGENTS.md skeleton with `stacks:fill` markers, a Makefile or scripts skeleton that
  calls tools by name, agent hooks. Every shipped source file passes the stack's own lint
  and format rules as shipped; a run that fails `lint` on files the agent didn't write is
  a stack bug.
- Each stack names its proving slice in Setup: the smallest piece that exercises every
  layer. The agent knows where the stack ends, and the bench run checks the slice by hand.

### The `agent-ops` fragment

This sub-phase writes `agent-ops`'s `FRAGMENT.md`, its `AGENTS.md` skeleton in `files/`
(with `stacks:fill` markers for overview, commands, layout, conventions, testing and
Build workarounds), and its verify steps. The Claude Code guardrails it ships under
`adapters/claude/` (hooks, `.claude/settings.json`, `.claude/README.md`) are
[1.6d](phase-1.6d-guardrail-hook-fragments-2026-10-30.md)'s, which also owns the body paragraph
about them.

Verify steps the fragment adds, both `phase: check`, `layer: docs`: `agents-md`, whose
`run` fails while `AGENTS.md` is missing, empty or still holds a `stacks:fill`
marker (`test -s AGENTS.md && ! grep -q 'stacks:fill' AGENTS.md`), and `readme`, the
same over `README.md` (each stack ships the README skeleton). They make "AGENTS.md and
the README describe the real project" part of done rather than a request in the brief.
If 1.3a later adds a built-in `filled` check, these two steps can move to it.

Budget (D5): the fragment's body stays near 300 words, including 1.6d's paragraph on the
hooks.

### Sizes are measured, not targeted

D13's word targets are now measurements to record (D13 as amended). For each stack, 1.5's
`validate` reports `briefWords` and `fixedWords` in the `default` and `sandbox` presets,
rendered with 1.5's canonical context (roadmap, Contracts: Word count); a stack that
offers an app is measured with it as well. The change description carries the full table.

Each size must be under 1.5's caps. For a brief that isn't:

- Cut prose first. Write what the stack needs, then measure; never pad toward a number.
- If a stack still can't fit, move a default fragment to optional and record why next to
  D13; the composed size it lands at is a D5 data point.
- A brief with an app is the known pressure point: 1.1 measured its realistic fixture at
  about 6,000 words with the app, almost all of it entry prose. D5 as amended gives a
  composition with an app 9,000 words, and 1.5's `validate` passes that fixture; an app
  brief over 9,000 is cut like any other.

### Dotfiles and packing

Dotfiles are literal in `files/` and `adapters/`. npm leaves some dotfiles out of a
package (`.gitignore` among them); how the package keeps them is 0.2's (1.0, "What this
plan may get wrong"). The guard here is a packing test: the files under
`package/registry/` in the packed tarball (packed the way 0.2 packs) are exactly the files
under `packages/cli/registry/`, path for path. An e2e test then runs `new <gate stack>
<tmp> --sandbox --no-launch --json` from the installed tarball and checks that
`<tmp>/.gitignore` exists with the shipped content. Until 0.2 lands nothing is packed, and
the tarball tests wait with it.

### Failure modes

| Case | What happens |
|---|---|
| A stack is over its cap in either preset | Cut prose; if it still doesn't fit, a default fragment becomes optional and D13 records why |
| A brief with an app is over its 9,000-word cap | Cut prose, as for any other brief; record the size, since it is a D5 data point |
| An entry needs a check v1 doesn't have | Write it as a command; note the case under 1.3a's built-in-checks item |
| A shipped file fails the stack's own lint | Fix the file; it is a stack bug |
| Git ignores a file under `packages/cli/registry/` | The fixture guard fails; fix the entry's `.gitignore` pattern or the file name |
| The tarball file list differs from the tree | Fix the package `files` field or 0.2's packing; never accept the difference |

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/stacks/<id>/` | `STACK.md`, `files/`, `adapters/claude/`, for every catalog stack |
| `packages/cli/registry/fragments/<id>/` | `FRAGMENT.md`, `files/`, `adapters/claude/`, for every catalog fragment (for `agent-ops`, everything except the guardrail files 1.6d owns) |
| `packages/cli/tests/registry.test.ts` | Composition tests below; the git-ignore guard now covers the catalog |
| `packages/cli/e2e/registry-pack.test.ts` | Tarball file list and the `.gitignore` round trip |
| `packages/cli/tsconfig.registry.json`, `package.json` (`typecheck`) | `tsc --noEmit` over shipped `.ts` under `registry/` |
| `packages/cli/README.md`, repo `README.md` | The core loop, the stack table, `--sandbox` |

## Acceptance tests

1. `validate` on `packages/cli/registry`: zero errors, zero warnings (1.5's
   `tests/bundled-registry.test.ts`, now with content).
2. `tests/registry.test.ts`, for each stack and preset: `new --no-launch --json` into a temp
   dir succeeds; `briefWords` is under 1.5's cap; the manifest has every D7 layer; and no
   command was run (PATH holds only a recording shim for `git`, which `new` may call). No
   rendered file contains `{{`.
3. For each app, the same with `--with <app>`, and the manifest's app steps carry the `app`
   tag.
4. The git-ignore guard in `tests/registry.test.ts` passes, and its file count covers the
   catalog, so the guard is known to have run over it.

Checked by the gate rather than by a tagged test:

- Shipped files lint clean: Biome over every shipped `.ts` and `.json` under the
  registry, through the package's `lint` (confirm the root Biome includes reach the
  registry path, and that dotfiles get the right parser). Biome doesn't lint Markdown, and
  no Markdown linter is added: shipped `.md` is checked by 1.5's `validate` (markers,
  budget rows) and by the "no rendered file contains `{{`" assertion.
- Shipped TypeScript typechecks: the package `typecheck` script also runs `tsc --noEmit
  -p tsconfig.registry.json`, strict, over every shipped `.ts` under `registry/`.
- `e2e/registry-pack.test.ts` (once 0.2 packs): the packed tarball's `registry/` file
  list equals the tree's; the installed package lists every catalog stack; `new <gate
  stack> --sandbox --no-launch` writes `.gitignore` with the shipped content.

## Exit criteria

- `bun run check` green from the repo root.
- `validate` over the bundled registry: zero errors, zero warnings, with the size rows
  for every stack and preset (and each stack with its app) pasted into the change
  description.
- D13 in [requirements.md](../../requirements.md#proposed-decisions) records the gate
  stacks' measured sizes.

## What this plan may get wrong

- `fixedWords` is measured, not assumed. If it comes in well above 1.1's measurement, the
  near-cap gate stack has less room for prose.
- Writing a brief toward a word target risks padding. The rule is the reverse: write what
  the stack needs, then check the size.
- A stack-specific default fragment has to hold its `applies_to`, or 3.0's `add` will
  offer it to projects it doesn't fit.
- npm's dotfile handling can change; the tarball test, not a rule, is what keeps the
  shipped tree honest.
- 2026-10-26: this plan first wrote three new stacks to D13's word targets (about 3,000
  and about 4,800 words, enforced as bounds in a test), with a stack-specific
  `api-client` default fragment to reach the larger target, dotfiles stored under a
  `_dot_` escape, and `agent-ops` steps written as `check: { filled }`. The amended D18
  and D13 replaced all of that: the plan now brings the whole bundled catalog into v1,
  sizes are measurements rather than targets (the spread test is gone), `api-client`
  isn't in the catalog, dotfiles are literal with packing moved to 0.2, and the
  `agent-ops` steps are shell commands because v1 has no built-in checks. The catalog is
  much larger than three stacks, so writing it is bigger work than this plan's original
  shape, and the bench proofs it unlocks are spread over 3.3a, 3.3b, 3.3c, 3.4a and 3.5b.
- 2026-10-26, on execution:
  - `new` has no `--no-launch` yet (1.4 adds the handoff in parallel). The composition
    tests run `new <stack> app --json` with PATH holding only the recording `git` shim, so
    no agent can be found or launched; add `--no-launch` to `newFromCatalog` in
    `tests/registry.test.ts` when 1.4 lands.
  - The `agent-ops` steps are `agents-md-filled` and `claude-readme-filled` with
    `layer: check`, not `agents-md` and `readme` with `layer: docs`: the roadmap's "Verify
    step `layer`" row defines `check` for file and config checks, and each stack ships its
    own `readme-filled` step (also `check`).
  - The layer enum has no slot for service setup and teardown. Steps that start, migrate or
    stop a local database (`postgres`, `cloudflare-d1`, `mobile-expo`'s `db-*`) use
    `install`; contract checks (`check-api`, `bindings-check`, `db:check`, `expo:check`,
    `release-check`) use `check`; `tauri-react`'s crate-edge check uses `lint`.
  - D7 needed two stack changes: `astro-blog` had no lint step, so it gains a `make lint`
    target (`prettier --check`) and step, and `make check` (astro check) carries
    `typecheck`; `go-cli` had no typecheck step, so it gains `make vet` (`go vet ./...`,
    which type-checks test files too) as `typecheck`.
  - `mobile-expo` with `rr` was 6,115 words once `agent-ops`' and `ci-github`'s stack and
    monorepo blocks were restored. Prose cuts (a lefthook gotcha `git-hooks` already
    covers, the NativeWind gotcha folded into Setup, Commands text the commands map
    repeats) bring it to 5,984, 16 words under the cap: any growth in `agent-ops` (1.6d's
    hooks paragraph) or `rr` pushes it over, and the next cut belongs in `mobile-expo`.
  - Shipped TypeScript typechecks with no added dependency: `tsconfig.registry.json` uses
    `rootDirs` over each entry's `adapters/claude` so a stack's hooks resolve
    `claude-harness`'s `_lib.ts` as they do in a project, and lists `.claude/hooks/*.ts`
    explicitly because `tsc` globs skip dot-directories. Every shipped `.ts` (43 files)
    imports only node, bun, vitest and effect packages this repo installs; source that
    targets Astro, React Router, Expo or Tauri ships as prose or `.tmpl`, which neither
    `tsc` nor Biome reads. `.tmpl` output is checked only by the composition tests.
  - Biome lints shipped `.ts` and `.json` through the package `lint`. `mobile-expo`'s own
    rules use single quotes, so `packages/cli/biome.json` overrides the quote style for
    that stack instead of reformatting its shipped file against its own convention.
  - Entry content rules beyond what `validate` checks (no versions, setup as a numbered
    procedure) were not re-audited across the imported entries; a few version mentions
    remain (for example "Tauri 2" in `tauri-react`'s description). That audit belongs with
    each entry's bench proof (1.6b, 3.3a to 3.5b).
  - The tarball tests (`e2e/registry-pack.test.ts`) wait for 0.2, which packs nothing yet.
