---
name: add-command
description: Add a subcommand to this Java CLI with its picocli class, errors, output and tests. Use when the user asks for a new command, subcommand, option or argument that does work.
---

# Add a command

`config show` is the worked example: `app.cli.ConfigCommand` (a group), `app.cli.ConfigShowCommand` (an `Action`), its cases in `AppTest` and `JarIT`. Follow the same path.

1. **Parse.** Create `src/main/java/app/cli/<Name>Command.java` annotated `@Command(name = "...", description = "...")` and add it to the parent's `subcommands` (`RootCommand`, or a group such as `ConfigCommand`). Options are `@Option` fields and arguments `@Parameters` fields; give each a `description`, initialize what has a default, and mark a field that can stay unset `@Nullable`. A flag every command needs goes on `RootCommand` with `scope = ScopeType.INHERIT` and into `Flags`. A group that only holds subcommands doesn't implement `Action`; running it bare is a usage error.
2. **Handle.** Implement `Action.run(Config config, Output output)`. Write the result once with `output.result(value, human)`: `value` is a record or map scripts rely on under `--json`, `human` the text a person reads. Log through SLF4J (`LOG.atDebug().addKeyValue(...)`), never `System.out`. `App` already loads config and starts logging before it calls `run`.
3. **Fail.** Throw `CliException` with an `ErrorCode`. A failure the table lacks is a new `ErrorCode` constant (exit status: 2 for a mistake in the invocation, 3 for configuration, 1 otherwise; a suggestion ending in a period), a case in `ErrorCodeTest` and a row in `docs/ARCHITECTURE.md`'s exit-status table. Never rename a code.
4. **Settings.** A new setting is a component of `Config` with its default in `DEFAULTS`, a rule in `validate` if it can be wrong, a `Layer` component and its environment line in `ConfigLoader`, a precedence case in `ConfigLoaderTest` and a row in `docs/configuration.md`.
5. **Test.** In `AppTest`, a success case in text and `--json`, and one case per failure, each asserting the exit status and both streams. In `JarIT`, one case per new exit path through the packaged jar.
6. Run `make fmt compile coverage test-integration`.
