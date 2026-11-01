# CLI: commands, stdout and exit codes

New commands copy `src/commands/doctor.ts`: use Effect CLI's parser, name the command through `Invocation`, call a program from `src/core/`, and send the result through Output. Shared flags belong in the root command. Validate external input with Schema from effect.

Only help and version are enabled as framework built-ins. Set logging through LOG_LEVEL or the config file; --log-level, wizard and completions aren't part of this slice. Successful commands resolve the audience from parsed flags, while early parse failures use the same boolean literal rules for --json.

`src/main.ts` captures the framework Console while running with error rendering disabled. Only successful help/version output reaches stdout. A bare root shows help. Parse errors leave stdout empty and use the safe Usage envelope on stderr. The output audience is detected before parsing so even malformed argv respects `--json`; content after `--` is positional.

Results are one JSON value or readable text. JSON help is `{help}`, version is `{version}`, and errors are `{error:{tag,message,retryable}}` as the last stderr line. All preceding stderr logs are JSON too. No ANSI reaches stdout; this slice uses plain stderr text and therefore also respects NO_COLOR. A closed output pipe exits quietly.

Only `src/bin.ts` supplies process writers and BunServices. Core code uses abstract Effect services, and the same invocation runs under NodeServices in tests. Keep Bun imports and globals in bin.ts or explicit platform adapters; the shipped Grit and write guards enforce this along with environment and schema boundaries.

`src/errors.ts` is the stable exit-code table: 0 success/help/version/closed pipe, 1 defect, 2 Usage, 3 InvalidConfig, 6 PermissionDenied, 130 Interrupted. Doctor intentionally reports invalid config in its result with exit 0. A later command that requires valid config lets the tagged failure reach main. Add a tag and its table row together, and exercise its public envelope through runCli.

Main emits one command record with durationMs, outcome, exitCode, runId and errorTag. Records use the configured level (warn by default), so none suppresses them too. Its `command` field is the name the handler that ran gave `Invocation.named` (each handler names itself first, as doctor does), `framework` for help and version, and null for a parse failure. Do not log raw argv or flag values.
