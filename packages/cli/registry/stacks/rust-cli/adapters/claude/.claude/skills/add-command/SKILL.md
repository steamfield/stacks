---
name: add-command
description: Add a subcommand to this Rust CLI with its handler, errors, output and tests. Use when the user asks for a new command, subcommand or option that does work.
---

# Add a command

`config show` is the worked example: `src/cli.rs` (the `Config` and `ConfigCommand` variants), `src/commands/config.rs` (the handler and its unit tests), the dispatch `match` in `src/app.rs`, and its cases in `tests/cli.rs`. Follow the same path.

1. **Parse.** Add a variant to `Command` in `src/cli.rs` with a `///` doc comment (clap shows it in `--help`). Command-specific arguments go on the variant; a flag every command needs is `global = true` on `Cli`. `Cli::command().debug_assert()` in `cli.rs`'s tests catches conflicting definitions.
2. **Handle.** Create `src/commands/<name>.rs` with `pub fn run(config: &Config, output: Output, out: &mut dyn Write, ...) -> Result<(), AppError>` and declare it in `src/commands.rs`. Write the result once with `output.result(out, &value, &human)`: `value` is a `Serialize` type scripts rely on, `human` the text a person reads. Log with `tracing::debug!`.
3. **Dispatch.** Add the arm to the `match command` in `app::invoke`. The compiler rejects a missing arm.
4. **Fail.** A new failure is a new `AppError` variant in `src/error.rs` with its `code()`, `suggestion()` and `exit_code()` arms (2 for a mistake in the invocation, 3 for configuration, 1 otherwise). Add the row to the exit-status table in `docs/ARCHITECTURE.md`.
5. **Settings.** A new setting goes in `Config`, its `Default`, the file `Layer` and `env_layer` in `src/config.rs`, `validate` if it can be wrong, a precedence test, and a row in `docs/configuration.md`.
6. **Test.** Unit tests beside the handler for both output modes. In `tests/cli.rs`, a success case and one case per failure, each checking the exit status, stdout and stderr in human and `--json` mode.
7. Run `make lint test`, then `make smoke`.
