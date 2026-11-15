# core/scaffold

This folder builds a new project on disk when someone runs `stacks new <stack>`. It also owns the
one writer every command uses to put files into a user's project, so `stacks add` and
`stacks create` lean on it too.

A stack is a recipe for a whole new project (`registry/stacks/<id>/STACK.md` plus its files), and
fragments are reusable additions (CI, git hooks, a database) composed onto it. Scaffolding takes
that composition, renders every file in memory, and only then writes the lot in one transaction
that rolls back on failure or Ctrl+C.

## How it fits

`commands/new.ts` parses the flags and calls `new.ts::scaffold`; the result goes back to the
command, which prints it and hands the project to a coding agent (`commands/handoff.ts`). Inside,
scaffolding depends on `core/compose/` for the composition and file rendering, `core/brief/` for
the brief, `core/manifest.ts` and `core/fingerprint.ts` for the manifest, and
`core/project-state.ts` for the state record. The dependency runs one way: `scaffold/` imports
`brief/` and `compose/`, never the reverse.

Other folders reach in for a few shared pieces:

- `write.ts::openProject` is the only way any command writes into a project (`core/add/write.ts`,
  `core/create.ts`, `core/skill.ts`, `core/verify/tamper.ts`, `commands/handoff.ts`).
- `git.ts` serves `core/add/` as well (`gitToplevel`, `gitInstalled`).
- `values.ts` gives `add` the same template values `new` uses.
- `report.ts::warningLine` and `missingLine` keep the `add` summary worded like the `new` one.

The `core/` boundary rules apply (AGENTS.md, "Conventions"): no imports from `platform/` or
`commands/`, every child process through `Processes`, and no Node builtins apart from
`node:fs/promises` for the writer's empty-directory removal. Nothing here runs a command from an
entry; the only programs started are the fixed git commands in `git.ts` (Trust model point 1 in
`.claude/rules/architecture.md`).

## The main flow

`new.ts::scaffold` runs these steps in order:

1. `values.ts::templateOverrides` checks `--name`, `--author` and `--scope`, so a bad value fails
   before any slow work.
2. The stack and its fragments are composed (`compose/compose.ts::compose`), honoring the preset
   and payload.
3. `target.ts::inspectTarget` refuses a directory that already holds someone's work, and
   `git.ts::probeGit` works out whether the target sits inside a repository.
4. `values.ts::templateValues` gathers the values for `.tmpl` files; `compose/files.ts` renders
   every file, and `fill.ts::fillMarkers` fills the commands table.
5. The brief, fingerprint and manifest are built, and the handoff decision from the command is
   recorded in the manifest.
6. Unless `--dry-run` was given, `write.ts::openProject` writes the entry files and `.stacks/`,
   then the manifest, then the state record, then runs `git init`. Any failure from the first
   write on rolls all of it back.

A dry run stops after step 5 with the same composition and rendering, so the preview matches what
a real run would write.

## Files

| File | What it owns |
| --- | --- |
| `new.ts` | `scaffold`, the whole `new` sequence from options to a written project and its result |
| `write.ts` | `openProject`, the transactional project writer: path checks, exclusive writes, `rewrite`, rollback |
| `target.ts` | `inspectTarget`, the empty-target rule and the `TargetNotEmpty` details for a leftover scaffold |
| `git.ts` | The fixed git commands: `probeGit`, `gitInit`, `gitToplevel`, `gitInstalled`, `gitUserName` |
| `values.ts` | Template values: flag checks (`templateOverrides`) and the full set (`templateValues`) |
| `fill.ts` | `fillMarkers`, which turns a `stacks:fill:commands` marker into rows of declared commands |
| `report.ts` | `renderNew`, the text summary for the `human` and `agent` audiences, and the shared warning lines |

## Terms

- Target: the directory `new` builds in. It may be missing, empty, or hold only `.git` and OS
  litter such as `.DS_Store`.
- Writer: the object `openProject` returns. It creates files with the `wx` flag, so it never
  overwrites a file it didn't make, and refuses any path that leaves the project root once
  symlinks are resolved.
- Rollback: the writer's scope finalizer. On failure or interrupt it restores rewritten files and
  removes what it created, newest first. A path it couldn't restore goes to
  `Invocation.rollbackIncomplete`, and the error envelope lists it.
- Git probe: what `probeGit` reports about the target: a fresh directory to `git init`, a
  directory inside a parent repository (`--own-repo` turns that into a fresh one), or no git.
- Neutral files: the same files rendered with fixed placeholder values
  (`compose/files.ts::NEUTRAL_VARS`), so the fingerprint doesn't change with the project's name or
  author.
- Template values: the values `.tmpl` files are rendered with, such as the project name, author
  and npm scope. Explicit flags win, then settings, then git's `user.name`.

## Where to start

Read `new.ts::scaffold` top to bottom, then `write.ts::openProject` for how writing and rollback
work. Tests: `packages/cli/tests/new.test.ts` and the other `new-*.test.ts` files cover the
command end to end; `scaffold-write.test.ts`, `project-write-characterization.test.ts`,
`writer-rollback-acceptance.test.ts` and `writer-rollback-review.test.ts` cover the writer;
`new-target-ancestors.test.ts` covers the target rule and `project-values.test.ts` the template
values.
