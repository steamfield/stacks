# Phase 3.4a: Agent harness fragment

Status: EXECUTED 2026-10-27 (the TypeScript destructive guard, the shell guard's delegation,
the `harness-hooks` step; the repo's own `.claude/hooks/` lexer and the shipped one are now
one file, kept identical by `tests/hooks/harness-sync.test.ts`). Unproved: the bench
comparison against the shell guardrails, which is the maintainers'. Drafted 2026-10-26.
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | An optional `agent-harness-ts` fragment gives TypeScript projects a stronger Claude Code harness than 1.6d's shell guardrails: hooks run by Bun from TypeScript, a destructive-command guard built on a real shell lexer, a generated-file guard, typecheck-on-write, `/check`, `/test` and `/feature` commands, architect and reviewer agents and a harness doc, with its own hook test suite and a bench comparison against the shell guardrails |
| Traces to | Job 1: "with tests, lint, CI and agent config"; the trust paragraph in Jobs: the agent must not be able to quietly weaken the project; the success row "The result is complete" |
| Depends on | [1.6a](phase-1.6a-bundled-stack-content-2026-10-30.md) (the `agent-ops` fragment), [1.6d](phase-1.6d-guardrail-hook-fragments-2026-10-30.md) (its guardrail hooks, which this one extends), [2.0b](phase-2.0b-bench-2026-10-30.md) (bench runs and `hooksFired`), [2.0c](phase-2.0c-run-ledger-2026-10-30.md) (the ledger the comparison reads), [2.2](phase-2.2-deterministic-rot-checks-2026-10-30.md) (`ref-hook` and `import-closure` checks on the shipped hook code) |
| Blocks | Nothing. [3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md) ports the guardrails, not this harness |
| Decisions needed | None new. D5 (the fragment body is at most 1,000 words; most of the content is files, not prose) and D7 |
| Settles | What the TypeScript harness ships; how it composes with `agent-ops` without double-wiring hooks; how its hooks are tested; whether it beats the shell guardrails in bench runs |

## Scope

In:

- A fragment `agent-harness-ts` (`category: agent-ops`, `applies_to` tags `node`, `bun`, `requires: [agent-ops]`, `requires_tools: [bun]`), optional on every TypeScript stack.
- Shipped under `adapters/claude/`:

