---
paths:
  - "packages/cli/src/**"
  - "packages/cli/tests/**"
  - "packages/cli/e2e/**"
---

# Testing

Load the `ce:writing-tests` skill before writing or changing tests. It sets the philosophy: test observable behavior with real dependencies, prefer integration tests, mock only what you don't own, and write tests that survive refactoring. This rule says what that means for an Effect CLI whose main reader is a coding agent. Where the two differ, this rule wins.

## What "observable behavior" means here

A CLI's behavior is what a caller sees: the exit code, stdout, stderr, and files on disk. Assert on those. The `--json` output, the error envelope and the exit codes are a contract that agents branch on, so a test that pins one of them is pinning public API.

- Assert the exit status and both streams in every command test. On failure, stdout must be empty and stderr must carry exactly one error (one JSON envelope in `--json` mode).
- Parse `--json` output and assert on the decoded value, not on substrings. Decode it with the command's own `Schema` where one exists, so a test fails when output drifts from the schema.
- Assert files a command writes by reading them back from the temporary directory.
- Don't assert on service internals, layer composition, or which functions were called.

## The test types, mapped to this repo

Integration is the default. Use `runCli` from `tests/helpers/cli.ts`: it runs the real command tree through `main` with real `NodeServices` (real filesystem, real path), real `AppConfig` and `Logging` layers, and in-memory `Output` and `Host`. Most tests should be `runCli([...args], { env, home })` followed by assertions on `{ status, stdout, stderr }`.

Run a core program directly with `Effect.runPromise(program.pipe(Effect.provide(...)))` only when going through the parser adds nothing, such as config caching or a log sink's failure handling. Still provide real layers.

Unit tests are for pure functions with no services: schema decoding, error-to-exit-code tables, formatting. Property tests use `@effect/vitest`.

E2E is `bun test ./e2e` against the installed Node package. It covers startup, signals, the environment, and the runtime guards. Pack first, install offline and spawn the package bin with an environment assembled from scratch, and keep these tests few.

## Fakes: what you may replace

Replace a service with a test layer only at a real boundary: the process and terminal (`Output.memory`, `Host.memory`), the clock, randomness, and anything off the machine (network, registries, a spawned agent). Pass the fake as a layer, the same way production code gets the real one. Never use `vi.mock` or module mocks, and never stub your own services to make a test pass.

- Time: use `TestClock` from Effect, never `sleep` or real timers. For real child processes, poll for the condition with `vi.waitFor`.
- Files and config: use a real temporary directory (`tempDir()`) and pass `HOME`, `XDG_*` and `STACKS_*` through the `env` option. Config only reads env given to its layer, so a test never touches the developer's real home.
- Commands that run steps or spawn processes: run real, tiny, deterministic programs (a script in the temp dir that writes a file or exits with a code) rather than faking the process service, unless the test is about a failure the OS won't produce on demand.
- A fake must behave like the real thing on the paths the test uses, including its failures (EPIPE, permission denied, missing file).

## Realistic edge cases

Tests written next to the code tend to confirm the path the author had in mind. Review here has found bugs in feature after feature that full line coverage had missed, and they came from the same few places. Before calling a feature done, ask what real users, real machines and real entries will throw at it, and write a test for each case that applies. Realistic means it happens without an attacker: a dotfiles repo, a Docker volume, a macOS laptop, an agent's shell, a half-finished earlier run.

- The filesystem as it is. Symlinks anywhere on a path (inside an entry, as a root, as an intermediate directory, pointing at `/` or in a loop), case-insensitive volumes (`.GIT` is `.git` on APFS, `README.md` and `readme.md` collide), paths with spaces, leading dashes and non-ASCII names, and real paths that differ from the given one (`/var` and `/private/var`).
- State that was already there. A target holding a broken `.git`, a partial scaffold from an interrupted run, a parent repository, a directory that is its own repository, an unreadable file or directory, a file where a directory is expected.
- The environment the CLI inherits. Variables a git hook or a wrapper exports (`GIT_DIR` and friends), agent markers, a missing or relative `XDG_*`, a working directory other than the package's.
- Text from entries and users. Control characters, escape sequences and newlines in names and descriptions, quotes and backslashes in template values, YAML that parses with warnings, and keys in the wrong case.
- Interruption and partial failure at each step that writes, not only the last one, with a test that rollback removes what the step created and nothing it didn't.

Check findings, not just the happy result. When a command reports problems (`validate`, `list`'s rejected rows), assert the exact set it reports, so a duplicate or a false positive fails the test as surely as a missing finding.

## Effect-specific rules

- Test failures as values. Expected failures are tagged errors, and the test asserts which error came out and what exit code and envelope it maps to. Every error tag in `errors.ts` stays covered by the exhaustive table test.
- Defects (`Effect.die`, thrown exceptions) must produce exit 1 with the fixed message, must not leak the defect's contents to stdout, stderr or logs, and must be logged once.
- Interruption is behavior. Cover cancellation through an `AbortSignal` and check that scopes and finalizers still run (temp files removed, children killed).
- Build fresh layers for each test. Nothing is cached across invocations, so a test that needs a "second run" builds a second layer.
- Don't widen a service's interface or add test-only exports to make something testable. Put helpers in `tests/helpers/`.

## Manual QA as the user

Agents are this CLI's main user, so the agent building a command is also its first user. Before a change is called done, run the changed command for real, as `rules/cli/cli.md` "Verifying UX" describes: through `bun run dev` or the installed Node package, in human and `--json` modes, on success and on the realistic failures above.

Then judge it as the agent that will depend on it. Could I pick the next step from this output alone? Is anything missing, noisy, ambiguous or surprising? Would I want a different flag, default, message or exit code? Does the JSON give me what I need to branch without parsing prose? Fix what fails that judgement, or report it with a reason to whoever gave the task. The implementer's report ends with a short QA note: the commands run, what it judged, and what it changed.

## Process and gate

- A feature whose design lists acceptance behaviors is test-first. A test author, a different agent from the implementer, writes those behaviors and the realistic edge cases as failing tests. The implementer makes them pass without editing their assertions. A change to a test's intent goes back to whoever gave the design, and a test the implementer believes is wrong is reported, not quietly rewritten.
- A bug fix starts with a failing test that reproduces it through the narrowest real interface (`runCli` if possible).
- Never weaken, skip or delete an existing assertion to get green. If a contract changes on purpose, change its test in the same commit and say why.
- Name tests after behavior ("--json after -- belongs to the command"), not after functions.
- Scope runners as the guards require: Vitest on Node for `tests/`, `bun test ./e2e` only for the binary, never bare `bun test` and never `--bun` with Vitest.
- `doctor` and `--version` must keep passing with no credentials, no config file and no network.
- Hook tests under the root `tests/hooks/` run the real wired hook commands, with a deny case and a near miss for each guard.
