# Contract: acceptance tests for {TITLE}

<!-- Template for the test-author unit that comes first in a test-first feature
(rules/cli/testing.md "Process and gate"). Copy into the scratchpad, fill every {PLACEHOLDER},
delete this comment, then run scripts/delegate.sh <filled-contract.md> --write --worktree <worktree> -->

## Goal

Write the failing acceptance tests for the design below (every acceptance behavior it lists,
plus the realistic edge cases you add). The implementer then builds {WHAT} against them. {Any
premise that changed since the design was written, and any listed item that isn't a CLI test (a
bench proof, a maintainer step) and where it goes instead.}

## Design

{The design or task description: quote it, or give the design file's path and the sections
that hold its acceptance behaviors.}

## Interface (from the design; check against the code)

{The modules, exports, schema fields, flags and error tags the design names, so the tests import
from the right paths. Point at the existing tests and fixtures whose patterns to follow.}

## Scope

- May change: `packages/cli/tests/` (new test files and fixtures), and `packages/cli/e2e/` only
  for what needs the compiled binary.
- Must not change: anything under `packages/cli/src/`, existing tests, the design.
- Locked: none.

## Read first

- `AGENTS.md` (already loaded): "Conventions", "Testing", "Error handling".
- `.claude/rules/typescript.md` and `.claude/rules/architecture.md`.
- `.claude/rules/cli/cli.md`, `.claude/rules/cli/effect.md`, `.claude/rules/cli/testing.md`
  (especially "Process and gate" and "Realistic edge cases").
- Existing tests whose patterns to follow: `packages/cli/tests/helpers/cli.ts` (`runCli`),
  `packages/cli/tests/new.test.ts`, `packages/cli/tests/verify.test.ts`,
  `packages/cli/tests/fixtures/`.

## Skills to apply

The `ce` skills and agents come from the Claude Code `claude-essentials` marketplace. Find the
newest installed copy with:

```bash
ce=$(ls -d "$HOME"/.claude/plugins/cache/*/ce/*/ | sort -V | tail -1)
```

Read each skill and apply it to this task; your hand-off says where it changed what you did.

- `${ce}skills/writing-tests/SKILL.md`: for every test you write. Where it and
  `.claude/rules/cli/testing.md` differ, the rule wins.
- `${ce}skills/architecting-systems/SKILL.md`, with its `references/structure.md`,
  `coupling.md` and `boundaries.md`: before deciding the shape of an interface the tests call.
  `.claude/rules/architecture.md` adds this repo's constraints on top.
- `${ce}skills/effect/SKILL.md` (Codex also lists it as `ce:effect`), with its
  `references/testing.md`: for Effect test mechanics (`it.effect`, TestClock, `Exit`). The rule
  files above win where they differ.

## Your role: test author

You are the test author for this feature, a different agent from the implementer. You write
the design's acceptance tests and its realistic edge cases as failing tests. You write no
implementation code. The implementer will make your tests pass without editing their
assertions, so each test must:

- assert behaviour through the real interfaces (`runCli`, real NodeServices, real temp dirs,
  real `git init`), with no module mocks;
- import the new symbols from the module paths the design names, so the tests fail now only
  because the code doesn't exist yet (a missing export or a wrong result), never because of
  a typo or a broken fixture;
- be named after the behavior it checks;
- be specific enough that a wrong implementation fails it, and loose enough that it doesn't
  pin internal structure the design leaves open;
- be deterministic. An interruption test first makes the program block at the step it
  interrupts (a git or tool shim on `PATH` that hangs after touching a marker file, as
  `tests/new.test.ts` does for `git init`, or a writer-level program that ends in
  `Effect.never`, as `tests/scaffold-write.test.ts` does), then aborts. Never race an abort
  against a command that can finish first (an `fs.watch` callback, a timer).
- match formats the code already has (ids, digests such as `sha256:<hex>`, paths): read the
  producing function rather than guessing a shape.

Known traps, each of which has cost a run in this repo:

