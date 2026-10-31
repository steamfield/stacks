# Testing

Vitest runs on Node through test:unit; test chains that command. Bun runs only `bun test ./e2e` after the host build. Never pass --bun to Vitest or use unscoped bun test. Optional native adapters declare their own Bun test directories.

Both runners load tests/helpers/setup.ts before application code. It clears inherited credentials and project config env, gives HOME and XDG temporary paths, and cleans up at process exit. runCli and binary subprocesses build their environments from scratch, so no personal config or credentials reach a command.

Use runCli in tests/helpers/cli.ts for argv-level checks. It runs the real parser, main, AppLayer, NodeServices, configuration reader and logger. Its only substitutes are process writers and Host. Assert status and both streams; decode JSON results with their Schema. The helper accepts a program to exercise the invocation boundary's failure policies without adding test switches to production commands.

Unit tests next to errors.ts and logging.ts cover pure contracts. tests/config-logging.test.ts implements the acceptance matrix using actual files and records, including log suppression and a failed sink. Test another setting's precedence through the result, and keep two-invocation isolation coverage. A new command extends tests/cli.test.ts.

e2e/binary.test.ts starts the compiled artifact with a clean env and real temp files. Keep file-only logging, env overrides, version, compiled doctor, usage errors and disabled dotenv/bunfig autoload covered. Never mock application services. Owned local servers may stand in for third parties.

Selected Claude hooks have tests under tests/hooks, run by the same Node runner. Add deny and near-miss cases for new guard patterns. Their shipped helpers own temp projects and execute the actual wired hooks.

When the Effect testing fragment is selected, use fresh real layers with @effect/vitest. Test time-based programs under TestClock, not through runCli's live clock. Never sleep to await an outcome. A filter matching no tests is not a pass; read runner counts.
