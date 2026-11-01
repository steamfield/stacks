# Architecture

One Maven module building one runnable jar (`make build`), with every dependency shaded inside. `app.Main` captures the process (environment, working directory, whether a terminal is attached, the standard streams), calls `App.run` and exits with the status it returns. Nothing below `Main` reads global state, so tests call `App.run` with in-memory streams.

`App.run` parses the command line with picocli, answers `--help` and `--version` without reading config, loads the typed `Config`, starts logging for this invocation and calls the command's `Action.run`. A failure from any step is reported once by `Output.error` and mapped to its exit status.

| Package | Owns |
| --- | --- |
| `app` | `Main` (the only class that touches the process), `App` (one invocation), `AppInfo` (name, environment prefix, version from the jar manifest) |
| `app.cli` | picocli commands. `RootCommand` holds the global options (`--config`, `--json`, `-v/--verbose`, `--no-color`, `-h/--help`, `--version`); `Action` is the interface a command that does work implements; `config show` is the first |
| `app.config` | `Config`, its defaults and validation; `ConfigLoader` with the file, environment and flag layers; `Env` and `Flags` |
| `app.errors` | `ErrorCode` (every failure with its exit status and suggestion) and `CliException` |
| `app.output` | `Output`: every result and error write, as text or JSON |
| `app.log` | Logback for one invocation (`Logging`) and the quiet configuration Logback starts with (`QuietStart`) |

Dependencies point one way: `app.cli` uses the rest; `app.config`, `app.errors`, `app.output` and `app.log` import nothing from picocli or `app.cli`, and only `app.log` imports Logback. `ArchitectureTest` checks these and that only `Main` calls `System.getenv`, `System.getProperty` or `System.exit` or touches `System.out`/`System.err`.

## Exit status

| Status | Meaning | Codes |
| --- | --- | --- |
| 0 | Success, including `--help` and `--version` | |
| 1 | Runtime failure | `IO`, `INTERNAL` |
| 2 | Invalid invocation: unknown command or option, missing subcommand or argument | `USAGE` |
| 3 | Invalid configuration: file missing, unreadable or malformed, bad setting value | `CONFIG_NOT_FOUND`, `CONFIG`, `INVALID_SETTING` |

Errors go to stderr once: `error[CODE]: message` and a `suggestion:` line, or `{"error":{"code","message","suggestion"}}` under `--json`. Before config is loaded, only an explicit `--json` on the command line selects JSON.

## Tests

Unit tests (`*Test`, Surefire, in process): `AppTest` runs whole invocations, one test class per package beside it, and `ArchitectureTest`. `JarIT` (`*IT`, Failsafe, after `package`) runs `java -jar` on the shaded jar with a clean environment and checks exit status, stdout and stderr, which proves the manifest, the shading and Logback's service files.
