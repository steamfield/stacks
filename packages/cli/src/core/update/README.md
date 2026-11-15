# core/update

This folder runs `stacks update`. It checks whether a newer version of stacks is on npm and,
when a person at a terminal asks for it, upgrades a global npm install in place.

## How it fits

`commands/update.ts` parses the `--check` flag, calls `update.ts::update` and prints the result
with `report.ts::renderUpdate` (or the `UpdateResult` itself under `--json`). Like the rest of
`core/`, this folder never imports `platform/` or `commands/`: the HTTP request goes through
Effect's `HttpClient`, and child processes go through `services/processes.ts::Processes`.

`update` is one of the few places the CLI reaches the network or runs a program it didn't get
from a project manifest, so it is kept narrow:

- One request, to the npm registry's "latest" document, with a 10 second deadline. Offline mode
  refuses before making it, because no version is cached to compare against.
- The registry's answer is untrusted, so its version is decoded with `version.ts::Version` before
  it reaches output or an argument list.
- The install is `npm install -g <package>@<version>` as fixed argv with that decoded version, never
  a shell string (`.claude/rules/architecture.md`, "Trust model", point 1).
- It never installs under a detected agent (point 4). Agents run `stacks update --check`, which
  reports the command instead.

## Main flow

1. `update` decodes the running version and refuses offline mode.
2. `latest.ts::latestVersion` fetches and decodes the published version.
3. `version.ts::compareVersions` orders the two. Equal is `up-to-date`, older published is
   `ahead`; both stop here.
4. For a newer version, `install.ts::installMethod` works out how this copy was installed:
   `npx`, `npm-global` (the package root is the one under `npm prefix -g`, by real path) or
   `other`.
5. With `--check`, or any install other than `npm-global`, the result is `available` with the
   command to run.
6. Otherwise `installLatest` runs npm and the result is `updated`. A spawn failure, a timeout or a
   nonzero exit is `UpdateFailed`.

## Files

| File | What it owns |
| --- | --- |
| `update.ts` | `update`, the whole command's sequence, and the npm install step |
| `latest.ts` | `latestVersion`, the one registry request and its failure mapping to `UpstreamUnavailable` |
| `install.ts` | `installMethod`, best-effort detection of npx, global npm or anything else |
| `version.ts` | `Version`, the accepted version format, and `compareVersions`, semver precedence |
| `report.ts` | `renderUpdate`, the one text line per outcome |

## Terms

- Global npm install: a copy installed with `npm install -g`, living under npm's global prefix.
  Only this kind is upgraded in place, because it is the only one the CLI can confirm it owns.
- Detection: the `npm prefix -g` probe in `install.ts`. Any failure there falls back to `other`,
  which only means the person is shown the command instead of having it run.

## Where to start

Read `update.ts::update` top to bottom; each step names the file it calls. The tests are
`packages/cli/tests/update.test.ts`, with the fake registry and npm in
`packages/cli/tests/helpers/update.ts`.