| Piece | Behavior |
|---|---|
| Hook runtime | One `bun` entry that dispatches hook events to TypeScript handlers; a handler that throws fails open with a logged reason, except the guards, which fail closed |
| Destructive-command guard | Tokenizes the command with a shell lexer (quotes, escapes, `&&`, `;`, pipes, subshells, `env` and `sudo` prefixes) and blocks recursive deletes outside the project, force pushes to the default branch, `git reset --hard` on a dirty tree, history rewrites and disk-level commands; replaces `agent-ops`'s pattern-list guard when both are present |
| Generated-file guard | Refuses writes to files the project marks generated (a header marker or a listed path), with the regenerate command in the message |
| Typecheck-on-write | Runs the project's typecheck command on the changed file's project after a write and returns diagnostics to the agent as context |
| Commands | `/check` (the project's gate), `/test` (one file or all), `/feature` (plan, failing test, implement, gate) |
| Agents | `architect` (read-only design review) and `reviewer` (read-only diff review) definitions |
| Harness doc | `.claude/README.md` section describing each hook and how to disable one |

- A hook test suite shipped with the fragment and run by its own verify step (`layer: test`).
- A bench comparison against `agent-ops` alone.

Out:

- Native versions for other agents ([3.4b](phase-3.4b-native-agent-adapters-2026-10-30.md) ports `agent-ops`, which is the default; this fragment stays Claude Code only until a second agent's hook format can express the same guards).
- Non-TypeScript stacks. The shell guardrails cover them.
- Any change to the CLI. This is content.

## Design

### Where this fits

The `agent-ops` fragment (1.6a, with its hooks from 1.6d) ships the shell guardrails every stack gets: a session-start hook, a destructive-command block from a pattern list, secret-shaped write detection, lint-on-write and format-on-stop. Pattern lists miss quoted and chained commands, and shell hooks can't typecheck. A TypeScript project already has Bun or Node on hand, so it can afford a real lexer and a typecheck hook. This fragment is optional because it adds a toolchain dependency to the harness itself.

### Composing with `agent-ops`

Both fragments write `.claude/settings.json`, which is in both `merge` lists (1.1's deep merge), and a deep merge of two guard entries would wire two guards. Conditional markers apply to prose, not JSON, and shipping the same hook path from both fragments is a file-ownership conflict under 1.1's single-ownership rule. So the split is:

- `agent-ops` keeps ownership of `.claude/hooks/guard-destructive.sh` and its settings entry.
- This fragment's guard is `.claude/hooks/ts/guard.ts`, and `guard-destructive.sh` checks for `.claude/hooks/ts/guard.ts` at run time and delegates to it through Bun when present.

That keeps one settings entry, one owner per file, and a project where removing the harness directory falls back to the shell guard. The hook test suite asserts the wiring appears exactly once after the merge.

### Hook tests

The suite (`.claude/hooks/ts/*.test.ts`, run with `bun test` from the fragment's verify step) covers:

- The lexer: quoted arguments, escaped spaces, `&&`/`;`/`|` chains, `$(...)` and backticks, `env X=1` and `sudo` prefixes, heredocs. Each blocked command class has a positive and a quoted-false-positive case (`echo "rm -rf /"` is allowed).
- Fail-closed guards: a guard handler that throws blocks the call.
- The generated-file guard with a header marker and with a listed path.
- Typecheck-on-write returning diagnostics as context and not blocking.
- The settings merge with `agent-ops`: the guard entry appears once.

`validate` (2.2's `import-closure` and `ref-hook`) checks that every hook command in the merged settings names a composed file and every import resolves inside the fragment or `agent-ops`.

### Bench comparison

Two bench runs of the same stack (`astro-blog` is the TypeScript-capable small stack) with `--with agent-harness-ts` and without, same agent, same commit apart from the fragment. The run notes compare time to green, verify count, `## Asked` count, `hooksFired` (2.0b), and any blocked command the agent hit. The fragment lands if its run is `pass`; the comparison is evidence for whether it should become a default, not a gate.

## Files and areas touched

| Path | Change |
|---|---|
| `packages/cli/registry/fragments/agent-harness-ts/` | `FRAGMENT.md`, `adapters/claude/` (hooks, commands, agents, settings), `files/` for the harness doc section |
| `packages/cli/registry/fragments/agent-ops/adapters/claude/` | `guard-destructive.sh` delegates to the TypeScript guard when present |
| `packages/cli/tests/registry.test.ts` | Composition with and without the harness |
| `packages/cli/registry/runs.json`, `plans/runs/` | Two bench records and notes |

## Acceptance tests

1. `new astro-blog --with claude-harness --no-launch --json`: composes, the merged `.claude/settings.json` wires the destructive guard only through its shell entry (no additional direct TypeScript guard hook), non-merged files have one owner, and `validate` checks the `astro-blog + claude-harness` composition in both presets with zero errors and warnings.
2. The shipped hook suite passes when run from one scaffolded project in the e2e layer, using its existing Vitest runner on Node, and the manifest includes a harness-owned verify step with `layer: check` that passes for the shipped suite and fails verification when a copied shipped test is made to fail. QA-09: the command conditionally succeeds without running tests when the directory is absent, so it must not establish the test-command milestone.
3. `block-destructive.sh` from `agent-ops` alone blocks its patterns; with the harness present it delegates and blocks the TypeScript guard's lexer cases, including a quoted command the pattern list misses; both allow `echo "rm -rf /"`.
4. `--with claude-harness` on `go-cli`, whose tags its `applies_to` excludes, keeps the fragment with exactly one `with_not_applicable` warning, and `validate`'s per-fragment compositions don't pair it with that stack.

### Realistic edge cases

5. Delegation works through a symlinked project path containing spaces and non-ASCII characters when the hook's cwd is an unrelated directory.
6. In a real repository with uncommitted work, both the delegated shell guard and the TypeScript guard block a quoted `git reset --hard` command without changing the work; a quoted example remains allowed.
7. Removing only the harness's hook files from an existing composed hook directory restores the shell guard's pattern blocking and allowed near miss.

## Exit criteria

- Acceptance tests pass; `bun run check` green from the repo root.
- Maintainer-owned real-run proof (2026-10-27): both bench runs are in the ledger, the harness run is `pass`, and its `hooksFired` names the guard and typecheck hooks. Write the comparison note with a one-line recommendation on making the fragment a default for TypeScript stacks; automated acceptance tracing does not cover this proof.

## What this plan may get wrong

- Delegating from the shell guard couples the two fragments at run time. If that proves brittle, the alternative is a format feature (a fragment replacing another's file), which is a D18 change.
- A lexer-based guard is still a guard against accidents, not an adversary; an agent with full permissions can write its own script and run that. The harness doc says so.
- Typecheck-on-write can be slow on large projects and annoy more than help. The hook has a time limit and skips when exceeded, logging that it did.
- 2026-10-26: the fragment's frontmatter was written camelCase and a `--with` that doesn't fit was expected to fail `ComposeConflict`. The amended D18 uses snake_case keys (`applies_to`, `requires_tools`), and 1.1 keeps an explicit `--with` that doesn't fit, with a warning; the test now checks the warning.

- 2026-10-27: the existing fragment is `claude-harness`, not `agent-harness-ts`; keep that id. It is
  already required by `typescript-cli` (whose guards import its helpers), not optional on every
  TypeScript stack, and is not listed as optional by `astro-blog`. Its frontmatter uses `applies_to:
  [bun]` rather than `[node, bun]`, and `tools: [bun]` rather than `requires_tools`. Hooks are
  separate Bun TypeScript entry points under `adapters/claude/.claude/hooks/` (`_lib.ts`,
  `_shell.ts`, `guard-commands.ts`, `guard-generated.ts`, `typecheck-on-write.ts`), not one
  dispatcher or a `hooks/ts/` directory. `guard-commands.ts` currently guards package managers, not
  destructive commands; `agent-ops` owns `block-destructive.sh` and `_destructive-patterns.sh`, with
  no TypeScript delegation today. Acceptance tests use `guard-commands.ts` as the TypeScript guard's
  existing entry point; its current separate settings entry must be removed when the shell delegates
  to it, to avoid running the same guard twice. Both hook libraries deny with exit 0 and one JSON
  `hookSpecificOutput.permissionDecision: "deny"` on stdout, not exit 2/stderr. The generated-file
  guard currently recognizes listed output paths, not header markers; typecheck-on-write calls tsc
  rather than a project script, and advisory timeouts stay quiet. All three commands and both agents
  already ship. The harness doc is `adapters/claude/docs/harness.md`, with prose asking the agent to
  fill `.claude/README.md`. The shipped suite lives in `adapters/claude/tests/hooks/` and imports
  Vitest; Node runs it, not `bun test`. The fragment has only a documentation verify check today,
  with no test-layer verify step. JSON settings deliberately merge owners; other files have one
  owner. File ownership is exposed by `compose`'s planned files, not the manifest, which records
  entry references and verify-step owners only. Acceptance tests use the existing composition
  interface for file ownership and the manifest for the hook-test step owner. The plan's lexer case
  is recorded as `printf ok && r"m" -rf /`, which the current shell pattern list allows. The e2e
  fixture excludes the unrelated `git-hooks` fragment and supplies installed tooling, conventional
  test script aliases and an offline Makefile install target, because `verify --only` also runs setup
  and the bare scaffold has no agent-generated Makefile. Real bench proof belongs to the maintainers and is outside the traced
  numbers.

- 2026-10-27 implementation: the existing standalone hooks and Node/Vitest suite are retained.
  `block-destructive.sh` delegates from its own directory and remains the sole settings entry;
  removing the TypeScript guard or Bun restores the pattern list. `harness-hooks` skips only when
  the Claude guard is absent (no Claude adapter), otherwise runs the shipped Vitest suite on Node.
  Recursive deletion checks resolve existing symlink ancestors in filesystem order before `..`,
  and deny unresolved expansions and xargs operands; hard resets probe the selected
  repository, denying when dirty or unreadable. History rewriting is guarded conservatively:
  force pushes on any branch, including leases, rebase, filter-branch/filter-repo and reflog
  expiry/deletion require confirmation rather than discovering a remote's default branch.
  The delegated guard covers the plan's classes; the shell fallback's broader pattern list
  (SQL, releases, containers and similar operations) is not carried into the TypeScript guard.

- Independent review found raw macOS `rdisk` targets, operand-free xargs deletes, shell
  brace/glob expansion and symlink-parent traversal gaps. Shipped regressions reproduce all
  four through the wired shell entry and fail again with the fixes reverted. `_shell.ts` now
  carries per-word expansion metadata so quoted/escaped literal filenames remain allowed.
