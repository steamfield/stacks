---
paths:
  - "packages/cli/src/**"
  - "packages/cli/tests/**"
  - "packages/cli/scripts/**"
---

# Effect

Load the project's Effect skill (`.claude/skills/effect/SKILL.md`) before writing Effect code or looking up its APIs. It lists the Effect 3 and 4.0-prerelease names that don't exist in the installed version. The installed package's declarations and its `AGENTS.md` and `ai-docs/` win over web docs and memory; keep the skill current when dependencies change.

Paths, logging and output config must stay independently readable. `doctor` and `--version` have to work when `config.json` is broken, so a new setting never makes path or logger resolution depend on decoding the whole file.

Logger records are built only by `logging.ts::entry`: `time`, `level`, `msg`, `detail`, annotations flattened to scalar top-level keys (secret-looking keys redacted, reserved names prefixed), and a `cause` holding only an `AppError`'s allowlisted fields. Don't construct a record anywhere else or pass an arbitrary object through as a field. A new field is a contract change for anything that reads the JSONL file, including the run records. A log sink failing (unwritable file, closed stderr) can't fail the command or change its exit.

Service state lives only inside the layer that builds the service, which is built fresh for every invocation: a closure variable, a `Ref`, or `Effect.cached` for work done once. No module-level mutable state, and no cache added to a service object to skip work across calls; if a service repeats work, cache it in its layer.

Read the CLI's inputs from what effect/cli parsed: flag values from the handler's config, failures from `CliError` fields (`InvalidValue.option` and `.kind`, `UnknownSubcommand.subcommand`, `ShowHelp.commandPath`). Never re-parse argv; the skill names the two pre-parse reads that already exist and why.

A throw or a sync decode inside `Effect.gen` is a defect, exit 1. Expected failures are tagged errors in the error channel; wrap throwing code in `Effect.try` and decode with `decodeUnknownEffect`. `catchCause` and `ignoreCause` swallow defects too, so they're only for best-effort writes that can't change the outcome.

Capture context when you build a callback that runs later, rather than reading services inside it. Observe every forked fiber: join it, scope it, or handle its failure, so nothing fails silently in the background.
