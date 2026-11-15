# core

This folder holds the programs behind every `stacks` command: finding entries in the registries,
composing a stack with its fragments, writing a project, verifying it, and validating a registry.
A command handler in `commands/` parses flags and renders output; the work it asks for happens
here.

## How it fits

`commands/` calls into `core/`, and `core/` reaches the outside world only through `services/`
(`Output`, `Host`, `Processes`, `Tcp`) and Effect's `FileSystem`, `Path` and `HttpClient`. The
boundary rules (AGENTS.md, "Conventions") are enforced by lint: no imports from `platform/` or
`commands/`, no Node builtins apart from `node:crypto` for digests and the few listed exceptions,
no environment reads (those come from `config.ts::AppConfig`) and no direct stdout or stderr
writes. Pure decisions and rendering take plain values; the Effect steps around them do the I/O.

Nothing in `core/` runs a command it read from an entry. The only programs it starts are fixed:
git lookups and `git init` (`scaffold/git.ts`), the harness at handoff, `npm` from `update/`, and
`gh` and `git` from `submit/`. `verify/` runs the steps in the project's own manifest, after
checking they haven't changed (`.claude/rules/architecture.md`, "Trust model").

## The main flow

Most commands follow the same path through these folders:

1. `registry/` finds entries in their roots (project, user, the remote index from
   `remote-index/`, bundled) and decides which one wins each id and whether it is trusted.
2. `compose/` selects the fragments, merges their steps, env and files, and renders every file.
3. `brief/` turns the composition into `.stacks/BRIEF.md`, the document the coding agent reads.
4. `scaffold/` (for `new`) or `add/` (for `add`) writes the project, its manifest and its state
   record in one transaction.
5. `verify/` runs the manifest's steps later and records each run; `runs.ts` summarizes them.

`validate/` runs the same composition and rendering over a whole registry to catch problems
before an entry ships; `search/`, `show.ts` and `list.ts` read entries without writing anything.

## Folders

| Folder | What it owns |
| --- | --- |
| `registry/` | The `Registry` service: entry roots, loading, trust, rejections, and the merged remote index |
| `remote-index/` | Verifying and extracting the signed remote index and its bundles |
| `compose/` | Turning a stack and fragments into one `Composition` and its rendered files |
| `brief/` | Rendering the brief for `new` and `add` |
| `scaffold/` | `new`: target checks, template values, and `openProject`, the one project writer |
| `add/` | `add`: applying fragments to an existing project without overwriting its files |
| `verify/` | `verify`: the tamper check, planning, running steps, and recording each run |
| `validate/` | `validate`: every registry check, the word budgets, and `--brief` |
| `search/` | `search`: the hosted API request, local ranking, and merging the two |
| `submit/` | `submit`: opening a draft pull request for a user's own entries |
| `update/` | `update`: checking npm for a newer CLI and upgrading a global install |
| `deps/` | Reading a project's declared dependencies as data |

## Files at this level

| File | What it owns |
| --- | --- |
| `add.ts` | `add`, the orchestration of the steps in `add/` |
| `create.ts`, `create-text.ts` | `create`: a skeleton or a copy of an entry in the user registry |
| `show.ts`, `show-report.ts` | `show`: one entry's report and its text |
| `list.ts`, `list-report.ts` | `list`: the catalog and the fragments a project can add |
| `handoff.ts` | `decideHandoff`: whether to launch an agent, offer a choice, or print a prompt |
| `prompting.ts` | Numbered pickers for a person at a terminal |
| `guide.ts` | The agent guide text and `guide author` |
| `doctor.ts` | The diagnostic report |
| `skill.ts` | Installing the bundled agent skills |
| `manifest.ts` | `.stacks/manifest.json`: building, reading, locating, and the step digests |
| `project-state.ts` | The state record kept outside the project, which the tamper check trusts |
| `fingerprint.ts` | The composition and proof fingerprints |
| `ledger.ts` | `registry/runs.json`, the bundled run ledger |
| `runs.ts` | `runs`: a project's verify history |
| `deps.ts` | `readDependencies`, the entry point for `deps/` |
| `allowlist.ts` | The signed dependency allowlist |
| `cached-fetch.ts` | The shared cached HTTP fetch with deadlines and backoff |
| `stats.ts`, `stats-cache.ts`, `stats-text.ts` | Published usage stats, their cache and the `Stats:` line |
| `remote-index.ts` | The `RemoteIndex` service: cache, deadline and backoff for the signed index |
| `result-schemas.ts` | The JSON Schemas `stacks schema` prints |
| `canonical-json.ts` | Sorted-key JSON, the input to every digest |
| `replace-file.ts` | Atomic file replacement |
| `template.ts` | The `.tmpl` tokenizer and renderer |
| `slug.ts`, `shell.ts`, `suggest.ts`, `text.ts`, `shown-path.ts`, `wrap.ts` | Small text helpers: slugs, shell quoting, did-you-mean, printable text, shown paths, wrapping |

## Terms

- Composition: the result of `compose/`, a stack plus its selected fragments with merged steps,
  env, decisions and planned files. The brief, manifest and fingerprint all derive from it.
- Manifest: `.stacks/manifest.json`, committed with the project; it records the composition and
  the verify steps.
- State record: a file under the CLI's state directory, outside the project, holding the step
  digest `verify` compares against, so an edited manifest can't pass itself off as accepted.
- Origin: the root an entry came from (project, user, index, bundled); it decides trust.

## Where to start

Read `scaffold/new.ts::scaffold` for the longest path through the folder, then the README of
each folder it calls. For `verify`, start at `verify/run.ts::runVerify`. Tests live in
`packages/cli/tests/`, named after the command or folder they cover (`new.test.ts`,
`compose.test.ts`, `verify.test.ts`, `validate.test.ts`).
