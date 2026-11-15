# core/add

This folder carries out `stacks add <fragment...>`: it applies fragments to a project that already
exists without changing any file the project already has.

A fragment is a reusable addition (CI, git hooks, a database) that composes onto a stack. `stacks
new` builds a project from a stack and its default fragments; `stacks add` brings in more later,
including into a project stacks never created. Because the project is live, the rule here is
strict: a file that is already there is never overwritten. When a fragment ships a file that
differs from the user's copy, the new version is parked under `.stacks/incoming/` and the brief
asks the coding agent to merge it by hand.

## How it fits

`commands/add.ts` parses the flags and calls `core/add.ts::add`, which runs the steps in this
folder in order and returns the result, the handoff decision and the new manifest to the command
for printing and handoff. `core/add.ts` also re-exports `planAdd`, `checkAddRoot` and the
`AddPlan` type from `plan.ts`.

The folder leans on its neighbors rather than duplicating them:

- `core/compose/` composes the fragments in add mode and renders their files.
- `core/scaffold/write.ts::openProject` is the writer, with the same rollback `new` gets.
- `core/scaffold/git.ts` and `core/scaffold/values.ts` supply the git lookups and template values.
- `core/verify/tamper.ts::checkTamper` checks the existing manifest before anything else happens.
- `core/brief/render.ts` writes the brief, including the merge list.
- `core/project-state.ts` updates the state record.

`core/validate/add-compositions.ts` reuses `manifest.ts::mergeAddManifest` to budget add-mode
briefs. The `core/` boundary rules apply (AGENTS.md, "Conventions"): no imports from `platform/`
or `commands/`, and no Node builtins. Project files such as `package.json` are read as data only;
nothing from the project or an entry runs (Trust model point 1 in
`.claude/rules/architecture.md`).

## The main flow

`core/add.ts::add` runs:

1. `project.ts::readAddProject`: refuse a linked `.stacks/`, read the manifest if there is one,
   stop with `VerifyChanged` if its verify steps were edited without being accepted (Trust model
   point 5), check `--sandbox` and `--agents` against it, and look up the recorded stack.
2. `prepare.ts::prepareAdd`: compose only the requested fragments (`tags.ts::inferTags` guesses
   tags when no stack is known), warn about tools missing from PATH, settle the project name
   (`name.ts::inferName` when the manifest has none), render the files, and call
   `plan.ts::planAdd` to sort them into write, skip and park. It also rejects a verify step name
   the project already uses.
3. `manifest.ts::mergeAddManifest`: fold the new fragments, steps, env and commands into the
   manifest and decide which verify digest to record.
4. The handoff decision is made and stamped into the manifest, and the brief is rendered.
5. `write.ts::applyAdd`: write the files, the rest of `.stacks/`, the state record and the
   manifest in one transaction.

Everything up to step 5 only reads, so a failure there leaves the project untouched.
`report.ts::renderAdd` turns the result into text for the command.

## Files

| File | What it owns |
| --- | --- |
| `project.ts` | `readAddProject`: the existing manifest, its tamper check, the recorded stack and settings |
| `prepare.ts` | `prepareAdd`: composition, rendering, planning and the incoming manifest, before any write |
| `plan.ts` | `planAdd` and `checkAddRoot`: write, skip or park for each file; `mergeNeeded` groups parked copies |
| `manifest.ts` | `mergeAddManifest`: the merged manifest and which verify digest it records |
| `write.ts` | `applyAdd`: the transactional write, ending with the manifest |
| `name.ts` | `inferName`: a project name from `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml` or the directory |
| `tags.ts` | `inferTags`: tags guessed from project files, used only by `stacks:when` blocks |
| `report.ts` | `renderAdd`: the text summary for the `human` and `agent` audiences |
| `types.ts` | `AddOptions`, the options shared by every step |

## Terms

- Delta: the fragments this `add` brings in, as opposed to the ones the manifest already lists.
  Only the delta is composed and rendered.
- Live file: a file already in the project. It is never overwritten or merged into.
- Parked file: a fragment's version of a file, written under `.stacks/incoming/<path>` because a
  differing live file exists. If an earlier `add` already parked one there, a JSON file is merged
  into it and anything else is kept beside it as a numbered copy (`<path>.2`, `<path>.3`).
- Merge needed: the list of parked files grouped by their project path, which the result and the
  brief report so the agent knows what to merge.
- Digest recorded: whether the new verify steps' digest went into the manifest and state record.
  An untrusted addition without a person at a terminal keeps the previous digest, so the next
  `stacks verify` reports the steps as changed and runs nothing until a person accepts them with
  `--accept-changes` (Trust model point 4).
- Inferred tags: tags such as `node` or `monorepo` guessed from project files when no known stack
  made the project. They steer conditional blocks only, never which fragments fit, and aren't
  stored in the manifest.

## Where to start

Read `core/add.ts::add` for the sequence, then `plan.ts::planAdd` for the rule that keeps live
files safe. Tests: `packages/cli/tests/add.test.ts` covers the command end to end;
`add-file-edge-cases.test.ts` and `add-regressions.test.ts` the planning and writing edge cases;
`add-manifest.test.ts` the manifest merge; `add-report.test.ts` the summary text; and
`add-telemetry-dir.test.ts` the `--dir` registry and telemetry.
