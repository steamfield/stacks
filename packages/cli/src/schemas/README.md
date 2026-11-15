# schemas

This folder holds the shapes of the JSON the CLI prints. When an agent runs a command with
`--json`, stdout carries exactly one result object, and that object decodes with the command's
schema here. These shapes are a contract that agents branch on, so a field, its optionality, its
order and every literal stay fixed once published; a change adds a field rather than reshaping one.

## How it fits

Each schema is an Effect `Schema`, so one definition gives three things: the TypeScript type the
command builds (`typeof NewResult.Type`, exported under the same name), the encoder the command
runs before printing (`Schema.encodeSync(NewResult)`), and the JSON Schema document that
`stacks schema <name>` prints for an agent that wants the shape up front.

- Commands in `commands/` and the programs in `core/` import a schema from its own file to type
  and encode their result.
- `core/result-schemas.ts::RESULT_SCHEMAS` maps each name `stacks schema` takes to one of these
  schemas (or to `errors.ts::ErrorEnvelope` and the search result from `@steamfield/stacks-format`).
- `packages/mcp` reads the same `--json` output and mirrors these shapes in its own
  `src/schemas/cli.ts`; its e2e test `e2e/schema-drift.test.ts` fails when the two disagree.

Shapes shared with the hosted API and other tools (entry frontmatter, the manifest, run records,
search and stats) don't live here: they belong to `@steamfield/stacks-format`, and these files
import them. The folder holds only the CLI's own shapes. It imports nothing from `commands/`,
`services/` or `platform/`; the one reach outside it is `errors.ts::ConditionalProblem` in
`validate.ts` and `project-layout.ts::BRIEF_PATH` in `new.ts` and `add.ts`.

## Conventions

- An optional field is `Schema.optionalKey`: the key is absent, never present with `undefined`.
  Code that builds one uses a conditional spread, `...(x === undefined ? {} : { x })`.
- Most results start with `...NoticeFields`, the optional `notice` a command adds on the run that
  first shows the telemetry privacy notice.
- A top-level result carries a `title` and `description` annotation; those strings appear in the
  `stacks schema` output, so they are pinned like the fields.
- A doc comment on a field is for readers of this code only. It doesn't reach the JSON Schema.
- Where two results share a field, one borrows it from the other (`AddResult` takes
  `missingTools`, `untrusted` and `handoff` from `NewResult`; `ShowReport` spreads `ListRow`), so
  the copies can't drift.

## Files

| File | What it owns |
| --- | --- |
| `add.ts` | `AddResult`, what `add --json` prints |
| `config.ts` | `Settings`, the user's `config.json`, and `NpmScope` |
| `create.ts` | `CreateResult`, what `create --json` prints |
| `doctor.ts` | `DoctorReport`, what `doctor --json` prints |
| `guide.ts` | `GuideResult` and `GuideAuthorResult`, what `guide --json` and `guide author --json` print |
| `index.ts` | A shorter import path for a few common schemas |
| `ledger.ts` | `Ledger`, `LedgerRecord` and `LedgerLastRun`: the bundled run ledger, `registry/runs.json` |
| `list.ts` | `ListResult` and `ListRow`, what `list --json` prints |
| `new.ts` | `NewResult`, what `new --json` prints, and `NewPreset` |
| `notice.ts` | `NoticeFields`, the optional privacy-notice field |
| `origin.ts` | `Origin`, which registry root an entry came from |
| `remote-index.ts` | `RemoteStatus`, the remote index's cache status in `doctor`'s report |
| `runs.ts` | `ProjectRuns`, what `runs --json` prints |
| `show.ts` | `ShowReport`, what `show --json` prints |
| `skill.ts` | `SkillResult` and `SkillName`, what `skill install --json` prints |
| `submit.ts` | `SubmitResult`, what `submit --json` prints |
| `telemetry.ts` | `Consent` and the `telemetry` subcommands' results |
| `update.ts` | `UpdateResult`, what `update --json` prints |
| `validate.ts` | `ValidateReport`, `Finding`, `SizeRow`, `Severity` and `BriefPreview` (`validate --brief`) |
| `verify.ts` | `VerifyResult`, `StepResult`, `VerifyChange` and `VerifyEvent`, verify's live stderr lines |

## Terms

- Result: the one JSON object a command prints on stdout with `--json`.
- Envelope: the JSON object a failed `--json` command prints as its last stderr line,
  `{ error: { tag, message, ... } }`. Its schema is `errors.ts::ErrorEnvelope`, not in this folder.
- Event: a JSON line a long-running command writes to stderr while it works. Only verify has them
  (`VerifyEvent`).
- Origin: which registry root an entry was found in (project, user, the remote index, or the
  bundled registry); it decides whether the entry is trusted.

## Where to start

Read `new.ts` first: it is the largest result, and `add.ts` and `config.ts` build on it. Then
`core/result-schemas.ts` to see every name `stacks schema` takes.

Tests: `packages/cli/tests/schema.test.ts` covers `stacks schema` and the JSON Schema documents,
and `packages/cli/tests/schemas.test.ts` decodes the shapes. Most command tests decode their
`--json` output with these schemas as well.
