# Contract: {TITLE}

<!-- Template. Copy into the scratchpad, fill every {PLACEHOLDER}, delete this comment and the
sections that don't apply, then run scripts/delegate.sh <filled-contract.md> --write --worktree <worktree> -->

## Goal

{One paragraph: the behaviour to add or change and why. Quote the design or task description it
implements, or give the design file's path and section, if there is one.}

## Read first

- `AGENTS.md` (already loaded): "Conventions", "Testing", "Error handling".
- `.claude/rules/typescript.md` and `.claude/rules/architecture.md`.
- For `packages/cli`: `.claude/rules/cli/cli.md`, `.claude/rules/cli/effect.md` and
  `.claude/rules/cli/testing.md`.
- {The design section, and the existing files whose patterns to follow.}

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
  `coupling.md` and `boundaries.md`: before adding or changing a module, service, schema or
  contract. `.claude/rules/architecture.md` adds this repo's constraints on top.
- `${ce}skills/effect/SKILL.md` (Codex also lists it as `ce:effect`) and the references it routes
  to: for any Effect code. `.claude/rules/cli/effect.md` is this CLI's policy on top.

## Interface

{Signatures, types, schema names, error tags, file paths. Cite shared contracts by their symbol
(exported from `packages/format/src/index.ts`; error tags in `packages/cli/src/errors.ts`);
never rename or redefine one.}

## Scope

- May change: {files or directories}.
- Must not change: {files, public contracts, anything else}. Edit no file outside the scope; if
  the task can't be done inside it, stop and say why.
- Locked: {test files another delegate wrote, or none}. Make them pass without editing them. If
  one looks wrong, leave it and say why in the hand-off.

## Acceptance

{The tests that must exist and pass, as behaviours. A bug fix starts with a failing regression
test. Copy these when they apply:}

{- Performance: first measure at the target size and hand back the time per phase, before any
  optimization, unless the contract already names the hot path.}
{- A cache, cursor or incremental pass: list in the hand-off every table, setting and file the
  computation reads, with a test that changing each one invalidates the result.}

Iterate on the scoped tests, lint and typecheck until they pass, from the worktree root:

```bash
{e.g. bun run --cwd packages/cli test:unit tests/<file>.test.ts}
bun run lint
bun run typecheck
```

Don't run the full gate (`rr check`, `bun run check`) or a whole suite: Claude runs the gate
once on your work after its refactor, so a run here would be repeated, and it holds a shared
test host other agents are waiting on. Scoped tests, lint and typecheck are your checks; name in
the hand-off any test file outside your scope that your change could affect.

Then QA it as its first user, before the review. Build (`bun run build`) and run each command
you changed on `node packages/cli/dist/stacks`, in all three audiences (`--json`, a plain run,
and human mode as `.claude/rules/cli/cli.md` "Verifying UX" shows), on success and on the
realistic failures. Judge it as the agent that will depend on it: could you take the next step
from the output alone, is any line noise, is anything slow, surprising or missing? Fix the
friction you find (a bug gets a regression test first) and rerun the checks. For work with no
command to run (a refactor, the harness), say so and QA what does run.

## Do not

- commit or push (leave the changes for review)
- disable a lint rule, weaken a test or add a cast to get green; a function over Biome's
  complexity limit gets split into named steps (AGENTS.md "Code structure")
- add features, options, abstractions or mechanisms the goal and acceptance tests don't need: no
  cache, re-parse, second code path or new module where the existing one can carry the change
- mention any repository outside this one in a tracked file; a reference repo named in "Read
  first" is for you only

## Review before hand-off

Once the acceptance checks pass, get one independent code review and fix what it finds, so the
work comes back clean. The reviewer is the repo's reviewer agent file (here
`.claude/agents/code-reviewer.md`; use the target repo's own file in the commands below), which extends the `ce:code-reviewer` agent
(`${ce}agents/code-reviewer.md`); both bodies go into the prompt, the repo's last so it wins.

Run it as a fresh Codex process, so it doesn't share your context, read-only, with its report
going to a file outside the worktree:

```bash
review="$(mktemp -d)"
body() { awk 'NR==1&&/^---$/{f=1;next} f&&/^---$/{f=0;next} !f' "$1"; }  # without frontmatter
{
  body "${ce}agents/code-reviewer.md"
  echo
  body .claude/agents/code-reviewer.md
  echo
  echo "Skills: ${ce}skills/architecting-systems/SKILL.md, ${ce}skills/writing-tests/SKILL.md,"
  echo "${ce}skills/handling-errors/SKILL.md. The base branch is {BASE BRANCH}; review the"
  echo "uncommitted work in $PWD. Your sandbox is read-only, so don't run Vitest; the author"
  echo "already ran the checks. The task's contract:"
  cat "{THIS CONTRACT'S PATH}"
} > "$review/prompt.md"
codex exec --ephemeral --sandbox read-only -m gpt-6-sol -c 'model_reasoning_effort="high"' \
  -c 'service_tier="priority"' -o "$review/review.md" - < "$review/prompt.md"
```

Fix every finding in `review.md` (its list has no optional tier), or say in the hand-off why a
finding is wrong. A finding about a locked file is a note for the orchestrator, not an edit. A
finding that is a bug gets a regression test in the repo before its fix (a new test file when the
natural one is locked), revert-verified; a probe in a temp script doesn't count. Then rerun the
acceptance checks. One review pass only: don't review again
after the fixes.

## Hand-off

You're done when the review's findings are resolved and the acceptance checks pass, or when
you're blocked. Leave everything uncommitted and end with this report as your final message;
the orchestrator works from it, so be specific and name files and symbols.

1. Summary: what you built, in two or three sentences.
2. Files: each file created or changed, with one line on why.
3. Decisions: choices the contract left open and why you made them; any deviation from the
   design or contract and the reason; where the skills changed your approach. Name every new
   mechanism you added (a cache, a parser, a module, a fallback path) and the acceptance test or
   contract line that needed it.
4. Checks: each command you ran and its result (test counts, not just "passed"), and the QA:
   the commands you ran, what you judged and what you changed.
5. Review: the review file's path, each finding in a line, and how you resolved it (fixed,
   or why not).
6. Look closer at: the places most likely to be wrong, such as assumptions you couldn't verify,
   edge cases you didn't cover, code you're least sure of, tests that are weaker than you'd
   like, and anything in the design that looked wrong.
7. Open: what's left undone or blocked, and the questions you'd ask.
