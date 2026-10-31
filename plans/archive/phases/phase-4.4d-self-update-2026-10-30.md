# Phase 4.4d: `stacks update`

Status: EXECUTED 2026-10-27 (Codex-reviewed once; a real `npm install -g` replacing the running package is untested, the fake npm covers argv, cwd, failures and cleanup)
Acceptance tests: traced

| Field | Value |
|---|---|
| Goal | A person runs `stacks update` and a global npm install moves to the latest published version; any other install gets the running and latest versions and the exact command to run, and an agent can check but not install |
| Traces to | D31 (agreed 2026-10-27 as `update`, npm global only); A1 (npm is the only distribution) |
| Depends on | [1.6c](phase-1.6c-first-release-2026-10-30.md) (the published package), [0.3b](phase-0.3b-processes-and-signals-2026-10-30.md) (`Processes.exec`), [1.3a](phase-1.3a-verify-runner-and-probes-2026-10-30.md) (`NetLayer`'s `HttpClient`) |
| Blocks | Nothing |
| Decisions needed | None; agreed with the maintainer 2026-10-27 |
| Settles | How the CLI finds the latest version, which installs it upgrades in place, and what an agent may do |

## Scope

In:

- `stacks update [--check] [--json]`: one registry read, then at most `npm prefix -g` and one `npm install -g`.
- Detecting a global npm install by real path; npx and everything else get a printed command.

Out:

- Background or on-other-commands update checks (D31: no silent network calls).
- pnpm, bun and yarn globals, Homebrew and compiled binaries (A1: npm only). They are reported as `other` with the npm command.
- Choosing a version (`update 0.1.0`), prerelease channels, downgrades.
- Retries inside the CLI. One registry request; a failure exits 4 and the caller retries.
- Listing `update` in `core/guide.ts::guideCommands`. That list is the agent's working loop (it feeds `GuideResult`, `stacks guide` and the `--help` footer); advertising a command whose main path refuses agents teaches them to call it. `--help` lists every subcommand.

## Design

### Where the version comes from: `core/update/latest.ts::latestVersion`

`GET https://registry.npmjs.org/@steamfield%2fstacks/latest` through `HttpClient.HttpClient` (the `NetLayer` that `bin.ts` provides, redirects not followed), `Accept: application/json`, a 10 s timeout. The body decodes `{ version }`, excess keys ignored (npm's document is large and not ours), where `version` is a pattern-checked string: `^\d{1,9}\.\d{1,9}\.\d{1,9}(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$`, at most 64 characters. Only a checked version ever reaches npm's argv, `details.command` or printed text; a raw upstream string is neither a CLI-produced value nor a caller argument (rules/cli/cli.md). `version.ts` gains `PACKAGE = metadata.name` so the package name is typed once; the registry URL is built from it.

Every failure is `UpstreamUnavailable` with new closed details `UpstreamUnavailableDetails = { service: Literals(["npm-registry"]), status? }` (a literal set, so 4.0d can add its index host): a transport error or timeout (no `status`), any non-2xx status including 3xx and 404 (`status`), and a body or version that doesn't decode (`status: 200`). The registry is a dependency this command can't work without, so it fails fast, and the envelope's `retryable: true` tells the caller to try again. A 404 is retryable on purpose: the package exists, so a 404 is the registry misbehaving. `failureGuide` prints `Service: npm registry` and `Status: <n>` when present, with the existing next action. Nothing is logged where the failure is raised; `main` logs the tag once.

`compareVersions` is a small pure function over that grammar, as semver orders it: numeric major, minor and patch; a prerelease sorts before its release; prerelease identifiers compare numerically when both are digits, numeric before alphanumeric, otherwise as ASCII strings, and a shorter identifier list sorts first when all shared ones are equal. No semver dependency. `VERSION` decodes with the same schema; a malformed own version is a defect.

### How it was installed: `core/update/install.ts::installMethod`

`Host` gains a required `packageRoot`, set in `bin.ts` as `fileURLToPath(new URL("../", import.meta.url))` beside `registry`: `packages/cli` under `bun run dev` (`src/bin.ts`) and the installed package root in the bundle (`dist/cli.mjs`). `Host.memory` defaults it to `/test/package`; `tests/helpers/cli.ts` sets it with the other paths. Core doesn't derive it from `registry`, which would tie it to the package layout.

- `npx`: the package root has an `_npx` path segment. `invocation.ts` exports the predicate (`isNpxPath`) that `invocationFor` already applies to `argv[1]`, and `installMethod` applies it to `Host.packageRoot`.
- `npm-global`: `Processes.which("npm")` finds npm, `Processes.exec` of `[npm, "prefix", "-g"]` exits 0 within 10 s, and the real path of `<prefix>/lib/node_modules/@steamfield/stacks` equals the real path of `Host.packageRoot`. Real paths matter: version managers such as mise link `node/24` to `node/24.21.0`.
- `other`: anything else, including a source checkout. A missing npm, a non-zero or timed-out `npm prefix -g`, a `SpawnFailed`, or a missing path each degrade to `other`, logged at debug. This is detection, not the operation, so it doesn't fail the command.

Both npm spawns run with cwd `Paths.home` and `childEnv([])` (the whole captured environment, so npm keeps its `npm_config_*` variables, proxy settings and PATH). From `Host.cwd` an untrusted repository's `.npmrc` could change the prefix npm reports (`prefix=`) or where the install comes from (`registry=`).

Detection runs only when a newer version exists, so an up-to-date check costs one request.

### What it does: `core/update/update.ts::update`

The `Effect.gen` body reads as named steps: current (`VERSION`), latest, compare, detect, then decide:

| Latest vs running | Install | Agent detected | `--check` | Outcome |
|---|---|---|---|---|
| equal | (not detected) | any | any | `up-to-date`, exit 0 |
| older (a dev or unreleased build) | (not detected) | any | any | `ahead`, exit 0 |
| newer | any | any | yes | `available`, exit 0, with `command` |
| newer | `npx` or `other` | any | no | `available`, exit 0, with `command` |
| newer | `npm-global` | yes | no | `PermissionDenied` reason `agent`, exit 6 |
| newer | `npm-global` | no | no | install, then `updated`, exit 0 |

The refusal checks `AppConfig.agent !== "none"` only, also with `--json`. It isn't the Trust model's point 4 confirmation rule, which also refuses without a TTY on stdin: nothing is confirmed here, so a person piping the output (no agent marker) still installs. The roadmap's Trust model gains this as its own sentence. Reason `agent` is reused because its `failureGuide` next ("ask the user to run this command from their own terminal") is the right step; `PermissionDeniedDetails`' doc comment and the roadmap row widen it from "a confirmation" to "an action reserved for a person".

`command` is what a person runs to get the latest: `npm install -g @steamfield/stacks@<latest>` for `npm-global` and `other`, and `npx -y @steamfield/stacks@<latest>` for `npx`, built with `core/shell.ts::shellArg`.

The install is `Processes.exec` of `[npm, "install", "-g", "@steamfield/stacks@<latest>"]` (the npm path from `which`) with a 5 minute timeout. Pinning the exact version, not `@latest`, installs what was reported. Human mode writes `Output.progress` "Installing @steamfield/stacks@<latest> with npm..." first, since npm is silent here for tens of seconds. npm's output is neither shown nor logged: it can echo registry URLs with credentials from the user's `.npmrc`.

A non-zero exit, a timeout or a `SpawnFailed` is the new tag `UpdateFailed` (exit 6, not retryable, no kept result). An install runs only for a person or a non-agent script, so "ask the human" is the literal next step, and only npm's own output (which the person sees by rerunning) tells an `EACCES` on a system Node prefix from a registry or network failure. Details are closed `UpdateFailedDetails = { command, exitCode?, timedOut? }`, `command` the same text as the result's; `failureGuide` prints `Command: <command>` and `Next:` "Run <command> yourself to see npm's output." Interruption keeps the existing rule: the group gets SIGTERM, the run exits 130, and a half-finished global install is npm's to recover.

The running process keeps its old code after npm replaces the files; the command reports `latest` as the new version and doesn't re-execute itself.

### Result: `schemas/update.ts::UpdateResult`

A union discriminated on `status`, so `stacks schema update` documents which fields each status carries and the decoder enforces it:

```ts
const Versions = { current: Schema.String, latest: Schema.String };
export const UpdateResult = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["up-to-date", "ahead"]), ...Versions }),
  Schema.Struct({
    status: Schema.Literal("available"),
    ...Versions,
    install: Schema.Literals(["npm-global", "npx", "other"]),
    command: Schema.String,
  }),
  Schema.Struct({ status: Schema.Literal("updated"), ...Versions, install: Schema.Literal("npm-global") }),
]);
```

`RESULT_SCHEMAS` gains `update`.

Text (agent and human print the same lines; there's nothing to cut):

```
stacks 0.1.0 is up to date.
stacks 0.2.0 is newer than the published 0.1.0.
stacks 0.2.0 is available (running 0.1.0). Run: npm install -g @steamfield/stacks@0.2.0
Updated stacks 0.1.0 -> 0.2.0.
```

### Command: `commands/update.ts`

A thin handler with one `--check` flag and the root `--json`. The help text says it makes one request to the npm registry and nothing runs in the background, names `--check` as the way an agent gets the versions, and lists the exits: 0 up to date, available or updated; 4 the registry is unavailable; 6 an agent ran it without `--check` while a newer version was installable, or npm failed; 130 interrupted. `cli.ts` adds it to the subcommands.

## Files and areas touched

| Path | Change |
|---|---|
| `src/version.ts` | `PACKAGE` |
| `src/invocation.ts` | `isNpxPath`, shared with install detection |
| `src/services/host.ts`, `src/bin.ts` | required `packageRoot`, `Host.memory` default |
| `src/core/update/` | `latest.ts`, `version.ts` (grammar and `compareVersions`), `install.ts`, `update.ts`, `report.ts` |
| `src/schemas/update.ts`, `src/core/result-schemas.ts` | `UpdateResult` |
| `src/commands/update.ts`, `src/cli.ts` | the command |
| `src/errors.ts` | `UpstreamUnavailableDetails` and `UpdateFailed` (`UpdateFailedDetails`): classes, `errorClasses`, `errorTable`, `ErrorTag`, the `ErrorEnvelope` details union, `encodeDetails` (moving `UpstreamUnavailable` out of the no-details group), `failureGuide`; `PermissionDeniedDetails`' comment |
| `tests/helpers/cli.ts` | `packageRoot`; a `runCli` option `http?: Layer<HttpClient>` defaulting to `NetLayer`'s client, with `Tcp` kept real |
| `plans/roadmap.md` | Error tags (`UpstreamUnavailable` details, `UpdateFailed`, `PermissionDenied` reason `agent` widened); the "Invocation string" row (the package name is stale: `@steamfield/stacks`, and `isNpxPath` with its two users); a `Host.packageRoot` row; `UpdateResult`; Trust model point 1 (`update` starts only `npm`, found by `which`, with `prefix -g` and `install -g @steamfield/stacks@<version>`, the version checked) and the agent-only install sentence |
| `.claude/rules/architecture.md`, AGENTS.md | "only `verify` runs commands" and "no network requirement" name `update`'s one request and fixed npm calls, made only when asked; the Architecture map entry for `core/update/` |
| `src/platform/net.ts` | the stale "Bun's [fetch] in the binary" comment: the CLI is a Node bundle |
| `packages/cli/docs/reference/`, `packages/cli/README.md` | the command |

## Acceptance tests

Every test runs through `runCli` with a scripted `HttpClient` that records request URLs, and fake `npm` executables on a test PATH that record their argv and cwd; none reaches the network or a real npm. Each is tagged `[4.4d#n]`.

1. Running equals latest: exit 0, `status: "up-to-date"`, and npm is never run (no `npm prefix -g`).
2. Running newer than latest (`0.3.0` vs `0.2.0`, and `0.2.0` vs `0.2.0-rc.1`): `ahead`, exit 0, nothing installed.
3. Newer available, npm-global (fake `npm prefix -g` prints a prefix whose `lib/node_modules/@steamfield/stacks` links to `Host.packageRoot`), no agent: the fake npm receives exactly `install -g @steamfield/stacks@<latest>`, result `updated`, exit 0.
4. Same as 3 with an agent marker, in agent mode and with `--json`: `PermissionDenied` reason `agent`, exit 6, stdout empty, the `--json` envelope is the last stderr line with a `next`, and npm's `install` was never called. With `--check` instead: `available` with `command`, exit 0.
5. Same as 3 with no agent marker and stdout not a terminal (a person piping): it installs.
6. `--check` with no agent on npm-global: `available`, and the fake npm saw `prefix -g` only.
7. npx (package root under `_npx`): `available`, `install: "npx"`, `command` is `npx -y @steamfield/stacks@<latest>`, exit 0, no install even without an agent.
8. Other: no npm on PATH, `npm prefix -g` exiting 1, `npm prefix -g` hanging past a test-sized timeout (its process group gone afterwards), and a prefix holding a different package directory each give `install: "other"`, the npm command, exit 0.
9. Registry failures: a transport error, a 503, a 404, a 302, a 200 without `version`, and a 200 whose `version` is `"1.0.0 && x"` or `"latest"` each exit 4 with `UpstreamUnavailable`, `retryable: true`, `details.service` `npm-registry` and `status` present except for the transport error; stdout is empty, the envelope is the last stderr line, and npm is never spawned.
10. Install failure: the fake npm exits 243 gives `UpdateFailed`, exit 6, `details: { command, exitCode: 243 }`, and text ends with `Next:` naming the command; npm's stderr text appears in neither the output nor the log file.
11. Both npm spawns run with cwd `Paths.home` while `Host.cwd` holds a `.npmrc` with `prefix=` and `registry=` lines.
12. `update --json` decodes with `UpdateResult` in every exit-0 case above, each status carries exactly its fields, and `stacks schema update` prints the schema. The envelopes from 4, 9 and 10 decode with `ErrorEnvelope`.
13. Only `update` contacts the registry: `--version`, `doctor`, `list` and a `verify` whose http probe makes a local request send nothing to `registry.npmjs.org`.
14. With stdout a terminal and no agent marker, the progress line is on stderr before the fake npm's install and the result is on stdout; in agent and `--json` modes there is no progress line.
15. `update --help` lists `--check`, `--json` and every exit code.

### Realistic edge cases

16. A version-manager prefix: `<prefix>` is a symlink to the real Node directory and the package root is reached through it; detection still says `npm-global`.
17. The install times out (fake npm sleeps past a test-sized timeout): `UpdateFailed` with `timedOut: true`, and the npm process group is gone afterwards.
18. Interrupting during the install exits 130 and leaves no npm process running.
19. `compareVersions` is reflexive and antisymmetric (property test), and orders `0.2.0-rc.9 < 0.2.0-rc.10 < 0.2.0 < 0.10.0`.

The real `bun run human -- update` run is the manual "Verifying UX" step, not an acceptance test, because it reaches the live registry.

## What this plan may get wrong

- A source checkout reports `install: "other"` whenever its `package.json` version is behind npm's latest; that's correct, since `bun run dev` can't update itself.
- `npm prefix -g` takes about 200 ms; if that's too slow, detection could read npm's config files instead, at the cost of reimplementing npm's lookup order.
- The registry read is hard-wired to registry.npmjs.org and uses Node's `fetch`, which ignores `HTTPS_PROXY`, while `npm install -g` uses the user's configured registry and proxy. Behind a proxy the read may exit 4 while npm would work; with a mirror, the mirror may not have `@<latest>` yet and the install fails as `UpdateFailed`. Asking `npm view @steamfield/stacks version` would fix both, at the cost of a second npm spawn on every check.
- 2026-10-27: reusing `PermissionDenied` reason `agent` also reuses its text line saying a person's confirmation is needed, though `update` confirms nothing. Left as is; a distinct reason is the fix if agents misread it.
- 2026-10-27: `UpdateFailed`'s text prints `npm exit: <n>` or `npm timed out.` and the command only once, in `Next:`, rather than a `Command:` line that repeated it.
- 2026-10-27: `latestVersion` scopes each request (`HttpClient.withScope`), because an unread non-2xx response body otherwise stayed open past the command.
- `Processes.which("npm")` may find another Node's npm than the one running the CLI (nvm with two versions). The real-path comparison fails safe to `other`, but the printed command then targets the PATH npm's prefix. Preferring the `npm` beside `Host.executable` would fix it.