- Comparing compiled binaries or other large files as buffers: Vitest's diff on a mismatch
  stalls the run. Compare sha256 digests.
- Compiling the binary per test: a compile takes about 20 s. Compile once per file in
  `beforeAll`, or use the e2e suite, which compiles once.
- Temp paths without `realpathSync`: on macOS `/var` is `/private/var`, so a path the CLI prints
  won't equal the one the test built. Resolve the temp dir first.
- Tests that need more than Vitest's default timeout: a test that runs the whole registry or a
  matrix states its budget with a reason, and a cheaper fixture beats a longer timeout.
- Racing an abort or signal against a command that can finish first; see "be deterministic"
  above.

Steps:

1. Read the design. Check each acceptance item against the current code; where the design is
   wrong about the code (a symbol renamed, a field already present), write the test to the
   design's intent and list the discrepancy in your hand-off.
2. Pick the cases from `.claude/rules/cli/testing.md` "Realistic edge cases" that apply to this
   feature (only those that apply) and list them in your hand-off, one line each.
3. Write the tests, including one per edge case.
4. Run them and confirm each fails for the expected reason (missing module or export, or wrong
   behaviour), not a test bug. Typecheck failures from imports of not-yet-existing modules are
   expected; anything else in `bun run typecheck` or `bun run lint` must be clean in your files.

## Do not

- commit or push (leave the changes for review)
- write implementation code under `packages/cli/src/` (fixtures under `packages/cli/tests/fixtures/`
  are fine)
- disable a lint rule, add a cast or `@ts-expect-error` to silence a missing import
- edit any existing test

## Review before hand-off

Once your tests are written and fail for the right reasons, get one independent code review and
fix what it finds. The reviewer is this repo's `code-reviewer` agent,
`.claude/agents/code-reviewer.md`, which extends the `ce:code-reviewer` agent
(`${ce}agents/code-reviewer.md`); both bodies go into the prompt, the repo's last so it wins.

Run it as a fresh Codex process, read-only, with its report going to a file outside the worktree:

```bash
review="$(mktemp -d)"
body() { awk 'NR==1&&/^---$/{f=1;next} f&&/^---$/{f=0;next} !f' "$1"; }  # without frontmatter
{
  body "${ce}agents/code-reviewer.md"
  echo
  body .claude/agents/code-reviewer.md
  echo
  echo "Skills: ${ce}skills/writing-tests/SKILL.md, ${ce}skills/architecting-systems/SKILL.md."
  echo "The base branch is {BASE BRANCH}; review the uncommitted work in $PWD. These are"
  echo "failing acceptance tests written ahead of the code; review them as tests: do they"
  echo "assert the design's behaviour, would a wrong implementation pass them, are they flaky or"
  echo "coupled to internals. Your sandbox is read-only, so don't run Vitest. The task's contract:"
  cat "{THIS CONTRACT'S PATH}"
} > "$review/prompt.md"
codex exec --ephemeral --sandbox read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' \
  -c 'service_tier="priority"' -o "$review/review.md" - < "$review/prompt.md"
```

Fix every finding in `review.md`, or say in the hand-off why a finding is wrong. One review pass
only.

## Hand-off

Leave everything uncommitted and end with this report as your final message:

1. Summary: what you wrote, in two or three sentences.
2. Files: each file created or changed, with one line on why.
3. Interface the tests assume: every new export, its module path and signature, every new
   field and flag, so the implementer's contract can name them.
4. Edge cases: the realistic edge cases you chose, one line each, and the test that covers each.
5. Decisions: choices the design left open, design claims that didn't match the code. Name every
   new mechanism you added (a cache, a parser, a module, a fallback path) and the acceptance test
   or contract line that needed it.
6. Checks: each command you ran and its result, with each new test's failure reason.
7. Review: the review file's path, each finding in a line, and how you resolved it.
8. Look closer at: the tests you're least sure of.
9. Open: questions for the maintainers.
